import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  actionEvidenceRef,
  buildCommitmentContextPackage,
  buildIntelligencePrompt,
  deriveRiskFacts,
  evidenceAllowlistForContext,
  removeCompletedActionRecommendation,
  resolveSourceEvidence,
  validateOutputAgainstContext,
} from "@/lib/tasks/intelligence";
import {
  isTaskIntelligenceUnavailable,
  loadCommitmentContext,
  selectTranscriptForCommitment,
} from "@/lib/tasks/intelligence-query";
import { taskIntelligenceOutputSchema } from "@/lib/tasks/intelligence-schema";
import { enqueueTaskIntelligenceJob } from "@/lib/tasks/intelligence-worker";

const commitment = {
  id: "commitment-1", org_id: "org-1", conversation_id: "conversation-1", client_id: "client-1",
  text: "Send revised proposal", owner: "You", deadline: "2026-09-18", type: "deliverable",
  source_span: "You: I’ll send the final proposal Friday.", status: "tasked",
} as const;

const transcript = {
  id: "transcript-1", org_id: "org-1", conversation_id: "conversation-1",
  body: "Client: Can you send over the revised proposal by Friday?\nYou: I’ll send the final proposal Friday.",
  injection_flags: [],
};

const actionSuggestion = {
  id: "action-1", org_id: "org-1", commitment_id: "commitment-1", action_type: "gmail_draft" as const,
  confidence: "high" as const, rationale: "Confirm delivery", missing_data: [],
};

const baseOutput = {
  context: null,
  why_it_matters: null,
  recommendation: null,
  useful_existing_action: null,
  attention_reason: null,
};

