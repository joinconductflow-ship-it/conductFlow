import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { resolveToken, touchToken } from "@/lib/auth/desktop-token";
import { runIngest } from "@/lib/ingest/run";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/agent/schema";

export const dynamic = "force-dynamic";

/**
 * Commit a captured conversation for the macOS menu-bar client.
 *
 * Runs the same ingest the web app runs at /ingest — the org's blueprint contract is
 * consulted, the transcript is persisted before the model runs, spans are verified,
 * and drafts are created through the existing pipeline. Nothing here is a shortcut
 * around the chokepoint: drafts land in the queue as `proposed`, exactly as they do
 * for a member using the browser, and a human still approves before anything reaches
 * a mailbox.
 *
 * The client email is required for a reason worth stating: without an address,
 * `push_email_draft` has nowhere to write and every approval reports
 * `skipped_no_recipient`. The desktop panel blocks on that field for the same reason.
 */

/** Reuses an existing contact by name so repeat captures do not fan out duplicates. */
async function resolveClient(
  db: ReturnType<typeof getServiceClient>,
  args: { orgId: string; name: string; email: string },
): Promise<{ id: string; name: string }> {
  const { data: existing, error: lookupError } = await db
    .from("client_contact")
    .select("id, name, email")
    .eq("org_id", args.orgId)
    .ilike("name", args.name)
    .maybeSingle();

  // A lookup error is not "not found" — treating it as one would silently create a
  // duplicate contact every time the database hiccuped.
  if (lookupError) throw new Error(`client lookup failed: ${lookupError.message}`);

  if (existing) {
    // Backfill an address if the contact predates having one; never overwrite.
    if (!existing.email && args.email) {
      await db.from("client_contact").update({ email: args.email }).eq("id", existing.id);
    }
    return { id: existing.id, name: existing.name };
  }

  const { data: created, error } = await db
    .from("client_contact")
    .insert({ org_id: args.orgId, name: args.name, email: args.email })
    .select("id, name")
    .single();
  if (error) throw new Error(`could not create that client: ${error.message}`);
  return created;
}

export async function POST(request: Request) {
  const db = getServiceClient();

  let caller;
  try {
    caller = await resolveToken(db, request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await touchToken(db, caller.tokenId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const text = str("text");
  const clientName = str("clientName");
  const clientEmail = str("clientEmail");
  const title = str("title") || `Desktop capture — ${new Date().toISOString().slice(0, 10)}`;

  if (!text) return NextResponse.json({ error: "nothing to ingest" }, { status: 400 });
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      { error: `too long — ${MAX_TRANSCRIPT_CHARS} characters maximum` },
      { status: 413 },
    );
  }
  if (!clientName) return NextResponse.json({ error: "a client name is required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clientEmail)) {
    return NextResponse.json(
      { error: "a valid client email is required, or the follow-up has nowhere to go" },
      { status: 400 },
    );
  }

  try {
    const client = await resolveClient(db, {
      orgId: caller.orgId, name: clientName, email: clientEmail,
    });

    const result = await runIngest(db, {
      orgId: caller.orgId,
      clientId: client.id,
      clientName: client.name,
      title,
      occurredAt: new Date().toISOString(),
      transcript: text,
    });

    return NextResponse.json({
      clientId: client.id,
      conversationId: result.conversationId,
      commitmentCount: result.commitmentCount,
      draftCount: result.draftCount,
      flagged: result.flagged,
      dropped: result.dropped,
      // Said plainly so no client can present this as "sent".
      status: "queued for approval — nothing has been sent",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    const denied = message.startsWith("action denied");
    return NextResponse.json({ error: message }, { status: denied ? 403 : 502 });
  }
}
