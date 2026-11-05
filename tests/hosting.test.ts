import assert from "node:assert/strict";
import test from "node:test";

import { parseAgenda } from "../hosting/agenda.ts";
import { parseDemo, runDemo, type DemoDriver, type DemoScript } from "../hosting/demo.ts";
import {
  advanceHosting, backHosting, closeHosting, createHosting, currentSegment,
  pauseHosting, remainingMs, resumeHosting, startHosting, tickHosting,
} from "../hosting/session.ts";
import { decideAdmission, shareForSegment, ClosedControls } from "../hosting/controls.ts";
import { renderEventDraft, luMaPayload } from "../hosting/listing.ts";

const demo = (): DemoScript => ({ name: "the walkthrough", startUrl: "https://example.com", steps: [{ action: "click", label: "open pricing", selector: "#pricing" }] });

const agendaInput = () => ({
  title: "office hours: refunds",
  segments: [
    { kind: "welcome", title: "hello", minutes: 3 },
    { kind: "demo", title: "the product", minutes: 10, demo: demo() },
    { kind: "qa", title: "your questions", minutes: 15 },
    { kind: "close", title: "bye", minutes: 2 },
  ],
});

test("an agenda must open with a welcome and end with a close", () => {
  const ok = parseAgenda(agendaInput());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.agenda.totalMinutes, 30);

  const noClose = parseAgenda({ title: "x", segments: [{ kind: "welcome", minutes: 2 }, { kind: "qa", minutes: 5 }] });
  assert.equal(noClose.ok, false);
  if (!noClose.ok) assert.match(noClose.reason, /last segment must be a close/);

  const badKind = parseAgenda({ title: "x", segments: [{ kind: "keynote", minutes: 5 }] });
  assert.equal(badKind.ok, false);
});

test("a demo segment without a runnable script is refused at the desk", () => {
  const noScript = parseAgenda({ title: "x", segments: [
    { kind: "welcome", minutes: 2 },
    { kind: "demo", title: "demo", minutes: 10 },
    { kind: "close", minutes: 2 },
  ] });
  assert.equal(noScript.ok, false);
  if (!noScript.ok) assert.match(noScript.reason, /needs a valid script/);

  const oneMinute = parseAgenda({ title: "x", segments: [
    { kind: "welcome", minutes: 2 },
    { kind: "demo", title: "demo", minutes: 1, demo: demo() },
    { kind: "close", minutes: 2 },
  ] });
  assert.equal(oneMinute.ok, false);
});

test("a script with a bad step fails before it runs", () => {
  assert.equal(parseDemo({ name: "x", steps: [{ action: "navigate", label: "go", url: "javascript:alert(1)" }] }).ok, false);
  assert.equal(parseDemo({ name: "x", steps: [{ action: "click", label: "go" }] }).ok, false);
  assert.equal(parseDemo({ name: "x", steps: [{ action: "wait", label: "w", ms: 999999 }] }).ok, false);
  assert.equal(parseDemo({ name: "x", steps: [] }).ok, false);
  assert.equal(parseDemo({ name: "x", steps: [{ action: "press", label: "tab", key: "Tab" }] }).ok, true);
});

function fakeDriver(over: Partial<DemoDriver> = {}): DemoDriver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    navigate: async (url) => { calls.push(`navigate ${url}`); },
    click: async (sel) => { calls.push(`click ${sel}`); },
    type: async (sel, text) => { calls.push(`type ${sel} ${text}`); },
    evaluate: async <T>(expr: string) => { calls.push(`evaluate ${expr.slice(0, 24)}`); return true as T; },
    screenshot: async () => new Uint8Array(4096),
    sleep: async (ms) => { calls.push(`sleep ${ms}`); },
    ...over,
  };
}

