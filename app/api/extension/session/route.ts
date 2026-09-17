import { NextResponse } from "next/server";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { findOrMintExtensionToken } from "@/lib/auth/desktop-token";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = "/api/extension/session";
    const orgId = await getCurrentOrgId(context);
    const user = await getCurrentUser(context);
    if (!orgId || !user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
    const db = await getServerClient();
    const { data: membership, error } = await db.from("membership").select("org_id")
      .eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!membership) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
    const { token } = await findOrMintExtensionToken(getServiceClient(), { orgId, userId: user.id });
    return NextResponse.json({
      ...(token !== null ? { token } : {}), email: user.email, orgConnected: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logFailure("extension session", { operation: "session_login", error });
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
