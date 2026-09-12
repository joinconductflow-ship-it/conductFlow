import type { ActionInputData } from "@/lib/types";
import type { CalendarClient, CalendarEvent } from "@/lib/google/calendar";

export interface CalendarSchedule {
  start: Date;
  end: Date;
  timeZone: string;
  conflicts: CalendarEvent[];
}

function partsInZone(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

export function dateTimeInZone(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desired;

  // Two passes account for DST boundaries without bringing a broad date dependency into
  // the app. The final round-trip also rejects nonexistent local times such as 02:30 on
  // a spring-forward day.
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = partsInZone(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second,
    );
    candidate += desired - represented;
  }
  const roundTrip = partsInZone(new Date(candidate), timeZone);
  if (roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day ||
      roundTrip.hour !== hour || roundTrip.minute !== minute) {
    throw new Error("That local time does not exist in the connected Calendar timezone.");
  }
  return new Date(candidate);
}

function broadDateRange(date: string): { timeMin: string; timeMax: string } {
  const midnight = new Date(`${date}T00:00:00.000Z`);
  return {
    timeMin: new Date(midnight.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(midnight.getTime() + 48 * 60 * 60 * 1000).toISOString(),
  };
}

function calendarBoundary(value: string, timeZone: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateTimeInZone(value, "00:00", timeZone).getTime();
  }
  return Date.parse(value);
}

function overlaps(event: CalendarEvent, start: Date, end: Date, timeZone: string): boolean {
  const eventStart = calendarBoundary(event.start, timeZone);
  const eventEnd = calendarBoundary(event.end ?? event.start, timeZone);
  if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) return false;
  return eventStart < end.getTime() && eventEnd > start.getTime();
}

export async function inspectCalendarSchedule(
  calendar: CalendarClient,
  data: ActionInputData,
  ownEventId?: string,
): Promise<CalendarSchedule> {
  if (!data.date || !data.start_time || !data.duration_minutes) {
    throw new Error("Calendar date, time, and duration are required.");
  }
  const broad = await calendar.listEventsWithMeta(broadDateRange(data.date));
  const timeZone = data.time_zone ?? broad.timeZone ?? "UTC";
  const start = dateTimeInZone(data.date, data.start_time, timeZone);
  const end = new Date(start.getTime() + data.duration_minutes * 60_000);
  const conflicts = broad.events.filter((event) =>
    event.id !== ownEventId && overlaps(event, start, end, timeZone),
  );
  return { start, end, timeZone, conflicts };
}
