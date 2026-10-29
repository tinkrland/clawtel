import assert from "node:assert/strict";
import test from "node:test";
import { answerForCall, fitForSpeech, scopeForMeeting, speakable } from "../meetings/voice/answer.ts";
import type { Meeting } from "../meetings/meeting.ts";

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: "m1", title: "office hours", platform: "zoom", joinUrl: "https://zoom.us/j/1",
  joinDelayMinutes: 0, status: "in_meeting", createdAt: new Date().toISOString(), ...over,
});

const stubMemory = (payload: unknown, ok = true, reason?: string) => ({
  isAvailable: () => true,
  answer: async () => (ok ? { ok: true, data: payload } : { ok: false, reason }),
});

test("a spoken line carries no citation ids", () => {
  const line = speakable("It is fourteen days (9d963ffe37f13cfd@0:02:44). Digital is seven days.");
  assert.equal(line.includes("9d963ffe37f13cfd"), false);
  assert.match(line, /fourteen days/);
});

test("a long answer is cut on a sentence boundary and says so", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} explains the policy in detail.`).join(" ");
  const { line, truncated } = fitForSpeech(long);
  assert.equal(truncated, true);
  assert.ok(line.length <= 420);
  assert.match(line, /\.$/);
});

test("the meeting decides the scope, platform and all", () => {
  const zoom = scopeForMeeting(meeting(), "clawtel", "guest-7");
  assert.equal(zoom.ok, true);
  if (zoom.ok) {
    assert.equal(zoom.scope.platform, "zoom");
    assert.equal(zoom.scope.connection_id, "guest-7");
  }
  const none = scopeForMeeting(meeting({ platform: "" as Meeting["platform"] }), "clawtel");
  assert.equal(none.ok, false);
});

test("an answer reaches the call with receipts beside it, not inside it", async () => {
  const memory = stubMemory({
    ok: true, answer: "Digital goods are seven days (9d963ffe37f13cfd@0:02:44).",
    citations: ["9d963ffe37f13cfd@0:02:44"], tool_calls: [{ tool: "search_memory", ok: true }],
    provider: "featherless:Qwen/Qwen2.5-72B-Instruct", steps: 2,
  });
  const out = await answerForCall(meeting(), "how long for digital goods?", { personaId: "clawtel", memory });
  assert.equal(out.ok, true);
  assert.match(out.speak, /seven days/);
  assert.equal(out.speak.includes("9d963ffe"), false);
  assert.deepEqual(out.sources, ["9d963ffe37f13cfd@0:02:44"]);
  assert.deepEqual(out.tools, ["search_memory"]);
  assert.equal(out.truncated, false);
  assert.match(out.full, /9d963ffe37f13cfd@0:02:44/);
});

test("a refusal is honest and speaks nothing", async () => {
  const out = await answerForCall(meeting(), "who won the match?", {
    personaId: "clawtel",
    memory: stubMemory({ ok: false, error: "nothing in memory speaks to this" }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.speak, "");
  assert.match(out.reason ?? "", /nothing in memory/);
});

test("a closed memory lane is refused, never guessed", async () => {
  const out = await answerForCall(meeting(), "how long is the window?", {
    personaId: "clawtel",
    memory: { isAvailable: () => false, answer: async () => ({ ok: true }) },
  });
  assert.equal(out.ok, false);
  assert.equal(out.speak, "");
  assert.match(out.reason ?? "", /closed/);
});

test("an empty question is refused before any call", async () => {
  let called = false;
  const memory = { isAvailable: () => true, answer: async () => { called = true; return { ok: true }; } };
  const out = await answerForCall(meeting(), "   ", { personaId: "clawtel", memory });
  assert.equal(out.ok, false);
  assert.equal(called, false);
});
