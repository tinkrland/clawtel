// the capture: hearing a code is a capture, not a copy. the words
// matter: what was offered, how long it lasts, whether supply is
// limited. a capture carries the quote verbatim, the expiry window
// and the scarcity read from the same utterance, never a paraphrase.
// a code confirmed redeemed is a receipt; a code heard is a pending
// capture. pure logic plus an in-memory store; a database lane is a
// buyer decision.

import { extractExpiryWindow, type ExpiryWindow } from "./expiry_window.ts";
import { detectScarcity, scarcityKind, type ScarcityResult } from "./scarcity.ts";

export interface Capture {
  id: string;
  meetingId?: string;
  // the words that carried the offer, verbatim
  quote: string;
  // the code itself when the words name one (may be absent: an offer
  // without a code is still a capture)
  code?: string;
  heardAt: string;
  expiry: ExpiryWindow | null;
  scarcity: ScarcityResult;
  scarcityKind: "none" | "time" | "people" | "supply";
  status: "pending" | "redeemed" | "expired";
}

const CODE_RE = /\b([A-Z0-9]{4,}(?:[-_][A-Z0-9]{2,})+|[A-Z]{2,}[-_]?[A-Z0-9]{2,}(?:[-_][A-Z0-9]{2,})*)\b/;

// the code-shaped token in the quote, when one exists. honest: a
// mixed-case word is not a code, a long url is not a code; absent
// means the words carried no code token.
export function extractCode(quote: string): string | undefined {
  const m = (quote || "").match(CODE_RE);
  return m ? m[1] : undefined;
}

export function hearCapture(
  quote: string,
  opts: { meetingId?: string; meetingEndsAt?: string | Date | null; heardAt?: Date; now?: Date } = {},
): Capture {
  if (!quote || !quote.trim()) {
    throw new Error("a capture needs the words that were said. nothing is invented.");
  }
  const now = opts.now ?? opts.heardAt ?? new Date();
  const scarcity = detectScarcity(quote);
  return {
    id: `cap_${nextId++}`,
    meetingId: opts.meetingId,
    quote: quote.trim(),
    code: extractCode(quote),
    heardAt: now.toISOString(),
    expiry: extractExpiryWindow(quote, { now, meetingEndsAt: opts.meetingEndsAt }),
    scarcity,
    scarcityKind: scarcityKind(scarcity),
    status: "pending",
  };
}

let nextId = 1;
const captures = new Map<string, Capture>();

export function recordCapture(capture: Capture): Capture {
  captures.set(capture.id, capture);
  return capture;
}

export function listCaptures(meetingId?: string): Capture[] {
  return [...captures.values()]
    .filter((c) => !meetingId || c.meetingId === meetingId)
    .sort((a, b) => a.heardAt.localeCompare(b.heardAt));
}

export function markRedeemed(id: string): Capture {
  const capture = captures.get(id);
  if (!capture) throw new Error(`no capture ${id}`);
  if (capture.status !== "pending") {
    throw new Error(`only a pending capture can be redeemed. ${id} is ${capture.status}`);
  }
  capture.status = "redeemed";
  return capture;
}

// the notify subject line: the urgency rides in front, from the words
export function captureSubject(capture: Capture): string {
  const bits: string[] = [];
  if (capture.code) bits.push(`code ${capture.code}`);
  if (capture.expiry?.kind === "minutes" && capture.expiry.minutes) {
    bits.push(`(expires in ~${capture.expiry.minutes} min)`);
  } else if (capture.expiry?.kind === "clock" && capture.expiry.expiresAt) {
    bits.push(`(expires at ${new Date(capture.expiry.expiresAt).toISOString()})`);
  } else if (capture.expiry?.kind === "hurry") {
    bits.push("(hurry)");
  } else if (capture.scarcityKind === "supply" && !capture.expiry) {
    bits.push("(limited supply)");
  } else if (capture.scarcityKind === "people") {
    bits.push("(limited count)");
  }
  return bits.length ? bits.join(" ") : "a code was heard";
}
