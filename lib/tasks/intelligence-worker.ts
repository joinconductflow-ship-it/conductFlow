import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { EXTRACTION_MODEL } from "@/lib/agent/schema";
import { GenerationFailure, generateObjectWithRetry } from "@/lib/agent/generate";
import { logFailure } from "@/lib/observability/log";
import type { TaskIntelligenceProvenance } from "@/lib/types";
import {
  buildIntelligencePrompt,
  TASK_INTELLIGENCE_SYSTEM_PROMPT,
  type CommitmentContextPackage,
  type IntelligenceSubject,
} from "./intelligence";
import { loadCommitmentContext } from "./intelligence-query";
import {
  taskIntelligenceOutputSchema,
  type TaskIntelligenceOutput,
} from "./intelligence-schema";
import { validateOutputAgainstContext } from "./intelligence";

const MAX_BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_SECONDS = 120;
const MAX_CONCURRENCY = 2;

interface ClaimedJob {
  id: string;
  org_id: string;
  subject_type: "commitment" | "task";
  subject_id: string;
  commitment_id: string;
  task_id: string | null;
  generation_version: string;
  input_fingerprint: string;
  attempts: number;
  claim_token: string;
}

function subjectFor(job: Pick<ClaimedJob, "subject_type" | "subject_id">): IntelligenceSubject {
  return { type: job.subject_type, id: job.subject_id };
}

function retryDelayMs(attempts: number): number {
  return Math.min(300_000, 1_000 * (2 ** Math.max(0, attempts - 1)));
}

function errorCode(error: unknown): string {
  if (error instanceof GenerationFailure) {
    return `generation_${error.errorType}`.slice(0, 100);
  }
  if (error instanceof Error && /not found|another organization|does not belong|subject/i.test(error.message)) {
    return "context_invalid";
  }
  return "generation_failed";
}

function isRetryable(error: unknown): boolean {
  return error instanceof GenerationFailure ? error.retryable : errorCode(error) !== "context_invalid";
}

function provenanceFor(output: TaskIntelligenceOutput, context: CommitmentContextPackage): Record<string, TaskIntelligenceProvenance> {
  const provenance: Record<string, TaskIntelligenceProvenance> = {};
  for (const [field, value] of Object.entries(output)) {
    if (!value) continue;
    provenance[field] = { kind: "model_inference", evidence_refs: value.evidence_refs };
  }
  for (const fact of context.source_facts) {
    provenance[`source_facts.${fact.key}`] = { kind: "source_fact", evidence_refs: fact.evidence_refs };
  }
  if (context.task) {
    provenance.task = { kind: "task_state", evidence_refs: [`task:${context.task.id}`] };
  }
  return provenance;
}

