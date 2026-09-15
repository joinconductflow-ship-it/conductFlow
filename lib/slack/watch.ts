import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { runIngest } from "@/lib/ingest/run";
import { logFailure } from "@/lib/observability/log";
import { DataSourceUnavailable } from "@/lib/google/tokens";
import { recordUnmatchedSource } from "@/lib/integrations/unmatched";
import { claimScan, releaseScan } from "@/lib/integrations/scan-lease";
import { availableChannelPage, historyPage, senderLookup, slackToken, SlackApiError, SlackRateLimitError, type SlackMessage } from "./client";

export interface ScanSlackArgs { orgId?: string; now?: Date; }
export interface ScanSlackResult {
  connectionsScanned: number; channelsScanned: number; messagesConsidered: number; ingested: number; errors: number;
  reconnectRequired: boolean; unmatchedSourcesRecorded: number;
}
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** One connection, one discovery page, and one mapped-channel page/batch per invocation. */
export async function scanSlack(db: SupabaseClient, args: ScanSlackArgs = {}, model?: LanguageModel): Promise<ScanSlackResult> {
  const now = args.now ?? new Date();
  const result: ScanSlackResult = { connectionsScanned: 0, channelsScanned: 0, messagesConsidered: 0,
    ingested: 0, errors: 0, reconnectRequired: false, unmatchedSourcesRecorded: 0 };
  const connection = await claimScan(db, "slack", args.orgId);
  if (!connection) return result;
  let deferred = false;
  result.connectionsScanned = 1;
  try {
    const token = await slackToken(db, connection.org_id, connection.id);
    const { data: state, error: stateError } = await db.from("integration_scan_state").select("slack_cursor")
      .eq("connection_id", connection.id).single();
    if (stateError) throw stateError;
    const page = await availableChannelPage(token, state.slack_cursor);
    const ids = page.channels.map((c) => c.id);
    const { data: existing, error: existingError } = ids.length
      ? await db.from("slack_channel_mapping").select("channel_id").eq("org_id", connection.org_id)
        .eq("connected_data_source_id", connection.id).in("channel_id", ids)
      : { data: [], error: null };
    if (existingError) throw existingError;
    const mapped = new Set((existing ?? []).map((m) => m.channel_id));
    for (const channel of page.channels) {
      if (mapped.has(channel.id) || (!channel.is_private && !channel.is_member)) continue;
      const opened = await recordUnmatchedSource(db, { orgId: connection.org_id, provider: "slack", sourceType: "channel",
        sourceKey: channel.id, sourceName: channel.name, sourceLabel: channel.is_private ? "Private Slack channel" : "Public Slack channel",
        connectedDataSourceId: connection.id, channelId: channel.id, lastSeenAt: now });
      if (opened) result.unmatchedSourcesRecorded++;
    }
    const { error: cursorError } = await db.from("integration_scan_state").update({ slack_cursor: page.cursor })
      .eq("connection_id", connection.id).eq("lease_token", connection.lease_token);
    if (cursorError) throw cursorError;
    const { data: mappings, error: mappingError } = await db.from("slack_channel_mapping")
      .select("id,channel_id,channel_name,client_contact_id,last_scanned_at,scan_until,scan_cursor,scan_listed")
      .eq("org_id", connection.org_id).eq("connected_data_source_id", connection.id)
      .order("scan_attempted_at").order("id").limit(1);
    if (mappingError) throw mappingError;
    const mapping = mappings?.[0];
    if (!mapping) return result; // Discovery never reads unmapped channel history or calls the model.
    async function save(values: Record<string, unknown>) {
      const { error } = await db.from("slack_channel_mapping").update(values)
        .eq("id", mapping.id).eq("org_id", connection!.org_id);
      if (error) throw error;
    }
    const oldest = mapping.last_scanned_at ? Date.parse(mapping.last_scanned_at) : now.getTime() - INITIAL_LOOKBACK_MS;
    const until = mapping.scan_until ? Date.parse(mapping.scan_until) : now.getTime();
    await save({ scan_attempted_at: now.toISOString(), scan_until: new Date(until).toISOString(),
      last_scanned_at: new Date(oldest).toISOString() });
    if (!mapping.scan_listed) {
      const history = await historyPage(token, mapping.channel_id, (oldest / 1000).toFixed(3),
        (until / 1000).toFixed(3), mapping.scan_cursor ?? "");
      if (history.messages.length) {
        const { error } = await db.from("slack_scan_pending").upsert(history.messages.map((message) => ({
          mapping_id: mapping.id, message_ts: message.ts, message,
        })), { onConflict: "mapping_id,message_ts" });
        if (error) throw error;
      }
      await save({ scan_cursor: history.cursor, scan_listed: !history.cursor });
      return result;
    }
    const { data: pending, error: pendingError } = await db.from("slack_scan_pending")
      .select("message_ts,message").eq("mapping_id", mapping.id).order("message_ts").limit(20);
    if (pendingError) throw pendingError;
    const messages = (pending ?? []).map((item) => item.message as SlackMessage);
    const lookup = senderLookup(token);
    const names = new Map<string, string>();
    async function nameFor(id: string) {
      if (names.has(id)) return names.get(id)!;
      // Bound provider fan-out, including adversarial messages with many mentions.
      if (names.size >= 20) return id;
      const name = await lookup(id);
      names.set(id, name);
      return name;
    }
    const lines: string[] = [];
    for (const message of messages) {
      if (!message.text?.trim()) continue;
      const author = message.user ? await nameFor(message.user) : message.bot_profile?.name ?? message.username ?? "Slack member";
      let text = message.text;
      for (const match of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)) text = text.replaceAll(match[0], `@${await nameFor(match[1])}`);
      lines.push(`[${new Date(Number(message.ts) * 1000).toISOString()}] ${author}: ${text}`);
    }
    result.messagesConsidered = lines.length;
    if (lines.length) {
      const { data: client, error } = await db.from("client_contact").select("id,name")
        .eq("id", mapping.client_contact_id).eq("org_id", connection.org_id).single();
      if (error) throw error;
      await runIngest(db, { orgId: connection.org_id, clientId: client.id, clientName: client.name,
        title: `Slack #${mapping.channel_name}`, occurredAt: new Date(until).toISOString().slice(0, 10),
        transcript: `Slack #${mapping.channel_name} — ${client.name}\n\n${lines.join("\n")}` }, model);
      result.ingested++;
    }
    if (pending?.length) {
      const { error } = await db.from("slack_scan_pending").delete().eq("mapping_id", mapping.id)
        .in("message_ts", pending.map((item) => item.message_ts));
      if (error) throw error;
    }
    const { data: remaining, error: remainingError } = await db.from("slack_scan_pending").select("message_ts")
      .eq("mapping_id", mapping.id).limit(1);
    if (remainingError) throw remainingError;
    if (!remaining?.length) await save({ last_scanned_at: new Date(until).toISOString(),
      scan_until: null, scan_cursor: null, scan_listed: false });
    result.channelsScanned++;
  } catch (error) {
    result.errors++;
    result.reconnectRequired = (error instanceof DataSourceUnavailable && ["reconnect", "refused"].includes(error.reason))
      || (error instanceof SlackApiError && error.reconnectRequired);
    if (error instanceof SlackRateLimitError) {
      const { error: deferError } = await db.from("integration_scan_state").update({
        locked_until: new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString(),
      }).eq("connection_id", connection.id).eq("lease_token", connection.lease_token);
      if (deferError) throw deferError;
      deferred = true;
    }
    logFailure("scanSlack.connection", error);
  } finally {
    if (!deferred) await releaseScan(db, connection);
  }
  return result;
}
