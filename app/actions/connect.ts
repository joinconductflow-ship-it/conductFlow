"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { logAudit } from "@/lib/audit/log";
import { CAPABILITIES, isCapability } from "@/lib/google/scopes";
import { CONNECT_STATE_COOKIE } from "@/lib/google/connect-state";
import { siteOrigin } from "@/lib/http/site-origin";

/**
 * Sends the owner to Google for one capability's scopes. Consent is asked for at the
 * moment the capability is wanted, never bundled into sign-in.
 */
export async function startConnect(capability: string) {
  if (!isCapability(capability)) throw new Error("Unknown capability.");
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to connect an account.");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set on the server.");

  // State is random, cookie-bound, and carries the capability, so the callback cannot be
  // replayed or pointed at scopes nobody asked for.
  const nonce = randomBytes(16).toString("base64url");
  const store = await cookies();
  store.set(CONNECT_STATE_COOKIE, `${nonce}:${capability}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${await siteOrigin()}/auth/google/connect/callback`,
    response_type: "code",
    // openid is required so the token exchange returns an id_token — the callback reads
    // `sub` from it to identify which Google account this grant belongs to. Without it,
    // every capability connection fails with `no_account_id`.
    scope: ["openid", ...CAPABILITIES[capability].scopes].join(" "),
    // offline + consent are what make Google return a refresh token at all.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: nonce,
  });

  redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/** Disconnecting revokes; it never deletes. That an org once held a grant is audit history. */
export async function disconnectGoogle(dataSourceId: string) {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to disconnect an account.");
  const db = await getServerClient();
  const { data: user } = await db.auth.getUser();

  const service = getServiceClient();
  const { error } = await service.from("connected_data_source")
    .update({ state: "revoked", updated_at: new Date().toISOString() })
    .eq("id", dataSourceId).eq("org_id", orgId);
  if (error) throw error;

  await logAudit({
    orgId, actor: "human", action: "update",
    target: `data_source:${dataSourceId}:revoke`,
    payloadHash: user.user?.id,
  });
  revalidatePath("/settings");
}
