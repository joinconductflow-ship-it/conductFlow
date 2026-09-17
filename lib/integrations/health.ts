import { classifyError } from "@/lib/errors/presentation";

export type IntegrationHealth = "connected" | "needs_reconnect" | "connection_issue" | "not_connected";
export const HEALTH_LABEL: Record<IntegrationHealth, string> = {
  connected: "Connected", needs_reconnect: "Needs reconnect",
  connection_issue: "Connection issue", not_connected: "Not connected",
};

/** Configuration faults are not OAuth faults; diagnostics never become UI text. */
export function failureHealth(error: unknown): "needs_reconnect" | "connection_issue" {
  const details = error as { name?: string; reason?: string; reconnectRequired?: boolean; message?: string } | null;
  if (details?.reconnectRequired || details?.name === "CredentialDecryptionError"
    || ["reconnect", "revoked", "scope"].includes(details?.reason ?? "")
    || classifyError(error).kind === "reconnect"
    || /invalid_grant|invalid_auth|token_revoked|token_expired|account_inactive|not_authed|missing_scope|credential_decryption_failed|insufficient.*scope|auth.*scope|invalid credentials|token.*(?:expired|revoked)/i.test(details?.message ?? "")) {
    return "needs_reconnect";
  }
  return "connection_issue";
}

export function storedHealth(row: { state: string; last_error?: string | null }): IntegrationHealth {
  if (row.state === "revoked") return "needs_reconnect";
  if (row.state !== "active" && row.state !== "error") return "not_connected";
  if (row.last_error) return failureHealth(new Error(row.last_error));
  return row.state === "active" ? "connected" : "connection_issue";
}

export function providerHealth(connections: { health: IntegrationHealth }[]): IntegrationHealth {
  for (const health of ["needs_reconnect", "connection_issue", "connected"] as const) {
    if (connections.some((row) => row.health === health)) return health;
  }
  return "not_connected";
}

export function slackHealthMessage(health: IntegrationHealth): string | null {
  if (health === "needs_reconnect") return "Slack needs to be reconnected before ConductFlow can read channels.";
  if (health === "connection_issue") return "Couldn't load Slack channels right now. Try reloading channels.";
  return null;
}

export function microsoftHealthMessage(health: IntegrationHealth): string | null {
  if (health === "needs_reconnect") return "Microsoft needs to be reconnected before ConductFlow can read channels.";
  if (health === "connection_issue") return "Couldn't load Teams channels right now. Try reloading channels.";
  return null;
}
