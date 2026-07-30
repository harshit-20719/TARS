import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import {
  BLOCK_TIMEOUT_MS,
  DEFAULT_EXTRACTION_MODEL,
  ExtractionError,
  extractFromTranscript,
  isVerbatim,
  normaliseForComparison,
  describeApiFailure,
  thinkingConfigFor,
  verifyDrafts,
  type ExtractionClient,
} from "./extract";
import {
  DraftClaimSchema,
  ExtractionOutputSchema,
  outputSchemaFor,
  type ExtractionOutput,
} from "./schema";
import { systemPromptFor } from "./prompt";
import { RUBRICS } from "@/framework";

const TRANSCRIPT = `[00:02] Aparna: We spent four years inside mid-market bank operations.
The reconciliation break that actually costs them happens at settlement cutover.
[00:05] Daniel: The ledger engine reconciles the streaming feed and the batch
file in a single pass.
[00:09] Aparna: Two of the banks we worked with have already told us they'll run a paid pilot.`;

const output = (o: Partial<ExtractionOutput> = {}): ExtractionOutput => ({
  observations: [],
  claims: [],
  ...o,
});

/** Fills in the fields every drafted observation now carries. */
const obs = (o: Partial<ExtractionOutput["observations"][number]>) => ({
  quote: "q",
  rubricKey: "ft",
  subDimensionKey: "earned-insight",
  speaker: null,
  timestamp: null,
  confidence: "high" as const,
  mappingNote: "why this row",
  ...o,
});

/**
 * Extraction fans out one call per macro-dimension, so tests that care about a
 * single request pass `blocks: [ONE_BLOCK]`. Where a test is about the fan-out
 * itself it uses the real RUBRICS.
 */
const ONE_BLOCK = RUBRICS[0];

/**
 * `opts` is recorded alongside `calls` because the request options are where the
 * run's time budget lives, and nothing used to look at them — which is how a
 * bound that did not hold stayed shipped. See "the time budget" below.
 */
function stub(
  result: ExtractionOutput | null,
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

/**
 * The run has to finish inside one serverless function call, and these two
 * numbers are the whole of what holds it there.
 */
describe("the time budget", () => {
  it("bounds each block's wait", async () => {
    const { client, opts } = stub({ observations: [], claims: [] });
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client, blocks: [ONE_BLOCK] });

    expect(opts[0]?.timeout).toBe(BLOCK_TIMEOUT_MS);
  });

  /**
   * The load-bearing one, and the reason the block above is not enough on its
   * own. The SDK retries twice by default and a timeout is one of the things it
   * retries, so a timeout alone bounds an attempt at thirty seconds and a block
   * at ninety — past the sixty-second ceiling the whole design is sized against.
   * When that happened the function was killed rather than returning, so no
   * error object reached anyone and the browser showed "an unexpected response
   * was received from the server" with nothing behind it.
   */
  it("disables the SDK's retries, so the wait is the block's and not one attempt's", async () => {
    const { client, opts } = stub({ observations: [], claims: [] });
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client, blocks: [ONE_BLOCK] });

    expect(opts[0]?.maxRetries).toBe(0);
  });

  it("bounds every block in the fan-out, not just the first", async () => {
    const { client, opts } = stub({ observations: [], claims: [] });
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client });

    expect(opts).toHaveLength(RUBRICS.length);
    for (const o of opts) {
      expect(o?.timeout).toBe(BLOCK_TIMEOUT_MS);
      expect(o?.maxRetries).toBe(0);
    }
  });
});

