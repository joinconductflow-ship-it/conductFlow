import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/http/public-origin";

const SITE = publicOrigin();

/**
 * Only the pages a signed-out visitor can actually reach. Listing a route that returns a
 * redirect to sign-in teaches a crawler that the site is mostly dead ends, so the
 * authenticated app is deliberately absent rather than listed and disallowed. That is
 * also why the pitch is listed at /product and not at "/": the root is the signed-in home
 * and redirects anonymous traffic to the login, so listing it would advertise the exact
 * dead end this comment warns about.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/product`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE}/privacy`, changeFrequency: "yearly", priority: 0.4 },
  ];
}
