import { afterEach, describe, expect, it, vi } from "vitest";
import { RUBRICS } from "@/framework";
import type * as z from "zod";
import { geminiResponseJsonSchemaFor, outputSchemaFor } from "../schema";
import { ExtractionError, type ExtractionBlockRequest } from "../types";
import {
  createGeminiProvider,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_TEMPERATURE,
  MAX_OUTPUT_TOKENS,
  type GeminiExtractionClient,
} from "./gemini";

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
    timeoutMs: 40_000,
    ...over,
  };
}

/**
 * The response shape Gemini answers with: HTTP 200, a promptFeedback, a
 * candidate list, and — the whole hazard of this adapter — no exception on a
 * block. The stub answers every call with one such envelope and records the
 * request, the same seam the Anthropic stub offers.
 */
function stub(response: Record<string, unknown>): {
  client: GeminiExtractionClient;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      models: {
        generateContent: async (params: Record<string, unknown>) => {
          calls.push(params);
          return response;
        },
      },
    },
  };
}

/** A clean STOP envelope carrying `payload` as the generated JSON text. */
function cleanStop(payload: unknown): Record<string, unknown> {
  return {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }],
    text: JSON.stringify(payload),
  };
}

const failing = (thrown: unknown): GeminiExtractionClient => ({
  models: {
    generateContent: async () => {
      throw thrown;
    },
  },
});

/** Every key present anywhere in a schema object, recursively. */
function allKeys(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) allKeys(item, found);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      found.add(key);
      allKeys(value, found);
    }
  }
  return found;
}

/**
 * KTD5, the plan's load-bearing case, written before the guard existed and
 * red against a parse-first adapter. Gemini reports a blocked prompt as HTTP
 * 200 with empty content and no exception — mapped naively, that is an empty
 * *successful* block, which `succeededBlocks` then scopes a destructive
 * delete with: the prior run's rows for this block are removed and nothing is
 * written back. A blocked response must throw before any output is read.
 */
describe("the blocked-response guard (KTD5)", () => {
  it("throws terminal on a prompt-level block reason, and never returns output", async () => {
    const { client } = stub({
      promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
      candidates: [],
    });

    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(ExtractionError);
    await expect(r).rejects.toMatchObject({ kind: "terminal" });
    await expect(r).rejects.toThrow(/blocked/i);
  });

  it("throws even when a blocked response happens to carry parseable empty content", async () => {
    // The nastier variant: content that *would* validate. The guard must fire
    // on the block reason before the payload is ever considered.
    const { client } = stub({
      promptFeedback: { blockReason: "SAFETY" },
      ...cleanStop(EMPTY),
    });

    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toMatchObject({ kind: "terminal" });
  });
});

describe("finish reasons, checked before any output is read", () => {
  it.each([
    ["RECITATION", "terminal"],
    ["SPII", "terminal"],
  ] as const)("throws %s as %s", async (finishReason, kind) => {
    const { client } = stub({
      candidates: [{ finishReason, content: { parts: [] } }],
    });
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(ExtractionError);
    await expect(r).rejects.toMatchObject({ kind });
  });

  /**
   * The truncation case, with the Gemini-specific trap spelled out: on
   * Gemini 3 the output cap covers thinking and output together, and
   * structured output comes back null rather than as partial JSON — so
   * truncation must be read from the finish reason. Here the payload even
   * parses, and must still be refused.
   */
  it("throws MAX_TOKENS as retryable even when the payload parses", async () => {
    const { client } = stub({
      candidates: [
        { finishReason: "MAX_TOKENS", content: { parts: [{ text: JSON.stringify(EMPTY) }] } },
      ],
      text: JSON.stringify(EMPTY),
    });
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toMatchObject({ kind: "retryable" });
    await expect(r).rejects.toThrow(/truncat/i);
  });

  it("throws MALFORMED_RESPONSE as retryable", async () => {
    const { client } = stub({
      candidates: [{ finishReason: "MALFORMED_RESPONSE" }],
    });
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toMatchObject({ kind: "retryable" });
  });

  it("throws a safety-class non-STOP finish as terminal", async () => {
    const { client } = stub({
      candidates: [{ finishReason: "PROHIBITED_CONTENT" }],
    });
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toMatchObject({ kind: "terminal" });
  });

  it("throws an unrecognised non-STOP finish as retryable, not as a read", async () => {
    const { client } = stub({
      candidates: [{ finishReason: "SOME_FUTURE_REASON" }],
    });
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(ExtractionError);
    await expect(r).rejects.toMatchObject({ kind: "retryable" });
  });

  it("throws a response with no candidates at all as retryable", async () => {
    const { client } = stub({ candidates: [] });
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toMatchObject({ kind: "retryable" });
  });
});

