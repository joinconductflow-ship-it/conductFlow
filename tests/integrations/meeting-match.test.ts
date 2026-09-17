import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchMeetingToClient } from "@/lib/integrations/meeting-match";
import { getAccessToken as googleToken } from "@/lib/google/tokens";
import { getAccessToken as microsoftToken } from "@/lib/microsoft/tokens";
import { logFailure } from "@/lib/observability/log";

vi.mock("@/lib/google/tokens", () => ({ getAccessToken: vi.fn() }));
vi.mock("@/lib/microsoft/tokens", () => ({ getAccessToken: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));
const AROUND = "2026-09-17T12:00:00Z";
const GOOGLE = { id: "g", provider: "google", account_email: "OWNER@example.com",
  scopes: ["https://www.googleapis.com/auth/calendar.events.owned"] };
const MICROSOFT = { id: "m", provider: "microsoft", account_email: "owner@example.com", scopes: ["Calendars.ReadWrite"] };
const CLIENT = { id: "client", name: "Priya" };

function database(sources: unknown[], matches: Record<string, unknown[]> = {}, error: unknown = null) {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: sources, error }).then(resolve),
  };
  const rpc = vi.fn(async (_name: string, args: { p_email: string }) => ({ data: matches[args.p_email] ?? [], error: null }));
  return { db: { from: vi.fn(() => query), rpc } as unknown as SupabaseClient, query, rpc };
}
function event(start = "11:50", end = "12:15", emails = ["owner@example.com", "Priya@example.com"]) {
  return { id: start, start: { dateTime: `2026-09-17T${start}:00Z` },
    end: { dateTime: `2026-09-17T${end}:00Z` }, attendees: emails.map((email) => ({ email })) };
}
function calendar(events: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: events }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(googleToken).mockResolvedValue("google-test-token");
  vi.mocked(microsoftToken).mockResolvedValue("microsoft-test-token");
});
afterEach(() => vi.unstubAllGlobals());

