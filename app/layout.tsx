import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Where this deployment lives, for the absolute URLs metadata needs. Open Graph does not
 * accept a relative image path — a crawler has no page context to resolve it against — so
 * without a base, social cards silently ship with no image at all.
 *
 * SITE_ORIGIN is the same variable the redirect helper uses (lib/http/site-origin.ts).
 * The fallback is the production domain rather than localhost: a preview build with the
 * variable unset should still produce a card that points somewhere real.
 */
const SITE = process.env.SITE_ORIGIN?.trim() || "https://conductflow.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    // Every page gets its own name, and the product's name comes along without each
    // page having to remember to append it.
    default: "ConductFlow — turn client conversations into tracked commitments",
    template: "%s — ConductFlow",
  },
  description:
    "ConductFlow reads your call transcript, pulls out what you promised with the sentence you said it in, and writes the follow-up. Approving one puts it in your own Gmail drafts, unsent.",
  applicationName: "ConductFlow",
  openGraph: {
    type: "website",
    siteName: "ConductFlow",
    url: SITE,
    title: "You said you'd send it by Friday.",
    description:
      "ConductFlow finds the promises in your client calls and drafts the follow-ups. Nothing sends without you.",
  },
  twitter: {
    card: "summary_large_image",
    title: "You said you'd send it by Friday.",
    description:
      "ConductFlow finds the promises in your client calls and drafts the follow-ups. Nothing sends without you.",
  },
  robots: {
    // The marketing pages want indexing; everything behind sign-in does not, and says so
    // again in app/robots.ts. A crawler that ignores one may honour the other.
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  /*
   * The palette in globals.css is dark-only. Declaring it means the browser renders its
   * own furniture to match — scrollbars, form controls, the address bar on mobile — rather
   * than painting light chrome around a near-black page.
   */
  colorScheme: "dark",
  themeColor: "#0A0A0B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
