import { getServerClient } from "./server";
import { logFailure } from "@/lib/observability/log";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { readPageQuery } from "./page-read";
import type {
  Commitment,
  CommitmentActionSuggestion,
  DeliverableDraft,
  Transcript,
  Task,
  TaskStatus,
} from "@/lib/types";

/** No session is normal; failure to verify an existing session is not sign-out. */
export async function getCurrentUser(context: string, db?: Awaited<ReturnType<typeof getServerClient>>) {
  const s = db ?? await getServerClient();
  try {
    const { data, error } = await s.auth.getUser();
    if (error && !isAuthSessionMissingError(error)) throw error;
    return data.user;
  } catch (error) {
    logFailure(`${context}: auth.getUser`, error);
    throw new Error("Unable to verify your session. Please try again.", { cause: error });
  }
}

/** Auth/org resolution is critical. Never substitute a default tenant on failure. */
export async function getCurrentOrgId(context = "workspace"): Promise<string | null> {
  const s = await getServerClient();
  const user = await getCurrentUser(context, s);
  if (!user) return null;
  try {
    const { data, error } = await s.from("membership").select("org_id")
      .eq("user_id", user.id).limit(1).maybeSingle();
    if (error) throw error;
    return (data?.org_id as string | undefined) ?? null;
  } catch (error) {
    logFailure(`${context}: membership org lookup`, error);
    throw new Error("Unable to load your workspace. Please try again.", { cause: error });
  }
}

/** The org's canonical IANA timezone (`organization.timezone`, default UTC). */
export async function getOrganizationTimeZone(orgId: string): Promise<string> {
  const s = await getServerClient();
  const { data, error } = await s.from("organization").select("timezone")
    .eq("id", orgId).maybeSingle();
  if (error) throw error;
  return (data?.timezone as string | undefined) ?? "UTC";
}

export async function listCommitments(orgId: string): Promise<Commitment[]> {
  const s = await getServerClient();
  // A rejected commitment is meant to disappear ("nothing leaves the building"), not linger
  // in the queue with a badge — so it's excluded here rather than filtered per-view.
  const { data, error } = await s.from("commitment").select("*").eq("org_id", orgId)
    .neq("status", "rejected").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Commitment[];
}

export async function getCommitment(id: string): Promise<Commitment | null> {
  const s = await getServerClient();
  const { data, error } = await s.from("commitment").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Commitment | null;
}

export async function getDraftForCommitment(id: string): Promise<DeliverableDraft | null> {
  const s = await getServerClient();
  const { data, error } = await s.from("deliverable_draft").select("*")
    .eq("commitment_id", id).limit(1).maybeSingle();
  if (error) throw error;
  return (data ?? null) as DeliverableDraft | null;
}

export async function getActionSuggestionsForCommitment(
  commitmentId: string,
): Promise<CommitmentActionSuggestion[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("commitment_action_suggestion")
    .select("id,org_id,commitment_id,action_type,confidence,rationale,required_data,missing_data,input_data,preview_data,execution_state,external_id,external_url,last_error,executing_at,executed_at,updated_at,created_at")
    .eq("commitment_id", commitmentId)
    .in("confidence", ["high", "medium"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommitmentActionSuggestion[];
}

export interface ClientContact { id: string; org_id: string; name: string; email?: string | null; kind: string | null; }

export async function getClientContact(id: string): Promise<ClientContact | null> {
  const s = await getServerClient();
  const { data, error } = await s.from("client_contact").select("id,org_id,name,email,kind")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as ClientContact | null;
}

export async function listClients(orgId: string): Promise<ClientContact[]> {
  const s = await getServerClient();
  const { data, error } = await s.from("client_contact").select("id,org_id,name,email,kind")
    .eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []) as ClientContact[];
}

export async function getTranscriptForCommitment(commitmentId: string): Promise<Transcript | null> {
  const s = await getServerClient();
  const { data: c, error: commitmentError } = await s.from("commitment").select("conversation_id")
    .eq("id", commitmentId).maybeSingle();
  if (commitmentError) throw new Error("commitment conversation lookup failed", { cause: commitmentError });
  if (!c) return null;
  const { data, error } = await s.from("transcript").select("*")
    .eq("conversation_id", c.conversation_id).limit(1).maybeSingle();
  if (error) throw error;
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
  if (error) throw error;
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
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    task_id: r.task_id as string,
    due_at: r.due_at as string,
    title: (r.task as { title?: string } | null)?.title ?? "Untitled task",
  }));
}

/** Everything the operations map needs, in three reads. */
export async function loadOperationsData(orgId: string, route = "/roi"): Promise<{
  commitments: Commitment[]; tasks: Task[]; clientNames: Record<string, string>;
  unavailable: { commitments: boolean; tasks: boolean; clients: boolean };
}> {
  const s = await getServerClient();
  const [commitments, tasks, clients] = await Promise.all([
    readPageQuery(`${route}: commitment operations`, () => s.from("commitment").select("*").eq("org_id", orgId).neq("status", "rejected")),
    readPageQuery(`${route}: task operations`, () => s.from("task").select("*").eq("org_id", orgId)),
    readPageQuery(`${route}: client_contact operations`, () => s.from("client_contact").select("id,name").eq("org_id", orgId)),
  ]);
  const clientNames: Record<string, string> = {};
  for (const c of clients.data ?? []) clientNames[c.id as string] = c.name as string;
  return {
    commitments: (commitments.data ?? []) as Commitment[],
    tasks: (tasks.data ?? []) as Task[],
    clientNames,
    unavailable: { commitments: commitments.unavailable, tasks: tasks.unavailable, clients: clients.unavailable },
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
  if (error) throw error;
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
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    conversation_id: r.conversation_id as string,
    title: (r.conversation as { title?: string } | null)?.title ?? "Untitled conversation",
    extraction_error: (r.extraction_error as string | null) ?? null,
  }));
}
