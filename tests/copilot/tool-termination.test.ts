import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({
  getCurrentOrgId: vi.fn(),
  getOrganizationTimeZone: vi.fn(),
  listCommitments: vi.fn(),
  getActionSuggestionsForCommitment: vi.fn(),
}));
vi.mock("@/lib/db/server", () => ({ getServerClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/copilot/eligibility", () => ({ loadProposalEligibility: vi.fn() }));

import { listOpenCommitmentsTool } from "@/lib/copilot/tools";
import { verifyCopilotProposal } from "@/app/actions/copilot";
import {
  getCurrentOrgId,
  getOrganizationTimeZone,
  listCommitments,
} from "@/lib/db/queries";
import { loadProposalEligibility } from "@/lib/copilot/eligibility";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listOpenCommitments always returns a tool result", () => {
  it("resolves with a user-safe error (never rejects) when a query throws", async () => {
    vi.mocked(getCurrentOrgId).mockRejectedValueOnce(new Error("auth 504"));

    await expect(listOpenCommitmentsTool.execute!({})).resolves.toEqual({
      error: "I couldn't load your commitments right now. Please try again.",
    });
  });

  it("returns the normal payload on success", async () => {
    vi.mocked(getCurrentOrgId).mockResolvedValueOnce("org-1");
    vi.mocked(getOrganizationTimeZone).mockResolvedValueOnce("America/New_York");
    vi.mocked(listCommitments).mockResolvedValueOnce([]);

    const result = await listOpenCommitmentsTool.execute!({}) as {
      commitments: unknown[]; dateContext: { timeZone: string; date: string };
    };
    expect(result.commitments).toEqual([]);
    expect(result.dateContext.timeZone).toBe("America/New_York");
    expect(result.dateContext.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("verifyCopilotProposal never rejects", () => {
  it("fails closed with a verdict when the eligibility load throws", async () => {
    vi.mocked(getCurrentOrgId).mockResolvedValueOnce("org-1");
    vi.mocked(loadProposalEligibility).mockRejectedValueOnce(new Error("db down"));

    const result = await verifyCopilotProposal({
      commitmentId: "c-1", actionId: "a-1", actionType: "calendar_event",
    });
    expect(result.eligible).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("passes through the server-resolved relative date on success", async () => {
    vi.mocked(getCurrentOrgId).mockResolvedValueOnce("org-1");
    vi.mocked(loadProposalEligibility).mockResolvedValueOnce({
      eligible: true,
      resolvedDate: "2026-09-15",
      dateContext: {
        nowIso: "2026-09-12T12:00:00.000Z",
        date: "2026-09-12",
        weekday: "Saturday",
        timeZone: "America/New_York",
      },
    });

    const result = await verifyCopilotProposal({
      commitmentId: "c-1", actionId: "a-1", actionType: "calendar_event",
      dateText: "next Tuesday",
    });
    expect(result).toEqual({
      eligible: true,
      resolvedDate: "2026-09-15",
      currentDate: "2026-09-12",
    });
  });
});
