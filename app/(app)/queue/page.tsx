import Link from "next/link";
import { getServerClient } from "@/lib/db/server";
import { SlackScanButton } from "@/components/queue/SlackScanButton";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import {
  getCurrentOrgId, listCommitments, listFailedTranscripts, listOpenEscalations,
} from "@/lib/db/queries";
import { CommitmentList } from "@/components/queue/CommitmentList";
import { NeedsAttention } from "@/components/queue/NeedsAttention";
import { EscalationStrip } from "@/components/queue/EscalationStrip";
import { GmailScanButton } from "@/components/queue/GmailScanButton";
import { PageHeader, EmptyState, buttonStyle, pageStyle } from "@/components/ui/primitives";

export default async function QueuePage() {
  const orgId = await getCurrentOrgId("/queue");
  if (!orgId) return (
    <main style={pageStyle}>
    <PageHeader title="Queue" />
      <EmptyState
        title="Sign in to see your commitments"
        body="ConductFlow keeps every promise your team made in one reviewable list."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const [commitments, failed, escalations] = await Promise.all([
    readPageData("/queue: commitment", () => listCommitments(orgId)),
    readPageData("/queue: transcript failed extractions", () => listFailedTranscripts(orgId)),
    readPageData("/queue: escalation", () => listOpenEscalations(orgId)),
  ]);
  // Earliest date first — the promise closest to (or past) its deadline is the one an
  // owner needs to see without scrolling. Undated commitments sort last: there is no
  // urgency to rank them by, and burying them below dated work is the honest read.
  const items = [...(commitments.data ?? [])].sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return Date.parse(a.deadline) - Date.parse(b.deadline);
  });
  const slackReady = await readPageData("/queue: Slack readiness", async () => {
    const db = await getServerClient();
    const { data: connections, error } = await db.from("connected_data_source_public").select("id")
      .eq("org_id", orgId).eq("provider", "slack").eq("state", "active");
    if (error) throw error;
    if (!connections?.length) return false;
    const { data, error: mappingError } = await db.from("slack_channel_mapping").select("id")
      .eq("org_id", orgId).in("connected_data_source_id", connections.map((connection) => connection.id)).limit(1);
    if (mappingError) throw mappingError;
    return !!data?.length;
  });
  const nowIso = new Date().toISOString();
  const overdueCount = items.filter((c) => c.status !== "done" && c.deadline
    && Number.isFinite(Date.parse(c.deadline)) && Date.parse(c.deadline) < Date.now()).length;
  const needsReview = items.filter((c) => c.status === "proposed").length;
  const needsDecision = escalations.unavailable ? null : (escalations.data ?? []).length;
  const queueMeta = [
    `${needsReview} awaiting review`,
    `${overdueCount} overdue`,
    ...(needsDecision === null ? [] : [`${needsDecision} need a decision`]),
  ].join(" · ");

  return (
    <main style={pageStyle}>
      {/* The count is the one number an owner checks on arrival, so it sits in the header
          rather than floating above the list. */}
      <PageHeader
        title="Queue"
        lede="ConductFlow collects the commitments from your conversations here so you can review what needs attention and track what happens next."
        meta={queueMeta}
      />

      <div className="queue-sync-row" aria-label="Conversation sync">
        <div className="queue-sync-controls">
          <GmailScanButton />
          {slackReady.data && <SlackScanButton />}
        </div>
        <span className="mono queue-sync-caption">Pull new conversations into the queue</span>
      </div>

      {/* Escalations first: a complaint outranks the queue it came from. */}
      {escalations.unavailable ? <Unavailable section="Escalations are" /> : <EscalationStrip items={escalations.data ?? []} />}
      {failed.unavailable ? <Unavailable section="Extraction alerts are" /> : <NeedsAttention items={failed.data ?? []} />}
      {commitments.unavailable
        ? <Unavailable section="Commitments are" />
        : <CommitmentList items={items} nowIso={nowIso} />}
    </main>
  );
}
