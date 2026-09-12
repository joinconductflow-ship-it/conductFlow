"use client";

import { useState, type CSSProperties } from "react";
import type { z } from "zod";
import { CopilotSidebar, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { ToolCallStatus } from "@copilotkit/core";
import { approveDetectedActions } from "@/app/actions/approvals";
import {
  proposeActionParameters,
  runProposalDecision,
  type ProposalValues,
} from "@/lib/copilot/schemas";

const cardStyle: CSSProperties = {
  border: "1px solid var(--border-strong, #444)",
  borderRadius: 10,
  padding: 14,
  background: "var(--raised, #1c1c1f)",
  color: "var(--text, #eee)",
  display: "grid",
  gap: 8,
  fontSize: 14,
  maxWidth: 360,
};

const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const labelStyle: CSSProperties = { color: "var(--faint, #888)", fontSize: 12 };
const buttonRowStyle: CSSProperties = { display: "flex", gap: 8, marginTop: 4 };

function actionButton(kind: "approve" | "reject"): CSSProperties {
  return {
    flex: 1,
    padding: "8px 12px",
    borderRadius: 8,
    border: kind === "approve" ? "none" : "1px solid var(--border-strong, #444)",
    background: kind === "approve" ? "var(--accent, #6366f1)" : "transparent",
    color: kind === "approve" ? "#fff" : "var(--text, #eee)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  };
}

type ProposalArgs = z.infer<typeof proposeActionParameters>;

/**
 * The "wow" surface: proposeAction is a pure FRONTEND human-in-the-loop tool
 * (see lib/copilot/tools.ts for why it's not a backend tool). The model calls
 * it, this pauses the run via a Promise, and renders the exact proposed action
 * as a real preview card (not a JSON dump). On Approve, the card builds the
 * authoritative payload from UI state and calls the existing
 * approveDetectedActions server action itself — then responds, which is what
 * resumes the run, so the model only ever narrates the already-executed result.
 */
function ProposalCard() {
  useHumanInTheLoop<ProposalArgs>({
    name: "proposeAction",
    description:
      "Proposes creating one Google Calendar event, Drive document, Gmail draft, or " +
      "internal task for a commitment. commitmentId and actionId MUST come from a " +
      "prior listOpenCommitments call in this conversation — call listOpenCommitments " +
      "first if you haven't already, even if the human named the commitment; never " +
      "invent or guess these ids. This pauses so the human can review, edit, and " +
      "approve or reject. Approval executes the action automatically in the UI, before " +
      "this tool returns — there is no execute tool to call. The result you get back " +
      "is {approved: boolean, execution?: {actions, complete}} describing what was " +
      "already created (or the error). Do NOT call any other tool to create the " +
      "action, and never restate or alter the executed values. If approved is false, " +
      "tell the human it was skipped.",
    parameters: proposeActionParameters,
    render: ({ status, args, respond }) => {
      if (status !== ToolCallStatus.Executing || !respond) {
        return <div style={cardStyle}>Proposal resolved.</div>;
      }
      return <ProposalCardBody args={args as ProposalArgs} respond={respond} />;
    },
  });
  return null;
}

const ACTION_TITLE: Record<ProposalArgs["actionType"], string> = {
  calendar_event: "Create Calendar event",
  drive_document: "Create Drive document",
  gmail_draft: "Create Gmail draft",
  internal_task: "Track as internal task",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "5px 7px",
  borderRadius: 6,
  border: "1px solid var(--border-strong, #444)",
  background: "var(--surface, #111)",
  color: "var(--text, #eee)",
  fontSize: 13,
};

function ProposalCardBody({ args, respond }: {
  args: ProposalArgs;
  respond: (result: unknown) => Promise<void>;
}) {
  const [state, setState] = useState<"pending" | "sent">("pending");
  // Ownership is tracked by which fields the human touched, independent of the value, so a
  // cleared field is still reviewer-owned and cannot fall back to a source default. Clearing
  // itself is tracked separately: only an explicitly emptied field is in `cleared`.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
  const [values, setValues] = useState<ProposalValues>(() => ({
    date: args.date ?? "",
    startTime: args.startTime ?? "",
    durationMinutes: args.durationMinutes !== undefined ? String(args.durationMinutes) : "",
    documentTitle: args.documentTitle ?? "",
    documentDetails: args.documentDetails ?? "",
  }));

  function patch(key: keyof ProposalValues, value: string) {
    setTouched((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setCleared((current) => {
      const isEmpty = value === "";
      if (isEmpty && !current.has(key)) return new Set(current).add(key);
      if (!isEmpty && current.has(key)) {
        const next = new Set(current);
        next.delete(key);
        return next;
      }
      return current;
    });
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function decide(approved: boolean) {
    setState("sent");
    // Build and execute the authoritative payload from UI state, then resume the run with the
    // result. The model never carries the approved values or provenance.
    const result = await runProposalDecision(
      approved,
      { commitmentId: args.commitmentId, actionId: args.actionId },
      values,
      [...touched],
      [...cleared],
      async (payload) => {
        try {
          return await approveDetectedActions(
            payload.commitmentId,
            [payload.actionId],
            { [payload.actionId]: payload.inputData },
            payload.reviewerEditedFields.length > 0
              ? { [payload.actionId]: payload.reviewerEditedFields }
              : {},
            payload.clearedFields.length > 0
              ? { [payload.actionId]: payload.clearedFields }
              : {},
          );
        } catch (error) {
          return { error: error instanceof Error ? error.message : "Approval failed." };
        }
      },
    );
    await respond(result);
  }

  return <div style={cardStyle}>
    <div style={rowStyle}>
      <strong>{ACTION_TITLE[args.actionType]}</strong>
      <span style={labelStyle}>{args.actionType}</span>
    </div>
    <p style={{ margin: 0 }}>{args.summary}</p>
    {args.actionType === "calendar_event" && (
      <div style={{ display: "grid", gap: 6 }}>
        <label style={labelStyle}>Date
          <input type="date" value={values.date} onChange={(e) => patch("date", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
        <label style={labelStyle}>Time
          <input type="time" value={values.startTime} onChange={(e) => patch("startTime", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
        <label style={labelStyle}>Duration, min
          <input type="number" min={5} max={1440} step={5} value={values.durationMinutes}
            onChange={(e) => patch("durationMinutes", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
      </div>
    )}
    {args.actionType === "drive_document" && (
      <div style={{ display: "grid", gap: 6 }}>
        <label style={labelStyle}>Title
          <input value={values.documentTitle} onChange={(e) => patch("documentTitle", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
        <label style={labelStyle}>Details
          <textarea value={values.documentDetails} rows={3}
            onChange={(e) => patch("documentDetails", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2, resize: "vertical" }} />
        </label>
      </div>
    )}
    {state === "pending" ? (
      <div style={buttonRowStyle}>
        <button style={actionButton("approve")} onClick={() => decide(true)}>Approve</button>
        <button style={actionButton("reject")} onClick={() => decide(false)}>Reject</button>
      </div>
    ) : (
      <span style={labelStyle}>Sent.</span>
    )}
  </div>;
}

export function ApprovalCopilotSidebar() {
  return <>
    <ProposalCard />
    <CopilotSidebar
      labels={{
        modalHeaderTitle: "Approval copilot",
        welcomeMessageText: "Ask me about anything awaiting review — e.g. \"schedule the makeup session for Priya\".",
      }}
    />
  </>;
}
