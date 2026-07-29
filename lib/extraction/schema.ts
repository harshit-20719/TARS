/**
 * The shape the model must return.
 *
 * The key field is an enum built from the frozen rubric config, not a free string.
 * That is deliberate: with structured outputs the model is constrained to the
 * schema, so it becomes structurally impossible for it to invent a sub-dimension
 * key. Mapping errors turn into schema violations the SDK retries on, rather than
 * orphaned rows nobody notices.
 *
 * The schema is built **per macro-dimension**. Extraction runs one call per block
 * (see extract.ts), and narrowing the enum to that block does two things at once:
 * cross-filing becomes impossible rather than merely discouraged, and the schema
 * the model has to hold in mind shrinks from forty-one rows to six or seven.
 *
 * Note what is absent: there is no score field anywhere. The machine drafts
 * observations and claims; a person authors every score (spec R5). The service
 * cannot write one because the schema gives it nowhere to put one.
 *
 * `confidence` is not a score. It is the model rating its own filing — "does this
 * quote belong to this row" — which is a clerical question, not a judgment about
 * the founder. That distinction is what lets a confident mapping file itself while
 * an unsure one waits for a human.
 */

import * as z from "zod";
import { ALL_SUBS, RUBRICS, type Rubric } from "@/framework";

const CONFIDENCE = ["high", "low"] as const;

const ORIGIN_TAGS = [
  "founder-volunteered",
  "founder-confirmed-after-PM-framing",
  "machine-inferred",
] as const;

/** Fields every drafted observation carries, whichever block it came from. */
const observationFields = {
  /** Verbatim excerpt from the transcript. Checked against the source before persisting. */
  quote: z.string(),
  /** Nullable rather than optional — structured outputs require every key present. */
  speaker: z.string().nullable(),
  timestamp: z.string().nullable(),
  /**
   * How sure the model is that this quote belongs to this row — its own filing
   * confidence, never a view on the founder.
   */
  confidence: z.enum(CONFIDENCE),
  /** One clause on why this row. Read by the PM while scoring. */
  mappingNote: z.string(),
};

export const DraftClaimSchema = z.object({
  /** The claim in the founder's terms, as one sentence. */
  text: z.string(),
  /** The quote this claim is anchored to; must match one of the observations above. */
  anchorQuote: z.string(),
  originTag: z.enum(ORIGIN_TAGS),
});

/**
 * The output schema for one macro-dimension's pass over a transcript.
 *
 * Built per block so `subDimensionKey` can only be one of that block's rows.
 */
export function outputSchemaFor(rubric: Rubric) {
  const keys = rubric.subs.map((s) => s.key) as [string, ...string[]];
  return z.object({
    observations: z.array(
      z.object({
        ...observationFields,
        subDimensionKey: z.enum(keys),
      }),
    ),
    claims: z.array(DraftClaimSchema),
  });
}

/**
 * The whole-rubric schema. Retained for the single-pass path — the health check's
 * request-shape report reads it, and it is what a caller extracting against every
 * row at once would use.
 */
export const ExtractionOutputSchema = z.object({
  observations: z.array(
    z.object({
      ...observationFields,
      rubricKey: z.enum(RUBRICS.map((r) => r.key) as [string, ...string[]]),
      subDimensionKey: z.enum(ALL_SUBS.map((s) => s.key) as [string, ...string[]]),
    }),
  ),
  claims: z.array(DraftClaimSchema),
});

/** A drafted observation as the service handles it, with its block resolved. */
export interface DraftObservation {
  quote: string;
  rubricKey: string;
  subDimensionKey: string;
  speaker: string | null;
  timestamp: string | null;
  confidence: (typeof CONFIDENCE)[number];
  mappingNote: string;
}

/**
 * A drafted claim as the service handles it, with its block resolved.
 *
 * `rubricKey` is not asked of the model — it is implied by which block's call
 * returned the claim. It matters because a claim is matched back to its anchor
 * observation by quote text, and the same quote legitimately arrives from more than
 * one block; without the block, that match is ambiguous.
 */
export type DraftClaim = z.infer<typeof DraftClaimSchema> & { rubricKey: string };

export interface ExtractionOutput {
  observations: DraftObservation[];
  claims: DraftClaim[];
}
