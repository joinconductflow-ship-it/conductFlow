/**
 * Authoritative date grounding for the Copilot. The language model must never guess the
 * current date or resolve "next Tuesday" from training knowledge; the server computes a
 * date context in the org's timezone and resolves relative phrases deterministically.
 *
 * Pure and client-safe: `now` is always injected by the caller.
 */

export interface CopilotDateContext {
  /** Server time in ISO (UTC) — the instant the context was computed. */
  nowIso: string;
  /** Calendar date in `timeZone`, YYYY-MM-DD. */
  date: string;
  /** Weekday name in `timeZone`, e.g. "Saturday". */
  weekday: string;
  /** IANA zone used for `date`/`weekday`, e.g. "America/New_York". */
  timeZone: string;
}

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * ConductFlow's canonical org timezone lives in `organization.timezone` (default 'UTC'); see
 * migration 0007 and lib/google/draft-context.ts. Invalid or absent values fall back to UTC.
 */
export function validTimeZone(value: unknown): string {
  if (typeof value === "string" && value.trim() && isTimeZone(value.trim())) return value.trim();
  return "UTC";
}

function partsInZone(now: Date, timeZone: string): {
  year: number; month: number; day: number; weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday"),
  };
}

export function copilotDateContext(now: Date, timeZone: string): CopilotDateContext {
  const zone = validTimeZone(timeZone);
  const { year, month, day, weekday } = partsInZone(now, zone);
  return {
    nowIso: now.toISOString(),
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    weekday,
    timeZone: zone,
  };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Resolves the relative date phrases the extraction prompt already defines, against the
 * server context. Returns undefined for anything it cannot resolve with confidence (the
 * caller must then treat the date as unresolved rather than invent one). No framework.
 */
export function resolveRelativeDate(
  phrase: string,
  context: CopilotDateContext,
): string | undefined {
  // Tolerate the model passing the whole phrase ("next Tuesday at 4 PM", "on Friday").
  const text = phrase.trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/^on\s+/, "")
    .replace(/\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?$/, "");
  if (!text) return undefined;
  if (DATE_RE.test(text)) return text;

  const baseWeekday = WEEKDAYS.indexOf(context.weekday.toLowerCase() as typeof WEEKDAYS[number]);
  if (baseWeekday < 0) return undefined;
  const daysUntilFriday = ((5 - baseWeekday) + 7) % 7;

  if (["today", "tonight", "this morning", "this evening"].includes(text)) return context.date;
  if (text === "tomorrow") return addDays(context.date, 1);
  // "next week" → the Friday of the following week (matches the extraction prompt).
  if (text === "next week") return addDays(context.date, daysUntilFriday + 7);
  // "this week"/"end of week" → this week's Friday (already upcoming on a weekend).
  if (["this week", "end of week", "by the end of the week"].includes(text)) {
    return addDays(context.date, daysUntilFriday);
  }

  const match = text.match(
    /^(?:(next|this|by)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/,
  );
  if (!match) return undefined;
  const target = WEEKDAYS.indexOf(match[2] as typeof WEEKDAYS[number]);
  let delta = (target - baseWeekday + 7) % 7;
  if (match[1] === "this") return addDays(context.date, delta);
  // Plain weekday names, "next X", and "by X" mean strictly after today.
  if (delta === 0) delta = 7;
  return addDays(context.date, delta);
}
