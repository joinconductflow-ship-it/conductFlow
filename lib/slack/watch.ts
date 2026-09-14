import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { runIngest } from "@/lib/ingest/run";
import { logFailure } from "@/lib/observability/log";
import { DataSourceUnavailable } from "@/lib/google/tokens";
import { channelHistory, senderLookup, slackToken } from "./client";

const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export interface ScanSlackArgs { orgId?: string; now?: Date; }
export interface ScanSlackResult {
  connectionsScanned: number; channelsScanned: number; messagesConsidered: number; ingested: number; errors: number;
  reconnectRequired: boolean;
}

export async function scanSlack(db: SupabaseClient, args: ScanSlackArgs = {}, model?: LanguageModel): Promise<ScanSlackResult> {
  const now = args.now ?? new Date();
  const result: ScanSlackResult = {
    connectionsScanned: 0, channelsScanned: 0, messagesConsidered: 0, ingested: 0, errors: 0,
    reconnectRequired: false,
  };
  let query = db.from("connected_data_source").select("id,org_id")
    .eq("provider", "slack").eq("state", "active");
  if (args.orgId) query = query.eq("org_id", args.orgId);
  const { data: connections, error } = await query;
  if (error) throw error;
  for (const connection of connections ?? []) {
    try {
      const { data: mappings, error: mappingError } = await db.from("slack_channel_mapping")
        .select("id,channel_id,channel_name,client_contact_id,last_scanned_at")
        .eq("org_id", connection.org_id).eq("connected_data_source_id", connection.id);
      if (mappingError) throw mappingError;
      if (!mappings?.length) continue;
      result.connectionsScanned++;
      const token = await slackToken(db, connection.org_id, connection.id);
      const senderName = senderLookup(token);
      for (const mapping of mappings) {
        try {
          const oldest = mapping.last_scanned_at ? Date.parse(mapping.last_scanned_at) : now.getTime() - INITIAL_LOOKBACK_MS;
          const messages = await channelHistory(token, mapping.channel_id, (oldest / 1000).toFixed(3), (now.getTime() / 1000).toFixed(3));
          const lines: string[] = [];
          for (const message of messages) {
            if (!message.text?.trim()) continue;
            const name = message.user ? await senderName(message.user) : message.bot_profile?.name || message.username || "Slack app";
            let text = message.text;
            for (const match of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)) {
              text = text.replaceAll(match[0], `@${await senderName(match[1])}`);
            }
            lines.push(`[${new Date(Number(message.ts) * 1000).toISOString()}] ${name}: ${text}`);
          }
          result.messagesConsidered += lines.length;
          if (lines.length) {
            const { data: client, error: clientError } = await db.from("client_contact").select("id,name")
              .eq("id", mapping.client_contact_id).eq("org_id", connection.org_id).single();
            if (clientError || !client) throw new Error("Mapped client unavailable.");
            await runIngest(db, {
              orgId: connection.org_id, clientId: client.id, clientName: client.name,
              title: `Slack #${mapping.channel_name}`, occurredAt: now.toISOString().slice(0, 10),
              transcript: `Slack channel #${mapping.channel_name} — client: ${client.name}\n\n${lines.join("\n")}`,
            }, model);
            result.ingested++;
          }
          const { error: updateError } = await db.from("slack_channel_mapping")
            .update({ last_scanned_at: now.toISOString() }).eq("id", mapping.id).eq("org_id", connection.org_id);
          if (updateError) throw updateError;
          result.channelsScanned++;
        } catch (e) {
          result.errors++;
          logFailure("scanSlack.channel", e);
        }
      }
    } catch (e) {
      result.errors++;
      if (e instanceof DataSourceUnavailable && e.reason === "reconnect") result.reconnectRequired = true;
      logFailure("scanSlack.connection", e);
    }
  }
  return result;
}
