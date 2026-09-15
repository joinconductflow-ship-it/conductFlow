import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardCopilotRequest } from "@/lib/copilot/request-guard";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";

vi.mock("@/lib/db/server", () => ({ getServerClient: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn() }));
const getUser = vi.fn(), membership = vi.fn(), rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  membership.mockResolvedValue({ data: { org_id: "org" }, error: null });
  rpc.mockResolvedValue({ data: true, error: null });
  const query = { select: () => query, eq: () => query, limit: () => query, maybeSingle: membership };
  vi.mocked(getServerClient).mockResolvedValue({ auth: { getUser }, from: () => query } as never);
  vi.mocked(getServiceClient).mockReturnValue({ rpc } as never);
});
describe("Copilot request authorization and distributed budget", () => {
  it("rejects unauthenticated callers before consuming budget", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await guardCopilotRequest())?.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects authenticated callers without workspace membership", async () => {
    membership.mockResolvedValue({ data: null, error: null });
    expect((await guardCopilotRequest())?.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("limits requests by verified user ID, never a browser-supplied identity", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const response = await guardCopilotRequest();
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
    expect(rpc).toHaveBeenCalledWith("consume_copilot_budget", { p_user: "user" });
  });
  it("fails closed without exposing database details", async () => {
    rpc.mockResolvedValue({ error: { message: "secret database failure" } });
    const response = await guardCopilotRequest();
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("secret");
  });
  it("allows a verified member within the budget", async () => { expect(await guardCopilotRequest()).toBeNull(); });
});
