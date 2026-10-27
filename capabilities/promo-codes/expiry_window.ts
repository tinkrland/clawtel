// expiry window: "the code expires in 10 minutes" is not a vibe, it
// is a clock. this module reads the words being said and extracts how
// long the thing lives, from the utterance itself. honest contract: it
// reports what was SAID, never a guess. a duration with no expiry cue
// is a schedule, not a window. a clock with no zone is quoted, not
// invented. null means no expiry-shaped sentence was heard at all,
// which is the common case and a fine answer.

import { parseColloquialTime } from "./colloquial_time.ts";

export interface ExpiryWindow {
  kind: "minutes" | "clock" | "meeting_end" | "today" | "hurry";
  minutes?: number;
  expiresAt?: string;
  quote: string;
  urgent: boolean;
}

// the words that make a duration an expiry. without one of these in
// the same sentence, a duration is a schedule, not a window.
const EXPIRY_CUE =
  /\b(expire[sd]?|expiring|expir\w+|valid|only\s+(?:good|valid|useful)|works?|redeemable|usable|use\s+(?:it|the\s+(?:code|link|form)|this\s+(?:code|link|form))|you'?ve\s+got|you\s+(?:have|got)|lasts?|deadline|timer|window|up\s+for\s+grabs)/i;

const DURATION =
  /(?:\b(?:in|for|within|before)\s+)(?:about\s+|around\s+|roughly\s+)?(?:half\s+(?:an?\s+)?|an?\s+)?(\d+(?:[.,]\d+)*)?\s*(minutes?|mins?|min\b|hours?|hrs?|h\b|seconds?|secs?|sec\b)/i;

// the duration can also lead: "you've got 2 hrs before it expires"
const DURATION_BEFORE =
  /(\d+(?:[.,]\d+)*)\s*(minutes?|mins?|min\b|hours?|hrs?|h\b|seconds?|secs?)\s+before\b/i;

const MEETING_END =
  /(?:until|when|while|during)\s+(?:the\s+|this\s+|we'?re\s+)?(?:end\s+of\s+)?(?:the\s+|this\s+)?(?:meeting|call|class|stream|session|event|lecture|webinar|live)\b[^.!?]{0,24}(?:ends?|is\s+(?:over|done|finished|live)|closes?)|until\s+the\s+end\s+of\s+(?:the|this)\s+(?:meeting|call|class|stream|session|event|lecture|webinar)|while\s+(?:we'?re|it'?s|the\s+(?:call|stream|class|meeting))\s+(?:is\s+)?(?:live|on|running)|(?:during|while)\s+(?:the\s+|this\s+)?(?:meeting|call|class|stream|session|lecture|webinar)\b/i;

const TODAY =
  /(?:expire[sd]?|expiring|valid|only\s+good|works?|redeemable|usable)[^.!?]{0,30}(tonight|today\s+only|today|end\s+of\s+(?:the\s+)?day|before\s+tomorrow)|(?:tonight|today\s+only|end\s+of\s+(?:the\s+)?day)[^.!?]{0,20}(expire|valid|closes?)/i;

// hurry words: urgency without a number
const HURRY =
  /\b(hurry|quick(?:ly)?|asap|right\s+now|don'?t\s+wait|use\s+it\s+now|grab\s+it\s+(?:now|fast)|first\s+come\b|get\s+yours?\s+(?:quick(?:ly)?|fast|now)|act\s+(?:fast|now))/i;

// minutes from a duration match, honest rounding: seconds round up to 1
function durationToMinutes(n: number | undefined, unit: string, half: boolean): number | undefined {
  const base = half ? 30 : 0;
  const value = n ?? 0;
  if (/^h/i.test(unit)) return base || value * 60;
  if (/^s/i.test(unit)) return Math.max(1, Math.round((base || value) / 60));
  return Math.max(1, Math.round(base || value));
}

// the expiry window spoken in one utterance, or null when the words
// said nothing expiry-shaped. priority: an explicit length beats a
// meeting-bound window beats a today window beats bare hurry words.
export function extractExpiryWindow(
  text: string,
  opts: { now?: Date; meetingEndsAt?: string | Date | null } = {},
): ExpiryWindow | null {
  if (!text) return null;
  const now = opts.now ?? new Date();
  const sentences = text.split(/(?<=[.!?])\s+/);

  let meetingEnd: ExpiryWindow | null = null;
  let today: ExpiryWindow | null = null;

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const cued = EXPIRY_CUE.test(sentence);
    const hasHalf = /half\s+(?:an?\s+)?(hour|hr)/i.test(sentence);

    // 1. an explicit length: "expires in 10 minutes"
    const dur = DURATION.exec(sentence) ?? DURATION_BEFORE.exec(sentence);
    if (cued && dur) {
      const minutes = durationToMinutes(
        dur[1] ? parseFloat(dur[1].replace(",", ".")) : undefined,
        dur[2],
        hasHalf,
      );
      if (minutes) {
        const expiresAt = new Date(now.getTime() + minutes * 60000).toISOString();
        return { kind: "minutes", minutes, expiresAt, quote: sentence, urgent: minutes <= 60 };
      }
    }

    // 2. a clock: "expires at 3pm eastern". the zone is the words' to
    // give; without one the clock is quoted, not invented.
    if (cued && /\d\s*(?:am|pm)\b|\d{1,2}:\d{2}\b|\bat\s+\d{1,2}\b/i.test(sentence)) {
      const t = parseColloquialTime(sentence, now);
      if (t?.iso) {
        const minutes = Math.max(0, Math.round((Date.parse(t.iso) - now.getTime()) / 60000));
        return { kind: "clock", minutes, expiresAt: t.iso, quote: sentence, urgent: minutes <= 60 };
      }
      if (t && !t.iso) {
        return { kind: "clock", quote: sentence, urgent: false };
      }
    }

    // 3. meeting-bound: lower priority than an explicit length
    if (cued && MEETING_END.test(sentence)) {
      meetingEnd = { kind: "meeting_end", quote: sentence, urgent: false };
    }

    // 4. today-bound: same
    if (cued && TODAY.test(sentence)) {
      today = { kind: "today", quote: sentence, urgent: false };
    }
  }

  if (meetingEnd) {
    if (opts.meetingEndsAt) {
      const endMs = typeof opts.meetingEndsAt === "string"
        ? Date.parse(opts.meetingEndsAt)
        : opts.meetingEndsAt.getTime();
      if (!isNaN(endMs)) {
        const minutes = Math.max(0, Math.round((endMs - now.getTime()) / 60000));
        meetingEnd = { ...meetingEnd, minutes, expiresAt: new Date(endMs).toISOString(), urgent: minutes <= 60 };
      }
    }
    return meetingEnd;
  }
  if (today) return today;

  // 5. hurry words alone: urgency with no window. it reports the words.
  const hurrySentence = sentences.find((s) => HURRY.test(s));
  if (hurrySentence) {
    return { kind: "hurry", quote: hurrySentence.trim(), urgent: true };
  }

  return null;
}
