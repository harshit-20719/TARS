import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { RUBRICS } from "@/framework";
import { outputSchemaFor } from "../schema";
import { ExtractionError, type ExtractionBlockRequest } from "../types";
import {
  acceptsTemperature,
  BLOCK_TIMEOUT_MS,
  createAnthropicProvider,
  DEFAULT_EXTRACTION_MODEL,
  thinkingConfigFor,
  type ExtractionClient,
} from "./anthropic";

const BLOCK = RUBRICS[0];
type BlockOutput = z.infer<ReturnType<typeof outputSchemaFor>>;

/** A valid, empty block answer: a clean read that found nothing. */
const EMPTY: BlockOutput = { observations: [], claims: [] };

/** One block's request, with the fields a test rarely cares about filled in. */
function request(
  over: Partial<ExtractionBlockRequest<BlockOutput>> = {},
): ExtractionBlockRequest<BlockOutput> {
  return {
    rubricKey: BLOCK.key,
    system: "the block's system prompt",
    user: "the transcript message",
    schema: outputSchemaFor(BLOCK),
    timeoutMs: BLOCK_TIMEOUT_MS,
    ...over,
  };
}

/**
 * `opts` is recorded alongside `calls` because the request options are where the
 * run's time budget lives, and nothing used to look at them — which is how a
 * bound that did not hold stayed shipped. See "the time budget" below.
 */
function stub(
  result: unknown,
  extra: Record<string, unknown> = {},
): {
  client: ExtractionClient;
  calls: Record<string, unknown>[];
  opts: ({ timeout?: number; maxRetries?: number } | undefined)[];
} {
  const calls: Record<string, unknown>[] = [];
  const opts: ({ timeout?: number; maxRetries?: number } | undefined)[] = [];
  return {
    calls,
    opts,
    client: {
      messages: {
        parse: async (params, options) => {
          calls.push(params);
          opts.push(options);
          return { parsed_output: result, stop_reason: "end_turn", ...extra };
        },
      },
    },
  };
}

const failing = (thrown: unknown): ExtractionClient => ({
  messages: {
    parse: async () => {
      throw thrown;
    },
  },
});

describe("the request build", () => {
  afterEach(() => vi.unstubAllEnvs());

  /**
   * The whole request, pinned. This is U2's definition of done in one
   * assertion: with default config the adapter sends exactly the fields the
   * old inline build in extract.ts sent — nothing renamed, nothing added,
   * nothing dropped.
   */
  it("sends the same fields the inline build sent, with default config", async () => {
    const { client, calls } = stub(EMPTY);
    await createAnthropicProvider({ client }).extractBlock(request());

    expect(calls[0]).toEqual({
      rubricKey: BLOCK.key,
      model: DEFAULT_EXTRACTION_MODEL,
      max_tokens: 8000,
      system: "the block's system prompt",
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: expect.anything() },
      messages: [{ role: "user", content: "the transcript message" }],
    });
  });

  it("sends what the model generation accepts: effort reaches the 5 series and never Haiku", async () => {
    const run = async (model: string) => {
      const { client, calls } = stub(EMPTY);
      await createAnthropicProvider({ client, model }).extractBlock(request());
      return calls[0];
    };

    const haiku = await run("claude-haiku-4-5");
    const opus = await run("claude-opus-5");

    // Thinking off by default on both, in the one shape every generation accepts.
    expect(haiku.thinking).toEqual({ type: "disabled" });
    expect(opus.thinking).toEqual({ type: "disabled" });
    // The 400-avoidance, which is what this test is really for: effort reaches the
    // 5-series request and never reaches Haiku's.
    expect((haiku.output_config as Record<string, unknown>).effort).toBeUndefined();
    expect((opus.output_config as Record<string, unknown>).effort).toBe("low");
    // The schema travels either way — the authorship rule is not model-dependent.
    for (const params of [haiku, opus]) {
      expect((params.output_config as Record<string, unknown>).format).toBeTruthy();
    }
  });

  it("sends each generation's own thinking shape when EXTRACTION_THINKING is on", async () => {
    vi.stubEnv("EXTRACTION_THINKING", "on");
    const run = async (model: string) => {
      const { client, calls } = stub(EMPTY);
      await createAnthropicProvider({ client, model }).extractBlock(request());
      return calls[0];
    };

    expect((await run("claude-haiku-4-5")).thinking).toEqual({
      type: "enabled",
      budget_tokens: 4000,
    });
    expect((await run("claude-opus-5")).thinking).toEqual({ type: "adaptive" });
  });

  /**
   * The pre-4.6 budget has to sit under the request's own max_tokens — the API
   * requires it strictly smaller — so the two are asserted against each other on
   * the request that actually carries them, not as two unrelated constants.
   */
  it("keeps the pre-4.6 thinking budget under the request's max_tokens ceiling", async () => {
    vi.stubEnv("EXTRACTION_THINKING", "on");
    const { client, calls } = stub(EMPTY);
    await createAnthropicProvider({ client, model: "claude-haiku-4-5" }).extractBlock(request());

    const params = calls[0];
    const budget = (params.thinking as { budget_tokens: number }).budget_tokens;
    expect(budget).toBeLessThan(params.max_tokens as number);
  });

  it("gives an unrecognised model identifier the modern request shape", async () => {
    const { client, calls } = stub(EMPTY);
    await createAnthropicProvider({ client, model: "claude-something-new" }).extractBlock(
      request(),
    );
    expect((calls[0].output_config as Record<string, unknown>).effort).toBe("low");
    expect(calls[0].thinking).toEqual({ type: "disabled" });
  });

  it("defaults the model but honours EXTRACTION_MODEL", async () => {
    const first = stub(EMPTY);
    await createAnthropicProvider({ client: first.client }).extractBlock(request());
    expect(first.calls[0].model).toBe(DEFAULT_EXTRACTION_MODEL);

    vi.stubEnv("EXTRACTION_MODEL", "claude-sonnet-5");
    const second = stub(EMPTY);
    await createAnthropicProvider({ client: second.client }).extractBlock(request());
    expect(second.calls[0].model).toBe("claude-sonnet-5");
  });

  it("explains itself when no API key is configured", () => {
    // The suite deliberately runs with ANTHROPIC_API_KEY unset; with no client
    // injected, credential resolution is the factory's first act.
    expect(() => createAnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });
});

