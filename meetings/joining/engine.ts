// the join engine: a meeting plan becomes a live session through a
// browser lane. the lane is a seam: the cloud provider lane (bring
// keys) or, the clawtel-native answer, a browser inside a spawnable
// (the join tab must live where a screen exists to share). a lane
// without its keys stays closed and the engine says so, it never
// fakes a join.

import { getMeeting, setSession, transitionMeeting } from "../meeting.ts";

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
}

// the active browser lane, wired from server.ts when one exists.
let activeLane: BrowserLane = new ClosedLane("browser");

export function setBrowserLane(lane: BrowserLane): void {
  activeLane = lane;
}

export function getBrowserLane(): BrowserLane {
  return activeLane;
}

export interface JoinResult {
  meetingId: string;
  sessionId: string;
  joinedAt: string;
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
    transitionMeeting(meetingId, "in_meeting");
    return { meetingId, sessionId, joinedAt: new Date().toISOString() };
  } catch (err) {
    // a failed join unwinds to planned: the state stays honest and a
    // retry does not need to invent history. this is a deliberate
    // unwind of the one step we own, not a skip through the machine.
    const m = getMeeting(meetingId)!;
    m.status = "planned";
    throw err;
  }
}

export async function leaveMeeting(meetingId: string): Promise<void> {
  const meeting = getMeeting(meetingId);
  if (!meeting) throw new Error(`no meeting ${meetingId}`);
  if (meeting.status !== "in_meeting") {
    throw new Error(`only an in-meeting meeting can take home. ${meeting.id} is ${meeting.status}`);
  }
  transitionMeeting(meetingId, "take_home");
}
