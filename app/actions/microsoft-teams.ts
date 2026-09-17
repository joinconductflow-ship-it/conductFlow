"use server";
import { revalidatePath } from "next/cache";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { availableChannels, type TeamsChannel } from "@/lib/microsoft/graph";
import { getAccessToken } from "@/lib/microsoft/tokens";
import { logFailure } from "@/lib/observability/log";
import { failureHealth, microsoftHealthMessage, storedHealth, type IntegrationHealth } from "@/lib/integrations/health";
import { markUnmatchedSourceLinked } from "@/lib/integrations/unmatched";

export interface TeamsChannelMapping {
  id: string; connected_data_source_id: string; channel_id: string; channel_name: string;
  client_contact_id: string; last_scanned_at: string | null;
}

async function currentOrg(requestedOrgId?: string) {
  const orgId = await getCurrentOrgId("Microsoft Teams channels");
  if (!orgId) throw new Error("Sign in to manage Microsoft Teams channels.");
  if (requestedOrgId && requestedOrgId !== orgId) throw new Error("Workspace access denied.");
  return orgId;
}

export async function listTeamsChannelMappings(requestedOrgId: string): Promise<TeamsChannelMapping[]> {
  const orgId = await currentOrg(requestedOrgId);
  const db = await getServerClient();
  const { data, error } = await db.from("teams_channel_mapping")
    .select("id,connected_data_source_id,channel_id,channel_name,client_contact_id,last_scanned_at")
    .eq("org_id", orgId).order("channel_name");
  if (error) throw error;
  return (data ?? []) as TeamsChannelMapping[];
}

export interface TeamsChannelsResult {
  channels: (TeamsChannel & { connectedDataSourceId: string; teamName: string })[];
  health: IntegrationHealth;
  message: string | null;
}

export async function listMicrosoftTeamsChannels(requestedOrgId: string): Promise<TeamsChannelsResult> {
  const orgId = await currentOrg(requestedOrgId);
  try {
    const db = getServiceClient();
    const { data, error } = await db.from("connected_data_source").select("id,account_email,state,last_error")
      .eq("org_id", orgId).eq("provider", "microsoft");
    if (error) throw error;
    if (!data?.length) return { channels: [], health: "not_connected", message: null };
    const channels: TeamsChannelsResult["channels"] = [];
    let health: IntegrationHealth = "connected";
    for (const connection of data) {
      if (connection.state !== "active") {
        const saved = storedHealth(connection);
        if (saved === "needs_reconnect" || health !== "needs_reconnect") health = saved;
        continue;
      }
      try {
        const items = await availableChannels(await getAccessToken(db, orgId, "ChannelMessage.Read.All", { connectionId: connection.id }));
        channels.push(...items.map((channel) => ({ ...channel,
          connectedDataSourceId: connection.id, teamName: channel.teamName,
        })));
      } catch (cause) {
        const failed = failureHealth(cause);
        if (failed === "needs_reconnect" || health !== "needs_reconnect") health = failed;
        logFailure("Microsoft Teams channels load", { provider: "microsoft", operation: "teams.channels.list",
          orgId, dataSourceId: connection.id, error: cause });
        if (failed === "needs_reconnect") {
          const { error: updateError } = await db.from("connected_data_source").update({
            state: "error", last_error: "reconnect_required", updated_at: new Date().toISOString(),
          }).eq("id", connection.id).eq("org_id", orgId).eq("provider", "microsoft").eq("state", "active");
          if (updateError) logFailure("Microsoft Teams connection health update", { orgId, dataSourceId: connection.id, error: updateError });
        }
      }
    }
    return { channels, health, message: microsoftHealthMessage(health) };
  } catch (error) {
    logFailure("Microsoft Teams channels load", {
      provider: "microsoft",
      operation: "teams.channels.list",
      orgId,
      error,
    });
    const health = failureHealth(error);
    return { channels: [], health, message: microsoftHealthMessage(health) };
  }
}

/** Saving an already-mapped channel changes its client, preserving the scan checkpoint. */
export async function addTeamsChannelMapping(requestedOrgId: string, connectionId: string, channelId: string, _channelName: string, clientId: string) {
  const orgId = await currentOrg(requestedOrgId);
  const db = await getServerClient();
  const { data: client, error: clientError } = await db.from("client_contact")
    .select("id").eq("id", clientId).eq("org_id", orgId).single();
  if (clientError || !client) throw new Error("Choose a client in your workspace.");
  const token = await getAccessToken(getServiceClient(), orgId, "ChannelMessage.Read.All", { connectionId });
  const channel = (await availableChannels(token)).find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel unavailable. Check your Teams membership and reload channels.");
  const { error } = await db.from("teams_channel_mapping").upsert({
    org_id: orgId, connected_data_source_id: connectionId, channel_id: channel.id,
    channel_name: channel.name, client_contact_id: clientId,
  }, { onConflict: "connected_data_source_id,channel_id" });
  if (error) throw error;
  try {
    await markUnmatchedSourceLinked(getServiceClient(), {
      orgId,
      provider: "microsoft",
      sourceType: "channel",
      sourceKey: channel.id,
      clientContactId: clientId,
    });
  } catch (cause) {
    // Mapping a channel must remain usable even if an older deployment has not run the
    // optional review-queue migration yet.
    logFailure("Microsoft Teams unmatched source link", { orgId, channelId: channel.id, error: cause });
  }
  revalidatePath("/settings");
  revalidatePath("/queue");
}

export async function removeTeamsChannelMapping(id: string) {
  const orgId = await currentOrg();
  const db = await getServerClient();
  const { error } = await db.from("teams_channel_mapping").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/queue");
}
