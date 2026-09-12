import "server-only";
import { unstable_rethrow } from "next/navigation";
import { logFailure } from "@/lib/observability/log";

export interface PageRead<T> {
  data: T | null;
  unavailable: boolean;
}

/** Render-only boundary. Never use for mutations or authorization decisions. */
export async function readPageData<T>(
  context: string, read: () => PromiseLike<T>,
): Promise<PageRead<T>> {
  try {
    return { data: await read(), unavailable: false };
  } catch (error) {
    // Redirects, notFound and other Next.js control flow must keep their meaning.
    unstable_rethrow(error);
    logFailure(context, error);
    return { data: null, unavailable: true };
  }
}

/** Supabase normally resolves failures in `error`, but a read can also reject. */
export function readPageQuery<T>(
  context: string, query: () => PromiseLike<{ data: T; error: unknown }>,
): Promise<PageRead<T>> {
  return readPageData(context, async () => {
    const result = await query();
    if (result.error) throw result.error;
    return result.data;
  });
}
