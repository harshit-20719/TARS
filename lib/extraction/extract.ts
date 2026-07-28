/**
 * The extraction service: transcript in, drafted observations and claims out.
 *
 * Three properties matter more than the plumbing.
 *
 * **It never scores.** The schema has no score field, so there is nowhere for a
 * rating to go even if the model tried. `persistExtraction` writes only
 * Observation and Claim rows. This is the framework's authorship line (spec R5),
 * enforced structurally rather than by instruction.
 *
 * **Quotes are checked against the source.** R3 says the observations are
 * verbatim, and a language model asked for a quote will sometimes give a tidied
 * paraphrase instead. An unverifiable quote is worse than a missing one here,
 * because a PM will later score a founder against it and the audit trail would
 * be a fabrication. So every quote is located in the transcript, and one that
 * cannot be found is dropped rather than persisted.
 *
 * **The client is injected.** Tests pass a stub, so the suite never needs an API
 * key and never reaches the network.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { RUBRICS, type Rubric } from "@/framework";
import {
  ExtractionOutputSchema,
  outputSchemaFor,
  type DraftClaim,
  type DraftObservation,
  type ExtractionOutput,
} from "./schema";
import { buildExtractionUserMessage, systemPromptFor } from "./prompt";

/** Default model. Sonnet 5 is the documented high-volume swap (spec D6). */
export const DEFAULT_EXTRACTION_MODEL = "claude-opus-5";

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
 * one place: the call site spreads whatever this hands back.
 */
export function thinkingConfigFor(model: string): Record<string, unknown> {
  /**
   * Read the generation out of the id rather than pattern-matching the whole
   * string. A looser regex is easy to get wrong in the direction that matters:
   * "claude-haiku-4-5" ends in "-5" and will happily match a rule meant for the
   * 5 series, which is precisely the model this branch exists for.
   */
  const parsed = /^claude-(?:[a-z]+-)?(\d+)(?:-(\d+))?/.exec(model);
  const major = parsed ? Number(parsed[1]) : 0;
  const minor = parsed?.[2] !== undefined ? Number(parsed[2]) : 0;

  // An id this does not recognise is far likelier to be newer than older, so the
  // unknown case takes the modern shape.
  const adaptive = !parsed || major >= 5 || (major === 4 && minor >= 6);
  if (adaptive) {
    /**
     * Effort is the latency lever, and latency is the binding constraint here:
     * the whole extraction has to finish inside one serverless function call
     * (60 seconds on Vercel's free tier), and a forty-minute transcript is not a
     * small read. "low" is the default because this is a careful-reading task
     * rather than a reasoning one — quote exactly, map to a row, tag an origin —
     * and a run that gets killed at the ceiling produces nothing at all, which
     * is worse than a run that thinks a little less.
     *
     * Raise it with EXTRACTION_EFFORT if the mapping quality needs it and the
     * transcripts are short enough to afford it.
     */
    const effort = process.env.EXTRACTION_EFFORT?.trim() || "low";
    return { thinking: { type: "adaptive" }, effort };
  }
  /**
   * Pre-4.6: a fixed budget, which must be strictly less than max_tokens. 4000
   * is enough for the model to work through a transcript without eating the
   * budget the drafts themselves need.
   */
  return { thinking: { type: "enabled", budget_tokens: 4000 } };
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Turn a failure from the Anthropic API into something a PM can act on.
 *
 * This exists because of how lib/actions.ts handles errors: it converts the typed
 * domain failures into values and deliberately rethrows everything else, so an
 * unrecognised error escapes the server action and React renders the generic
 * "an error occurred in the Server Components render" with the message stripped.
 * Every SDK error was in that second group — which meant the failures you
 * actually hit on a first real run (a mistyped key, a wrong EXTRACTION_MODEL, an
 * empty credit balance, a rate limit) all surfaced as the one error that says
 * nothing at all.
 *
 * The API's own explanation is passed through. It names the parameter or the
 * billing state, which is the part worth reading, and it never contains the key.
 */
export function describeApiFailure(e: unknown): string {
  const err = e as {
    status?: number;
    requestID?: string;
    error?: { error?: { message?: string; type?: string } };
    message?: string;
  };
  const detail = err?.error?.error?.message ?? "";
  const said = detail ? ` The API said: ${detail}` : "";
  const ref = err?.requestID ? ` (request ${err.requestID})` : "";

  switch (err?.status) {
    case 401:
      return `the ANTHROPIC_API_KEY is not valid, so no drafts were written.${said}`;
    case 403:
      return `that API key is not permitted to use this model.${said}`;
    case 404:
      return (
        `there is no model by that name — check EXTRACTION_MODEL, or unset it to ` +
        `fall back to ${DEFAULT_EXTRACTION_MODEL}.${said}`
      );
    case 400:
      // Where a bad parameter and an exhausted credit balance both land.
      return `the API rejected the request.${said}${ref}`;
    case 413:
      return "the transcript is too large for one request; split it across two calls.";
    case 429:
      return `rate limited — the transcript is saved, so try extraction again in a moment.${said}`;
    default:
      break;
  }
  if (typeof err?.status === "number" && err.status >= 500) {
    return `the API is unavailable right now — the transcript is saved, so try again.${ref}`;
  }
  // No status: a connection failure, or something the SDK threw before sending.
  const raw = err?.message ? ` ${err.message}` : "";
  return `could not reach the API, so no drafts were written.${raw}`;
}

/**
 * The slice of the Anthropic client this service uses. Narrow on purpose so a
 * test stub is a few lines rather than a mock of the whole SDK.
 */
export interface ExtractionClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<{
      /**
       * A block's output, so no `rubricKey` — the caller knows which block it
       * asked, and adds it. Asking the model for a value already known would only
       * create a way for it to disagree with itself.
       */
      parsed_output: Omit<ExtractionOutput, "observations"> & {
        observations: Omit<DraftObservation, "rubricKey">[];
      } | null;
      stop_reason?: string | null;
      stop_details?: { category?: string | null; explanation?: string | null } | null;
    }>;
  };
}

