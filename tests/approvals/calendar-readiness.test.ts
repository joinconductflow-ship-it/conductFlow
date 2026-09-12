import { describe, expect, it } from "vitest";
import { inspectCalendarSchedule } from "@/lib/approvals/calendar-readiness";
import type { CalendarClient, CalendarEvent } from "@/lib/google/calendar";

function calendar(timeZone: string, event: CalendarEvent): CalendarClient {
  return {
    listEvents: async () => [event],
    listEventsWithMeta: async () => ({ events: [event], timeZone }),
    getEvent: async () => null,
    createEvent: async () => event,
  };
}

describe("inspectCalendarSchedule", () => {
  it.each([
    { timeZone: "America/Los_Angeles", startTime: "23:30" },
    { timeZone: "Asia/Tokyo", startTime: "00:30" },
  ])("interprets all-day events in $timeZone", async ({ timeZone, startTime }) => {
    const allDay = {
      id: "all-day",
      title: "Unavailable",
      start: "2026-09-12",
      end: "2026-09-13",
      attendeeCount: 0,
    };

    const result = await inspectCalendarSchedule(calendar(timeZone, allDay), {
      date: "2026-09-12",
      start_time: startTime,
      duration_minutes: 60,
    });

    expect(result.conflicts.map((event) => event.id)).toEqual(["all-day"]);
  });
});
