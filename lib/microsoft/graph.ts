const API_BASE = "https://graph.microsoft.com/v1.0";

export type GraphErrorKind =
  | "unauthorized" | "forbidden" | "rate_limited" | "server_error" | "unknown";

export class GraphError extends Error {
  readonly kind: GraphErrorKind = "unknown";
  readonly status: number;
  readonly retryable: boolean = false;
  get reconnectRequired(): boolean { return this.status === 401 || this.status === 403; }

  constructor(message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** Access token rejected — expired or malformed. A refresh may fix it. */
export class GraphUnauthorizedError extends GraphError {
  readonly kind = "unauthorized" as const;
}

/** Authenticated, but the granted scopes do not cover this call. */
export class GraphForbiddenError extends GraphError {
  readonly kind = "forbidden" as const;
}

export class GraphRateLimitError extends GraphError {
  readonly kind = "rate_limited" as const;
  readonly retryable = true;
  readonly retryAfterSeconds: number;

  constructor(message: string, status: number, retryAfterSeconds: number) {
    super(message, status);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GraphServerError extends GraphError {
  readonly kind = "server_error" as const;
  readonly retryable = true;
}

export interface GraphMailMessage {
  id: string; subject?: string; receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { contentType?: string; content?: string }; bodyPreview?: string;
}
export interface GraphCalendarEvent {
  id: string; subject?: string; start: string; end: string; attendeeEmails: string[];
}
interface RawCalendarEvent {
  id: string; subject?: string;
  start?: { dateTime?: string }; end?: { dateTime?: string };
  attendees?: { emailAddress?: { address?: string } }[];
}

// Graph's default calendar response uses UTC but omits the offset in dateTime.
function calendarDateTime(value = ""): string {
  return value && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? `${value}Z` : value;
}

export interface GraphTeam { id: string; displayName: string; }
export interface GraphChannel { id: string; displayName: string; }
export interface TeamsChannel { id: string; name: string; teamName: string; }
export interface TeamsMessage {
  id: string; createdDateTime: string; body?: { contentType?: string; content?: string };
  from?: { user?: { displayName?: string }; application?: { displayName?: string } };
}
export interface GraphClientOptions {
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  maxRetries?: number;
  maxRetryWaitMs?: number;
}
interface GraphPage<T> { value?: T[]; "@odata.nextLink"?: string; }

function retryAfterFrom(headers: Headers): number {
  const raw = headers.get("retry-after") ?? "60";
  const seconds = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, seconds) : 60;
}

/** Preserve provider diagnostics instead of guessing the cause of a rejected call. */
function reasonFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    return typeof message === "string" && message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

function errorFor(status: number, body: string, headers: Headers): GraphError {
  const reason = reasonFrom(body);
  if (status === 401) {
    return new GraphUnauthorizedError(reason ?? "Graph rejected the access token.", status);
  }
  if (status === 403) {
    return new GraphForbiddenError(reason ?? "Graph refused this call.", status);
  }
  if (status === 429) {
    return new GraphRateLimitError("Graph is throttling this account.", status, retryAfterFrom(headers));
  }
  if (status >= 500) return new GraphServerError("Graph is having trouble.", status);
  return new GraphError(`Graph refused the request (HTTP ${status}).`, status);
}

export function createGraphClient(accessToken: string, options: GraphClientOptions = {}) {
  const call = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 2;

  async function request(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    for (;;) {
      // nextLink is provider data: never forward credentials to another origin.
      const target = new URL(url);
      if (target.origin !== "https://graph.microsoft.com" || !target.pathname.startsWith("/v1.0/")
        || target.username || target.password) throw new GraphError("Invalid Graph pagination URL.", 400);
      const response = await call(url, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: init.signal ?? AbortSignal.timeout(30_000),
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      if (response.ok || response.status === 404) return response;

      const body = await response.text();
      const failure = errorFor(response.status, body, response.headers);
      if (!failure.retryable || attempt >= maxRetries) throw failure;

      const backoffMs = failure instanceof GraphRateLimitError
        ? failure.retryAfterSeconds * 1000
        : 2 ** attempt * 500;
      // Do not sleep past the worker budget; the durable scan can retry next invocation.
      if (backoffMs > (options.maxRetryWaitMs ?? Infinity)) throw failure;
      await wait(backoffMs);
      attempt++;
    }
  }

  async function page<T>(url: string): Promise<{ items: T[]; nextLink?: string }> {
    const response = await request(url, { method: "GET" });
    if (response.status === 404) throw new GraphError("Graph listing unavailable.", 404);
    const payload = await response.json() as GraphPage<T>;
    return { items: payload.value ?? [], nextLink: payload["@odata.nextLink"] };
  }
  async function all<T>(url: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = url;
    do {
      const result: { items: T[]; nextLink?: string } = await page<T>(next);
      items.push(...result.items);
      next = result.nextLink;
    } while (next);
    return items;
  }
  return {
    async listInboxMessagePage(sinceIso: string, untilIso: string, top: number, nextLink?: string) {
      const params = new URLSearchParams({
        "$filter": `receivedDateTime ge ${sinceIso} and receivedDateTime le ${untilIso}`,
        "$orderby": "receivedDateTime asc", "$top": String(top), "$select": "id,receivedDateTime",
      });
      const result = await page<GraphMailMessage>(nextLink || `${API_BASE}/me/mailFolders/inbox/messages?${params}`);
      return { messages: result.items, nextLink: result.nextLink };
    },
    async getInboxMessage(messageId: string): Promise<GraphMailMessage | null> {
      const params = new URLSearchParams({ "$select": "subject,from,receivedDateTime,body,bodyPreview" });
      const response = await request(`${API_BASE}/me/messages/${encodeURIComponent(messageId)}?${params}`, { method: "GET" });
      if (response.status === 404) return null;
      return await response.json() as GraphMailMessage;
    },
    async listCalendarEventsNear(sinceIso: string, untilIso: string): Promise<GraphCalendarEvent[]> {
      const params = new URLSearchParams({
        startDateTime: sinceIso, endDateTime: untilIso, "$select": "subject,start,end,attendees",
      });
      const events = await all<RawCalendarEvent>(`${API_BASE}/me/calendarview?${params}`);
      return events.map((event) => ({
        id: event.id, subject: event.subject,
        start: calendarDateTime(event.start?.dateTime), end: calendarDateTime(event.end?.dateTime),
        attendeeEmails: [...new Set((event.attendees ?? []).flatMap((attendee) => {
          const email = attendee.emailAddress?.address?.trim().toLowerCase();
          return email ? [email] : [];
        }))],
      }));
    },
    listMyTeams: () => all<GraphTeam>(`${API_BASE}/me/joinedTeams`),
    listChannels: (teamId: string) => all<GraphChannel>(`${API_BASE}/teams/${encodeURIComponent(teamId)}/channels`),
    async listChannelMessagesPage(teamId: string, channelId: string, top: number, nextLink?: string) {
      const result = await page<TeamsMessage>(nextLink || `${API_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${top}`);
      return { messages: result.items, nextLink: result.nextLink };
    },
    /** One team page and at most one channel page; preserve both continuation URLs. */
    async availableChannelPage(cursor = "") {
      const state: { teams: GraphTeam[]; teamsNextLink?: string; channelNextLink?: string } = cursor
        ? JSON.parse(cursor) : { teams: [] };
      if (!state.teams.length) {
        const result = await page<GraphTeam>(state.teamsNextLink || `${API_BASE}/me/joinedTeams`);
        state.teams = result.items;
        state.teamsNextLink = result.nextLink;
      }
      const team = state.teams[0];
      const channels: TeamsChannel[] = [];
      if (team) {
        const result = await page<GraphChannel>(state.channelNextLink || `${API_BASE}/teams/${encodeURIComponent(team.id)}/channels`);
        channels.push(...result.items.map((channel) => ({
          id: `${team.id}:${channel.id}`, name: `${team.displayName} / ${channel.displayName}`, teamName: team.displayName,
        })));
        state.channelNextLink = result.nextLink;
        if (!result.nextLink) state.teams.shift();
      }
      return { channels, cursor: state.teams.length || state.teamsNextLink ? JSON.stringify(state) : "" };
    },
  };
}

// Public token-first helpers use the same bounded retries as scan callers.
export const listInboxMessagePage = (accessToken: string, sinceIso: string, untilIso: string, top: number, nextLink?: string) =>
  createGraphClient(accessToken, { maxRetryWaitMs: 5000 }).listInboxMessagePage(sinceIso, untilIso, top, nextLink);
export const getInboxMessage = (accessToken: string, messageId: string) =>
  createGraphClient(accessToken, { maxRetryWaitMs: 5000 }).getInboxMessage(messageId);
export const listMyTeams = (accessToken: string) => createGraphClient(accessToken, { maxRetryWaitMs: 5000 }).listMyTeams();
export const listChannels = (accessToken: string, teamId: string) => createGraphClient(accessToken, { maxRetryWaitMs: 5000 }).listChannels(teamId);
export const listChannelMessagesPage = (accessToken: string, teamId: string, channelId: string, top: number, nextLink?: string) =>
  createGraphClient(accessToken, { maxRetryWaitMs: 5000 }).listChannelMessagesPage(teamId, channelId, top, nextLink);

export async function availableChannels(accessToken: string): Promise<TeamsChannel[]> {
  const channels: TeamsChannel[] = [];
  for (const team of await listMyTeams(accessToken)) {
    channels.push(...(await listChannels(accessToken, team.id)).map((channel) => ({
      id: `${team.id}:${channel.id}`, name: `${team.displayName} / ${channel.displayName}`, teamName: team.displayName,
    })));
  }
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

export function splitChannelId(id: string): { teamId: string; channelId: string } {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) throw new Error("Invalid Teams channel id.");
  return { teamId: id.slice(0, separator), channelId: id.slice(separator + 1) };
}

export const listCalendarEventsNear = (accessToken: string, sinceIso: string, untilIso: string) =>
  createGraphClient(accessToken, { maxRetryWaitMs: 5000 }).listCalendarEventsNear(sinceIso, untilIso);
