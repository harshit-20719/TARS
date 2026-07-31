/**
 * The Anthropic adapter: every Anthropic-shaped request field lives here, and
 * nowhere else (KTD4).
 *
 * This module mirrors lib/fireflies/client.ts on purpose — a factory taking
 * injected dependencies, credential resolution in one function, a timeout
 * constant carrying its ceiling reasoning. What crosses back out is only the
 * port from lib/extraction/types: validated block output, or an
 * ExtractionError whose `kind` says what class of failure this was. The
 * orchestrator (extract.ts) never sees a model id's quirks, an SDK exception
 * class, or a stop reason again.
 *
 * One import runs the other way: describeApiFailure stays in extract.ts (its
 * wording is provider-neutral and other adapters will share it), so this
 * module and extract.ts import each other. The cycle is benign — each side
 * only calls the other's functions at request time, never during module
 * evaluation — but it is a cycle, so nothing here may read an extract.ts
 * binding at the top level.
 */

/**
 * The same trip-wire the Gemini adapter carries. No key reaches a browser
 * today — Next inlines nothing without a NEXT_PUBLIC_ prefix and the SDK
 * refuses browser use — but this module reads a credential, and the admin
 * page already pulls a pure helper (`acceptsTemperature`) out of it. The next
 * person who wants that helper in a client control should hit a build error,
 * not discover the problem in a bundle.
 */
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ExtractionError,
  type ExtractionBlockRequest,
  type ExtractionProvider,
} from "../types";
import { describeApiFailure, type ApiFailureStatus } from "../extract";
import type { ExtractionFailureKind } from "../types";

/**
 * Default model, resolving spec D6 in favour of Sonnet 5.
 *
 * Splitting extraction into one call per macro-dimension sends the transcript six
 * times, which multiplied the per-transcript cost on the Opus tier. Sonnet 5 is
 * what the plan recommended for this step all along (KTD4): the machine here
 * quotes, files, and tags — it never judges — and the block split narrowed the
 * hardest part of the job, since each call now chooses between six or seven rows
 * rather than forty-one, with a schema that makes a cross-block answer impossible.
 * What it gets wrong it also tends to flag: an unsure mapping reports itself and
 * waits for a person, so the exception queue absorbs the difference.
 *
 * `EXTRACTION_MODEL` still overrides this without a code change.
 */
export const DEFAULT_EXTRACTION_MODEL = "claude-sonnet-5";

/**
 * How long one block's call may take before it is abandoned.
 *
 * The SDK's default is about ten minutes, against a function that is killed at
 * sixty seconds. That default turned one slow block into a total loss: the whole
 * function died, so the five blocks that had already answered were never written —
 * defeating the point of running them concurrently and keeping partial results. A
 * bounded wait makes a slow block behave like any other failed block.
 *
 * Sized so the whole run fits the free tier's ceiling rather than needing a paid
 * one. The blocks are concurrent, so the extraction phase is bounded by this single
 * number, not by six of them; adding the database phase's own ceiling
 * (see runExtractionForCall) leaves headroom under sixty seconds.
 *
 * That last paragraph was false until BLOCK_RETRIES existed, and the way it was
 * false is worth keeping written down: this option bounds one *attempt*, not one
 * block. See BLOCK_RETRIES.
 *
 * Forty rather than thirty because thirty was not enough: on a real forty-minute
 * transcript five of the six blocks did not finish in time. Forty plus the write
 * phase's ten is fifty, which leaves a cold start and the session lookup room
 * inside sixty.
 *
 * Note what will *not* buy a block more time, because it is the obvious next
 * idea: splitting the six blocks across six requests. The blocks already run
 * concurrently, so they share wall clock rather than dividing a budget — one
 * block in its own function still cannot exceed the same sixty-second ceiling
 * minus the same write phase. The levers that do work are this number and the
 * model's own speed (see thinkingConfigFor, EXTRACTION_MODEL).
 */
export const BLOCK_TIMEOUT_MS = 40_000;

