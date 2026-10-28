// the join engine: a meeting plan becomes a live session through a
// browser lane. the lane is a seam: the cloud provider lane (bring
// keys) or, the clawtel-native answer, a browser inside a spawnable
// (the join tab must live where a screen exists to share). a lane
// without its keys stays closed and the engine says so, it never
// fakes a join.

import { clearSession, getMeeting, getSession, setSession, transitionMeeting } from "../meeting.ts";

export interface BrowserSession {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  // evaluate an in-page expression: how every page seam is called.
  // the expression is built by this package, never scraped blindly.
  evaluate<T = unknown>(expression: string): Promise<T>;
  close(): Promise<void>;
}

export interface BrowserLane {
  readonly lane: string;
  isAvailable(): boolean;
  open(url: string, opts: { name: string }): Promise<BrowserSession>;
  close(sessionId: string): Promise<void>;
}

// the closed lane: the honest default. every lane that is not wired
// yet reports closed instead of pretending.
export class ClosedLane implements BrowserLane {
  readonly lane: string;
  constructor(lane: string) {
    this.lane = lane;
  }
  isAvailable(): boolean {
    return false;
  }
  async open(): Promise<BrowserSession> {
    throw new Error(`${this.lane} lane is closed. bring keys or wire a lane; nothing fakes a join.`);
  }
  async close(): Promise<void> {
    throw new Error(`${this.lane} lane is closed; there is no browser to close.`);
  }
}

// the active browser lane, wired from server.ts when one exists.
let activeLane: BrowserLane = new ClosedLane("browser");

export function setBrowserLane(lane: BrowserLane): void {
  activeLane = lane;
}

export function getBrowserLane(): BrowserLane {
  return activeLane;
}

// a platform module completes the join on a platform's own terms: its
// page seams, its credentials, its sdk. a browser that opened a url is
// not a join, so the engine asks the platform module and reports what
// came back. no module wired for a platform = the attempt stays honest.
export interface PlatformModule {
  readonly platform: string;
  /** drive the join page to the in-meeting state; resolve joined only on real evidence. */
  completeJoin(session: BrowserSession, meeting: { id: string; joinUrl: string }): Promise<{ joined: boolean; detail: string }>;
}

const platformModules = new Map<string, PlatformModule>();

export function registerPlatformModule(module: PlatformModule): void {
  platformModules.set(module.platform, module);
}

export function platformModuleFor(platform: string): PlatformModule | undefined {
  return platformModules.get(platform);
}

export interface JoinResult {
  meetingId: string;
  sessionId: string;
  /** true only when a platform module confirmed the in-meeting state. */
  joined: boolean;
  joinedAt?: string;
  /** the honest state of the attempt, always said out loud. */
  detail: string;
}

export async function joinMeeting(meetingId: string): Promise<JoinResult> {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error(`no meeting ${meetingId}`);
  if (meeting.status !== "planned") {
    throw new Error(`only a planned meeting joins. ${meeting.id} is ${meeting.status}`);
  }
  if (!activeLane.isAvailable()) {
    throw new Error(
      `${activeLane.lane} lane is closed. bring keys or wire a lane; nothing fakes a join.`,
    );
  }
  transitionMeeting(meetingId, "joining");
  try {
    const session = await activeLane.open(meeting.joinUrl, {
      name: `clawtel-${meeting.id}`,
    });
    const sessionId = `${activeLane.lane}:${meeting.id}`;
    setSession(meetingId, sessionId);

    const module = platformModuleFor(meeting.platform);
    if (!module) {
      // a browser is open on the join url, but nobody confirmed the
      // meeting. the meeting stays planned, honestly.
      const m = getMeeting(meetingId)!;
      m.status = "planned";
      return {
        meetingId,
        sessionId,
        joined: false,
        detail: `the browser is open in the dock, but the ${meeting.platform} join page seam is not wired in clawtel yet. the meeting is not claimed.`,
      };
    }
    const outcome = await module.completeJoin(session, { id: meeting.id, joinUrl: meeting.joinUrl });
    if (outcome.joined) {
      transitionMeeting(meetingId, "in_meeting");
      return {
        meetingId,
        sessionId,
        joined: true,
        joinedAt: new Date().toISOString(),
        detail: outcome.detail,
      };
    }
    const m = getMeeting(meetingId)!;
    m.status = "planned";
    return {
      meetingId,
      sessionId,
      joined: false,
      detail: outcome.detail,
    };
  } catch (err) {
    // a failed join unwinds to planned: the state stays honest and a
    // retry does not need to invent history. this is a deliberate
    // unwind of the one step we own, not a skip through the machine.
    const m = getMeeting(meetingId)!;
    m.status = "planned";
    throw err;
  }
}

/** close the dock a join attempt opened. the browser goes away, the record stays. */
export async function closeMeetingBrowser(meetingId: string): Promise<void> {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error(`no meeting ${meetingId}`);
  const lane = getBrowserLane();
  if (!lane.isAvailable()) {
    throw new Error(`${lane.lane} lane is closed; there is no browser to close.`);
  }
  const session = getSession(meetingId);
  if (!session) {
    throw new Error(`no browser session is attached to ${meetingId}`);
  }
  await lane.close(session);
  clearSession(meetingId);
}

export async function leaveMeeting(meetingId: string): Promise<void> {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error(`no meeting ${meetingId}`);
  if (meeting.status !== "in_meeting") {
    throw new Error(`only an in-meeting meeting can take home. ${meeting.id} is ${meeting.status}`);
  }
  transitionMeeting(meetingId, "take_home");
}
