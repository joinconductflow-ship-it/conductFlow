"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { logFailure } from "@/lib/observability/log";
import { mintToken, revokeToken } from "@/lib/auth/desktop-token";

const ROUTE = "/settings/desktop";

/**
 * Results are returned, not thrown.
 *
 * Next redacts the message of any error thrown out of a server action in a production
 * build, replacing it with "An error occurred in the Server Components render". That is
 * right for unexpected failures and useless for the ones a user can act on — "sign in
 * again" and "the database is unreachable" arrive looking identical. Anything the caller
 * should read comes back as a value; only genuinely unexpected faults are allowed to
 * throw, and those are logged server-side first so they are diagnosable at all.
 */
export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

export async function createDesktopToken(formData: FormData): Promise<TokenResult> {
  const orgId = await getCurrentOrgId(ROUTE);
  if (!orgId) return { ok: false, message: "Sign in again — your session has expired." };

  const user = await getCurrentUser(ROUTE);
  if (!user) return { ok: false, message: "Sign in again — your session has expired." };

  const label = String(formData.get("label") ?? "").trim() || "My Mac";

  // getCurrentOrgId resolves this org *from* the membership table, filtered to
  // user_id = auth.uid() by RLS. Membership is therefore already proven, and a second
  // lookup here added no safety while giving the action one more way to fail.
  try {
    const { token } = await mintToken(getServiceClient(), { orgId, userId: user.id, label });
    revalidatePath(ROUTE);
    return { ok: true, token };
  } catch (error) {
    logFailure(`${ROUTE}: mint desktop token`, error);
    return { ok: false, message: "Could not create a token just now. Please try again." };
  }
}

export async function revokeDesktopToken(formData: FormData): Promise<TokenResult> {
  const orgId = await getCurrentOrgId(ROUTE);
  if (!orgId) return { ok: false, message: "Sign in again — your session has expired." };

  const tokenId = String(formData.get("tokenId") ?? "").trim();
  if (!tokenId) return { ok: false, message: "Which token?" };

  try {
    // Scoped to the caller's org, so a guessed id from another org revokes nothing.
    await revokeToken(getServiceClient(), { orgId, tokenId });
    revalidatePath(ROUTE);
    return { ok: true, token: "" };
  } catch (error) {
    logFailure(`${ROUTE}: revoke desktop token`, error);
    return { ok: false, message: "Could not revoke that token. Please try again." };
  }
}
