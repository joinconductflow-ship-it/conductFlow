import type { SupabaseClient } from "@supabase/supabase-js";
import { CredentialDecryptionError, openRefreshToken, sealRefreshToken, type SealedToken } from "./vault";
import { logAudit } from "@/lib/audit/log";
import type { GoogleApiError } from "./api-error";
import { logFailure } from "@/lib/observability/log";

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** No grant, a revoked grant, or a grant that never included the scope being asked for. */
export class DataSourceUnavailable extends Error {
  constructor(message: string, readonly reason: "missing" | "revoked" | "scope" | "refused" | "reconnect") {
    super(message);
    this.name = "DataSourceUnavailable";
  }
}

export interface TokenDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Watchers must use the exact connection they leased, including after account replacement. */
  connectionId?: string;
}

interface CachedToken { accessToken: string; expiresAtMs: number }

// Access tokens live an hour and are never persisted — storing them would double the
// secret surface to save a little latency. Process memory is enough.
const cache = new Map<string, CachedToken>();

/** Exported for tests; a process restart clears this anyway. */
export function clearTokenCache() { cache.clear(); }

/**
 * Drops one connection's cached access token, forcing the next `getAccessToken` call to
 * refresh instead of reusing a token the provider just rejected (a downstream 401 from
 * Gmail, say). Narrower than `clearTokenCache` so one org's rejection can't cost every
 * other org an extra refresh round trip.
 */
export function invalidateCachedToken(dataSourceId: string) { cache.delete(dataSourceId); }

/**
 * Records a downstream Calendar/Drive auth rejection without treating every expired access
 * token as a permanently broken connection. A 401 evicts only the cached token; an
 * insufficient-scope 403 needs new consent, so settings should show an error immediately.
 */
export async function recordGoogleApiAuthFailure(
  db: SupabaseClient,
  orgId: string,
  error: GoogleApiError,
): Promise<void> {
  if (!error.reconnectRequired) return;

  const { data: source, error: lookupError } = await db.from("connected_data_source")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", "google")
    .eq("state", "active")
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!source?.id) return;

  invalidateCachedToken(source.id as string);
  if (error.status !== 403) return;

  const { error: updateError } = await db.from("connected_data_source")
    .update({
      state: "error",
      last_error: error.message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", source.id as string);
  if (updateError) throw updateError;
}

export function aadFor(orgId: string, provider: string, externalAccountId: string): string {
  return `${orgId}:${provider}:${externalAccountId}`;
}

const EXPIRY_MARGIN_MS = 60_000;

/**
 * Hands a caller a usable Google access token, refreshing when the cached one is close to
 * expiry. Every call is audited: a token whose use cannot be explained to a customer is
 * worse than no token.
 *
 * `db` must be a service-role client — `connected_data_source` is granted to nobody else.
 */
export async function getAccessToken(
  db: SupabaseClient, orgId: string, requiredScope: string, deps: TokenDeps = {},
): Promise<string> {
  const now = deps.now?.() ?? Date.now();

  let query = db.from("connected_data_source")
    .select("id,org_id,provider,external_account_id,scopes,state,token_sealed,dek_sealed")
    .eq("org_id", orgId).eq("provider", "google");
  if (deps.connectionId) query = query.eq("id", deps.connectionId);
  const { data: row, error } = await query.maybeSingle();
  if (error) throw error;
  if (!row) throw new DataSourceUnavailable("No Google account is connected.", "missing");
  if (row.state !== "active")
    throw new DataSourceUnavailable(`The Google connection is ${row.state}.`, "revoked");

  // Asking for a scope the user never granted is a bug in the caller, not a prompt to
  // re-consent behind their back.
  if (!(row.scopes as string[]).includes(requiredScope))
    throw new DataSourceUnavailable(`The connected account did not grant ${requiredScope}.`, "scope");

  await logAudit({
    orgId, actor: "agent", action: "read",
    target: `data_source:${row.id}:${requiredScope}`,
  });

  const cached = cache.get(row.id as string);
  if (cached && cached.expiresAtMs - now > EXPIRY_MARGIN_MS) return cached.accessToken;

  let refreshToken: string;
  try {
    refreshToken = openRefreshToken(
      { tokenSealed: row.token_sealed as string, dekSealed: row.dek_sealed as string },
      aadFor(row.org_id as string, row.provider as string, row.external_account_id as string),
    );
  } catch (error) {
    if (!(error instanceof CredentialDecryptionError)) throw error;
    logFailure("Google credential decrypt", {
      provider: "google",
      operation: "decrypt_refresh_token",
      orgId,
      dataSourceId: row.id,
      error,
    });
    const { error: updateError } = await db.from("connected_data_source")
      .update({
        state: "error",
        last_error: "credential_decryption_failed",
        updated_at: new Date(now).toISOString(),
      })
      .eq("id", row.id)
      .eq("org_id", orgId)
      .eq("provider", "google");
    if (updateError) {
      logFailure("Google credential decrypt state update", {
        provider: "google",
        operation: "mark_reconnect_required",
        orgId,
        dataSourceId: row.id,
        error: updateError,
      });
    }
    invalidateCachedToken(row.id as string);
    throw new DataSourceUnavailable(
      "Google needs to be reconnected before this integration can run.",
      "reconnect",
    );
  }

  const refreshed = await refreshAccessToken(refreshToken, deps);
  if (!refreshed.ok) {
    // Only a permanent refusal (the grant itself is gone) is worth surfacing on the
    // settings screen as needing reconnection. A transient one — Google's token endpoint
    // rate-limiting or erroring for a moment — must not strand a healthy connection in
    // `error` state, or every later call rejects before even trying to refresh again.
    if (refreshed.permanent) {
      await db.from("connected_data_source")
        .update({ state: "error", last_error: refreshed.error, updated_at: new Date(now).toISOString() })
        .eq("id", row.id);
    }
    throw new DataSourceUnavailable(refreshed.error, refreshed.permanent ? "reconnect" : "refused");
  }

  cache.set(row.id as string, {
    accessToken: refreshed.accessToken,
    expiresAtMs: now + refreshed.expiresInSeconds * 1000,
  });

  await db.from("connected_data_source").update({
    access_token_expires_at: new Date(now + refreshed.expiresInSeconds * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  }).eq("id", row.id);

  await logAudit({
    orgId, actor: "agent", action: "update",
    target: `data_source:${row.id}:refresh`,
  });

  return refreshed.accessToken;
}

type RefreshOutcome =
  | { ok: true; accessToken: string; expiresInSeconds: number }
  | { ok: false; error: string; permanent: boolean };

async function refreshAccessToken(
  refreshToken: string, deps: TokenDeps,
): Promise<RefreshOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    // `invalid_grant` is Google's own signal that the refresh token itself is dead — every
    // other failure (rate limiting, a 5xx, a network blip) is worth retrying later, not a
    // reason to mark the connection broken.
    const permanent = body?.error === "invalid_grant";
    return { ok: false, error: `Google refused the refresh: ${detail}`, permanent };
  }
  if (typeof body?.access_token !== "string")
    return { ok: false, error: "Google returned no access token.", permanent: false };

  return {
    ok: true,
    accessToken: body.access_token,
    expiresInSeconds: typeof body.expires_in === "number" ? body.expires_in : 3600,
  };
}

