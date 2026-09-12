import { describe, it, expect } from "vitest";
import { buildDraftContext } from "@/lib/google/context";
import type { CalendarClient } from "@/lib/google/calendar";
import type { DriveClient } from "@/lib/google/drive";

const noDrive: DriveClient = {
  listFiles: async () => [],
  readFile: async () => "",
  findCreatedDocument: async () => null,
  createGoogleDoc: async () => { throw new Error("createGoogleDoc is not used by draft context"); },
};

/** Records the window the calendar was asked for. */
function recordingCalendar() {
  const asked: { timeMin: string; timeMax: string }[] = [];
  const calendar: CalendarClient = {
    listEvents: async (range) => { asked.push(range); return []; },
    listEventsWithMeta: async () => ({ events: [], timeZone: null }),
    getEvent: async () => null,
    createEvent: async () => { throw new Error("createEvent is not used by draft context"); },
  };
  return { calendar, asked };
}

async function windowFor(occurredAt: string, timeZone?: string) {
  const { calendar, asked } = recordingCalendar();
  await buildDraftContext({ drive: noDrive, calendar, clientName: "Anyone", occurredAt, timeZone });
  return asked[0];
}

describe("calendar day window", () => {
  it("defaults to a UTC day", async () => {
    const w = await windowFor("2026-08-11");
    expect(w.timeMin).toBe("2026-08-11T00:00:00.000Z");
    expect(w.timeMax).toBe("2026-08-12T00:00:00.000Z");
  });

  it("uses the org's local midnight, not UTC midnight", async () => {
    // Sydney is UTC+10 in August, so the local day starts the previous UTC afternoon.
    const w = await windowFor("2026-08-11", "Australia/Sydney");
    expect(w.timeMin).toBe("2026-08-10T14:00:00.000Z");
    expect(w.timeMax).toBe("2026-08-11T14:00:00.000Z");
  });

  it("handles a zone behind UTC", async () => {
    const w = await windowFor("2026-08-11", "America/Los_Angeles");
    expect(w.timeMin).toBe("2026-08-11T07:00:00.000Z");
    expect(w.timeMax).toBe("2026-08-12T07:00:00.000Z");
  });

  it("spans 25 hours across a DST fall-back day", async () => {
    // US clocks go back on 2026-11-01; that local day is 25 hours long.
    const w = await windowFor("2026-11-01", "America/Los_Angeles");
    const hours = (Date.parse(w.timeMax) - Date.parse(w.timeMin)) / 3_600_000;
    expect(hours).toBe(25);
  });

  it("spans 23 hours across a DST spring-forward day", async () => {
    const w = await windowFor("2026-03-08", "America/Los_Angeles");
    const hours = (Date.parse(w.timeMax) - Date.parse(w.timeMin)) / 3_600_000;
    expect(hours).toBe(23);
  });

  it("falls back to UTC for a zone it does not recognize", async () => {
    const w = await windowFor("2026-08-11", "Mars/Olympus_Mons");
    expect(w.timeMin).toBe("2026-08-11T00:00:00.000Z");
  });
});
