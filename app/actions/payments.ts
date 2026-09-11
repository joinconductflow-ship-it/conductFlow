"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { resolvePaymentRiskFlag, scanPaymentRisks } from "@/lib/payments/risk";

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to manage payment risk.");
  return { db };
}

export async function scanForPaymentRisk() {
  const { db } = await session();
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to scan for payment risk.");
  const result = await scanPaymentRisks(db, { orgId });
  revalidatePath("/risk");
  return result;
}

export async function resolveRisk(flagId: string, next: "resolved" | "dismissed") {
  const { db } = await session();
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to update payment risk.");
  await resolvePaymentRiskFlag(db, { orgId, flagId, next });
  revalidatePath("/risk");
}
