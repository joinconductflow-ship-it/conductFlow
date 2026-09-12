import Link from "next/link";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { getCurrentOrgId, listCommitments, loadOperationsData } from "@/lib/db/queries";
import { computeMetrics } from "@/lib/metrics";
import {
  buildOperationsMap, OPERATIONS_MAP_MIN_COMMITMENTS, type LeadTime,
} from "@/lib/ops/map";
import { StatTile } from "@/components/ui/StatTile";
import { WeeklyVolume } from "@/components/ops/WeeklyVolume";
import { MeasureRow, Meter } from "@/components/ops/Measures";
import {
  PageHeader, Card, CardTitle, Badge, EmptyState, SectionHeading, buttonStyle, pageStyle,
  proseStyle, statGridStyle,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** Always with its sample size: a median of three deadlines is not a practice. */
function leadTimeText(lead: LeadTime | null): string {
  if (!lead) return "no dates given";
  const range = lead.minDays === lead.maxDays
    ? `${lead.minDays}d`
    : `${lead.minDays}–${lead.maxDays}d`;
  return `median ${lead.medianDays}d · range ${range} · n=${lead.sampleSize}`;
}

export default async function ROIPage() {
  const orgId = await getCurrentOrgId("/roi");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="ROI" />
      <EmptyState
        title="Sign in to see your ROI"
        body="One screen for the question that matters: is your team keeping what it said it would, and what does that actually look like week to week?"
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const [commitmentsResult, opsResult] = await Promise.all([
    readPageData("/roi: commitment metrics", () => listCommitments(orgId)),
    readPageData("/roi: operations data", () => loadOperationsData(orgId)),
  ]);
  if (commitmentsResult.unavailable) return <main style={pageStyle}>
    <PageHeader title="ROI" />
    <Unavailable section="ROI metrics are" />
  </main>;
  const m = computeMetrics(commitmentsResult.data ?? []);

  if (m.total === 0) return (
    <main style={pageStyle}>
      <PageHeader title="ROI" />
      <EmptyState
        title="Nothing to measure yet"
        body="Add one client conversation and this becomes a live read on what your team promised, whether it landed, and how your team actually works."
        action={<Link href="/ingest" className="cf-btn"
          style={buttonStyle("primary")}>Add a transcript</Link>}
      />
    </main>);

  const clear = m.overdue === 0;
  const missingPct = 100 - m.withOwnerAndDeadlinePct;

  const opsData = opsResult.data;
  const opsUnavailable = !opsData || opsData.unavailable.commitments || opsData.unavailable.tasks;
  const map = opsData ? buildOperationsMap(opsData, new Date()) : null;
  const learning = !!map && !map.sufficientData;
  const provisional = learning ? <Badge tone="warn">provisional</Badge> : undefined;
  const tone = <T extends "ok" | "warn" | "danger">(t: T, live: boolean) =>
    (learning || !live ? "neutral" as const : t);
  const maxTypeCount = map ? Math.max(1, ...map.types.map((t) => t.count)) : 1;
  const maxOwnerCount = map
    ? Math.max(1, map.unowned.count, ...map.owners.map((o) => o.count)) : 1;
  const maxClientLoad = map ? Math.max(1, ...map.clients.map((c) => c.openCommitments)) : 1;

  return (
    <main style={pageStyle}>
      <PageHeader
        title="ROI"
        lede="What ConductFlow is actually worth to your business: promises kept, promises at risk, and how your team works underneath both."
        actions={<Link href="/tasks" className="cf-btn"
          style={buttonStyle("secondary")}>Task board</Link>}
      />

      {/* One hero figure: the number that means somebody is being let down today. */}
      <div style={statGridStyle}>
        <StatTile
          hero
          index={0}
          label="Past their date"
          value={String(m.overdue)}
          tone={clear ? "ok" : "danger"}
          status={clear ? "nothing is late" : "needs attention today"}
          hint={clear
            ? "Every promise with a date is still inside it."
            : `${m.overdue === 1 ? "This promise is" : "These promises are"} past the date they were given, and not yet delivered.`}
        />
        <StatTile
          index={1}
          label="Owned and dated"
          value={`${m.withOwnerAndDeadlinePct}%`}
          tone={m.withOwnerAndDeadlinePct < 60 ? "warn" : "neutral"}
          status={m.withOwnerAndDeadlinePct < 60 ? "thin coverage" : undefined}
          hint="Have both a named owner and a date."
        />
        <StatTile
          index={2}
          label="Reviewed"
          value={`${m.approvedPct}%`}
          hint="Approved by a human and turned into work."
        />
        <StatTile
          index={3}
          label="Tracked"
          value={String(m.total)}
          hint={`Commitment${m.total === 1 ? "" : "s"} extracted so far — promises that a spreadsheet or a memory would have had to catch instead.`}
        />
      </div>

      <section style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading>Where promises go missing</SectionHeading>
        <Card interactive>
          <Meter
            pct={m.withOwnerAndDeadlinePct}
            tone={m.withOwnerAndDeadlinePct < 60 ? "warn" : "accent"}
            filledLabel={`${m.withOwnerAndDeadlinePct}% owned and dated`}
            emptyLabel={`${missingPct}% missing an owner or a date`}
          />
          <p style={{ ...proseStyle, color: "var(--muted)", marginTop: "var(--space-4)" }}>
            {missingPct === 0
              ? "Every commitment names who owes it and when. That is the state where nothing slips by accident."
              : `A promise with nobody's name on it, or no date, is the kind that gets missed without anyone deciding to miss it. ${missingPct}% of what has been extracted is in that state.`}
          </p>
          {missingPct > 0 && (
            <Link href="/queue" className="cf-btn" style={{ ...buttonStyle("secondary"),
              marginTop: "var(--space-4)" }}>
              Review the queue
            </Link>
          )}
        </Card>
      </section>

      {opsUnavailable ? (
        <div style={{ marginTop: "var(--space-7)" }}>
          <Unavailable section="How your team works is" />
        </div>
      ) : map && (
        <>
          {opsData?.unavailable.clients && <Unavailable section="Client names are" />}
          {learning && (
            <Card tone="accent" interactive style={{ marginTop: "var(--space-7)" }}>
              <CardTitle tone="accent" dot>Still learning how you work</CardTitle>
              <p style={{ ...proseStyle, color: "var(--muted)",
                margin: "var(--space-2) 0 var(--space-4)" }}>
                Everything below is drawn from {map.totalCommitments} commitment
                {map.totalCommitments === 1 ? "" : "s"}. At {OPERATIONS_MAP_MIN_COMMITMENTS} these
                figures start describing a way of working rather than a handful of conversations —
                until then one unusual week moves every number, so read them as a sketch and not
                as findings.
              </p>
              <Meter
                pct={(map.totalCommitments / OPERATIONS_MAP_MIN_COMMITMENTS) * 100}
                tone="accent"
                filledLabel={`${map.totalCommitments} observed`}
                emptyLabel={`${OPERATIONS_MAP_MIN_COMMITMENTS - map.totalCommitments} more to go`}
              />
            </Card>
          )}

          <section style={{ marginTop: "var(--space-7)" }}>
            <SectionHeading>How your team works</SectionHeading>
            <div style={statGridStyle}>
              <StatTile
                index={0}
                label="Promises tracked"
                value={String(map.totalCommitments)}
                hint={map.observed ? `Over ${map.observed.days} days.` : undefined}
              />
              <StatTile
                index={1}
                label="Delivered"
                value={`${map.delivery.completionRatePct}%`}
                hint={`${map.delivery.completed} of ${map.delivery.totalTasks} task${map.delivery.totalTasks === 1 ? "" : "s"}.`}
              />
              <StatTile
                index={2}
                label="Late when delivered"
                value={map.delivery.late.sampleSize === 0 ? "—" : `${map.delivery.late.sharePct}%`}
                tone={tone("danger", map.delivery.late.sharePct > 25)}
                status={!learning && map.delivery.late.sharePct > 25 ? "slipping" : undefined}
                hint={map.delivery.late.sampleSize === 0
                  ? "No completed task carried both a due date and a completion time."
                  : `${map.delivery.late.late} of ${map.delivery.late.sampleSize} dated completion${map.delivery.late.sampleSize === 1 ? "" : "s"}.`}
              />
              <StatTile
                index={3}
                label="No owner named"
                value={`${map.unowned.sharePct}%`}
                tone={tone("warn", map.unowned.sharePct > 25)}
                status={!learning && map.unowned.sharePct > 25 ? "gets missed by default" : undefined}
                hint={`${map.unowned.count} of ${map.totalCommitments} commitment${map.totalCommitments === 1 ? "" : "s"}.`}
              />
            </div>
          </section>

          {map.weeks.length > 0 && (
            <section style={{ marginTop: "var(--space-7)" }}>
              <SectionHeading note={provisional}>Volume per week</SectionHeading>
              <Card interactive>
                <WeeklyVolume
                  weeks={map.weeks}
                  median={map.medianCommitmentsPerWeek}
                  truncated={map.weeksTruncated}
                />
              </Card>
            </section>
          )}

          <section style={{ marginTop: "var(--space-7)" }}>
            <SectionHeading note={provisional}>What we promise</SectionHeading>
            <Card interactive>
              {map.types.map((t) => (
                <MeasureRow
                  key={t.type}
                  label={t.type}
                  count={t.count}
                  max={maxTypeCount}
                  value={`${t.count} · ${t.sharePct}% · ${leadTimeText(t.leadTime)}`}
                />
              ))}
              <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
                marginTop: "var(--space-3)" }}>
                Share of all {map.totalCommitments} commitments. Lead time is measured from the
                conversation to the promised date.
              </p>
            </Card>
          </section>

          <section style={{ marginTop: "var(--space-7)" }}>
            <SectionHeading note={provisional}>Who owes the work</SectionHeading>
            <Card interactive>
              {map.owners.map((o) => (
                <MeasureRow key={o.owner} label={o.owner} count={o.count} max={maxOwnerCount}
                  value={`${o.count} · ${o.sharePct}%`} />
              ))}
              <MeasureRow
                tone="warn"
                label={<span style={{ color: map.unowned.count > 0 ? "var(--warn)" : "var(--muted)" }}>
                  Nobody named
                </span>}
                count={map.unowned.count}
                max={maxOwnerCount}
                value={`${map.unowned.count} · ${map.unowned.sharePct}%`}
              />
            </Card>
          </section>

          <section style={{ marginTop: "var(--space-7)" }}>
            <SectionHeading note={provisional}>Delivery</SectionHeading>
            <Card interactive>
              <dl style={{ margin: 0, display: "grid", gap: "var(--space-3)" }}>
                <Fact
                  term="Completed"
                  detail={`${map.delivery.completed} of ${map.delivery.totalTasks} task${map.delivery.totalTasks === 1 ? "" : "s"} (${map.delivery.completionRatePct}%)`}
                />
                <Fact
                  term="Typical time to deliver"
                  detail={map.delivery.timeToDeliver
                    ? leadTimeText(map.delivery.timeToDeliver)
                    : "not enough completed work to time"}
                />
                <Fact
                  term="Late when delivered"
                  detail={map.delivery.late.sampleSize === 0
                    ? "no completed task carried both a due date and a completion time"
                    : `${map.delivery.late.late} of ${map.delivery.late.sampleSize} dated completions (${map.delivery.late.sharePct}%)`}
                />
              </dl>
              {map.delivery.completedWithoutTimestamp > 0 && (
                <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
                  marginTop: "var(--space-4)" }}>
                  {map.delivery.completedWithoutTimestamp} delivered task
                  {map.delivery.completedWithoutTimestamp === 1 ? "" : "s"} could not be timed and
                  {map.delivery.completedWithoutTimestamp === 1 ? " is" : " are"} left out of the
                  durations above.
                </p>
              )}
            </Card>
          </section>

          {map.clients.length > 0 && (
            <section style={{ marginTop: "var(--space-7)" }}>
              <SectionHeading note={provisional}>Who is waiting on us</SectionHeading>
              <Card interactive>
                {map.clients.map((c) => (
                  <MeasureRow key={c.clientId} label={c.clientName} count={c.openCommitments}
                    max={maxClientLoad}
                    value={`${c.openCommitments} open`} />
                ))}
              </Card>
            </section>
          )}

          {map.excludedDeadlines > 0 && (
            <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
              marginTop: "var(--space-5)" }}>
              {map.excludedDeadlines} deadline{map.excludedDeadlines === 1 ? "" : "s"} fell before
              the conversation that produced {map.excludedDeadlines === 1 ? "it" : "them"} — an
              extraction error, left out of every timing above.
            </p>
          )}
        </>
      )}

      <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
        marginTop: "var(--space-6)", ...proseStyle }}>
        Counts are live, not a snapshot — they move as commitments are approved and delivered.
      </p>
    </main>
  );
}

/** Term and value on one line, value in mono so figures line up down the list. */
function Fact({ term, detail }: { term: string; detail: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between",
      gap: "var(--space-4)", flexWrap: "wrap" }}>
      <dt style={{ color: "var(--text)" }}>{term}</dt>
      <dd className="mono" style={{ margin: 0, color: "var(--muted)",
        fontSize: "var(--text-sm)" }}>
        {detail}
      </dd>
    </div>
  );
}
