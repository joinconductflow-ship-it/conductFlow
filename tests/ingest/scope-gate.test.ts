import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { serviceDb } = vi.hoisted(() => ({
  serviceDb: {
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null })),
    })),
  },
}));

vi.mock("@/lib/agent/blueprint-store", () => ({ contractFor: vi.fn() }));
vi.mock("@/lib/agent/extract", () => ({ extractCommitments: vi.fn() }));
vi.mock("@/lib/agent/action-plan", () => ({ planCommitmentActions: vi.fn() }));
vi.mock("@/lib/agent/draft", () => ({ generateFollowUpDraft: vi.fn() }));
vi.mock("@/lib/agent/scope-check", () => ({ gateCommitmentScope: vi.fn() }));
vi.mock("@/lib/google/draft-context", () => ({ contextForOrg: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: () => serviceDb }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { runIngest } from "@/lib/ingest/run";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";
import { extractCommitments } from "@/lib/agent/extract";
import { planCommitmentActions } from "@/lib/agent/action-plan";
import { generateFollowUpDraft } from "@/lib/agent/draft";
import { gateCommitmentScope } from "@/lib/agent/scope-check";
import { contextForOrg } from "@/lib/google/draft-context";

const args = {
  orgId: "org-1", clientId: "client-1", clientName: "Acme", title: "Call",
  occurredAt: "2026-09-09", transcript: "Alex will redesign the whole website by Friday.",
};
const commitment = {
  text: "Redesign the whole website", owner: "Alex", deadline: "2026-09-11",
  type: "deliverable" as const, confidence: "high" as const, source_span: args.transcript,
  span_verified: true,
};

function database() {
  const row = { id: "row-1", org_id: args.orgId };
  const query = {
    select: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data: row, error: null })),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  const from = vi.fn(() => query);
  return { db: { from } as unknown as SupabaseClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
  vi.mocked(extractCommitments).mockResolvedValue({ commitments: [commitment], dropped: 0, flagged: [] });
  vi.mocked(planCommitmentActions).mockResolvedValue({ actions: [{
    type: "gmail_draft", confidence: "high", rationale: "The client needs the promised work confirmed.",
    required_data: ["recipient", "subject", "body"], missing_data: ["recipient"],
  }] });
  vi.mocked(generateFollowUpDraft).mockResolvedValue({ subject: "Redesign", body: "As discussed." });
  vi.mocked(contextForOrg).mockResolvedValue({ templateText: null, meetingContext: null, sources: [] });
});

describe("scope gate wired into ingest", () => {
  it("drafts a normal follow-up when the client has no scope_of_work (skipped)", async () => {
    vi.mocked(gateCommitmentScope).mockResolvedValue({ outcome: "skipped", reason: "no_scope_of_work" });
    const result = await runIngest(database().db, args);
    expect(result.draftCount).toBe(1);
    expect(generateFollowUpDraft).toHaveBeenCalledOnce();
  });

  it("skips the normal follow-up for a commitment flagged as a change order", async () => {
    vi.mocked(gateCommitmentScope).mockResolvedValue({
      outcome: "change_order_drafted",
      check: { covered: false, reason: "outside the agreed scope", flagged: [] },
      draftId: "draft-1",
    });
    const result = await runIngest(database().db, args);
    expect(result.draftCount).toBe(0);
    expect(generateFollowUpDraft).not.toHaveBeenCalled();
  });

  it("does not generate an email when planning suggests only an internal task", async () => {
    vi.mocked(planCommitmentActions).mockResolvedValue({ actions: [{
      type: "internal_task", confidence: "high", rationale: "The work is internal.",
      required_data: ["task_title", "owner", "due_date"], missing_data: [],
    }] });
    vi.mocked(gateCommitmentScope).mockResolvedValue({ outcome: "skipped", reason: "no_scope_of_work" });
    const result = await runIngest(database().db, args);
    expect(result.actionCount).toBe(1);
    expect(result.draftCount).toBe(0);
    expect(generateFollowUpDraft).not.toHaveBeenCalled();
    expect(contextForOrg).not.toHaveBeenCalled();
  });

  it("still drafts normally if the scope check itself throws (fail open)", async () => {
    vi.mocked(gateCommitmentScope).mockRejectedValue(new Error("gateway exploded"));
    const result = await runIngest(database().db, args);
    expect(result.draftCount).toBe(1);
  });
});