async function updateClaimed(
  db: SupabaseClient,
  job: ClaimedJob,
  values: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await db.from("task_intelligence")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("claim_token", job.claim_token)
    .eq("state", "processing")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Enqueue is a small, idempotent database write; it never calls the model. */
export async function enqueueTaskIntelligenceJob(
  db: SupabaseClient,
  context: CommitmentContextPackage,
  options: { forceRetry?: boolean } = {},
): Promise<string> {
  const { data, error } = await db.rpc("enqueue_task_intelligence", {
    p_org_id: context.org_id,
    p_subject_type: context.subject.type,
    p_subject_id: context.subject.id,
    p_commitment_id: context.commitment.id,
    p_task_id: context.task?.id ?? null,
    p_generation_version: context.generation_version,
    p_input_fingerprint: context.input_fingerprint,
    p_force_retry: options.forceRetry ?? false,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Task Intelligence enqueue did not return an id");
  return data;
}

export async function ensureTaskIntelligenceJobForSubject(
  db: SupabaseClient,
  input: { orgId: string; subject: IntelligenceSubject; forceRetry?: boolean },
): Promise<{ id: string; context: CommitmentContextPackage }> {
  const context = await loadCommitmentContext(db, input);
  const id = await enqueueTaskIntelligenceJob(db, context, { forceRetry: input.forceRetry });
  return { id, context };
}

async function processOne(db: SupabaseClient, job: ClaimedJob): Promise<"ready" | "retry" | "failed" | "stale"> {
  const subject = subjectFor(job);
  try {
    const context = await loadCommitmentContext(db, { orgId: job.org_id, subject });

    // A detail-page open may have queued a newer snapshot while this job was waiting.
    // Do not let a stale worker publish reasoning for an old input fingerprint.
    if (context.input_fingerprint !== job.input_fingerprint
      || context.generation_version !== job.generation_version) {
      const updated = await updateClaimed(db, job, {
        state: "pending",
        input_fingerprint: context.input_fingerprint,
        generation_version: context.generation_version,
        attempts: 0,
        available_at: new Date().toISOString(),
        lease_expires_at: null,
        claim_token: null,
        error_code: null,
      });
      return updated ? "stale" : "stale";
    }

    const raw = await generateObjectWithRetry({
      model: EXTRACTION_MODEL,
      system: TASK_INTELLIGENCE_SYSTEM_PROMPT,
      prompt: buildIntelligencePrompt(context),
      schema: taskIntelligenceOutputSchema,
      operation: "task_intelligence",
    });
    // Canonical inputs can change while the model call is in flight. Rebuild the
    // package immediately before publishing so an old snapshot never becomes ready.
    const latestContext = await loadCommitmentContext(db, { orgId: job.org_id, subject });
    if (latestContext.input_fingerprint !== job.input_fingerprint
      || latestContext.generation_version !== job.generation_version) {
      await updateClaimed(db, job, {
        state: "pending",
        input_fingerprint: latestContext.input_fingerprint,
        generation_version: latestContext.generation_version,
        attempts: 0,
        available_at: new Date().toISOString(),
        lease_expires_at: null,
        claim_token: null,
        error_code: null,
      });
      return "stale";
    }
    const validated = validateOutputAgainstContext(raw, latestContext);
    const ready = await updateClaimed(db, job, {
      state: "ready",
      context: validated.context,
      why_it_matters: validated.why_it_matters,
      recommendation: validated.recommendation,
      useful_existing_action: validated.useful_existing_action,
      attention_reason: validated.attention_reason,
      source: latestContext.source,
      source_facts: latestContext.source_facts,
      inferences: (["context", "why_it_matters", "recommendation", "useful_existing_action", "attention_reason"] as const)
        .flatMap((field) => {
          const value = validated[field];
          return value ? [{ field, text: value.text, basis: value.basis, evidence_refs: value.evidence_refs }] : [];
        }),
      provenance: provenanceFor(validated, latestContext),
      error_code: null,
      generated_at: new Date().toISOString(),
      lease_expires_at: null,
      claim_token: null,
    });
    return ready ? "ready" : "stale";
  } catch (error) {
    const retryable = isRetryable(error);
    const terminal = !retryable || job.attempts >= MAX_ATTEMPTS;
    const updated = await updateClaimed(db, job, terminal ? {
      state: "failed",
      error_code: errorCode(error),
      lease_expires_at: null,
      claim_token: null,
    } : {
      state: "pending",
      error_code: errorCode(error),
      available_at: new Date(Date.now() + retryDelayMs(job.attempts)).toISOString(),
      lease_expires_at: null,
      claim_token: null,
    });
    if (!updated) return "stale";
    logFailure("task-intelligence.worker", {
      error_type: error instanceof Error ? error.name : typeof error,
      retryable,
      terminal,
      attempts: job.attempts,
    });
    return terminal ? "failed" : "retry";
  }
}

/** Bounded worker entry point for cron and the optional post-request accelerator. */
export async function processTaskIntelligenceJobs(
  db: SupabaseClient,
  options: { limit?: number; leaseSeconds?: number } = {},
): Promise<{ claimed: number; ready: number; retried: number; failed: number; stale: number }> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), MAX_BATCH_SIZE);
  const { data, error } = await db.rpc("claim_task_intelligence_jobs", {
    p_limit: limit,
    p_lease_seconds: Math.min(Math.max(options.leaseSeconds ?? DEFAULT_LEASE_SECONDS, 30), 300),
  });
  if (error) throw error;
  const jobs = (data ?? []) as ClaimedJob[];
  const counts = { claimed: jobs.length, ready: 0, retried: 0, failed: 0, stale: 0 };
  for (let index = 0; index < jobs.length; index += MAX_CONCURRENCY) {
    const results = await Promise.all(jobs.slice(index, index + MAX_CONCURRENCY).map((job) => processOne(db, job)));
    for (const result of results) counts[result === "retry" ? "retried" : result] += 1;
  }
  return counts;
}
