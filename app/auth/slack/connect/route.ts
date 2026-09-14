import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { requireEnv } from "@/lib/env";
import { siteOrigin } from "@/lib/http/site-origin";
import { SLACK_CAPABILITIES } from "@/lib/slack/scopes";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

export async function GET() {
  const origin = await siteOrigin();
  try {
    const user = await getCurrentUser("Slack connect");
    const orgId = await getCurrentOrgId();
    if (!user || !orgId) throw new Error("Sign in to connect Slack.");
    const state = randomBytes(32).toString("hex");
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.search = new URLSearchParams({ client_id: requireEnv("SLACK_CLIENT_ID"),
      scope: SLACK_CAPABILITIES.slack_watch.scopes.join(","),
      redirect_uri: `${origin}/auth/slack/connect/callback`, state }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set("slack_oauth_state", JSON.stringify({ state, userId: user.id, orgId }), {
      httpOnly: true, secure: new URL(origin).protocol === "https:", sameSite: "lax",
      path: "/auth/slack/connect", maxAge: 600,
    });
    return response;
  } catch (e) {
    logFailure("Slack connect start", e);
    return NextResponse.redirect(new URL("/settings?error=slack_connect_failed", origin));
  }
}
