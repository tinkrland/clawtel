// the hosting session: the night, as a state machine with a clock.
//
// hosting is discretionary: the host decides when to move on, whether to
// take one more question, whether to cut a demo short. so the machine
// never advances by itself beyond its own segment clock, and every
// transition is an explicit, logged act.
//
// lobby -> live -> (paused) -> closed

import type { Agenda, Segment } from "./agenda.ts";

export type HostPhase = "lobby" | "live" | "paused" | "closed";

export type HostEventKind = "started" | "segment" | "paused" | "resumed" | "advanced" | "ended" | "closed";

export interface HostLogEntry {
  at: number;
  event: HostEventKind;
  detail: string;
}

export interface HostGuest {
  id: string;
  name?: string;
  admittedAt?: number;
}

export interface HostState {
  id: string;
  meetingId: string;
  agenda: Agenda;
  phase: HostPhase;
  index: number;
  segmentStartedAt: number | null;
  updatedAt: number;
  guests: HostGuest[];
  log: HostLogEntry[];
}

export function createHosting(input: {
  id: string;
  meetingId: string;
  agenda: Agenda;
  now: number;
}): HostState {
  return {
    id: input.id,
    meetingId: input.meetingId,
    agenda: input.agenda,
    phase: "lobby",
    index: 0,
    segmentStartedAt: null,
    updatedAt: input.now,
    guests: [],
    log: [{ at: input.now, event: "started", detail: "the room is in lobby, waiting on the host" }],
  };
}

export function currentSegment(state: HostState): Segment | null {
  return state.agenda.segments[state.index] ?? null;
}

/** how long is left in this segment, given a clock. null in lobby. */
export function remainingMs(state: HostState, now: number): number | null {
  const segment = currentSegment(state);
  if (state.phase !== "live" || !segment || state.segmentStartedAt === null) return null;
  const left = segment.minutes * 60_000 - (now - state.segmentStartedAt);
  return Math.max(0, left);
}

function enterSegment(state: HostState, index: number, now: number, event: HostEventKind, detail: string): HostState {
  const segment = state.agenda.segments[index];
  return {
    ...state,
    index,
    segmentStartedAt: now,
    updatedAt: now,
    log: [...state.log, { at: now, event, detail: `${segment.kind}: ${detail}` }],
  };
}

export function startHosting(state: HostState, now: number): HostState {
  if (state.phase === "live") return state;
  if (state.phase === "closed") return state;
  const first = state.agenda.segments[0];
  return {
    ...enterSegment({ ...state, phase: "live" }, 0, now, "segment", `opening "${first.title}"`),
  };
}

/**
 * the clock. advances only when a segment's minutes have actually gone
 * by, and lands in lobby-style honesty at the end: closed, with a log,
 * not silently idle.
 */
export function tickHosting(state: HostState, now: number): HostState {
  if (state.phase !== "live" || state.segmentStartedAt === null) return state;
  let next = state;
  // a long gap (the host walked away) should not loop forever
  for (let guard = 0; guard < state.agenda.segments.length + 1; guard += 1) {
    const segment = currentSegment(next);
    if (!segment) break;
    const elapsed = now - (next.segmentStartedAt ?? now);
    if (elapsed < segment.minutes * 60_000) break;
    const isLast = next.index === next.agenda.segments.length - 1;
    if (isLast) {
      return {
        ...next,
        phase: "closed",
        updatedAt: now,
        log: [...next.log, { at: now, event: "ended", detail: "the night ran its course" }],
      };
    }
    next = enterSegment(next, next.index + 1, now, "segment", `time is up, moving to "${next.agenda.segments[next.index + 1].title}"`);
  }
  return next;
}

/** the host decides: move on before the clock says so. */
export function advanceHosting(state: HostState, now: number, reason = "the host moved on"): HostState {
  if (state.phase !== "live" && state.phase !== "paused") return state;
  const isLast = state.index >= state.agenda.segments.length - 1;
  if (isLast) {
    return { ...state, phase: "closed", updatedAt: now, log: [...state.log, { at: now, event: "ended", detail: reason }] };
  }
  const target = state.index + 1;
  return enterSegment({ ...state, phase: "live" }, target, now, "advanced", `${reason}, now "${state.agenda.segments[target].title}"`);
}

/** step back one segment without restarting the night. */
export function backHosting(state: HostState, now: number): HostState {
  if (state.phase !== "live" && state.phase !== "paused") return state;
  if (state.index === 0) return state;
  const target = state.index - 1;
  return enterSegment({ ...state, phase: "live" }, target, now, "advanced", `stepped back to "${state.agenda.segments[target].title}"`);
}

export function pauseHosting(state: HostState, now: number): HostState {
  if (state.phase !== "live") return state;
  return { ...state, phase: "paused", updatedAt: now, log: [...state.log, { at: now, event: "paused", detail: "held" }] };
}

export function resumeHosting(state: HostState, now: number): HostState {
  if (state.phase !== "paused") return state;
  // time held is not time spent: the segment's remaining minutes resume
  const held = state.updatedAt;
  const segment = currentSegment(state);
  const shift = segment && state.segmentStartedAt !== null ? now - held : 0;
  return {
    ...state,
    phase: "live",
    segmentStartedAt: state.segmentStartedAt === null ? now : state.segmentStartedAt + shift,
    updatedAt: now,
    log: [...state.log, { at: now, event: "resumed", detail: "back on" }],
  };
}

export function closeHosting(state: HostState, now: number, reason = "the host closed the room"): HostState {
  if (state.phase === "closed") return state;
  return { ...state, phase: "closed", updatedAt: now, log: [...state.log, { at: now, event: "closed", detail: reason }] };
}

export function admitGuest(state: HostState, guest: { id: string; name?: string }, now: number): HostState {
  if (state.guests.some((g) => g.id === guest.id)) return state;
  return {
    ...state,
    updatedAt: now,
    guests: [...state.guests, { id: guest.id, name: guest.name, admittedAt: now }],
  };
}