function fakeDb(results: Record<string, { data: unknown; error: unknown }>): SupabaseClient {
  return {
    from(table: string) {
      const result = results[table] ?? { data: null, error: null };
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => result,
        then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("Task Intelligence context and contract", () => {
  it("keeps exact transcript provenance and records character offsets", () => {
    const evidence = resolveSourceEvidence(commitment, transcript);
    expect(evidence.verified).toBe(true);
    expect(evidence.ambiguous).toBe(false);
    expect(evidence.source_quote).toBe(commitment.source_span);
    expect(transcript.body.slice(evidence.start!, evidence.end!)).toBe(commitment.source_span);
  });

  it("fails closed when a source span occurs more than once", () => {
    const repeated = { ...transcript, body: `${transcript.body}\n${commitment.source_span}` };
    const evidence = resolveSourceEvidence(commitment, repeated);
    expect(evidence.verified).toBe(false);
    expect(evidence.ambiguous).toBe(true);
    expect(evidence.source_quote).toBeNull();
    expect(evidence.start).toBeNull();
  });

  it("does not treat a paraphrase as source evidence", () => {
    const evidence = resolveSourceEvidence({ ...commitment, source_span: "send proposal before Friday" }, transcript);
    expect(evidence.verified).toBe(false);
    expect(evidence.ambiguous).toBe(false);
    expect(evidence.source_quote).toBeNull();
  });

  it("builds source facts and fingerprints final action outcomes", () => {
    const first = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment, transcript,
      actionSuggestions: [actionSuggestion],
      actionOutcomes: [{ id: "action-1", type: "gmail_draft", state: "failed", error: "rate limited" }],
    });
    const second = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment, transcript,
      actionSuggestions: [actionSuggestion],
      actionOutcomes: [{ id: "action-1", type: "gmail_draft", state: "created", error: null }],
    });
    expect(first.source_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "commitment_text", value: commitment.text }),
      expect.objectContaining({ key: "source_quote", value: commitment.source_span }),
    ]));
    expect(first.action_outcomes[0].evidence_ref).toBe("action:action-1");
    expect(first.input_fingerprint).not.toBe(second.input_fingerprint);
  });

  it("keeps task subjects distinct when commitments have more than one task", () => {
    const first = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "task", id: "task-a" }, commitment,
      task: { id: "task-a", org_id: "org-1", commitment_id: commitment.id, title: "Prepare the set", owner: "You", due: "2026-09-18", status: "open" },
      relatedTasks: [
        { id: "task-a", org_id: "org-1", commitment_id: commitment.id, title: "Prepare the set", owner: "You", due: "2026-09-18", status: "open" },
        { id: "task-b", org_id: "org-1", commitment_id: commitment.id, title: "Review the set", owner: "Priya", due: null, status: "open" },
      ],
    });
    const second = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "task", id: "task-b" }, commitment,
      task: { id: "task-b", org_id: "org-1", commitment_id: commitment.id, title: "Review the set", owner: "Priya", due: null, status: "open" },
      relatedTasks: first.related_tasks,
    });
    expect(first.input_fingerprint).not.toBe(second.input_fingerprint);
    expect(first.subject).not.toEqual(second.subject);
  });

  it("rejects unrelated clients, tasks, and cross-organization records", () => {
    expect(() => buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment,
      client: { id: "client-other", org_id: "org-1", name: "Other", email: null },
    })).toThrow("Client does not match commitment");
    expect(() => buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment,
      relatedTasks: [{ id: "task-1", org_id: "org-1", commitment_id: "commitment-other", title: "Other", owner: null, due: null, status: "open" }],
    })).toThrow("Task does not belong to commitment");
    expect(() => buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment,
      relatedTasks: [{ id: "task-1", org_id: "org-2", commitment_id: commitment.id, title: "Other", owner: null, due: null, status: "open" }],
    })).toThrow("another organization");
  });

  it("allows a nullable commitment client without inventing a client", () => {
    const context = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id },
      commitment: { ...commitment, client_id: null }, transcript,
    });
    expect(context.commitment.client_id).toBeNull();
    expect(context.client).toBeNull();
  });

  it("selects one exact transcript deterministically and rejects ambiguous matches", () => {
    const other = { ...transcript, id: "transcript-2", body: "A different conversation." };
    expect(selectTranscriptForCommitment(commitment, [other, transcript])?.id).toBe("transcript-1");
    expect(selectTranscriptForCommitment(commitment, [
      transcript,
      { ...transcript, id: "transcript-2" },
    ])).toBeNull();
  });

  it("loads only org-scoped context and exposes every action outcome reference", async () => {
    const context = await loadCommitmentContext(fakeDb({
      commitment: { data: { ...commitment, status: "overdue" }, error: null },
      transcript: { data: [transcript], error: null },
      client_contact: { data: { id: "client-1", org_id: "org-1", name: "Priya", email: null }, error: null },
      task: { data: [], error: null },
      commitment_action_suggestion: {
        data: [
          { id: "action-pending", org_id: "org-1", commitment_id: "commitment-1", action_type: "drive_document", confidence: "medium", rationale: "Prepare the file", missing_data: [], execution_state: "proposed", last_error: null },
          { id: "action-failed", org_id: "org-1", commitment_id: "commitment-1", action_type: "gmail_draft", confidence: "high", rationale: "Confirm delivery", missing_data: [], execution_state: "failed", last_error: "provider unavailable" },
        ], error: null,
      },
    }), { orgId: "org-1", subject: { type: "commitment", id: commitment.id } });
    expect(context.transcript?.id).toBe("transcript-1");
    expect(context.risk_facts).toContain("commitment or task is overdue");
    expect(context.action_outcomes.map((outcome) => outcome.evidence_ref)).toEqual([
      "action:action-pending", "action:action-failed",
    ]);
  });

  it("includes commitment overdue risk without a task", () => {
    const facts = deriveRiskFacts({
      commitment: { status: "overdue", deadline: "2026-09-01", owner: "You" }, task: null, outcomes: [], now: new Date("2026-09-15"),
    });
    expect(facts).toContain("commitment or task is overdue");
  });

  it("requires field-level basis and evidence for every non-null field", () => {
    expect(taskIntelligenceOutputSchema.safeParse(baseOutput).success).toBe(true);
    expect(taskIntelligenceOutputSchema.safeParse({ ...baseOutput, context: {
      text: "The client requested the proposal.", basis: "Conversation context", evidence_refs: ["commitment:commitment-1"],
    } }).success).toBe(true);
    expect(taskIntelligenceOutputSchema.safeParse({ ...baseOutput, context: {
      text: "The client requested the proposal.", basis: "", evidence_refs: ["commitment:commitment-1"],
    } }).success).toBe(false);
    expect(taskIntelligenceOutputSchema.safeParse({ ...baseOutput, recommendation: {
      text: "Review the proposal", basis: "The promise is due Friday", category: "review", action_kind: "review", evidence_refs: [],
    } }).success).toBe(false);
  });

  it("nulls fields citing records outside the package", () => {
    const context = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment, transcript,
      actionSuggestions: [actionSuggestion],
      actionOutcomes: [{ id: "action-1", type: "gmail_draft", state: "failed", error: "unavailable" }],
    });
    const output = taskIntelligenceOutputSchema.parse({
      context: { text: "Unsupported", basis: "Other source", evidence_refs: ["commitment:other"] },
      why_it_matters: { text: "Grounded", basis: "The commitment", evidence_refs: ["commitment:commitment-1"] },
      recommendation: null, useful_existing_action: null, attention_reason: null,
    });
    const cleaned = validateOutputAgainstContext(output, context);
    expect(cleaned.context).toBeNull();
    expect(cleaned.why_it_matters?.text).toBe("Grounded");
    expect(evidenceAllowlistForContext(context)).not.toContain("commitment:other");
  });

  it("nulls an attention reason that has no matching concrete risk", () => {
    const context = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment, transcript,
    });
    const output = taskIntelligenceOutputSchema.parse({
      ...baseOutput,
      attention_reason: {
        code: "action_failed", text: "An action failed", basis: "Action state", evidence_refs: ["commitment:commitment-1"],
      },
    });
    expect(validateOutputAgainstContext(output, context).attention_reason).toBeNull();
  });

  it("suppresses both primary and useful recommendations for completed actions", () => {
    const output = taskIntelligenceOutputSchema.parse({
      ...baseOutput,
      recommendation: {
        text: "Draft and send the follow-up", basis: "The client asked for delivery", category: "follow_up",
        action_kind: "gmail_draft", evidence_refs: [actionEvidenceRef("action-1")],
      },
      useful_existing_action: {
        kind: "gmail_draft", text: "Draft follow-up", basis: "The commitment needs confirmation",
        evidence_refs: [actionEvidenceRef("action-1")],
      },
    });
    const cleaned = removeCompletedActionRecommendation(output, [{
      id: "action-1", type: "gmail_draft", state: "created", error: null, evidence_ref: "action:action-1",
    }]);
    expect(cleaned.recommendation).toBeNull();
    expect(cleaned.useful_existing_action).toBeNull();
  });

  it("uses recommendation category as a second completed-action guard", () => {
    const output = taskIntelligenceOutputSchema.parse({
      ...baseOutput,
      recommendation: {
        text: "Send the client a follow-up", basis: "The promise needs confirmation", category: "follow_up",
        action_kind: "none", evidence_refs: [actionEvidenceRef("action-1")],
      },
    });
    expect(removeCompletedActionRecommendation(output, [{
      id: "action-1", type: "gmail_draft", state: "created", error: null, evidence_ref: "action:action-1",
    }]).recommendation).toBeNull();
  });

  it("suppresses text-only repeats even when the model omits the action category", () => {
    const output = taskIntelligenceOutputSchema.parse({
      ...baseOutput,
      recommendation: {
        text: "Send the client a follow-up email", basis: "The commitment needs confirmation", category: "clarify",
        action_kind: "none", evidence_refs: [actionEvidenceRef("action-1")],
      },
      useful_existing_action: {
        kind: "review", text: "Draft and send the follow-up", basis: "The action is already complete",
        evidence_refs: [actionEvidenceRef("action-1")],
      },
    });
    const cleaned = removeCompletedActionRecommendation(output, [{
      id: "action-1", type: "gmail_draft", state: "created", error: null, evidence_ref: "action:action-1",
    }]);
    expect(cleaned.recommendation).toBeNull();
    expect(cleaned.useful_existing_action).toBeNull();
  });

  it("rejects an action outcome reference that names another action", () => {
    expect(() => buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment,
      actionSuggestions: [actionSuggestion],
      actionOutcomes: [{ id: "action-1", type: "gmail_draft", state: "created", error: null, evidence_ref: "action:other" }],
    })).toThrow("does not match action");
  });

  it("rejects an outcome that is not one of this commitment's action suggestions", () => {
    expect(() => buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment,
      actionSuggestions: [actionSuggestion],
      actionOutcomes: [{ id: "action-other", type: "gmail_draft", state: "failed", error: "unknown" }],
    })).toThrow("does not belong to commitment");
  });

  it("fences the context package and exposes stable evidence references", () => {
    const context = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment, transcript,
      actionSuggestions: [actionSuggestion],
      actionOutcomes: [{ id: "action-1", type: "gmail_draft", state: "blocked", error: "missing data" }],
    });
    const prompt = buildIntelligencePrompt(context);
    expect(prompt).toContain("<<UNTRUSTED_DATA>>");
    expect(prompt).toContain("<<END_UNTRUSTED_DATA>>");
    expect(prompt).toContain("action:action-1");
  });

  it("persists a durable subject/fingerprint enqueue without invoking the model", async () => {
    const context = buildCommitmentContextPackage({
      orgId: "org-1", subject: { type: "commitment", id: commitment.id }, commitment, transcript,
    });
    const rpc = vi.fn().mockResolvedValue({ data: "job-1", error: null });
    const db = { rpc } as unknown as SupabaseClient;
    await expect(enqueueTaskIntelligenceJob(db, context)).resolves.toBe("job-1");
    expect(rpc).toHaveBeenCalledWith("enqueue_task_intelligence", expect.objectContaining({
      p_org_id: "org-1",
      p_subject_type: "commitment",
      p_subject_id: "commitment-1",
      p_input_fingerprint: context.input_fingerprint,
    }));
  });

  it("recognizes Supabase table and RPC schema-cache failures as unavailable", () => {
    expect(isTaskIntelligenceUnavailable({
      code: "PGRST205",
      message: "Could not find the table 'public.task_intelligence' in the schema cache",
    })).toBe(true);
    expect(isTaskIntelligenceUnavailable({
      code: "PGRST202",
      message: "Could not find the function public.enqueue_task_intelligence in the schema cache",
    })).toBe(true);
  });

  it("defines bounded leased claims and service-only queue functions in the migration", () => {
    const sql = readFileSync("supabase/migrations/20260916022922_task_intelligence.sql", "utf8");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain("p_force_retry boolean default false");
    expect(sql).toContain("public.task_intelligence.state = 'ready'");
    expect(sql).toContain("and not p_force_retry");
    expect(sql).toContain("revoke all on function public.claim_task_intelligence_jobs");
    expect(sql).toContain("grant execute on function public.enqueue_task_intelligence");
  });
});
