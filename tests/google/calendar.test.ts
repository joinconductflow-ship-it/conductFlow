import { describe, it, expect, vi, afterEach } from "vitest";
import { createCalendarClient } from "@/lib/google/calendar";

const TOKEN = "ya29.fake-access-token";
const RANGE = { timeMin: "2026-08-11T00:00:00.000Z", timeMax: "2026-08-12T00:00:00.000Z" };

type FetchInit = { headers: Record<string, string> };

function fakeFetch(response: { ok?: boolean; status?: number; json?: unknown }) {
  const fn = vi.fn(async (_url: string, _init?: FetchInit) => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.json ?? {},
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("createCalendarClient", () => {
  it("exposes list, meta, get, and create methods", () => {
    expect(Object.keys(createCalendarClient(TOKEN))).toEqual([
      "listEvents", "listEventsWithMeta", "getEvent", "createEvent",
    ]);
  });

  it("requests single events in the given window, ordered by start", async () => {
    const fetchMock = fakeFetch({ json: { items: [] } });
    await createCalendarClient(TOKEN).listEvents(RANGE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("timeMin=2026-08-11T00%3A00%3A00.000Z");
    expect(url).toContain("timeMax=2026-08-12T00%3A00%3A00.000Z");
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("orderBy=startTime");
    expect(init?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("reduces attendees to a count and never returns their emails", async () => {
    fakeFetch({ json: { items: [{
      id: "e1", summary: "Weekly check-in",
      start: { dateTime: "2026-08-11T14:00:00Z" },
      attendees: [
        { email: "parent@example.com" },
        { email: "tutor@demo.test" },
      ],
    }] } });

    const events = await createCalendarClient(TOKEN).listEvents(RANGE);

    expect(events).toEqual([{
      id: "e1", title: "Weekly check-in", start: "2026-08-11T14:00:00Z", attendeeCount: 2,
    }]);
    expect(JSON.stringify(events)).not.toContain("@");
  });

  it("counts an event with no attendees as zero", async () => {
    fakeFetch({ json: { items: [{ id: "e2", summary: "Focus block", start: { dateTime: "2026-08-11T09:00:00Z" } }] } });
    const [event] = await createCalendarClient(TOKEN).listEvents(RANGE);
    expect(event.attendeeCount).toBe(0);
  });

  it("falls back to the all-day date when an event has no start time", async () => {
    fakeFetch({ json: { items: [{ id: "e3", start: { date: "2026-08-11" } }] } });
    const [event] = await createCalendarClient(TOKEN).listEvents(RANGE);
    expect(event.start).toBe("2026-08-11");
    expect(event.title).toBeNull();
  });

  it("returns an empty list when the response carries no items", async () => {
    fakeFetch({ json: {} });
    expect(await createCalendarClient(TOKEN).listEvents(RANGE)).toEqual([]);
  });

  it("follows every events.list page token", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => url.includes("pageToken=page-2")
        ? {
            items: [{ id: "event-26", summary: "Later conflict", start: { dateTime: "2026-08-11T16:00:00Z" } }],
          }
        : {
            items: [{ id: "event-1", summary: "First event", start: { dateTime: "2026-08-11T08:00:00Z" } }],
            timeZone: "America/New_York",
            nextPageToken: "page-2",
          },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCalendarClient(TOKEN).listEventsWithMeta(RANGE);

    expect(result.events.map((event) => event.id)).toEqual(["event-1", "event-26"]);
    expect(result.timeZone).toBe("America/New_York");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("pageToken=page-2");
  });

  it("throws with the status when the request fails", async () => {
    fakeFetch({ ok: false, status: 401 });
    await expect(createCalendarClient(TOKEN).listEvents(RANGE)).rejects.toThrow(/401/);
  });

  it("reuses an existing event instead of creating a copy", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? "GET") === "GET") {
        return {
          ok: true, status: 200, text: async () => "",
          json: async () => ({ id: "existing-1", summary: "Meeting — Client", htmlLink: "https://calendar.google.com/event?eid=e1" }),
        };
      }
      posts.push(JSON.parse(init!.body!));
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    }));

    const event = await createCalendarClient(TOKEN).createEvent({
      actionId: "abc123", title: "Meeting — Client",
      start: "2026-08-11T14:00:00.000Z", end: "2026-08-11T14:30:00.000Z", timeZone: "UTC",
    });
    expect(event.id).toBe("existing-1");
    expect(event.htmlLink).toBe("https://calendar.google.com/event?eid=e1");
    expect(posts).toHaveLength(0);
  });

  it("posts the event with a stable id, title, times, and no attendees", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? "GET") === "GET") {
        return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
      }
      posts.push(JSON.parse(init!.body!));
      return {
        ok: true, status: 200, text: async () => "",
        json: async () => ({ id: "cfabc123", summary: "Call — Client", htmlLink: "https://calendar.google.com/event?eid=new" }),
      };
    }));

    const event = await createCalendarClient(TOKEN).createEvent({
      actionId: "abc123", title: "Call — Client",
      start: "2026-08-11T14:00:00.000Z", end: "2026-08-11T14:30:00.000Z", timeZone: "UTC",
      recurrence: "RRULE:FREQ=WEEKLY",
    });
    expect(event.id).toBe("cfabc123");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      id: "cfabc123",
      summary: "Call — Client",
      recurrence: ["RRULE:FREQ=WEEKLY"],
    });
    expect(posts[0] as Record<string, unknown>).not.toHaveProperty("attendees");
  });
});
