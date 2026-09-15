import type { SupabaseClient } from "@supabase/supabase-js";

export interface ScanConnection {
  id: string; org_id: string; scopes: string[]; gmail_last_scanned_at: string | null; lease_token: string;
}
/** Shared by manual actions and cron. SQL claims at most one, fairly and atomically. */
export async function claimScan(db: SupabaseClient, provider: "google" | "slack", orgId?: string): Promise<ScanConnection | null> {
  const { data, error } = await db.rpc("claim_integration_scan", { p_provider: provider, p_org: orgId ?? null });
  if (error) throw error;
  return data?.[0] ?? null;
}
export async function releaseScan(db: SupabaseClient, connection: ScanConnection) {
  const { error } = await db.from("integration_scan_state").update({ locked_until: null, lease_token: null })
    .eq("connection_id", connection.id).eq("lease_token", connection.lease_token);
  if (error) throw error;
}
