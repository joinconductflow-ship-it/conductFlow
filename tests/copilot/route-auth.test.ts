import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), agent: vi.fn(), invoke: vi.fn(() => new Response("ok")) }));
vi.mock("@/lib/copilot/request-guard", () => ({ guardCopilotRequest: mocks.guard }));
vi.mock("@ai-sdk/gateway", () => ({ createGateway: () => () => ({}) }));
vi.mock("@/lib/copilot/tools", () => ({ copilotTools: {} }));
vi.mock("@copilotkit/runtime/v2", () => ({
  BuiltInAgent: class { constructor() { mocks.agent(); } }, CopilotRuntime: class {},
  createCopilotRuntimeHandler: () => mocks.invoke,
}));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
it.each(["GET", "POST"] as const)("%s does not construct or invoke BuiltInAgent before authorization", async (method) => {
  mocks.guard.mockResolvedValue(new Response("unauthorized", { status: 401 }));
  const route = await import("@/app/api/copilotkit/[[...copilotkit]]/route");
  expect((await route[method](new Request("http://local/api/copilotkit", { method }))).status).toBe(401);
  expect(mocks.agent).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.guard.mockResolvedValue(null);
  expect((await route[method](new Request("http://local/api/copilotkit", { method }))).status).toBe(200);
  expect(mocks.agent).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
