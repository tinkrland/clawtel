// raise hand: the goal state is hand up. the rules, verified the hard
// way, live here as pure decisions:
//
// - raising an already-raised hand is a success, no second click
// - the lower button is NEVER clicked by a raise request, so the agent
//   cannot put its own hand down by asking for it up
// - lowering happens only when explicitly asked AND the hand is up
// - a host-disabled control is an honest no, never a forced click

export type HandAction = "raise" | "lower";
export type HandDecision =
  | { outcome: "raised"; click: "raise" }
  | { outcome: "raised"; click: "none" } // already raised: success, no click
  | { outcome: "lowered"; click: "lower" }
  | { outcome: "lowered"; click: "none" } // already down: success, no click
  | { outcome: "refused"; click: "none"; reason: string };

export function decideHand(
  action: HandAction,
  state: { raised: boolean; disabled: boolean },
): HandDecision {
  if (state.disabled) {
    return { outcome: "refused", click: "none", reason: "the platform disabled the hand control" };
  }
  if (action === "raise") {
    return state.raised
      ? { outcome: "raised", click: "none" }
      : { outcome: "raised", click: "raise" };
  }
  return state.raised
    ? { outcome: "lowered", click: "lower" }
    : { outcome: "lowered", click: "none" };
}

// the in-page expression the join engine evaluates. the seam first
// (the hosted sdk page rides the platform's own hand call), the dom
// toggle as the meet fallback. the lower button is only ever clicked
// by an explicit lower.
export function handExpression(action: HandAction): string {
  if (action === "raise") {
    return `
      (() => {
        if (typeof window.clawtelRaiseHand === "function") {
          return window.clawtelRaiseHand() ? "seam" : "seam-refused";
        }
        const cands = [...document.querySelectorAll("[aria-label]")];
        const lower = cands.find((b) => /lower hand/i.test(b.getAttribute("aria-label") || ""));
        if (lower) return "already-raised";
        const raise = cands.find(
          (b) =>
            /raise hand/i.test(b.getAttribute("aria-label") || "") &&
            !b.disabled &&
            b.getAttribute("aria-disabled") !== "true",
        );
        if (!raise) return "no-hand";
        raise.click();
        return "raised";
      })()
    `;
  }
  return `
    (() => {
      if (typeof window.clawtelLowerHand === "function") {
        return window.clawtelLowerHand() ? "seam" : "seam-refused";
      }
      const cands = [...document.querySelectorAll("[aria-label]")];
      const lower = cands.find(
        (b) =>
          /lower hand/i.test(b.getAttribute("aria-label") || "") &&
          !b.disabled &&
          b.getAttribute("aria-disabled") !== "true",
      );
      if (!lower) return "already-down";
      lower.click();
      return "lowered";
    })()
  `;
}

export function handOutcome(value: unknown): boolean {
  if (value === "seam-refused") return false;
  return (
    value === "seam" ||
    value === "raised" ||
    value === "lowered" ||
    value === "already-raised" ||
    value === "already-down"
  );
}