export interface StoreGrantArgs {
  orgId: string;
  accountEmail: string;
  externalAccountId: string;
  refreshToken: string;
  scopes: string[];
  connectedBy: string | null;
  accessTokenExpiresAt?: string | null;
}

/**
 * Upserts the org's grant. Scopes are stored as Google actually granted them, never as
 * they were requested — a user can uncheck a box on the consent screen.
 */
export async function storeGrant(db: SupabaseClient, args: StoreGrantArgs): Promise<string> {
  const aad = aadFor(args.orgId, "google", args.externalAccountId);
  const sealed: SealedToken = sealRefreshToken(args.refreshToken, aad);

  // One org holds one active Google connection. The upsert below keys on
  // (org_id, provider, external_account_id), so connecting a *different* Google account
  // would otherwise insert a second row instead of replacing the first — `getAccessToken`'s
  // `.maybeSingle()` lookup then errors on finding two. Revoke any other active row first so
  // reconnecting with a new account cleanly supersedes the old one.
  const { data: others } = await db.from("connected_data_source")
    .select("id").eq("org_id", args.orgId).eq("provider", "google").eq("state", "active")
    .neq("external_account_id", args.externalAccountId);
  if (others && others.length > 0) {
    await db.from("connected_data_source")
      .update({ state: "revoked", updated_at: new Date().toISOString() })
      .in("id", others.map((r) => r.id as string));
  }

  const { data, error } = await db.from("connected_data_source").upsert({
    org_id: args.orgId, provider: "google",
    account_email: args.accountEmail, external_account_id: args.externalAccountId,
    scopes: args.scopes,
    token_sealed: sealed.tokenSealed, dek_sealed: sealed.dekSealed,
    kek_version: sealed.kekVersion,
    access_token_expires_at: args.accessTokenExpiresAt ?? null,
    state: "active", last_error: null,
    connected_by: args.connectedBy, updated_at: new Date().toISOString(),
  }, { onConflict: "org_id,provider,external_account_id" }).select("id").single();
  if (error) throw error;

  cache.delete(data.id as string);
  await logAudit({
    orgId: args.orgId, actor: "human", action: "create",
    target: `data_source:${data.id}:connect`,
  });
  return data.id as string;
}
