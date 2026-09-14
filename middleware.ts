import { NextResponse, type NextRequest } from "next/server";
import { readEnv } from "@/lib/env";

/**
 * Content Security Policy, built per request because two of its values are not knowable
 * at build time: the nonce, and the Supabase project origin.
 *
 * The nonce is why this is middleware rather than a static header in next.config.ts.
 * Next.js injects its own bootstrap and hydration scripts inline; a policy strict enough
 * to be worth having cannot allow inline script wholesale, so each request gets a fresh
 * nonce that Next reads back off the request headers and stamps onto the scripts it
 * writes. Static headers live in next.config.ts — they belong there, they never vary.
 *
 * Everything else in next.config.ts is a header a proxy could also set. This one cannot
 * be, which is the whole reason for the file.
 */

/** The Supabase project is the only origin the browser talks to besides our own. */
function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Google's file picker (components/settings/TemplatePicker.tsx) injects a script from
 * apis.google.com, then renders itself in an iframe served from docs.google.com and pulls
 * icons from gstatic. It is the only third-party surface in the product, and it is
 * reachable from exactly one screen, so its origins are named rather than wildcarded
 * where Google's own docs allow it.
 */
const GOOGLE_PICKER = {
  script: ["https://apis.google.com"],
  frame: ["https://docs.google.com", "https://drive.google.com", "https://content.googleapis.com"],
  connect: ["https://apis.google.com", "https://content.googleapis.com", "https://*.googleapis.com"],
  img: ["https://*.googleusercontent.com", "https://*.gstatic.com", "https://ssl.gstatic.com"],
};

function buildCsp(nonce: string, isDev: boolean): string {
  const supabase = supabaseOrigin();

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    // 'strict-dynamic' is deliberately absent. The picker script is injected by our own
    // bundle, so strict-dynamic would trust it — but strict-dynamic also makes every
    // host allowlist below inert in modern browsers, which would silently widen script
    // loading the day someone adds a <script src>. Naming the one host we load is
    // narrower and fails loudly instead.
    // 'unsafe-eval' is dev-only: the Turbopack dev runtime needs it, production does not.
    "script-src": ["'self'", `'nonce-${nonce}'`, ...GOOGLE_PICKER.script, ...(isDev ? ["'unsafe-eval'"] : [])],

    // The honest weak point. Every screen in this app styles itself with React inline
    // style objects, which the browser sees as style attributes and CSP judges under
    // style-src 'unsafe-inline'. Removing it means moving the whole design system out of
    // inline styles first. The exposure is CSS injection — defacement and layout-based
    // trickery — not script execution, and script-src above is not relaxed to match.
    "style-src": ["'self'", "'unsafe-inline'"],

    "img-src": ["'self'", "data:", "blob:", ...GOOGLE_PICKER.img],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...GOOGLE_PICKER.connect, ...(supabase ? [supabase] : [])],
    "frame-src": GOOGLE_PICKER.frame,
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],

    // Nothing in this product is ever framed, so clickjacking is answered here and again
    // with X-Frame-Options in next.config.ts for anything that predates frame-ancestors.
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],

    // Sign-in posts to our own routes and then leaves for Google by redirect, not by
    // form target, so 'self' is the whole set.
    "form-action": ["'self'"],
  };

  const serialized = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");

  // Only meaningful over TLS, and locally it would break plain-http development.
  return isDev ? serialized : `${serialized}; upgrade-insecure-requests`;
}

/**
 * Send every request to the canonical origin when `SITE_ORIGIN` names one.
 *
 * Sign-in is why this exists. `siteOrigin()` builds the OAuth `redirect_to` from
 * `SITE_ORIGIN`, so a flow started on any other host that serves this deployment — the
 * generated `*.vercel.app` alias, say — writes its PKCE code verifier as a host-only
 * cookie on that host and then comes back to the canonical one, which never receives it.
 * The exchange fails with `auth_exchange_failed` and the only clue is that the user
 * arrived by the other name. Moving them before the flow starts is the fix; doing it here
 * covers every entry point rather than the sign-in route alone.
 *
 * Preview deployments leave `SITE_ORIGIN` unset on purpose, and there the forwarded host
 * is the origin, so this is a no-op and previews keep working.
 */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  const configured = readEnv("SITE_ORIGIN");
  if (!configured) return null;

  let canonical: URL;
  try {
    canonical = new URL(configured);
  } catch {
    return null;
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || host === canonical.host) return null;

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical.origin);
  return NextResponse.redirect(target, 308);
}

export function middleware(request: NextRequest) {
  const offCanonical = canonicalRedirect(request);
  if (offCanonical) return offCanonical;

  const isDev = process.env.NODE_ENV !== "production";
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce, isDev);

  // Next reads the nonce back off the request headers to stamp its own inline scripts,
  // so the policy has to go onto the request as well as the response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Every document request, and nothing else. Static assets and image-optimizer output
     * carry no inline script, so a per-request nonce on them would only defeat caching.
     * The negative lookahead is the shape Next's own docs use for exactly this.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
