import Link from "next/link";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { getCurrentOrgId, loadOperationsData } from "@/lib/db/queries";
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

export default async function OperationsPage() {
  const orgId = await getCurrentOrgId("/operations");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Operations map" />
      <EmptyState
        title="Sign in to see how your team works"
        body="After enough conversations, this describes what your business actually promises, who owes it, and whether it lands."
        action={<Link href="/onboarding" className="cf-btn" style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const result = await readPageData("/operations: operations data", () => loadOperationsData(orgId));
  const data = result.data;
  if (!data || data.unavailable.commitments || data.unavailable.tasks) return <main style={pageStyle}>
    <PageHeader title="Operations map" />
    <Unavailable section="Operations metrics are" />
  </main>;
  const map = buildOperationsMap(data, new Date());

  if (map.totalCommitments === 0) return (
    <main style={pageStyle}>
      <PageHeader title="Operations map" />
      <EmptyState
        title="Nothing observed yet"
        body="This map is built from the promises in your conversations. Add the first transcript and it starts learning how your team works."
        action={<Link href="/ingest" className="cf-btn" style={buttonStyle("primary")}>Add a transcript</Link>}
      />
    </main>);

  const learning = !map.sufficientData;
  /*
   * The decision on the not-yet-meaningful state: when the map is still learning, no number
   * on this page wears a severity colour. A red "38% delivered late" drawn from eight tasks
   * is worse than showing nothing — it looks like a finding, and an owner acts on it. So
   * severity is suppressed until the sample supports it, and every section says "provisional"
   * rather than one grey box at the top disclaiming numbers that still look authoritative.
   */
  const provisional = learning ? <Badge tone="warn">provisional</Badge> : undefined;
  const tone = <T extends "ok" | "warn" | "danger">(t: T, live: boolean) =>
    (learning || !live ? "neutral" as const : t);

  const maxTypeCount = Math.max(1, ...map.types.map((t) => t.count));
  const maxOwnerCount = Math.max(1, map.unowned.count, ...map.owners.map((o) => o.count));
  const maxClientLoad = Math.max(1, ...map.clients.map((c) => c.openCommitments));

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Operations map"
        lede={`What your conversations actually promise, drawn from ${map.totalCommitments} commitment${map.totalCommitments === 1 ? "" : "s"}${map.observed ? ` over ${map.observed.days} day${map.observed.days === 1 ? "" : "s"}` : ""}.`}
      />

      {data.unavailable.clients && <Unavailable section="Client names are" />}
      {learning && (
        <Card tone="accent" style={{ marginBottom: "var(--space-5)" }}>
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

      <div style={statGridStyle}>
        <StatTile
          label="Promises tracked"
          value={String(map.totalCommitments)}
          hint={map.observed ? `Over ${map.observed.days} days.` : undefined}
        />
        <StatTile
          label="Delivered"
          value={`${map.delivery.completionRatePct}%`}
          hint={`${map.delivery.completed} of ${map.delivery.totalTasks} task${map.delivery.totalTasks === 1 ? "" : "s"}.`}
        />
        <StatTile
          label="Late when delivered"
          value={map.delivery.late.sampleSize === 0 ? "—" : `${map.delivery.late.sharePct}%`}
          tone={tone("danger", map.delivery.late.sharePct > 25)}
          status={!learning && map.delivery.late.sharePct > 25 ? "slipping" : undefined}
          hint={map.delivery.late.sampleSize === 0
            ? "No completed task carried both a due date and a completion time."
            : `${map.delivery.late.late} of ${map.delivery.late.sampleSize} dated completion${map.delivery.late.sampleSize === 1 ? "" : "s"}.`}
        />
        <StatTile
          label="No owner named"
          value={`${map.unowned.sharePct}%`}
          tone={tone("warn", map.unowned.sharePct > 25)}
          status={!learning && map.unowned.sharePct > 25 ? "gets missed by default" : undefined}
          hint={`${map.unowned.count} of ${map.totalCommitments} commitment${map.totalCommitments === 1 ? "" : "s"}.`}
        />
      </div>

      {map.weeks.length > 0 && (
        <section style={{ marginTop: "var(--space-7)" }}>
          <SectionHeading note={provisional}>Volume per week</SectionHeading>
          <Card>
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
        <Card>
          {map.types.map((t) => (
            <MeasureRow
              key={t.type}
              label={t.type}
              count={t.count}
              max={maxTypeCount}
              value={`${t.count} · ${t.sharePct}% · ${leadTimeText(t.leadTime)}`}
            />
          ))}
          {/* Shares round independently and will not always total 100, so they are never
              drawn as one bar claiming a whole. */}
          <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-3)" }}>
            Share of all {map.totalCommitments} commitments. Lead time is measured from the
            conversation to the promised date.
          </p>
        </Card>
      </section>

      <section style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading note={provisional}>Who owes the work</SectionHeading>
        <Card>
          {map.owners.map((o) => (
            <MeasureRow key={o.owner} label={o.owner} count={o.count} max={maxOwnerCount}
              value={`${o.count} · ${o.sharePct}%`} />
          ))}
          {/* Kept out of the owner list on purpose: an unowned promise is a gap, not a person. */}
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
        <Card>
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
          <Card>
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
          extraction error, left out of every timing on this page.
        </p>
      )}
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
