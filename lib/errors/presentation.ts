/**
 * User-facing error classification and presentation.
 *
 * Server actions and provider clients may carry useful diagnostic detail in an Error. That
 * detail must stay on the server. Client components use this module to choose a safe message
 * without ever rendering a transported Error.message (which may be a provider response or the
 * opaque Next.js production Server Components error).
 */

export type ErrorKind = "authentication" | "validation" | "provider" | "reconnect" | "operational" | "unexpected";

export interface ErrorClassification {
  kind: ErrorKind;
  /** Present only for an explicitly allow-listed application validation message. */
  safeMessage?: string;
}

export interface PresentErrorOptions {
  fallback: string;
  authentication?: string;
  provider?: string;
  reconnect?: string;
  operational?: string;
}

/** An application-authored message that is safe to transport to a user. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly kind: Exclude<ErrorKind, "unexpected"> = "validation",
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

const FRAMEWORK_ERROR = /server components render|digest property|specific message is omitted/i;
const AUTH_ERROR = /^(?:sign in|unable to verify (?:your )?session|session[_ ](?:changed|expired)|invalid[_ ]state|no[_ ]session|auth[_ ]|workspace access denied|you are not a member)/i;
const RECONNECT_ERROR = /(?:credential[_ ]decryption[_ ]failed|could not be decrypted|needs to be reconnected|reconnect(?:[_ ]google)?(?:[_ ]required)?)/i;
const PROVIDER_ERROR = /(?:supabase|postgrest|pgrst|slack|gmail|google|calendar|drive|oauth|refresh token|access token|api|http\s*\d{3}|status\s*[:=]?\s*\d{3}|scope|rls|relation|column|gateway|network|fetch|timeout|rate limit|decrypt)/i;

// These are messages authored by ConductFlow for an input or state correction. Everything else
// is treated as diagnostic detail and replaced by the caller's contextual fallback.
const SAFE_VALIDATION = [
  /^choose (?:a|an|the) /i,
  /^select (?:at least one|a|an|the) /i,
  /^paste /i,
  /^give conversation title\.?$/i,
  /^enter (?:an )?email address\.?$/i,
  /^name (?:this|the) /i,
  /^which /i,
  /^you must accept Privacy Policy and Terms to continue\.?$/i,
  /^only an owner /i,
  /^action denied:/i,
  /^channel unavailable\./i,
  /^mapped client unavailable\.?$/i,
  /^calendar date, time, duration are required\.?$/i,
  /^low-confidence actions cannot be approved\.?$/i,
  /^one or more selected actions no longer available\.?$/i,
  /^(?:commitment|review|client|prospect|retainer|session) not found(?: .*)?$/i,
  /^that pattern no longer in data\.?$/i,
  /^the Google connection is (?:missing|revoked|error|active)\.?$/i,
];

function messageOf(error: unknown): string | null {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof Error) return error.message || null;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && message ? message : null;
  }
  return null;
}

export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof UserFacingError) {
    return { kind: error.kind, safeMessage: error.message };
  }

  const message = messageOf(error);
  if (!message || FRAMEWORK_ERROR.test(message)) return { kind: "unexpected" };
  if (AUTH_ERROR.test(message)) return { kind: "authentication" };
  if (RECONNECT_ERROR.test(message)) return { kind: "reconnect" };
  if (PROVIDER_ERROR.test(message)) return { kind: "provider" };
  const safeMessage = SAFE_VALIDATION.find((pattern) => pattern.test(message))
    ? message
    : undefined;
  return safeMessage ? { kind: "validation", safeMessage } : { kind: "operational" };
}

/**
 * Return only safe, contextual copy for a UI. Raw Error.message is never returned unless the
 * error is an explicitly marked UserFacingError or matches the narrow validation allow-list.
 */
export function presentError(error: unknown, options: PresentErrorOptions): string {
  const classification = classifyError(error);
  if (classification.kind === "validation" && classification.safeMessage) {
    return classification.safeMessage;
  }
  if (classification.kind === "authentication") {
    return options.authentication ?? "Your session has expired. Please sign in again.";
  }
  if (classification.kind === "provider") {
    return options.provider ?? options.fallback;
  }
  if (classification.kind === "reconnect") {
    return options.reconnect ?? "Please reconnect the integration and try again.";
  }
  if (classification.kind === "operational") {
    return options.operational ?? options.fallback;
  }
  return options.fallback;
}

/** Same boundary for query-string values coming from OAuth redirects. */
export function presentErrorText(value: string | null | undefined, options: PresentErrorOptions): string | null {
  if (!value) return null;
  return presentError(value, options);
}
