import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { GenerationFailure, computeRetryDelayMs, generateObjectWithRetry } from "@/lib/agent/generate";
import { logFailure } from "@/lib/observability/log";

const schema = z.object({ ok: z.boolean() });

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

function reply(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function prose(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function apiError(overrides: Partial<ConstructorParameters<typeof APICallError>[0]> = {}) {
  return new APICallError({
    message: "Too Many Requests",
    url: "https://gateway.example.test/v1/chat",
    requestBodyValues: { prompt: "SECRET TRANSCRIPT TEXT" },
    statusCode: 429,
    isRetryable: true,
    ...overrides,
  });
}

class GatewayStyleError extends Error {
  readonly isRetryable = true;
  readonly statusCode = 429;
  constructor() {
    super("rate limited");
    this.name = "GatewayRateLimitError";
  }
}

const input = { system: "system", prompt: "SECRET TRANSCRIPT TEXT", schema, operation: "extract" };

afterEach(() => vi.restoreAllMocks());

describe("generateObjectWithRetry retryability", () => {
  it("retries a retryable provider error and then succeeds", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        if (calls < 3) throw apiError();
        return reply({ ok: true });
      },
    });

    const result = await generateObjectWithRetry({ ...input, model });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("retries a Gateway-style isRetryable error", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        if (calls === 1) throw new GatewayStyleError();
        return reply({ ok: true });
      },
    });

    const result = await generateObjectWithRetry({ ...input, model });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does not retry a non-retryable provider error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw apiError({ statusCode: 400, isRetryable: false, message: "Bad Request" });
      },
    });

    await expect(generateObjectWithRetry({ ...input, model })).rejects.toThrow(/AI generation failed/i);
    expect(calls).toBe(1);
  });

  it("stops after the bounded number of retries", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw apiError();
      },
    });

    await expect(generateObjectWithRetry({ ...input, model })).rejects.toThrow(/attempts=4/);
    expect(calls).toBe(4);
  });

  it("surfaces a sanitized, payload-free failure that logs cleanly", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw apiError({ statusCode: 400, isRetryable: false, message: "Bad Request" });
      },
    });

    try {
      await generateObjectWithRetry({ ...input, model });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationFailure);
      const failure = error as GenerationFailure;
      expect(failure.status).toBe(400);
      expect(failure.retryable).toBe(false);
      expect(failure.operation).toBe("extract");
      expect(failure.attempts).toBe(1);
      expect((failure as unknown as { requestBodyValues?: unknown }).requestBodyValues).toBeUndefined();
      expect(JSON.stringify(failure)).not.toContain("SECRET TRANSCRIPT TEXT");

      logFailure("finishIngest.actionPlan", failure);
      const output = logged.join("\n");
      expect(output).toContain("status=400");
      expect(output).toContain("retryable=false");
      expect(output).not.toContain("SECRET TRANSCRIPT TEXT");
      expect(output).not.toContain("requestBodyValues");
    }
  });

  it("keeps the structured-output retry: one recovery call total", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        return calls === 1 ? prose("Sure, here is a friendly email.") : reply({ ok: true });
      },
    });

    const result = await generateObjectWithRetry({ ...input, model });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does not reset the structured-output retry after a provider retry", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        if (calls === 1) return prose("not json");
        if (calls === 2) throw apiError();
        if (calls === 3) return prose("still not json");
        return reply({ ok: true });
      },
    });

    await expect(generateObjectWithRetry({ ...input, model })).rejects.toThrow(/AI generation failed/i);
    expect(calls).toBe(3);
  });

  it("gives up after two non-JSON responses without provider retries", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        return prose("still not json");
      },
    });

    await expect(generateObjectWithRetry({ ...input, model })).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("sanitizes terminal structured-output failures", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => prose("SECRET MODEL OUTPUT"),
    });

    try {
      await generateObjectWithRetry({ ...input, model });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationFailure);
      expect(JSON.stringify({ message: (error as Error).message })).not.toContain("SECRET MODEL OUTPUT");
    }
  });

  it("does not put prompt or transcript text in retry logs", async () => {
    const logged: string[] = [];
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        if (calls === 1) throw apiError();
        return reply({ ok: true });
      },
    });

    await generateObjectWithRetry({ ...input, model });
    const output = logged.join("\n");
    expect(output).toContain("operation=extract");
    expect(output).toContain("attempt=1");
    expect(output).toContain("status=429");
    expect(output).not.toContain("SECRET TRANSCRIPT TEXT");
  });
});