test("a demo runs its steps and leaves a timed receipt for each", async () => {
  const driver = fakeDriver();
  const script: DemoScript = {
    name: "walk",
    startUrl: "https://example.com",
    steps: [
      { action: "navigate", label: "pricing", url: "https://example.com/pricing" },
      { action: "click", label: "open the plan", selector: "#plan" },
      { action: "type", label: "fill the form", selector: "#email", text: "guest@example.com" },
      { action: "check", label: "the page shows the plan", expression: "document.title.includes('plan')" },
      { action: "shot", label: "capture", },
      { action: "wait", label: "let it settle", ms: 250 },
    ],
  };
  const out = await runDemo(script, driver);
  assert.equal(out.ok, true);
  assert.equal(out.ran, 7); // the opening navigate plus six steps
  assert.equal(out.receipts.every((r) => r.ok), true);
  assert.match(driver.calls.join(" | "), /navigate https:\/\/example.com\/pricing/);
  assert.match(driver.calls.join(" | "), /sleep 250/);
});

test("a failed step stops the demo and names the step", async () => {
  const driver = fakeDriver({ click: async () => { throw new Error("no such selector"); } });
  const script: DemoScript = {
    name: "walk",
    steps: [
      { action: "click", label: "open the plan", selector: "#plan" },
      { action: "type", label: "never reached", selector: "#email", text: "x" },
    ],
  };
  const out = await runDemo(script, driver);
  assert.equal(out.ok, false);
  assert.equal(out.failedAt, 0);
  assert.match(out.reason ?? "", /open the plan failed/);
  assert.equal(out.ran, 1);
});

test("an optional step is recorded and walked past", async () => {
  const driver = fakeDriver({
    click: async (sel) => {
      if (sel === ".bubble") throw new Error("tour bubble never appeared");
    },
  });
  const script: DemoScript = {
    name: "walk",
    steps: [
      { action: "click", label: "tour bubble", selector: ".bubble", optional: true },
      { action: "click", label: "the real button", selector: "#next" },
    ],
  };
  const out = await runDemo(script, driver);
  assert.equal(out.ok, true);
  assert.equal(out.receipts[0].ok, false);
  assert.equal(out.receipts[0].optional, true);
  assert.equal(out.receipts[1].ok, true);
});

test("a falsy check and a blank screenshot are failures, not ticks", async () => {
  const falsy = await runDemo({ name: "c", steps: [{ action: "check", label: "assert", expression: "false" }] },
    fakeDriver({ evaluate: async <T>() => false as T }));
  assert.equal(falsy.ok, false);
  assert.match(falsy.reason ?? "", /evaluated falsy/);

  const blank = await runDemo({ name: "s", steps: [{ action: "shot", label: "capture" }] },
    fakeDriver({ screenshot: async () => new Uint8Array(12) }));
  assert.equal(blank.ok, false);
  assert.match(blank.reason ?? "", /blank/);
});

const built = () => {
  const parsed = parseAgenda(agendaInput());
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.agenda;
};

const T0 = 1_700_000_000_000;

test("a night starts in lobby, and only the host starts it", () => {
  const state = createHosting({ id: "h1", meetingId: "m1", agenda: built(), now: T0 });
  assert.equal(state.phase, "lobby");
  assert.equal(state.segmentStartedAt, null);
  assert.equal(remainingMs(state, T0), null);

  const live = startHosting(state, T0);
  assert.equal(live.phase, "live");
  assert.equal(currentSegment(live)?.kind, "welcome");
  assert.equal(remainingMs(live, T0 + 60_000), 2 * 60_000);
});

test("the clock moves a segment only when its minutes are actually gone", () => {
  const live = startHosting(createHosting({ id: "h1", meetingId: "m1", agenda: built(), now: T0 }), T0);
  const early = tickHosting(live, T0 + 60_000);
  assert.equal(early.index, 0);

  const onTime = tickHosting(live, T0 + 3 * 60_000);
  assert.equal(onTime.index, 1);
  assert.equal(currentSegment(onTime)?.kind, "demo");

  // the last segment ends the night rather than leaving it idle
  let state = onTime;
  for (const _ of [0, 1, 2]) state = tickHosting(state, (state.segmentStartedAt ?? 0) + 99 * 60_000);
  assert.equal(state.phase, "closed");
  assert.equal(state.log.some((l) => l.event === "ended"), true);
});

