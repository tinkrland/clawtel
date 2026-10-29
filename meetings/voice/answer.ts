// the voice layer: what the agent says out loud, mid-call.
//
// the memory layer answers with citations. a citation id spoken aloud
// ("nine d nine six three f at zero two forty four") is noise in a
// meeting, so the spoken line keeps the sentence and moves the
// receipts into `sources`. nothing is dropped from the record: `full`
// carries the answer exactly as memory gave it.
//
// the same shape serves every platform: the meeting decides the scope,
// so a zoom answer is walled like a zoom answer.

import type { Meeting } from "../meeting.ts";
import type { MemoryScope } from "../../retelldb/client.ts";

export interface VoiceMemoryAnswer {
  ok: boolean;
  error?: string;
  answer?: string;
  citations?: string[];
  tool_calls?: unknown[];
  provider?: string;
  protocol?: string;
  steps?: number;
}

export interface MemoryLike {
  isAvailable(): boolean;
  answer(
    question: string,
    scope: MemoryScope,
    opts?: { maxSteps?: number },
  ): Promise<{ ok: boolean; data?: unknown; reason?: string }>;
}

export interface VoiceAnswer {
  ok: boolean;
  // what a tts lane should say. short, no ids, no markup.
  speak: string;
  // the answer as memory gave it, citations included
  full: string;
  // the receipts, moved out of the spoken line
  sources: string[];
  provider?: string;
  steps?: number;
  tools: string[];
  // honest: did we shorten it to fit a live turn
  truncated: boolean;
  reason?: string;
}

const CITATION = /\b[0-9a-f]{16}@[^\s,;)]+|\bmemory:[0-9a-f]{16}\b|\bartifact@[^\s,;)]+/gi;
const SPEAK_LIMIT = 420;

export function speakable(text: string): string {
  return (text || "")
    .replace(CITATION, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** cut to the first sentences that fit a live turn, never mid-word. */
export function fitForSpeech(text: string, limit = SPEAK_LIMIT): { line: string; truncated: boolean } {
  const clean = speakable(text);
  if (clean.length <= limit) return { line: clean, truncated: false };
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let line = "";
  for (const s of sentences) {
    if ((line + s).trim().length > limit) break;
    line = (line + " " + s).trim();
  }
  if (!line) line = clean.slice(0, limit).replace(/\s+\S*$/, "").trim();
  return { line, truncated: true };
}

/** the meeting decides the scope. an unknown platform is refused first. */
export function scopeForMeeting(meeting: Meeting, personaId: string, connectionId?: string | null) {
  const platform = String(meeting.platform || "").trim();
  if (!platform) {
    return { ok: false as const, reason: "this meeting has no platform, so a memory scope cannot be declared" };
  }
  const scope: MemoryScope = { persona_id: personaId, platform };
  if (connectionId) scope.connection_id = connectionId;
  return { ok: true as const, scope };
}

export interface AskOptions {
  personaId: string;
  memory: MemoryLike;
  connectionId?: string | null;
  maxSteps?: number;
}

export async function answerForCall(
  meeting: Meeting,
  question: string,
  opts: AskOptions,
): Promise<VoiceAnswer> {
  const empty: VoiceAnswer = { ok: false, speak: "", full: "", sources: [], tools: [], truncated: false };
  const q = (question || "").trim();
  if (!q) return { ...empty, reason: "an answer needs a question" };

  const scoped = scopeForMeeting(meeting, opts.personaId, opts.connectionId);
  if (!scoped.ok) return { ...empty, reason: scoped.reason };

  if (!opts.memory.isAvailable()) {
    return { ...empty, reason: "the memory lane is closed: RETELLDB_URL is unset" };
  }

  const res = await opts.memory.answer(q, scoped.scope, { maxSteps: opts.maxSteps });
  if (!res.ok) return { ...empty, reason: res.reason ?? "the memory service did not answer" };

  const data = (res.data ?? {}) as VoiceMemoryAnswer;
  if (data.ok === false) {
    return { ...empty, reason: data.error ?? "the agent refused this question" };
  }
  const full = String(data.answer ?? "").trim();
  const cites = Array.isArray(data.citations) ? data.citations.map(String) : [];
  const tools = Array.isArray(data.tool_calls)
    ? data.tool_calls.map((t) => String((t as { tool?: string })?.tool ?? "")).filter(Boolean)
    : [];

  if (!full) {
    return { ...empty, reason: "the agent returned no answer, and nothing is invented", provider: data.provider };
  }

  const { line, truncated } = fitForSpeech(full);
  return {
    ok: true,
    speak: line,
    full,
    sources: cites,
    provider: data.provider,
    steps: data.steps,
    tools,
    truncated,
  };
}
