import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { storeGrant, decodeIdToken, MICROSOFT_TOKEN_ENDPOINT } from "@/lib/microsoft/tokens";
import { requireEnv } from "@/lib/env";
import { siteOrigin } from "@/lib/http/site-origin";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = await siteOrigin();
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.cookies.set("microsoft_oauth_state", "", { path: "/auth/microsoft/connect", maxAge: 0 });
    return response;
  };
  try {
    const params = new URL(request.url).searchParams;
    const raw = (await cookies()).get("microsoft_oauth_state")?.value;
    if (!raw) throw new Error("invalid_state");
    const saved = JSON.parse(raw) as { state: string; userId: string; orgId: string };
    const actual = Buffer.from(params.get("state") ?? "");
    const expected = Buffer.from(saved.state);
    if (!actual.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid_state");
    const user = await getCurrentUser("Microsoft callback");
    const orgId = await getCurrentOrgId();
    if (!user || !orgId || user.id !== saved.userId || orgId !== saved.orgId) throw new Error("session_changed");
    if (params.get("error")) throw new Error(params.get("error")!);
    const code = params.get("code");
    if (!code) throw new Error("no_code");
    const response = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: requireEnv("MICROSOFT_CLIENT_ID"),
        client_secret: requireEnv("MICROSOFT_CLIENT_SECRET"), code, grant_type: "authorization_code",
        redirect_uri: `${origin}/auth/microsoft/connect/callback` }),
      cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("microsoft_exchange_failed");
    const grant = await response.json() as { refresh_token?: string; id_token?: string; scope?: string; expires_in?: number };
    if (!grant.refresh_token) throw new Error("invalid_microsoft_grant");
    const claims = decodeIdToken(grant.id_token);
    const accountId = claims.oid || claims.sub;
    if (!accountId) throw new Error("no_account_id");
    await storeGrant(getServiceClient(), {
      orgId, externalAccountId: accountId,
      accountEmail: claims.email || claims.preferred_username || user.email || "unknown",
      refreshToken: grant.refresh_token,
      scopes: (grant.scope ?? "").split(" ").filter(Boolean),
      connectedBy: user.id,
      accessTokenExpiresAt: typeof grant.expires_in === "number"
        ? new Date(Date.now() + grant.expires_in * 1000).toISOString() : null,
    });
    return redirect("/settings");
  } catch (e) {
    logFailure("Microsoft OAuth callback", e);
    return redirect("/settings?error=microsoft_connect_failed");
  }
}
