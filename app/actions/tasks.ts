"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { setTaskStatusFor, dismissReminderFor } from "@/lib/tasks/update";
import { sweepReminders } from "@/lib/reminders/sweep";

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to change a task.");
  return { db, userId: data.user.id };
}

export async function setTaskStatus(taskId: string, next: string) {
  const { db, userId } = await session();
  await setTaskStatusFor(db, { taskId, next, userId });
  revalidatePath("/tasks");
  revalidatePath("/roi");
}

export async function dismissReminder(reminderId: string) {
  const { db, userId } = await session();
  await dismissReminderFor(db, { reminderId, userId });
  revalidatePath("/tasks");
}

/** Owner-triggered sweep. The scheduled one runs from app/api/cron/reminders/route.ts. */
export async function runSweep() {
  const { db } = await session();
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to check for overdue work.");
  const result = await sweepReminders(db, { orgId, actor: "human" });
  revalidatePath("/tasks");
  return result;
}
