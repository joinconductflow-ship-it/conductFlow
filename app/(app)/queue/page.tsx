import Link from "next/link";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import {
  getCurrentOrgId, listCommitments, listFailedTranscripts, listOpenEscalations,
} from "@/lib/db/queries";
import { CommitmentList } from "@/components/queue/CommitmentList";
import { NeedsAttention } from "@/components/queue/NeedsAttention";
import { EscalationStrip } from "@/components/queue/EscalationStrip";
import { PageHeader, EmptyState, buttonStyle, pageStyle } from "@/components/ui/primitives";

export default async function QueuePage() {
  const orgId = await getCurrentOrgId("/queue");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Commitment queue" />
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
  const items = commitments.data ?? [];
  const needsReview = items.filter((c) => c.status === "proposed").length;

  return (
    <main style={pageStyle}>
      {/* The count is the one number an owner checks on arrival, so it sits in the header
          rather than floating above the list. */}
      <PageHeader
        title="Commitment queue"
        lede="Every promise the assistant found, waiting on you. It drafts and proposes; nothing reaches a client until you approve it."
        meta={items.length > 0
          ? `${needsReview} awaiting review · ${items.length} total`
          : undefined}
      />

      {/* Escalations first: a complaint outranks the queue it came from. */}
      {escalations.unavailable ? <Unavailable section="Escalations are" /> : <EscalationStrip items={escalations.data ?? []} />}
      {failed.unavailable ? <Unavailable section="Extraction alerts are" /> : <NeedsAttention items={failed.data ?? []} />}
      {commitments.unavailable ? <Unavailable section="Commitments are" /> : <CommitmentList items={items} />}
    </main>
  );
}
