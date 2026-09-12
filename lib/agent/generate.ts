import {
  generateText, Output, NoObjectGeneratedError, APICallError, type LanguageModel,
} from "ai";
import type { z } from "zod";
import { logFailure } from "@/lib/observability/log";

/**
 * One structured-output call, retried on transient provider failures and once when the
 * model answers with prose instead of JSON. Smaller models do that often enough that a
 * single retry is the difference between a usable draft and an empty one; a second prose
 * failure is a real problem the caller should see.
 *
 * Shared by every AI generation path so they all behave the same under a flaky model or a
 * rate-limited gateway. The AI SDK's own retries are disabled (`maxRetries: 0`) because
 * they back off deterministically — every parallel call sleeps the same 2s then 4s and
 * retries in lockstep, which turns one 429 burst into a second and third. Retrying here
 * lets us add full jitter so the retries spread out, and honor `Retry-After` when present.
 */
const MAX_PROVIDER_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_BACKOFF_DELAY_MS = 8_000;

/**
 * Vercel AI Gateway model fallbacks, tried in order after the primary `model` is
 * unavailable or rate-limited. The primary stays whatever the caller passed (for every
 * production path that is `EXTRACTION_MODEL`, openai/gpt-4o-mini); this only adds a second
 * model so a persistent 429 on the primary is not the end of the generation. Uses the
 * Gateway's documented `providerOptions.gateway.models` request option.
 */
export const GATEWAY_FALLBACK_MODELS = ["google/gemini-2.5-flash-lite"] as const;

// A provider asking for longer than this does not want us back soon. This is a synchronous
// ingest path and the production function timeout is unconfirmed, so holding the invocation
// open is worse than surfacing the failure.
const MAX_RETRY_AFTER_MS = 15_000;
// Added on top of a header-requested delay so callers told to wait the same amount don't
// wake in lockstep. Always positive, so the provider's minimum is never violated.
const RETRY_AFTER_JITTER_MS = 1_000;

export interface GenerateObjectInput<T extends z.ZodType> {
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: T;
  /** Short label for retry logs, e.g. "extract" or "draft". Never prompt or transcript text. */
  operation?: string;
  /** Action type being generated, when known, so retry logs identify the work. */
  actionType?: string;
}

/**
 * Payload-free failure surfaced when a generation is abandoned. Provider/API errors can
 * carry `requestBodyValues`, `responseBody`, and headers — the prompt and transcript — so
 * they must never reach generic logging as-is. This keeps only what an operator needs.
 */
export class GenerationFailure extends Error {
  readonly errorType: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly operation?: string;
  readonly actionType?: string;
  readonly attempts: number;

  constructor(meta: { errorType: string; status?: number; retryable: boolean;
    operation?: string; actionType?: string; attempts: number }) {
    const details = [
      `error_type=${meta.errorType}`,
      meta.status === undefined ? null : `status=${meta.status}`,
      `retryable=${meta.retryable}`,
      meta.operation ? `operation=${meta.operation}` : null,
      meta.actionType ? `action_type=${meta.actionType}` : null,
      `attempts=${meta.attempts}`,
    ].filter((part): part is string => part !== null).join(" ");
    super(`AI generation failed (${details})`);
    this.name = "GenerationFailure";
    this.errorType = meta.errorType;
    this.status = meta.status;
    this.retryable = meta.retryable;
    this.operation = meta.operation;
    this.actionType = meta.actionType;
    this.attempts = meta.attempts;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (APICallError.isInstance(error) && error.isRetryable === true) return true;
  // Gateway errors carry `isRetryable` too but aren't re-exported by `ai`; duck-typing
  // avoids reaching into a transitive package just to recognize one.
  return typeof error === "object" && error !== null &&
    (error as { isRetryable?: unknown }).isRetryable === true;
}

/** Walks a small chain of `cause` links, because a parse wrapper can hide a 429 underneath. */
function isRetryableProviderError(error: unknown, depth = 0): boolean {
  if (error == null || depth > 3) return false;
  if (isRetryable(error)) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause != null && cause !== error && isRetryableProviderError(cause, depth + 1);
}

/** APICallError and gateway errors alike, retryable or not, so terminal ones can be sanitized. */
function isProviderApiError(error: unknown, depth = 0): boolean {
  if (error == null || depth > 3) return false;
  if (APICallError.isInstance(error)) return true;
  const candidate = error as { isRetryable?: unknown; statusCode?: unknown; responseHeaders?: unknown };
  if (typeof candidate.isRetryable === "boolean") return true;
  if (typeof candidate.statusCode === "number" && candidate.responseHeaders !== undefined) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause != null && cause !== error && isProviderApiError(cause, depth + 1);
}

function headerValue(source: unknown, name: string): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  // `Headers`-like: fetch/undici responses expose `.get`, and `get` is case-insensitive.
  const get = (source as { get?: unknown }).get;
  if (typeof get === "function") {
    try {
      const value = (source as Headers).get(name);
      if (typeof value === "string") return value;
    } catch {
      // Not actually a Headers instance — fall through to record handling.
    }
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (key.toLowerCase() === lower && typeof value === "string") return value;
  }
  return undefined;
}

