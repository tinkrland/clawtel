import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEET_REACTIONS,
  normalizeReaction,
  reactionOutcome,
  reactionsFor,
  ZOOM_REACTIONS,
} from "../meetings/interactivity/reactions.ts";
import { decideHand, handOutcome } from "../meetings/interactivity/hand.ts";
import { sharerFromViewerText } from "../meetings/interactivity/screensharer.ts";

// reactions: the platform's own names, anything else refused
test("meet reactions are the tray's documented names", () => {
  assert.deepEqual(MEET_REACTIONS, [
    "thumbs up", "heart", "clapping hands", "joy", "surprised",
    "thinking", "cry", "disappointed", "party popper",
  ]);
});

test("reactions are matched case-insensitively and refused when unknown", () => {
  assert.equal(normalizeReaction("meet", "Party Popper"), "party popper");
  assert.equal(normalizeReaction("meet", "fire"), null);
  assert.equal(normalizeReaction("meet", ""), null);
  assert.equal(normalizeReaction("zoom", "Clap"), "clap");
  assert.equal(normalizeReaction("zoom", "party popper"), null);
});

test("platforms without a reaction set refuse everything", () => {
  assert.deepEqual(reactionsFor("whatsapp_call"), []);
  assert.equal(normalizeReaction("whatsapp_call", "thumbs up"), null);
});

test("the zoom set is the sdk's own names", () => {
  assert.ok(ZOOM_REACTIONS.includes("celebration"));
});

test("reaction outcomes: seam and reacted are yes, everything else an honest no", () => {
  assert.equal(reactionOutcome("seam"), true);
  assert.equal(reactionOutcome("reacted"), true);
  assert.equal(reactionOutcome("seam-refused"), false);
  assert.equal(reactionOutcome("no-reactions"), false);
  assert.equal(reactionOutcome("no-emoji"), false);
});

// raise hand: the goal state is hand up
test("raising a lowered hand clicks raise", () => {
  assert.deepEqual(decideHand("raise", { raised: false, disabled: false }), { outcome: "raised", click: "raise" });
});

test("raising an already-raised hand is a success with no click", () => {
  assert.deepEqual(decideHand("raise", { raised: true, disabled: false }), { outcome: "raised", click: "none" });
});

test("the lower button is only ever clicked by an explicit lower", () => {
  assert.deepEqual(decideHand("lower", { raised: true, disabled: false }), { outcome: "lowered", click: "lower" });
  assert.deepEqual(decideHand("lower", { raised: false, disabled: false }), { outcome: "lowered", click: "none" });
});

test("a host-disabled control is an honest refusal, never a forced click", () => {
  const d = decideHand("raise", { raised: false, disabled: true });
  assert.equal(d.outcome, "refused");
  if (d.outcome === "refused") assert.equal(d.click, "none");
});

test("hand outcomes: already-raised and already-down are successes", () => {
  assert.equal(handOutcome("seam"), true);
  assert.equal(handOutcome("raised"), true);
  assert.equal(handOutcome("already-raised"), true);
  assert.equal(handOutcome("already-down"), true);
  assert.equal(handOutcome("seam-refused"), false);
  assert.equal(handOutcome("no-hand"), false);
});

// screensharer awareness: the viewer indicators, never a guess
test("the zoom viewer banner names the sharer", () => {
  assert.equal(sharerFromViewerText("You are viewing Jane's screen"), "Jane");
});

test("the meet presenting banner names the sharer", () => {
  assert.equal(sharerFromViewerText("Jane Smith is presenting"), "Jane Smith");
});

test("no indicator means nobody, null not a guess", () => {
  assert.equal(sharerFromViewerText("nothing here"), null);
  assert.equal(sharerFromViewerText(""), null);
});
