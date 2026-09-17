"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, buttonStyle } from "@/components/ui/primitives";
import type { TaskIntelligence, TaskIntelligenceSubjectType } from "@/lib/types";

type PanelState = "idle" | "loading" | "ready" | "failed" | "unavailable";

interface Props {
  subjectType: TaskIntelligenceSubjectType;
  subjectId: string;
  initial: TaskIntelligence | null;
}

function stateFor(initial: TaskIntelligence | null): PanelState {
  if (initial?.state === "ready") return "ready";
  if (initial?.state === "failed") return "failed";
  return "idle";
}

type GeneratedValue = { text: string; basis: string; evidence_refs: string[] };

function Field({ label, value }: { label: string; value: GeneratedValue }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <strong style={{ fontSize: "var(--text-sm)", color: "var(--text)" }}>{label}</strong>
      <p style={{ margin: 0, lineHeight: 1.5, color: "var(--text)" }}>{value.text}</p>
    </div>
  );
}

function InferredField({ label, value }: { label: string; value: GeneratedValue }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "var(--text-sm)", color: "var(--text)" }}>{label}</strong>
        <span className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)" }}>INFERRED</span>
      </div>
      <p style={{ margin: 0, lineHeight: 1.5, color: "var(--text)" }}>{value.text}</p>
      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>{value.basis}</p>
      <p className="mono" style={{ margin: 0, color: "var(--faint)", fontSize: "var(--text-xs)" }}>
        Evidence: {value.evidence_refs.join(", ")}
      </p>
    </div>
  );
}

function sourceFactsFor(record: TaskIntelligence): Array<{ key: string; value: string; evidence_refs: string[] }> {
  return record.source_facts.flatMap((fact) => {
    if (!fact || typeof fact !== "object") return [];
    const candidate = fact as { key?: unknown; value?: unknown; evidence_refs?: unknown };
    if (typeof candidate.key !== "string" || typeof candidate.value !== "string"
      || !Array.isArray(candidate.evidence_refs)
      || !candidate.evidence_refs.every((ref): ref is string => typeof ref === "string")) return [];
    return [{ key: candidate.key, value: candidate.value, evidence_refs: candidate.evidence_refs }];
  });
}

