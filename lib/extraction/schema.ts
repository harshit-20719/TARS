/**
 * The shape the model must return.
 *
 * The two key fields are enums built from the frozen rubric config, not free
 * strings. That is deliberate: with structured outputs the model is constrained
 * to the schema, so it becomes structurally impossible for it to invent a
 * sub-dimension key or file an observation under a rubric that does not exist.
 * Mapping errors turn into schema violations the SDK retries on, rather than
 * orphaned rows nobody notices.
 *
 * Note what is absent: there is no score field anywhere. The machine drafts
 * observations and claims; the PM authors every score (spec R5). The service
 * cannot write one because the schema gives it nowhere to put one.
 */

import * as z from "zod";
import { ALL_SUBS, RUBRICS } from "@/framework";

const RUBRIC_KEYS = RUBRICS.map((r) => r.key) as [string, ...string[]];
const SUB_KEYS = ALL_SUBS.map((s) => s.key) as [string, ...string[]];

export const DraftObservationSchema = z.object({
  /** Verbatim excerpt from the transcript. Checked against the source before persisting. */
  quote: z.string(),
  rubricKey: z.enum(RUBRIC_KEYS),
  subDimensionKey: z.enum(SUB_KEYS),
  /** Nullable rather than optional — structured outputs require every key present. */
  speaker: z.string().nullable(),
  timestamp: z.string().nullable(),
});

export const DraftClaimSchema = z.object({
  /** The claim in the founder's terms, as one sentence. */
  text: z.string(),
  /** The quote this claim is anchored to; must match one of the observations above. */
  anchorQuote: z.string(),
  originTag: z.enum([
    "founder-volunteered",
    "founder-confirmed-after-PM-framing",
    "machine-inferred",
  ]),
});

export const ExtractionOutputSchema = z.object({
  observations: z.array(DraftObservationSchema),
  claims: z.array(DraftClaimSchema),
});

export type DraftObservation = z.infer<typeof DraftObservationSchema>;
export type DraftClaim = z.infer<typeof DraftClaimSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
