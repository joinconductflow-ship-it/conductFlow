import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CommitmentActionSuggestion,
  TaskIntelligence,
  TaskIntelligenceSubjectType,
  TaskStatus,
  Transcript,
} from "@/lib/types";
import {
  buildCommitmentContextPackage,
  deriveRiskFacts,
  resolveSourceEvidence,
  type CommitmentContextPackage,
  type ContextActionOutcome,
  type ContextActionSuggestion,
  type ContextClient,
  type ContextCommitment,
  type ContextTask,
  type IntelligenceSubject,
} from "./intelligence";

interface Row { [key: string]: unknown }

type ContextTranscript = Pick<Transcript, "id" | "org_id" | "conversation_id" | "body" | "injection_flags">;

export function isTaskIntelligenceUnavailable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return candidate?.code === "42P01"
    || candidate?.code === "PGRST202"
    || candidate?.code === "PGRST205"
    || (typeof candidate?.message === "string" && /task_intelligence.*(?:does not exist|schema cache)|relation .*task_intelligence|function .*task_intelligence/i.test(candidate.message));
}

function asIntelligence(row: Record<string, unknown>): TaskIntelligence {
  return row as unknown as TaskIntelligence;
}

export async function getTaskIntelligence(
  db: SupabaseClient,
  input: { orgId: string; subject: { type: TaskIntelligenceSubjectType; id: string } },
): Promise<TaskIntelligence | null> {
  const { data, error } = await db.from("task_intelligence").select("*")
    .eq("org_id", input.orgId)
    .eq("subject_type", input.subject.type)
    .eq("subject_id", input.subject.id)
    .maybeSingle();
  if (error) throw error;
  return data ? asIntelligence(data as Record<string, unknown>) : null;
}

export async function listTaskIntelligence(
  db: SupabaseClient,
  input: { orgId: string; taskIds: string[] },
): Promise<Record<string, TaskIntelligence>> {
  if (input.taskIds.length === 0) return {};
  const { data, error } = await db.from("task_intelligence").select("*")
    .eq("org_id", input.orgId)
    .eq("subject_type", "task")
    .in("subject_id", input.taskIds);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [
    String((row as Record<string, unknown>).subject_id),
    asIntelligence(row as Record<string, unknown>),
  ]));
}

/** Selects a transcript deterministically without hiding an ambiguous exact span. */
export function selectTranscriptForCommitment(
  commitment: Pick<ContextCommitment, "conversation_id" | "source_span">,
  transcripts: readonly ContextTranscript[],
): ContextTranscript | null {
  const ordered = [...transcripts].sort((a, b) => a.id.localeCompare(b.id));
  if (ordered.length === 0) return null;
  const exactMatches = ordered.filter((transcript) =>
    resolveSourceEvidence(
      { id: "selection", conversation_id: commitment.conversation_id, source_span: commitment.source_span },
      transcript,
    ).verified,
  );
  if (exactMatches.length === 1) return exactMatches[0];
  return ordered.length === 1 ? ordered[0] : null;
}

function asTask(row: Row): ContextTask {
  return {
    id: row.id as string,
    org_id: row.org_id as string,
    commitment_id: row.commitment_id as string,
    title: row.title as string,
    owner: (row.owner as string | null) ?? null,
    due: (row.due as string | null) ?? null,
    status: row.status as TaskStatus,
  };
}

/**
 * Loads only records belonging to the requested organization, then delegates to the pure
 * context builder. This function is intentionally read-only; enqueueing is Phase 2.
 */
export async function loadCommitmentContext(
  db: SupabaseClient,
  input: { orgId: string; subject: IntelligenceSubject },
): Promise<CommitmentContextPackage> {
  let commitmentId = input.subject.id;
  if (input.subject.type === "task") {
    const taskLookup = await db.from("task").select("commitment_id")
      .eq("id", input.subject.id).eq("org_id", input.orgId).maybeSingle();
    if (taskLookup.error) throw taskLookup.error;
    if (!taskLookup.data) throw new Error("Task not found");
    commitmentId = taskLookup.data.commitment_id as string;
  }

  const commitmentResult = await db.from("commitment")
    .select("id,org_id,conversation_id,client_id,text,owner,deadline,type,source_span,status")
    .eq("id", commitmentId).eq("org_id", input.orgId).maybeSingle();
  if (commitmentResult.error) throw commitmentResult.error;
  if (!commitmentResult.data) throw new Error("Commitment not found");

  const commitment = commitmentResult.data as unknown as ContextCommitment;
  const [transcriptResult, clientResult, tasksResult, actionsResult, taskResult] = await Promise.all([
    db.from("transcript").select("id,org_id,conversation_id,body,injection_flags")
      .eq("conversation_id", commitment.conversation_id).eq("org_id", input.orgId)
      .order("id", { ascending: true }),
    commitment.client_id
      ? db.from("client_contact").select("id,org_id,name,email")
        .eq("id", commitment.client_id).eq("org_id", input.orgId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("task").select("id,org_id,commitment_id,title,owner,due,status")
      .eq("org_id", input.orgId).eq("commitment_id", commitmentId).order("created_at", { ascending: true }),
    db.from("commitment_action_suggestion")
      .select("id,org_id,commitment_id,action_type,confidence,rationale,missing_data,execution_state,last_error")
      .eq("org_id", input.orgId).eq("commitment_id", commitmentId).order("created_at", { ascending: true }),
    input.subject.type === "task"
      ? db.from("task").select("id,org_id,commitment_id,title,owner,due,status")
        .eq("id", input.subject.id).eq("org_id", input.orgId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (transcriptResult.error) throw transcriptResult.error;
  if (clientResult.error) throw clientResult.error;
  if (tasksResult.error) throw tasksResult.error;
  if (actionsResult.error) throw actionsResult.error;
  if (taskResult.error) throw taskResult.error;

  const transcript = selectTranscriptForCommitment(
    commitment,
    (transcriptResult.data ?? []) as unknown as ContextTranscript[],
  );
  const client = clientResult.data as unknown as ContextClient | null;
  const relatedTasks = ((tasksResult.data ?? []) as Row[]).map(asTask);
  const task = taskResult.data ? asTask(taskResult.data as Row) : null;
  const suggestions = (actionsResult.data ?? []) as unknown as CommitmentActionSuggestion[];
  const contextSuggestions: ContextActionSuggestion[] = suggestions.map((suggestion) => ({
    id: suggestion.id,
    org_id: suggestion.org_id,
    commitment_id: suggestion.commitment_id,
    action_type: suggestion.action_type,
    confidence: suggestion.confidence,
    rationale: suggestion.rationale,
    missing_data: suggestion.missing_data,
    execution_state: suggestion.execution_state,
    last_error: suggestion.last_error ?? null,
  }));
  const outcomes: ContextActionOutcome[] = contextSuggestions.map((suggestion) => ({
    id: suggestion.id,
    type: suggestion.action_type,
    state: suggestion.execution_state ?? "proposed",
    error: suggestion.last_error ?? null,
    evidence_ref: `action:${suggestion.id}`,
  }));

  const riskFacts = deriveRiskFacts({ commitment, task, relatedTasks, outcomes });

  return buildCommitmentContextPackage({
    orgId: input.orgId,
    subject: input.subject,
    commitment,
    task,
    relatedTasks,
    client,
    transcript,
    actionSuggestions: contextSuggestions,
    actionOutcomes: outcomes,
    riskFacts,
  });
}
