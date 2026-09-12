"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { scanGmail } from "@/lib/gmail/watch";

/**
 * The manual half of "ConductFlow watches your Gmail" — the cron route
 * (app/api/cron/gmail-scan) is the automatic half. Both call the same `scanGmail`; this one
 * just runs it for the caller's own org, on demand, from the queue page.
 *
 * Needs the service client, not the session-scoped one: `scanGmail` reads the sealed refresh
 * token via `getAccessToken`, and `connected_data_source.token_sealed` is granted to
 * service_role alone. The session client above is only used to confirm someone is signed in.
 */
export async function scanGmailNow() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to scan Gmail.");
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to scan Gmail.");

  const result = await scanGmail(getServiceClient(), { orgId });
  revalidatePath("/queue");
  return result;
}
