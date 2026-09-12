"use client";

import { useState, type CSSProperties } from "react";
import { CopilotSidebar, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { ToolCallStatus } from "@copilotkit/core";

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

/**
 * The "wow" surface: proposeAction pauses the agent run (see lib/copilot/tools.ts).
 * This renders the exact proposed action as a real preview card, not a JSON dump,
 * and only calls executeApprovedAction — the bridge into the existing
 * approveDetectedActions server action — once a human clicks Approve.
 */
function ProposalCard() {
  useHumanInTheLoop({
    name: "proposeAction",
    description: "Confirm before creating a Calendar event, Drive doc, Gmail draft, or task.",
    render: ({ status, args, respond }) => {
      if (status !== ToolCallStatus.Executing || !respond) {
        return <div style={cardStyle}>Proposal resolved.</div>;
      }
      return <ProposalCardBody args={args as unknown as ProposalArgs} respond={respond} />;
    },
  });
  return null;
}

interface ProposalArgs {
  commitmentId: string;
  actionId: string;
  actionType: "calendar_event" | "drive_document" | "gmail_draft" | "internal_task";
  summary: string;
  date?: string;
  startTime?: string;
  durationMinutes?: number;
  documentTitle?: string;
  documentDetails?: string;
}

const ACTION_TITLE: Record<ProposalArgs["actionType"], string> = {
  calendar_event: "Create Calendar event",
  drive_document: "Create Drive document",
  gmail_draft: "Create Gmail draft",
  internal_task: "Track as internal task",
};

function ProposalCardBody({ args, respond }: {
  args: ProposalArgs;
  respond: (result: unknown) => Promise<void>;
}) {
  const [state, setState] = useState<"pending" | "sent">("pending");

  async function decide(approved: boolean) {
    setState("sent");
    await respond({ approved });
  }

  return <div style={cardStyle}>
    <div style={rowStyle}>
      <strong>{ACTION_TITLE[args.actionType]}</strong>
      <span style={labelStyle}>{args.actionType}</span>
    </div>
    <p style={{ margin: 0 }}>{args.summary}</p>
    {args.actionType === "calendar_event" && (args.date || args.startTime) && (
      <div style={{ display: "grid", gap: 2 }}>
        {args.date && <span style={labelStyle}>Date: <span style={{ color: "var(--text, #eee)" }}>{args.date}</span></span>}
        {args.startTime && <span style={labelStyle}>Time: <span style={{ color: "var(--text, #eee)" }}>{args.startTime}</span></span>}
        {args.durationMinutes && <span style={labelStyle}>Duration: <span style={{ color: "var(--text, #eee)" }}>{args.durationMinutes} min</span></span>}
      </div>
    )}
    {args.actionType === "drive_document" && args.documentTitle && (
      <span style={labelStyle}>Title: <span style={{ color: "var(--text, #eee)" }}>{args.documentTitle}</span></span>
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
