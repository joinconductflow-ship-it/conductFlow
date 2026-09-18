import { describe } from "vitest";

/**
 * Some suites here are integration tests: they talk to the local Supabase stack that
 * `supabase start` serves on 127.0.0.1:54321, and there is no useful way to fake a
 * database when the thing under test is a row-level-security policy or a migration.
 *
 * Without that stack they used to fail as ~75 five-second timeouts. The cost was not the
 * six minutes, it was the reading: a wall of red with no stated cause says "this code is
 * broken" to anyone who has just cloned the repo, and the only way to learn otherwise was
 * to open a failing file and recognise the connection string. Several of those timeouts
 * also sat next to genuine failures, which is how a stale assertion in the desktop route
 * tests survived: nobody could see one real failure inside seventy-five fake ones.
 *
 * So they skip, and the run says why once, from tests/helpers/global-setup.ts. A skipped
 * integration test is an honest report of what this machine can run. A timeout is not.
 */
const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

async function reachable(): Promise<boolean> {
  try {
    // PostgREST answers this unauthenticated; any reply at all proves something is home.
    const response = await fetch(`${URL}/rest/v1/`, { signal: AbortSignal.timeout(1000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

export const localDbAvailable = await reachable();

/**
 * `describe` for a suite that cannot run without the local stack. Behaves exactly like
 * `describe` when the stack is up, and skips the whole suite with a reason when it is not.
 */
export const describeWithLocalDb = describe.skipIf(!localDbAvailable);
