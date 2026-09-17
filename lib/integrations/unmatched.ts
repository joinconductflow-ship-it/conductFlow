import type { SupabaseClient } from "@supabase/supabase-js";

export type UnmatchedProvider = "google" | "slack" | "microsoft";
export type UnmatchedSourceType = "email" | "channel";
export interface UnmatchedSourceInput {
  orgId: string; provider: UnmatchedProvider; sourceType: UnmatchedSourceType;
  sourceKey: string; sourceName: string; sourceLabel?: string | null;
  connectedDataSourceId?: string | null; channelId?: string | null; lastSeenAt?: Date | string;
}
export interface MarkUnmatchedSourceLinkedArgs {
  orgId: string; provider: UnmatchedProvider; sourceType: UnmatchedSourceType;
  sourceKey: string; clientContactId: string;
}
export function normalizeUnmatchedSourceKey(type: UnmatchedSourceType, value: string): string {
  return type === "email" ? value.trim().toLowerCase() : value.trim();
}
export function escapeClientSearch(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
export function truncateUnmatchedSourceText(value: string | null | undefined): string | null {
  return value?.trim().slice(0, 240) || null;
}
/** Atomic upsert; true means a newly opened source, not another occurrence. */
export async function recordUnmatchedSource(db: SupabaseClient, input: UnmatchedSourceInput): Promise<boolean> {
  const { data, error } = await db.rpc("record_unmatched_source", {
    p_org: input.orgId, p_provider: input.provider, p_type: input.sourceType,
    p_key: normalizeUnmatchedSourceKey(input.sourceType, input.sourceKey),
    p_name: truncateUnmatchedSourceText(input.sourceName) || input.sourceKey,
    p_label: truncateUnmatchedSourceText(input.sourceLabel),
    p_connection: input.connectedDataSourceId ?? null, p_channel: input.channelId ?? null,
    p_seen: input.lastSeenAt instanceof Date ? input.lastSeenAt.toISOString() : input.lastSeenAt ?? new Date().toISOString(),
  });
  if (error) throw error;
  return data === true;
}
export async function markUnmatchedSourceLinked(db: SupabaseClient, args: MarkUnmatchedSourceLinkedArgs): Promise<void> {
  const { error } = await db.from("integration_unmatched_source").update({
    status: "linked", client_contact_id: args.clientContactId, updated_at: new Date().toISOString(),
  }).eq("org_id", args.orgId).eq("provider", args.provider).eq("source_type", args.sourceType)
    .eq("source_key", normalizeUnmatchedSourceKey(args.sourceType, args.sourceKey)).eq("status", "open");
  if (error) throw error;
}

/** Indexed normalized equality; ambiguous primary addresses fail closed. */
export async function matchGmailClient(db: SupabaseClient, orgId: string, email: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await db.rpc("match_gmail_client", {
    p_org: orgId, p_email: normalizeUnmatchedSourceKey("email", email),
  });
  if (error) throw error;
  return data?.length === 1 ? data[0] : null;
}
