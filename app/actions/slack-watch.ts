"use server";
import { revalidatePath } from "next/cache";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { scanSlack } from "@/lib/slack/watch";

export async function scanSlackNow() {
  const orgId = await getCurrentOrgId("Slack scan");
  if (!orgId) throw new Error("Sign in to scan Slack.");
  const result = await scanSlack(getServiceClient(), { orgId });
  revalidatePath("/queue");
  revalidatePath("/settings");
  return result;
}
