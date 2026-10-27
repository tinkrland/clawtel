// the transcript: the full record, stored verbatim, searchable,
// citable. transcripts are the evidence layer every other capability
// cites; they are never rewritten to sound better. segments carry
// their offset so citations point back into the source.

export interface TranscriptSegment {
  startMs: number;
  speaker: string;
  text: string;
}

export interface Transcript {
  id: string;
  meetingId?: string;
  sourceUrl?: string;
  segments: TranscriptSegment[];
  createdAt: string;
}

// h:mm:ss citation time, the format every capture answer carries
export function citationTime(startMs: number): string {
  const total = Math.max(0, Math.floor(startMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

let nextId = 1;
const transcripts = new Map<string, Transcript>();

export function storeTranscript(
  segments: TranscriptSegment[],
  opts: { meetingId?: string; sourceUrl?: string } = {},
): Transcript {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMs < sorted[i - 1].startMs) {
      throw new Error("transcript segments must not overlap in time order");
    }
  }
  const transcript: Transcript = {
    id: `tr_${nextId++}`,
    meetingId: opts.meetingId,
    sourceUrl: opts.sourceUrl,
    segments: sorted,
    createdAt: new Date().toISOString(),
  };
  transcripts.set(transcript.id, transcript);
  return transcript;
}

export function getTranscript(id: string): Transcript | undefined {
  return transcripts.get(id);
}

export function listTranscripts(): Transcript[] {
  return [...transcripts.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// find segments matching a query: content words, case-insensitive.
// a citation always beats a summary: the answer IS the segment, with
// its time, never a paraphrase.
const STOP = new Set(["the", "a", "an", "is", "are", "was", "were", "of", "to", "and", "or", "in", "on", "at", "for", "it", "this", "that", "do", "does", "did", "what", "when", "how", "who", "why"]);

export function contentWords(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export function findSegments(
  transcript: Transcript,
  query: string,
): { segment: TranscriptSegment; citation: string }[] {
  const words = contentWords(query);
  if (!words.length) return [];
  const hits: { segment: TranscriptSegment; score: number; citation: string }[] = [];
  for (const segment of transcript.segments) {
    const lower = segment.text.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (lower.includes(w)) score += 1;
    }
    if (score > 0) {
      hits.push({ segment, score, citation: citationTime(segment.startMs) });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || a.segment.startMs - b.segment.startMs)
    .map((h) => ({ segment: h.segment, citation: h.citation }));
}
