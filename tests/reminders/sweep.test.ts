import { it, expect, beforeAll } from "vitest";
import { describeWithLocalDb } from "../helpers/local-supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sweepReminders } from "@/lib/reminders/sweep";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const orgA = "00000000-0000-0000-0000-00000000000a";
const commitmentA = "00000000-0000-0000-0000-0000000000f1";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-11T12:00:00.000Z");
const overdue = new Date(NOW.getTime() - 2 * DAY);
const upcoming = new Date(NOW.getTime() + DAY);

let db: SupabaseClient;

// Assertions are scoped to each test's own task rather than to global counts: the suite
// never deletes rows, because nothing in this product may delete a task.
async function makeTask(due: Date, status = "open") {
  const { data, error } = await db.from("task").insert({
    org_id: orgA, commitment_id: commitmentA, title: "Sweep fixture",
    owner: "owner@demo.test", due: due.toISOString(), status,
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function remindersFor(taskId: string) {
  const { data } = await db.from("reminder").select("*").eq("task_id", taskId);
  return data ?? [];
}

beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

describeWithLocalDb("sweepReminders", () => {
  it("raises one reminder for a task past its due date", async () => {
    const taskId = await makeTask(overdue);
    await sweepReminders(db, { orgId: orgA, now: NOW });

    const rows = await remindersFor(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("open");
    expect(new Date(rows[0].due_at).toISOString()).toBe(overdue.toISOString());
  });

  it("ignores a task that is not due yet", async () => {
    const taskId = await makeTask(upcoming);
    await sweepReminders(db, { orgId: orgA, now: NOW });
    expect(await remindersFor(taskId)).toHaveLength(0);
  });

  it("ignores a task that is already done", async () => {
    const taskId = await makeTask(overdue, "done");
    await sweepReminders(db, { orgId: orgA, now: NOW });
    expect(await remindersFor(taskId)).toHaveLength(0);
  });

  it("raises nothing new for a task it already nudged", async () => {
    const taskId = await makeTask(overdue);
    const first = await sweepReminders(db, { orgId: orgA, now: NOW });
    expect(first.raised).toBeGreaterThanOrEqual(1);

    const second = await sweepReminders(db, { orgId: orgA, now: NOW });
    expect(second.alreadyOpen).toBeGreaterThanOrEqual(1);
    expect(await remindersFor(taskId)).toHaveLength(1);
  });

  it("raises again once the earlier reminder was dismissed", async () => {
    const taskId = await makeTask(overdue);
    await sweepReminders(db, { orgId: orgA, now: NOW });
    await db.from("reminder").update({ state: "dismissed" }).eq("task_id", taskId);

    await sweepReminders(db, { orgId: orgA, now: NOW });
    const rows = await remindersFor(taskId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.state === "open")).toHaveLength(1);
  });

  it("writes an audit row naming who ran the sweep", async () => {
    await makeTask(overdue);
    await sweepReminders(db, { orgId: orgA, now: NOW, actor: "agent" });

    const { data } = await db.from("audit_event").select("*")
      .eq("org_id", orgA).like("target", "reminder:sweep%")
      .order("created_at", { ascending: false }).limit(1);
    expect(data!).toHaveLength(1);
    expect(data![0].actor).toBe("agent");
    expect(data![0].action).toBe("create");
  });

  it("sweeps every org when no org is named", async () => {
    const taskId = await makeTask(overdue);
    await sweepReminders(db, { now: NOW });
    expect(await remindersFor(taskId)).toHaveLength(1);
  });
});
