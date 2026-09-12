"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveDetectedActions, rejectCommitment } from "@/app/actions/approvals";
import { buttonStyle } from "@/components/ui/primitives";
import type {
  ActionInputData,
  CommitmentActionSuggestion,
  SuggestedActionType,
} from "@/lib/types";

const ACTION_ORDER: SuggestedActionType[] = [
  "gmail_draft", "calendar_event", "drive_document", "internal_task",
];

const ACTION_COPY: Record<SuggestedActionType, { app: string; title: string }> = {
  gmail_draft: { app: "Gmail", title: "Create draft" },
  calendar_event: { app: "Calendar", title: "Create event" },
  drive_document: { app: "Drive", title: "Create Google Doc" },
  internal_task: { app: "Task", title: "Track commitment" },
};

const OPEN_LABEL: Partial<Record<SuggestedActionType, string>> = {
  gmail_draft: "Open Gmail drafts",
  calendar_event: "Open in Google Calendar",
  drive_document: "Open in Google Docs",
};

const fieldStyle: CSSProperties = {
  minHeight: 34,
  padding: "6px 8px",
  color: "var(--text)",
  background: "var(--raised)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-sm)",
};

function ActionIcon({ type }: { type: SuggestedActionType }) {
  const common = { width: 17, height: 17, fill: "none", stroke: "currentColor",
    strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const icons: Record<SuggestedActionType, ReactNode> = {
    gmail_draft: <svg viewBox="0 0 24 24" {...common}><path d="M3.5 6.5 12 13l8.5-6.5"/><path d="M4 6h16v12H4z"/></svg>,
    calendar_event: <svg viewBox="0 0 24 24" {...common}><path d="M6 3v4M18 3v4M4 9h16"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 13h3v3H8z"/></svg>,
    drive_document: <svg viewBox="0 0 24 24" {...common}><path d="m9 3-6 11 3.5 6h11L21 14 15 3z"/><path d="m9 3 6 11M21 14H9l-2.5 6"/></svg>,
    internal_task: <svg viewBox="0 0 24 24" {...common}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9"/></svg>,
  };
  return <span aria-hidden style={{ width: 30, height: 30, display: "grid", placeItems: "center",
    color: "var(--accent-text)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", background: "var(--surface)", flexShrink: 0 }}>{icons[type]}</span>;
}

function statusLabel(action: CommitmentActionSuggestion, data: ActionInputData): string {
  const state = action.execution_state ?? "proposed";
  if (state === "created") return "Created";
  if (state === "executing") return "Executing";
  if (state === "failed") return "Failed";
  if (state === "blocked") return "Blocked";
  if (state === "reconnect_google") return "Reconnect Google";
  if (state === "schedule_conflict" && !data.conflict_confirmed) return "Schedule conflict";
  if (action.action_type === "calendar_event") {
    if (!data.date || !data.start_time || !data.duration_minutes) return "Needs info";
    if (data.relative_date && !data.relative_date_confirmed) return "Needs confirmation";
    if (data.recurrence_rule && !data.recurrence_confirmed) return "Needs confirmation";
  }
  if (action.action_type === "drive_document" && action.missing_data.includes("document_details") && !data.document_details) {
    return "Needs info";
  }
  if (action.missing_data.length > 0 && action.action_type === "gmail_draft") return "Needs info";
  return "Ready";
}

function toneForStatus(status: string): string {
  if (status === "Created" || status === "Ready") return "var(--ok)";
  if (status === "Failed") return "var(--danger-text)";
  if (status === "Executing") return "var(--accent-text)";
  return "var(--warn)";
}

function CalendarFields({ action, value, disabled, onChange }: {
  action: CommitmentActionSuggestion;
  value: ActionInputData;
  disabled: boolean;
  onChange: (patch: ActionInputData) => void;
}) {
  const conflicts = action.preview_data?.conflicts ?? [];
  return <div style={{ gridColumn: "2 / -1", display: "grid", gap: "var(--space-2)",
    paddingTop: "var(--space-2)" }}>
    <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
      {value.event_type ?? "Meeting"} — {value.person ?? "Client"}
    </span>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "var(--space-2)" }} className="detected-action-fields">
      <label className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
        Date
        <input type="date" value={value.date ?? ""} disabled={disabled}
          onChange={(event) => onChange({ date: event.target.value, conflict_confirmed: false })}
          style={{ ...fieldStyle, display: "block", width: "100%", marginTop: 4 }} />
      </label>
      <label className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
        Start time
        <input type="time" value={value.start_time ?? ""} disabled={disabled}
          onChange={(event) => onChange({ start_time: event.target.value, conflict_confirmed: false })}
          style={{ ...fieldStyle, display: "block", width: "100%", marginTop: 4 }} />
      </label>
      <label className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
        Duration, min
        <input type="number" min={5} max={1440} step={5}
          value={value.duration_minutes ?? ""} disabled={disabled}
          onChange={(event) => onChange({
            duration_minutes: event.target.value ? Number(event.target.value) : undefined,
            conflict_confirmed: false,
          })}
          style={{ ...fieldStyle, display: "block", width: "100%", marginTop: 4 }} />
      </label>
    </div>
    {value.time_zone && <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
      Calendar timezone: {value.time_zone}
    </span>}
    {value.relative_date && <label style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>
      <input type="checkbox" checked={value.relative_date_confirmed === true} disabled={disabled}
        onChange={(event) => onChange({ relative_date_confirmed: event.target.checked })} />{" "}
      Confirm interpreted date: {value.date ?? "date needed"}
    </label>}
    {value.recurrence_rule && <label style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>
      <input type="checkbox" checked={value.recurrence_confirmed === true} disabled={disabled}
        onChange={(event) => onChange({ recurrence_confirmed: event.target.checked })} />{" "}
      Confirm recurring series: {value.recurrence_text ?? value.recurrence_rule}
    </label>}
    {conflicts.length > 0 && <div style={{ padding: "var(--space-2)", border: "1px solid var(--warn)",
      borderRadius: "var(--radius-sm)", color: "var(--muted)", fontSize: "var(--text-xs)" }}>
      <strong style={{ color: "var(--text)" }}>Schedule conflict</strong>
      <div style={{ marginTop: 3 }}>{conflicts.map((conflict) =>
        `${conflict.title ?? "Busy"} at ${new Date(conflict.start).toLocaleString()}`).join(" · ")}</div>
      <label style={{ display: "block", marginTop: 6 }}>
        <input type="checkbox" checked={value.conflict_confirmed === true} disabled={disabled}
          onChange={(event) => onChange({ conflict_confirmed: event.target.checked })} />{" "}
        Create it anyway
      </label>
    </div>}
  </div>;
}

