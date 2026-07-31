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
 *
 * What is *not* here any more is Anthropic. Every provider-shaped request field
 * — model ids, thinking shapes, token ceilings, the SDK's error vocabulary —
 * lives in lib/extraction/providers/anthropic.ts behind the port declared in
 * types.ts (KTD4). This module fans out, verifies, and aggregates; it does not
 * know what a stop reason is.
 */

import type * as z from "zod";
import { RUBRICS, type Rubric } from "@/framework";
import { outputSchemaFor } from "./schema";
/**
 * The error and the draft shapes live in types.ts now, beside the provider
 * port, so lib/actions.ts can recognise an extraction failure without this
 * module entering the action's module graph. Re-exported here so existing
 * importers keep working while the callers migrate; new code should import
 * from lib/extraction/types.
 */
import {
  ExtractionError,
  type DraftClaim,
  type DraftObservation,
  type ExtractionFailureKind,
  type ExtractionOutput,
  type ExtractionProvider,
} from "./types";
import {
  BLOCK_TIMEOUT_MS,
  DEFAULT_EXTRACTION_MODEL,
  type ExtractionClient,
} from "./providers/anthropic";
import { resolveExtractionProvider } from "./provider";
import { buildExtractionUserMessage, systemPromptFor } from "./prompt";
import { anchorKey, dedupeSpans, normaliseForComparison } from "./dedupe";

export { ExtractionError };
export type { DraftClaim, DraftObservation, ExtractionOutput };

/**
 * The comparison normaliser lives in dedupe.ts now — "what makes two spans the
 * same span" is that module's whole subject — re-exported here so the existing
 * importers (capture.ts, the tests) keep their seam.
 */
export { normaliseForComparison } from "./dedupe";

/**
 * The Anthropic-owned pieces, re-exported from their new home so existing
 * importers (the health route, capture.ts, the tests) keep working. New code
 * should import from lib/extraction/providers/anthropic directly.
 */
export {
  BLOCK_RETRIES,
  BLOCK_TIMEOUT_MS,
  DEFAULT_EXTRACTION_MODEL,
  thinkingConfigFor,
} from "./providers/anthropic";
export type { ExtractionClient } from "./providers/anthropic";

/**
 * How many times one block may be sent inside its own time bound.
 *
 * This is the orchestrator's number, and it is not the same knob as
 * `BLOCK_RETRIES`, which stays 0: the adapters make exactly one HTTP call per
 * attempt and neither SDK runs a retry loop of its own (R5). The distinction
 * matters because an SDK-level retry hides inside one `await` and can overrun
 * the block bound, whereas an attempt counted here is bounded by the deadline
 * in `extractBlock`.
 *
 * Three, because the failure this exists for arrives in bursts: all six blocks
 * are sent at once, and a provider shedding load sheds most of the burst. Two
 * attempts recover the common case and a third covers a shed retry, while the
 * deadline means none of it can cost more wall clock than one attempt already
 * did.
 */
export const BLOCK_ATTEMPTS = 3;

/**
 * Base backoff before attempt n+1, in milliseconds. Each is jittered up to
 * double at the call site, so six blocks retrying together spread out instead
 * of re-arriving as the same burst that was just rejected.
 */
export const RETRY_BACKOFF_MS = [300, 900] as const;

/**
 * How much of the budget must survive a backoff for another attempt to be worth
 * starting. Below this the request would almost certainly be cut off by the
 * deadline mid-flight — spending an input charge to produce a timeout instead
 * of the real reason the block failed.
 */
export const MIN_ATTEMPT_HEADROOM_MS = 5_000;

/**
 * The reduced form of a provider failure: what happened, said in no provider's
 * vocabulary. HTTP statuses carry across providers; the two pseudo-statuses
 * cover the failures that arrive without one. `"timeout"` is the model still
 * answering when the clock ran out, and `"filing"` is the model's answer not
 * fitting the block's schema (KTD9) — each deliberately its own case rather
 * than folded into `null`, because `null` means the connection failed and a PM
 * who hit either of the others did not have a network problem.
 * `describeFirefliesFailure` (lib/fireflies/client.ts) draws the same
 * distinction for the same reason.
 */
