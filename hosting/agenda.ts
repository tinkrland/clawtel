// the agenda: what happens on the night, in minutes.
//
// a hosting night is segments, not a script. each segment declares its
// kind, how long it may run, and (for a demo) the browser script that
// fills it. validation is strict here so a bad plan fails at the desk
// instead of in front of guests.

import { parseDemo, type DemoScript } from "./demo.ts";

export type SegmentKind = "welcome" | "talk" | "demo" | "qa" | "close";

export const SEGMENT_KINDS: SegmentKind[] = ["welcome", "talk", "demo", "qa", "close"];

export interface Segment {
  kind: SegmentKind;
  title: string;
  minutes: number;
  demo?: DemoScript;
  notes?: string;
}

export interface Agenda {
  title: string;
  segments: Segment[];
  totalMinutes: number;
}

export type ParsedAgenda = { ok: true; agenda: Agenda } | { ok: false; reason: string };

const MAX_TOTAL_MINUTES = 240;

export function parseAgenda(input: unknown): ParsedAgenda {
  if (!input || typeof input !== "object") return { ok: false, reason: "an agenda needs an object with a title and segments" };
  const raw = input as Partial<Agenda>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { ok: false, reason: "an agenda needs a title" };
  if (!Array.isArray(raw.segments) || raw.segments.length === 0) {
    return { ok: false, reason: "an agenda needs at least one segment" };
  }
  if (raw.segments.length > 20) return { ok: false, reason: "an agenda is capped at 20 segments" };

  const segments: Segment[] = [];
  for (const [i, seg] of raw.segments.entries()) {
    const at = `segment ${i + 1}`;
    if (!seg || typeof seg !== "object") return { ok: false, reason: `${at} is not an object` };
    const kind = seg.kind;
    if (!SEGMENT_KINDS.includes(kind)) {
      return { ok: false, reason: `${at} has an unknown kind "${String(kind)}" (expected ${SEGMENT_KINDS.join(", ")})` };
    }
    const minutes = Number(seg.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 90) {
      return { ok: false, reason: `${at} needs minutes between 1 and 90` };
    }
    const name = typeof seg.title === "string" && seg.title.trim() ? seg.title.trim() : kind;

    const out: Segment = { kind, title: name, minutes: Math.round(minutes) };
    if (typeof seg.notes === "string" && seg.notes.trim()) out.notes = seg.notes.trim();

    if (kind === "demo") {
      // a demo segment without a runnable script is an empty promise
      const parsed = parseDemo(seg.demo);
      if (!parsed.ok) return { ok: false, reason: `${at} (demo) needs a valid script: ${parsed.reason}` };
      out.demo = parsed.script;
      if (out.minutes < 2) return { ok: false, reason: `${at} (demo) needs at least 2 minutes; a browser walkthrough is not a 60 second slot` };
    }
    segments.push(out);
  }

  if (segments[0].kind !== "welcome") {
    return { ok: false, reason: "the first segment must be a welcome: people arrive before anything is shown" };
  }
  if (segments[segments.length - 1].kind !== "close") {
    return { ok: false, reason: "the last segment must be a close: a night that does not end keeps everyone in the room" };
  }

  const totalMinutes = segments.reduce((sum, s) => sum + s.minutes, 0);
  if (totalMinutes > MAX_TOTAL_MINUTES) {
    return { ok: false, reason: `the agenda runs ${totalMinutes} minutes; the cap is ${MAX_TOTAL_MINUTES}` };
  }

  return { ok: true, agenda: { title, segments, totalMinutes } };
}