export interface ExtractionInput {
  transcript: string;
  callNumber: number;
  company?: string;
  callLabel?: string;
}

export interface ExtractionResult {
  observations: DraftObservation[];
  claims: DraftClaim[];
  /** Quotes the model returned that are not present in the transcript. */
  droppedQuotes: string[];
  /** Claims whose anchor quote did not survive verification. */
  droppedClaims: string[];
  /**
   * Which macro-dimensions failed, if any. A partial result is kept rather than
   * discarded: five blocks of evidence is worth having, and re-running only costs
   * the PM another press. Surfaced so the failure is visible instead of looking
   * like the transcript simply had nothing in it.
   */
  failedBlocks: { rubricKey: string; label: string; reason: string }[];
}

// ------------------------------------------------------------ verbatim guard

/**
 * Normalise for comparison only.
 *
 * Collapsing whitespace and folding typographic quotes to their ASCII forms is
 * not a loosening of "verbatim" — transcripts wrap lines arbitrarily, and models
 * routinely return a curly apostrophe where the source had a straight one.
 * Neither changes a single word. Everything else, including case, must match.
 */
export function normaliseForComparison(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the quote genuinely appears in the transcript. */
export function isVerbatim(transcript: string, quote: string): boolean {
  const q = normaliseForComparison(quote);
  if (!q) return false;
  return normaliseForComparison(transcript).includes(q);
}

// ----------------------------------------------------------------- the call

function resolveClient(injected?: ExtractionClient): ExtractionClient {
  if (injected) return injected;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError(
      "ANTHROPIC_API_KEY is not set — extraction cannot run. See docs/runbooks/deploy-vercel.md.",
    );
  }
  // Constructed lazily so importing this module never requires a key.
  return new Anthropic() as unknown as ExtractionClient;
}

/**
 * Draft observations and claims from one transcript, one macro-dimension at a time.
 *
 * **Why one call per block.** The first version sent one request against all
 * forty-one rows and came back with a handful of observations from a forty-minute
 * screening call. Two things caused that, and both are fixed by splitting: a model
 * asked to hold forty-one rows in mind reports what stood out rather than working
 * the list, and a single response carrying every row's evidence is a long
 * generation — long enough to be the thing that ran the function out of time.
 *
 * Six smaller calls are better on all three axes at once. Each one sees six or
 * seven rows with their full anchors and is told to go row by row, so it finds the
 * ordinary middle-of-the-range evidence a sweep skips. Each response is a fraction
 * of the size. And they run concurrently, so the wall clock is the slowest single
 * block rather than the sum — comfortably inside the function's 60-second limit,
 * where the single call was not.
 *
 * The cost is reading the transcript six times instead of once. Input tokens are
 * the cheap half of the bill and this is where the quality was, so it is a good
 * trade; at a few calls a week it is small change.
 *
 * **Partial results are kept.** If one block's call fails, the other five still
 * wrote real evidence and throwing it away would waste both the tokens and the
 * PM's wait. The failure is reported alongside the results instead.
 */