test("pausing holds the segment's remaining minutes, not the wall clock", () => {
  const live = startHosting(createHosting({ id: "h1", meetingId: "m1", agenda: built(), now: T0 }), T0);
  const paused = pauseHosting(live, T0 + 60_000);
  assert.equal(paused.phase, "paused");
  // twenty minutes of being held should not eat the welcome
  const resumed = resumeHosting(paused, T0 + 60_000 + 20 * 60_000);
  assert.equal(resumed.phase, "live");
  assert.equal(remainingMs(resumed, T0 + 60_000 + 20 * 60_000), 2 * 60_000);
});

test("advance and back are explicit acts the host owns", () => {
  const live = startHosting(createHosting({ id: "h1", meetingId: "m1", agenda: built(), now: T0 }), T0);
  const ahead = advanceHosting(live, T0 + 1000);
  assert.equal(ahead.index, 1);
  const backAgain = backHosting(ahead, T0 + 2000);
  assert.equal(backAgain.index, 0);
  // stepping back from the first segment is a no-op, not an error
  assert.equal(backHosting(backAgain, T0 + 3000).index, 0);
  // advancing past the last segment ends the night
  let state = live;
  for (let i = 0; i < 4; i += 1) state = advanceHosting(state, T0 + 5000 + i);
  assert.equal(state.phase, "closed");
});

test("a closed night stays closed", () => {
  const live = startHosting(createHosting({ id: "h1", meetingId: "m1", agenda: built(), now: T0 }), T0);
  const closed = closeHosting(live, T0 + 10);
  assert.equal(closed.phase, "closed");
  assert.equal(startHosting(closed, T0 + 20).phase, "closed");
  assert.equal(tickHosting(closed, T0 + 30).index, closed.index);
});

test("admission respects the blocked list before any policy", () => {
  assert.equal(decideAdmission("all", { id: "a" }), "admit");
  assert.equal(decideAdmission("all", { id: "a", blocked: true }), "refuse");
  assert.equal(decideAdmission("known", { id: "a" }), "hold");
  assert.equal(decideAdmission("known", { id: "a", known: true }), "admit");
  assert.equal(decideAdmission("ask", { id: "a", known: true }), "hold");
  assert.equal(decideAdmission("ask", { id: "" }), "refuse");
});

test("unwired host controls refuse instead of pretending", async () => {
  const controls = new ClosedControls("zoom");
  await assert.rejects(() => controls.admit("g1"), /not wired for zoom: cannot admit a guest/);
  await assert.rejects(() => controls.startShare(), /cannot share the screen/);
});

test("sharing is on for what is shown, off for talking to people", () => {
  assert.equal(shareForSegment("demo"), true);
  assert.equal(shareForSegment("talk"), true);
  assert.equal(shareForSegment("qa"), false);
  assert.equal(shareForSegment("welcome"), false);
  assert.equal(shareForSegment("qa", true), true);
});

test("the listing renders the night that will actually run, and never publishes", () => {
  const listing = renderEventDraft(built(), {
    hostName: "clawtel",
    startsAt: "2026-11-12T18:00:00Z",
    timezone: "Asia/Kolkata",
    joinLink: "https://zoom.us/j/123",
  });
  assert.match(listing.draft.blurb, /the product/);
  assert.deepEqual(listing.draft.agendaLines.length, 4);
  assert.match(listing.draft.agendaLines[1], /the walkthrough, live in a browser/);
  assert.equal(listing.publish.ok, false);
  assert.match(listing.publish.reason, /never posts an event/);

  const payload = luMaPayload(listing.draft);
  assert.equal(payload.name, "office hours: refunds");
  assert.equal(payload.timezone, "Asia/Kolkata");
  assert.equal(payload.duration_minutes, 30);
  assert.equal(payload.start_at, "2026-11-12T18:00:00Z");

  // and no guessed start when none was given
  const bare = luMaPayload(renderEventDraft(built()).draft);
  assert.equal("start_at" in bare, false);
  assert.equal("timezone" in bare, false);
});
