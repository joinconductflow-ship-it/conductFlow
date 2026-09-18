import { it, expect, beforeAll } from "vitest";
import { describeWithLocalDb } from "../helpers/local-supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setTaskStatusFor, dismissReminderFor } from "@/lib/tasks/update";
import { sweepReminders } from "@/lib/reminders/sweep";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const orgA = "00000000-0000-0000-0000-00000000000a";
const commitmentA = "00000000-0000-0000-0000-0000000000f1";
const ownerA = "00000000-0000-0000-0000-0000000000a1";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-11T12:00:00.000Z");

let db: SupabaseClient;

async function makeTask(due = new Date(NOW.getTime() + DAY), status = "open") {
  const { data, error } = await db.from("task").insert({
    org_id: orgA, commitment_id: commitmentA, title: "Update fixture",
    owner: "owner@demo.test", due: due.toISOString(), status,
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function commitmentStatus() {
  const { data } = await db.from("commitment").select("status").eq("id", commitmentA).single();
  return data!.status as string;
}

beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

describeWithLocalDb("setTaskStatusFor", () => {
  it("moves an open task to in progress", async () => {
    const id = await makeTask();
    await setTaskStatusFor(db, { taskId: id, next: "in_progress", userId: ownerA });

    const { data } = await db.from("task").select("*").eq("id", id).single();
    expect(data!.status).toBe("in_progress");
    expect(data!.completed_at).toBeNull();
  });

  it("stamps who completed the task and when", async () => {
    const id = await makeTask();
    await setTaskStatusFor(db, { taskId: id, next: "done", userId: ownerA, now: NOW });

    const { data } = await db.from("task").select("*").eq("id", id).single();
    expect(data!.completed_by).toBe(ownerA);
    expect(new Date(data!.completed_at).toISOString()).toBe(NOW.toISOString());
  });

  it("marks the commitment delivered when its task is done", async () => {
    const id = await makeTask();
    await setTaskStatusFor(db, { taskId: id, next: "done", userId: ownerA });
    expect(await commitmentStatus()).toBe("done");
  });

  it("returns the commitment to tasked when the task reopens", async () => {
    const id = await makeTask();
    await setTaskStatusFor(db, { taskId: id, next: "done", userId: ownerA });
    await setTaskStatusFor(db, { taskId: id, next: "open", userId: ownerA });

    const { data } = await db.from("task").select("*").eq("id", id).single();
    expect(data!.completed_at).toBeNull();
    expect(data!.completed_by).toBeNull();
    expect(await commitmentStatus()).toBe("tasked");
  });

  it("resolves the open reminder when the task is done", async () => {
    const id = await makeTask(new Date(NOW.getTime() - 2 * DAY));
    await sweepReminders(db, { orgId: orgA, now: NOW });
    await setTaskStatusFor(db, { taskId: id, next: "done", userId: ownerA });

    const { data } = await db.from("reminder").select("state").eq("task_id", id);
    expect(data!.every((r) => r.state === "resolved")).toBe(true);
  });

  it("refuses an illegal transition before writing", async () => {
    const id = await makeTask();
    await setTaskStatusFor(db, { taskId: id, next: "done", userId: ownerA });
    await expect(setTaskStatusFor(db, { taskId: id, next: "in_progress", userId: ownerA }))
      .rejects.toThrow(/reopen/i);

    const { data } = await db.from("task").select("status").eq("id", id).single();
    expect(data!.status).toBe("done");
  });

  it("rejects a status that is not a task state", async () => {
    const id = await makeTask();
    await expect(setTaskStatusFor(db, { taskId: id, next: "archived", userId: ownerA }))
      .rejects.toThrow(/unknown/i);
  });

  it("throws when the task does not exist", async () => {
    await expect(setTaskStatusFor(db, {
      taskId: "00000000-0000-0000-0000-0000000000ff", next: "done", userId: ownerA,
    })).rejects.toThrow(/not found/i);
  });

  it("writes an audit row for the transition", async () => {
    const id = await makeTask();
    await setTaskStatusFor(db, { taskId: id, next: "in_progress", userId: ownerA });

    const { data } = await db.from("audit_event").select("*")
      .eq("org_id", orgA).eq("target", `task:${id}:in_progress`);
    expect(data!).toHaveLength(1);
    expect(data![0].actor).toBe("human");
    expect(data![0].action).toBe("update");
  });
});

describeWithLocalDb("dismissReminderFor", () => {
  it("dismisses an open reminder and audits it", async () => {
    const id = await makeTask(new Date(NOW.getTime() - 2 * DAY));
    await sweepReminders(db, { orgId: orgA, now: NOW });
    const { data: open } = await db.from("reminder").select("id").eq("task_id", id).single();

    await dismissReminderFor(db, { reminderId: open!.id as string, userId: ownerA });

    const { data } = await db.from("reminder").select("state").eq("id", open!.id).single();
    expect(data!.state).toBe("dismissed");

    const { data: audit } = await db.from("audit_event").select("*")
      .eq("target", `reminder:${open!.id}:dismiss`);
    expect(audit!).toHaveLength(1);
  });

  it("throws when the reminder does not exist", async () => {
    await expect(dismissReminderFor(db, {
      reminderId: "00000000-0000-0000-0000-0000000000ff", userId: ownerA,
    })).rejects.toThrow(/not found/i);
  });
});
