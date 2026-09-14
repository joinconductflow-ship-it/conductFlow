"use server";
import { revalidatePath } from "next/cache";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { scanSlack } from "@/lib/slack/watch";
import { logFailure } from "@/lib/observability/log";
import { UserFacingError } from "@/lib/errors/presentation";

export async function scanSlackNow() {
  const orgId = await getCurrentOrgId("Slack scan");
  if (!orgId) throw new Error("Sign in to scan Slack.");
  let result;
  try {
    result = await scanSlack(getServiceClient(), { orgId });
  } catch (error) {
    logFailure("Slack scan", { provider: "slack", operation: "scan", orgId, error });
    throw new UserFacingError("Couldn't scan Slack right now. Try again.", "provider");
  }
  revalidatePath("/queue");
  revalidatePath("/settings");
  return result;
}
