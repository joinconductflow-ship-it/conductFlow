import { z } from "zod";
import { defineTool } from "@copilotkit/runtime/v2";
import {
  getCurrentOrgId,
  getOrganizationTimeZone,
  listCommitments,
  getActionSuggestionsForCommitment,
} from "@/lib/db/queries";
import { copilotDateContext } from "@/lib/copilot/date-context";
import { logFailure } from "@/lib/observability/log";

/**
 * Backend tools for the ConductFlow approval copilot. Read-only listing only.
 *
 * proposeAction is a pure FRONTEND human-in-the-loop tool (see
 * ApprovalCopilotSidebar.tsx) and there is deliberately no backend execute tool:
 * on Approve the proposal card calls the existing approveDetectedActions server
 * action itself, so the language model never transports (and cannot mutate,
 * omit, or reinterpret) the human-approved payload. approveDetectedActions stays
 * the single execution choke point.
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
    "or invent an id, even if the human already told you which commitment they mean. " +
    "The result includes dateContext: the authoritative server date, weekday, and " +
    "timezone. Resolve every relative date the human uses (today, tomorrow, next " +
    "Tuesday, this Friday, next week) against dateContext, never from memory or a " +
    "guessed year. If there are no commitments, say so plainly and do not propose an " +
    "action.",
  parameters: listOpenCommitmentsParameters,
  execute: async () => {
    try {
      const orgId = await getCurrentOrgId("copilot: listOpenCommitments");
      if (!orgId) return { error: "Not signed in to a workspace." };
      const timeZone = await getOrganizationTimeZone(orgId);
      const dateContext = copilotDateContext(new Date(), timeZone);
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
      return {
        dateContext: {
          nowIso: dateContext.nowIso,
          date: dateContext.date,
          weekday: dateContext.weekday,
          timeZone: dateContext.timeZone,
        },
        commitments: withActions,
      };
    } catch (error) {
      // Always return a tool result. A rejected execute during a transient auth/DB failure
      // is what leaves the model unable to answer and can strand the turn; the caller still
      // gets a valid, user-safe result so the conversation can continue.
      logFailure("copilot.listOpenCommitments", error);
      return { error: "I couldn't load your commitments right now. Please try again." };
    }
  },
});

// proposeAction is intentionally NOT a backend tool. CopilotKit's
// useHumanInTheLoop (see ApprovalCopilotSidebar.tsx) registers it as a pure
// FRONTEND tool: the model calls it, the client pauses via a Promise and
// renders the confirmation card, and respond() resolves that Promise, which
// CopilotKit automatically feeds back to the agent as the tool result and
// continues the run. Declaring it here too (as a backend defineTool) was the
// original bug: it fought with the frontend registration instead of letting
// CopilotKit's own resume mechanism do its job.

export const copilotTools = [
  listOpenCommitmentsTool,
];
