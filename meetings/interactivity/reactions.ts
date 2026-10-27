// reactions: the agent reacts by the platform's own names. the sets are
// verified against each platform's documented control names; anything
// else is refused, never approximated. the actuation rides the page
// seam (the hosted sdk page implements it on the platform's own call)
// with the dom tray as the meet fallback. pure names + honest refuse
// live here; the in-page expressions live with the join engine's
// session contract.

export const MEET_REACTIONS = [
  "thumbs up",
  "heart",
  "clapping hands",
  "joy",
  "surprised",
  "thinking",
  "cry",
  "disappointed",
  "party popper",
];

// zoom's web sdk reaction names (the sdk's own set; the hosted page
// normalizes the same way)
export const ZOOM_REACTIONS = [
  "clap",
  "thumbs up",
  "heart",
  "laugh",
  "surprised",
  "celebration",
];

export function reactionsFor(platform: string): string[] {
  switch (platform) {
    case "meet":
      return MEET_REACTIONS;
    case "zoom":
      return ZOOM_REACTIONS;
    default:
      return [];
  }
}

export function normalizeReaction(platform: string, emoji: string): string | null {
  const e = (emoji || "").trim().toLowerCase();
  return reactionsFor(platform).includes(e) ? e : null;
}

// the in-page expression the join engine evaluates to send a reaction.
// the seam first (the hosted sdk page), the dom tray as the meet
// fallback, a host-disabled button is an honest no, never a forced
// click. unknown reactions are refused by the caller before this is
// ever built.
export function reactionExpression(platform: string, reaction: string): string {
  const r = JSON.stringify(reaction);
  if (platform === "zoom") {
    return `
      (() => {
        if (typeof window.clawtelReact === "function") {
          return window.clawtelReact(${r}) ? "seam" : "seam-refused";
        }
        return "no-seam";
      })()
    `;
  }
  return `
    (() => {
      if (typeof window.clawtelReact === "function") {
        return window.clawtelReact(${r}) ? "seam" : "seam-refused";
      }
      const trayBtn = [...document.querySelectorAll('[aria-label*="Send a reaction" i]')]
        .find((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true");
      if (!trayBtn) return "no-reactions";
      trayBtn.click();
      const emojiBtns = [...document.querySelectorAll("[aria-label]")].filter((b) => {
        const label = (b.getAttribute("aria-label") || "").trim().toLowerCase();
        return label === ${r} || label.includes(${r});
      });
      if (!emojiBtns.length) return "no-emoji";
      emojiBtns[0].click();
      return "reacted";
    })()
  `;
}

export function reactionOutcome(value: unknown): boolean {
  // seam-refused, no-reactions, no-emoji, no-seam are all honest nos
  if (value === "seam-refused") return false;
  return value === "seam" || value === "reacted";
}
