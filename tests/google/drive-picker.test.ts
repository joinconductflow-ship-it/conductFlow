import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDrivePickerToken } from "@/app/actions/drive-picker";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServiceClient } from "@/lib/db/service";
import { DataSourceUnavailable, getAccessToken } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";

vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/google/tokens", async (original) => ({
  ...await original<typeof import("@/lib/google/tokens")>(),
  getAccessToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentOrgId).mockResolvedValue("org-owner");
});

describe("getDrivePickerToken", () => {
  it("does not obtain a service client or token when signed out", async () => {
    vi.mocked(getCurrentOrgId).mockResolvedValue(null);
    expect(await getDrivePickerToken()).toEqual({ error: "signed_out" });
    expect(getServiceClient).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("returns only the access token, using the signed-in org and drive.file", async () => {
    vi.mocked(getAccessToken).mockResolvedValue("ya29.picker-access-token");
    expect(await getDrivePickerToken()).toBe("ya29.picker-access-token");
    expect(getAccessToken).toHaveBeenCalledExactlyOnceWith(
      vi.mocked(getServiceClient).mock.results[0].value,
      "org-owner", CAPABILITIES.drive_templates.scopes[0],
    );
  });

  it.each(["missing", "revoked", "scope", "reconnect"] as const)("handles a %s grant", async (reason) => {
    vi.mocked(getAccessToken).mockRejectedValue(new DataSourceUnavailable("private detail", reason));
    expect(await getDrivePickerToken()).toEqual({ error: "connect_drive" });
  });

  it.each([
    new DataSourceUnavailable("private provider detail", "refused"),
    new Error("private token detail"),
  ])("does not serialize token failures to the browser", async (error) => {
    vi.mocked(getAccessToken).mockRejectedValue(error);
    expect(await getDrivePickerToken()).toEqual({ error: "token_error" });
  });
});