/**
 * No retries, which is the only setting that makes BLOCK_TIMEOUT_MS mean what
 * the comment above says it means.
 *
 * The SDK retries twice by default, and a timeout is one of the things it
 * retries — so `{ timeout: 30_000 }` alone bounds an attempt at thirty seconds
 * and a block at ninety. Six concurrent blocks are still bounded by one block,
 * but one block outran the sixty-second function ceiling on its own. The
 * function was killed rather than returning, which is the failure with no error
 * object and no message: the browser gets "an unexpected response was received
 * from the server" and there is nothing to read.
 *
 * Retrying here was self-defeating rather than merely expensive. The whole point
 * of the concurrent fan-out is that a bad block costs one block: the run reports
 * it in `failedBlocks`, writes the rest, and invites a re-run. A retry that
 * outruns the ceiling turns that partial success into a total loss — including
 * the blocks that already answered. Failing a block at thirty seconds and saying
 * which one is strictly better than silently losing all six.
 */
export const BLOCK_RETRIES = 0;

/**
 * Which side of the 4.6 line a model id falls on — the one generation parse in
 * this adapter, shared by the thinking shape and the temperature decision so
 * the two can never disagree about what generation a model is.
 *
 * Read the generation out of the id rather than pattern-matching the whole
 * string. A looser regex is easy to get wrong in the direction that matters:
 * "claude-haiku-4-5" ends in "-5" and will happily match a rule meant for the
 * 5 series, which is precisely the model this branch exists for.
 *
 * An id this does not recognise is far likelier to be newer than older, so the
 * unknown case takes the modern shape.
 */
function isModernGeneration(model: string): boolean {
  const parsed = /^claude-(?:[a-z]+-)?(\d+)(?:-(\d+))?/.exec(model);
  const major = parsed ? Number(parsed[1]) : 0;
  const minor = parsed?.[2] !== undefined ? Number(parsed[2]) : 0;
  return !parsed || major >= 5 || (major === 4 && minor >= 6);
}

/**
 * How to ask a given model to think.
 *
 * The two knobs are not portable across model generations, and getting them
 * wrong is a 400 rather than a degradation — so EXTRACTION_MODEL cannot just be
 * pasted into the request. Claude 4.6 and later take `thinking: {adaptive}` and
 * an `effort` level; earlier models take a fixed `budget_tokens` and reject
 * `effort` outright. Haiku 4.5 is in the second group, which is exactly the
 * model someone reaches for to make this step cheaper.
 *
 * Returning the request fragment rather than a pair of flags keeps the branch in
 * one place: the call site spreads whatever this hands back. Only this adapter
 * calls it now, so the `claude-` shape of the id is correct by construction.
 */
export function thinkingConfigFor(model: string): Record<string, unknown> {
  const adaptive = isModernGeneration(model);

  /**
   * Thinking is off unless asked for, and that default was earned rather than
   * assumed: with it on, five of the six blocks on a real forty-minute
   * transcript did not finish inside thirty seconds.
   *
   * Two reasons it costs more here than it looks. `max_tokens` caps thinking and
   * output *together*, so on a block that legitimately produces a few thousand
   * tokens of quotes the thinking is competing with the drafts for the same
   * budget. And the work itself does not need it: the prompt asks the model to
   * quote exactly, file the quote against one of six or seven rows, and tag
   * where it came from. That is a careful-reading task, not a reasoning one.
   *
   * What makes it safe is that none of the guards depend on it. A paraphrase is
   * dropped by the verbatim check whether the model thought about it or not, the
   * schema constrains the shape, and a mapping the model is unsure of reports
   * itself and goes to a person. So the failure modes thinking would protect
   * against are already caught downstream.
   *
   * EXTRACTION_THINKING=on restores it, per generation, without a code change —
   * worth trying on short transcripts if the filing quality needs it.
   */
  const wantThinking = process.env.EXTRACTION_THINKING?.trim() === "on";

  if (adaptive) {
    /**
     * Effort still applies with thinking off — it governs the model's overall
     * token spend, not only how deeply it thinks. "low" for the same reason as
     * above; EXTRACTION_EFFORT raises it.
     */
    const effort = process.env.EXTRACTION_EFFORT?.trim() || "low";
    return {
      thinking: wantThinking ? { type: "adaptive" } : { type: "disabled" },
      effort,
    };
  }
  /**
   * Pre-4.6, and still no `effort` — Haiku 4.5 rejects it outright, which is the
   * whole reason this function exists. A fixed budget must be strictly less than
   * max_tokens; 4000 is enough to work through a transcript without eating the
   * budget the drafts themselves need.
   */
  return {
    thinking: wantThinking ? { type: "enabled", budget_tokens: 4000 } : { type: "disabled" },
  };
}

