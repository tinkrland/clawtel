// hosting sessions live in memory, like every other store here: a
// database lane is a buyer decision, not a default.

import { parseAgenda, type Agenda } from "./agenda.ts";
import { createHosting, type HostState } from "./session.ts";

const HOSTINGS = new Map<string, HostState>();
let counter = 0;

export function createHostingSession(input: {
  meetingId: string;
  agenda: unknown;
  now?: number;
}): { ok: true; state: HostState } | { ok: false; reason: string } {
  const parsed = parseAgenda(input.agenda);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  counter += 1;
  const id = `host_${counter}`;
  const state = createHosting({
    id,
    meetingId: input.meetingId,
    agenda: parsed.agenda as Agenda,
    now: input.now ?? Date.now(),
  });
  HOSTINGS.set(id, state);
  return { ok: true, state };
}

export function getHosting(id: string): HostState | undefined {
  return HOSTINGS.get(id);
}

export function listHostings(): HostState[] {
  return [...HOSTINGS.values()];
}

export function putHosting(state: HostState): HostState {
  HOSTINGS.set(state.id, state);
  return state;
}

/** tests only: forget everything, so ids do not leak between cases. */
export function resetHostings(): void {
  HOSTINGS.clear();
  counter = 0;
}
