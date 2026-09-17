import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { requireEnv } from "@/lib/env";
import { siteOrigin } from "@/lib/http/site-origin";
import { MICROSOFT_CAPABILITIES } from "@/lib/microsoft/scopes";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

export async function GET() {
  const origin = await siteOrigin();
  try {
    const user = await getCurrentUser("Microsoft connect");
    const orgId = await getCurrentOrgId();
    if (!user || !orgId) throw new Error("Sign in to connect Microsoft.");
    const state = randomBytes(32).toString("hex");
    const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.search = new URLSearchParams({ client_id: requireEnv("MICROSOFT_CLIENT_ID"),
      response_type: "code", response_mode: "query",
      scope: MICROSOFT_CAPABILITIES.microsoft_365.scopes.join(" "),
      redirect_uri: `${origin}/auth/microsoft/connect/callback`, state }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set("microsoft_oauth_state", JSON.stringify({ state, userId: user.id, orgId }), {
      httpOnly: true, secure: new URL(origin).protocol === "https:", sameSite: "lax",
      path: "/auth/microsoft/connect", maxAge: 600,
    });
    return response;
  } catch (e) {
    logFailure("Microsoft connect start", e);
    return NextResponse.redirect(new URL("/settings?error=microsoft_connect_failed", origin));
  }
}