/**
 * Whether this model generation accepts a `temperature` parameter (KTD12).
 *
 * On the 4.6-and-later generations a non-default temperature returns a 400 —
 * it is not a sendable parameter there at all — while pre-4.6 models like
 * Haiku 4.5 accept it. Decided by the same generation parse as the thinking
 * shape, deliberately: two regexes reading the same id is how the two
 * decisions would eventually disagree.
 */
export function acceptsTemperature(model: string): boolean {
  return !isModernGeneration(model);
}

/**
 * The slice of the Anthropic client this adapter uses. Narrow on purpose so a
 * test stub is a few lines rather than a mock of the whole SDK. `parsed_output`
 * is untyped here because the adapter does not trust it typed: it validates the
 * value against the block's own schema before returning it, so the guard is the
 * adapter's rather than the SDK helper's.
 */
export interface ExtractionClient {
  messages: {
    parse(
      params: Record<string, unknown>,
      options?: { timeout?: number; maxRetries?: number },
    ): Promise<{
      parsed_output: unknown;
      stop_reason?: string | null;
      stop_details?: { category?: string | null; explanation?: string | null } | null;
    }>;
  };
}

/**
 * Which class of failure a status belongs to (KTD5). The status is the one fact
 * that survives translation to a readable message, so the kind is derived from
 * it here rather than re-inferred later by parsing the message back.
 */
function failureKindFor(status: ApiFailureStatus): ExtractionFailureKind {
  if (status === "filing") return "filing";
  // A rate limit, an outage, a timeout, and a dropped connection all clear on
  // their own; the message for each already says "try again".
  if (status === "timeout" || status === null || status === 429) return "retryable";
  if (status >= 500) return "retryable";
  // Every remaining status is a request that will fail the same way next time.
  return "terminal";
}

/**
 * Read an Anthropic SDK exception into the neutral status vocabulary.
 *
 * This is the one place the SDK's error shape is understood. Everything is read
 * structurally — `name` as a string, never `instanceof` — so a plain-object
 * stub shaped like the real thing behaves like the real thing, the same
 * convention isTimeout follows in lib/fireflies/client.ts.
 */
function classifyApiFailure(e: unknown): {
  status: ApiFailureStatus;
  messages: string[];
  requestID?: string;
} {
  /**
   * A schema violation first, because it is the failure with no status at all:
   * the SDK validates the model's answer inside the awaited call and throws the
   * Zod error raw. Recognised by its `issues` array rather than by class for
   * the same stub-friendliness as everything else here. Only the issue paths
   * travel — the failing value is the model's reading of a founder call.
   */
  const issues = (e as { issues?: unknown })?.issues;
  const name = (e as { name?: unknown })?.name;
  if (name === "ZodError" || Array.isArray(issues)) {
    const where = (Array.isArray(issues) ? issues : [])
      .slice(0, 3)
      .map((i) => {
        const issue = i as { path?: (string | number)[]; message?: string };
        return `${issue.path?.join(".") || "response"}: ${issue.message ?? "did not match"}`;
      });
    return { status: "filing", messages: where };
  }

  const err = e as {
    status?: number;
    requestID?: string;
    error?: { error?: { message?: string } };
    message?: string;
  };
  if (typeof err?.status === "number") {
    const detail = err.error?.error?.message;
    return {
      status: err.status,
      messages: detail ? [detail] : [],
      requestID: err.requestID,
    };
  }
  if (name === "APIConnectionTimeoutError" || /timed out/i.test(err?.message ?? "")) {
    return { status: "timeout", messages: [] };
  }
  return { status: null, messages: err?.message ? [err.message] : [] };
}

function resolveClient(injected?: ExtractionClient): ExtractionClient {
  if (injected) return injected;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError(
      "ANTHROPIC_API_KEY is not set — extraction cannot run. See docs/runbooks/deploy-vercel.md.",
      "terminal",
    );
  }
  // Constructed lazily — the factory runs per request, never at module scope,
  // for the reason lib/services/import.ts:48-54 spells out: a module-level
  // client would read the credential at import time, and importing this module
  // must never require a key.
  return new Anthropic() as unknown as ExtractionClient;
}

/**
 * The provider extract.ts fans out over, plus the one Anthropic-specific fact
 * the port cannot carry: which requests supplied a temperature this model
 * generation rejects. The drop is recorded rather than silent so a later admin
 * page (U11) can say "your tuned temperature is not reaching this model".
 */
export interface AnthropicExtractionProvider extends ExtractionProvider {
  /** Rubric keys of requests whose supplied temperature was dropped, not sent (KTD12). */
  readonly temperatureDrops: readonly string[];
}