export async function extractFromTranscript(
  input: ExtractionInput,
  deps: { client?: ExtractionClient; model?: string; blocks?: readonly Rubric[] } = {},
): Promise<ExtractionResult> {
  if (!input.transcript.trim()) {
    throw new ExtractionError("cannot extract from an empty transcript");
  }

  const client = resolveClient(deps.client);
  // An empty EXTRACTION_MODEL should fall through to the default, hence || here.
  const model = deps.model ?? (process.env.EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL);
  const blocks = deps.blocks ?? RUBRICS;
  const userMessage = buildExtractionUserMessage(input);

  const settled = await Promise.allSettled(
    blocks.map((rubric) => extractBlock(client, model, rubric, userMessage)),
  );

  const merged: ExtractionOutput = { observations: [], claims: [] };
  const failedBlocks: ExtractionResult["failedBlocks"] = [];

  settled.forEach((outcome, i) => {
    const rubric = blocks[i];
    if (outcome.status === "fulfilled") {
      merged.observations.push(...outcome.value.observations);
      merged.claims.push(...outcome.value.claims);
      return;
    }
    const reason =
      outcome.reason instanceof ExtractionError
        ? outcome.reason.message
        : String((outcome.reason as Error)?.message ?? outcome.reason);
    failedBlocks.push({ rubricKey: rubric.key, label: rubric.label, reason });
  });

  // Every block failing is not a partial result, it is a failed run — and the
  // reasons will all be the same one (a bad key, no credit), so report it as such.
  if (failedBlocks.length === blocks.length) {
    throw new ExtractionError(failedBlocks[0]?.reason ?? "extraction failed");
  }

  return { ...verifyDrafts(input.transcript, merged), failedBlocks };
}

/**
 * One macro-dimension's pass. Rejects with an ExtractionError; the caller decides
 * whether one block failing is fatal.
 */
async function extractBlock(
  client: ExtractionClient,
  model: string,
  rubric: Rubric,
  userMessage: string,
): Promise<ExtractionOutput> {
  const { thinking, effort } = thinkingConfigFor(model);
  // Built outside the try so a schema problem here stays a programmer error
  // rather than being reported as an API failure.
  const params = {
    model,
    /**
     * Sized for one block rather than for the whole rubric. Seven rows with
     * several quotes each is a few thousand tokens; 8000 leaves room without
     * inviting a generation long enough to threaten the time limit. Still above
     * the pre-4.6 thinking budget it has to exceed, and under Haiku 4.5's ceiling.
     */
    max_tokens: 8000,
    system: systemPromptFor(rubric),
    thinking,
    output_config: {
      // Omitted entirely on pre-4.6 models, which reject it.
      ...(effort ? { effort } : {}),
      format: zodOutputFormat(outputSchemaFor(rubric)),
    },
    messages: [{ role: "user", content: userMessage }],
  };

  let response: Awaited<ReturnType<ExtractionClient["messages"]["parse"]>>;
  try {
    response = await client.messages.parse(params);
  } catch (e) {
    // The one statement in this block is the API call, so everything from it is
    // an extraction failure — reported as a value the form can render instead of
    // escaping as an unhandled error.
    throw new ExtractionError(`${rubric.label}: ${describeApiFailure(e)}`);
  }

  // Check the refusal before reading content: on a refusal the content is empty
  // or partial, and reading it as a result would silently persist nothing while
  // reporting success.
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category ?? "unspecified";
    throw new ExtractionError(
      `${rubric.label}: the model declined to process this transcript (${category})`,
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new ExtractionError(`${rubric.label}: the model returned no parseable output`);
  }

  // The block schema omits rubricKey — it is implied by which call this was, so
  // asking the model for it would only create a way for it to be wrong.
  return {
    observations: parsed.observations.map((o) => ({ ...o, rubricKey: rubric.key })),
    claims: parsed.claims,
  };
}

/**
 * Apply the verbatim guard, and keep only the claims whose anchor survived it.
 * Split out from the API call so it can be tested directly.
 */
export function verifyDrafts(
  transcript: string,
  parsed: ExtractionOutput,
): Omit<ExtractionResult, "failedBlocks"> {
  const observations: DraftObservation[] = [];
  const droppedQuotes: string[] = [];

  for (const o of parsed.observations) {
    if (isVerbatim(transcript, o.quote)) observations.push(o);
    else droppedQuotes.push(o.quote);
  }

  // A claim is only as good as the quote holding it up. If the anchor was
  // dropped, the claim has nothing to point at and goes with it rather than
  // becoming a free-floating assertion in the ledger.
  const kept = new Set(observations.map((o) => normaliseForComparison(o.quote)));
  const claims: DraftClaim[] = [];
  const droppedClaims: string[] = [];

  for (const c of parsed.claims) {
    if (kept.has(normaliseForComparison(c.anchorQuote))) claims.push(c);
    else droppedClaims.push(c.text);
  }

  return { observations, claims, droppedQuotes, droppedClaims };
}
