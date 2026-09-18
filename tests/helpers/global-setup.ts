/**
 * Prints one line about the local Supabase stack before the suite runs.
 *
 * The gating itself lives in local-supabase.ts, per test file. This exists only so the
 * reason is stated once, in the run's own output: vitest reports a skipped suite as a
 * number, and "85 skipped" with no cause is the same puzzle as the timeouts it replaced,
 * only quieter.
 */
const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

export default async function setup() {
  let up = false;
  try {
    const response = await fetch(`${URL}/rest/v1/`, { signal: AbortSignal.timeout(1000) });
    up = response.status < 500;
  } catch {
    up = false;
  }

  console.log(up
    ? `\n  Local Supabase found at ${URL} — integration suites will run.\n`
    : `\n  No local Supabase at ${URL}.` +
      `\n  Integration suites (RLS, migrations, token vault, ingest) are SKIPPED, not failing.` +
      `\n  Run \`supabase start\` to include them; everything else runs either way.\n`);
}
