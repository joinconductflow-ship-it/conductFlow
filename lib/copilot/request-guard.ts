import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";

/** Fail closed before runtime/model invocation, including on limiter/database failure. */
export async function guardCopilotRequest(): Promise<Response | null> {
  try {
    const db = await getServerClient();
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { data: membership, error: membershipError } = await db.from("membership").select("org_id")
      .eq("user_id", data.user.id).limit(1).maybeSingle();
    if (membershipError) return Response.json({ error: "unavailable" }, { status: 503 });
    if (!membership) return Response.json({ error: "forbidden" }, { status: 403 });
    const { data: allowed, error: limitError } = await getServiceClient().rpc("consume_copilot_budget", { p_user: data.user.id });
    if (limitError) return Response.json({ error: "unavailable" }, { status: 503 });
    if (allowed !== true) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
    return null;
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
