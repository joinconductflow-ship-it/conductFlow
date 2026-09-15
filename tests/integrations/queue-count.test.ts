import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import QueuePage from "@/app/(app)/queue/page";
import { getServerClient } from "@/lib/db/server";

vi.mock("@/lib/db/server", () => ({ getServerClient: vi.fn() }));
vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: async () => "org", listCommitments: async () => [],
  listFailedTranscripts: async () => [], listOpenEscalations: async () => [] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/queue/GmailScanButton", () => ({ GmailScanButton: () => null }));
vi.mock("@/components/queue/SlackScanButton", () => ({ SlackScanButton: () => null }));
vi.mock("@/app/actions/unmatched", () => ({ createClientAndLink: vi.fn(), ignoreUnmatchedSource: vi.fn(),
  linkUnmatchedSource: vi.fn(), searchUnmatchedClients: vi.fn() }));
it("shows the exact total, labels the 50-row window, and describes daily batches honestly", async () => {
  const select = vi.fn(), limits: number[] = [];
  const sources = Array.from({ length: 50 }, (_, i) => ({ id: String(i), provider: "google", source_type: "email",
    source_key: `person${i}@example.com`, source_name: `Person ${i}`, source_label: null,
    occurrence_count: 1, last_seen_at: "2026-09-14T12:00:00Z" }));
  vi.mocked(getServerClient).mockResolvedValue({ from(table: string) {
    const chain = {
      select(...args: unknown[]) { select(...args); return chain; }, eq: () => chain, order: () => chain,
      limit(value: number) { limits.push(value); return chain; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({
        data: table === "integration_unmatched_source" ? sources : [], count: 87, error: null,
      }).then(resolve); },
    }; return chain;
  } } as never);
  const html = renderToStaticMarkup(await QueuePage());
  expect(select).toHaveBeenCalledWith(expect.any(String), { count: "exact" });
  expect(limits).toContain(50);
  expect(html).toContain("87 unmatched sources");
  expect(html).toContain("Showing 50 of 87");
  expect(html).toContain("Scheduled daily batches");
  expect(html).not.toContain("50 unmatched sources");
});
