import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { processTaskIntelligenceJobs } from "@/lib/tasks/intelligence-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Vercel Hobby permits daily schedules; the worker itself remains bounded and
  // durable, while detail-page opens use the optional accelerator for fast UX.
  const result = await processTaskIntelligenceJobs(getServiceClient(), { limit: 10 });
  return NextResponse.json(result);
}
