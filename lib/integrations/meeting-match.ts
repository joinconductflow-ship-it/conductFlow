import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken as googleAccessToken } from "@/lib/google/tokens";
import { getAccessToken as microsoftAccessToken } from "@/lib/microsoft/tokens";
import { listEventsWithAttendeeEmails } from "@/lib/google/calendar";
import { listCalendarEventsNear } from "@/lib/microsoft/graph";
import { matchGmailClient } from "@/lib/integrations/unmatched";
import { logFailure } from "@/lib/observability/log";

export interface MeetingMatch {
  clientId: string; clientName: string; clientEmail: string; confidence: "single_match";
}
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const MICROSOFT_SCOPE = "Calendars.ReadWrite";
const WINDOW_MS = 20 * 60 * 1000;

/** Calendar context is optional: a failed guess must never prevent capture. */
export async function matchMeetingToClient(
  db: SupabaseClient, orgId: string, aroundIso: string,
): Promise<MeetingMatch | null> {
  try {
    const around = Date.parse(aroundIso);
    const timeMin = new Date(around - WINDOW_MS).toISOString();
    const timeMax = new Date(around + WINDOW_MS).toISOString();
    const { data, error } = await db.from("connected_data_source")
      .select("id,provider,scopes,account_email").eq("org_id", orgId)
      .in("provider", ["google", "microsoft"]).eq("state", "active");
    if (error) throw error;
    const sources = data ?? [];
    const source = sources.find((row) => row.provider === "google" && row.scopes?.includes(GOOGLE_SCOPE))
      ?? sources.find((row) => row.provider === "microsoft" && row.scopes?.includes(MICROSOFT_SCOPE));
    if (!source) {
      if (sources.length) logFailure("meeting match", { orgId, operation: "calendar_scope", reason: "missing_scope" });
      return null;
    }
    const deps = { connectionId: source.id as string };
    const events = source.provider === "google"
      ? (await listEventsWithAttendeeEmails(await googleAccessToken(db, orgId, GOOGLE_SCOPE, deps), { timeMin, timeMax }))
        .map(({ event, attendeeEmails }) => ({ start: event.start, end: event.end, attendeeEmails }))
      : await listCalendarEventsNear(await microsoftAccessToken(db, orgId, MICROSOFT_SCOPE, deps), timeMin, timeMax);
    const timed = events.map((event) => ({
      ...event, startMs: Date.parse(event.start), endMs: Date.parse(event.end ?? ""),
    })).filter((event) => Number.isFinite(event.startMs));
    const containing = timed.filter((event) => event.startMs <= around && event.endMs >= around)
      .sort((a, b) => a.startMs - b.startMs);
    const closest = timed.filter((event) => Math.abs(event.startMs - around) <= WINDOW_MS)
      .sort((a, b) => Math.abs(a.startMs - around) - Math.abs(b.startMs - around));
    const event = containing[0] ?? closest[0];
    if (!event) return null;
    const ownEmail = (source.account_email as string | null)?.trim().toLowerCase();
    for (const email of event.attendeeEmails) {
      if (email.toLowerCase() === ownEmail) continue;
      const client = await matchGmailClient(db, orgId, email);
      if (client) return {
        clientId: client.id, clientName: client.name, clientEmail: email, confidence: "single_match",
      };
    }
    return null;
  } catch (error) {
    logFailure("meeting match", { orgId, operation: "match_meeting_to_client", error });
    return null;
  }
}
