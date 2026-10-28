// the meeting: what the agent is attending, in states. a meeting is
// born planned, joins, participates, takes home, and ends. transitions
// that skip states are refused: a meeting that never joined cannot
// take home. the store is in memory; a database lane is a buyer
// decision and this file is honest about it.

import type { MeetingPlatform } from "./joining/resolver.ts";

export type MeetingStatus =
  | "planned"
  | "joining"
  | "in_meeting"
  | "take_home"
  | "done";

export interface Meeting {
  id: string;
  title: string;
  platform: MeetingPlatform;
  joinUrl: string;
  meetingNumber?: string;
  passcode?: string;
  code?: string;
  channel?: string;
  surface?: string;
  startTime?: string;
  joinDelayMinutes: number;
  status: MeetingStatus;
  // the browser session once joined, when a lane is open. honest:
  // absent means the meeting was never joined in this process.
  sessionId?: string;
  createdAt: string;
}

const ORDER: MeetingStatus[] = [
  "planned",
  "joining",
  "in_meeting",
  "take_home",
  "done",
];

export function canTransition(from: MeetingStatus, to: MeetingStatus): boolean {
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  return b === a + 1;
}

let nextId = 1;
const meetings = new Map<string, Meeting>();

export function createMeeting(
  data: Omit<Meeting, "id" | "status" | "createdAt">,
): Meeting {
  const meeting: Meeting = {
    ...data,
    id: `mtg_${nextId++}`,
    status: "planned",
    createdAt: new Date().toISOString(),
  };
  meetings.set(meeting.id, meeting);
  return meeting;
}

export function getMeeting(id: string): Meeting | undefined {
  return meetings.get(id);
}

export function listMeetings(): Meeting[] {
  return [...meetings.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function transitionMeeting(
  id: string,
  to: MeetingStatus,
): Meeting {
  const meeting = meetings.get(id);
  if (!meeting) throw new Error(`no meeting ${id}`);
  if (!canTransition(meeting.status, to)) {
    throw new Error(
      `a meeting cannot go from ${meeting.status} to ${to}. states are earned in order.`,
    );
  }
  meeting.status = to;
  return meeting;
}

export function getSession(id: string): string | undefined {
  return getMeeting(id)?.sessionId;
}

export function clearSession(id: string): void {
  const meeting = getMeeting(id);
  if (meeting) delete meeting.sessionId;
}

export function setSession(id: string, sessionId: string): void {
  const meeting = meetings.get(id);
  if (!meeting) throw new Error(`no meeting ${id}`);
  if (meeting.status !== "joining" && meeting.status !== "in_meeting") {
    throw new Error(`a session attaches to a joining or in-meeting meeting, not ${meeting.status}`);
  }
  meeting.sessionId = sessionId;
}
