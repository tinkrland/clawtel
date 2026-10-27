// colloquial time: "3pm est", "tomorrow at 2:30 pt", "in 20 min".
// people put meeting times in prose; this module reads the prose.
// output is honest: a complete iso when date + clock + zone were all
// present, a partial with the gap named when something was missing,
// null when nothing time-shaped is in the text. a zone is never
// invented: a clock with no zone is quoted, not zoned.

export interface ColloquialTime {
  iso?: string;
  matched: string;
  partial?: "time-no-zone" | "date-no-time";
}

// us-centric abbreviations plus utc/ist. the label is the truth, not
// the offset: a "3pm est" in july means 3pm in new york.
const TZ_TABLE: Record<string, string> = {
  est: "America/New_York", edt: "America/New_York", et: "America/New_York",
  eastern: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago",
  central: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver", mt: "America/Denver",
  mountain: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles",
  pacific: "America/Los_Angeles",
  akst: "America/Anchorage", akdt: "America/Anchorage",
  hst: "Pacific/Honolulu", hawaii: "Pacific/Honolulu",
  utc: "UTC", gmt: "UTC", z: "UTC",
  bst: "Europe/London", ist: "Asia/Kolkata", cet: "Europe/Paris", cest: "Europe/Paris",
};

// convert a wall clock in a named zone to utc, without the local
// constructor's double-subtract: build the naive string, then read the
// zone's offset for that instant back through the formatter.
function wallClockToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, zone: string,
): string {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  // find the zone's offset at that utc instant, then correct once
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = dtf.formatToParts(new Date(naive));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asZone = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") === 24 ? 0 : get("hour"), get("minute"), 0,
  );
  const offsetMs = asZone - naive;
  return new Date(naive - offsetMs).toISOString();
}

export function parseColloquialTime(text: string, now = new Date()): ColloquialTime | null {
  if (!text) return null;

  // relative first: "in 20 min" is the live meaning
  const rel = text.match(/\bin\s+(\d+|an?)\s*(min(?:ute)?s?|hrs?|hours?|h)\b/i);
  if (rel) {
    const n = /^(a|an)$/i.test(rel[1]) ? 1 : parseInt(rel[1], 10);
    const unit = /^h/i.test(rel[2]) ? 60 : 1;
    return { iso: new Date(now.getTime() + n * unit * 60000).toISOString(), matched: rel[0] };
  }

  // the date part, carried as tokens: a Date needs a zone and building
  // it with the local constructor is how double-subtracts happen
  let dateKind: "none" | "today" | "tomorrow" | "explicit" = "none";
  let explicitMonth = 0, explicitDay = 0;
  const day = text.match(/\b(today|tonight|tomorrow|tmrw?)\b/i);
  if (day) dateKind = /today|tonight/i.test(day[1]) ? "today" : "tomorrow";
  const md = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md) {
    dateKind = "explicit";
    // m/d, us convention: "10/25" is oct 25
    explicitMonth = parseInt(md[1], 10);
    explicitDay = parseInt(md[2], 10);
  }
  // the clock scan runs WITHOUT the date phrase: "10/25 at 10am ist"
  // must not read the date's 10 as the clock
  const textForClock = md ? text.replace(md[0], "  ") : text;

  const zoneRe = Object.keys(TZ_TABLE).join("|");
  const clock = textForClock.match(
    new RegExp(`\\b(?:(\\d{1,2}):(\\d{2})|(\\d{1,2}))\\s*(am|pm)?\\s*(${zoneRe})?\\b`, "i"),
  );
  if (!clock) {
    return dateKind !== "none"
      ? { matched: (day?.[0] || md?.[0] || ""), partial: "date-no-time", iso: undefined }
      : null;
  }

  let hour: number;
  if (clock[1] !== undefined) {
    hour = parseInt(clock[1], 10);
  } else {
    hour = parseInt(clock[3], 10);
  }
  const minute = clock[2] ? parseInt(clock[2], 10) : 0;
  const mer = clock[4]?.toLowerCase();
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  const zoneLabel = clock[5]?.toLowerCase();
  const matched = clock[0];

  if (!zoneLabel) {
    return { matched, partial: "time-no-zone", iso: undefined };
  }
  const zone = TZ_TABLE[zoneLabel];

  // resolve the date in the zone's terms: "today"/"tomorrow" relative
  // to the zone, not the server. no date phrase = the zone's today.
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const zoneNum = (t: string) => Number(nowParts.find((p) => p.type === t)?.value);
  const sy = zoneNum("year"), sm = zoneNum("month"), sd = zoneNum("day");
  let y = sy, m = sm, d = sd;
  if (dateKind === "tomorrow") {
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
  } else if (dateKind === "explicit") {
    // the explicit date rolls forward when already past this year in
    // the zone: an oct 25 heard in dec means next year's, honestly
    const candidate = new Date(Date.UTC(y, explicitMonth - 1, explicitDay));
    if (candidate.getTime() < Date.UTC(y, m - 1, d)) y += 1;
    m = explicitMonth; d = explicitDay;
  }

  return { iso: wallClockToUtc(y, m, d, hour, minute, zone), matched };
}
