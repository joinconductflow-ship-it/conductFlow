import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { sealRefreshToken } from "@/lib/google/vault";
import { requireEnv } from "@/lib/env";
import { siteOrigin } from "@/lib/http/site-origin";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = await siteOrigin();
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.cookies.set("slack_oauth_state", "", { path: "/auth/slack/connect", maxAge: 0 });
    return response;
  };
  try {
    const params = new URL(request.url).searchParams;
    const raw = (await cookies()).get("slack_oauth_state")?.value;
    if (!raw) throw new Error("invalid_state");
    const saved = JSON.parse(raw) as { state: string; userId: string; orgId: string };
    const actual = Buffer.from(params.get("state") ?? "");
    const expected = Buffer.from(saved.state);
    if (!actual.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid_state");
    const user = await getCurrentUser("Slack callback");
    const orgId = await getCurrentOrgId();
    if (!user || !orgId || user.id !== saved.userId || orgId !== saved.orgId) throw new Error("session_changed");
    if (params.get("error")) throw new Error(params.get("error")!);
    const code = params.get("code");
    if (!code) throw new Error("no_code");
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: requireEnv("SLACK_CLIENT_ID"),
        client_secret: requireEnv("SLACK_CLIENT_SECRET"), code,
        redirect_uri: `${origin}/auth/slack/connect/callback` }),
      cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("slack_exchange_failed");
    const grant = await response.json() as { ok: boolean; error?: string; access_token?: string;
      token_type?: string; scope?: string; team?: { id?: string; name?: string }; bot_user_id?: string };
    if (!grant.ok) throw new Error(grant.error ?? "slack_exchange_failed");
    if (!grant.access_token?.startsWith("xoxb-") || (grant.token_type && grant.token_type !== "bot") || !grant.team?.id) throw new Error("invalid_slack_grant");
    const scopes = (grant.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);
    const sealed = sealRefreshToken(grant.access_token, `${orgId}:slack:${grant.team.id}`);
    const { error } = await getServiceClient().from("connected_data_source").upsert({
      org_id: orgId, provider: "slack", external_account_id: grant.team.id,
      account_email: grant.team.name || grant.bot_user_id || grant.team.id, scopes,
      token_sealed: sealed.tokenSealed, dek_sealed: sealed.dekSealed, kek_version: sealed.kekVersion,
      access_token_expires_at: null, state: "active", last_error: null, connected_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id,provider,external_account_id" });
    if (error) throw new Error("slack_connection_save_failed");
    return redirect("/settings");
  } catch (e) {
    logFailure("Slack OAuth callback", e);
    return redirect("/settings?error=slack_connect_failed");
  }
}
