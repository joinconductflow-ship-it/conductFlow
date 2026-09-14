import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { generateMeetingSuggestions } from "@/lib/meeting/assistant";
import { logFailure } from "@/lib/observability/log";
import { presentError } from "@/lib/errors/presentation";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-assistant-secret",
};

function authorized(request: Request): boolean {
  const secret = process.env.MEETING_ASSISTANT_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-assistant-secret") ?? "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function json(body: { error: string } | { suggestions: string[]; flagged: string[] }, status: number) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body || typeof body !== "object" || !("recentTranscript" in body)
    || typeof body.recentTranscript !== "string") {
    return json({ error: "recentTranscript must be a string." }, 400);
  }
  const payload = body as { recentTranscript: string; previousSuggestions?: unknown };
  if (payload.previousSuggestions !== undefined
    && (!Array.isArray(payload.previousSuggestions)
      || !payload.previousSuggestions.every((suggestion) => typeof suggestion === "string"))) {
    return json({ error: "previousSuggestions must be an array of strings." }, 400);
  }

  try {
    const result = await generateMeetingSuggestions({
      recentTranscript: payload.recentTranscript,
      previousSuggestions: payload.previousSuggestions as string[] | undefined,
    });
    return json(result, 200);
  } catch (error) {
    logFailure("meeting assistant generation", { provider: "ai", operation: "meeting_suggestions", error });
    return json({ error: presentError(error, {
      fallback: "Copilot is temporarily unavailable. Please try again.",
      provider: "Copilot is temporarily unavailable. Please try again.",
    }) }, 502);
  }
}
