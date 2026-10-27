import { test } from "node:test";
import assert from "node:assert/strict";
import { answerFromTranscript } from "../capabilities/questions/answers.ts";
import { citationTime, findSegments, storeTranscript, type TranscriptSegment } from "../capabilities/transcript/store.ts";

const segments: TranscriptSegment[] = [
  { startMs: 0, speaker: "host", text: "welcome everyone to the october webinar" },
  { startMs: 65000, speaker: "host", text: "the promo code FLASH-50 expires in 10 minutes" },
  { startMs: 240000, speaker: "host", text: "our pricing tiers start at nine dollars a month" },
  { startMs: 600000, speaker: "host", text: "to redeem, paste the code at checkout and it zeroes the total" },
];

test("citations are h:mm:ss", () => {
  assert.equal(citationTime(0), "0:00:00");
  assert.equal(citationTime(65000), "0:01:05");
  assert.equal(citationTime(3665000), "1:01:05");
});

test("a transcript stores verbatim and sorts by time", () => {
  const t = storeTranscript([...segments].reverse());
  assert.equal(t.segments[0].text, "welcome everyone to the october webinar");
  assert.equal(t.segments[0].startMs, 0);
  // verbatim: stored words are never rewritten
  assert.ok(t.segments.some((s) => s.text.includes("FLASH-50")));
});

test("find scores by content words and cites the time", () => {
  const t = storeTranscript(segments);
  const hits = findSegments(t, "when does the promo code expire");
  assert.ok(hits.length > 0);
  assert.equal(hits[0].segment.text, "the promo code FLASH-50 expires in 10 minutes");
  assert.equal(hits[0].citation, "0:01:05");
});

test("a question is answered with the segment verbatim, or not at all", () => {
  const t = storeTranscript(segments);
  const a = answerFromTranscript("what are the pricing tiers", t);
  assert.equal(a.known, true);
  if (a.known) {
    assert.equal(a.answer, "our pricing tiers start at nine dollars a month");
    assert.equal(a.citation, "0:04:00");
    assert.equal(a.speaker, "host");
  }
});

test("an unanswerable question says so, never a guess", () => {
  const t = storeTranscript(segments);
  const a = answerFromTranscript("what is the capital of france", t);
  assert.equal(a.known, false);
  if (!a.known) assert.match(a.reason, /never a guess/);
});

test("one shared word is coincidence, not knowledge", () => {
  const t = storeTranscript(segments);
  const a = answerFromTranscript("does the code work with the turkey sandwich discount at the zoo", t);
  assert.equal(a.known, false);
});
