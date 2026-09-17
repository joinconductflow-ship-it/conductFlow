import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { runIngest } from "@/lib/ingest/run";
import { logFailure } from "@/lib/observability/log";
import { DataSourceUnavailable } from "@/lib/google/tokens";
import { recordUnmatchedSource } from "@/lib/integrations/unmatched";
import { claimScan, releaseScan } from "@/lib/integrations/scan-lease";
import { createGraphClient, splitChannelId, GraphError, GraphRateLimitError, type TeamsMessage } from "./graph";
import { getAccessToken } from "./tokens";
import { stripHtml } from "./mail";

export interface ScanTeamsArgs { orgId?: string; now?: Date; }
export interface ScanTeamsResult {
  connectionsScanned: number; channelsScanned: number; messagesConsidered: number; ingested: number; errors: number;
  reconnectRequired: boolean; unmatchedSourcesRecorded: number;
}
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** One connection, one discovery page, and one mapped-channel page/batch per invocation. */
export async function scanTeams(db: SupabaseClient, args: ScanTeamsArgs = {}, model?: LanguageModel): Promise<ScanTeamsResult> {
  const now = args.now ?? new Date();
  const result: ScanTeamsResult = { connectionsScanned: 0, channelsScanned: 0, messagesConsidered: 0,
    ingested: 0, errors: 0, reconnectRequired: false, unmatchedSourcesRecorded: 0 };
  const connection = await claimScan(db, "microsoft", args.orgId);
  if (!connection) return result;
  let deferred = false;
  result.connectionsScanned = 1;
  try {
    const token = await getAccessToken(db, connection.org_id, "ChannelMessage.Read.All", { connectionId: connection.id });
    const graph = createGraphClient(token, { maxRetryWaitMs: 5000 });
    const { data: state, error: stateError } = await db.from("integration_scan_state").select("teams_cursor")
      .eq("connection_id", connection.id).single();
    if (stateError) throw stateError;
    const page = await graph.availableChannelPage(state.teams_cursor);
    const ids = page.channels.map((c) => c.id);
    const { data: existing, error: existingError } = ids.length
      ? await db.from("teams_channel_mapping").select("channel_id").eq("org_id", connection.org_id)
        .eq("connected_data_source_id", connection.id).in("channel_id", ids)
      : { data: [], error: null };
    if (existingError) throw existingError;
    const mapped = new Set((existing ?? []).map((m) => m.channel_id));
    for (const channel of page.channels) {
      if (mapped.has(channel.id)) continue;
      const opened = await recordUnmatchedSource(db, { orgId: connection.org_id, provider: "microsoft", sourceType: "channel",
        sourceKey: channel.id, sourceName: channel.name, sourceLabel: "Teams channel",
        connectedDataSourceId: connection.id, channelId: channel.id, lastSeenAt: now });
      if (opened) result.unmatchedSourcesRecorded++;
    }
    const { error: cursorError } = await db.from("integration_scan_state").update({ teams_cursor: page.cursor })
      .eq("connection_id", connection.id).eq("lease_token", connection.lease_token);
    if (cursorError) throw cursorError;
    const { data: mappings, error: mappingError } = await db.from("teams_channel_mapping")
      .select("id,channel_id,channel_name,client_contact_id,last_scanned_at,scan_until,scan_cursor,scan_listed")
      .eq("org_id", connection.org_id).eq("connected_data_source_id", connection.id)
      .order("scan_attempted_at").order("id").limit(1);
    if (mappingError) throw mappingError;
    const mapping = mappings?.[0];
    if (!mapping) return result; // Discovery never reads unmapped channel history or calls the model.
    async function save(values: Record<string, unknown>) {
      const { error } = await db.from("teams_channel_mapping").update(values)
        .eq("id", mapping.id).eq("org_id", connection!.org_id);
      if (error) throw error;
    }
    const oldest = mapping.last_scanned_at ? Date.parse(mapping.last_scanned_at) : now.getTime() - INITIAL_LOOKBACK_MS;
    const until = mapping.scan_until ? Date.parse(mapping.scan_until) : now.getTime();
    await save({ scan_attempted_at: now.toISOString(), scan_until: new Date(until).toISOString(),
      last_scanned_at: new Date(oldest).toISOString() });
    if (!mapping.scan_listed) {
      const { teamId, channelId } = splitChannelId(mapping.channel_id);
      const history = await graph.listChannelMessagesPage(teamId, channelId, 50, mapping.scan_cursor || undefined);
      // Graph orders by last modification, not creation; finish every page before advancing.
      const messages = history.messages.filter((message) => {
        const created = Date.parse(message.createdDateTime);
        if (!Number.isFinite(created)) throw new Error("Invalid Teams message timestamp");
        return created > oldest && created <= until;
      });
      if (messages.length) {
        const { error } = await db.from("teams_scan_pending").upsert(messages.map((message) => ({
          mapping_id: mapping.id, message_ts: Date.parse(message.createdDateTime) / 1000, message,
        })), { onConflict: "mapping_id,message_ts" });
        if (error) throw error;
      }
      await save({ scan_cursor: history.nextLink ?? null, scan_listed: !history.nextLink });
      return result;
    }
    const { data: pending, error: pendingError } = await db.from("teams_scan_pending")
      .select("message_ts,message").eq("mapping_id", mapping.id).order("message_ts").limit(20);
    if (pendingError) throw pendingError;
    const messages = (pending ?? []).map((item) => item.message as TeamsMessage);
    const lines: string[] = [];
    for (const message of messages) {
      const text = stripHtml(message.body?.content ?? "");
      if (!text) continue;
      const author = message.from?.user?.displayName ?? message.from?.application?.displayName ?? "Teams member";
      lines.push(`[${new Date(message.createdDateTime).toISOString()}] ${author}: ${text}`);
    }
    result.messagesConsidered = lines.length;
    if (lines.length) {
      const { data: client, error } = await db.from("client_contact").select("id,name")
        .eq("id", mapping.client_contact_id).eq("org_id", connection.org_id).single();
      if (error) throw error;
      await runIngest(db, { orgId: connection.org_id, clientId: client.id, clientName: client.name,
        title: `Teams #${mapping.channel_name}`, occurredAt: new Date(until).toISOString().slice(0, 10),
        transcript: `Teams #${mapping.channel_name} — ${client.name}\n\n${lines.join("\n")}` }, model);
      result.ingested++;
    }
    if (pending?.length) {
      const { error } = await db.from("teams_scan_pending").delete().eq("mapping_id", mapping.id)
        .in("message_ts", pending.map((item) => item.message_ts));
      if (error) throw error;
    }
    const { data: remaining, error: remainingError } = await db.from("teams_scan_pending").select("message_ts")
      .eq("mapping_id", mapping.id).limit(1);
    if (remainingError) throw remainingError;
    if (!remaining?.length) await save({ last_scanned_at: new Date(until).toISOString(),
      scan_until: null, scan_cursor: null, scan_listed: false });
    result.channelsScanned++;
  } catch (error) {
    result.errors++;
    result.reconnectRequired = (error instanceof DataSourceUnavailable && ["reconnect", "refused"].includes(error.reason))
      || (error instanceof GraphError && error.reconnectRequired);
    if (error instanceof GraphRateLimitError) {
      const { error: deferError } = await db.from("integration_scan_state").update({
        locked_until: new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString(),
      }).eq("connection_id", connection.id).eq("lease_token", connection.lease_token);
      if (deferError) throw deferError;
      deferred = true;
    }
    logFailure("scanTeams.connection", error);
  } finally {
    if (!deferred) await releaseScan(db, connection);
  }
  return result;
}
