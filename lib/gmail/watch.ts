import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { createGmailClient, GmailError } from "./client";
import { parseInboundMessage } from "./inbound";
import { getAccessToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";
import { runIngest } from "@/lib/ingest/run";
import { logFailure } from "@/lib/observability/log";
import { matchGmailClient, recordUnmatchedSource } from "@/lib/integrations/unmatched";
import { claimScan, releaseScan, type ScanConnection } from "@/lib/integrations/scan-lease";

const READ_SCOPE = CAPABILITIES.gmail_watch.scopes[0];
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const GMAIL_SCAN_PAGE_SIZE = 10;
export interface ScanGmailArgs { orgId?: string; now?: Date; maxMessagesPerOrg?: number; }
export interface ScanGmailResult {
  connectionsScanned: number; messagesConsidered: number; ingested: number;
  skippedUnmatchedSender: number; unmatchedSourcesRecorded: number; errors: number; reconnectRequired: boolean;
}

/** Bounded, resumable listing followed by oldest-first processing of a fixed time window. */
export async function scanGmail(db: SupabaseClient, args: ScanGmailArgs = {}, model?: LanguageModel): Promise<ScanGmailResult> {
  const result: ScanGmailResult = { connectionsScanned: 0, messagesConsidered: 0, ingested: 0,
    skippedUnmatchedSender: 0, unmatchedSourcesRecorded: 0, errors: 0, reconnectRequired: false };
  const connection = await claimScan(db, "google", args.orgId);
  if (!connection) return result;
  result.connectionsScanned = 1;
  try {
    await scanOneConnection(db, connection, args.now ?? new Date(),
      Math.min(10, Math.max(1, Math.floor(args.maxMessagesPerOrg ?? 10))), model, result);
  } catch (error) {
    result.errors++;
    if ((error instanceof DataSourceUnavailable && ["reconnect", "refused"].includes(error.reason))
      || (error instanceof GmailError && ["invalid_grant", "unauthorized", "forbidden"].includes(error.kind))) {
      result.reconnectRequired = true;
    }
    logFailure("scanGmail.connection", error);
  } finally {
    await releaseScan(db, connection);
  }
  return result;
}
async function scanOneConnection(db: SupabaseClient, connection: ScanConnection, now: Date, limit: number,
  model: LanguageModel | undefined, result: ScanGmailResult) {
  const deadline = Date.now() + 180_000;
  const client = createGmailClient(await getAccessToken(db, connection.org_id, READ_SCOPE,
    { connectionId: connection.id }), { maxRetryWaitMs: 5_000 });
  const { data: state, error: stateError } = await db.from("integration_scan_state")
    .select("gmail_until,gmail_cursor,gmail_listed").eq("connection_id", connection.id).single();
  if (stateError) throw stateError;
  const last = connection.gmail_last_scanned_at ? Date.parse(connection.gmail_last_scanned_at) : now.getTime() - INITIAL_LOOKBACK_MS;
  const until = state.gmail_until ? Date.parse(state.gmail_until) : now.getTime();
  async function saveState(values: Record<string, unknown>) {
    const { error } = await db.from("integration_scan_state").update(values)
      .eq("connection_id", connection.id).eq("lease_token", connection.lease_token);
    if (error) throw error;
  }
  if (!state.gmail_until) {
    // Persist BOTH boundaries: a first-ever window must not drift while pagination resumes.
    const { error } = await db.from("connected_data_source").update({ gmail_last_scanned_at: new Date(last).toISOString() })
      .eq("id", connection.id).eq("org_id", connection.org_id);
    if (error) throw error;
    await saveState({ gmail_until: new Date(until).toISOString() });
  }
  if (!state.gmail_listed) {
    const page = await client.listMessagePage(
      `in:inbox after:${Math.floor(last / 1000)} before:${Math.floor(until / 1000) + 1}`,
      GMAIL_SCAN_PAGE_SIZE, state.gmail_cursor ?? undefined,
    );
    // Never acknowledge a listing page if even one fetch fails. Upserts make replay safe.
    for (const { id } of page.messages) {
      if (Date.now() >= deadline) return;
      const message = await client.getMessage(id);
      if (!message) continue; // Confirmed provider 404, not a swallowed transport error.
      const received = Number(message.internalDate);
      if (!Number.isFinite(received)) throw new Error("Invalid Gmail message timestamp");
      if (received <= last || received > until) continue;
      const { error } = await db.from("gmail_scan_pending").upsert({
        connection_id: connection.id, message_id: id, received_at: new Date(received).toISOString(),
      }, { onConflict: "connection_id,message_id" });
      if (error) throw error;
    }
    await saveState({ gmail_cursor: page.nextPageToken ?? null, gmail_listed: !page.nextPageToken });
    return; // Listing and model processing have separate invocation budgets.
  }
  const { data: pending, error: pendingError } = await db.from("gmail_scan_pending")
    .select("message_id,received_at").eq("connection_id", connection.id)
    .order("received_at").order("message_id").limit(limit);
  if (pendingError) throw pendingError;
  for (const item of pending ?? []) {
    if (Date.now() >= deadline) return;
    const raw = await client.getMessage(item.message_id);
    const message = raw ? parseInboundMessage(raw) : null;
    if (message) {
      result.messagesConsidered++;
      const matched = await matchGmailClient(db, connection.org_id, message.fromEmail);
      if (!matched) {
        const opened = await recordUnmatchedSource(db, {
          orgId: connection.org_id, provider: "google", sourceType: "email",
          sourceKey: message.fromEmail, sourceName: message.fromName || message.fromEmail,
          sourceLabel: message.subject, connectedDataSourceId: connection.id, lastSeenAt: new Date(message.receivedAtMs),
        });
        result.skippedUnmatchedSender++;
        if (opened) result.unmatchedSourcesRecorded++;
      } else {
        await runIngest(db, { orgId: connection.org_id, clientId: matched.id, clientName: matched.name,
          title: message.subject, occurredAt: new Date(message.receivedAtMs).toISOString().slice(0, 10),
          transcript: message.bodyText }, model);
        result.ingested++;
      }
    }
    // A failed message aborts here; it and every newer message remain durable for retry.
    const { error } = await db.from("gmail_scan_pending").delete()
      .eq("connection_id", connection.id).eq("message_id", item.message_id);
    if (error) throw error;
  }
  const { data: remaining, error: remainingError } = await db.from("gmail_scan_pending").select("message_id")
    .eq("connection_id", connection.id).limit(1);
  if (remainingError) throw remainingError;
  if (remaining?.length) return;
  // Only a completely handled window advances the provider checkpoint.
  const { error } = await db.from("connected_data_source").update({ gmail_last_scanned_at: new Date(until).toISOString() })
    .eq("id", connection.id).eq("org_id", connection.org_id);
  if (error) throw error;
  await saveState({ gmail_until: null, gmail_cursor: null, gmail_listed: false });
}
