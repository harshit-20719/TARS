import { describe, expect, it, vi } from "vitest";
import {
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
  DraftObservationSchema,
  ExtractionOutputSchema,
  type ExtractionOutput,
} from "./schema";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompt";

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

function stub(
  result: ExtractionOutput | null,
  extra: Record<string, unknown> = {},
): { client: ExtractionClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      messages: {
        parse: async (params) => {
          calls.push(params);
          return { parsed_output: result, stop_reason: "end_turn", ...extra };
        },
      },
    },
  };
}

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
  const good = {
    quote: "We spent four years inside mid-market bank operations.",
    rubricKey: "ft",
    subDimensionKey: "earned-insight",
    speaker: "Aparna",
    timestamp: "00:02",
  };
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
          { text: "Four years of operator experience.", anchorQuote: paraphrased.quote, originTag: "founder-volunteered" },
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
          { text: "Four years of operator experience.", anchorQuote: good.quote, originTag: "founder-volunteered" },
        ],
      }),
    );
    expect(r.claims).toHaveLength(1);
    expect(r.droppedClaims).toEqual([]);
  });
});

describe("extractFromTranscript", () => {
  it("sends the generated system prompt and the transcript", async () => {
    const { client, calls } = stub(output());
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client });

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(JSON.stringify(calls[0].messages)).toContain("mid-market bank operations");
  });

  it("keeps thinking on at medium effort", async () => {
    const { client, calls } = stub(output());
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client });
    expect(calls[0].thinking).toEqual({ type: "adaptive" });
    expect((calls[0].output_config as { effort: string }).effort).toBe("medium");
  });

  it("defaults the model but honours EXTRACTION_MODEL", async () => {
    const { client, calls } = stub(output());
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client });
    expect(calls[0].model).toBe(DEFAULT_EXTRACTION_MODEL);

    vi.stubEnv("EXTRACTION_MODEL", "claude-sonnet-5");
    const second = stub(output());
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client: second.client });
    expect(second.calls[0].model).toBe("claude-sonnet-5");
    vi.unstubAllEnvs();
  });

  it("surfaces a refusal instead of reading empty content as a result", async () => {
    const { client } = stub(null, { stop_reason: "refusal", stop_details: { category: "cyber" } });
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client }),
    ).rejects.toThrow(/declined/);
  });

  it("throws when the model returns nothing parseable", async () => {
    const { client } = stub(null);
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client }),
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
      output({
        observations: [
          { quote: "q", rubricKey: "ft", subDimensionKey: "invented-row", speaker: null, timestamp: null },
        ],
      }),
    );
    expect(bad.success).toBe(false);
  });

  it("accepts a real sub-dimension key", () => {
    const good = ExtractionOutputSchema.safeParse(
      output({
        observations: [
          { quote: "q", rubricKey: "ft", subDimensionKey: "earned-insight", speaker: null, timestamp: null },
        ],
      }),
    );
    expect(good.success).toBe(true);
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
      ...Object.keys(DraftObservationSchema.shape),
      ...Object.keys(DraftClaimSchema.shape),
    ];
    for (const f of fields) {
      expect(f).not.toMatch(/score|rating|value|rank|grade/i);
    }
    // And nothing numeric anywhere — every leaf is a string or an enum of
    // strings, so there is no field a number could be written into at all.
    expect(JSON.stringify(ExtractionOutputSchema.shape)).not.toMatch(/"type":"(number|int)"/);
  });
});

describe("thinking config per model generation", () => {
  it("asks 4.6-and-later models for adaptive thinking at an effort level", () => {
    for (const model of ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-sonnet-4-6"]) {
      expect(thinkingConfigFor(model), model).toEqual({
        thinking: { type: "adaptive" },
        effort: "medium",
      });
    }
  });

  /**
   * The case that made this function necessary. Haiku 4.5 rejects `effort`
   * outright and does not accept adaptive thinking — so pasting EXTRACTION_MODEL
   * straight into the request would 400, not merely run worse. It is also the
   * model someone reaches for precisely to make this step cheaper.
   */
  it.each(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-opus-4-1"])(
    "gives %s a fixed budget and no effort level",
    (model) => {
      const config = thinkingConfigFor(model);
      expect(config).toEqual({ thinking: { type: "enabled", budget_tokens: 4000 } });
      expect(config.effort).toBeUndefined();
    },
  );

  it("does not read the 5 in a 4-5 id as the 5 series", () => {
    // The bug this function was written to make impossible.
    expect(thinkingConfigFor("claude-haiku-4-5").thinking).not.toEqual({ type: "adaptive" });
    expect(thinkingConfigFor("claude-opus-5").thinking).toEqual({ type: "adaptive" });
  });

  it("treats an unrecognised id as modern, the likelier direction", () => {
    expect(thinkingConfigFor("claude-something-new").effort).toBe("medium");
  });

  it("keeps the pre-4.6 budget below max_tokens, which the API requires", () => {
    const budget = (thinkingConfigFor("claude-haiku-4-5").thinking as { budget_tokens: number })
      .budget_tokens;
    expect(budget).toBeLessThan(16000);
  });

  it("sends what the model generation accepts, end to end", async () => {
    const seen: Record<string, unknown>[] = [];
    const client: ExtractionClient = {
      messages: {
        parse: async (params) => {
          seen.push(params);
          return { parsed_output: { observations: [], claims: [] }, stop_reason: "end_turn" };
        },
      },
    };
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client, model: "claude-haiku-4-5" });
    await extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client, model: "claude-opus-5" });

    const [haiku, opus] = seen;
    expect(haiku.thinking).toEqual({ type: "enabled", budget_tokens: 4000 });
    expect((haiku.output_config as Record<string, unknown>).effort).toBeUndefined();
    expect(opus.thinking).toEqual({ type: "adaptive" });
    expect((opus.output_config as Record<string, unknown>).effort).toBe("medium");
    // The schema travels either way — the authorship rule is not model-dependent.
    for (const params of seen) {
      expect((params.output_config as Record<string, unknown>).format).toBeTruthy();
    }
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
  ];

  it.each(cases)("reports %s as an ExtractionError", async (_label, thrown, expected) => {
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client: failing(thrown) }),
    ).rejects.toThrow(ExtractionError);
    await expect(
      extractFromTranscript({ transcript: TRANSCRIPT, callNumber: 1 }, { client: failing(thrown) }),
    ).rejects.toThrow(expected);
  });

  it("never puts the key in the message", () => {
    // The API's own text is passed through, so this asserts the shape it can take.
    const message = describeApiFailure({
      status: 401,
      error: { error: { message: "invalid x-api-key" } },
    });
    expect(message).not.toMatch(/sk-ant/);
  });

  it("says the transcript survived on the retryable failures", () => {
    // A PM who just pasted 40 minutes of transcript needs to know it is not lost.
    for (const status of [429, 500, 529]) {
      expect(describeApiFailure({ status, error: {} }), String(status)).toMatch(/saved/);
    }
  });

  it("passes the request id through where the API gives one", () => {
    expect(describeApiFailure({ status: 400, requestID: "req_abc", error: {} })).toContain("req_abc");
  });
});