describe("a clean finish", () => {
  it("returns a validated empty observations array as a read, not a failure", async () => {
    const { client } = stub(cleanStop(EMPTY));
    const out = await createGeminiProvider({ client }).extractBlock(request());
    // "Read it and there was nothing there" is an answer; only the caller can
    // decide what an empty block means.
    expect(out).toEqual({ observations: [], claims: [] });
  });

  it("returns a populated block that fits the schema", async () => {
    const payload: BlockOutput = {
      observations: [
        {
          quote: "we built the first version ourselves",
          speaker: "Founder",
          timestamp: null,
          subDimensionKey: BLOCK.subs[0].key,
          confidence: "high",
          mappingNote: "direct evidence of building",
        },
      ],
      claims: [],
    };
    const { client } = stub(cleanStop(payload));
    const out = await createGeminiProvider({ client }).extractBlock(request());
    expect(out).toEqual(payload);
  });

  it("fails a sub-dimension key outside the block's rows as filing (KTD9)", async () => {
    const foreign = {
      observations: [
        {
          quote: "a real quote",
          speaker: null,
          timestamp: null,
          subDimensionKey: "not-a-row-of-this-block",
          confidence: "high",
          mappingNote: "filed against a row this block does not have",
        },
      ],
      claims: [],
    };
    const { client } = stub(cleanStop(foreign));
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toThrow(ExtractionError);
    await expect(r).rejects.toMatchObject({ kind: "filing" });
  });

  it("throws unparseable JSON on a clean stop as retryable", async () => {
    const { client } = stub({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json {" }] } }],
      text: "not json {",
    });
    const r = createGeminiProvider({ client }).extractBlock(request());
    await expect(r).rejects.toMatchObject({ kind: "retryable" });
  });
});

describe("the request build", () => {
  afterEach(() => vi.unstubAllEnvs());

  function configOf(calls: Record<string, unknown>[]): Record<string, unknown> {
    return calls[0].config as Record<string, unknown>;
  }

  /**
   * A ceiling on the answer is a ceiling on how long producing it takes, which
   * is the binding constraint on a 60-second function. This side shipped with
   * no cap while the Anthropic adapter had one from the start, so a block that
   * enumerated generated until the deadline cut it off and returned nothing.
   */
  /**
   * Greedy decoding has no escape from a repetition loop, and constrained
   * decoding against an array schema is where that bites: a real run had every
   * block generating filings until the clock stopped it, all six landing within
   * four hundred milliseconds of each other. Zero is what made the loop
   * inescapable, so zero is what must not be the default.
   */
  it("does not decode greedily by default", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request());

    expect(configOf(calls).temperature).toBe(DEFAULT_TEMPERATURE);
    expect(configOf(calls).temperature).toBeGreaterThan(0);
    // Still near-reproducible, which is what the zero was protecting, and
    // inside the admin cap (KTD13) rather than a knob beside it.
    expect(configOf(calls).temperature as number).toBeLessThanOrEqual(0.4);
  });

  it("still sends a tuned temperature ahead of the default", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request({ temperature: 0 }));
    // An explicit zero is an admin's choice and must survive — the default
    // applies only where nobody has tuned one.
    expect(configOf(calls).temperature).toBe(0);
  });

  it("caps the output, so a block cannot generate until the deadline", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request());

    expect(configOf(calls).maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it("sends structured output as responseJsonSchema with a real enum, closed objects, and no $schema", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request());

    const config = configOf(calls);
    expect(config.responseMimeType).toBe("application/json");
    const schema = config.responseJsonSchema as Record<string, unknown>;
    expect(schema).toEqual(geminiResponseJsonSchemaFor(BLOCK));

    /**
     * Both arrays are bounded. Constrained decoding satisfies this schema token
     * by token, so with no maxItems "another observation" stays a legal next
     * token forever and nothing ever requires the array to close — which is how
     * six blocks all ran to the clock within four hundred milliseconds of each
     * other, one of them reporting MAX_TOKENS. The bound is the stopping
     * condition the grammar was missing.
     */
    const props = schema.properties as Record<string, Record<string, unknown>>;
    for (const key of ["observations", "claims"]) {
      expect(props[key].maxItems, key).toBe(BLOCK.subs.length * 4);
    }
    // Generous against an honest answer: a full block runs nearer ten filings
    // than twenty-eight, so the cap binds on a loop and never on a real read.
    expect(props.observations.maxItems as number).toBeGreaterThan(BLOCK.subs.length);

    const observation = (
      (schema.properties as Record<string, Record<string, unknown>>).observations
        .items as Record<string, unknown>
    );
    const fields = observation.properties as Record<string, Record<string, unknown>>;
    // A real enum of this block's rows — cross-filing structurally impossible.
    expect(fields.subDimensionKey.enum).toEqual(BLOCK.subs.map((s) => s.key));
    expect(observation.additionalProperties).toBe(false);
    // `$schema` anywhere in the payload is a 400 on the deprecated field and a
    // leak on this one; it must not appear at any depth.
    expect(allKeys(schema).has("$schema")).toBe(false);
  });

  it("orders the quote before the confidence (generation order, not display order)", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request());

    const schema = configOf(calls).responseJsonSchema as Record<string, unknown>;
    const observation = (
      (schema.properties as Record<string, Record<string, unknown>>).observations
        .items as Record<string, unknown>
    );
    const ordering = observation.propertyOrdering as string[];
    expect(ordering.indexOf("quote")).toBeGreaterThanOrEqual(0);
    expect(ordering.indexOf("quote")).toBeLessThan(ordering.indexOf("confidence"));
  });

  it("requires the mapping note on every observation", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request());

    const schema = configOf(calls).responseJsonSchema as Record<string, unknown>;
    const observation = (
      (schema.properties as Record<string, Record<string, unknown>>).observations
        .items as Record<string, unknown>
    );
    expect(observation.required).toContain("mappingNote");
  });

  it("gives a 2.5 model a zero thinking budget and no thinking level", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client, model: "gemini-2.5-flash-lite" }).extractBlock(request());

    // thinkingLevel on a 2.5 model is an error, not ignored — the two knobs
    // must never travel together.
    expect(configOf(calls).thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("gives a 3.x model a minimal thinking level and no budget", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client, model: "gemini-3-flash" }).extractBlock(request());

    // The 3.x family cannot reach zero; MINIMAL is its floor.
    expect(configOf(calls).thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
  });

  it("turns all four harm categories off and sends no model-armour config", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request());

    const config = configOf(calls);
    // Transcripts name real founders and discuss financials; a default
    // threshold blocks exactly the calls this app exists to read.
    expect(config.safetySettings).toEqual([
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
    ]);
    // Deprecated, and mutually exclusive with safetySettings respectively —
    // neither may appear.
    const categories = (config.safetySettings as { category: string }[]).map((s) => s.category);
    expect(categories).not.toContain("HARM_CATEGORY_CIVIC_INTEGRITY");
    expect("modelArmorConfig" in config).toBe(false);
  });

  it("carries the port's time bound as the per-request timeout", async () => {
    const { client, calls } = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client }).extractBlock(request({ timeoutMs: 12_345 }));

    expect(configOf(calls).httpOptions).toEqual({ timeout: 12_345 });
  });

  it("passes a supplied temperature through, and sends the default when none is", async () => {
    const tuned = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client: tuned.client }).extractBlock(
      request({ temperature: 0.4 }),
    );
    expect((tuned.calls[0].config as Record<string, unknown>).temperature).toBe(0.4);

    const plain = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client: plain.client }).extractBlock(request());
    // Explicit, never the provider's own — but no longer zero. Greedy decoding
    // is what let a block generate filings until the clock stopped it; see
    // "does not decode greedily by default" above.
    expect((plain.calls[0].config as Record<string, unknown>).temperature).toBe(
      DEFAULT_TEMPERATURE,
    );
  });

  it("defaults the model but honours EXTRACTION_MODEL", async () => {
    const first = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client: first.client }).extractBlock(request());
    expect(first.calls[0].model).toBe(DEFAULT_GEMINI_MODEL);

    vi.stubEnv("EXTRACTION_MODEL", "gemini-3-flash");
    const second = stub(cleanStop(EMPTY));
    await createGeminiProvider({ client: second.client }).extractBlock(request());
    expect(second.calls[0].model).toBe("gemini-3-flash");
  });

  it("warns when thinking silently returned, reading the thoughts token canary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = stub({
      ...cleanStop(EMPTY),
      usageMetadata: { thoughtsTokenCount: 512 },
    });
    await createGeminiProvider({ client }).extractBlock(request());
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/thinking|thought/i));
    warn.mockRestore();
  });
});

