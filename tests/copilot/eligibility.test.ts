import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateProposalEligibility,
  loadProposalEligibility,
  type EligibilityCommitment,
  type EligibilitySuggestion,
} from "@/lib/copilot/eligibility";

const ORG = "org-1";

function commitment(overrides: Partial<EligibilityCommitment> = {}): EligibilityCommitment {
  return { id: "c-1", org_id: ORG, status: "proposed", ...overrides };
}

function suggestion(overrides: Partial<EligibilitySuggestion> = {}): EligibilitySuggestion {
  return {
    id: "a-1", org_id: ORG, commitment_id: "c-1", action_type: "calendar_event",
    confidence: "high", execution_state: "proposed", external_id: null, ...overrides,
  };
}

function verdict(overrides: {
  commitment?: EligibilityCommitment | null;
  suggestion?: EligibilitySuggestion | null;
  actionType?: string;
  orgId?: string;
} = {}) {
  return evaluateProposalEligibility({
    orgId: overrides.orgId ?? ORG,
    requestedCommitmentId: "c-1",
    requestedActionId: "a-1",
    requestedActionType: overrides.actionType ?? "calendar_event",
    commitment: overrides.commitment === undefined ? commitment() : overrides.commitment,
    suggestion: overrides.suggestion === undefined ? suggestion() : overrides.suggestion,
  });
}

describe("evaluateProposalEligibility", () => {
  it("allows a valid eligible commitment/action pair", () => {
    expect(verdict()).toEqual({ eligible: true });
  });

  it("blocks a nonexistent commitment", () => {
    expect(verdict({ commitment: null }).reason).toBe("no_commitment");
  });

  it("blocks a wrong-org commitment", () => {
    expect(verdict({ commitment: commitment({ org_id: "org-2" }) }).reason).toBe("wrong_org");
    expect(verdict({ suggestion: suggestion({ org_id: "org-2" }) }).reason).toBe("wrong_org");
  });

  it("blocks a completed or otherwise ineligible commitment", () => {
    for (const status of ["approved", "tasked", "done", "rejected"]) {
      expect(verdict({ commitment: commitment({ status }) }).reason).toBe("commitment_not_open");
    }
  });

  it("blocks a stale or already-created action", () => {
    expect(verdict({ suggestion: suggestion({ execution_state: "created" }) }).reason).toBe("already_created");
    expect(verdict({ suggestion: suggestion({ external_id: "gcal-123" }) }).reason).toBe("already_created");
  });

  it("blocks a mismatched action type", () => {
    expect(verdict({ actionType: "drive_document" }).reason).toBe("action_type_mismatch");
  });

  it("blocks low-confidence actions", () => {
    expect(verdict({ suggestion: suggestion({ confidence: "low" }) }).reason).toBe("low_confidence");
  });

  it("blocks a suggestion that is missing or points at another commitment", () => {
    expect(verdict({ suggestion: null }).reason).toBe("no_action");
    expect(verdict({ suggestion: suggestion({ commitment_id: "c-2" }) }).reason).toBe("no_action");
    expect(verdict({ suggestion: suggestion({ id: "a-2" }) }).reason).toBe("no_action");
  });
});

interface QueryLog { table: string; filters: [string, unknown][] }

function fakeDb(
  rows: Record<string, Record<string, unknown>[]>,
  log: QueryLog[] = [],
): SupabaseClient {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const builder = {
        select() { return builder; },
        eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
        maybeSingle() {
          log.push({ table, filters });
          const match = (rows[table] ?? []).find((row) =>
            filters.every(([key, value]) => row[key] === value));
          return Promise.resolve({ data: match ?? null, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const ROWS = {
  organization: [{ id: ORG, timezone: "America/New_York" }],
  commitment: [{ id: "c-1", org_id: ORG, status: "proposed" }],
  commitment_action_suggestion: [{
    id: "a-1", org_id: ORG, commitment_id: "c-1", action_type: "calendar_event",
    confidence: "high", execution_state: "proposed", external_id: null,
  }],
};

describe("loadProposalEligibility", () => {
  it("looks the canonical rows up org-scoped and resolves a relative date", async () => {
    const log: QueryLog[] = [];
    const result = await loadProposalEligibility(fakeDb(ROWS, log), {
      orgId: ORG,
      commitmentId: "c-1",
      actionId: "a-1",
      actionType: "calendar_event",
      dateText: "next Tuesday",
      now: new Date("2026-09-12T12:00:00.000Z"),
    });

    expect(result.eligible).toBe(true);
    expect(result.resolvedDate).toBe("2026-09-15");
    expect(result.dateContext.timeZone).toBe("America/New_York");
    expect(log.find((entry) => entry.table === "commitment")?.filters)
      .toContainEqual(["org_id", ORG]);
    expect(log.find((entry) => entry.table === "commitment_action_suggestion")?.filters)
      .toContainEqual(["org_id", ORG]);
  });

  it("fails closed when there are no canonical rows (empty workspace / fabricated ids)", async () => {
    const result = await loadProposalEligibility(fakeDb({ ...ROWS, commitment: [], commitment_action_suggestion: [] }), {
      orgId: ORG,
      commitmentId: "made-up",
      actionId: "made-up",
      actionType: "calendar_event",
      now: new Date("2026-09-12T12:00:00.000Z"),
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no_commitment");
    expect(result.resolvedDate).toBeUndefined();
  });

  it("does not resolve a date for an ineligible proposal", async () => {
    const result = await loadProposalEligibility(
      fakeDb({ ...ROWS, commitment: [{ id: "c-1", org_id: ORG, status: "done" }] }),
      {
        orgId: ORG, commitmentId: "c-1", actionId: "a-1",
        actionType: "calendar_event", dateText: "next Tuesday",
        now: new Date("2026-09-12T12:00:00.000Z"),
      },
    );
    expect(result.eligible).toBe(false);
    expect(result.resolvedDate).toBeUndefined();
  });

  it("omits resolvedDate when no relative phrase was supplied", async () => {
    const result = await loadProposalEligibility(fakeDb(ROWS), {
      orgId: ORG, commitmentId: "c-1", actionId: "a-1",
      actionType: "calendar_event", now: new Date("2026-09-12T12:00:00.000Z"),
    });
    expect(result.eligible).toBe(true);
    expect(result.resolvedDate).toBeUndefined();
  });
});