/**
 * The run has to finish inside one serverless function call, and these two
 * numbers are the whole of what holds it there.
 */
describe("the time budget", () => {
  it("passes the request's time bound to the transport", async () => {
    const { client, opts } = stub(EMPTY);
    await createAnthropicProvider({ client }).extractBlock(request());

    expect(opts[0]?.timeout).toBe(BLOCK_TIMEOUT_MS);
  });

  /**
   * The load-bearing one, and the reason the bound above is not enough on its
   * own. The SDK retries twice by default and a timeout is one of the things it
   * retries, so a timeout alone bounds an attempt at thirty seconds and a block
   * at ninety — past the sixty-second ceiling the whole design is sized against.
   * When that happened the function was killed rather than returning, so no
   * error object reached anyone and the browser showed "an unexpected response
   * was received from the server" with nothing behind it.
   */
  it("disables the SDK's retries, so the wait is the block's and not one attempt's", async () => {
    const { client, opts } = stub(EMPTY);
    await createAnthropicProvider({ client }).extractBlock(request());

    expect(opts[0]?.maxRetries).toBe(0);
  });
});

describe("temperature per model generation (KTD12)", () => {
  it("drops a temperature the 5 series would reject, and reports the drop", async () => {
    const { client, calls } = stub(EMPTY);
    const provider = createAnthropicProvider({ client, model: "claude-sonnet-5" });
    await provider.extractBlock(request({ temperature: 0.2 }));

    // Not sent: a non-default temperature is a 400 on this generation, and a 400
    // here would fail every block at once.
    expect("temperature" in calls[0]).toBe(false);
    // But not silently: the drop is recorded so a later admin page can say a
    // tuned temperature is not reaching this model.
    expect(provider.temperatureDrops).toEqual([BLOCK.key]);
  });

  it("sends a temperature to a pre-4.6 model, which accepts it", async () => {
    const { client, calls } = stub(EMPTY);
    const provider = createAnthropicProvider({ client, model: "claude-haiku-4-5" });
    await provider.extractBlock(request({ temperature: 0.2 }));

    expect(calls[0].temperature).toBe(0.2);
    expect(provider.temperatureDrops).toEqual([]);
  });

  it("records nothing when no temperature was supplied", async () => {
    const { client, calls } = stub(EMPTY);
    const provider = createAnthropicProvider({ client, model: "claude-sonnet-5" });
    await provider.extractBlock(request());

    expect("temperature" in calls[0]).toBe(false);
    expect(provider.temperatureDrops).toEqual([]);
  });

  it("decides with the same generation parse as the thinking shape", () => {
    // One regex, two decisions: the model that takes budget_tokens is the model
    // that takes temperature, and "claude-haiku-4-5" must not read as 5-series.
    expect(acceptsTemperature("claude-haiku-4-5")).toBe(true);
    expect(acceptsTemperature("claude-sonnet-4-5")).toBe(true);
    expect(acceptsTemperature("claude-sonnet-4-6")).toBe(false);
    expect(acceptsTemperature("claude-opus-5")).toBe(false);
    expect(acceptsTemperature("claude-something-new")).toBe(false);
  });
});

