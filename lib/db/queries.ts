import { getServerClient } from "./server";
import { logFailure } from "@/lib/observability/log";
import type { Commitment, DeliverableDraft, Transcript, Task, TaskStatus } from "@/lib/types";

/** Org for the signed-in user, resolved from membership. Null when signed out. */
export async function getCurrentOrgId(): Promise<string | null> {
  const s = await getServerClient();
  const { data: auth } = await s.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await s.from("membership").select("org_id")
    .eq("user_id", auth.user.id).limit(1).maybeSingle();
  logFailure("getCurrentOrgId", error);
  return (data?.org_id as string | undefined) ?? null;
}

export async function listCommitments(orgId: string): Promise<Commitment[]> {
  const s = await getServerClient();
  // A rejected commitment is meant to disappear ("nothing leaves the building"), not linger
  // in the queue with a badge — so it's excluded here rather than filtered per-view.
  const { data, error } = await s.from("commitment").select("*").eq("org_id", orgId)
    .neq("status", "rejected").order("created_at", { ascending: false });
  logFailure("listCommitments", error);
  return (data ?? []) as Commitment[];
}

export async function getCommitment(id: string): Promise<Commitment | null> {
  const s = await getServerClient();
  const { data, error } = await s.from("commitment").select("*").eq("id", id).single();
  logFailure("getCommitment", error);
  return (data ?? null) as Commitment | null;
}

export async function getDraftForCommitment(id: string): Promise<DeliverableDraft | null> {
  const s = await getServerClient();
  const { data, error } = await s.from("deliverable_draft").select("*")
    .eq("commitment_id", id).limit(1).maybeSingle();
  logFailure("getDraftForCommitment", error);
  return (data ?? null) as DeliverableDraft | null;
}

export interface ClientContact { id: string; org_id: string; name: string; kind: string | null; }

export async function listClients(orgId: string): Promise<ClientContact[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("client_contact").select("id,org_id,name,kind")
    .eq("org_id", orgId).order("name");
  logFailure("listClients", error);
  return (data ?? []) as ClientContact[];
}

export async function getTranscriptForCommitment(commitmentId: string): Promise<Transcript | null> {
  const s = await getServerClient();
  const { data: c, error: commitmentError } = await s.from("commitment").select("conversation_id")
    .eq("id", commitmentId).single();
  logFailure("getTranscriptForCommitment.commitment", commitmentError);
  if (!c) return null;
  const { data, error } = await s.from("transcript").select("*")
    .eq("conversation_id", c.conversation_id).limit(1).maybeSingle();
  logFailure("getTranscriptForCommitment.transcript", error);
  return (data ?? null) as Transcript | null;
}

export interface BoardTask {
  id: string; commitment_id: string; title: string;
  owner: string | null; due: string | null; status: TaskStatus;
  completed_at: string | null; client_name: string;
}

/** Board rows: the task plus the client it was promised to and the commitment it came from. */
export async function listBoardTasks(orgId: string): Promise<BoardTask[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("task")
    .select("id,commitment_id,title,owner,due,status,completed_at,commitment(client_contact(name))")
    .eq("org_id", orgId)
    .order("due", { ascending: true, nullsFirst: false });
  logFailure("listBoardTasks", error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    commitment_id: r.commitment_id as string,
    title: r.title as string,
    owner: (r.owner as string | null) ?? null,
    due: (r.due as string | null) ?? null,
    status: r.status as TaskStatus,
    completed_at: (r.completed_at as string | null) ?? null,
    client_name:
      (r.commitment as { client_contact?: { name?: string } | null } | null)
        ?.client_contact?.name ?? "Unassigned client",
  }));
}

export interface OpenReminder {
  id: string; task_id: string; due_at: string; title: string;
}

export async function listOpenReminders(orgId: string): Promise<OpenReminder[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("reminder")
    .select("id,task_id,due_at,task(title)")
    .eq("org_id", orgId).eq("state", "open")
    .order("due_at", { ascending: true });
  logFailure("listOpenReminders", error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    task_id: r.task_id as string,
    due_at: r.due_at as string,
    title: (r.task as { title?: string } | null)?.title ?? "Untitled task",
  }));
}

/** Everything the operations map needs, in three reads. */
export async function loadOperationsData(orgId: string): Promise<{
  commitments: Commitment[]; tasks: Task[]; clientNames: Record<string, string>;
}> {
  const s = await getServerClient();
  const [commitments, tasks, clients] = await Promise.all([
    s.from("commitment").select("*").eq("org_id", orgId).neq("status", "rejected"),
    s.from("task").select("*").eq("org_id", orgId),
    s.from("client_contact").select("id,name").eq("org_id", orgId),
  ]);
  logFailure("loadOperationsData.commitments", commitments.error);
  logFailure("loadOperationsData.tasks", tasks.error);
  logFailure("loadOperationsData.clients", clients.error);
  const clientNames: Record<string, string> = {};
  for (const c of clients.data ?? []) clientNames[c.id as string] = c.name as string;
  return {
    commitments: (commitments.data ?? []) as Commitment[],
    tasks: (tasks.data ?? []) as Task[],
    clientNames,
  };
}

export interface OpenEscalation {
  id: string; kind: string; detail: string;
  /** 'warn' stops the line; 'info' is advisory. Set by the exception checks (migration 0010). */
  severity: "info" | "warn";
  conversation_id: string; commitment_id: string | null;
  conversation_title: string; created_at: string;
}

/** What the agent decided a human must see before anything goes out. */
export async function listOpenEscalations(orgId: string): Promise<OpenEscalation[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("escalation")
    .select("id,kind,detail,severity,conversation_id,commitment_id,created_at,conversation(title)")
    .eq("org_id", orgId).eq("state", "open")
    .order("created_at", { ascending: false });
  logFailure("listOpenEscalations", error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    detail: r.detail as string,
    severity: (r.severity as "info" | "warn" | undefined) ?? "warn",
    conversation_id: r.conversation_id as string,
    commitment_id: (r.commitment_id as string | null) ?? null,
    conversation_title: (r.conversation as { title?: string } | null)?.title ?? "Untitled conversation",
    created_at: r.created_at as string,
  }));
}

export interface FailedTranscript {
  id: string; conversation_id: string; title: string; extraction_error: string | null;
}

export async function listFailedTranscripts(orgId: string): Promise<FailedTranscript[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("transcript")
    .select("id,conversation_id,extraction_error,conversation(title)")
    .eq("org_id", orgId).eq("extraction_status", "failed");
  logFailure("listFailedTranscripts", error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    title: (r.conversation as { title?: string } | null)?.title ?? "Untitled conversation",
    extraction_error: (r.extraction_error as string | null) ?? null,
  }));
}