/**
 * Build the Anthropic adapter. Constructed per run, never memoised at module
 * scope — see resolveClient. The injected client is the same seam the old
 * ExtractionClient offered, so a test stub is still a plain object with one
 * async method.
 */
export function createAnthropicProvider(
  deps: { client?: ExtractionClient; model?: string } = {},
): AnthropicExtractionProvider {
  const client = resolveClient(deps.client);
  // An empty EXTRACTION_MODEL should fall through to the default, hence || here.
  const model = deps.model ?? (process.env.EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL);
  const temperatureDrops: string[] = [];

  async function extractBlock<T>(request: ExtractionBlockRequest<T>): Promise<T> {
    const { thinking, effort } = thinkingConfigFor(model);

    /**
     * A supplied temperature only reaches the wire on a generation that accepts
     * it; anywhere else it is dropped and the drop recorded. Sending it would
     * be a 400 on every block at once (KTD12).
     */
    const sendTemperature = request.temperature !== undefined && acceptsTemperature(model);
    if (request.temperature !== undefined && !sendTemperature) {
      temperatureDrops.push(request.rubricKey);
    }

    // Built outside the try so a schema problem here stays a programmer error
    // rather than being reported as an API failure.
    const params = {
      /**
       * Not an Anthropic field, and carried on purpose (KTD7): the request names
       * the block it reads, so a test stub routes its answers on the key rather
       * than reverse-engineering the block from a generated prompt string — and
       * an unrouted request can throw instead of answering with a default.
       */
      rubricKey: request.rubricKey,
      model,
      /**
       * Sized for one block rather than for the whole rubric. Seven rows with
       * several quotes each is a few thousand tokens; 8000 leaves room without
       * inviting a generation long enough to threaten the time limit. Still above
       * the pre-4.6 thinking budget it has to exceed, and under Haiku 4.5's ceiling.
       */
      max_tokens: 8000,
      system: request.system,
      thinking,
      ...(sendTemperature ? { temperature: request.temperature } : {}),
      output_config: {
        // Omitted entirely on pre-4.6 models, which reject it.
        ...(effort ? { effort } : {}),
        format: zodOutputFormat(request.schema),
      },
      messages: [{ role: "user", content: request.user }],
    };

    let response: Awaited<ReturnType<ExtractionClient["messages"]["parse"]>>;
    try {
      response = await client.messages.parse(params, {
        timeout: request.timeoutMs,
        maxRetries: BLOCK_RETRIES,
      });
    } catch (e) {
      // The one statement in this block is the API call, so everything from it
      // is an extraction failure — reported as a value the form can render
      // instead of escaping as an unhandled error. Classified first, so the
      // message and the machine-readable kind are derived from the same status
      // and cannot disagree.
      const { status, messages, requestID } = classifyApiFailure(e);
      throw new ExtractionError(
        describeApiFailure(status, messages, requestID),
        failureKindFor(status),
      );
    }

    // Check the refusal before reading content: on a refusal the content is empty
    // or partial, and reading it as a result would silently persist nothing while
    // reporting success.
    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category ?? "unspecified";
      // Terminal: the model is declining this transcript, not having a bad minute.
      throw new ExtractionError(
        `the model declined to process this transcript (${category})`,
        "terminal",
      );
    }

    /**
     * The truncation check, and the delete hazard in its Anthropic form: a
     * max_tokens stop means the model was cut off mid-answer. What parsed out
     * of the partial text can look complete — most often an honest-looking
     * block with fewer observations than the transcript holds — and silently
     * accepting it would let a re-run *replace* a fuller earlier read with the
     * truncated one. Retryable, because a re-run genuinely is the remedy.
     */
    if (response.stop_reason === "max_tokens") {
      throw new ExtractionError(
        "the model ran out of output tokens before finishing this block, so its answer is " +
          "truncated and was not written. The transcript is saved — re-run to read this block again.",
        "retryable",
      );
    }

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      // Retryable: a generation that produced nothing usable is a fluke of this
      // run, and re-running the block is the remedy the message implies.
      throw new ExtractionError("the model returned no parseable output", "retryable");
    }

    /**
     * Re-validated against the block's own schema even though the SDK helper
     * already parsed it: the guard on what enters the ledger belongs to this
     * adapter, not to whichever helper happened to build the request. A stub
     * that answers with the wrong shape fails here the same way the live model
     * would (KTD9).
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

  return { extractBlock, temperatureDrops };
}
