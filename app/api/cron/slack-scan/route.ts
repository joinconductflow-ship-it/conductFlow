import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { scanSlack } from "@/lib/slack/watch";

export const dynamic = "force-dynamic";

/** Same pattern as app/api/cron/reminders: closed by default without CRON_SECRET set. */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Service role: this sweeps every org that connected slack_watch, not just one caller's.
  const result = await scanSlack(getServiceClient());
  return NextResponse.json(result);
}