describe("the verbatim guard", () => {
  it("accepts a quote that is present", () => {
    expect(isVerbatim(TRANSCRIPT, "We spent four years inside mid-market bank operations.")).toBe(true);
  });

  it("accepts a quote the transcript wrapped across lines", () => {
    // Line wrapping is the transcript's formatting, not a change of words.
    expect(
      isVerbatim(TRANSCRIPT, "The ledger engine reconciles the streaming feed and the batch file in a single pass."),
    ).toBe(true);
  });

  it("accepts curly punctuation where the source had straight", () => {
    expect(isVerbatim("they said they'll run a pilot", "they said they’ll run a pilot")).toBe(true);
  });

  it("rejects a paraphrase, however plausible", () => {
    // This is the failure mode that matters: a tidied quote reads perfectly and
    // is not what the founder said.
    expect(isVerbatim(TRANSCRIPT, "We spent four years working in bank operations.")).toBe(false);
  });

  it("rejects an invented quote", () => {
    expect(isVerbatim(TRANSCRIPT, "We have twelve signed enterprise contracts.")).toBe(false);
  });

  it("rejects an empty quote", () => {
    expect(isVerbatim(TRANSCRIPT, "   ")).toBe(false);
  });

  it("does not fold case", () => {
    expect(isVerbatim(TRANSCRIPT, "we spent FOUR years inside mid-market bank operations.")).toBe(false);
  });

  it("normalises whitespace and dashes for comparison only", () => {
    expect(normaliseForComparison("a  b\n\tc — d")).toBe("a b c - d");
  });
});

describe("verifyDrafts", () => {
  const good = obs({
    quote: "We spent four years inside mid-market bank operations.",
    speaker: "Aparna",
    timestamp: "00:02",
  });
  const paraphrased = { ...good, quote: "We spent four years working in banks." };

  it("keeps verbatim observations and drops paraphrased ones", () => {
    const r = verifyDrafts(TRANSCRIPT, output({ observations: [good, paraphrased] }));
    expect(r.observations).toHaveLength(1);
    expect(r.droppedQuotes).toEqual([paraphrased.quote]);
  });

  it("drops a claim whose anchor did not survive", () => {
    // A claim with no surviving quote would be a free-floating assertion in the
    // ledger with nothing supporting it.
    const r = verifyDrafts(
      TRANSCRIPT,
      output({
        observations: [paraphrased],
        claims: [
          { text: "Four years of operator experience.", anchorQuote: paraphrased.quote, originTag: "founder-volunteered", rubricKey: "ft" },
        ],
      }),
    );
    expect(r.observations).toEqual([]);
    expect(r.claims).toEqual([]);
    expect(r.droppedClaims).toEqual(["Four years of operator experience."]);
  });

  it("keeps a claim anchored to a surviving quote", () => {
    const r = verifyDrafts(
      TRANSCRIPT,
      output({
        observations: [good],
        claims: [
          { text: "Four years of operator experience.", anchorQuote: good.quote, originTag: "founder-volunteered", rubricKey: "ft" },
        ],
      }),
    );
    expect(r.claims).toHaveLength(1);
    expect(r.droppedClaims).toEqual([]);
  });
});

