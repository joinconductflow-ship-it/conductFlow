import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// Test-process fixtures only. No real requests.
const original = process.env.SITE_ORIGIN;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_ORIGIN;
  else process.env.SITE_ORIGIN = original;
});

/** A request as Vercel delivers it: the served host arrives as `x-forwarded-host`. */
function request(host: string, path = "/onboarding") {
  return new NextRequest(`https://${host}${path}`, { headers: { "x-forwarded-host": host } });
}

describe("canonical host redirect", () => {
  it("moves an off-canonical host to SITE_ORIGIN before a sign-in can start", () => {
    process.env.SITE_ORIGIN = "https://conductflow.tech";
    const response = middleware(request("conductflow-woad.vercel.app"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://conductflow.tech/onboarding");
  });

  it("keeps the path and query, so a deep link survives the move", () => {
    process.env.SITE_ORIGIN = "https://conductflow.tech";
    const response = middleware(request("conductflow-woad.vercel.app", "/auth/signin?terms=accepted"));
    expect(response.headers.get("location")).toBe("https://conductflow.tech/auth/signin?terms=accepted");
  });

  it("leaves the canonical host alone and still sets the policy", () => {
    process.env.SITE_ORIGIN = "https://conductflow.tech";
    const response = middleware(request("conductflow.tech"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  // Previews and local development leave SITE_ORIGIN unset on purpose: there the forwarded
  // host is the only origin there is, and redirecting would send them off the deployment.
  it("does nothing when SITE_ORIGIN is unset", () => {
    delete process.env.SITE_ORIGIN;
    const response = middleware(request("conductflow-git-branch.vercel.app"));
    expect(response.status).toBe(200);
  });

  it("does nothing when SITE_ORIGIN is not a URL", () => {
    process.env.SITE_ORIGIN = "conductflow.tech";
    const response = middleware(request("conductflow-woad.vercel.app"));
    expect(response.status).toBe(200);
  });
});