describe("credentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  // The suite runs with both credentials deliberately unset (vitest.config.ts),
  // so with no client injected, resolution is the factory's first act.
  it("names both credential variables when neither is configured", () => {
    expect(() => createGeminiProvider()).toThrow(/GOOGLE_API_KEY/);
    expect(() => createGeminiProvider()).toThrow(/GEMINI_API_KEY/);
    try {
      createGeminiProvider();
    } catch (e) {
      expect((e as ExtractionError).kind).toBe("terminal");
    }
  });

  it("accepts either credential name", () => {
    vi.stubEnv("GOOGLE_API_KEY", "test-google-key");
    expect(() => createGeminiProvider()).not.toThrow();
    vi.unstubAllEnvs();

    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    expect(() => createGeminiProvider()).not.toThrow();
  });

  it("refuses the Vertex path with a message naming it, rather than half-supporting it", () => {
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
    expect(() => createGeminiProvider()).toThrow(/vertex/i);
  });
});

describe("SDK failures, classified onto the taxonomy", () => {
  it.each([
    ["a rate limit", { status: 429, message: "quota" }, "retryable"],
    ["an outage", { status: 503, message: "overloaded" }, "retryable"],
    ["a bad key", { status: 400, message: "API key not valid" }, "terminal"],
    ["a dropped connection", { message: "fetch failed" }, "retryable"],
    [
      "a timeout",
      { name: "AbortError", message: "This operation was aborted" },
      "retryable",
    ],
  ] as const)("classifies %s as %s", async (_label, thrown, kind) => {
    const r = createGeminiProvider({ client: failing(thrown) }).extractBlock(request());
    await expect(r).rejects.toThrow(ExtractionError);
    await expect(r).rejects.toMatchObject({ kind });
  });

  /**
   * The failure a real deployment actually hit, and the one most likely to be
   * read wrong. The SDK sends `httpOptions.timeout` on as an `X-Server-Timeout`
   * header, so Google enforces this deployment's own block bound and answers
   * 504 DEADLINE_EXCEEDED. Rendered as an outage it tells the operator the API
   * is down and offers no lever; rendered as the timeout it is, it names the
   * bound and points at the model.
   */
  it("reads a 504 as this deployment's own bound, not as an outage", async () => {
    const thrown = {
      status: 504,
      message: '{"error":{"code":504,"message":"The request timed out.","status":"DEADLINE_EXCEEDED"}}',
    };
    const r = createGeminiProvider({ client: failing(thrown) }).extractBlock(request());

    const message = await r.then(
      () => "",
      (e: Error) => e.message,
    );
    expect(message).toMatch(/did not finish this block within \d+ seconds/);
    expect(message).toMatch(/EXTRACTION_MODEL/);
    // It must not read as a fault on Google's side, which is what sends an
    // operator to check a status page instead of the one setting that moves.
    expect(message).not.toMatch(/returned 504/);
  });
});
