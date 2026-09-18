import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/http/public-origin";

const SITE = publicOrigin();

/**
 * Two public pages, and everything else behind sign-in.
 *
 * The disallow list is not a security control — a crawler that ignores robots.txt reads it
 * as a map of where to look, and these routes already refuse an unauthenticated request.
 * It is here so that a URL which leaks into a referrer header or a pasted link does not
 * end up indexed, and so the auth and cron endpoints are never crawled at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/product", "/privacy", "/terms"],
      disallow: [
        // "/" is the signed-in home now, not the pitch; anonymous traffic there is
        // redirected to the login, so there is nothing at it worth indexing.
        "/$",
        "/api/",
        "/auth/",
        "/onboarding",
        "/queue",
        "/tasks",
        "/roi",
        "/settings",
        "/billing",
        "/documents",
        "/ingest",
        "/leads",
        "/reports",
        "/retainers",
        "/reviews",
        "/scheduling",
        "/scope",
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
