/**
 * The Gemini adapter: every Gemini-shaped request field lives here, and
 * nowhere else (KTD4).
 *
 * This module mirrors providers/anthropic.ts on purpose — a factory taking
 * injected dependencies, credential resolution in one function, the outcome
 * mapping in one place. What crosses back out is only the port from
 * lib/extraction/types: validated block output, or an ExtractionError whose
 * `kind` says what class of failure this was.
 *
 * The one thing this adapter must be paranoid about, and the Anthropic one
 * does not have to be (KTD5): Gemini reports a blocked request as HTTP 200
 * with empty content and no exception. Mapped naively that is an empty
 * *successful* block — and `succeededBlocks` scopes a destructive delete in
 * lib/services/capture.ts, so a re-run would remove the prior run's rows for
 * this block and write nothing back. Nothing here may read output until the
 * prompt-level block reason and the candidate's finish reason have both been
 * checked. A clean finish with an empty observations array IS a valid read.
 */

import "server-only";

import { GoogleGenAI } from "@google/genai";
import { rubricByKey } from "@/framework";
import { geminiResponseJsonSchemaFor } from "../schema";
import {
  ExtractionError,
  type ExtractionBlockRequest,
  type ExtractionProvider,
  type ExtractionFailureKind,
} from "../types";
import { describeApiFailure, type ApiFailureStatus } from "../extract";

/**
 * Default model, pinned exactly. Flash-Lite is the tier this task needs: the
 * machine quotes, files, and tags — it never judges — and the block split
 * narrowed each call to six or seven rows. `EXTRACTION_MODEL` overrides
 * without a code change, shared with the Anthropic path.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

/**
 * The slice of the Gemini client this adapter uses. Narrow on purpose so a
 * test stub is a few lines rather than a mock of the whole SDK. The response
 * is untyped-ish here because the adapter does not trust it typed: everything
 * is read structurally and re-validated before anything crosses the port.
 */
export interface GeminiExtractionClient {
  models: {
    generateContent(params: Record<string, unknown>): Promise<{
      promptFeedback?: { blockReason?: string | null } | null;
      candidates?:
        | {
            finishReason?: string | null;
            content?: { parts?: { text?: string }[] | null } | null;
          }[]
        | null;
      usageMetadata?: { thoughtsTokenCount?: number | null } | null;
      /** The SDK's accessor concatenating the text parts; stubs may set it plainly. */
      text?: string;
    }>;
  };
}

type GeminiResponse = Awaited<ReturnType<GeminiExtractionClient["models"]["generateContent"]>>;

/**
 * How to ask a given Gemini model not to think.
 *
 * The two knobs are not portable across model families, and getting them
 * wrong is an error rather than a degradation: a 2.5 model rejects
 * `thinkingLevel` outright, and a 3.x model cannot take a zero budget — its
 * floor is `MINIMAL`. Never both. Dispatch is a prefix check on the model id,
 * which is enough because this function only ever sees Gemini ids.
 *
 * An id this does not recognise is far likelier newer than older, so the
 * unknown case takes the 3.x shape.
 */
export function geminiThinkingConfigFor(model: string): Record<string, unknown> {
  if (model.startsWith("gemini-2.5")) return { thinkingBudget: 0 };
  return { thinkingLevel: "MINIMAL" };
}

/**
 * All four harm categories off. The transcripts name real founders and
 * discuss real financials, which default thresholds intermittently block —
 * and a blocked call here is a PM's evidence not written. CIVIC_INTEGRITY is
 * deprecated and must not be sent; modelArmorConfig is mutually exclusive
 * with safetySettings and is not sent either.
 */
/**
 * The ceiling on one block's answer. Matches the Anthropic adapter's
 * `max_tokens`, because it is sized to the same job rather than to a provider.
 */
export const MAX_OUTPUT_TOKENS = 8000;

const SAFETY_OFF = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
] as const;

