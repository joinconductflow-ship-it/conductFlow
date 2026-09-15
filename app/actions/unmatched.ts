"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrgId, type ClientContact } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { slackApi, slackToken } from "@/lib/slack/client";
import { UserFacingError } from "@/lib/errors/presentation";

async function currentOrg() {
  const orgId = await getCurrentOrgId("Unmatched sources");
  if (!orgId) throw new UserFacingError("Sign in to manage unmatched sources.");
  return orgId;
}
/** Indexed name/email prefix search. Only display fields reach the browser. */
export async function searchUnmatchedClients(query: string): Promise<ClientContact[]> {
  const normalized = query.trim().slice(0, 120);
  if (normalized.length < 2) return [];
  const orgId = await currentOrg();
  const db = await getServerClient();
  const { data, error } = await db.rpc("search_unmatched_clients", { p_org: orgId, p_query: normalized });
  if (error) throw new UserFacingError("Client search is unavailable. Try again.");
  return (data ?? []).slice(0, 20).map((row: ClientContact) => ({
    id: row.id, org_id: row.org_id, name: row.name, email: row.email, kind: row.kind,
  }));
}
async function resolve(sourceId: string, action: "link" | "create" | "ignore", clientId?: string, name?: string) {
  const orgId = await currentOrg();
  const db = await getServerClient();
  const { data: source, error } = await db.from("integration_unmatched_source")
    .select("id,provider,connected_data_source_id,channel_id")
    .eq("id", sourceId).eq("org_id", orgId).eq("status", "open").maybeSingle();
  if (error || !source) throw new UserFacingError("This source is no longer open. Refresh the queue.");
  if (action === "link") {
    const { data: client, error: clientError } = await db.from("client_contact").select("id")
      .eq("id", clientId!).eq("org_id", orgId).maybeSingle();
    if (clientError || !client) throw new UserFacingError("Choose a client in your workspace.");
  }
  const service = getServiceClient();
  // Verify one explicit channel, before the atomic transaction creates any client.
  if (action !== "ignore" && source.provider === "slack") {
    try {
      if (!source.connected_data_source_id || !source.channel_id) throw new Error("Missing channel");
      const token = await slackToken(service, orgId, source.connected_data_source_id);
      const { channel } = await slackApi<{ channel: { id: string; is_private?: boolean; is_member?: boolean } }>(
        token, "conversations.info", { channel: source.channel_id },
      );
      if (channel.id !== source.channel_id || (channel.is_private && !channel.is_member)) throw new Error("Channel unavailable");
      if (!channel.is_private && !channel.is_member) await slackApi(token, "conversations.join", { channel: channel.id });
    } catch {
      throw new UserFacingError("Slack channel unavailable. Check the connection and bot membership.");
    }
  }
  const { error: resolveError } = await service.rpc("resolve_unmatched_source", {
    p_org: orgId, p_source: sourceId, p_action: action, p_client: clientId ?? null, p_name: name ?? null,
  });
  if (resolveError) throw new UserFacingError("Could not resolve this source. Refresh the queue and try again.");
  revalidatePath("/queue");
  revalidatePath("/settings");
}
export async function linkUnmatchedSource(sourceId: string, clientId: string) { await resolve(sourceId, "link", clientId); }
export async function createClientAndLink(sourceId: string, rawName: string) {
  const name = rawName.trim();
  if (!name || name.length > 160) throw new UserFacingError("Use a client name between 1 and 160 characters.");
  await resolve(sourceId, "create", undefined, name);
}
export async function ignoreUnmatchedSource(sourceId: string) { await resolve(sourceId, "ignore"); }
