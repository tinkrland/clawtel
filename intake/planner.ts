// intake: a calendar event (or any event with a url) becomes a meeting
// plan. the plan carries the platform resolution and the join delay.
// calendar source lanes (google, microsoft, apple, notion, cal.com,
// zcal) are contracts: a source without credentials stays closed.

import { createMeeting, type Meeting } from "../meetings/meeting.ts";
import { joinDelayMinutes, resolveJoinUrl, type ResolvedMeeting } from "../meetings/joining/resolver.ts";

export interface CalendarEvent {
  title: string;
  url?: string;
  startTime?: string;
  joinDelayMinutes?: number;
}

export interface CalendarLane {
  readonly lane: string;
  isAvailable(): boolean;
  listEvents(): Promise<CalendarEvent[]>;
}

export class ClosedCalendarLane implements CalendarLane {
  readonly lane: string;
  constructor(lane: string) {
    this.lane = lane;
  }
  isAvailable(): boolean {
    return false;
  }
  async listEvents(): Promise<CalendarEvent[]> {
    throw new Error(`${this.lane} lane is closed. bring credentials; nothing invents events.`);
  }
}

export const CALENDAR_LANES: Record<string, () => CalendarLane> = {
  google: () => new ClosedCalendarLane("google calendar"),
  microsoft: () => new ClosedCalendarLane("microsoft calendar"),
  apple: () => new ClosedCalendarLane("apple calendar"),
  notion: () => new ClosedCalendarLane("notion calendar"),
  calcom: () => new ClosedCalendarLane("cal.com"),
  zcal: () => new ClosedCalendarLane("zcal"),
};

export function calendarLaneAvailable(name: string): boolean {
  const factory = CALENDAR_LANES[name];
  return factory ? factory().isAvailable() : false;
}

// an event becomes a meeting plan. honest rules:
// - an event with no url is not a meeting the agent can attend: null,
//   with the reason, never a plan built on nothing.
// - an event whose url resolves to nothing is skipped the same way.
export function planFromEvent(event: CalendarEvent): Meeting | null {
  if (!event.url) return null;
  const resolved = resolveJoinUrl(event.url);
  if (!resolved) return null;
  return meetingFromResolved(event.title, resolved, event.startTime, event.joinDelayMinutes);
}

export function meetingFromResolved(
  title: string,
  resolved: ResolvedMeeting,
  startTime?: string,
  joinDelay?: number,
): Meeting {
  return createMeeting({
    title,
    platform: resolved.platform,
    joinUrl: resolved.joinUrl,
    meetingNumber: resolved.meetingNumber,
    passcode: resolved.passcode,
    code: resolved.code,
    channel: resolved.channel,
    surface: resolved.surface,
    startTime,
    joinDelayMinutes: joinDelayMinutes(joinDelay),
  });
}
