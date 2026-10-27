// scarcity detection: "first come first serve" or "only the first 50
// people" is urgency, understood from the words. a scarce capture
// changes the correct response: notify is no longer enough, the agent
// may have to act before the meeting ends. scarcity with no number in
// it is still scarcity: the words say the supply is short even when
// nobody says how short. pure functions only.

export interface ScarcityResult {
  scarce: boolean;
  matched: string[];
  cap?: number; // how many units are available, if a number was heard
}

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /first[ -]?come[,]?[ ]?first[ -]?serve/, label: "first come first serve" },
  { re: /\bfcfs\b/, label: "fcfs" },
  { re: /first (\d+(?:[.,]\d+)*)\s*(?:million|thousand)?\s*(?:people|attendees|folks|students|signups|submissions|registrants|spots|comments|users)/, label: "first N people" },
  { re: /first (\d+(?:[.,]\d+)*)\s*to\s*(?:use|enter|redeem|sign\s?up|register|fill|submit|claim|comment)/, label: "first N to act" },
  { re: /(?:only|just|limited to)\s*(\d+(?:[.,]\d+)*)\s*(?:spots|seats|tickets|codes|slots|openings|spots left|codes left)/, label: "limited spots" },
  { re: /while (?:supplies|spots|codes|seats|stock) last/, label: "while supplies last" },
  { re: /limited (?:quantity|supply|spots|seats|codes|availability)/, label: "limited quantity" },
  { re: /expires (?:at|when|in|after)|only valid (?:until|during)|until the end of (?:the|this) (?:meeting|call|stream|class|event)/, label: "time limited" },
  // bare "limited" is gated so the counted/noun forms keep their own
  // labels and caps, and "limited time" stays the expiry side's word,
  // not a supply claim
  { re: /\blimited\b(?!\s*(?:quantity|supply|spots|seats|tickets|codes|slots|openings|availability|time))/, label: "limited" },
  { re: /(?:once|when)\s+(?:they|these|it)\s*['’]?(?:re|s|are|is)?\s+(?:out|gone)\b/, label: "once they're out" },
  { re: /\b(?:may|might|will|would|don'?t)?\s*not\s+(?:be\s+|have\s+)?enough\b/, label: "may not have enough" },
  { re: /\brun(?:s|ning)?\s+out\b(?!\s+(?:the|time)\b)/, label: "may run out" },
  { re: /\bget\s+(?:yours|them|one|it)\s+(?:quick(?:ly)?|fast|now)\b|\bwhile\s+you\s+(?:still\s+)?can\b|\bact\s+(?:fast|now)\b/, label: "get yours quickly" },
  { re: /\bbefore\s+(?:they|these|it)\s*['’]?\s*(?:re|s|are|is)?\s*(?:all\s+)?(?:gone|out)\b/, label: "before they're gone" },
];

export function detectScarcity(text: string): ScarcityResult {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let cap: number | undefined;

  for (const { re, label } of PATTERNS) {
    const m = lower.match(re);
    if (m) {
      matched.push(label);
      if (m[1] && cap === undefined) {
        const parsed = parseInt(m[1].replace(/[.,]/g, ""), 10);
        if (!isNaN(parsed)) cap = parsed;
      }
    }
  }

  return { scarce: matched.length > 0, matched, cap };
}

// is the utterance's scarcity people-counted, clock-counted, or just
// short. the uncounted phrases are a supply question: not
// people-counted, not clock-counted, just short.
export function scarcityKind(result: ScarcityResult): "none" | "time" | "people" | "supply" {
  if (!result.scarce) return "none";
  const people = ["first N people", "first N to act", "limited spots"].some((l) =>
    result.matched.includes(l),
  );
  if (people) return "people";
  const supply = ["limited", "once they're out", "may not have enough", "may run out", "get yours quickly", "before they're gone", "while supplies last", "limited quantity"].some((l) =>
    result.matched.includes(l),
  );
  return supply ? "supply" : "time";
}
