import { after } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import {
  getTaskIntelligence,
  isTaskIntelligenceUnavailable,
  loadCommitmentContext,
} from "@/lib/tasks/intelligence-query";
import {
  enqueueTaskIntelligenceJob,
  processTaskIntelligenceJobs,
} from "@/lib/tasks/intelligence-worker";
import { logFailure } from "@/lib/observability/log";
import type { TaskIntelligenceSubjectType } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseSubject(value: unknown): { type: TaskIntelligenceSubjectType; id: string } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { subjectType?: unknown; subjectId?: unknown };
  if ((candidate.subjectType !== "commitment" && candidate.subjectType !== "task")
    || typeof candidate.subjectId !== "string"
    || !/^[0-9a-f-]{16,}$/i.test(candidate.subjectId)) return null;
  return { type: candidate.subjectType, id: candidate.subjectId };
}

function unavailable(error: unknown): boolean {
  return isTaskIntelligenceUnavailable(error)
    || (error as { code?: unknown } | null)?.code === "42883";
}

// Never serialize worker lease metadata, attempts, or claim tokens to the browser.
function publicRecord(record: import("@/lib/types").TaskIntelligence | null) {
  if (!record) return null;
  return {
    id: record.id,
    org_id: record.org_id,
    subject_type: record.subject_type,
    subject_id: record.subject_id,
    commitment_id: record.commitment_id,
    task_id: record.task_id,
    generation_version: record.generation_version,
    input_fingerprint: record.input_fingerprint,
    state: record.state,
    context: record.context,
    why_it_matters: record.why_it_matters,
    recommendation: record.recommendation,
    useful_existing_action: record.useful_existing_action,
    attention_reason: record.attention_reason,
    source: record.source,
    source_facts: record.source_facts,
    inferences: record.inferences,
    provenance: record.provenance,
    generated_at: record.generated_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export async function GET(request: Request) {
  const orgId = await getCurrentOrgId("task-intelligence status");
  if (!orgId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const subject = parseSubject({
    subjectType: url.searchParams.get("subjectType"),
    subjectId: url.searchParams.get("subjectId"),
  });
  if (!subject) return NextResponse.json({ error: "invalid subject" }, { status: 400 });

  try {
    const record = await getTaskIntelligence(await getServerClient(), { orgId, subject });
    return NextResponse.json({ state: record?.state ?? "missing", record: publicRecord(record) });
  } catch (error) {
    if (unavailable(error)) return NextResponse.json({ state: "unavailable", unavailable: true });
    logFailure("task-intelligence.status", { error_type: error instanceof Error ? error.name : typeof error });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const orgId = await getCurrentOrgId("task-intelligence enqueue");
  if (!orgId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let subject: { type: TaskIntelligenceSubjectType; id: string } | null = null;
  let requestedRetry = false;
  try {
    const body = await request.json() as { subjectType?: unknown; subjectId?: unknown; retry?: unknown };
    subject = parseSubject(body);
    requestedRetry = body.retry === true;
  } catch {
    return NextResponse.json({ error: "invalid subject" }, { status: 400 });
  }
  if (!subject) return NextResponse.json({ error: "invalid subject" }, { status: 400 });

  try {
    const sessionDb = await getServerClient();
    // Context assembly is organization-scoped before the service-role enqueue.
    const context = await loadCommitmentContext(sessionDb, { orgId, subject });
    const existing = await getTaskIntelligence(sessionDb, { orgId, subject });
    // Only the explicit retry control for a persisted failure may reset attempts.
    // A client cannot force regeneration of a ready record by posting retry=true.
    const forceRetry = requestedRetry && existing?.state === "failed";
    const service = getServiceClient();
    const id = await enqueueTaskIntelligenceJob(service, context, { forceRetry });
    const record = await getTaskIntelligence(service, { orgId, subject });

    // Accelerate only a row that still needs work. Matching ready/failed records
    // are cache hits/terminal states and must not wake a worker for unrelated jobs.
    if (record?.state === "pending" || record?.state === "processing") {
      try {
        after(() => processTaskIntelligenceJobs(service, { limit: 1 }).catch((error) => {
          logFailure("task-intelligence.accelerator", { error_type: error instanceof Error ? error.name : typeof error });
        }));
      } catch {
        // `after` is unavailable in some local/test runtimes; cron remains the fallback.
      }
    }

    return NextResponse.json({
      id,
      state: record?.state ?? "pending",
      record: publicRecord(record),
      fingerprint: context.input_fingerprint,
    });
  } catch (error) {
    if (unavailable(error)) return NextResponse.json({ state: "unavailable", unavailable: true });
    if (error instanceof Error && /not found|another organization|does not belong|subject/i.test(error.message)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    logFailure("task-intelligence.enqueue", { error_type: error instanceof Error ? error.name : typeof error });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
