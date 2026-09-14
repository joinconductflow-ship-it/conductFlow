"use server";
import { revalidatePath } from "next/cache";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { availableChannels, slackApi, slackToken, type SlackChannel } from "@/lib/slack/client";
import { logFailure } from "@/lib/observability/log";
import { failureHealth, slackHealthMessage, storedHealth, type IntegrationHealth } from "@/lib/integrations/health";

export interface ChannelMapping {
  id: string; connected_data_source_id: string; channel_id: string; channel_name: string;
  client_contact_id: string; last_scanned_at: string | null;
}

async function currentOrg(requestedOrgId?: string) {
  const orgId = await getCurrentOrgId("Slack channels");
  if (!orgId) throw new Error("Sign in to manage Slack channels.");
  if (requestedOrgId && requestedOrgId !== orgId) throw new Error("Workspace access denied.");
  return orgId;
}

export async function listChannelMappings(requestedOrgId: string): Promise<ChannelMapping[]> {
  const orgId = await currentOrg(requestedOrgId);
  const db = await getServerClient();
  const { data, error } = await db.from("slack_channel_mapping")
    .select("id,connected_data_source_id,channel_id,channel_name,client_contact_id,last_scanned_at")
    .eq("org_id", orgId).order("channel_name");
  if (error) throw error;
  return (data ?? []) as ChannelMapping[];
}

export interface SlackChannelsResult {
  channels: (SlackChannel & { connectedDataSourceId: string; teamName: string })[];
  health: IntegrationHealth;
  message: string | null;
}

export async function listSlackChannels(requestedOrgId: string): Promise<SlackChannelsResult> {
  const orgId = await currentOrg(requestedOrgId);
  try {
    const db = getServiceClient();
    const { data, error } = await db.from("connected_data_source").select("id,account_email,state,last_error")
      .eq("org_id", orgId).eq("provider", "slack");
    if (error) throw error;
    if (!data?.length) return { channels: [], health: "not_connected", message: null };
    const channels: SlackChannelsResult["channels"] = [];
    let health: IntegrationHealth = "connected";
    for (const connection of data) {
      if (connection.state !== "active") {
        const saved = storedHealth(connection);
        if (saved === "needs_reconnect" || health !== "needs_reconnect") health = saved;
        continue;
      }
      try {
        const items = await availableChannels(await slackToken(db, orgId, connection.id));
        channels.push(...items.map((channel) => ({ ...channel,
          connectedDataSourceId: connection.id, teamName: connection.account_email,
        })));
      } catch (cause) {
        const failed = failureHealth(cause);
        if (failed === "needs_reconnect" || health !== "needs_reconnect") health = failed;
        logFailure("Slack channels load", { provider: "slack", operation: "conversations.list",
          orgId, dataSourceId: connection.id, error: cause });
        if (failed === "needs_reconnect") {
          const { error: updateError } = await db.from("connected_data_source").update({
            state: "error", last_error: "reconnect_required", updated_at: new Date().toISOString(),
          }).eq("id", connection.id).eq("org_id", orgId).eq("provider", "slack").eq("state", "active");
          if (updateError) logFailure("Slack connection health update", { orgId, dataSourceId: connection.id, error: updateError });
        }
      }
    }
    return { channels, health, message: slackHealthMessage(health) };
  } catch (error) {
    logFailure("Slack channels load", {
      provider: "slack",
      operation: "conversations.list",
      orgId,
      error,
    });
    const health = failureHealth(error);
    return { channels: [], health, message: slackHealthMessage(health) };
  }
}

/** Saving an already-mapped channel changes its client, preserving the scan checkpoint. */
export async function addChannelMapping(requestedOrgId: string, connectionId: string, channelId: string, _channelName: string, clientId: string) {
  const orgId = await currentOrg(requestedOrgId);
  const db = await getServerClient();
  const { data: client, error: clientError } = await db.from("client_contact")
    .select("id").eq("id", clientId).eq("org_id", orgId).single();
  if (clientError || !client) throw new Error("Choose a client in your workspace.");
  const token = await slackToken(getServiceClient(), orgId, connectionId);
  const channel = (await availableChannels(token)).find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel unavailable. Invite the bot to private channels first.");
  if (!channel.is_private && !channel.is_member) await slackApi(token, "conversations.join", { channel: channel.id });
  const { error } = await db.from("slack_channel_mapping").upsert({
    org_id: orgId, connected_data_source_id: connectionId, channel_id: channel.id,
    channel_name: channel.name, client_contact_id: clientId,
  }, { onConflict: "connected_data_source_id,channel_id" });
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/queue");
}

export async function removeChannelMapping(id: string) {
  const orgId = await currentOrg();
  const db = await getServerClient();
  const { error } = await db.from("slack_channel_mapping").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/queue");
}
