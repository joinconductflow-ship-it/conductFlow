import { z } from "zod";

/**
 * Shared with components/copilot/ApprovalCopilotSidebar.tsx, which registers
 * proposeAction as a pure FRONTEND tool via useHumanInTheLoop. Kept in its
 * own file (no server-only imports) so the client bundle doesn't pull in
 * lib/copilot/tools.ts's Supabase/server-action dependencies.
 */
export const proposeActionParameters = z.object({
  commitmentId: z.string().describe("The commitment this action belongs to."),
  actionId: z.string().describe("The suggested action's id, from listOpenCommitments."),
  actionType: z.enum(["calendar_event", "drive_document", "gmail_draft", "internal_task"]),
  summary: z.string().describe(
    "One plain-English sentence describing exactly what will be created, for the " +
    "human to read before approving — e.g. \"Calendar event 'Makeup session — Priya " +
    "Sharma' on Sep 16 at 3:00 PM for 30 minutes.\"",
  ),
  date: z.string().optional().describe("YYYY-MM-DD, for calendar_event."),
  startTime: z.string().optional().describe("24h HH:MM, for calendar_event."),
  durationMinutes: z.number().optional().describe("For calendar_event."),
  documentTitle: z.string().optional().describe("For drive_document."),
  documentDetails: z.string().optional().describe(
    "What the document should include, for drive_document, if not already known.",
  ),
});
