import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { resolveToken, touchToken } from "@/lib/auth/desktop-token";

export const dynamic = "force-dynamic";

/**
 * The desktop client's inbox: recent conversations, newest first, with the text that
 * produced them.
 *
 * This is what lets the workflow start in ConductFlow rather than on someone's
 * clipboard. The Slack connector and the Gmail watcher both land real conversations
 * here, so a deal that arrived in a channel is already in the org's own record by the
 * time the desktop app asks for it.
 *
 * It deliberately returns the transcript body rather than the extracted commitments.
 * ConductFlow does not extract a price — its schema is commitments (owner, deadline,
 * type, confidence, verbatim span) and its prompts are explicit that a draft never
 * promises one. A client that needs deal terms has to read the source text and work
 * them out itself, which is exactly what the desktop app does locally.
 */

/** Enough to extract a deal from; short of dumping an org's whole history over HTTP. */
const MAX_ITEMS = 10;
const MAX_BODY_CHARS = 8000;

export async function GET(request: Request) {
  const db = getServiceClient();

  let caller;
  try {
    caller = await resolveToken(db, request.headers.get("authorization"));
  } catch {
    // A lookup failure is a denial, never a pass-through.
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await touchToken(db, caller.tokenId);

  const { data, error } = await db
    .from("conversation")
    .select("id, title, occurred_at, client_contact(name, email), transcript(body)")
    .eq("org_id", caller.orgId)
    .order("occurred_at", { ascending: false })
    .limit(MAX_ITEMS);

  if (error) {
    return NextResponse.json({ error: `could not read the inbox: ${error.message}` }, { status: 502 });
  }

  const items = (data ?? []).map((row) => {
    // PostgREST returns an embedded to-one as an object and a to-many as an array;
    // conversation->transcript is one-to-many in the schema even though ingest writes
    // exactly one, so handle both shapes rather than assuming.
    const client = Array.isArray(row.client_contact) ? row.client_contact[0] : row.client_contact;
    const transcripts = Array.isArray(row.transcript) ? row.transcript : [row.transcript];
    const body = transcripts.find((t) => t?.body)?.body ?? "";

    return {
      conversationId: row.id,
      title: row.title,
      occurredAt: row.occurred_at,
      clientName: client?.name ?? "",
      clientEmail: client?.email ?? "",
      text: body.slice(0, MAX_BODY_CHARS),
      truncated: body.length > MAX_BODY_CHARS,
    };
  });

  return NextResponse.json({ items });
}