describe("computeRetryDelayMs", () => {
  it("honors Retry-After seconds and never returns less than the minimum", () => {
    const delay = computeRetryDelayMs(0, apiError({ responseHeaders: { "retry-after": "2" } }), () => 0.999);
    expect(delay).toBeGreaterThanOrEqual(2000);
  });

  it("adds positive jitter on top of Retry-After", () => {
    const error = apiError({ responseHeaders: { "retry-after": "2" } });
    expect(computeRetryDelayMs(0, error, () => 0)).toBeGreaterThan(2000);
  });

  it("honors Retry-After-Ms", () => {
    const delay = computeRetryDelayMs(0, apiError({ responseHeaders: { "retry-after-ms": "150" } }), () => 0);
    expect(delay).toBeGreaterThanOrEqual(150);
  });

  it("parses mixed-case Retry-After headers", () => {
    const delay = computeRetryDelayMs(0, apiError({ responseHeaders: { "Retry-After": "3" } }), () => 0);
    expect(delay).toBeGreaterThanOrEqual(3000);
  });

  it("parses Headers-like sources", () => {
    const headers = { get: (name: string) => name.toLowerCase() === "retry-after" ? "4" : null };
    const delay = computeRetryDelayMs(0, apiError({ responseHeaders: headers as unknown as Record<string, string> }), () => 0);
    expect(delay).toBeGreaterThanOrEqual(4000);
  });

  it("reads Retry-After from a wrapped error cause", () => {
    const wrapped = new Error("wrapped", {
      cause: apiError({ responseHeaders: { "retry-after": "1.5" } }),
    });
    expect(computeRetryDelayMs(0, wrapped, () => 0)).toBeGreaterThanOrEqual(1500);
  });

  it("does not truncate a provider minimum to the exponential cap", () => {
    const delay = computeRetryDelayMs(0, apiError({ responseHeaders: { "retry-after": "12" } }), () => 0);
    expect(delay).toBeGreaterThan(8000);
  });

  it("honors a provider minimum up to the 15s retry window", () => {
    const delay = computeRetryDelayMs(0, apiError({ responseHeaders: { "retry-after": "15" } }), () => 0);
    expect(delay).toBeGreaterThanOrEqual(15_000);
  });

  it("stops retrying when the provider minimum exceeds the retry window", () => {
    expect(computeRetryDelayMs(0, apiError({ responseHeaders: { "retry-after": "16" } }), () => 0)).toBeNull();
    expect(computeRetryDelayMs(0, apiError({ responseHeaders: { "retry-after": "120" } }), () => 0)).toBeNull();
  });

  it("uses full jitter inside a bounded exponential ceiling with no Retry-After", () => {
    const error = apiError();
    expect(computeRetryDelayMs(0, error, () => 0)).toBe(0);
    expect(computeRetryDelayMs(0, error, () => 0.999)).toBeLessThan(500);
    expect(computeRetryDelayMs(1, error, () => 0.999)).toBeLessThan(1000);
    expect(computeRetryDelayMs(2, error, () => 0.999)).toBeLessThan(2000);
    expect(computeRetryDelayMs(20, error, () => 0.999)).toBeLessThanOrEqual(8000);
  });

  it("spreads retries across different random draws", () => {
    const error = apiError();
    expect(computeRetryDelayMs(2, error, () => 0.1)).not.toBe(computeRetryDelayMs(2, error, () => 0.9));
  });
});

describe("generateObjectWithRetry honoring Retry-After", () => {
  it("waits at least the requested minimum before retrying", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(0);
      vi.spyOn(console, "error").mockImplementation(() => {});
      let calls = 0;
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          calls++;
          if (calls === 1) throw apiError({ responseHeaders: { "Retry-After": "5" } });
          return reply({ ok: true });
        },
      });

      const pending = generateObjectWithRetry({ ...input, model });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(calls).toBe(1);

      await vi.advanceTimersByTimeAsync(2);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when Retry-After exceeds the retry window", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw apiError({ responseHeaders: { "retry-after": "120" } });
      },
    });

    await expect(generateObjectWithRetry({ ...input, model })).rejects.toBeInstanceOf(GenerationFailure);
    expect(calls).toBe(1);
  });
});
