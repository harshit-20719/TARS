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
import { ExtractionOutputSchema, type DraftClaim, type DraftObservation, type ExtractionOutput } from "./schema";
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage } from "./prompt";

/** Default model. Sonnet 5 is the documented high-volume swap (spec D6). */
export const DEFAULT_EXTRACTION_MODEL = "claude-opus-5";

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * The slice of the Anthropic client this service uses. Narrow on purpose so a
 * test stub is a few lines rather than a mock of the whole SDK.
 */
export interface ExtractionClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<{
      parsed_output: ExtractionOutput | null;
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
 * Draft observations and claims from one transcript.
 *
 * Thinking is left enabled at medium effort. Disabling it on this model tier can
 * make a tool call arrive as plain text and can leak internal tags into the
 * output — neither is worth risking for a marginal saving on a step whose output
 * a person is going to read line by line.
 */
export async function extractFromTranscript(
  input: ExtractionInput,
  deps: { client?: ExtractionClient; model?: string } = {},
): Promise<ExtractionResult> {
  if (!input.transcript.trim()) {
    throw new ExtractionError("cannot extract from an empty transcript");
  }

  const client = resolveClient(deps.client);
  // An empty EXTRACTION_MODEL should fall through to the default, hence || here.
  const model = deps.model ?? (process.env.EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL);

  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: EXTRACTION_SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(ExtractionOutputSchema),
    },
    messages: [{ role: "user", content: buildExtractionUserMessage(input) }],
  });

  // Check the refusal before reading content: on a refusal the content is empty
  // or partial, and reading it as a result would silently persist nothing while
  // reporting success.
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category ?? "unspecified";
    throw new ExtractionError(
      `the model declined to process this transcript (${category}); no drafts were written`,
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new ExtractionError("the model returned no parseable output");
  }

  return verifyDrafts(input.transcript, parsed);
}

/**
 * Apply the verbatim guard, and keep only the claims whose anchor survived it.
 * Split out from the API call so it can be tested directly.
 */
export function verifyDrafts(transcript: string, parsed: ExtractionOutput): ExtractionResult {
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