export type ApiFailureStatus = number | null | "timeout" | "filing";

/**
 * Turn a failure from the extraction API into something a PM can act on.
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
 * The API's own explanation is passed through in `messages`. It names the
 * parameter or the billing state, which is the part worth reading, and it never
 * contains the key. The function takes a status rather than the thrown error so
 * it stays provider-neutral: classifying an SDK's exception into a status is
 * the adapter's job (classifyApiFailure in providers/anthropic.ts, for the
 * Anthropic SDK), and the wording here belongs to no SDK at all.
 */
export function describeApiFailure(
  status: ApiFailureStatus,
  messages: string[] = [],
  requestID?: string,
): string {
  const said = messages.length ? ` The API said: ${messages.join("; ")}` : "";
  const ref = requestID ? ` (request ${requestID})` : "";

  /**
   * A timeout is not "could not reach the API" and should not read as one. It
   * means the model was answering and had not finished — a different problem
   * with different levers, and the message names them rather than leaving the PM
   * to guess at a network fault that is not happening.
   */
  if (status === "timeout") {
    return (
      `the model did not finish this block within ${Math.round(BLOCK_TIMEOUT_MS / 1000)} seconds, ` +
      `so nothing was written for it. The other blocks are unaffected — re-run to try this one again. ` +
      `If it keeps happening the transcript is long enough to need a faster model (EXTRACTION_MODEL).`
    );
  }

  /**
   * KTD9. The model answered and the answer did not fit the block's schema —
   * a filing failure, nothing to do with reaching anything. This used to fall
   * through to the no-status branch below and tell the PM the network was down,
   * which sent them checking exactly the thing that had worked.
   */
  if (status === "filing") {
    const where = messages.length ? ` The mismatch: ${messages.join("; ")}` : "";
    return (
      `the model's answer did not fit this block's filing schema, so its drafts were not ` +
      `written. The transcript is saved — re-run to read this block again.${where}`
    );
  }

  switch (status) {
    case 401:
      // Names no provider: this function is reached from both adapters, and
      // telling a Gemini deployment its ANTHROPIC_API_KEY is wrong points the
      // one person who can fix it at the wrong variable.
      return `that API key is not valid, so no drafts were written.${said}`;
    case 403:
      return `that API key is not permitted to use this model.${said}`;
    case 404:
      // No default named: unsetting EXTRACTION_MODEL falls back to whichever
      // provider is active, and naming the other one sends the operator to a
      // model that is not going to run.
      return (
        `there is no model by that name — check EXTRACTION_MODEL, or unset it ` +
        `to fall back to the active provider's default.${said}`
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
  if (typeof status === "number" && status >= 500) {
    /**
     * The status number and the API's own words both ride along, and neither is
     * optional. This branch used to drop `said` — alone among the branches — so
     * a 5xx read as four words with nothing behind them. That is the branch a
     * real Gemini deployment lands on most often, and it left the one person
     * who could act with nothing to act on: 500, 503 and 529 are different
     * problems (an internal fault, a shed request, a provider-wide overload)
     * with different levers, and Google names which one it is in the message we
     * were collecting and discarding.
     */
    return `the API returned ${status} — the transcript is saved, so try again.${said}${ref}`;
  }
  // No status: a connection failure, or something the SDK threw before sending.
  const raw = messages.length ? ` ${messages.join("; ")}` : "";
  return `could not reach the API, so no drafts were written.${raw}`;
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
   * The same drops, attributed to the block that produced them, keyed by rubric
   * key (KTD16). The flat lists above keep their shape — the UI reads them —
   * but the per-block run record needs a count per block, and a drop's block is
   * knowable because every draft carries the rubricKey its call stamped on it.
   * A key appears only when its block dropped something; absent means zero.
   */
  droppedByBlock: Record<string, { quotes: number; claims: number }>;
  /**
   * Filings merged away because another filing carried the same span (KTD10),
   * attributed to the block whose filing lost, keyed by rubric key. Same
   * convention as `droppedByBlock`: a key appears only when its block lost
   * something. A merge is not a drop — the span survives, once — so it is a
   * sibling field rather than a third counter on the drops.
   */
  mergedByBlock: Record<string, number>;
  /**
   * Which macro-dimensions failed, if any. A partial result is kept rather than
   * discarded: five blocks of evidence is worth having, and re-running only costs
   * the PM another press. Surfaced so the failure is visible instead of looking
   * like the transcript simply had nothing in it.
   */
  failedBlocks: { rubricKey: string; label: string; reason: string; kind: ExtractionFailureKind }[];
  /**
   * Which macro-dimensions returned an answer.
   *
   * The caller needs this, not just the failures: a re-run must replace only the
   * rows for blocks it actually re-read. Without it, re-running after a partial
   * failure deleted the previous run's evidence for the blocks that had worked and
   * put nothing back — losing real work while looking like a successful retry.
   */
  succeededBlocks: string[];
}

// ------------------------------------------------------------ verbatim guard

/** True when the quote genuinely appears in the transcript. */
export function isVerbatim(transcript: string, quote: string): boolean {
  const q = normaliseForComparison(quote);
  if (!q) return false;
  return normaliseForComparison(transcript).includes(q);
}

// ----------------------------------------------------------------- the call

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
/**
 * One block's tuning, as the fan-out hands it down (KTD12, KTD14).
 *
 * A snapshot value, not a lookup: the caller reads all six rows once before
 * the fan-out and passes what it read. Six blocks reading their own row across
 * a forty-second window could straddle an admin's save and produce one call's
 * observations under two different prompts — undetectable afterwards, since
 * every row would carry the same stamp.
 */
export interface BlockTuning {
  persona?: string;
  guidance?: string;
  temperature?: number;
}

export async function extractFromTranscript(
  input: ExtractionInput,
  deps: {
    client?: ExtractionClient;
    model?: string;
    blocks?: readonly Rubric[];
    /** Keyed by rubric key. Absent entries read under the defaults. */
    tuning?: Readonly<Record<string, BlockTuning>>;
    /**
     * Backoffs between a block's attempts. A test seam, not a setting: the real
     * waits are what make the retry work against a provider shedding load, and
     * a suite that sits through them pays seconds per retryable case for no
     * added coverage. Tests pass zeroes; nothing in the app passes anything.
     */
    retryBackoffMs?: readonly number[];
  } = {},
): Promise<ExtractionResult> {
  if (!input.transcript.trim()) {
    throw new ExtractionError("cannot extract from an empty transcript", "terminal");
  }

  /**
   * The default provider is whichever one provider.ts resolves from the
   * environment (Gemini when its key is present, Anthropic otherwise),
   * constructed per run so no credential is read at import time. `deps.client`
   * keeps the old seam: tests stub at the SDK slice and every request still
   * flows through the Anthropic adapter's request build, so what a stub
   * records is what the wire would carry.
   */
  const provider: ExtractionProvider = resolveExtractionProvider({
    client: deps.client,
    model: deps.model,
  });
  const blocks = deps.blocks ?? RUBRICS;
  const userMessage = buildExtractionUserMessage(input);

  const settled = await Promise.allSettled(
    blocks.map((rubric) =>
      extractBlock(
        provider,
        rubric,
        userMessage,
        deps.tuning?.[rubric.key],
        deps.retryBackoffMs ?? RETRY_BACKOFF_MS,
      ),
    ),
  );

  const merged: ExtractionOutput = { observations: [], claims: [] };
  const failedBlocks: ExtractionResult["failedBlocks"] = [];
  const failedKinds: ExtractionFailureKind[] = [];
  const succeededBlocks: string[] = [];

  settled.forEach((outcome, i) => {
    const rubric = blocks[i];
    if (outcome.status === "fulfilled") {
      merged.observations.push(...outcome.value.observations);
      merged.claims.push(...outcome.value.claims);
      // Recorded even when the block found nothing: "read it and there was nothing
      // there" and "never read it" must not collapse into the same state.
      succeededBlocks.push(rubric.key);
      return;
    }
    const reason =
      outcome.reason instanceof ExtractionError
        ? outcome.reason.message
        : String((outcome.reason as Error)?.message ?? outcome.reason);
    /**
     * The kind rides each failed block so the UI can be honest about what a
     * re-run would do: a retryable failure is fixed by pressing the button
     * again; a terminal one fails identically on every press (KTD6).
     */
    const kind: ExtractionFailureKind =
      outcome.reason instanceof ExtractionError ? outcome.reason.kind : "unknown";
    failedBlocks.push({ rubricKey: rubric.key, label: rubric.label, reason, kind });
    failedKinds.push(kind);
  });

  // Every block failing is not a partial result, it is a failed run. Usually one
  // cause (a bad key, no credit); when the causes differ, say all of them rather
  // than picking whichever settled first. The kind survives the aggregation for
  // the same reason the messages do: a caller deciding whether a retry is worth
  // offering must not have to parse the sentence to find out — but only when the
  // blocks agree, because a mixed run has no one honest class.
  if (succeededBlocks.length === 0) {
    const reasons = [...new Set(failedBlocks.map((f) => f.reason))];
    const kinds = new Set(failedKinds);
    throw new ExtractionError(
      reasons.length === 1 ? reasons[0] : `every block failed: ${reasons.join("; ")}`,
      kinds.size === 1 ? failedKinds[0] : "unknown",
    );
  }

  /**
   * Verify first, dedupe second — in that order on purpose. The verbatim guard
   * decides what is real against the transcript; the dedupe pass (KTD10)
   * decides which real filing keeps each span, and repoints claims off the
   * losers (KTD11). Run the other way round, a span could win its contest and
   * then be dropped as a paraphrase, taking the repointed claims down with it.
   * Both passes run here, in memory: inside the persistence transaction they
   * would spend a time budget already sized against the function ceiling.
   */
  const verified = verifyDrafts(input.transcript, merged);
  const deduped = dedupeSpans({ observations: verified.observations, claims: verified.claims });

  return {
    ...verified,
    observations: deduped.observations,
    claims: deduped.claims,
    mergedByBlock: deduped.mergedByBlock,
    failedBlocks,
    succeededBlocks,
  };
}

/**
 * One macro-dimension's pass. Rejects with an ExtractionError; the caller decides
 * whether one block failing is fatal. The provider does the reading; this frame
 * renders the block's prompt, stamps the rubric key on what comes back, and
 * prefixes the block's label onto any failure so an aggregated message still
 * names which block it was.
 */
async function extractBlock(
  provider: ExtractionProvider,
  rubric: Rubric,
  userMessage: string,
  tuning: BlockTuning | undefined,
  backoffs: readonly number[],
): Promise<ExtractionOutput> {
  let parsed: z.infer<ReturnType<typeof outputSchemaFor>> | undefined;

  /**
   * The block's whole budget, spent across however many attempts fit inside it.
   *
   * R5 keeps retries off at the *provider* layer, and that stays true — the
   * adapters still make exactly one HTTP call each and neither SDK is allowed
   * its own retry loop. What R5 was protecting is that a block's time bound
   * bounds the block, and the deadline here is what actually enforces that:
   * every attempt is given only the time still left, so two attempts cost the
   * same wall clock as one did. The 60-second function ceiling never sees a
   * difference.
   *
   * The reason to retry at all is that R5 was reasoned about timeouts, where a
   * second attempt costs another full block bound and cannot fit. A 5xx is the
   * opposite shape: Gemini sheds a request in well under a second, so retrying
   * costs almost nothing and is the difference between one click and three. The
   * deadline tells the two cases apart without naming either — a timeout has
   * already spent the budget, so the loop exits on its own.
   */
  const deadline = Date.now() + BLOCK_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < BLOCK_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      parsed = await provider.extractBlock({
        rubricKey: rubric.key,
        system: systemPromptFor(rubric, tuning ?? {}),
        user: userMessage,
        schema: outputSchemaFor(rubric),
        timeoutMs: remaining,
        ...(tuning?.temperature !== undefined ? { temperature: tuning.temperature } : {}),
      });
      lastError = undefined;
      break;
    } catch (e) {
      lastError = e;
      /**
       * Only a retryable class is worth a second press, and only when what is
       * left of the budget could actually hold one. A filing failure is the
       * model's answer not fitting the schema and a terminal one is a refusal —
       * both are deterministic, so re-asking spends another full input charge
       * to be told the same thing.
       *
       * Jittered, because six blocks fail together and six identical backoffs
       * would re-send them as one burst — the shape that got them shed in the
       * first place.
       */
      const retryable = e instanceof ExtractionError && e.kind === "retryable";
      const backoff = backoffs[attempt] ?? 0;
      const wait = backoff + Math.floor(Math.random() * backoff);
      if (!retryable || attempt === BLOCK_ATTEMPTS - 1) break;
      if (deadline - Date.now() - wait < MIN_ATTEMPT_HEADROOM_MS) break;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  if (lastError !== undefined) {
    // The label prefix belongs to the fan-out, not the adapter: the adapter
    // reads one block and does not know its human name. The kind carries.
    if (lastError instanceof ExtractionError) {
      throw new ExtractionError(`${rubric.label}: ${lastError.message}`, lastError.kind);
    }
    throw new ExtractionError(
      `${rubric.label}: ${String((lastError as Error)?.message ?? lastError)}`,
      "unknown",
    );
  }
  /**
   * Unreachable while the deadline is set from a positive budget, and it throws
   * rather than defaulting because of what the alternative would mean. An empty
   * result here is indistinguishable from a clean read of a block with nothing
   * in it, and a clean read is what licenses the re-run to delete the previous
   * run's rows for this block (KTD5). Defaulting would hand that delete a block
   * that was never sent.
   */
  if (parsed === undefined) {
    throw new ExtractionError(
      `${rubric.label}: the block's time budget was spent before a request was sent.`,
      "retryable",
    );
  }

  // The block schema omits rubricKey — it is implied by which call this was, so
  // asking the model for it would only create a way for it to be wrong. Stamped on
  // claims as well as observations, because the claim-to-anchor match needs it.
  return {
    observations: parsed.observations.map((o) => ({ ...o, rubricKey: rubric.key })),
    claims: parsed.claims.map((c) => ({ ...c, rubricKey: rubric.key })),
  };
}

/**
 * Apply the verbatim guard, and keep only the claims whose anchor survived it.
 * Split out from the API call so it can be tested directly.
 */
export function verifyDrafts(
  transcript: string,
  parsed: ExtractionOutput,
): Omit<ExtractionResult, "failedBlocks" | "succeededBlocks" | "mergedByBlock"> {
  const observations: DraftObservation[] = [];
  const droppedQuotes: string[] = [];
  const droppedByBlock: ExtractionResult["droppedByBlock"] = {};
  const dropsFor = (rubricKey: string) =>
    (droppedByBlock[rubricKey] ??= { quotes: 0, claims: 0 });

  for (const o of parsed.observations) {
    if (isVerbatim(transcript, o.quote)) observations.push(o);
    else {
      droppedQuotes.push(o.quote);
      dropsFor(o.rubricKey).quotes++;
    }
  }

  /**
   * A claim is only as good as the quote holding it up. If the anchor was
   * dropped, the claim has nothing to point at and goes with it rather than
   * becoming a free-floating assertion in the ledger.
   *
   * Kept-set keyed on block *and* quote — the same `anchorKey` the transaction's
   * anchor map uses — not on the quote alone. Keyed on the quote alone, a claim
   * whose own block never observed its anchor survived here on the strength of
   * another block's observation, and was then dropped by the transaction's map
   * with no counter anywhere. Same key both places means a claim that survives
   * this guard is one the transaction can actually place.
   */
  const kept = new Set(observations.map((o) => anchorKey(o.rubricKey, o.quote)));
  const claims: DraftClaim[] = [];
  const droppedClaims: string[] = [];

  for (const c of parsed.claims) {
    if (kept.has(anchorKey(c.rubricKey, c.anchorQuote))) claims.push(c);
    else {
      droppedClaims.push(c.text);
      // Attributed to the block whose call returned the claim — the same key
      // the transaction's anchor map uses to place it.
      dropsFor(c.rubricKey).claims++;
    }
  }

  return { observations, claims, droppedQuotes, droppedClaims, droppedByBlock };
}