describe("outcome mapping onto the failure taxonomy", () => {
  it("returns a clean response with zero observations as a valid read, not a failure", async () => {
    const { client } = stub(EMPTY);
    const out = await createAnthropicProvider({ client }).extractBlock(request());
    // "Read it and there was nothing there" is an answer; only the caller can
    // decide what an empty block means.
    expect(out).toEqual({ observations: [], claims: [] });
  });

  it("maps a refusal to a terminal failure instead of reading empty content as a result", async () => {
    const { client } = stub(null, { stop_reason: "refusal", stop_details: { category: "cyber" } });
    const r = createAnthropicProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(/declined/);
    await expect(r).rejects.toMatchObject({ kind: "terminal" });
  });

  /**
   * The delete hazard in its Anthropic form. A max_tokens stop is a truncated
   * answer, and the partial text can still parse into an honest-looking block
   * with fewer observations than the transcript holds — which a re-run would
   * then *replace* a fuller earlier read with. Before this check, a truncated
   * response was either silently accepted (when it parsed) or mislabelled a
   * connectivity failure (when it did not).
   */
  it("maps a max_tokens stop to a retryable failure instead of accepting the truncated answer", async () => {
    const { client } = stub(EMPTY, { stop_reason: "max_tokens" });
    const r = createAnthropicProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(/truncated/);
    await expect(r).rejects.toMatchObject({ kind: "retryable" });
  });

  it("maps a parseless response to a retryable failure", async () => {
    const { client } = stub(null);
    const r = createAnthropicProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(/no parseable output/);
    await expect(r).rejects.toMatchObject({ kind: "retryable" });
  });

  /**
   * The adapter's own guard, not the SDK helper's: whatever parsed out of the
   * response is validated against the block's schema before it crosses the
   * port, so a stub — or an SDK version that stops validating — cannot hand
   * the ledger a shape the block never allowed (KTD9).
   */
  it("re-validates the parsed output against the block schema, and fails it as filing", async () => {
    const { client } = stub({ observations: [{ quote: 42 }], claims: [] });
    const r = createAnthropicProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(ExtractionError);
    await expect(r).rejects.toMatchObject({ kind: "filing" });
    await expect(r).rejects.toThrow(/did not fit/);
  });

  /**
   * The SDK's error shapes, classified where the SDK lives. Thrown as plain
   * objects shaped like the real classes — the classifier reads structurally,
   * so a stub behaves like the real thing.
   */
  it.each([
    ["a rate limit", { status: 429, error: {} }, "retryable", /rate limited/],
    ["an outage", { status: 529, error: {} }, "retryable", /unavailable/],
    ["a bad key", { status: 401, error: { error: { message: "invalid x-api-key" } } }, "terminal", /that API key is not valid/],
    ["an unknown model", { status: 404, error: {} }, "terminal", /check EXTRACTION_MODEL/],
    ["a dropped connection", { message: "fetch failed" }, "retryable", /could not reach the API/],
    [
      "a timeout",
      { name: "APIConnectionTimeoutError", message: "Request timed out." },
      "retryable",
      /did not finish this block/,
    ],
  ] as const)("classifies %s with its kind and message", async (_label, thrown, kind, message) => {
    const r = createAnthropicProvider({ client: failing(thrown) }).extractBlock(request());
    await expect(r).rejects.toThrow(ExtractionError);
    await expect(r).rejects.toMatchObject({ kind });
    await expect(r).rejects.toThrow(message);
  });

  /**
   * KTD9. The SDK validates the model's answer against the block schema inside
   * the awaited call, so a violation throws with no HTTP status — and the
   * catch-all used to read "no status" as "could not reach the API". A PM told
   * the network failed would check the network; the actual problem is the
   * model's filing, and the remedy is a re-run.
   */
  it("classifies a thrown schema violation as filing, not a network failure", async () => {
    const zodViolation = z
      .object({ observations: z.array(z.object({ quote: z.string() })) })
      .safeParse({ observations: [{}] });
    expect(zodViolation.success).toBe(false);
    const thrown = (zodViolation as { error?: unknown }).error;

    const r = createAnthropicProvider({ client: failing(thrown) }).extractBlock(request());
    await expect(r).rejects.toMatchObject({ kind: "filing" });
    const message = await r.then(
      () => "",
      (e: Error) => e.message,
    );
    expect(message).not.toMatch(/reach the API/);
    expect(message).not.toMatch(/network/i);
    expect(message).toMatch(/did not (match|fit)/);
  });
});

