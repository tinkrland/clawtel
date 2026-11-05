// host controls: admitting, muting, sharing. the host's own hand.
//
// the default policy is "ask", because a room is not a public square:
// the human decides who comes in unless they have said otherwise. the
// seam is honest: an unwired platform reports closed rather than
// pretending a guest was admitted.

import type { SegmentKind } from "./agenda.ts";

export type AdmissionPolicy = "all" | "known" | "ask";
export type Admission = "admit" | "hold" | "refuse";

export interface GuestAsk {
  id: string;
  name?: string;
  known?: boolean;
  blocked?: boolean;
}

/**
 * blocked is refused regardless of policy (a host who blocked someone
 * meant it). "all" admits anyone not blocked; "known" admits only people
 * the host has met; "ask" holds everyone for the human to decide.
 */
export function decideAdmission(policy: AdmissionPolicy, guest: GuestAsk): Admission {
  if (!guest?.id) return "refuse";
  if (guest.blocked === true) return "refuse";
  if (policy === "all") return "admit";
  if (policy === "known") return guest.known === true ? "admit" : "hold";
  return "hold";
}

export interface HostControls {
  readonly platform: string;
  admit(guestId: string): Promise<boolean>;
  mute(guestId: string): Promise<boolean>;
  remove(guestId: string): Promise<boolean>;
  startShare(url?: string): Promise<boolean>;
  stopShare(): Promise<boolean>;
}

/** the honest default: no platform module means no hand. */
export class ClosedControls implements HostControls {
  readonly platform: string;
  constructor(platform = "closed") {
    this.platform = platform;
  }
  private refuse(what: string): never {
    throw new Error(`host controls are not wired for ${this.platform}: cannot ${what}. bring the platform module; nothing fakes a host hand.`);
  }
  async admit(_guestId: string): Promise<boolean> {
    this.refuse("admit a guest");
  }
  async mute(_guestId: string): Promise<boolean> {
    this.refuse("mute a guest");
  }
  async remove(_guestId: string): Promise<boolean> {
    this.refuse("remove a guest");
  }
  async startShare(_url?: string): Promise<boolean> {
    this.refuse("share the screen");
  }
  async stopShare(): Promise<boolean> {
    this.refuse("stop sharing");
  }
}

const SHARED_KINDS: SegmentKind[] = ["talk", "demo"];

/**
 * discretionary default: share while showing something, not while
 * talking to people face to face. a host can override per segment.
 */
export function shareForSegment(kind: SegmentKind, override?: boolean): boolean {
  if (override !== undefined) return override;
  return SHARED_KINDS.includes(kind);
}