function DriveFields({ action, value, disabled, onChange }: {
  action: CommitmentActionSuggestion;
  value: ActionInputData;
  disabled: boolean;
  onChange: (patch: ActionInputData) => void;
}) {
  const needsDetails = action.missing_data.includes("document_details");
  return <div style={{ gridColumn: "2 / -1", display: "grid", gap: "var(--space-2)",
    paddingTop: "var(--space-2)" }}>
    <label className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
      Proposed title
      <input value={value.document_title ?? ""} disabled={disabled}
        onChange={(event) => onChange({ document_title: event.target.value })}
        style={{ ...fieldStyle, display: "block", width: "100%", marginTop: 4 }} />
    </label>
    <p style={{ margin: 0, color: "var(--muted)", fontSize: "var(--text-xs)", lineHeight: 1.45 }}>
      {value.document_summary}
    </p>
    {needsDetails && <label className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
      What should this document include?
      <textarea value={value.document_details ?? ""} disabled={disabled} rows={3}
        onChange={(event) => onChange({ document_details: event.target.value })}
        style={{ ...fieldStyle, display: "block", width: "100%", marginTop: 4, resize: "vertical" }} />
    </label>}
    <span style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
      A populated private Google Doc will be created in My Drive. It will not be shared.
    </span>
  </div>;
}

