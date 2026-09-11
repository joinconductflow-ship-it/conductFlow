import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";
import { siteOrigin } from "@/lib/http/site-origin";

export const dynamic = "force-dynamic";

/**
 * Sign in by emailed link. A second way in matters because the Google path can be taken away
 * by someone other than us — a disabled OAuth client, or verification still pending on the
 * restricted Gmail scope — and losing sign-in should not mean losing the product.
 *
 * Identity only. This grants no Google capability: Gmail, Drive, and Calendar are still asked
 * for separately, and an account created this way simply has none of them connected.
 *
 * A Route Handler for the same reason sign-in is: the PKCE verifier is written as a cookie and
 * must survive the response. The emailed link returns to /auth/callback, which already
 * exchanges the code and bootstraps the org.
 */
export async function POST(request: Request) {
  const origin = await siteOrigin();
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return NextResponse.redirect(
      new URL(`/onboarding?error=${encodeURIComponent("Enter an email address.")}`, origin),
      { status: 303 }
    );
  }

  const store = await cookies();
  const pending: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const db = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (written) => {
          pending.push(...(written as typeof pending));
        },
      },
    }
  );

  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  // 303 so the browser follows with GET; this handler is reached by a form POST.
  const target = error
    ? new URL(`/onboarding?error=${encodeURIComponent(error.message)}`, origin)
    : new URL(`/onboarding?sent=${encodeURIComponent(email)}`, origin);

  const response = NextResponse.redirect(target, { status: 303 });
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
  return response;
}
