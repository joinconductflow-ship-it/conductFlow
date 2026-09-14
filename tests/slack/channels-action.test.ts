import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSlackChannels } from "@/app/actions/slack-channels";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { availableChannels, slackToken, SlackApiError } from "@/lib/slack/client";
import { logFailure } from "@/lib/observability/log";
import { DataSourceUnavailable } from "@/lib/google/tokens";

vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/slack/client", async (original) => ({
  ...await original<typeof import("@/lib/slack/client")>(),
  availableChannels: vi.fn(), slackToken: vi.fn(), slackApi: vi.fn(),
}));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));

const update = vi.fn();
let savedState = "active";
let savedError: string | null = null;
function database() {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query),
    update: vi.fn((value) => { update(value); return query; }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: [{ id: "connection", account_email: "workspace", state: savedState, last_error: savedError }], error: null,
    }).then(resolve),
  };
  return { from: vi.fn(() => query) } as never;
}

beforeEach(() => {
  vi.clearAllMocks(); savedState = "active"; savedError = null;
  vi.mocked(getCurrentOrgId).mockResolvedValue("org");
  vi.mocked(getServiceClient).mockReturnValue(database());
  vi.mocked(slackToken).mockResolvedValue("xoxb-test");
  vi.mocked(availableChannels).mockResolvedValue([]);
});

describe("listSlackChannels safe health boundary", () => {
  it("returns Connected after successful discovery, including zero channels", async () => {
    expect(await listSlackChannels("org")).toEqual({ channels: [], health: "connected", message: null });
  });

  it("keeps decryption detail in server logs and returns serializable reconnect guidance", async () => {
    const cause = new DataSourceUnavailable("Slack needs to be reconnected before ConductFlow can read channels.", "reconnect");
    vi.mocked(slackToken).mockRejectedValue(cause);
    const result = JSON.parse(JSON.stringify(await listSlackChannels("org")));
    expect(result.health).toBe("needs_reconnect");
    expect(result.message).toBe("Slack needs to be reconnected before ConductFlow can read channels.");
    expect(logFailure).toHaveBeenCalledWith("Slack channels load", expect.objectContaining({ error: cause, orgId: "org" }));
    expect(availableChannels).not.toHaveBeenCalled();
  });

  it.each(["invalid_auth", "token_revoked", "token_expired", "account_inactive", "missing_scope"])("marks %s as reconnect-required without exposing API text", async (code) => {
    vi.mocked(availableChannels).mockRejectedValue(new SlackApiError(code, 200));
    const result = await listSlackChannels("org");
    expect(result.health).toBe("needs_reconnect");
    expect(JSON.stringify(result)).not.toContain(code);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ state: "error", last_error: "reconnect_required" }));
  });

  it("returns retry guidance for transient provider failure without invalidating credentials", async () => {
    const cause = new Error("Slack rate limited scan. Retry after 60 seconds. private payload");
    vi.mocked(availableChannels).mockRejectedValue(cause);
    const result = await listSlackChannels("org");
    expect(result.health).toBe("connection_issue");
    expect(result.message).toBe("Couldn't load Slack channels right now. Try reloading channels.");
    expect(JSON.stringify(result)).not.toContain("private payload");
    expect(update).not.toHaveBeenCalled();
    expect(logFailure).toHaveBeenCalledWith("Slack channels load", expect.objectContaining({ error: cause }));
  });

  it("honors persisted reconnect state instead of declaring an error row disconnected", async () => {
    savedState = "error"; savedError = "credential_decryption_failed";
    expect((await listSlackChannels("org")).health).toBe("needs_reconnect");
    expect(slackToken).not.toHaveBeenCalled();
  });

  it("restores Connected when reconnect has stored an active fresh credential", async () => {
    savedState = "error"; savedError = "reconnect_required";
    expect((await listSlackChannels("org")).health).toBe("needs_reconnect");
    savedState = "active"; savedError = null;
    expect((await listSlackChannels("org")).health).toBe("connected");
  });

  it.each([null, "other-org"])("fails closed before provider reads when org is %s", async (org) => {
    vi.mocked(getCurrentOrgId).mockResolvedValue(org);
    await expect(listSlackChannels("org")).rejects.toThrow(org ? "Workspace access denied." : "Sign in to manage Slack channels.");
    expect(getServiceClient).not.toHaveBeenCalled();
  });
});
