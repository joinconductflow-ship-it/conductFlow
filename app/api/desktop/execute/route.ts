import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/db/service";
import { resolveToken, touchToken } from "@/lib/auth/desktop-token";
import { runIngest } from "@/lib/ingest/run";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/agent/schema";
import { logAudit } from "@/lib/audit/log";
import { logFailure } from "@/lib/observability/log";
import { presentError } from "@/lib/errors/presentation";

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

/**
 * This mirrors the persistence portion of createScheduledSession.  The desktop caller
 * has a bearer-token identity rather than a browser session, so its org is supplied by
 * resolveToken, never by the request.  A scheduled_session is an internal record; it is
 * deliberately not a Calendar event, which remains behind the approval chokepoint.
 */
async function createScheduledSession(
  db: ReturnType<typeof getServiceClient>,
  args: { orgId: string; clientId: string; startsAt: Date },
): Promise<string> {
  const { data: scheduled, error } = await db.from("scheduled_session").insert({
    org_id: args.orgId,
    client_id: args.clientId,
    starts_at: args.startsAt.toISOString(),
  }).select("id").single();
  if (error) throw new Error(`could not create that scheduled session: ${error.message}`);

  await logAudit({
    orgId: args.orgId,
    actor: "human",
    action: "create",
    target: `scheduled_session:${scheduled.id}:add`,
  });
  return scheduled.id as string;
}

function parseFutureMeetingAt(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  // Date.parse accepts date-only and several browser-specific forms.  The desktop API
  // accepts an ISO 8601 *datetime* with an explicit UTC offset only.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now() ? parsed : null;
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
  const hasMeetingAt = Object.hasOwn(body, "meetingAt");
  const meetingAt = hasMeetingAt ? parseFutureMeetingAt(body.meetingAt) : null;

  // Validate this before touchToken or any other write.  A bad proposed session must
  // leave no contact, ingest, audit, or token-use mutation behind.
  if (hasMeetingAt && !meetingAt) {
    return NextResponse.json({ error: "meetingAt must be a valid future ISO 8601 datetime" }, { status: 400 });
  }
  if (body.meetingNote !== undefined && typeof body.meetingNote !== "string") {
    return NextResponse.json({ error: "meetingNote must be a string" }, { status: 400 });
  }

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

  await touchToken(db, caller.tokenId);

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

    let scheduledSessionId: string | undefined;
    let calendarError: string | undefined;
    if (meetingAt) {
      try {
        // Keep Calendar itself approval-gated.  This writes only the existing internal
        // scheduling record after the blueprint-governed ingest has succeeded.
        scheduledSessionId = await createScheduledSession(db, {
          orgId: caller.orgId,
          clientId: client.id,
          startsAt: meetingAt,
        });
      } catch (error) {
        logFailure("desktop execute scheduled session", { operation: "create_scheduled_session", error });
        calendarError = "The scheduled session could not be saved. The conversation was still queued.";
      }
    }

    return NextResponse.json({
      clientId: client.id,
      conversationId: result.conversationId,
      commitmentCount: result.commitmentCount,
      draftCount: result.draftCount,
      flagged: result.flagged,
      dropped: result.dropped,
      ...(scheduledSessionId ? { scheduledSessionId } : {}),
      ...(calendarError ? { calendarError } : {}),
      // Said plainly so no client can present this as "sent".
      status: "queued for approval — nothing has been sent",
    });
  } catch (err) {
    const classification = presentError(err, {
      fallback: "Couldn't queue this conversation right now. Try again.",
      provider: "The conversation could not be queued right now. Try again.",
    });
    logFailure("desktop execute ingest", { operation: "run_ingest", error: err });
    const denied = err instanceof Error && err.message.startsWith("action denied");
    return NextResponse.json({ error: denied ? "This action is not allowed by the workspace policy." : classification }, { status: denied ? 403 : 502 });
  }
}
