import type {
  ActionInputData,
  Commitment,
  CommitmentActionSuggestion,
  DeliverableDraft,
  SuggestedActionType,
} from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const RELATIVE_DATE_RE = /\b(today|tomorrow|tonight|this\s+(?:week|morning|evening)|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

const ACTION_INPUT_KEYS: ReadonlySet<string> = new Set([
  "recipient", "event_type", "person", "date", "start_time", "duration_minutes", "time_zone",
  "location", "notes", "recurrence_rule", "recurrence_text", "relative_date",
  "relative_date_confirmed", "recurrence_confirmed", "conflict_confirmed", "document_title",
  "document_summary", "document_body", "document_details",
]);

/**
 * The set of fields a reviewer has explicitly edited. This is real provenance, not an
 * equality inference: the client records which fields the reviewer touched, and it is
 * persisted in `input_data.reviewer_edited_fields` so it survives a refresh or reload.
 * Unknown or duplicate entries are dropped.
 */
export function sanitizeReviewerEditedFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const fields = value.filter((field): field is string =>
    typeof field === "string" && ACTION_INPUT_KEYS.has(field));
  return [...new Set(fields)];
}

/** The schedule fields whose change invalidates a previously computed conflict preview. */
const CALENDAR_SCHEDULE_FIELDS = ["date", "start_time", "duration_minutes", "event_type", "person"] as const;

/** True when the effective schedule differs from what was persisted for this action. */
export function calendarScheduleChanged(
  saved: ActionInputData,
  effective: ActionInputData,
): boolean {
  return CALENDAR_SCHEDULE_FIELDS.some((key) => effective[key] !== saved[key]);
}

export interface ActionReadinessContext {
  commitment: Commitment;
  clientName: string;
  draft: DeliverableDraft | null;
}

export interface ActionReadiness {
  data: ActionInputData;
  missing: string[];
  ready: boolean;
}

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function calendarDateDefault(deadline: string | null): string | undefined {
  if (!deadline) return undefined;
  const date = deadline.slice(0, 10);
  return DATE_RE.test(date) ? date : undefined;
}

