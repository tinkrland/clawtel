// questions: asking and answering, live and async. the answer rule is
// the honesty rule: the agent answers with a citation into the
// transcript or it says it does not know. it never invents an answer
// it cannot cite.

import {
  contentWords,
  findSegments,
  getTranscript,
  type Transcript,
} from "../transcript/store.ts";

export interface CitedAnswer {
  known: true;
  answer: string; // the segment verbatim, with the citation
  speaker: string;
  citation: string;
  transcriptId: string;
}

export interface UnknownAnswer {
  known: false;
  reason: string;
}

export type Answer = CitedAnswer | UnknownAnswer;

// answer a question from a transcript. a majority of the question's
// content words must appear in the segment: one shared word is not
// knowledge, it is coincidence.
export function answerFromTranscript(
  question: string,
  transcript: Transcript,
  opts: { minCoverage?: number } = {},
): Answer {
  const words = contentWords(question);
  if (!words.length) return { known: false, reason: "the question carried nothing to look for" };
  const minCoverage = opts.minCoverage ?? 0.5;
  for (const { segment, citation } of findSegments(transcript, question)) {
    const lower = segment.text.toLowerCase();
    const covered = words.filter((w) => lower.includes(w)).length / words.length;
    if (covered >= minCoverage) {
      return {
        known: true,
        answer: segment.text,
        speaker: segment.speaker,
        citation,
        transcriptId: transcript.id,
      };
    }
  }
  return {
    known: false,
    reason: "nothing in the transcript says. a citation or silence, never a guess.",
  };
}

export function answerFromTranscriptId(
  question: string,
  transcriptId: string,
): Answer {
  const transcript = getTranscript(transcriptId);
  if (!transcript) return { known: false, reason: `no transcript ${transcriptId}` };
  return answerFromTranscript(question, transcript);
}
