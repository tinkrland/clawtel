// say: the whole trip in one call. a question becomes an answered line,
// the line becomes audio, the audio goes into the meeting's microphone.
//
// every step keeps its own receipt, and the result is honest about each
// one separately: a line can be answered but not spoken (no tts), or
// rendered but not played (no pulseaudio). saying "it spoke" when only
// the file exists would be the same lie in a new place.

import { randomUUID } from "node:crypto";
import { answerForCall, type AskOptions, type VoiceAnswer } from "./answer.ts";
import { playIntoMic, micStatus, type Exec, type MicTarget } from "./mic.ts";
import { synthesize, type SpeakOptions, type TtsResult } from "./tts.ts";
import type { Meeting } from "../meeting.ts";

export interface SayResult {
  ok: boolean;
  asked?: string;
  speak: string;
  full?: string;
  sources: string[];
  tools: string[];
  truncated: boolean;
  answerProvider?: string;
  audio?: { provider: string; bytes: number; durationMs?: number; id: string; mime: string };
  played?: { ok: boolean; reason?: string };
  reason?: string;
}

// rendered lines, keyed so the audio route can serve them without
// taking a caller-supplied path
const rendered = new Map<string, { path: string; mime: string }>();

export function renderedLine(id: string): { path: string; mime: string } | undefined {
  return rendered.get(id);
}

export interface SayOptions extends AskOptions {
  // a question to answer first; ignored when text is given
  question?: string;
  // when text is given the line is spoken as written, no memory call
  text?: string;
  tts?: SpeakOptions;
  exec?: Exec;
  play?: boolean;
  // where the line is spoken. absent means this process, which is the
  // container case; a joined spawnable supplies its own box
  target?: MicTarget | null;
  player?: (audioPath: string) => Promise<{ ok: boolean; reason?: string }>;
}

export async function say(meeting: Meeting, opts: SayOptions): Promise<SayResult> {
  const empty: SayResult = { ok: false, speak: "", sources: [], tools: [], truncated: false };
  let answered: VoiceAnswer | null = null;
  let spoken = (opts.text ?? "").trim();

  if (opts.text === undefined) {
    answered = await answerForCall(meeting, opts.question ?? "", {
      personaId: opts.personaId,
      memory: opts.memory,
      connectionId: opts.connectionId,
      maxSteps: opts.maxSteps,
    });
    if (!answered.ok) {
      return { ...empty, reason: answered.reason ?? "the agent did not answer" };
    }
    spoken = answered.speak;
  }

  if (!spoken) return { ...empty, reason: "there is nothing to say" };

  const tts: TtsResult = await synthesize(spoken, opts.tts ?? {});
  const base: SayResult = {
    ok: false,
    asked: opts.question,
    speak: spoken,
    full: answered?.full,
    sources: answered?.sources ?? [],
    tools: answered?.tools ?? [],
    truncated: answered?.truncated ?? false,
    answerProvider: answered?.provider,
  };

  if (!tts.ok || !tts.path) {
    return { ...base, reason: tts.reason ?? "no tts rung rendered the line" };
  }

  const id = randomUUID();
  const mime = tts.mime ?? "audio/mpeg";
  rendered.set(id, { path: tts.path, mime });
  const result: SayResult = {
    ...base,
    audio: { provider: tts.provider ?? "unknown", bytes: tts.bytes ?? 0, durationMs: tts.durationMs, id, mime },
  };

  if (opts.play === false) return { ...result, ok: true };

  const played = opts.player
    ? await opts.player(tts.path)
    : await playIntoMic(tts.path, opts.exec, opts.target);
  return { ...result, ok: true, played };
}

export async function speakingLane(exec?: Exec) {
  const mic = await micStatus(exec);
  return {
    tts: { rung: process.env.ELEVENLABS_API_KEY ? "edge-tts then elevenlabs" : "edge-tts", voice: process.env.CLAWTEL_TTS_VOICE ?? "en-US-AriaNeural" },
    mic,
  };
}
