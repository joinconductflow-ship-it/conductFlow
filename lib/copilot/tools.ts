import { z } from "zod";
import { defineTool } from "@copilotkit/runtime/v2";
import {
  getCurrentOrgId,
  listCommitments,
  getActionSuggestionsForCommitment,
} from "@/lib/db/queries";

/**
 * Backend tools for the ConductFlow approval copilot. Read-only listing plus a
 * proposal step that PAUSES the run (interrupt: true) so the human confirms in
 * the chat UI before anything real happens — the actual Google API call still
 * only ever runs through the existing approveDetectedActions server action.
 */

const listOpenCommitmentsParameters = z.object({});

export const listOpenCommitmentsTool = defineTool({
  name: "listOpenCommitments",
  description:
    "Lists commitments awaiting review for the signed-in user's organization, " +
    "including each commitment's suggested actions (calendar_event, drive_document, " +
    "gmail_draft, internal_task) and what input each action still needs before it " +
    "can be approved. Read-only — creates or changes nothing. You MUST call this " +
    "before proposeAction to get the real commitmentId and actionId — never guess " +
    "or invent an id, even if the human already told you which commitment they mean.",
  parameters: listOpenCommitmentsParameters,
  execute: async () => {
    const orgId = await getCurrentOrgId("copilot: listOpenCommitments");
    if (!orgId) return { error: "Not signed in to a workspace." };
    const commitments = (await listCommitments(orgId))
      .filter((c) => c.status === "proposed");
    const withActions = await Promise.all(commitments.map(async (commitment) => {
      const actions = await getActionSuggestionsForCommitment(commitment.id);
      return {
        commitmentId: commitment.id,
        text: commitment.text,
        owner: commitment.owner,
        deadline: commitment.deadline,
        actions: actions.map((action) => ({
          actionId: action.id,
          type: action.action_type,
          state: action.execution_state ?? "proposed",
          missingData: action.missing_data,
          inputData: action.input_data ?? {},
        })),
      };
    }));
    return { commitments: withActions };
  },
});

// proposeAction is intentionally NOT a backend tool. CopilotKit's
// useHumanInTheLoop (see ApprovalCopilotSidebar.tsx) registers it as a pure
// FRONTEND tool: the model calls it, the client pauses via a Promise and
// renders the confirmation card, and respond() resolves that Promise, which
// CopilotKit automatically feeds back to the agent as the tool result and
// continues the run — no separate backend "interrupt" or resume call needed.
// Declaring it here too (as a backend defineTool) was the original bug: it
// fought with the frontend registration instead of letting CopilotKit's own
// resume mechanism do its job.

const executeApprovedActionParameters = z.object({
  commitmentId: z.string(),
  actionId: z.string(),
  approved: z.boolean().describe("Must be true — only call this after human approval."),
  date: z.string().optional(),
  startTime: z.string().optional(),
  durationMinutes: z.number().optional(),
  documentTitle: z.string().optional(),
  documentDetails: z.string().optional(),
  relativeDateConfirmed: z.boolean().optional(),
  conflictConfirmed: z.boolean().optional(),
});

/**
 * Calls the existing, already-battle-tested approveDetectedActions server
 * action. No Google/Supabase logic lives here — this is a thin bridge so the
 * agent's tool call ends up going through the exact same code path as the
 * manual queue UI.
 */
export const executeApprovedActionTool = defineTool({
  name: "executeApprovedAction",
  description:
    "Creates the previously proposed action for real (Calendar event, Drive doc, " +
    "Gmail draft, or task) after the human has approved it. Only call this with " +
    "approved: true, immediately after the human confirms a proposeAction call.",
  parameters: executeApprovedActionParameters,
  execute: async (args) => {
    if (!args.approved) return { error: "Not approved — nothing was created." };
    const { approveDetectedActions } = await import("@/app/actions/approvals");
    const inputData: Record<string, unknown> = {};
    if (args.date) inputData.date = args.date;
    if (args.startTime) inputData.start_time = args.startTime;
    if (args.durationMinutes) inputData.duration_minutes = args.durationMinutes;
    if (args.documentTitle) inputData.document_title = args.documentTitle;
    if (args.documentDetails) inputData.document_details = args.documentDetails;
    if (args.relativeDateConfirmed) inputData.relative_date_confirmed = true;
    if (args.conflictConfirmed) inputData.conflict_confirmed = true;
    try {
      const result = await approveDetectedActions(
        args.commitmentId,
        [args.actionId],
        { [args.actionId]: inputData },
      );
      return result;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Approval failed." };
    }
  },
});

export const copilotTools = [
  listOpenCommitmentsTool,
  executeApprovedActionTool,
];
