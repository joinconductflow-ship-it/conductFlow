import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/http/site-origin";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

/**
 * Microsoft redirects here after a tenant admin approves or declines the app on the consent
 * page started by the sibling route. There is no code to exchange and nothing to store:
 * admin consent alone never authenticates a workspace connection, it only pre-approves
 * permissions at the tenant level. The admin (or any employee at the same tenant) still
 * needs to click Connect Microsoft afterward to actually create a connection — only now the
 * Teams scopes will be granted instead of silently dropped.
 */
export async function GET(request: Request) {
  const origin = await siteOrigin();
  const params = new URL(request.url).searchParams;
  if (params.get("error") || params.get("admin_consent") !== "True") {
    logFailure("Microsoft admin consent callback",
      new Error(params.get("error_description") ?? params.get("error") ?? "admin_consent_declined"));
    return NextResponse.redirect(new URL("/settings?error=microsoft_admin_consent_failed", origin));
  }
  return NextResponse.redirect(new URL("/settings?microsoft_admin_consent=1", origin));
}
