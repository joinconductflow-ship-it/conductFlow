import { z } from "zod";

// gpt-oss-120b is a free model on the Gateway, but its free tier is rate-limited hard
// enough to fail on two extractions back to back. A card is now on file, so paid models
// draw against Vercel's included AI Gateway credit instead — gpt-4o-mini costs fractions
// of a cent per extraction and isn't subject to the free-tier throughput cap.
export const EXTRACTION_MODEL = "openai/gpt-4o-mini";
export const MAX_TRANSCRIPT_CHARS = 250_000;
export const MAX_COMMITMENTS = 50;
export const MAX_SCOPE_SUMMARY_CHARS = 20_000;
export const MAX_SCOPE_REQUEST_CHARS = 10_000;
export const MAX_SCOPE_REASON_CHARS = 500;

export const scopeCheckSchema = z.object({
  covered: z.boolean().describe("Whether the entire request is covered by the agreed scope."),
  reason: z.string().min(1).max(MAX_SCOPE_REASON_CHARS).refine((s) => s.trim().length > 0, {
    message: "Scope reason must not be blank.",
  }).describe("A brief explanation grounded in the scope, identifying any unsupported work."),
});

export type ScopeCheck = z.infer<typeof scopeCheckSchema>;

export const commitmentSchema = z.object({
  text: z.string().min(1).describe("The promise, as an imperative task. No speaker prefix."),
  owner: z.string().nullable().describe("Who owes it, verbatim from the transcript. Null if unstated."),
  deadline: z.string().nullable().describe("Absolute date, YYYY-MM-DD. Null if no date was stated."),
  type: z.enum(["email", "deliverable", "meeting", "call", "other"]),
  confidence: z.enum(["high", "medium", "low"]),
  source_span: z.string().min(1).refine((s) => s.trim().length > 0, {
    message: "source_span must not be blank.",
  }).describe("Verbatim quote from the transcript that states this promise."),
});

export const extractionSchema = z.object({
  commitments: z.array(commitmentSchema),
});

/** Actions are suggestions only. Nothing in this schema authorizes an execution. */
export const actionTypeSchema = z.enum([
  "gmail_draft",
  "calendar_event",
  "drive_document",
  "internal_task",
]);

/** Stable names let a later review UI show what is still needed. */
export const actionDataRequirementSchema = z.enum([
  "recipient",
  "subject",
  "body",
  "event_title",
  "start_time",
  "end_time",
  "attendees",
  "document_title",
  "document_content",
  "task_title",
  "owner",
  "due_date",
]);

const actionDataList = z.array(actionDataRequirementSchema).max(12);

export const actionSuggestionSchema = z.object({
  type: actionTypeSchema,
  confidence: z.enum(["high", "medium", "low"]),
  rationale: z.string().trim().min(1).max(280),
  required_data: actionDataList.min(1),
  missing_data: actionDataList,
}).superRefine((action, context) => {
  const required = new Set(action.required_data);
  if (required.size !== action.required_data.length) {
    context.addIssue({ code: "custom", path: ["required_data"], message: "required_data must not repeat a field." });
  }
  if (new Set(action.missing_data).size !== action.missing_data.length) {
    context.addIssue({ code: "custom", path: ["missing_data"], message: "missing_data must not repeat a field." });
  }
  if (action.missing_data.some((field) => !required.has(field))) {
    context.addIssue({ code: "custom", path: ["missing_data"], message: "missing_data must be a subset of required_data." });
  }
});

export const actionPlanSchema = z.object({
  actions: z.array(actionSuggestionSchema).max(4),
}).superRefine((plan, context) => {
  if (new Set(plan.actions.map((action) => action.type)).size !== plan.actions.length) {
    context.addIssue({ code: "custom", path: ["actions"], message: "Suggest each action type at most once." });
  }
});

export const draftSchema = z.object({
  // A newline here isn't just untidy — `buildRawMessage` (lib/gmail/mime.ts) refuses any
  // header value containing one, so an ungated multiline subject reaches the database, gets
  // shown as an approvable draft, and only then blows up the Gmail push. Rejecting it here
  // instead sends the model back for a retry (generateObjectWithRetry) before anything is saved.
  subject: z.string().min(1).max(200).refine((s) => !/[\r\n]/.test(s), {
    message: "Subject must be a single line, no line breaks.",
  }).describe("Email subject line. Plain text, single line, no greeting, under 60 characters."),
  body: z.string().min(1).describe("The message body: two or three sentences, greeting and sign-off included."),
});

export const MAX_INQUIRY_CHARS = 20_000;

export const leadTriageSchema = z.object({
  name: z.string().nullable().describe("The prospect's name, if stated. Null if not given."),
  email: z.string().nullable().describe(
    "The prospect's email address, only if it literally appears in the inquiry text. Null otherwise — never invent one."),
  serviceInterest: z.string().max(300).nullable().describe(
    "What they're asking about, in a few words. Null if genuinely unclear."),
  urgency: z.enum(["low", "medium", "high"]).describe("How time-sensitive the request reads."),
  replyType: z.enum(["qualify", "intake", "booking"]).describe(
    "qualify: too vague to act on, ask what they need. intake: clear need, ask the specific missing details "
    + "(budget, timing, location, etc). booking: everything needed is already stated, offer to schedule."),
  // Same MIME-safety reasoning as draftSchema's subject field.
  replySubject: z.string().min(1).max(200).refine((s) => !/[\r\n]/.test(s), {
    message: "Subject must be a single line, no line breaks.",
  }).describe("Email subject line. Plain text, single line, under 60 characters."),
  replyBody: z.string().min(1).describe(
    "The draft reply: two or three sentences, matching replyType. Never promises a price, timeline, or "
    + "availability the inquiry didn't already state."),
});

export type LeadTriage = z.infer<typeof leadTriageSchema>;

export const MAX_REVIEW_CHARS = 5_000;

export const reviewResponseSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  urgency: z.enum(["low", "medium", "high"]).describe(
    "high only for reviews describing a serious service failure, safety issue, or threat to leave/escalate publicly."),
  responseDraft: z.string().min(1).describe(
    "A short, professional reply (2-4 sentences) matching the sentiment: grateful for positive, empathetic "
    + "and solution-oriented for negative, warm and brief for neutral. Never invent facts, discounts, or "
    + "promises the business didn't already make. Never argue with the reviewer."),
});

export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

export const MAX_TRANSCRIPT_EXCERPT_CHARS = 4_000;
export const MAX_PREVIOUS_SUGGESTIONS = 20;

export const meetingAssistantSchema = z.object({
  suggestions: z.array(z.string().min(1).max(200)).max(3).describe(
    "0-3 short, concrete things worth asking or clarifying right now, based only on the most recent "
    + "excerpt. Only include something genuinely actionable and non-obvious (e.g. a payment method, a "
    + "missing date, an unconfirmed quantity or scope). Never repeat anything already listed as a prior "
    + "suggestion. Empty array if nothing is worth flagging — most excerpts should return nothing."),
});

export type MeetingAssistantSuggestions = z.infer<typeof meetingAssistantSchema>;

export type ExtractedCommitment = z.infer<typeof commitmentSchema> & {
  span_verified: boolean;
};
export type SuggestedAction = z.infer<typeof actionSuggestionSchema>;
export type GeneratedDraft = z.infer<typeof draftSchema>;
