import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { createGraphClient, GraphError } from "./graph";
import { parseInboundMessage } from "./mail";
import { DataSourceUnavailable } from "@/lib/google/tokens";
import { getAccessToken } from "./tokens";
import { runIngest } from "@/lib/ingest/run";
import { logFailure } from "@/lib/observability/log";
import { matchGmailClient, recordUnmatchedSource } from "@/lib/integrations/unmatched";
import { claimScan, releaseScan, type ScanConnection } from "@/lib/integrations/scan-lease";

const READ_SCOPE = "Mail.Read";
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const OUTLOOK_SCAN_PAGE_SIZE = 10;
export interface ScanOutlookArgs { orgId?: string; now?: Date; maxMessagesPerOrg?: number; }
export interface ScanOutlookResult {
  connectionsScanned: number; messagesConsidered: number; ingested: number;
  skippedUnmatchedSender: number; unmatchedSourcesRecorded: number; errors: number; reconnectRequired: boolean;
}

/** Bounded, resumable listing followed by oldest-first processing of a fixed time window. */
export async function scanOutlook(db: SupabaseClient, args: ScanOutlookArgs = {}, model?: LanguageModel): Promise<ScanOutlookResult> {
  const result: ScanOutlookResult = { connectionsScanned: 0, messagesConsidered: 0, ingested: 0,
    skippedUnmatchedSender: 0, unmatchedSourcesRecorded: 0, errors: 0, reconnectRequired: false };
  const connection = await claimScan(db, "microsoft", args.orgId);
  if (!connection) return result;
  result.connectionsScanned = 1;
  try {
    await scanOneConnection(db, connection, args.now ?? new Date(),
      Math.min(10, Math.max(1, Math.floor(args.maxMessagesPerOrg ?? 10))), model, result);
  } catch (error) {
    result.errors++;
    if ((error instanceof DataSourceUnavailable && ["reconnect", "refused"].includes(error.reason))
      || (error instanceof GraphError && ["unauthorized", "forbidden"].includes(error.kind))) {
      result.reconnectRequired = true;
    }
    logFailure("scanOutlook.connection", error);
  } finally {
    await releaseScan(db, connection);
  }
  return result;
}
async function scanOneConnection(db: SupabaseClient, connection: ScanConnection, now: Date, limit: number,
  model: LanguageModel | undefined, result: ScanOutlookResult) {
  const deadline = Date.now() + 180_000;
  const client = createGraphClient(await getAccessToken(db, connection.org_id, READ_SCOPE,
    { connectionId: connection.id }), { maxRetryWaitMs: 5_000 });
  const { data: state, error: stateError } = await db.from("integration_scan_state")
    .select("outlook_until,outlook_cursor,outlook_listed").eq("connection_id", connection.id).single();
  if (stateError) throw stateError;
  // The shared lease RPC intentionally retains its existing return signature.
  const { data: checkpoint, error: checkpointError } = await db.from("connected_data_source")
    .select("outlook_last_scanned_at").eq("id", connection.id).eq("org_id", connection.org_id).single();
  if (checkpointError) throw checkpointError;
  const last = checkpoint.outlook_last_scanned_at ? Date.parse(checkpoint.outlook_last_scanned_at) : now.getTime() - INITIAL_LOOKBACK_MS;
  const until = state.outlook_until ? Date.parse(state.outlook_until) : now.getTime();
  async function saveState(values: Record<string, unknown>) {
    const { error } = await db.from("integration_scan_state").update(values)
      .eq("connection_id", connection.id).eq("lease_token", connection.lease_token);
    if (error) throw error;
  }
  if (!state.outlook_until) {
    // Persist BOTH boundaries: a first-ever window must not drift while pagination resumes.
    const { error } = await db.from("connected_data_source").update({ outlook_last_scanned_at: new Date(last).toISOString() })
      .eq("id", connection.id).eq("org_id", connection.org_id);
    if (error) throw error;
    await saveState({ outlook_until: new Date(until).toISOString() });
  }
  if (!state.outlook_listed) {
    const page = await client.listInboxMessagePage(
      new Date(last).toISOString(), new Date(until).toISOString(),
      OUTLOOK_SCAN_PAGE_SIZE, state.outlook_cursor ?? undefined,
    );
    // Never acknowledge a listing page if even one fetch fails. Upserts make replay safe.
    for (const { id } of page.messages) {
      if (Date.now() >= deadline) return;
      const message = await client.getInboxMessage(id);
      if (!message) continue; // Confirmed provider 404, not a swallowed transport error.
      const received = Date.parse(message.receivedDateTime);
      if (!Number.isFinite(received)) throw new Error("Invalid Outlook message timestamp");
      if (received <= last || received > until) continue;
      const { error } = await db.from("outlook_scan_pending").upsert({
        connection_id: connection.id, message_id: id, received_at: new Date(received).toISOString(),
      }, { onConflict: "connection_id,message_id" });
      if (error) throw error;
    }
    await saveState({ outlook_cursor: page.nextLink ?? null, outlook_listed: !page.nextLink });
    return; // Listing and model processing have separate invocation budgets.
  }
  const { data: pending, error: pendingError } = await db.from("outlook_scan_pending")
    .select("message_id,received_at").eq("connection_id", connection.id)
    .order("received_at").order("message_id").limit(limit);
  if (pendingError) throw pendingError;
  for (const item of pending ?? []) {
    if (Date.now() >= deadline) return;
    const raw = await client.getInboxMessage(item.message_id);
    const message = raw ? parseInboundMessage(raw) : null;
    if (message) {
      result.messagesConsidered++;
      const matched = await matchGmailClient(db, connection.org_id, message.fromEmail);
      if (!matched) {
        const opened = await recordUnmatchedSource(db, {
          orgId: connection.org_id, provider: "microsoft", sourceType: "email",
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
    const { error } = await db.from("outlook_scan_pending").delete()
      .eq("connection_id", connection.id).eq("message_id", item.message_id);
    if (error) throw error;
  }
  const { data: remaining, error: remainingError } = await db.from("outlook_scan_pending").select("message_id")
    .eq("connection_id", connection.id).limit(1);
  if (remainingError) throw remainingError;
  if (remaining?.length) return;
  // Only a completely handled window advances the provider checkpoint.
  const { error } = await db.from("connected_data_source").update({ outlook_last_scanned_at: new Date(until).toISOString() })
    .eq("id", connection.id).eq("org_id", connection.org_id);
  if (error) throw error;
  await saveState({ outlook_until: null, outlook_cursor: null, outlook_listed: false });
}
