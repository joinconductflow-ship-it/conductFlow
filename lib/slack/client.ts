import type { SupabaseClient } from "@supabase/supabase-js";
import { CredentialDecryptionError, openRefreshToken } from "@/lib/google/vault";
import { DataSourceUnavailable } from "@/lib/google/tokens";
import { logFailure } from "@/lib/observability/log";

interface SlackResponse { ok: boolean; error?: string; response_metadata?: { next_cursor?: string }; }

export class SlackApiError extends Error {
  readonly reconnectRequired: boolean;
  constructor(readonly code: string, readonly status: number) {
    super(`Slack API: ${code} (${status}).`);
    this.name = "SlackApiError";
    this.reconnectRequired = ["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "missing_scope"].includes(code)
      || status === 401;
  }
}
export interface SlackChannel { id: string; name: string; is_private?: boolean; is_member?: boolean; }
export interface SlackMessage {
  ts: string; text?: string; user?: string; username?: string; bot_profile?: { name?: string };
}

export class SlackRateLimitError extends SlackApiError {
  constructor(readonly retryAfterSeconds: number) { super("rate_limited", 429); }
}

export async function slackApi<T>(token: string, method: string, params: Record<string, string> = {}, retried = false): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params), cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 429) {
    const raw = response.headers.get("retry-after") ?? "60";
    const seconds = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
    const retryAfter = Number.isFinite(seconds) ? Math.max(1, seconds) : 60;
    // Short waits retry once; long waits are durably deferred by the watcher.
    if (!retried && retryAfter <= 5) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return slackApi<T>(token, method, params, true);
    }
    throw new SlackRateLimitError(retryAfter);
  }
  if (!response.ok) throw new SlackApiError("http_error", response.status);
  const data = await response.json() as T & SlackResponse;
  if (!data.ok) throw new SlackApiError(data.error ?? "request_failed", response.status);
  return data;
}

export async function slackToken(db: SupabaseClient, orgId: string, connectionId: string): Promise<string> {
  const { data, error } = await db.from("connected_data_source")
    .select("external_account_id,token_sealed,dek_sealed").eq("id", connectionId)
    .eq("org_id", orgId).eq("provider", "slack").eq("state", "active").single();
  if (error || !data) throw new Error("Slack connection is unavailable.");
  try {
    return openRefreshToken({ tokenSealed: data.token_sealed, dekSealed: data.dek_sealed },
      `${orgId}:slack:${data.external_account_id}`);
  } catch (cause) {
    if (!(cause instanceof CredentialDecryptionError)) throw cause;
    logFailure("Slack credential decrypt", {
      provider: "slack",
      operation: "decrypt_refresh_token",
      orgId,
      dataSourceId: connectionId,
      error: cause,
    });
    const { error: updateError } = await db.from("connected_data_source")
      .update({
        state: "error",
        last_error: "credential_decryption_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId)
      .eq("org_id", orgId)
      .eq("provider", "slack");
    if (updateError) {
      logFailure("Slack credential decrypt state update", {
        provider: "slack",
        operation: "mark_reconnect_required",
        orgId,
        dataSourceId: connectionId,
        error: updateError,
      });
    }
    throw new DataSourceUnavailable(
      "Slack needs to be reconnected before ConductFlow can read channels.",
      "reconnect",
    );
  }
}

export async function availableChannelPage(token: string, cursor = "") {
  const page = await slackApi<SlackResponse & { channels: SlackChannel[] }>(token, "conversations.list", {
    types: "public_channel,private_channel", exclude_archived: "true", limit: "100", cursor,
  });
  return { channels: page.channels, cursor: page.response_metadata?.next_cursor?.trim() ?? "" };
}
export async function historyPage(token: string, channel: string, oldest: string, latest: string, cursor = "") {
  const page = await slackApi<SlackResponse & { messages: SlackMessage[]; has_more?: boolean }>(token,
    "conversations.history", { channel, oldest, latest, inclusive: "true", limit: "100", cursor });
  const next = page.response_metadata?.next_cursor?.trim() ?? "";
  if (page.has_more && !next) throw new Error("Slack returned incomplete history. Retry the scan.");
  return { messages: page.messages.filter((m) => Number(m.ts) > Number(oldest) && Number(m.ts) <= Number(latest)), cursor: next };
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
