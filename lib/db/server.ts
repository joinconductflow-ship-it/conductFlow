import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";
import { logFailure } from "@/lib/observability/log";

export async function getServerClient() {
  const store = await cookies();
  // Configuration is a core failure, not an empty-data condition.
  let url: string;
  let key: string;
  try {
    url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    key = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    new URL(url);
  } catch (error) {
    // Do not log a malformed URL/key: configuration values may contain secrets.
    logFailure("getServerClient: Supabase configuration", new Error("Supabase URL/key missing or URL invalid"));
    throw error;
  }
  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (written) => {
          try {
            written.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Next.js forbids writing cookies while rendering. Supabase calls this when it
            // refreshes an expiring session, which happens on any page or layout that reads
            // the user — so swallowing it here is the documented pattern, not a shortcut.
            // The refreshed session still applies to this request; it just is not persisted
            // until the next Server Action or Route Handler writes it.
          }
        },
      },
    }
  );
}
