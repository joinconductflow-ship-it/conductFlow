import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Bearer tokens for the macOS menu-bar client.
 *
 * The desktop app has no Supabase session — it is not a browser and never sees a
 * cookie. It presents one of these instead, and the API routes resolve it to an org
 * before doing anything. Everything downstream then runs exactly as it does for a
 * signed-in member.
 *
 * Only the hash is persisted. `mint` returns the plaintext once and the caller is
 * responsible for showing it once; there is no way to recover it later.
 */

const PREFIX = "cfd_";
/** 32 bytes of randomness, base64url — comfortably beyond guessing. */
const BYTES = 32;

export interface ResolvedToken {
  tokenId: string;
  orgId: string;
  userId: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Shape check only — cheap rejection before touching the database. */
export function looksLikeToken(value: string): boolean {
  return value.startsWith(PREFIX) && value.length > PREFIX.length + 20;
}

export function generateToken(): string {
  return PREFIX + randomBytes(BYTES).toString("base64url");
}

export async function mintToken(
  db: SupabaseClient,
  args: { orgId: string; userId: string; label: string },
): Promise<{ token: string; id: string }> {
  const token = generateToken();
  const { data, error } = await db
    .from("desktop_token")
    .insert({
      org_id: args.orgId,
      user_id: args.userId,
      token_hash: hashToken(token),
      label: args.label.trim().slice(0, 80) || "Desktop",
    })
    .select("id")
    .single();

  if (error) throw new Error(`could not mint a desktop token: ${error.message}`, { cause: error });
  return { token, id: data.id };
}

/**
 * Resolve a raw Authorization header to an org, or null.
 *
 * Returns null for every failure mode — malformed, unknown, revoked — so a caller
 * cannot distinguish "no such token" from "revoked token" by response alone.
 */
export async function resolveToken(
  db: SupabaseClient,
  authorizationHeader: string | null,
): Promise<ResolvedToken | null> {
  if (!authorizationHeader) return null;

  const [scheme, ...rest] = authorizationHeader.split(" ");
  if (scheme !== "Bearer") return null;
  const token = rest.join(" ").trim();
  if (!looksLikeToken(token)) return null;

  const { data, error } = await db
    .from("desktop_token")
    .select("id, org_id, user_id, token_hash, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  // A lookup error is not "not found": treat a broken database as a denial rather
  // than silently letting the request through.
  if (error) throw new Error(`desktop token lookup failed: ${error.message}`);
  if (!data || data.revoked_at) return null;

  // The hash column is unique and already matched, so this is belt-and-braces
  // against a future change that relaxes that — compared without early exit.
  const stored = Buffer.from(data.token_hash);
  const computed = Buffer.from(hashToken(token));
  if (stored.length !== computed.length || !timingSafeEqual(stored, computed)) return null;

  return { tokenId: data.id, orgId: data.org_id, userId: data.user_id };
}

/** Best-effort: a failure here must not fail the request it is recording. */
export async function touchToken(db: SupabaseClient, tokenId: string): Promise<void> {
  await db
    .from("desktop_token")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenId);
}

export async function revokeToken(
  db: SupabaseClient,
  args: { orgId: string; tokenId: string },
): Promise<void> {
  const { error } = await db
    .from("desktop_token")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", args.tokenId)
    .eq("org_id", args.orgId);
  if (error) throw new Error(`could not revoke that token: ${error.message}`);
}

/** Reuse the identity; plaintext is available only to the caller that minted it. */
export async function findOrMintExtensionToken(
  db: SupabaseClient,
  args: { orgId: string; userId: string },
): Promise<{ token: string | null; id: string }> {
  const lookup = () => db.from("desktop_token").select("id")
    .eq("org_id", args.orgId).eq("user_id", args.userId)
    .eq("label", "Chrome extension (auto)").is("revoked_at", null).maybeSingle();
  const { data, error } = await lookup();
  if (error) throw error;
  if (data) return { token: null, id: data.id };
  try {
    return await mintToken(db, { ...args, label: "Chrome extension (auto)" });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
      const winner = await lookup();
      if (winner.error) throw winner.error;
      if (winner.data) return { token: null, id: winner.data.id };
    }
    throw error;
  }
}
