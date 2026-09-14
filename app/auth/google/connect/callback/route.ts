import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { storeGrant, GOOGLE_TOKEN_ENDPOINT } from "@/lib/google/tokens";
import { CONNECT_STATE_COOKIE } from "@/lib/google/connect-state";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

function back(origin: string, error?: string) {
  const url = new URL("/settings", origin);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

/**
 * The org's API grant, exchanged directly against Google rather than through Supabase Auth:
 * this is not a login, it is a long-lived permission the org holds.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (denied) return back(url.origin, "google_access_denied");
  if (!code || !state) return back(url.origin, "missing_code");

  const store = await cookies();
  const expected = store.get(CONNECT_STATE_COOKIE)?.value;
  store.delete(CONNECT_STATE_COOKIE);
  // The cookie is the only thing tying this redirect to a request we started.
  if (!expected || expected.split(":")[0] !== state) return back(url.origin, "state_mismatch");

  let orgId: string | null;
  try {
    orgId = await getCurrentOrgId("Google capability callback");
  } catch (error) {
    logFailure("Google capability callback session", error);
    return back(url.origin, "auth_session_failed");
  }
  if (!orgId) return back(url.origin, "not_signed_in");

  let db: Awaited<ReturnType<typeof getServerClient>>;
  let auth: { user: { id?: string; email?: string | null } | null };
  try {
    db = await getServerClient();
    const result = await db.auth.getUser();
    auth = result.data;
  } catch (error) {
    logFailure("Google capability callback auth lookup", error);
    return back(url.origin, "auth_session_failed");
  }

  let response: Response;
  let body: { error?: unknown; refresh_token?: unknown; id_token?: unknown; scope?: unknown; expires_in?: unknown };
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: `${url.origin}/auth/google/connect/callback`,
        grant_type: "authorization_code",
      }),
    });
    body = await response.json().catch(() => ({}));
  } catch (error) {
    logFailure("Google capability token exchange", { provider: "google", operation: "token_exchange", error });
    return back(url.origin, "google_connection_failed");
  }
  if (!response.ok) {
    logFailure("Google capability token exchange", {
      provider: "google", operation: "token_exchange", status: response.status, detail: body.error,
    });
    return back(url.origin, "google_connection_failed");
  }

  // Without a refresh token the grant is useless in an hour, so treat it as a failure
  // rather than storing something that silently stops working.
  if (typeof body.refresh_token !== "string") return back(url.origin, "no_refresh_token");

  const claims = decodeIdToken(body.id_token);
  if (!claims.sub) return back(url.origin, "no_account_id");

  try {
    await storeGrant(getServiceClient(), {
      orgId,
      accountEmail: claims.email ?? auth.user?.email ?? "unknown",
      externalAccountId: claims.sub,
      refreshToken: body.refresh_token,
      // What Google granted, which can be less than what was asked for.
      scopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [],
      connectedBy: auth.user?.id ?? null,
      accessTokenExpiresAt: typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    });
  } catch (error) {
    logFailure("Google capability grant save", { provider: "google", operation: "store_grant", error });
    return back(url.origin, "google_connection_failed");
  }

  return NextResponse.redirect(new URL("/settings?connected=1", url.origin));
}

/**
 * Reads the payload of Google's ID token without verifying it. Safe here only because the
 * token arrived over TLS directly from Google's token endpoint in response to our own
 * request — it was never routed through the browser.
 */
function decodeIdToken(idToken: unknown): { sub?: string; email?: string } {
  if (typeof idToken !== "string") return {};
  const payload = idToken.split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
