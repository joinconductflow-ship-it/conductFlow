import type { Metadata, Viewport } from "next";
import { publicOrigin } from "@/lib/http/public-origin";
import "./globals.css";

/**
 * Open Graph does not accept a relative image path — a crawler has no page context to
 * resolve it against — so without an absolute base, social cards ship pointing at nothing.
 * publicOrigin() reads the answer out of the environment instead of guessing at it.
 */
const SITE = publicOrigin();

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
   * The palette in globals.css is light-only (cream canvas, ink text). Declaring it means
   * the browser renders its own furniture to match — scrollbars, form controls, the
   * address bar on mobile — rather than painting dark chrome around a light page.
   */
  colorScheme: "light",
  themeColor: "#F6F2E9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
