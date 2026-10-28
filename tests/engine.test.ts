import { test } from "node:test";
import assert from "node:assert/strict";

// the engine tests use stubs, never a real lane: no test ever creates
// a spawnable or spends money. imports come through the seam only.

import {
  ClosedLane,
  joinMeeting,
  leaveMeeting,
  registerPlatformModule,
  setBrowserLane,
  type BrowserLane,
  type BrowserSession,
  type PlatformModule,
} from "../meetings/joining/engine.ts";
import { createMeeting, getMeeting, transitionMeeting } from "../meetings/meeting.ts";

function stubSession(): BrowserSession {
  const calls: string[] = [];
  return {
    navigate: async (url) => {
      calls.push(`navigate:${url}`);
    },
    click: async () => {
      calls.push("click");
    },
    type: async () => {
      calls.push("type");
    },
    screenshot: async () => new Uint8Array([0x89, 0x50]),
    evaluate: async <T>(expr: string) => `${expr}:${calls.length}` as unknown as T,
    close: async () => {
      calls.push("close");
    },
  };
}

class StubLane implements BrowserLane {
  readonly lane = "stub";
  public openedWith: { url: string; name: string } | null = null;
  public closed: string[] = [];
  isAvailable(): boolean {
    return true;
  }
  async open(url: string, opts: { name: string }): Promise<BrowserSession> {
    this.openedWith = { url, name: opts.name };
    return stubSession();
  }
  async close(sessionId: string): Promise<void> {
    this.closed.push(sessionId);
  }
}

function stubModule(platform: string, outcome: { joined: boolean; detail: string }): PlatformModule {
  return {
    platform,
    completeJoin: async () => outcome,
  };
}

function planMeeting() {
  return createMeeting({
    title: "engine test",
    platform: "meet",
    joinUrl: "https://meet.google.com/abc-defg-hij",
    joinDelayMinutes: 2,
  });
}

test("a closed lane refuses to join and says so", async () => {
  setBrowserLane(new ClosedLane("browser"));
  const meeting = planMeeting();
  await assert.rejects(() => joinMeeting(meeting.id), /lane is closed/);
  assert.equal(getMeeting(meeting.id)?.status, "planned");
});

test("a browser opening a url is not a join: honest joined: false, meeting stays planned", async () => {
  const lane = new StubLane();
  setBrowserLane(lane);
  const meeting = planMeeting();
  const attempt = await joinMeeting(meeting.id);
  assert.equal(attempt.joined, false);
  assert.match(attempt.detail, /join page seam is not wired/);
  assert.equal(attempt.sessionId, `stub:${meeting.id}`);
  assert.equal(lane.openedWith?.url, "https://meet.google.com/abc-defg-hij");
  assert.equal(getMeeting(meeting.id)?.status, "planned");
});

test("a platform module that confirms turns the meeting in_meeting", async () => {
  registerPlatformModule(stubModule("meet", { joined: true, detail: "the sdk says in-meeting" }));
  const lane = new StubLane();
  setBrowserLane(lane);
  const meeting = planMeeting();
  const attempt = await joinMeeting(meeting.id);
  assert.equal(attempt.joined, true);
  assert.equal(attempt.detail, "the sdk says in-meeting");
  assert.ok(attempt.joinedAt);
  assert.equal(getMeeting(meeting.id)?.status, "in_meeting");

  // and it can leave honestly
  await leaveMeeting(meeting.id);
  assert.equal(getMeeting(meeting.id)?.status, "take_home");
});

test("a platform module that refuses keeps the meeting planned", async () => {
  registerPlatformModule(stubModule("meet", { joined: false, detail: "the host never let it in" }));
  const lane = new StubLane();
  setBrowserLane(lane);
  const meeting = planMeeting();
  const attempt = await joinMeeting(meeting.id);
  assert.equal(attempt.joined, false);
  assert.equal(attempt.detail, "the host never let it in");
  assert.equal(getMeeting(meeting.id)?.status, "planned");
});

test("only a planned meeting can attempt a join", async () => {
  setBrowserLane(new StubLane());
  const meeting = planMeeting();
  transitionMeeting(meeting.id, "joining");
  await assert.rejects(() => joinMeeting(meeting.id), /only a planned meeting joins/);
});

// reset the lane to closed so the server suite stays hermetic
test.after(() => {
  setBrowserLane(new ClosedLane("browser"));
});