describe("extractFromTranscript", () => {
  it("sends the block's own system prompt and the transcript", async () => {
    const { client, calls } = stub(output());
    await extractFromTranscript(
      { transcript: TRANSCRIPT, callNumber: 1 },
      { client, blocks: [ONE_BLOCK] },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(systemPromptFor(ONE_BLOCK));
    expect(JSON.stringify(calls[0].messages)).toContain("mid-market bank operations");
  });

  /**
   * KTD7. The request names the block it reads, so a stub routes on the key
   * rather than reverse-engineering the block out of a generated prompt string
   * — prompt-matching is exactly the coupling that made every prompt edit a
   * test edit, with a silent-wrong fallback when the match failed.
   */
  it("carries the rubric key on each block's request", async () => {
    const { client, calls } = stub(output());
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client });

    expect(calls.map((c) => c.rubricKey).sort()).toEqual(RUBRICS.map((r) => r.key).sort());
  });

  /**
   * The other half of KTD7: a routed stub that is asked for a block it does not
   * know must throw, and the failure must read as a routing failure. The old
   * stubs answered the unmatched case with a default payload, so a routing
   * mistake surfaced as a dozen wrong counts instead of one named error.
   */
  it("a stub asked for an unexpected rubric key fails as a routing error, not a default answer", async () => {
    const routedOnlyToFirst: ExtractionClient = {
      messages: {
        parse: async (params) => {
          if (params.rubricKey !== RUBRICS[0].key) {
            throw new Error(`stub asked for an unrouted rubric key: ${String(params.rubricKey)}`);
          }
          return { parsed_output: output(), stop_reason: "end_turn" };
        },
      },
    };

    const r = await extractFromTranscript(
      { transcript: TRANSCRIPT, callNumber: 1 },
      { client: routedOnlyToFirst, blocks: [RUBRICS[0], RUBRICS[1]] },
    );
    expect(r.succeededBlocks).toEqual([RUBRICS[0].key]);
    expect(r.failedBlocks).toHaveLength(1);
    expect(r.failedBlocks[0].rubricKey).toBe(RUBRICS[1].key);
    expect(r.failedBlocks[0].reason).toMatch(/unrouted rubric key/);
  });

  /**
   * The fan-out is the fix for both symptoms the first version had — too few
   * observations and too slow. One call per macro-dimension, each reading the whole
   * transcript against six or seven rows.
   */
  it("runs one call per macro-dimension and merges the results", async () => {
    const calls: Record<string, unknown>[] = [];
    const client: ExtractionClient = {
      messages: {
        parse: async (params) => {
          calls.push(params);
          // Each block returns one observation, keyed to a row it actually owns.
          // Routed on the rubric key the request carries (KTD7), and a request
          // this stub does not recognise throws rather than answering with a
          // default — a routing mistake must fail as one.
          const rubric = RUBRICS.find((r) => r.key === params.rubricKey);
          if (!rubric) {
            throw new Error(`stub asked for an unrouted rubric key: ${String(params.rubricKey)}`);
          }
          return {
            parsed_output: {
              observations: [
                {
                  quote: "We spent four years inside mid-market bank operations.",
                  subDimensionKey: rubric.subs[0].key,
                  speaker: null,
                  timestamp: null,
                  confidence: "high" as const,
                  mappingNote: "n",
                },
              ],
              claims: [],
            },
            stop_reason: "end_turn",
          };
        },
      },
    };

    const r = await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client });

    expect(calls).toHaveLength(RUBRICS.length);
    expect(r.observations).toHaveLength(RUBRICS.length);
    expect(r.failedBlocks).toEqual([]);
    // The rubricKey comes from which call it was, never from the model.
    expect(r.observations.map((o) => o.rubricKey).sort()).toEqual(RUBRICS.map((x) => x.key).sort());
  });

  /**
   * A partial run is worth keeping: five blocks of real evidence beats none, and
   * the tokens were already spent. What must not happen is the failure being
   * invisible — a thin result would otherwise look like a quiet transcript.
   */
  it("keeps the blocks that succeeded when one fails, and names the one that did not", async () => {
    const failing = RUBRICS[2];
    const client: ExtractionClient = {
      messages: {
        parse: async (params) => {
          if (params.rubricKey === failing.key) {
            throw Object.assign(new Error("boom"), { status: 429 });
          }
          return { parsed_output: output(), stop_reason: "end_turn" };
        },
      },
    };

    const r = await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client });
    expect(r.failedBlocks).toHaveLength(1);
    expect(r.failedBlocks[0].rubricKey).toBe(failing.key);
    expect(r.failedBlocks[0].reason).toMatch(/rate limited/);
  });

  it("throws when every block fails, rather than reporting an empty success", async () => {
    const client: ExtractionClient = {
      messages: {
        parse: async () => {
          throw Object.assign(new Error("nope"), { status: 401 });
        },
      },
    };
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY is not valid/);
  });

  /**
   * Renamed rather than deleted: it used to assert thinking stayed on, and the
   * latency budget is exactly why that changed. `max_tokens` caps thinking and
   * output together, so on a long transcript the thinking was competing with the
   * drafts — and five of six blocks missed the deadline.
   */
  it("turns thinking off, at the effort the latency budget allows", async () => {
    const { client, calls } = stub(output());
    await extractFromTranscript(
      { transcript: TRANSCRIPT, callNumber: 1 },
      { client, blocks: [ONE_BLOCK] },
    );
    expect(calls[0].thinking).toEqual({ type: "disabled" });
    expect((calls[0].output_config as { effort: string }).effort).toBe("low");
  });

  it("defaults the model but honours EXTRACTION_MODEL", async () => {
    const { client, calls } = stub(output());
    await extractFromTranscript(
      { transcript: TRANSCRIPT, callNumber: 1 },
      { client, blocks: [ONE_BLOCK] },
    );
    expect(calls[0].model).toBe(DEFAULT_EXTRACTION_MODEL);

    vi.stubEnv("EXTRACTION_MODEL", "claude-sonnet-5");
    const second = stub(output());
    await extractFromTranscript(
      { transcript: TRANSCRIPT, callNumber: 1 },
      { client: second.client, blocks: [ONE_BLOCK] },
    );
    expect(second.calls[0].model).toBe("claude-sonnet-5");
    vi.unstubAllEnvs();
  });

  it("surfaces a refusal instead of reading empty content as a result", async () => {
    const { client } = stub(null, { stop_reason: "refusal", stop_details: { category: "cyber" } });
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client, blocks: [ONE_BLOCK] }),
    ).rejects.toThrow(/declined/);
  });

  it("throws when the model returns nothing parseable", async () => {
    const { client } = stub(null);
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client, blocks: [ONE_BLOCK] }),
    ).rejects.toThrow(ExtractionError);
  });

  it("refuses an empty transcript before calling the model", async () => {
    const { client, calls } = stub(output());
    await expect(
      extractFromTranscript({ transcript: "   ", callNumber: 1 }, { client }),
    ).rejects.toThrow(ExtractionError);
    expect(calls).toHaveLength(0);
  });

  it("explains itself when no API key is configured", async () => {
    // The suite deliberately runs with ANTHROPIC_API_KEY unset.
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("the output schema", () => {
  it("constrains sub-dimension keys to the frozen rubric", () => {
    const bad = ExtractionOutputSchema.safeParse(
      output({ observations: [obs({ subDimensionKey: "invented-row" })] }),
    );
    expect(bad.success).toBe(false);
  });

  it("accepts a real sub-dimension key", () => {
    const good = ExtractionOutputSchema.safeParse(output({ observations: [obs({})] }));
    expect(good.success).toBe(true);
  });

  /**
   * The per-block schema is what makes cross-filing impossible rather than merely
   * discouraged: the enum offered to each call holds only that block's rows, so a
   * key from another block is a schema violation the SDK retries on.
   */
  it("narrows each block's schema to that block's own rows", () => {
    const founders = RUBRICS[0];
    const other = RUBRICS[1];
    const schema = outputSchemaFor(founders);

    const own = schema.safeParse({
      observations: [
        {
          quote: "q",
          subDimensionKey: founders.subs[0].key,
          speaker: null,
          timestamp: null,
          confidence: "high",
          mappingNote: "n",
        },
      ],
      claims: [],
    });
    expect(own.success).toBe(true);

    const foreign = schema.safeParse({
      observations: [
        {
          quote: "q",
          subDimensionKey: other.subs[0].key,
          speaker: null,
          timestamp: null,
          confidence: "high",
          mappingNote: "n",
        },
      ],
      claims: [],
    });
    expect(foreign.success).toBe(false);
  });

  it("has nowhere to put a score", () => {
    // The authorship rule, enforced by the shape of the contract rather than by
    // asking the model nicely.
    //
    // Asserted on the field names, not on the serialized schema: the enum of
    // sub-dimension keys legitimately contains "time-to-value", and a substring
    // match on the whole blob would read that rubric row as a place to put a
    // number.
    const fields = [
      ...Object.keys(ExtractionOutputSchema.shape),
      ...Object.keys(ExtractionOutputSchema.shape.observations.element.shape),
      ...Object.keys(outputSchemaFor(RUBRICS[0]).shape.observations.element.shape),
      ...Object.keys(DraftClaimSchema.shape),
    ];
    for (const f of fields) {
      expect(f).not.toMatch(/score|rating|value|rank|grade/i);
    }
    // And nothing numeric anywhere — every leaf is a string or an enum of
    // strings, so there is no field a number could be written into at all.
    expect(JSON.stringify(ExtractionOutputSchema.shape)).not.toMatch(/"type":"(number|int)"/);
  });

  /**
   * `confidence` is the one thing the model rates, and it must stay a rating of its
   * own filing. Keeping the vocabulary to high/low is part of that: a numeric or
   * strength-flavoured field here would be a score by another name.
   */
  it("offers only high and low confidence, so it cannot become a score", () => {
    const element = outputSchemaFor(RUBRICS[0]).shape.observations.element;
    expect(element.shape.confidence.options).toEqual(["high", "low"]);
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

  it("keeps the pre-4.6 budget below max_tokens, which the API requires", () => {
    vi.stubEnv("EXTRACTION_THINKING", "on");
    const budget = (thinkingConfigFor("claude-haiku-4-5").thinking as { budget_tokens: number })
      .budget_tokens;
    // max_tokens is sized for one block now, not for the whole rubric.
    expect(budget).toBeLessThan(8000);
  });

  it("sends what the model generation accepts, end to end", async () => {
    // One block each, so the assertions below read the request for the model named
    // rather than whichever of six concurrent calls happened to land first.
    const run = async (model: string) => {
      const { client, calls } = stub(output());
      await extractFromTranscript(
        { transcript: TRANSCRIPT, callNumber: 1 },
        { client, model, blocks: [ONE_BLOCK] },
      );
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
      const { client, calls } = stub(output());
      await extractFromTranscript(
        { transcript: TRANSCRIPT, callNumber: 1 },
        { client, model, blocks: [ONE_BLOCK] },
      );
      return calls[0];
    };

    expect((await run("claude-haiku-4-5")).thinking).toEqual({
      type: "enabled",
      budget_tokens: 4000,
    });
    expect((await run("claude-opus-5")).thinking).toEqual({ type: "adaptive" });
  });
});

describe("API failures are reported, not thrown past the action layer", () => {
  /**
   * lib/actions.ts converts typed domain errors into values and rethrows the
   * rest, so an error it does not recognise escapes the server action and React
   * renders the generic "an error occurred in the Server Components render" with
   * the message stripped. Every one of these used to land there — which meant the
   * failures a first real run actually hits produced the one error that says
   * nothing. They must all arrive as ExtractionError.
   */
  const failing = (thrown: unknown): ExtractionClient => ({
    messages: { parse: async () => { throw thrown; } },
  });

  const cases: [string, unknown, RegExp][] = [
    ["a bad key", { status: 401, error: { error: { message: "invalid x-api-key" } } }, /ANTHROPIC_API_KEY is not valid/],
    ["no credit", { status: 400, error: { error: { message: "Your credit balance is too low" } } }, /credit balance is too low/],
    ["an unknown model", { status: 404, error: { error: { message: "model: nope" } } }, /check EXTRACTION_MODEL/],
    ["a forbidden key", { status: 403, error: {} }, /not permitted/],
    ["too large a transcript", { status: 413, error: {} }, /too large/],
    ["a rate limit", { status: 429, error: {} }, /rate limited/],
    ["an outage", { status: 529, error: {} }, /unavailable/],
    ["a dropped connection", { message: "fetch failed" }, /could not reach the API/],
    /**
     * Detected by the shape a timed-out SDK call throws — read structurally, so
     * a stub throwing a plain object with the right name behaves like the real
     * class — and rendered from the "timeout" pseudo-status, never as a network
     * fault: the model was answering and ran out of time.
     */
    ["a timeout", { name: "APIConnectionTimeoutError", message: "Request timed out." }, /did not finish this block/],
  ];

  it.each(cases)("reports %s as an ExtractionError", async (_label, thrown, expected) => {
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client: failing(thrown) }),
    ).rejects.toThrow(ExtractionError);
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client: failing(thrown) }),
    ).rejects.toThrow(expected);
  });

  /**
   * KTD9. The SDK validates the model's answer against the block schema inside
   * the awaited call, so a violation throws with no HTTP status — and the
   * catch-all used to read "no status" as "could not reach the API". A PM told
   * the network failed would check the network; the actual problem is the
   * model's filing, and the remedy is a re-run.
   */
  it("reports a schema violation as a filing failure, not a network one", async () => {
    const zodViolation = z
      .object({ observations: z.array(z.object({ quote: z.string() })) })
      .safeParse({ observations: [{}] });
    expect(zodViolation.success).toBe(false);
    const thrown = (zodViolation as { error?: unknown }).error;

    const r = extractFromTranscript(
      { transcript: TRANSCRIPT, callNumber: 1 },
      { client: failing(thrown), blocks: [ONE_BLOCK] },
    );
    await expect(r).rejects.toThrow(ExtractionError);

    const message = await r.then(
      () => "",
      (e: Error) => e.message,
    );
    expect(message).not.toMatch(/reach the API/);
    expect(message).not.toMatch(/network/i);
    // It names the filing problem instead.
    expect(message).toMatch(/did not (match|fit)/);
  });

  /**
   * The two failures without an HTTP status become distinguishable from the
   * thrown error's kind, not by parsing the sentence (KTD5). End-to-end through
   * the fan-out, because the aggregate throw is what lib/actions.ts sees.
   */
  it("marks a rate limit retryable and a bad key terminal, without message-parsing", async () => {
    const kindOf = async (thrown: unknown) =>
      extractFromTranscript(
        { transcript: TRANSCRIPT, callNumber: 1 },
        { client: failing(thrown), blocks: [ONE_BLOCK] },
      ).then(
        () => "clean",
        (e: ExtractionError) => e.kind,
      );

    expect(await kindOf({ status: 429, error: {} })).toBe("retryable");
    expect(await kindOf({ status: 529, error: {} })).toBe("retryable");
    expect(await kindOf({ status: 401, error: {} })).toBe("terminal");
    expect(await kindOf({ status: 404, error: {} })).toBe("terminal");
    const zodViolation = z.object({ q: z.string() }).safeParse({});
    expect(await kindOf((zodViolation as { error?: unknown }).error)).toBe("filing");
  });

  /**
   * The neutral signature (mirroring describeFirefliesFailure): a status that
   * is a number, null, or a pseudo-status, so no provider's exception shape is
   * needed to render a failure. One readable sentence per case.
   */
  it("renders a readable message for every status shape", () => {
    expect(describeApiFailure(null)).toMatch(/could not reach the API/);
    expect(describeApiFailure("timeout")).toMatch(/did not finish this block within \d+ seconds/);
    expect(describeApiFailure(400)).toMatch(/rejected the request/);
    expect(describeApiFailure(401)).toMatch(/ANTHROPIC_API_KEY is not valid/);
    expect(describeApiFailure(429)).toMatch(/rate limited/);
    expect(describeApiFailure(500)).toMatch(/unavailable/);
    expect(describeApiFailure(529)).toMatch(/unavailable/);
  });

  it("never puts the key in the message", () => {
    // The API's own text is passed through, so this asserts the shape it can take.
    const message = describeApiFailure(401, ["invalid x-api-key"]);
    expect(message).not.toMatch(/sk-ant/);
  });

  it("says the transcript survived on the retryable failures", () => {
    // A PM who just pasted 40 minutes of transcript needs to know it is not lost.
    for (const status of [429, 500, 529]) {
      expect(describeApiFailure(status), String(status)).toMatch(/saved/);
    }
  });

  it("passes the request id through where the API gives one", () => {
    expect(describeApiFailure(400, [], "req_abc")).toContain("req_abc");
  });
});
