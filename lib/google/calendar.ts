import { expectGoogleResponse, GoogleApiError } from "./api-error";

const EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const LIST_PAGE_SIZE = 25;

export interface CalendarEvent {
  id: string;
  title: string | null;
  start: string;
  end?: string;
  htmlLink?: string;
  attendeeCount: number;
}

export interface DayRange {
  timeMin: string;
  timeMax: string;
}

export interface CalendarEventInput {
  actionId: string;
  title: string;
  start: string;
  end: string;
  timeZone: string;
  location?: string;
  notes?: string;
  recurrence?: string;
}

export interface CalendarListResult {
  events: CalendarEvent[];
  timeZone: string | null;
}

export interface CalendarClient {
  listEvents(range: DayRange): Promise<CalendarEvent[]>;
  listEventsWithMeta(range: DayRange): Promise<CalendarListResult>;
  getEvent(eventId: string): Promise<CalendarEvent | null>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
}

interface RawEvent {
  id?: string;
  summary?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: unknown[];
}

function mapEvent(event: RawEvent): CalendarEvent {
  const result: CalendarEvent = {
    id: event.id ?? "",
    title: event.summary ?? null,
    start: event.start?.dateTime ?? event.start?.date ?? "",
    attendeeCount: event.attendees?.length ?? 0,
  };
  const end = event.end?.dateTime ?? event.end?.date;
  if (end) result.end = end;
  if (event.htmlLink) result.htmlLink = event.htmlLink;
  return result;
}

export function calendarEventId(actionId: string): string {
  // Calendar accepts base32hex characters. A UUID without hyphens is within that set;
  // a stable id makes an insert retry resolve to the original event instead of a copy.
  return `cf${actionId.toLowerCase().replace(/[^a-f0-9]/g, "")}`.slice(0, 64);
}

async function listRawEvents(accessToken: string, range: DayRange): Promise<{ events: RawEvent[]; timeZone: string | null }> {
  const headers = { Authorization: `Bearer ${accessToken}` };
    const events: RawEvent[] = [];
    let timeZone: string | null = null;
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(LIST_PAGE_SIZE),
      });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await fetch(`${EVENTS_API}?${params}`, { headers });
      await expectGoogleResponse(response, "calendar", "events.list");
      const json = await response.json() as {
        items?: RawEvent[];
        timeZone?: string;
        nextPageToken?: string;
      };
      events.push(...(json.items ?? []));
      timeZone ??= json.timeZone ?? null;
      pageToken = json.nextPageToken;
    } while (pageToken);

    return { events, timeZone };
  }

/** Attendee addresses are opt-in; existing calendar consumers still receive counts only. */
export async function listEventsWithAttendeeEmails(
  accessToken: string, range: DayRange,
): Promise<{ event: CalendarEvent; attendeeEmails: string[] }[]> {
  const { events } = await listRawEvents(accessToken, range);
  return events.map((event) => ({
    event: mapEvent(event),
    attendeeEmails: [...new Set((event.attendees ?? []).flatMap((attendee) => {
      if (!attendee || typeof attendee !== "object" || !("email" in attendee) ||
        typeof attendee.email !== "string") return [];
      const email = attendee.email.trim().toLowerCase();
      return email && !email.includes("resource.calendar.google.com") ? [email] : [];
    }))],
  }));
}

export function createCalendarClient(accessToken: string): CalendarClient {
  const headers = { Authorization: `Bearer ${accessToken}` };

  async function listEventsWithMeta(range: DayRange): Promise<CalendarListResult> {
    const result = await listRawEvents(accessToken, range);
    return { events: result.events.map(mapEvent), timeZone: result.timeZone };
  }

  async function getEvent(eventId: string): Promise<CalendarEvent | null> {
    const response = await fetch(`${EVENTS_API}/${encodeURIComponent(eventId)}`, { headers });
    if (response.status === 404 || response.status === 410) return null;
    await expectGoogleResponse(response, "calendar", "events.get");
    return mapEvent(await response.json() as RawEvent);
  }

  async function createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const eventId = calendarEventId(input.actionId);
    const existing = await getEvent(eventId);
    if (existing) return existing;

    const body: Record<string, unknown> = {
      id: eventId,
      summary: input.title,
      start: { dateTime: input.start, timeZone: input.timeZone },
      end: { dateTime: input.end, timeZone: input.timeZone },
      extendedProperties: { private: { conductflowActionId: input.actionId } },
    };
    if (input.location) body.location = input.location;
    if (input.notes) body.description = input.notes;
    if (input.recurrence) body.recurrence = [input.recurrence];

    const response = await fetch(EVENTS_API, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 409) {
      const raced = await getEvent(eventId);
      if (raced) return raced;
    }
    await expectGoogleResponse(response, "calendar", "events.insert");
    return mapEvent(await response.json() as RawEvent);
  }

  return {
    listEvents: async (range) => (await listEventsWithMeta(range)).events,
    listEventsWithMeta,
    getEvent,
    createEvent,
  };
}

export { GoogleApiError };
