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
vi.mock("@/lib/google/draft-context", () => ({ contextForOrg: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: () => serviceDb }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { runIngest, retryExtractionFor } from "@/lib/ingest/run";
import { regenerateDraftFor } from "@/lib/drafts/regenerate";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";
import { extractCommitments } from "@/lib/agent/extract";
import { planCommitmentActions } from "@/lib/agent/action-plan";
import { generateFollowUpDraft } from "@/lib/agent/draft";
import { contextForOrg } from "@/lib/google/draft-context";

const args = {
  orgId: "org-1", clientId: "client-1", clientName: "Acme", title: "Call",
  occurredAt: "2026-09-09", transcript: "Alex will send the deck by Friday.",
};
const commitment = {
  text: "Send the deck", owner: "Alex", deadline: "2026-09-11",
  type: "deliverable" as const, confidence: "high" as const, source_span: args.transcript,
  span_verified: true,
};

function database() {
  const row = {
    ...commitment, id: "row-1", org_id: args.orgId, client_id: args.clientId,
    conversation_id: "conversation-1", body: args.transcript, occurred_at: args.occurredAt,
  };
  const query = {
    select: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data: row, error: null })),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  const from = vi.fn(() => query);
  return { db: { from } as unknown as SupabaseClient, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
  vi.mocked(extractCommitments).mockResolvedValue({ commitments: [commitment], dropped: 0, flagged: [] });
  vi.mocked(planCommitmentActions).mockResolvedValue({ actions: [{
    type: "gmail_draft", confidence: "high", rationale: "The client needs the promised deck confirmed.",
    required_data: ["recipient", "subject", "body"], missing_data: ["recipient"],
  }] });
  vi.mocked(generateFollowUpDraft).mockResolvedValue({ subject: "Deck", body: "As discussed." });
  vi.mocked(contextForOrg).mockResolvedValue({ templateText: null, meetingContext: null, sources: [] });
});

describe("source checks before agent work", () => {
  it("denies ingest before writing or extracting when client context is disallowed", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT, allowed_sources: ["transcript"],
    }));
    const { db, from } = database();
    await expect(runIngest(db, args)).rejects.toThrow("source_not_allowed");
    expect(from).not.toHaveBeenCalled();
    expect(extractCommitments).not.toHaveBeenCalled();
  });

  it("denies retry before client lookup or extraction when transcript use is disallowed", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT, allowed_sources: ["client_contact"],
    }));
    const { db, from } = database();
    await expect(retryExtractionFor(db, "transcript-1")).rejects.toThrow("source_not_allowed");
    expect(from.mock.calls).toEqual([["transcript"]]);
    expect(extractCommitments).not.toHaveBeenCalled();
  });

  it("human regeneration still requires client-contact permission", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT, allowed_sources: ["transcript"],
    }));
    const { db, from } = database();
    await expect(regenerateDraftFor(db, { commitmentId: "commitment-1" }))
      .rejects.toThrow("source_not_allowed");
    expect(from.mock.calls).toEqual([["commitment"]]);
    expect(generateFollowUpDraft).not.toHaveBeenCalled();
  });

  it("regenerates without template permission because it fetches no Google context", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT, allowed_sources: ["transcript", "client_contact"],
    }));
    await regenerateDraftFor(database().db, { commitmentId: "commitment-1" });
    expect(generateFollowUpDraft).toHaveBeenCalledOnce();
    expect(contextForOrg).not.toHaveBeenCalled();
  });

  it.each([
    { optional: [] }, { optional: ["template"] }, { optional: ["calendar_event"] },
    { optional: ["template", "calendar_event"] },
  ])("drafts with only the allowed optional context: $optional", async ({ optional }) => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT, allowed_sources: ["transcript", "client_contact", ...optional],
    }));
    const result = await runIngest(database().db, args);
    expect(result.draftCount).toBe(1);
    expect(generateFollowUpDraft).toHaveBeenCalledOnce();
    if (optional.length) {
      expect(contextForOrg).toHaveBeenCalledExactlyOnceWith(serviceDb, {
        orgId: args.orgId, clientName: args.clientName, occurredAt: args.occurredAt,
        allowedSources: optional,
      });
    } else {
      expect(contextForOrg).not.toHaveBeenCalled();
      expect(generateFollowUpDraft).toHaveBeenCalledWith(expect.objectContaining({
        templateText: null, meetingContext: null,
      }), undefined);
    }
  });
});
