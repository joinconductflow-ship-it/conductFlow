import type { SupabaseClient } from "@supabase/supabase-js";
import { openRefreshToken } from "@/lib/google/vault";

interface SlackResponse { ok: boolean; error?: string; response_metadata?: { next_cursor?: string }; }
export interface SlackChannel { id: string; name: string; is_private?: boolean; is_member?: boolean; }
export interface SlackMessage {
  ts: string; text?: string; user?: string; username?: string; bot_profile?: { name?: string };
}

export async function slackApi<T>(token: string, method: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params), cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 429) throw new Error(`Slack rate limited this scan. Retry after ${response.headers.get("retry-after") ?? "60"} seconds.`);
  if (!response.ok) throw new Error(`Slack request failed (${response.status}).`);
  const data = await response.json() as T & SlackResponse;
  if (!data.ok) throw new Error(`Slack: ${data.error ?? "request_failed"}`);
  return data;
}

export async function slackToken(db: SupabaseClient, orgId: string, connectionId: string): Promise<string> {
  const { data, error } = await db.from("connected_data_source")
    .select("external_account_id,token_sealed,dek_sealed").eq("id", connectionId)
    .eq("org_id", orgId).eq("provider", "slack").eq("state", "active").single();
  if (error || !data) throw new Error("Slack connection is unavailable.");
  return openRefreshToken({ tokenSealed: data.token_sealed, dekSealed: data.dek_sealed },
    `${orgId}:slack:${data.external_account_id}`);
}

export async function availableChannels(token: string): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor = "";
  do {
    const page = await slackApi<SlackResponse & { channels: SlackChannel[] }>(token, "conversations.list", {
      types: "public_channel,private_channel", exclude_archived: "true", limit: "200", cursor,
    });
    channels.push(...page.channels);
    cursor = page.response_metadata?.next_cursor?.trim() ?? "";
  } while (cursor);
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

export async function channelHistory(token: string, channel: string, oldest: string, latest: string): Promise<SlackMessage[]> {
  const messages = new Map<string, SlackMessage>();
  let cursor = "";
  do {
    const page = await slackApi<SlackResponse & { messages: SlackMessage[]; has_more?: boolean }>(token, "conversations.history", {
      channel, oldest, latest, inclusive: "true", limit: "100", cursor,
    });
    // Include the upper boundary, then discard the already-scanned lower boundary.
    // Otherwise a message exactly at the checkpoint is excluded by both adjacent scans.
    for (const message of page.messages) {
      if (Number(message.ts) > Number(oldest) && Number(message.ts) <= Number(latest)) {
        messages.set(message.ts, message);
      }
    }
    cursor = page.response_metadata?.next_cursor?.trim() ?? "";
    if (page.has_more && !cursor) throw new Error("Slack returned incomplete history. Retry the scan.");
  } while (cursor);
  return [...messages.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
}

export function senderLookup(token: string) {
  const names = new Map<string, string>();
  return async (id: string): Promise<string> => {
    if (names.has(id)) return names.get(id)!;
    const { user } = await slackApi<{ user: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } } }>(token, "users.info", { user: id });
    const name = user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || "Slack member";
    names.set(id, name);
    return name;
  };
}
