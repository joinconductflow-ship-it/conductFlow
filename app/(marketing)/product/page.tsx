import type { Viewport } from "next";
import { Landing } from "@/components/marketing/Landing";

/**
 * The public pitch. This used to be "/", and moved here when the root became the
 * signed-in home: a visitor with no account still needs somewhere to read what the
 * product is and download the Mac app, and putting that behind the login would have
 * made every link anyone shares land on a password prompt.
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F6F2E9",
};

export default function ProductPage() {
  return <Landing />;
}
