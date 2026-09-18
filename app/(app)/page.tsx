import type { Viewport } from "next";
import { Landing } from "@/components/marketing/Landing";

/**
 * The signed-in home. It sits in the (app) group so the layout's auth gate and the real
 * nav bar both apply: a signed-out visitor never reaches this file, they are redirected
 * to /onboarding before it renders.
 *
 * It shows the same content as /product because that content is the product's own
 * explanation of itself, and it reads as an orientation page rather than a sales page
 * once the nav is above it. `signedIn` removes the sign-in affordances and points the
 * calls to action at the queue and the ingest form instead.
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F6F2E9",
};

export default function HomePage() {
  return <Landing signedIn />;
}