function ReasoningAndSources({ record }: { record: TaskIntelligence }) {
  const sourceFacts = sourceFactsFor(record);
  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {record.why_it_matters && <InferredField label="Why it matters" value={record.why_it_matters} />}
      {record.useful_existing_action && (
        <div style={{ display: "grid", gap: 4 }}>
          <InferredField label="Useful existing action" value={record.useful_existing_action} />
          <Link href="#actions" style={{ color: "var(--accent-text)", fontSize: "var(--text-sm)" }}>
            Review available actions
          </Link>
        </div>
      )}
      {record.attention_reason && (
        <InferredField label="Attention" value={record.attention_reason} />
      )}
      {record.source && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)", display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "var(--text-sm)" }}>Source evidence</strong>
            <span className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>FROM SOURCE</span>
          </div>
          {record.source.verified && record.source.source_quote ? (
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
              “{record.source.source_quote}”
            </p>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              Source evidence could not be resolved unambiguously; review the original transcript.
            </p>
          )}
          <p className="mono" style={{ margin: 0, color: "var(--faint)", fontSize: "var(--text-xs)" }}>
            transcript:{record.source.transcript_id} · source_span:{record.source.commitment_id}
            {record.source.start !== null && record.source.end !== null
              ? ` · offsets ${record.source.start}–${record.source.end}` : ""}
          </p>
        </div>
      )}
      {sourceFacts.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)", display: "grid", gap: "var(--space-2)" }}>
          <strong style={{ fontSize: "var(--text-sm)" }}>Source facts</strong>
          {sourceFacts.map((fact) => (
            <div key={fact.key} style={{ display: "grid", gap: 2 }}>
              <span style={{ color: "var(--text)", fontSize: "var(--text-sm)" }}>{fact.key}: {fact.value}</span>
              <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
                Evidence: {fact.evidence_refs.join(", ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskIntelligencePanel({ subjectType, subjectId, initial }: Props) {
  const [record, setRecord] = useState<TaskIntelligence | null>(initial);
  const [state, setState] = useState<PanelState>(stateFor(initial));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const started = useRef(false);

  const start = useCallback(async (retry = false) => {
    const hadReadyRecord = record?.state === "ready";
    if (!hadReadyRecord) setState("loading");
    const startedAt = Date.now();
    try {
      const enqueueResponse = await fetch("/api/task-intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId, retry }),
      });
      const enqueue = await enqueueResponse.json() as {
        state?: string;
        record?: TaskIntelligence | null;
        unavailable?: boolean;
      };
      if (enqueue.unavailable) {
        setState("unavailable");
        return;
      }
      if (!enqueueResponse.ok) throw new Error("enqueue failed");
      if (enqueue.record) setRecord(enqueue.record);
      if (enqueue.state === "ready" && enqueue.record) {
        setState("ready");
        return;
      }
      if (enqueue.state === "failed") {
        setState("failed");
        return;
      }
      setState("loading");

      while (Date.now() - startedAt < 15_000) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_500));
        const statusResponse = await fetch(
          `/api/task-intelligence?subjectType=${encodeURIComponent(subjectType)}&subjectId=${encodeURIComponent(subjectId)}`,
          { cache: "no-store" },
        );
        const status = await statusResponse.json() as {
          state?: string;
          record?: TaskIntelligence | null;
          unavailable?: boolean;
        };
        if (status.unavailable) {
          setState("unavailable");
          return;
        }
        if (status.record) setRecord(status.record);
        if (status.state === "ready") {
          setState("ready");
          return;
        }
        if (status.state === "failed") {
          setState("failed");
          return;
        }
      }
      setState("failed");
    } catch {
      setState("failed");
    }
  }, [record?.state, subjectId, subjectType]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const hasInsight = Boolean(record?.context || record?.recommendation || record?.why_it_matters
    || record?.useful_existing_action || record?.attention_reason || record?.source);
  const hasDetails = Boolean(record && (
    record.why_it_matters || record.useful_existing_action || record.attention_reason
      || record.source || record.source_facts.length > 0
  ));
  const detailsId = `task-intelligence-details-${subjectType}-${subjectId}`;
  return (
    <div id="task-intelligence">
    <Card style={{ minHeight: 168, marginTop: 0,
      background: "var(--accent-quiet)",
      border: "1px solid var(--accent-line)",
      borderLeft: "3px solid var(--accent)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-md)", letterSpacing: "-0.02em" }}>Commitment insight</h2>
      </div>

      {state === "loading" || state === "idle" ? (
        <div aria-live="polite" style={{ margin: "var(--space-3) 0 0", color: "var(--muted)",
          display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span>Preparing context…</span>
          <span aria-hidden style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            {[0, 1, 2].map((index) => (
              <span key={index} style={{ width: 4, height: 4, borderRadius: 999,
                background: "var(--accent)", animation: "cf-pulse 1.2s ease-in-out infinite",
                animationDelay: `${index * 140}ms` }} />
            ))}
          </span>
        </div>
      ) : state === "unavailable" ? (
        <p aria-live="polite" style={{ margin: "var(--space-3) 0 0", color: "var(--muted)" }}>
          Context is not available yet. The commitment itself is unchanged.
        </p>
      ) : state === "failed" || !record ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <p aria-live="polite" style={{ margin: 0, color: "var(--muted)" }}>
            Context could not be prepared.
          </p>
          <button type="button" className="cf-btn" style={{ ...buttonStyle("secondary"), marginTop: "var(--space-3)" }} onClick={() => void start(true)}>
            Retry
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
          {!hasInsight && (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              No grounded context is available for this commitment yet.
            </p>
          )}
          {record.context && (
            <div style={{ display: "grid", gap: "var(--space-1)" }}>
              <span className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)", letterSpacing: "0.08em" }}>
                FROM SOURCE
              </span>
              <Field label="Context" value={record.context} />
            </div>
          )}
          {record.recommendation && (
            <div style={{ display: "grid", gap: "var(--space-1)" }}>
              <span className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)", letterSpacing: "0.08em" }}>
                SUGGESTED
              </span>
              <Field label="Suggested next step" value={record.recommendation} />
            </div>
          )}
          {hasDetails && (
            <>
              <button
                type="button"
                className="cf-btn"
                style={{ ...buttonStyle("secondary"), justifySelf: "start", fontSize: "var(--text-sm)" }}
                aria-expanded={detailsOpen}
                aria-controls={detailsId}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? "Hide reasoning & sources" : "View reasoning & sources"}
              </button>
              {detailsOpen && (
                <div id={detailsId} role="region" aria-label="Reasoning and sources">
                  <ReasoningAndSources record={record} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
    </div>
  );
}