/**
 * Which class of failure a status belongs to (KTD5) — the same derivation the
 * Anthropic adapter makes, kept local because each adapter owns its own
 * outcome mapping.
 */
function failureKindFor(status: ApiFailureStatus): ExtractionFailureKind {
  if (status === "filing") return "filing";
  if (status === "timeout" || status === null || status === 429) return "retryable";
  if (status >= 500) return "retryable";
  return "terminal";
}

/**
 * Read a Gemini SDK exception into the neutral status vocabulary. Structural,
 * never `instanceof` — a plain-object stub shaped like the real ApiError
 * behaves like the real thing, the convention lib/fireflies/client.ts set.
 */
function classifyApiFailure(e: unknown): { status: ApiFailureStatus; messages: string[] } {
  const err = e as { status?: number; name?: string; message?: string };
  /**
   * A 504 here is this deployment's own block bound, not an outage.
   *
   * The SDK turns `httpOptions.timeout` into an `X-Server-Timeout` header in
   * seconds (node/index.mjs, buildHeaders), so Google enforces our deadline on
   * its side and answers `504 DEADLINE_EXCEEDED` rather than letting the socket
   * hang. Left in the numeric branch it renders as "the API returned 504 — try
   * again", which blames Google for a limit we set and names no lever; read as
   * the timeout pseudo-status it says the model did not finish inside the bound
   * and points at EXTRACTION_MODEL, which is the thing that would actually
   * change the outcome.
   *
   * Gemini-only on purpose. The Anthropic adapter sends no such header, so a
   * 504 reaching it really is a gateway between here and there, and each
   * adapter owns its own outcome mapping.
   */
  if (err?.status === 504) {
    return { status: "timeout", messages: err.message ? [err.message] : [] };
  }
  if (typeof err?.status === "number") {
    return { status: err.status, messages: err.message ? [err.message] : [] };
  }
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || /timed? ?out/i.test(err?.message ?? "")) {
    return { status: "timeout", messages: [] };
  }
  return { status: null, messages: err?.message ? [err.message] : [] };
}

function resolveClient(injected?: GeminiExtractionClient): GeminiExtractionClient {
  if (injected) return injected;

  /**
   * The enterprise path, refused legibly rather than half-taken: Vertex wants
   * a project and a location and a different credential story, and this
   * adapter supports none of it yet. Detecting the flag is the whole of the
   * support — a clear error beats an authentication failure two calls later.
   */
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI?.trim()) {
    throw new ExtractionError(
      "GOOGLE_GENAI_USE_VERTEXAI is set, but TARS only supports the Gemini API key path — " +
        "unset it and configure GOOGLE_API_KEY or GEMINI_API_KEY instead.",
      "terminal",
    );
  }

  // The SDK's own precedence: GOOGLE_API_KEY first, then GEMINI_API_KEY (it
  // warns when both are set). Both names checked so the error can name both.
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ExtractionError(
      "neither GOOGLE_API_KEY nor GEMINI_API_KEY is set — Gemini extraction cannot run. " +
        "See docs/runbooks/deploy-vercel.md.",
      "terminal",
    );
  }

  /**
   * Constructed lazily — the factory runs per request, never at module scope,
   * for the reason lib/services/import.ts spells out: a module-level client
   * would read the credential at import time, and importing this module must
   * never require a key.
   *
   * `retryOptions` is deliberately NOT set, and the omission is load-bearing
   * twice over. The SDK's `apiCall` returns a plain `fetch` when the option is
   * absent — so absent already means zero retries, which is what BLOCK_RETRIES
   * gives the adapter next door and for the same reason: a retry that outruns
   * the function ceiling turns a partial success into a total loss.
   *
   * Setting it would also silently break failure classification. With
   * `retryOptions` present the SDK routes through `pRetry`, where a non-OK
   * response throws a bare `Error` from inside the retry body — so
   * `throwErrorIfNotOK`, the only place an `ApiError` carrying a numeric
   * `status` is built, never runs. `classifyApiFailure` below gates on that
   * status, so every HTTP failure would fall through to `null` and be recorded
   * retryable: a bad key, a wrong model, a rejected schema and an oversized
   * transcript would each invite an endless re-run that spends a full
   * transcript read per press and can never succeed. The terminal branch would
   * be unreachable on this provider, which is the whole of KTD6.
   */
  return new GoogleGenAI({ apiKey }) as unknown as GeminiExtractionClient;
}

