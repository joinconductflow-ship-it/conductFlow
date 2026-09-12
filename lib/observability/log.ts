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
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
          if (value instanceof Error) return {
            ...value, name: value.name, message: value.message,
            stack: value.stack, cause: value.cause,
          };
        }
        return value;
      });
    } catch {
      message = Object.prototype.toString.call(error);
    }
  } else {
    message = String(error);
  }
  console.error(`[conductflow] ${where}: ${message}`);
}
