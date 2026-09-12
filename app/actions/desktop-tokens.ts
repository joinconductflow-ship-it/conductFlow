"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { mintToken, revokeToken } from "@/lib/auth/desktop-token";

const ROUTE = "/settings/desktop";

/**
 * Mints a desktop token and returns the plaintext exactly once.
 *
 * Membership is established through the caller's own session first — the service
 * client is used only for the insert, because `desktop_token` deliberately grants no
 * insert to `authenticated`. The plaintext half must never be writable through
 * PostgREST, so this server action is the single place it can be created.
 */
export async function createDesktopToken(formData: FormData): Promise<{ token: string }> {
  const orgId = await getCurrentOrgId(ROUTE);
  if (!orgId) throw new Error("Sign in to create a desktop token.");

  const user = await getCurrentUser(ROUTE);
  if (!user) throw new Error("Sign in to create a desktop token.");

  const label = String(formData.get("label") ?? "").trim() || "My Mac";

  // Confirm the session really does belong to this org before escalating. RLS would
  // catch it, but the check is cheap and the escalation below bypasses RLS entirely.
  const db = await getServerClient();
  const { data: membership, error } = await db
    .from("membership").select("org_id").eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`could not verify your membership: ${error.message}`);
  if (!membership) throw new Error("You are not a member of this organisation.");

  const { token } = await mintToken(getServiceClient(), {
    orgId, userId: user.id, label,
  });

  revalidatePath(ROUTE);
  return { token };
}

export async function revokeDesktopToken(formData: FormData): Promise<void> {
  const orgId = await getCurrentOrgId(ROUTE);
  if (!orgId) throw new Error("Sign in to revoke a desktop token.");

  const tokenId = String(formData.get("tokenId") ?? "").trim();
  if (!tokenId) throw new Error("Which token?");

  // Scoped to the caller's org, so a guessed id from another org revokes nothing.
  await revokeToken(getServiceClient(), { orgId, tokenId });
  revalidatePath(ROUTE);
}
