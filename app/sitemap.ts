import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/http/public-origin";

const SITE = publicOrigin();

/**
 * Only the pages a signed-out visitor can actually reach. Listing a route that returns a
 * redirect to sign-in teaches a crawler that the site is mostly dead ends, so the
 * authenticated app is deliberately absent rather than listed and disallowed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE}/privacy`, changeFrequency: "yearly", priority: 0.4 },
  ];
}
