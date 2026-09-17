import { NextResponse } from "next/server";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { requireEnv } from "@/lib/env";
import { siteOrigin } from "@/lib/http/site-origin";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

/**
 * Several Teams scopes (Team.ReadBasic.All, Channel.ReadBasic.All, ChannelMessage.Read.All,
 * Chat.Read) are admin-consent-required in most Microsoft 365 tenants: an ordinary employee
 * cannot grant them to themselves by clicking Connect, only a Global Admin or Application
 * Administrator can. This sends whoever holds that role at the customer's tenant to
 * Microsoft's dedicated admin-consent endpoint, which pre-approves every permission this app
 * is registered for, for the whole organization, in one click. After that, any employee's
 * ordinary Connect Microsoft click gets the full grant instead of having Teams scopes
 * silently dropped from the token.
 *
 * No state cookie: this redirect has no side effect of its own (nothing is written to the
 * database here, see the callback), and the destination is fixed server-side, not
 * user-supplied, so there is nothing a forged link could redirect this request into doing.
 */
export async function GET() {
  const origin = await siteOrigin();
  try {
    const user = await getCurrentUser("Microsoft admin consent");
    const orgId = await getCurrentOrgId();
    if (!user || !orgId) throw new Error("Sign in to request Microsoft admin consent.");
    const url = new URL("https://login.microsoftonline.com/common/adminconsent");
    url.search = new URLSearchParams({
      client_id: requireEnv("MICROSOFT_CLIENT_ID"),
      redirect_uri: `${origin}/auth/microsoft/admin-consent/callback`,
    }).toString();
    return NextResponse.redirect(url);
  } catch (e) {
    logFailure("Microsoft admin consent start", e);
    return NextResponse.redirect(new URL("/settings?error=microsoft_admin_consent_failed", origin));
  }
}