export function ApprovalBar({ commitmentId, actions }: {
  commitmentId: string;
  actions: CommitmentActionSuggestion[];
}) {
  const router = useRouter();
  const orderedActions = [...actions].sort((a, b) =>
    ACTION_ORDER.indexOf(a.action_type) - ACTION_ORDER.indexOf(b.action_type));
  const [selected, setSelected] = useState(() => new Set(actions
    .filter((action) => action.execution_state !== "created")
    .map((action) => action.id)));
  const [inputs, setInputs] = useState<Record<string, ActionInputData>>(() =>
    Object.fromEntries(actions.map((action) => [action.id, action.input_data ?? {}])));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "partial" | "error"; text: string } | null>(null);
  const [acting, setActing] = useState<"approve" | "discard" | null>(null);
  const selectedCount = selected.size;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateInput(id: string, patch: ActionInputData) {
    setInputs((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function execute(ids: string[]) {
    setMessage(null);
    setActing("approve");
    startTransition(async () => {
      try {
        const result = await approveDetectedActions(commitmentId, ids, inputs);
        if (result.complete) {
          setMessage({ kind: "success", text: "Actions created. Use the links below to open them." });
        } else if (result.actions.some((action) => action.state === "needs_info" || action.state === "schedule_conflict")) {
          setMessage({ kind: "partial", text: "Add or confirm the highlighted information before this batch can run." });
        } else {
          setMessage({ kind: "partial", text: "Some actions did not finish. Successful actions were kept." });
        }
        router.refresh();
      } catch (cause) {
        setMessage({ kind: "error", text: cause instanceof Error
          ? cause.message : "Something went wrong. Please try again." });
      }
    });
  }

  function discard() {
    setMessage(null);
    setActing("discard");
    startTransition(async () => {
      try {
        await rejectCommitment(commitmentId);
        router.push("/queue");
        router.refresh();
      } catch (cause) {
        setMessage({ kind: "error", text: cause instanceof Error
          ? cause.message : "Something went wrong. Please try again." });
      }
    });
  }

  const cta = selectedCount === 0 ? "Select an action"
    : selectedCount === 1 ? "Approve action" : `Approve ${selectedCount} actions`;

  return <section aria-busy={isPending} style={{ position: "relative", overflow: "hidden",
    marginTop: "var(--space-5)", background: "var(--raised)",
    border: "1px solid var(--border-strong)", borderRadius: "var(--radius)",
    padding: "var(--space-4)" }}>
    {isPending && <span aria-hidden style={{ position: "absolute", insetInline: 0, top: 0,
      height: 2, background: "var(--accent)", animation: "cf-pulse 1.4s ease-in-out infinite" }} />}

    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
      gap: "var(--space-3)" }}>
      <h2 style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>Detected actions</h2>
      {actions.length > 0 && <span className="mono" style={{ color: "var(--faint)",
        fontSize: "var(--text-xs)" }}>{selectedCount} selected</span>}
    </div>

    {orderedActions.length === 0 ? <p style={{ marginTop: "var(--space-3)", color: "var(--muted)",
      fontSize: "var(--text-sm)" }}>No high or medium confidence actions were suggested.</p> :
      <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        {orderedActions.map((action) => {
          const copy = ACTION_COPY[action.action_type];
          const isSelected = selected.has(action.id);
          const data = inputs[action.id] ?? {};
          const status = statusLabel(action, data);
          const locked = isPending || status === "Created" || status === "Executing";
          return <div key={action.id} className="detected-action-row"
            style={{ display: "grid", gridTemplateColumns: "30px minmax(0, 1fr) auto",
              alignItems: "center", gap: "var(--space-3)", width: "100%", minHeight: 58,
              padding: "9px 11px", color: "var(--text)",
              background: isSelected ? "var(--accent-quiet)" : "var(--surface)",
              border: `1px solid ${isSelected ? "var(--accent-line)" : "var(--border)"}`,
              borderRadius: "var(--radius-sm)", opacity: isPending ? 0.72 : 1 }}>
            <button type="button" aria-label={`${isSelected ? "Deselect" : "Select"} ${copy.title}`}
              aria-pressed={isSelected} disabled={locked} onClick={() => toggle(action.id)}
              style={{ padding: 0, border: 0, background: "transparent", color: "inherit",
                cursor: locked ? "default" : "pointer" }}><ActionIcon type={action.action_type} /></button>
            <div style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600 }}>
                <span style={{ color: "var(--muted)", fontWeight: 500 }}>{copy.app}</span>
                <span aria-hidden style={{ color: "var(--faint)", margin: "0 6px" }}>·</span>
                {copy.title}
              </span>
              <span style={{ display: "block", marginTop: 2, color: "var(--muted)",
                fontSize: "var(--text-xs)", lineHeight: 1.35 }}>{action.rationale}</span>
              {action.last_error && ["failed", "blocked", "reconnect_google"].includes(action.execution_state ?? "") &&
                <span style={{ display: "block", marginTop: 4, color: "var(--danger-text)",
                  fontSize: "var(--text-xs)" }}>{action.last_error}</span>}
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="mono detected-action-state" style={{ color: toneForStatus(status),
                fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{status}</span>
              {status === "Failed" && <button type="button" disabled={isPending}
                onClick={() => execute([action.id])}
                style={{ display: "block", margin: "4px 0 0 auto", padding: 0, border: 0,
                  background: "transparent", color: "var(--accent-text)", cursor: "pointer",
                  fontSize: "var(--text-xs)", textDecoration: "underline" }}>Retry</button>}
              {status === "Reconnect Google" && <Link href="/settings" style={{ display: "block",
                marginTop: 4, color: "var(--accent-text)", fontSize: "var(--text-xs)" }}>
                Reconnect Google
              </Link>}
              {status === "Created" && action.external_url && OPEN_LABEL[action.action_type] &&
                <a href={action.external_url} target="_blank" rel="noreferrer"
                  style={{ display: "block", marginTop: 4, color: "var(--accent-text)",
                    fontSize: "var(--text-xs)" }}>{OPEN_LABEL[action.action_type]}</a>}
            </div>
            {action.action_type === "calendar_event" &&
              <CalendarFields action={action} value={data} disabled={locked}
                onChange={(patch) => updateInput(action.id, patch)} />}
            {action.action_type === "drive_document" &&
              <DriveFields action={action} value={data} disabled={locked}
                onChange={(patch) => updateInput(action.id, patch)} />}
            {action.action_type === "gmail_draft" && actions.some((item) => item.action_type === "drive_document") &&
              <span style={{ gridColumn: "2 / -1", color: "var(--faint)", fontSize: "var(--text-xs)" }}>
                The created Google Doc link will be added to this draft immediately before creation.
              </span>}
          </div>;
        })}
      </div>}

    <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
      {actions.some((action) => action.execution_state !== "created") &&
        <button disabled={isPending || selectedCount === 0} onClick={() => execute([...selected])}
          style={{ ...buttonStyle("primary", isPending || selectedCount === 0), minWidth: 150 }}>
          {isPending && acting === "approve" ? "Executing…" : cta}
        </button>}
      <button disabled={isPending} onClick={discard}
        style={{ ...buttonStyle("ghost", isPending), minWidth: 92 }}>
        {isPending && acting === "discard" ? "Discarding…" : "Discard"}
      </button>
    </div>

    {message && <p role="alert" style={{ marginTop: "var(--space-3)",
      color: message.kind === "success" ? "var(--ok)" : message.kind === "partial" ? "var(--warn)" : "var(--danger-text)",
      fontSize: "var(--text-sm)" }}>{message.text}</p>}
  </section>;
}
