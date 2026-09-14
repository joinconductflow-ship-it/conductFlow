/**
 * The whole of our error reporting. console.error lands in Vercel's runtime logs on every
 * plan at no cost; a hosted error service is a paid dependency and a later decision.
 *
 * Never throws: a logger that can fail an action is worse than no logger.
 */
export function logFailure(where: string, error: unknown): void {
  if (!error) return;
  let message: string;
  if (typeof error === "object") {
    try {
      const seen = new WeakSet<object>();
      message = JSON.stringify(error, (_key, value) => {
        if (isSensitiveKey(_key)) return "[REDACTED]";
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
          if (value instanceof Error) return {
            ...value, name: value.name, message: value.message,
            stack: value.stack, cause: value.cause,
          };
        }
        return typeof value === "string" ? redactString(value) : value;
      });
    } catch {
      message = Object.prototype.toString.call(error);
    }
  } else {
    message = redactString(String(error));
  }
  console.error(`[conductflow] ${where}: ${message}`);
}

// Keep diagnostic context while preventing accidental credential/transcript disclosure when a
// provider or database error includes request metadata. This is intentionally key- and
// pattern-based rather than a lossy "safe message" conversion: logs remain useful to operators.
const SENSITIVE_KEY = /(?:token|secret|password|authorization|cookie|prompt|raw[_-]?body|access[_-]?key|private[_-]?key|transcript)(?:$|[_-])/i;
const SENSITIVE_VALUE = /\bBearer\s+[^\s]+|\b(?:access_token|refresh_token|client_secret|api_key)\s*[=:]\s*[^\s,;]+/gi;

function isSensitiveKey(key: string): boolean {
  return key.length > 0 && SENSITIVE_KEY.test(key);
}

function redactString(value: string): string {
  return value.replace(SENSITIVE_VALUE, (match) => {
    const separator = match.match(/[=:]/)?.[0];
    if (separator) return `${match.slice(0, match.indexOf(separator) + 1)}[REDACTED]`;
    return "Bearer [REDACTED]";
  });
}
