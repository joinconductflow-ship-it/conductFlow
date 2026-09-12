import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SIGN_IN_SCOPES } from "@/lib/google/scopes";
import { requireEnv } from "@/lib/env";
import { siteOrigin } from "@/lib/http/site-origin";

export const dynamic = "force-dynamic";

/**
 * Starts Google sign-in. This is a Route Handler rather than a Server Action because
 * `signInWithOAuth` writes the PKCE code verifier as a cookie and then we leave for
 * accounts.google.com: a Server Action redirecting to an external origin does not reliably
 * flush Set-Cookie, so the verifier never reached the browser and the callback failed with
 * "no valid flow state found". Here the cookies are collected and written onto the 302 itself.
 */
export async function GET() {
  const store = await cookies();
  const pending: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const origin = await siteOrigin();

  let db: ReturnType<typeof createServerClient>;
  try {
    db = createServerClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        cookies: {
          getAll: () => store.getAll(),
          setAll: (written) => {
            pending.push(...(written as typeof pending));
          },
        },
      },
    );
  } catch (cause) {
    console.error("Supabase sign-in initialization failed", cause);
    return NextResponse.redirect(new URL("/onboarding?error=auth_unavailable", origin));
  }

  let data: { url: string | null } | null;
  let error: Error | null;
  try {
    ({ data, error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback`,
        // Identity only. API access is asked for later, one capability at a time.
        scopes: SIGN_IN_SCOPES,
      },
    }));
  } catch (cause) {
    console.error("Supabase OAuth initialization failed", cause);
    return NextResponse.redirect(new URL("/onboarding?error=auth_start_failed", origin));
  }

  const authorizeUrl = data?.url;
  if (error || !authorizeUrl) {
    const reason = error?.message ?? "no_authorize_url";
    return NextResponse.redirect(
      new URL(`/onboarding?error=${encodeURIComponent(reason)}`, origin)
    );
  }

  const response = NextResponse.redirect(authorizeUrl);
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
  return response;
}
