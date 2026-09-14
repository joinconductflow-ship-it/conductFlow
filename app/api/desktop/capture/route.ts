import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { resolveToken, touchToken } from "@/lib/auth/desktop-token";
import { extractCommitments } from "@/lib/agent/extract";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/agent/schema";
import { logFailure } from "@/lib/observability/log";
import { presentError } from "@/lib/errors/presentation";

export const dynamic = "force-dynamic";

/**
 * Preview extraction for the macOS menu-bar client.
 *
 * Deliberately does not persist anything. The desktop flow is capture → review →
 * execute, and the operator has not chosen a client or confirmed the terms at this
 * point — writing a conversation row here would litter the queue with every stray
 * clipboard the user pressed the hotkey on. `/api/desktop/execute` does the writing.
 *
 * Reuses `extractCommitments`, which already sanitises the input, wraps it as data
 * rather than instructions, and verifies every source span verbatim against the text.
 * None of that is reimplemented here.
 */

/**
 * Crude throttle keyed off the token's own last_used_at. This endpoint is reachable
 * with a static bearer token and every call costs gateway spend, so it cannot be
 * unbounded. Not a real rate limiter — there is no shared counter — but it stops a
 * runaway client from spending the month's budget in a loop.
 */
const MIN_INTERVAL_MS = 3000;

export async function POST(request: Request) {
  const db = getServiceClient();

  let caller;
  try {
    caller = await resolveToken(db, request.headers.get("authorization"));
  } catch {
    // A lookup failure is a denial, never a pass-through.
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: row } = await db
    .from("desktop_token").select("last_used_at").eq("id", caller.tokenId).maybeSingle();
  if (row?.last_used_at && Date.now() - Date.parse(row.last_used_at) < MIN_INTERVAL_MS) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  await touchToken(db, caller.tokenId);

  let body: { text?: unknown; clientName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "nothing to read" }, { status: 400 });
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      { error: `too long — ${MAX_TRANSCRIPT_CHARS} characters maximum` },
      { status: 413 },
    );
  }

  const clientName = typeof body.clientName === "string" && body.clientName.trim()
    ? body.clientName.trim()
    : "the client";

  try {
    const result = await extractCommitments({
      transcript: text,
      conversationDate: new Date().toISOString().slice(0, 10),
      clientName,
    });

    return NextResponse.json({
      commitments: result.commitments,
      flagged: result.flagged,
      dropped: result.dropped,
    });
  } catch (err) {
    logFailure("desktop capture extraction", { operation: "extract_commitments", error: err });
    return NextResponse.json({ error: presentError(err, {
      fallback: "Couldn't extract commitments right now. Try again.",
      provider: "Commitment extraction is temporarily unavailable. Try again.",
    }) }, { status: 502 });
  }
}
