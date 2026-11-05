// the listing: the event copy, rendered and never published.
//
// lu.ma (and every other event page) wants a name, a blurb, a time and
// an agenda. hosting renders that copy from the agenda the night will
// actually run, so the page and the night cannot drift apart. posting
// stays with the human: there is no public event-creation api to call,
// and inventing one would be a lie in the shape of a feature.

import type { Agenda } from "./agenda.ts";

export interface EventDraft {
  title: string;
  blurb: string;
  agendaLines: string[];
  durationMinutes: number;
  startsAt?: string;
  timezone?: string;
  hostName?: string;
  joinLink?: string;
}

export interface ListingResult {
  draft: EventDraft;
  publish: { ok: false; reason: string };
}

export interface ListingOptions {
  hostName?: string;
  startsAt?: string;
  timezone?: string;
  joinLink?: string;
  blurb?: string;
}

function describe(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function renderEventDraft(agenda: Agenda, opts: ListingOptions = {}): ListingResult {
  const agendaLines = agenda.segments.map((seg) => {
    const shape = seg.kind === "demo" && seg.demo ? ` (${seg.demo.name}, live in a browser)` : "";
    return `${seg.minutes} min. ${seg.title}${shape}`;
  });

  const blurb =
    opts.blurb?.trim() ||
    [
      `${agenda.title}. ${describe(agenda.totalMinutes)} of ${agenda.segments
        .map((s) => s.kind)
        .filter((kind, i, all) => all.indexOf(kind) === i)
        .join(", ")}.`,
      "the demo runs in a real browser, so you see the product as it behaves, not as it was edited.",
    ].join(" ");

  const draft: EventDraft = {
    title: agenda.title,
    blurb,
    agendaLines,
    durationMinutes: agenda.totalMinutes,
  };
  if (opts.hostName) draft.hostName = opts.hostName;
  if (opts.startsAt) draft.startsAt = opts.startsAt;
  if (opts.timezone) draft.timezone = opts.timezone;
  if (opts.joinLink) draft.joinLink = opts.joinLink;

  return {
    draft,
    publish: {
      ok: false,
      reason:
        "publishing is the host's own action: this renders the copy to paste, it never posts an event. no public event-creation api is documented for lu.ma; treat the payload as copy, not a publish path.",
    },
  };
}

/**
 * the shape lu.ma's editor asks for, filled from the draft. the host
 * pastes this. fields with no honest value are left out rather than
 * guessed (a wrong timezone is worse than an empty one).
 */
export function luMaPayload(draft: EventDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: draft.title,
    description: [draft.blurb, "", ...draft.agendaLines].join("\n"),
  };
  if (draft.startsAt) payload.start_at = draft.startsAt;
  if (draft.durationMinutes) payload.duration_minutes = draft.durationMinutes;
  if (draft.timezone) payload.timezone = draft.timezone;
  if (draft.hostName) payload.host = draft.hostName;
  return payload;
}