function headersOf(error: unknown, depth = 0): unknown {
  if (error == null || depth > 3) return undefined;
  const direct = (error as { responseHeaders?: unknown }).responseHeaders;
  if (direct !== undefined) return direct;
  return headersOf((error as { cause?: unknown }).cause, depth + 1);
}

/** `Retry-After` (seconds or HTTP date) or `Retry-After-Ms`, when the provider sent one. */
function retryAfterMs(error: unknown): number | undefined {
  const headers = headersOf(error);
  if (!headers) return undefined;
  const ms = Number.parseFloat(headerValue(headers, "retry-after-ms") ?? "");
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const after = headerValue(headers, "retry-after");
  if (!after) return undefined;
  const seconds = Number.parseFloat(after);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(after);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/**
 * Delay before retry number `attempt + 1`, or `null` when the provider asked for a wait
 * longer than `MAX_RETRY_AFTER_MS` (stop retrying rather than retry early).
 *
 * With `Retry-After`, the provider's minimum is respected exactly and a positive jitter is
 * added on top so parallel callers don't wake together. Without one, exponential backoff
 * with full jitter applies, capped at `MAX_BACKOFF_DELAY_MS`.
 */
export function computeRetryDelayMs(
  attempt: number, error: unknown, random: () => number = Math.random,
): number | null {
  const requested = retryAfterMs(error);
  if (requested !== undefined) {
    if (requested > MAX_RETRY_AFTER_MS) return null;
    return requested + 1 + Math.floor(random() * RETRY_AFTER_JITTER_MS);
  }
  const ceiling = Math.min(MAX_BACKOFF_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

function statusCodeOf(error: unknown, depth = 0): number | undefined {
  if (error == null || depth > 3) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  if (typeof status === "number") return status;
  return statusCodeOf((error as { cause?: unknown }).cause, depth + 1);
}

function sanitizeFailure(error: unknown, input: GenerateObjectInput<z.ZodType>, attempts: number): unknown {
  if (!isProviderApiError(error) && !NoObjectGeneratedError.isInstance(error)) return error;
  return new GenerationFailure({
    errorType: error instanceof Error ? error.name : typeof error,
    status: statusCodeOf(error),
    retryable: isRetryableProviderError(error),
    operation: input.operation,
    actionType: input.actionType,
    attempts,
  });
}

/**
 * Logs retry context only — operation, attempt, delay, status, error type. The raw error is
 * deliberately not passed to `logFailure`: `APICallError` carries `requestBodyValues`, which
 * for these calls is the transcript or commitment text. A one-off object keeps that out of
 * the logs.
 */
function logRetry(input: GenerateObjectInput<z.ZodType>, error: unknown, attempt: number, delay: number): void {
  const status = statusCodeOf(error);
  const where = [
    "generate.retry",
    `operation=${input.operation ?? "unknown"}`,
    input.actionType ? `action_type=${input.actionType}` : null,
    `attempt=${attempt}`,
    `delay_ms=${delay}`,
    status === undefined ? null : `status=${status}`,
  ].filter((part): part is string => part !== null).join(" ");
  logFailure(where, { error_type: error instanceof Error ? error.name : typeof error, retryable: true });
}

export async function generateObjectWithRetry<T extends z.ZodType>(
  input: GenerateObjectInput<T>,
): Promise<z.infer<T>> {
  let attempts = 0;
  const call = async (): Promise<z.infer<T>> => {
    attempts++;
    const { output } = await generateText({
      model: input.model,
      system: input.system,
      prompt: input.prompt,
      output: Output.object({ schema: input.schema }),
      maxRetries: 0,
      providerOptions: {
        gateway: { models: [...GATEWAY_FALLBACK_MODELS] },
      },
    });
    return output as z.infer<T>;
  };

  // The structured-output recovery budget is global to the whole operation: a provider
  // retry in the middle must not hand malformed output a fresh extra call.
  let objectRetriesRemaining = 1;
  let providerRetries = 0;

  for (;;) {
    try {
      return await call();
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error) && objectRetriesRemaining > 0) {
        objectRetriesRemaining--;
        continue;
      }
      if (!isRetryableProviderError(error) || providerRetries >= MAX_PROVIDER_RETRIES) {
        throw sanitizeFailure(error, input, attempts);
      }
      const delay = computeRetryDelayMs(providerRetries, error);
      if (delay === null) {
        throw sanitizeFailure(error, input, attempts);
      }
      providerRetries++;
      logRetry(input, error, providerRetries, delay);
      await sleep(delay);
    }
  }
}
