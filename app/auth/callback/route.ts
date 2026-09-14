import { TERMS_COOKIE, TERMS_COOKIE_OPTIONS } from "@/lib/auth/terms";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";
import { getServiceClient } from "@/lib/db/service";
import { bootstrapUser } from "@/lib/auth/bootstrap";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

/** Where Google returns after sign-in. Exchanges the code, then makes sure the user has an org. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError || !code) {
    const reason = oauthError ? "oauth_denied" : "no_code";
    return NextResponse.redirect(new URL(`/onboarding?error=${encodeURIComponent(reason)}`, url.origin));
  }

  // Route Handlers must put the exchanged session cookies on the redirect response.
  // A Server Component client can only mutate the request cookie store, which makes the
  // callback look successful for this request but leaves /queue unauthenticated.
  const store = await cookies();
  const pending: { name: string; value: string; options: Record<string, unknown> }[] = [];
  let db: ReturnType<typeof createServerClient>;
  try {
    db = createServerClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        cookies: {
          getAll: () => store.getAll(),
          setAll: (written) => { pending.push(...(written as typeof pending)); },
        },
      },
    );
  } catch (cause) {
    logFailure("Supabase callback initialization", cause);
    return NextResponse.redirect(new URL("/onboarding?error=auth_unavailable", url.origin));
  }

  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url.origin));
    for (const { name, value, options } of pending) response.cookies.set(name, value, options);
    response.cookies.set(TERMS_COOKIE, "", { ...TERMS_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  };

  let error: Error | null;
  try {
    ({ error } = await db.auth.exchangeCodeForSession(code));
  } catch (cause) {
    logFailure("Supabase code exchange", cause);
    return redirect("/onboarding?error=auth_exchange_failed");
  }
  if (error) {
    logFailure("Google auth code exchange", error);
    return redirect("/onboarding?error=auth_exchange_failed");
  }

  const { data: auth, error: userError } = await db.auth.getUser();
  if (userError) {
    logFailure("Google auth session lookup", userError);
    return redirect("/onboarding?error=auth_session_failed");
  }
  if (!auth.user) {
    return redirect("/onboarding?error=no_session");
  }

  // Service role: creating an organization is a server decision, and `organization` is not
  // granted to `authenticated`.
  //
  // Guarded because this is the one step that used to fail as a bare 500: a misconfigured
  // service-role key threw inside the Supabase client, the function crashed, and the browser
  // showed its own error page with nothing to read. Every other failure on this route lands
  // on /onboarding with a reason, and this one should too.
  try {
    await bootstrapUser(getServiceClient(), {
      termsAccepted: store.getAll().some(({ name, value }) =>
        name === TERMS_COOKIE && value === "true"),
      id: auth.user.id,
      email: auth.user.email ?? `${auth.user.id}@unknown.invalid`,
      fullName: (auth.user.user_metadata?.full_name as string | undefined) ?? null,
    });
  } catch (cause) {
    logFailure("bootstrapUser after Google sign-in", cause);
    return redirect("/onboarding?error=workspace_setup_failed");
  }

  return redirect("/queue");
}
