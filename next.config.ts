import type { NextConfig } from "next";

/**
 * Response headers that never vary by request. The one that does — Content-Security-Policy,
 * which carries a per-request nonce — is set in middleware.ts instead.
 *
 * These are cheap and they close whole categories: a browser that never sniffs a content
 * type cannot be talked into executing an upload as script, and a page that cannot be
 * framed cannot be clickjacked into approving a commitment.
 */
const securityHeaders = [
  /*
   * Two years, subdomains included, and preload-eligible. This is the one header here
   * that is hard to walk back: a browser that has seen it will refuse plain http to this
   * host for the full max-age, so the domain and every subdomain must be able to serve
   * TLS before this ships. Vercel does by default.
   */
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },

  /* No MIME sniffing. An uploaded document is served as what it is declared to be. */
  { key: "X-Content-Type-Options", value: "nosniff" },

  /*
   * Belt and braces with the CSP's frame-ancestors 'none'. frame-ancestors supersedes
   * this in every current browser; this covers anything that does not implement it.
   */
  { key: "X-Frame-Options", value: "DENY" },

  /*
   * Paths in this product carry record ids — /queue/<commitmentId>. Sending a full URL
   * to another origin as a Referer would leak them to whoever the owner clicks through
   * to. Same-origin keeps the full path in-house and sends only the bare origin outward.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  /*
   * The product asks for none of these. Denying them means a compromised script cannot
   * quietly turn one on, and the denial is visible to anyone reading the response.
   */
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()", "autoplay=()", "camera=()", "display-capture=()",
      "encrypted-media=()", "fullscreen=(self)", "geolocation=()", "gyroscope=()",
      "magnetometer=()", "microphone=()", "midi=()", "payment=()", "usb=()",
      "interest-cohort=()",
    ].join(", "),
  },

  /*
   * Isolates this origin's browsing-context group from anything it opens or that opens
   * it, which is what closes cross-window references back into an authenticated tab.
   */
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },

  /*
   * Deliberately not Cross-Origin-Embedder-Policy: require-corp. It would break the
   * Google picker iframe, and nothing here needs cross-origin isolation.
   */
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },

  /* DNS prefetch resolves hosts a page merely mentions. Nothing here benefits. */
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // An error page that names the framework version tells an attacker what to try first.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
