import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { resolveToken } from "@/lib/auth/desktop-token";
import { matchMeetingToClient } from "@/lib/integrations/meeting-match";
import { logFailure } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

function captureTime(value: unknown): string {
  if (typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

export async function POST(request: Request) {
  try {
    const db = getServiceClient();
    const caller = await resolveToken(db, request.headers.get("authorization"));
    if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => null);
    const startedAt = captureTime(body?.startedAt);
    const match = await matchMeetingToClient(db, caller.orgId, startedAt);
    return NextResponse.json({ match });
  } catch (error) {
    logFailure("extension current meeting", { operation: "current_meeting", error });
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