function conciseTitle(text: string): string {
  const stripped = text
    .replace(/^(?:i|we)\s+(?:will|'ll|can)\s+/i, "")
    .replace(/^(?:create|draft|write|update|prepare)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const title = stripped || "Commitment follow-up";
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`.slice(0, 80);
}

function eventTypeFor(commitment: Commitment): string {
  const source = `${commitment.text} ${commitment.source_span}`;
  const explicit = source.match(/\b(makeup session|follow-up call|follow-up meeting|review session|working session|check-in|consultation|appointment|demo|interview|call|meeting|session)\b/i)?.[1];
  if (explicit) return `${explicit.charAt(0).toUpperCase()}${explicit.slice(1).toLowerCase()}`;
  if (commitment.type === "call") return "Call";
  return "Meeting";
}

function explicitTime(source: string): string | undefined {
  const match = source.match(/\b(?:at|from)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const pm = match[3].toLowerCase().startsWith("p");
  if (hour === 12) hour = pm ? 12 : 0;
  else if (pm) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function explicitDuration(source: string): number | undefined {
  const minutes = source.match(/\b(?:for\s+)?(\d{1,3})\s*(?:minutes?|mins?)\b/i)?.[1];
  if (minutes) return Number(minutes);
  const hours = source.match(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i)?.[1];
  if (hours) return Math.round(Number(hours) * 60);
  if (/\b(?:for\s+)?(?:an|one)\s+hour\b/i.test(source)) return 60;
  if (/\bhalf[- ]hour\b/i.test(source)) return 30;
  return undefined;
}

function recurrenceFor(source: string): { rule: string; text: string } | null {
  const everyWeekday = source.match(/\b(?:every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (everyWeekday) {
    const day = everyWeekday[1].slice(0, 2).toUpperCase();
    return { rule: `RRULE:FREQ=WEEKLY;BYDAY=${day}`, text: everyWeekday[0] };
  }
  const simple = source.match(/\b(daily|weekly|monthly|yearly)\b/i)?.[1]?.toLowerCase();
  if (!simple) return null;
  return { rule: `RRULE:FREQ=${simple === "daily" ? "DAILY" : simple === "weekly" ? "WEEKLY" : simple === "monthly" ? "MONTHLY" : "YEARLY"}`, text: simple };
}

function explicitUrl(source: string): string | undefined {
  const raw = source.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  return raw?.replace(/[),.;]+$/, "");
}

function documentBody(context: ActionReadinessContext, details?: string): string {
  const title = conciseTitle(context.commitment.text);
  const sections = [
    title,
    "",
    "Overview",
    context.commitment.text.trim(),
    "",
    "Original context",
    context.commitment.source_span.trim(),
  ];
  if (details) sections.push("", "Details", details);
  sections.push("", "Next step", "Review and complete this draft before sharing it.");
  return sections.join("\n");
}

export function initialActionData(
  type: SuggestedActionType,
  context: ActionReadinessContext,
): ActionInputData {
  const source = `${context.commitment.text}\n${context.commitment.source_span}`;
  if (type === "calendar_event") {
    const recurrence = recurrenceFor(source);
    return {
      event_type: eventTypeFor(context.commitment),
      person: context.clientName,
      date: calendarDateDefault(context.commitment.deadline),
      start_time: explicitTime(source),
      duration_minutes: explicitDuration(source),
      location: explicitUrl(source),
      recurrence_rule: recurrence?.rule,
      recurrence_text: recurrence?.text,
      relative_date: RELATIVE_DATE_RE.test(context.commitment.source_span),
    };
  }
  if (type === "drive_document") {
    return {
      document_title: conciseTitle(context.commitment.text),
      document_summary: context.commitment.text.trim().slice(0, 220),
      document_body: documentBody(context),
    };
  }
  return {};
}

export function sanitizeActionInput(type: SuggestedActionType, value: unknown): ActionInputData {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: ActionInputData = {};
  if (type === "calendar_event") {
    const date = clean(raw.date, 10);
    const time = clean(raw.start_time, 5);
    const duration = Number(raw.duration_minutes);
    const eventType = clean(raw.event_type, 80);
    const person = clean(raw.person, 120);
    if (date && DATE_RE.test(date)) result.date = date;
    if (time && TIME_RE.test(time)) result.start_time = time;
    if (Number.isInteger(duration) && duration >= 5 && duration <= 1440) result.duration_minutes = duration;
    if (eventType) result.event_type = eventType;
    if (person) result.person = person;
    result.relative_date_confirmed = raw.relative_date_confirmed === true;
    result.recurrence_confirmed = raw.recurrence_confirmed === true;
    result.conflict_confirmed = raw.conflict_confirmed === true;
  }
  if (type === "drive_document") {
    const title = clean(raw.document_title, 120);
    const details = clean(raw.document_details, 10_000);
    if (title) result.document_title = title;
    if (details) result.document_details = details;
  }
  return result;
}

/**
 * The inputs a review card should show: the server-persisted readiness with the reviewer's
 * current edits layered on top. Persisted server data is the base (so a refresh updates the
 * card), while edits live only in local state and are never lost to a prop change.
 */
export function resolveActionInput(
  persisted: ActionInputData | undefined,
  override: ActionInputData | undefined,
): ActionInputData {
  return { ...(persisted ?? {}), ...(override ?? {}) };
}

export function actionReadiness(
  suggestion: CommitmentActionSuggestion,
  context: ActionReadinessContext,
  submitted?: unknown,
  reviewerEditedFields?: unknown,
  clearedFields?: unknown,
): ActionReadiness {
  const base = initialActionData(suggestion.action_type, context);
  const saved = suggestion.input_data ?? {};
  const submittedData = sanitizeActionInput(suggestion.action_type, submitted);

  // Ownership (provenance) and clearing are separate, explicit concepts. Ownership is sticky
  // and never inferred from values. Clearing must be signalled explicitly: omission is NOT a
  // clear, so a previously reviewer-owned value survives an approval that doesn't resubmit it.
  const persistedOwned = sanitizeReviewerEditedFields(saved.reviewer_edited_fields);
  const persistedCleared = sanitizeReviewerEditedFields(saved.reviewer_cleared_fields);
  const submittedOwned = sanitizeReviewerEditedFields(reviewerEditedFields);
  const clearedNow = sanitizeReviewerEditedFields(clearedFields);
  const reviewerOwns = new Set<string>([
    ...persistedOwned, ...persistedCleared, ...submittedOwned, ...clearedNow,
  ]);

  // A provided value always supersedes a previous clear; otherwise persisted and this-round
  // clears both suppress fallback.
  const effectiveCleared = new Set<string>();
  for (const field of [...persistedCleared, ...clearedNow]) {
    if (submittedData[field as keyof ActionInputData] === undefined) effectiveCleared.add(field);
  }

  const data = { ...base, ...saved, ...submittedData };
  if (suggestion.action_type === "calendar_event" &&
      !reviewerOwns.has("start_time") && base.start_time !== undefined) {
    // A source-derived schedule must not be permanently shadowed by a stale persisted value.
    // When the commitment states a time and the reviewer has never edited start_time, the
    // freshly parsed value wins (e.g. an old 18:00 for a commitment that said 4 PM). Once the
    // reviewer edits start_time, provenance keeps their value across every later approval.
    data.start_time = base.start_time;
  }
  // Only an explicit clear removes fallback/persisted data. Omission leaves everything intact.
  for (const field of effectiveCleared) {
    delete data[field as keyof ActionInputData];
  }
  if (reviewerOwns.size > 0) data.reviewer_edited_fields = [...reviewerOwns];
  else delete data.reviewer_edited_fields;
  if (effectiveCleared.size > 0) data.reviewer_cleared_fields = [...effectiveCleared];
  else delete data.reviewer_cleared_fields;
  const missing: string[] = [];

  if (suggestion.action_type === "gmail_draft") {
    if (!context.draft?.subject?.trim()) missing.push("subject");
    if (!context.draft?.body?.trim()) missing.push("body");
  } else if (suggestion.action_type === "calendar_event") {
    if (!data.date) missing.push("date");
    if (!data.start_time) missing.push("start_time");
    if (!data.duration_minutes) missing.push("duration");
    if (data.relative_date && !data.relative_date_confirmed) missing.push("relative_date_confirmation");
    if (data.recurrence_rule && !data.recurrence_confirmed) missing.push("recurrence_confirmation");
    if ((suggestion.preview_data?.conflicts?.length ?? 0) > 0 && !data.conflict_confirmed) {
      missing.push("schedule_conflict_confirmation");
    }
  } else if (suggestion.action_type === "drive_document") {
    const plannerNeedsContent = suggestion.missing_data.includes("document_content");
    const contextIsThin = context.commitment.text.trim().length < 20 || context.commitment.source_span.trim().length < 20;
    if ((plannerNeedsContent || contextIsThin) && !data.document_details) missing.push("document_details");
    if (!data.document_title) missing.push("document_title");
    data.document_summary = context.commitment.text.trim().slice(0, 220);
    data.document_body = documentBody(context, data.document_details);
  }

  return { data, missing, ready: missing.length === 0 };
}

/** A snapshot of server readiness, tagged with the props it was derived from. */
export interface ReadinessSnapshot {
  value: ActionInputData;
  basedOn: string;
}

type SignatureSource = Pick<CommitmentActionSuggestion,
  "execution_state" | "input_data" | "missing_data" | "preview_data">;

/** Identifies the server props a snapshot was based on, so a later refresh can supersede it. */
export function actionReadinessSignature(action: SignatureSource): string {
  return JSON.stringify([
    action.execution_state ?? "",
    action.input_data ?? {},
    action.missing_data ?? [],
    action.preview_data ?? {},
  ]);
}

/**
 * Records the server's accepted readiness so the review card shows normalized values
 * immediately, before the refreshed props arrive. The snapshot is tagged with the props it
 * was based on; once refreshed props differ, `resolveEffectiveActionInput` stops applying it,
 * so newer authoritative data is never permanently shadowed.
 */
export function mergeAcceptedReadiness(
  snapshots: Record<string, ReadinessSnapshot>,
  results: ReadonlyArray<{ id: string; inputData?: ActionInputData }>,
  currentActions: ReadonlyArray<{ id: string } & SignatureSource>,
): Record<string, ReadinessSnapshot> {
  const signatures = new Map(currentActions.map((action) => [action.id, actionReadinessSignature(action)]));
  const next = { ...snapshots };
  for (const result of results) {
    if (result.inputData) {
      next[result.id] = { value: result.inputData, basedOn: signatures.get(result.id) ?? "" };
    }
  }
  return next;
}

/** Drops only the local overrides the server accepted/persisted, so refresh can take over. */
export function clearAcceptedOverrides(
  overrides: Record<string, ActionInputData>,
  results: ReadonlyArray<{ id: string; inputData?: ActionInputData }>,
): Record<string, ActionInputData> {
  const next = { ...overrides };
  for (const result of results) {
    if (result.inputData) delete next[result.id];
  }
  return next;
}

/**
 * The effective inputs for one action: authoritative server props, plus a response snapshot
 * only while those props are unchanged, plus the reviewer's current edits. Once `refresh`
 * delivers different props the snapshot's signature no longer matches and it is ignored.
 */
export function resolveEffectiveActionInput(
  action: SignatureSource,
  snapshot: ReadinessSnapshot | undefined,
  override: ActionInputData | undefined,
): ActionInputData {
  const snapshotApplies = snapshot !== undefined &&
    snapshot.basedOn === actionReadinessSignature(action);
  return resolveActionInput(
    { ...(action.input_data ?? {}), ...(snapshotApplies ? snapshot.value : {}) },
    override,
  );
}

/** Explicit provenance for an action, using the snapshot only while it still matches props. */
export function effectiveReviewerFields(
  action: SignatureSource,
  snapshot: ReadinessSnapshot | undefined,
  override: ActionInputData | undefined,
): string[] {
  const snapshotApplies = snapshot !== undefined &&
    snapshot.basedOn === actionReadinessSignature(action);
  const accepted = snapshotApplies
    ? snapshot.value.reviewer_edited_fields
    : action.input_data?.reviewer_edited_fields;
  return [...new Set([
    ...sanitizeReviewerEditedFields(accepted),
    ...Object.keys(override ?? {}),
  ])];
}

export function calendarTitle(data: ActionInputData): string {
  return `${data.event_type ?? "Meeting"} — ${data.person ?? "Client"}`;
}
