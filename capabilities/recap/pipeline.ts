// the recap pipeline: a meeting ends, the recap begins. fetch the
// recording, transcribe it, ingest the transcript, then answer capture
// requests with citations pointing back into the source. each stage
// is a lane; a lane without its keys stays closed, and the pipeline
// says which stage stopped, it never invents a transcript.

import { storeTranscript, type TranscriptSegment } from "../transcript/store.ts";

export interface FetchLane {
  fetch(url: string): Promise<{ ok: boolean; detail?: string }>;
}
export interface TranscribeLane {
  transcribe(sourceUrl: string): Promise<TranscriptSegment[]>;
}

export class ClosedFetchLane implements FetchLane {
  async fetch(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: false, detail: "fetch lane is closed. the media fetch tooling is not wired in this deployment." };
  }
}
export class ClosedTranscribeLane implements TranscribeLane {
  async transcribe(): Promise<TranscriptSegment[]> {
    throw new Error("transcribe lane is closed. bring a transcription key; nothing invents words.");
  }
}

export function fetchLaneAvailable(): boolean {
  const key = process.env?.TRANSCRIPT_API_KEY;
  return typeof key === "string" && key.length > 0;
}

export interface RecapResult {
  meetingId?: string;
  transcriptId: string;
  segments: number;
}

export async function runRecap(
  sourceUrl: string,
  lanes: FetchLane & TranscribeLane,
  opts: { meetingId?: string } = {},
): Promise<RecapResult> {
  const fetched = await lanes.fetch(sourceUrl);
  if (!fetched.ok) {
    throw new Error(`recap stopped at fetch: ${fetched.detail ?? "the source did not come back"}`);
  }
  const segments = await lanes.transcribe(sourceUrl);
  if (!segments.length) {
    throw new Error("recap stopped at transcribe: no words came back. nothing is ingested.");
  }
  const transcript = storeTranscript(segments, { meetingId: opts.meetingId, sourceUrl });
  return { meetingId: opts.meetingId, transcriptId: transcript.id, segments: segments.length };
}
