import "server-only";
import { getServiceClient } from "@/lib/db/service";
import { openRefreshToken } from "@/lib/google/vault";
import { logFailure } from "@/lib/observability/log";
import { failureHealth, storedHealth, type IntegrationHealth } from "./health";

/** Local credential verification only: no provider API calls, no sealed data returned. */
export async function connectionHealth(orgId: string): Promise<Record<string, IntegrationHealth>> {
  const { data, error } = await getServiceClient().from("connected_data_source")
    .select("id,org_id,provider,external_account_id,state,last_error,token_sealed,dek_sealed")
    .eq("org_id", orgId).in("provider", ["google", "slack"]);
  if (error) throw error;
  const health: Record<string, IntegrationHealth> = {};
  for (const row of data ?? []) {
    health[row.id] = storedHealth(row);
    if (row.state !== "active") continue;
    try {
      const token = openRefreshToken({ tokenSealed: row.token_sealed, dekSealed: row.dek_sealed },
        `${orgId}:${row.provider}:${row.external_account_id}`);
      if (!token || (row.provider === "slack" && !token.startsWith("xoxb-"))) health[row.id] = "needs_reconnect";
    } catch (cause) {
      health[row.id] = failureHealth(cause);
      logFailure("Settings credential health", {
        route: "/settings", provider: row.provider, orgId, dataSourceId: row.id, error: cause,
      });
    }
  }
  return health;
}
