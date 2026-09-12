/**
 * The canonical public origin, resolved at build time for metadata that must carry
 * absolute URLs — Open Graph images, the sitemap, the robots sitemap line.
 *
 * This is deliberately separate from siteOrigin() in ./site-origin.ts. That one answers
 * "where did this request arrive?" at runtime and reads headers; this one answers "what
 * address should a crawler be told about?" and must resolve with no request in hand,
 * because robots.ts, sitemap.ts and the root layout are evaluated during the build.
 *
 * The first version of this hardcoded a guess at the production domain, which shipped a
 * live bug: the guess resolved to a host that does not serve /opengraph-image, so every
 * social card pointed at a 404. Vercel already publishes the answer in the environment, so
 * ask it rather than guessing.
 */

function normalize(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  // The VERCEL_* variables are bare hostnames; SITE_ORIGIN is a full origin.
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function publicOrigin(): string {
  const candidates = [
    // Set this and nothing else is consulted. The only way to name a custom domain that
    // Vercel does not know is the production one.
    process.env.SITE_ORIGIN,
    // The project's production domain, which Vercel sets on every deployment. On a preview
    // build this still points at production, which is what a crawler should be told.
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    // This specific deployment. Correct, if ugly, on a preview with no production domain.
    process.env.VERCEL_URL,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const origin = normalize(candidate);
    if (!origin) continue;
    try {
      return new URL(origin).origin;
    } catch {
      // A malformed value is skipped rather than thrown on: bad metadata is a worse
      // failure mode as a broken build than as a fallback to localhost in development.
    }
  }

  return "http://localhost:3000";
}