/** The generated text, wherever the response put it. */
function textOf(response: GeminiResponse): string {
  if (typeof response.text === "string") return response.text;
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p?.text ?? "").join("");
}

/**
 * Build the Gemini adapter. Constructed per run, never memoised at module
 * scope — see resolveClient. The injected client is the same seam the
 * Anthropic adapter offers, so a test stub is a plain object with one async
 * method.
 */
export function createGeminiProvider(
  deps: { client?: GeminiExtractionClient; model?: string } = {},
): ExtractionProvider {
  const client = resolveClient(deps.client);
  // An empty EXTRACTION_MODEL should fall through to the default, hence || here.
  const model = deps.model ?? (process.env.EXTRACTION_MODEL || DEFAULT_GEMINI_MODEL);

  async function extractBlock<T>(request: ExtractionBlockRequest<T>): Promise<T> {
    // Built outside the try so a schema problem here stays a programmer error
    // rather than being reported as an API failure.
    const rubric = rubricByKey(request.rubricKey);
    if (!rubric) {
      throw new ExtractionError(
        `no rubric named "${request.rubricKey}" — the block request is malformed`,
        "terminal",
      );
    }

    const params = {
      /**
       * Not a Gemini field, and carried on purpose (KTD7): the request names
       * the block it reads, so a test stub routes its answers on the key.
       */
      rubricKey: request.rubricKey,
      model,
      contents: [{ role: "user", parts: [{ text: request.user }] }],
      config: {
        systemInstruction: request.system,
        // Determinism by default: 0 explicitly, never the provider's default.
        // Gemini accepts temperature on every family — nothing dropped (KTD12).
        temperature: request.temperature ?? 0,
        responseMimeType: "application/json",
        /**
         * responseJsonSchema, NOT responseSchema: the deprecated field
         * silently drops additionalProperties and leaks $schema into a 400.
         * The projection stays inside Gemini's supported keyword subset by
         * construction — see geminiResponseJsonSchemaFor.
         */
        responseJsonSchema: geminiResponseJsonSchemaFor(rubric),
        thinkingConfig: geminiThinkingConfigFor(model),
        /**
         * A ceiling on the answer, and therefore on how long producing it can
         * take. The Anthropic adapter has capped at 8000 from the start for
         * this exact reason; this side shipped with no cap at all, so a block
         * that decided to enumerate generated until the deadline cut it off —
         * which is one of the ways a block reaches the bound and returns
         * nothing rather than something.
         *
         * The same number, because it is sized to the same job: six or seven
         * rows of quotes and one mapping clause each, where a full block runs
         * closer to a thousand tokens. It is headroom, not a target.
         *
         * Capping is safe here specifically because truncation is loud: a
         * MAX_TOKENS finish reason fails the outcome contract above and throws
         * (KTD5), so a cut-off block is never mistaken for a clean read of a
         * block that had little in it.
         */
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        safetySettings: [...SAFETY_OFF],
        /**
         * The port's per-call bound. Note the SDK implements this by raising
         * the timeout on Node's *global* Undici dispatcher (upward only), so
         * the bound leaks a little wider than this one request — acceptable,
         * since every caller here wants the same ceiling.
         */
        httpOptions: { timeout: request.timeoutMs },
      },
    };

    let response: GeminiResponse;
    try {
      response = await client.models.generateContent(params);
    } catch (e) {
      const { status, messages } = classifyApiFailure(e);
      throw new ExtractionError(describeApiFailure(status, messages), failureKindFor(status));
    }

    /**
     * The outcome contract, in this order, BEFORE any output is read (KTD5).
     *
     * Gemini answers a blocked request with HTTP 200, empty content, and no
     * exception — the failure that parses cleanly as an empty successful
     * block. Read that way it enters `succeededBlocks`, a re-run deletes the
     * prior run's rows for this block, and nothing is written back: a PM's
     * evidence gone with a green banner over it. So: (1) the prompt-level
     * block reason, (2) the candidate's finish reason, and only on a clean
     * STOP does the payload get parsed at all.
     */
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      // Terminal: the same transcript will be blocked the same way next time.
      throw new ExtractionError(
        `Gemini blocked this request before generating anything (${blockReason}), so nothing ` +
          "was written for this block. A re-run will be blocked the same way — this needs a " +
          "different model or provider (EXTRACTION_MODEL / EXTRACTION_PROVIDER).",
        "terminal",
      );
    }

    const candidate = response.candidates?.[0];
    if (!candidate) {
      // No block reason and no candidates: the model produced nothing at all
      // this run, which a re-run genuinely remedies.
      throw new ExtractionError("the model returned no candidates", "retryable");
    }

    const finish = candidate.finishReason ?? "";
    if (finish !== "STOP") {
      if (finish === "MAX_TOKENS") {
        /**
         * The truncation case. On Gemini 3 the output cap covers thinking and
         * output together and structured output comes back null rather than
         * as partial JSON — and on any family a truncated payload can still
         * parse into an honest-looking short block. Truncation is read from
         * the finish reason, never inferred from a parse failure.
         */
        throw new ExtractionError(
          "the model ran out of output tokens before finishing this block, so its answer is " +
            "truncated and was not written. The transcript is saved — re-run to read this block again.",
          "retryable",
        );
      }
      if (finish === "MALFORMED_RESPONSE") {
        // The model garbled this generation; a re-run is the remedy.
        throw new ExtractionError(
          "the model produced a malformed response for this block — re-run to read it again.",
          "retryable",
        );
      }
      /**
       * The rest split by what a re-run would do. Content-policy finishes
       * fail the same way every time — terminal; anything unrecognised is
       * likelier a transient or a new SDK vocabulary word than a policy, and
       * a wasted re-run is cheaper than a wrongly-abandoned block.
       */
      const contentPolicy = ["RECITATION", "SPII", "SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "IMAGE_SAFETY"];
      if (contentPolicy.includes(finish)) {
        throw new ExtractionError(
          `Gemini stopped generating on this block (${finish}) and its partial answer was not ` +
            "written. A re-run will stop the same way — this needs a different model or provider.",
          "terminal",
        );
      }
      throw new ExtractionError(
        `the model stopped without finishing this block (${finish || "no finish reason"}) — ` +
          "re-run to read it again.",
        "retryable",
      );
    }

    /**
     * The canary for thinking silently switched on: a non-zero thoughts count
     * means the thinking config stopped reaching this model — worth a warning
     * before it becomes a latency problem, never a failure.
     */
    const thoughts = response.usageMetadata?.thoughtsTokenCount;
    if (thoughts) {
      console.warn(
        `gemini: ${thoughts} thinking tokens on block ${request.rubricKey} despite thinking ` +
          "being configured off — check the model/thinkingConfig pairing.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textOf(response));
    } catch {
      throw new ExtractionError("the model returned no parseable output", "retryable");
    }

    /**
     * Re-validated against the block's own schema even though constrained
     * decoding shaped it: the guard on what enters the ledger belongs to this
     * adapter (KTD9), and constrained decoding guarantees shape, not
     * semantics.
     */
    const checked = request.schema.safeParse(parsed);
    if (!checked.success) {
      const where = checked.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "response"}: ${i.message}`);
      throw new ExtractionError(describeApiFailure("filing", where), "filing");
    }

    return checked.data;
  }

  return { extractBlock };
}
