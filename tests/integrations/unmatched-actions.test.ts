import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientAndLink, ignoreUnmatchedSource, linkUnmatchedSource, searchUnmatchedClients } from "@/app/actions/unmatched";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { slackApi, slackToken } from "@/lib/slack/client";
import { scanDatabase } from "./scan-fixture";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ getServerClient: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/slack/client", () => ({ slackApi: vi.fn(), slackToken: vi.fn() }));
const serviceRpc = vi.fn();
function fixture(status = "open", provider = "google") {
  const f = scanDatabase({ integration_unmatched_source: [{ id: "source", org_id: "org", status, provider,
    connected_data_source_id: "connection", channel_id: "C1" }], client_contact: [{ id: "client", org_id: "org" }] });
  vi.mocked(getServerClient).mockResolvedValue(f.db);
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentOrgId).mockResolvedValue("org");
  vi.mocked(getServiceClient).mockReturnValue({ rpc: serviceRpc } as never);
  serviceRpc.mockResolvedValue({ data: "client", error: null });
  vi.mocked(slackToken).mockResolvedValue("token");
  vi.mocked(slackApi).mockResolvedValue({ channel: { id: "C1", is_member: true } });
});
describe("unmatched source server actions", () => {
  it("requires authentication before accessing a source", async () => {
    fixture(); vi.mocked(getCurrentOrgId).mockResolvedValue(null);
    await expect(ignoreUnmatchedSource("source")).rejects.toThrow("Sign in");
    expect(getServerClient).not.toHaveBeenCalled();
  });
  it.each(["linked", "ignored"])("cannot transition an already %s source", async (status) => {
    fixture(status);
    await expect(ignoreUnmatchedSource("source")).rejects.toThrow("no longer open");
    await expect(createClientAndLink("source", "Client")).rejects.toThrow("no longer open");
    await expect(linkUnmatchedSource("source", "client")).rejects.toThrow("no longer open");
    expect(serviceRpc).not.toHaveBeenCalled();
  });
  it("rejects foreign source and client IDs", async () => {
    fixture();
    await expect(linkUnmatchedSource("foreign-source", "client")).rejects.toThrow("no longer open");
    await expect(linkUnmatchedSource("source", "foreign-client")).rejects.toThrow("workspace");
    expect(serviceRpc).not.toHaveBeenCalled();
  });
  it("delegates create and link to one transaction, never a separate client insert", async () => {
    const f = fixture();
    serviceRpc.mockResolvedValue({ error: { message: "private constraint detail" } });
    await expect(createClientAndLink("source", "New Client")).rejects.toThrow("Could not resolve");
    expect(serviceRpc).toHaveBeenCalledWith("resolve_unmatched_source", {
      p_org: "org", p_source: "source", p_action: "create", p_name: "New Client", p_client: null,
    });
    expect(f.calls.every((c) => c.operation === "select")).toBe(true);
  });
  it("validates Slack channel access before creating a client", async () => {
    fixture("open", "slack"); vi.mocked(slackApi).mockRejectedValue(new Error("private provider error"));
    await expect(createClientAndLink("source", "Client")).rejects.toThrow("Slack channel unavailable");
    expect(serviceRpc).not.toHaveBeenCalled();
  });
  it("links and ignores with the verified org and explicit action", async () => {
    fixture();
    await linkUnmatchedSource("source", "client");
    expect(serviceRpc).toHaveBeenLastCalledWith("resolve_unmatched_source", expect.objectContaining({ p_org: "org", p_action: "link", p_client: "client" }));
    await ignoreUnmatchedSource("source");
    expect(serviceRpc).toHaveBeenLastCalledWith("resolve_unmatched_source", expect.objectContaining({ p_org: "org", p_action: "ignore" }));
  });
  it("bounds searches to 20 safe display results and passes wildcard text as an RPC value", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: "Client", org_id: "org", email: "a@example.com", secret: "hidden" })), error: null });
    const results = await searchUnmatchedClients(" a_%* ");
    expect(results).toHaveLength(20);
    expect(f.rpc).toHaveBeenCalledWith("search_unmatched_clients", { p_org: "org", p_query: "a_%*" });
    expect(results[0]).not.toHaveProperty("secret");
    expect(await searchUnmatchedClients("a")).toEqual([]);
  });
});
