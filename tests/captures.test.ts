import { test } from "node:test";
import assert from "node:assert/strict";
import { detectScarcity, scarcityKind } from "../capabilities/promo-codes/scarcity.ts";
import { extractExpiryWindow } from "../capabilities/promo-codes/expiry_window.ts";
import { parseColloquialTime } from "../capabilities/promo-codes/colloquial_time.ts";
import { captureSubject, extractCode, hearCapture } from "../capabilities/promo-codes/capture.ts";

// scarcity: the counted forms
test("first come first serve is scarcity", () => {
  const r = detectScarcity("it's first come first serve everyone");
  assert.ok(r.scarce);
  assert.ok(r.matched.includes("first come first serve"));
  assert.equal(scarcityKind(r), "time");
});

test("first N people carries the cap", () => {
  const r = detectScarcity("the first 50 people to enter the code get it");
  assert.ok(r.matched.includes("first N people"));
  assert.equal(r.cap, 50);
  assert.equal(scarcityKind(r), "people");
});

test("limited spots carries the cap", () => {
  const r = detectScarcity("there are only 10 spots left");
  assert.equal(r.cap, 10);
  assert.equal(scarcityKind(r), "people");
});

// scarcity with no number in it
test("the supply family: limited so get yours quickly", () => {
  const r = detectScarcity("these are limited so get yours quickly");
  assert.ok(r.matched.includes("limited"));
  assert.ok(r.matched.includes("get yours quickly"));
  assert.equal(scarcityKind(r), "supply");
});

test("once they're out they're out", () => {
  const r = detectScarcity("once they're out they're out");
  assert.ok(r.matched.includes("once they're out"));
  assert.equal(scarcityKind(r), "supply");
});

test("we may not have enough", () => {
  const r = detectScarcity("we may not have enough for everyone");
  assert.ok(r.matched.includes("may not have enough"));
});

test("bare 'limited time' is not a supply claim", () => {
  const r = detectScarcity("this is a limited time offer");
  assert.equal(r.scarce, false); // "limited time" is the expiry side's word
});

test("plain speech is not scarcity", () => {
  assert.equal(detectScarcity("the meeting starts at three").scarce, false);
  assert.equal(detectScarcity("").scarce, false);
});

// expiry windows: priority explicit length > clock > meeting-end > today > hurry
const NOW = new Date("2026-10-27T20:00:00.000Z");

test("an explicit length: expires in 10 minutes", () => {
  const w = extractExpiryWindow("the code expires in 10 minutes", { now: NOW });
  assert.equal(w?.kind, "minutes");
  assert.equal(w?.minutes, 10);
  assert.equal(w?.urgent, true);
  assert.equal(w?.expiresAt, "2026-10-27T20:10:00.000Z");
});

test("half an hour windows round to 30", () => {
  const w = extractExpiryWindow("it's only valid for half an hour", { now: NOW });
  assert.equal(w?.minutes, 30);
});

test("the duration can lead: you've got 2 hrs before it expires", () => {
  const w = extractExpiryWindow("you've got 2 hrs before it expires", { now: NOW });
  assert.equal(w?.minutes, 120);
  assert.equal(w?.urgent, false);
});

test("a clock with a zone: expires at 3pm eastern", () => {
  const w = extractExpiryWindow("the code expires at 3pm eastern", {
    now: new Date("2026-10-27T18:00:00.000Z"),
  });
  assert.equal(w?.kind, "clock");
  assert.equal(w?.expiresAt, "2026-10-27T19:00:00.000Z"); // 3pm edt = 19:00 utc
  assert.equal(w?.minutes, 60);
});

test("a zoneless clock is quoted, never invented", () => {
  const w = extractExpiryWindow("the code expires at 3pm", { now: NOW });
  assert.equal(w?.kind, "clock");
  assert.equal(w?.expiresAt, undefined);
  assert.equal(w?.urgent, false);
});

test("meeting-bound: only works while the meeting is live", () => {
  const w = extractExpiryWindow("this only works while the meeting is live", {
    now: NOW,
    meetingEndsAt: "2026-10-27T20:45:00.000Z",
  });
  assert.equal(w?.kind, "meeting_end");
  assert.equal(w?.minutes, 45);
});

test("today: expires tonight", () => {
  const w = extractExpiryWindow("the code expires tonight", { now: NOW });
  assert.equal(w?.kind, "today");
});

test("hurry words alone: urgency with no window", () => {
  const w = extractExpiryWindow("hurry, use it now", { now: NOW });
  assert.equal(w?.kind, "hurry");
  assert.equal(w?.urgent, true);
});

test("a duration with no expiry cue is a schedule, not a window", () => {
  const w = extractExpiryWindow("the meeting starts in 10 minutes", { now: NOW });
  assert.equal(w, null);
});

test("nothing expiry-shaped is null, a fine answer", () => {
  assert.equal(extractExpiryWindow("we're discussing the pricing tiers today", { now: NOW }), null);
  assert.equal(extractExpiryWindow("", { now: NOW }), null);
});

// colloquial time
test("10/25 at 10am ist reads the clock, not the date", () => {
  const t = parseColloquialTime("the call is on 10/25 at 10am ist", new Date("2026-10-20T00:00:00Z"));
  assert.ok(t?.iso);
  assert.ok(t?.iso!.endsWith(":30:00.000Z")); // 10am ist = 04:30 utc
  assert.ok(t!.iso!.startsWith("2026-10-25"));
});

test("relative time: in 20 min", () => {
  const t = parseColloquialTime("starting in 20 min", NOW);
  assert.equal(t?.iso, "2026-10-27T20:20:00.000Z");
});

// captures
test("a capture carries the quote verbatim, the code, and the urgency", () => {
  const c = hearCapture("the code FLASH-50 expires in 10 minutes", { now: NOW });
  assert.equal(c.quote, "the code FLASH-50 expires in 10 minutes");
  assert.equal(c.code, "FLASH-50");
  assert.equal(c.expiry?.minutes, 10);
  assert.equal(c.status, "pending");
  assert.equal(captureSubject(c), "code FLASH-50 (expires in ~10 min)");
});

test("hurry words outrank supply scarcity in the subject", () => {
  const c = hearCapture("the code SAVE20 is limited so get yours quickly", { now: NOW });
  assert.equal(c.scarcityKind, "supply");
  assert.equal(captureSubject(c), "code SAVE20 (hurry)"); // the words said hurry
});

test("a code without words is refused", () => {
  assert.throws(() => hearCapture("   "), /nothing is invented/);
});

test("extractCode is honest about what is code-shaped", () => {
  assert.equal(extractCode("use FLASH-50 today"), "FLASH-50");
  assert.equal(extractCode("there is no code here"), undefined);
});