describe("matchMeetingToClient", () => {
  it("does no network work without a calendar connection", async () => {
    const fetchMock = calendar([]);
    const { db } = database([]);
    expect(await matchMeetingToClient(db, "org", AROUND)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(googleToken).not.toHaveBeenCalled();
    expect(microsoftToken).not.toHaveBeenCalled();
  });
  it("does no network work when calendar scope was not granted", async () => {
    const fetchMock = calendar([]);
    const { db } = database([{ ...GOOGLE, scopes: [] }, { ...MICROSOFT, scopes: [] }]);
    expect(await matchMeetingToClient(db, "org", AROUND)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(googleToken).not.toHaveBeenCalled();
    expect(microsoftToken).not.toHaveBeenCalled();
    expect(logFailure).toHaveBeenCalled();
  });
  it("matches the first known attendee, excluding the connected account", async () => {
    const fetchMock = calendar([event()]);
    const { db, rpc, query } = database([GOOGLE, MICROSOFT], { "priya@example.com": [CLIENT] });
    expect(await matchMeetingToClient(db, "org", AROUND)).toEqual({
      clientId: "client", clientName: "Priya", clientEmail: "priya@example.com", confidence: "single_match",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("match_gmail_client", { p_org: "org", p_email: "priya@example.com" });
    expect(query.eq).toHaveBeenCalledWith("org_id", "org");
    expect(query.eq).toHaveBeenCalledWith("state", "active");
    expect(googleToken).toHaveBeenCalledWith(db, "org", GOOGLE.scopes[0], { connectionId: "g" });
    expect(microsoftToken).not.toHaveBeenCalled();
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("timeMin")).toBe("2026-09-17T11:40:00.000Z");
    expect(url.searchParams.get("timeMax")).toBe("2026-09-17T12:20:00.000Z");
  });
  it("returns null when no attendee matches or the match is ambiguous", async () => {
    calendar([event()]);
    const cases: Record<string, unknown[]>[] = [{}, { "priya@example.com": [CLIENT, { id: "other", name: "Other" }] }];
    for (const matches of cases) {
      const { db } = database([GOOGLE], matches);
      expect(await matchMeetingToClient(db, "org", AROUND)).toBeNull();
    }
  });
  it("prefers a containing event over a closer start and takes the earliest containing start", async () => {
    calendar([event("12:01", "12:30", ["wrong@example.com"]),
      event("11:58", "12:10", ["wrong@example.com"]), event("11:45", "12:15")]);
    const { db } = database([GOOGLE], { "priya@example.com": [CLIENT] });
    expect(await matchMeetingToClient(db, "org", AROUND)).toMatchObject({ clientId: "client" });
  });
  it("uses the closest start when no event contains capture time", async () => {
    calendar([event("12:15", "12:30", ["wrong@example.com"]), event("12:02", "12:20")]);
    const { db } = database([GOOGLE], { "priya@example.com": [CLIENT] });
    expect(await matchMeetingToClient(db, "org", AROUND)).toMatchObject({ clientId: "client" });
  });
  it("returns null for an empty calendar", async () => {
    calendar([]);
    expect(await matchMeetingToClient(database([GOOGLE]).db, "org", AROUND)).toBeNull();
  });
  it("normalizes Google attendees and follows later pages", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ items: [], nextPageToken: "next" }))
      .mockResolvedValueOnce(Response.json({ items: [event("11:50", "12:15", [
        "room@resource.calendar.google.com", "unknown@example.com", "UNKNOWN@example.com", "Priya@example.com",
      ])] }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, rpc } = database([GOOGLE], { "priya@example.com": [CLIENT] });
    expect(await matchMeetingToClient(db, "org", AROUND)).toMatchObject({ clientId: "client" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("pageToken=next");
  });
  it("falls back to Microsoft scope and reads paginated calendarview instances in UTC", async () => {
    const next = "https://graph.microsoft.com/v1.0/me/calendarview?$skiptoken=next";
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ value: [], "@odata.nextLink": next }))
      .mockResolvedValueOnce(Response.json({ value: [{ id: "recurrence-instance", subject: "Call",
        start: { dateTime: "2026-09-17T11:50:00.0000000" }, end: { dateTime: "2026-09-17T12:10:00.0000000" },
        attendees: ["OWNER@example.com", "unknown@example.com", "UNKNOWN@example.com", "PRIYA@example.com"]
          .map((address) => ({ emailAddress: { address } })),
      }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, rpc } = database([{ ...GOOGLE, scopes: [] }, MICROSOFT], { "priya@example.com": [CLIENT] });
    expect(await matchMeetingToClient(db, "org", AROUND)).toMatchObject({ clientId: "client" });
    expect(googleToken).not.toHaveBeenCalled();
    expect(microsoftToken).toHaveBeenCalledWith(db, "org", "Calendars.ReadWrite", { connectionId: "m" });
    expect(rpc).toHaveBeenCalledTimes(2);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1.0/me/calendarview");
    expect(url.searchParams.get("startDateTime")).toBe("2026-09-17T11:40:00.000Z");
    expect(url.searchParams.get("$select")).toBe("subject,start,end,attendees");
    expect(fetchMock.mock.calls[1][0]).toBe(next);
  });
  it("logs and suppresses database, credential, and provider failures", async () => {
    calendar([]);
    expect(await matchMeetingToClient(database([], {}, new Error("database unavailable")).db, "org", AROUND)).toBeNull();
    vi.mocked(googleToken).mockRejectedValueOnce(new Error("credential unavailable"));
    expect(await matchMeetingToClient(database([GOOGLE]).db, "org", AROUND)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    expect(await matchMeetingToClient(database([GOOGLE]).db, "org", AROUND)).toBeNull();
    expect(logFailure).toHaveBeenCalledTimes(3);
  });
});