describe("thinking config per model generation", () => {
  afterEach(() => vi.unstubAllEnvs());

  /**
   * Off by default, because with it on five of the six blocks on a real
   * forty-minute transcript did not finish inside the block timeout. `max_tokens`
   * caps thinking and output together, so on this task thinking competes with the
   * drafts for the same budget.
   */
  it.each([
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-sonnet-4-5",
  ])("asks %s not to think", (model) => {
    expect(thinkingConfigFor(model).thinking, model).toEqual({ type: "disabled" });
  });

  it("still sets an effort level on 4.6-and-later, which applies with thinking off", () => {
    for (const model of ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-sonnet-4-6"]) {
      expect(thinkingConfigFor(model), model).toEqual({
        thinking: { type: "disabled" },
        effort: "low",
      });
    }
  });

  /**
   * The case that made this function necessary, and the half of it that has
   * nothing to do with thinking: Haiku 4.5 rejects `effort` outright, so pasting
   * EXTRACTION_MODEL straight into the request would 400 rather than merely run
   * worse. It is also the model someone reaches for precisely to make this step
   * cheaper — which the timeouts now make tempting.
   */
  it.each(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-opus-4-1"])(
    "gives %s no effort level, whatever the thinking setting",
    (model) => {
      expect(thinkingConfigFor(model).effort).toBeUndefined();
      vi.stubEnv("EXTRACTION_THINKING", "on");
      expect(thinkingConfigFor(model).effort).toBeUndefined();
    },
  );

  /**
   * The bug this function was written to make impossible. Read on `effort`
   * rather than on `thinking`, because with thinking off by default both
   * generations return the same thinking shape — `effort` is what still
   * separates them, and it is the field that actually 400s.
   */
  it("does not read the 5 in a 4-5 id as the 5 series", () => {
    expect(thinkingConfigFor("claude-haiku-4-5").effort).toBeUndefined();
    expect(thinkingConfigFor("claude-opus-5").effort).toBe("low");

    vi.stubEnv("EXTRACTION_THINKING", "on");
    expect(thinkingConfigFor("claude-haiku-4-5").thinking).not.toEqual({ type: "adaptive" });
    expect(thinkingConfigFor("claude-opus-5").thinking).toEqual({ type: "adaptive" });
  });

  it("treats an unrecognised id as modern, the likelier direction", () => {
    expect(thinkingConfigFor("claude-something-new").effort).toBe("low");
  });

  it("lets EXTRACTION_EFFORT raise the level without a code change", () => {
    // The escape hatch for short transcripts that can afford more.
    vi.stubEnv("EXTRACTION_EFFORT", "high");
    expect(thinkingConfigFor("claude-sonnet-5").effort).toBe("high");
  });

  /** The other escape hatch: thinking back on, per generation, no code change. */
  it("lets EXTRACTION_THINKING put thinking back, in the shape each generation takes", () => {
    vi.stubEnv("EXTRACTION_THINKING", "on");
    expect(thinkingConfigFor("claude-sonnet-5").thinking).toEqual({ type: "adaptive" });
    expect(thinkingConfigFor("claude-haiku-4-5").thinking).toEqual({
      type: "enabled",
      budget_tokens: 4000,
    });
  });
});
