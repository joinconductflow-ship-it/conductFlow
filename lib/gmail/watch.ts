import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { createGmailClient, GmailError } from "./client";
import { parseInboundMessage } from "./inbound";
import { getAccessToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";
import { runIngest } from "@/lib/ingest/run";
import { logFailure } from "@/lib/observability/log";

const READ_SCOPE = CAPABILITIES.gmail_watch.scopes[0];

/** First-ever scan on a connection looks back this far, not the whole mailbox history. */
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_MESSAGES_PER_ORG = 10;

export interface ScanGmailArgs {
  /** Omit to scan every org with an active gmail_watch connection — what the cron route does. */
  orgId?: string;
  now?: Date;
  maxMessagesPerOrg?: number;
}

export interface ScanGmailResult {
  connectionsScanned: number;
  messagesConsidered: number;
  ingested: number;
  skippedUnmatchedSender: number;
  errors: number;
}

interface ConnectionRow {
  id: string; org_id: string; scopes: string[]; gmail_last_scanned_at: string | null;
}

/**
 * The inbox side of "ConductFlow watches your Gmail": for each org that granted
 * `gmail_watch`, reads inbox mail received since the last scan, matches the sender against
 * a known client, and turns anything that matches straight into proposed commitments via
 * the same pipeline `/ingest` uses for a pasted transcript. A commitment created this way is
 * still just `proposed` — nothing is drafted to a client or sent without the usual approval.
 *
 * Unmatched senders are skipped outright rather than guessed at: silently letting a stranger's
 * email create commitments in someone's business is a worse failure mode than missing one.
 */
export async function scanGmail(
  db: SupabaseClient, args: ScanGmailArgs = {}, model?: LanguageModel,
): Promise<ScanGmailResult> {
  const now = args.now ?? new Date();
  const maxMessagesPerOrg = args.maxMessagesPerOrg ?? DEFAULT_MAX_MESSAGES_PER_ORG;

  let query = db.from("connected_data_source")
    .select("id,org_id,scopes,gmail_last_scanned_at")
    .eq("provider", "google").eq("state", "active");
  if (args.orgId) query = query.eq("org_id", args.orgId);
  const { data, error } = await query;
  if (error) throw error;

  const result: ScanGmailResult = {
    connectionsScanned: 0, messagesConsidered: 0, ingested: 0,
    skippedUnmatchedSender: 0, errors: 0,
  };

  for (const row of (data ?? []) as ConnectionRow[]) {
    if (!row.scopes.includes(READ_SCOPE)) continue;
    result.connectionsScanned++;
    try {
      await scanOneConnection(db, row, now, maxMessagesPerOrg, model, result);
    } catch (e) {
      // A `DataSourceUnavailable` here means the grant was revoked between the row read
      // above and the token fetch — normal, not worth counting as a scan failure.
      if (e instanceof DataSourceUnavailable) continue;
      result.errors++;
      logFailure("scanGmail.connection", e);
    }
  }
  return result;
}

async function scanOneConnection(
  db: SupabaseClient, connection: ConnectionRow, now: Date, maxMessages: number,
  model: LanguageModel | undefined, result: ScanGmailResult,
): Promise<void> {
  const lastScanned = connection.gmail_last_scanned_at
    ? new Date(connection.gmail_last_scanned_at)
    : new Date(now.getTime() - INITIAL_LOOKBACK_MS);

  const accessToken = await getAccessToken(db, connection.org_id, READ_SCOPE);
  const client = createGmailClient(accessToken);

  const afterEpochSeconds = Math.floor(lastScanned.getTime() / 1000);
  const candidates = await client.listMessages(
    `in:inbox after:${afterEpochSeconds}`, maxMessages * 2,
  );

  const parsed = (await Promise.all(candidates.map(async ({ id }) => {
    try {
      const message = await client.getMessage(id);
      return message ? parseInboundMessage(message) : null;
    } catch (e) {
      // One unreadable message (a malformed part, a transient Gmail error) must not cost
      // the whole scan — the rest of the candidates still get a chance.
      if (!(e instanceof GmailError)) logFailure("scanGmail.getMessage", e);
      return null;
    }
  })))
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .filter((m) => m.receivedAtMs > lastScanned.getTime())
    // Newest first so a cap below the candidate count keeps the most recent mail, not the
    // oldest — dropping today's message in favor of a three-day-old one would be backwards.
    .sort((a, b) => b.receivedAtMs - a.receivedAtMs)
    .slice(0, maxMessages)
    // Re-ascending once the newest are kept, so a client's own multi-message thread is
    // ingested in the order it was actually said.
    .sort((a, b) => a.receivedAtMs - b.receivedAtMs);

  result.messagesConsidered += parsed.length;

  for (const message of parsed) {
    const { data: client_contact } = await db.from("client_contact")
      .select("id,name").eq("org_id", connection.org_id)
      .ilike("email", message.fromEmail).limit(1).maybeSingle();

    if (!client_contact) {
      result.skippedUnmatchedSender++;
      continue;
    }

    try {
      await runIngest(db, {
        orgId: connection.org_id,
        clientId: client_contact.id as string,
        clientName: client_contact.name as string,
        title: message.subject,
        occurredAt: new Date(message.receivedAtMs).toISOString().slice(0, 10),
        transcript: message.bodyText,
      }, model);
      result.ingested++;
    } catch (e) {
      result.errors++;
      logFailure("scanGmail.runIngest", e);
    }
  }

  const { error: updateError } = await db.from("connected_data_source")
    .update({ gmail_last_scanned_at: now.toISOString() }).eq("id", connection.id);
  if (updateError) logFailure("scanGmail.updateLastScanned", updateError);
}
