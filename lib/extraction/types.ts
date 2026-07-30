/**
 * What lib/extraction lets out — and the seam the providers stand behind.
 *
 * The module is a boundary in the lib/fireflies sense: the wire shapes stay
 * inside. No provider's request format, SDK class, or response envelope appears
 * in this file, and nothing importing it pulls a provider SDK into its module
 * graph. That is the whole point of the file. `ExtractionError` used to live in
 * extract.ts beside the Anthropic import, so every server action recognising an
 * extraction failure dragged the SDK along with it — the exact problem
 * lib/fireflies/types.ts was written to avoid, argued at length in its header.
 *
 * What crosses the boundary is small: the port a provider adapter implements,
 * the draft shapes the rest of TARS reads, and the error the action layer
 * converts into a value. The credential is not here either — resolving it is
 * provider.ts's job, on the server, per adapter (KTD4).
 */

import type * as z from "zod";

// ---------------------------------------------------------------- the port

/**
 * One block's ask of a provider, in nobody's vocabulary.
 *
 * The rubric key rides along explicitly (KTD7). It is not for the model — the
 * caller knows which block it is asking and stamps the key on what comes back —
 * it is for everything *around* the model: a test stub routes its answers on
 * it, a run record names the block it read, and neither should have to
 * reverse-engineer the block out of a generated prompt string. Routing on the
 * prompt text is what the old stubs did, and the failure mode was silent: an
 * unmatched prompt fell through to a default payload that answered every block
 * the same way, and the mistake surfaced as a dozen wrong counts rather than as
 * a routing error.
 */
export interface ExtractionBlockRequest<T> {
  /** Which macro-dimension this call reads. Routing and reporting key on it. */
  rubricKey: string;
  /** The block's system prompt, already rendered. */
  system: string;
  /** The transcript message, already rendered. */
  user: string;
  /** The block's output schema. The adapter validates against it before returning. */
  schema: z.ZodType<T>;
  /** Provider default when absent. Carried for the per-rubric tuning to come. */
  temperature?: number;
  /** How long this one call may take before the adapter gives up, in milliseconds. */
  timeoutMs: number;
}

/**
 * The one thing a provider adapter does: read one block, return validated
 * output or throw an ExtractionError.
 *
 * There is no partially-read state (KTD5): a block either comes back as output
 * that satisfied the schema, or it throws and the caller records a failed
 * block. Injectable exactly like the older ExtractionClient — a test stub is a
 * plain object with one async method, no SDK anywhere near it.
 */
export interface ExtractionProvider {
  extractBlock<T>(request: ExtractionBlockRequest<T>): Promise<T>;
}

// ------------------------------------------------------------ the taxonomy

/**
 * What kind of failure this was, machine-readable (KTD5).
 *
 * A clean read is not an error, so it has no class here. Everything that throws
 * is one of these:
 *
 * - `retryable` — the provider was rate-limiting, unavailable, unreachable, or
 *   out of time. Nothing about the transcript caused it; pressing the button
 *   again is the remedy.
 * - `terminal` — a re-run will fail the same way: a bad key, an unknown model,
 *   a transcript too large, a refused request. Something has to change first.
 * - `filing` — the provider answered, and the answer did not fit the block's
 *   schema (KTD9). Not a network problem and it must never read as one.
 * - `unknown` — the neutral default, for errors constructed before the caller
 *   knew (or cared) which of the above applied. Existing throw sites keep their
 *   one-argument constructor and land here.
 *
 * Callers branch on this field rather than string-matching the message, which
 * exists for a person and changes for a person's reasons.
 */
export type ExtractionFailureKind = "retryable" | "terminal" | "filing" | "unknown";

/**
 * Declared beside the contract rather than beside the request build, so
 * lib/actions.ts can recognise an extraction failure without importing the
 * module that imports a provider SDK — the same argument FirefliesError makes
 * in lib/fireflies/types.ts, made here first and honoured here last.
 */
export class ExtractionError extends Error {
  readonly kind: ExtractionFailureKind;

  constructor(message: string, kind: ExtractionFailureKind = "unknown") {
    super(message);
    this.name = "ExtractionError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------- the draft shapes

/**
 * The model's confidence in its own filing — "does this quote belong to this
 * row" — which is a clerical question, never a judgment about the founder.
 * Kept to two levels so it cannot drift into being a score by another name.
 */
export const CONFIDENCE = ["high", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const ORIGIN_TAGS = [
  "founder-volunteered",
  "founder-confirmed-after-PM-framing",
  "machine-inferred",
] as const;
export type OriginTag = (typeof ORIGIN_TAGS)[number];

/**
 * A drafted observation as the service handles it, with its block resolved.
 *
 * Note what is absent: a score. The machine drafts, a person scores (spec R5),
 * and the shapes crossing this boundary give a rating nowhere to go.
 */
export interface DraftObservation {
  quote: string;
  rubricKey: string;
  subDimensionKey: string;
  speaker: string | null;
  timestamp: string | null;
  confidence: Confidence;
  mappingNote: string;
}

/**
 * A drafted claim as the service handles it, with its block resolved.
 *
 * `rubricKey` is not asked of the model — it is implied by which block's call
 * returned the claim. It matters because a claim is matched back to its anchor
 * observation by quote text, and the same quote legitimately arrives from more
 * than one block; without the block, that match is ambiguous.
 */
export interface DraftClaim {
  /** The claim in the founder's terms, as one sentence. */
  text: string;
  /** The quote this claim is anchored to; must match one of the observations. */
  anchorQuote: string;
  originTag: OriginTag;
  rubricKey: string;
}

export interface ExtractionOutput {
  observations: DraftObservation[];
  claims: DraftClaim[];
}
