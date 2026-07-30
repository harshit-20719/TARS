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
/**
 * The vocabularies come from types.ts, where the shapes the rest of TARS reads
 * live, so the schemas here and the interfaces there cannot disagree about what
 * a confidence or an origin tag may say. The types themselves are re-exported
 * below for existing importers; new code should take them from
 * lib/extraction/types directly.
 */
import { CONFIDENCE, ORIGIN_TAGS } from "./types";

export type { DraftClaim, DraftObservation, ExtractionOutput } from "./types";

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
 * The same block schema, projected into the JSON-Schema subset Gemini's
 * structured output actually honours.
 *
 * Hand-built rather than generated from the Zod schema above, because the
 * target is not JSON Schema — it is Gemini's *subset* of it, and the ways a
 * generator misses that subset are all silent or fatal. `$schema` at the top
 * level is a 400. `maxLength`, `pattern`, `allOf`, `const` are simply not in
 * the supported keyword list, so a generator that emits them produces a schema
 * that looks stricter than what the model is actually held to. Building the
 * projection by hand from the same frozen rubric keeps every keyword inside
 * the supported set by construction: `$id $defs $ref $anchor type format title
 * description enum items prefixItems minItems maxItems minimum maximum anyOf
 * oneOf properties additionalProperties required propertyOrdering`.
 *
 * Three deliberate choices:
 *
 * - `subDimensionKey` is a real `enum` of this block's rows — the same
 *   cross-filing impossibility outputSchemaFor establishes, enforced by the
 *   provider's constrained decoding rather than merely re-checked after.
 * - Nullable fields are spelled `anyOf: [{type}, {type: "null"}]`, the one
 *   nullability shape this subset supports (`nullable` is OpenAPI, not here).
 * - `propertyOrdering` puts `quote` before `confidence`: ordering controls
 *   *generation* order, and a model that writes the quote down first is rating
 *   a quote it has already committed to, not one it is still free to bend
 *   toward the confidence it just claimed.
 *
 * No length caps anywhere — `maxLength` is unsupported, so the quote-length
 * bound has to be a prompt-side instruction (U6), not a schema clause.
 *
 * The Zod re-validation in the adapter stays regardless of this projection:
 * constrained decoding guarantees shape, not semantics, and the guard on what
 * enters the ledger belongs to the adapter (KTD9).
 */
export function geminiResponseJsonSchemaFor(rubric: Rubric): Record<string, unknown> {
  const keys = rubric.subs.map((s) => s.key);
  const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

  const observation = {
    type: "object",
    properties: {
      quote: { type: "string" },
      speaker: nullableString,
      timestamp: nullableString,
      subDimensionKey: { type: "string", enum: keys },
      mappingNote: { type: "string" },
      confidence: { type: "string", enum: [...CONFIDENCE] },
    },
    // Every field, mappingNote included: an observation with no note is not a
    // shorter observation, it is one the PM cannot read the filing of.
    required: ["quote", "speaker", "timestamp", "subDimensionKey", "mappingNote", "confidence"],
    additionalProperties: false,
    propertyOrdering: ["quote", "speaker", "timestamp", "subDimensionKey", "mappingNote", "confidence"],
  };

  const claim = {
    type: "object",
    properties: {
      text: { type: "string" },
      anchorQuote: { type: "string" },
      originTag: { type: "string", enum: [...ORIGIN_TAGS] },
    },
    required: ["text", "anchorQuote", "originTag"],
    additionalProperties: false,
    propertyOrdering: ["text", "anchorQuote", "originTag"],
  };

  return {
    type: "object",
    properties: {
      observations: { type: "array", items: observation },
      claims: { type: "array", items: claim },
    },
    required: ["observations", "claims"],
    additionalProperties: false,
    propertyOrdering: ["observations", "claims"],
  };
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
