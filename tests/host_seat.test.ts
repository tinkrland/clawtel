import assert from "node:assert/strict";
import test from "node:test";
import { BrowserHostControls, SelectorMismatch } from "../hosting/platforms/browser-controls.ts";
import { ZOOM_HOST_SELECTORS, admitExpression, muteExpression, removeExpression, parseProbe, shareStartExpression } from "../hosting/platforms/zoom-host.ts";

const fakeSession = (answers: Record<string, unknown>) => {
  const asked: string[] = [];
  return {
    asked,
    evaluate: async <T>(expr: string): Promise<T> => {
      asked.push(expr);
      // probe answers first, then the act by its shape
      if (expr.includes("waitingRows:")) return answers.probe as T;
      if (expr.includes("Admit") || expr.includes("admitButton")) return answers.admit as T;
      if (/mute/i.test(expr) && expr.includes("menuItem")) return answers.mute as T;
      if (/remove/i.test(expr) && expr.includes("confirmRemove")) return answers.remove as T;
      if (/stop shar/i.test(expr) || expr.includes("stopButton")) return answers.stop as T;
      return (answers.share ?? { clicked: true }) as T;
    },
  };
};

const healthyProbe = { waitingRows: 2, participantRows: 1, shareButton: true, stopShareButton: false };

test("a healthy probe admits, and the act lands", async () => {
  const session = fakeSession({ probe: healthyProbe, admit: { found: 1, clicked: true } });
  const controls = new BrowserHostControls(session);
  assert.equal(await controls.admit("Ada Lovelace"), true);
  // probed first, then acted: a blind click is the thing this prevents
  assert.equal(session.asked.length, 2);
});

test("a pack that does not fit refuses before any click", async () => {
  const empty = { waitingRows: 0, participantRows: 0, shareButton: false, stopShareButton: false };
  const session = fakeSession({ probe: empty, admit: { found: 1, clicked: true } });
  const controls = new BrowserHostControls(session);
  await assert.rejects(() => controls.admit("Ada"), SelectorMismatch);
  assert.equal(session.asked.length, 1); // the probe, and nothing else
});

test("an ambiguous name is refused, never guessed", async () => {
  const session = fakeSession({ probe: healthyProbe, admit: { found: 2, clicked: false, reason: "more than one row matched that name" } });
  const controls = new BrowserHostControls(session);
  await assert.rejects(() => controls.admit("Sam"), /more than one row matched/);
});

test("sharing is allowed while panels are hidden, because sharing hides them", async () => {
  const empty = { waitingRows: 0, participantRows: 0, shareButton: true, stopShareButton: false };
  const session = fakeSession({ probe: empty, share: { clicked: true } });
  const controls = new BrowserHostControls(session);
  assert.equal(await controls.startShare(), true);
  // no probe at all for a share: the panels it would look for are hidden
  // by the very sharing it is asking about
  assert.equal(session.asked.length, 1);
  assert.match(session.asked[0], /share control/);
});

test("a share control that is not on the page is a refusal, not a quiet false", async () => {
  const empty = { waitingRows: 0, participantRows: 0, shareButton: false, stopShareButton: false };
  const session = fakeSession({ probe: empty, share: { clicked: false, reason: "no share control on this screen" } });
  const controls = new BrowserHostControls(session);
  await assert.rejects(() => controls.startShare(), /no share control on this screen/);
});

test("the expressions carry the name and stay scoped to their panel", () => {
  const admit = admitExpression(ZOOM_HOST_SELECTORS, "Ada Lovelace");
  assert.match(admit, /Ada Lovelace/);
  assert.match(admit, /Waiting Room/);
  assert.match(muteExpression(ZOOM_HOST_SELECTORS, "Bob"), /\/mute\/i/);
  assert.match(removeExpression(ZOOM_HOST_SELECTORS, "Bob"), /\/remove\/i/);
  assert.match(shareStartExpression(ZOOM_HOST_SELECTORS), /Share|share/);
});

test("the probe is only ok on real evidence", () => {
  assert.equal(parseProbe({ waitingRows: 0, participantRows: 3 }).ok, true);
  assert.equal(parseProbe({ shareButton: true }).ok, true);
  const nothing = parseProbe({});
  assert.equal(nothing.ok, false);
  assert.match(nothing.reason ?? "", /does not fit this client build/);
});
