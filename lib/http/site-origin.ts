import { headers } from "next/headers";
import { readEnv } from "@/lib/env";

/**
 * Where this deployment believes it lives.
 *
 * Three call sites used to work this out themselves, and all three did it the same
 * unsafe way: trust `x-forwarded-host`, fall back to `host`. Both are attacker-controlled
 * on any request that does not pass through a proxy that overwrites them. A poisoned
 * value is not only an OAuth problem — Google rejects an unregistered `redirect_uri`, so
 * that path fails closed — it is an open redirect, because the error paths build
 * `new URL("/onboarding?error=...", origin)` and send the browser there. Point `origin`
 * at another host and the product hands visitors to it, from its own domain, with its own
 * link.
 *
 * So: when `SITE_ORIGIN` is set, it wins outright and the headers are never consulted.
 * Set it in every deployed environment. Without it we fall back to the forwarded host,
 * which keeps local development and preview URLs working with no configuration.
 */
function normalize(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/** Hosts that may serve this app over plain http. Everything else is forced to https. */
function isLoopback(host: string): boolean {
  return /^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?$/.test(host);
}

export async function siteOrigin(): Promise<string> {
  const configured = readEnv("SITE_ORIGIN");
  if (configured) return normalize(configured);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (isLoopback(host) ? "http" : "https");
  return normalize(`${proto}://${host}`);
}

/**
 * Build an absolute URL on this deployment's own origin.
 *
 * Redirect targets are the reason `siteOrigin` matters, so the helper that builds them
 * lives next to it. `path` is treated as a path, never as a full URL: anything that
 * resolves off-origin is discarded and the caller gets the site root instead. That makes
 * `?next=` and `?error=` style parameters safe to pass through without each call site
 * remembering to re-check them.
 */
export async function siteUrl(path: string): Promise<URL> {
  const origin = await siteOrigin();
  const url = new URL(path, `${origin}/`);
  if (url.origin !== new URL(origin).origin) return new URL("/", `${origin}/`);
  return url;
}
