/**
 * The write side of extraction tuning: one rubric's persona, guidance note, and
 * temperature (R17–R19; KTD12, KTD13).
 *
 * Like the people service, this takes the acting user as an argument rather
 * than reading the session, so the suite can drive it directly — and like that
 * service its permission check actually narrows something: what an admin saves
 * here is read into every future run for every deal, so it is gated on the
 * tuning authority, never the author guard that admits every role.
 *
 * The temperature cap is enforced three places on purpose (KTD13): here in the
 * schema with a sentence a person reads, in the migration as a named CHECK that
 * stops even a raw write, and on the control's bounds (U11). The cap is
 * absolute — above 0.4 the verbatim guard's drop rate rises, so raising
 * temperature buys silence, not colour.
 */

import * as z from "zod";

import { RUBRICS } from "@/framework/rubrics";
import { assertMayTuneExtraction, type Actor } from "@/lib/authz";
import { saveExtractionConfig } from "@/lib/repo/extractionConfig";

/**
 * The length caps, sized against the per-block prompt budget rather than the
 * column (both are TEXT — the database does not care). The six system prompts
 * measure 2,089–2,770 tokens and run concurrently, so the tuning text has to
 * stay a seasoning, not a second prompt: 500 characters of persona and 1,500 of
 * guidance is roomy prose (~125 and ~375 tokens) that together cannot grow any
 * block past a quarter of its existing prompt.
 */
export const PERSONA_MAX = 500;
export const GUIDANCE_MAX = 1500;

/** The absolute temperature ceiling (KTD13). The migration enforces it too. */
export const TEMPERATURE_MAX = 0.4;

/**
 * Derived from the framework so the accepted set cannot drift from the rubrics
 * — the same reason SetRoleInput validates against Prisma's own Role. Note the
 * collision hazard: the rubric "pm" is Problem & Market; the Role "PM" is a
 * person. The enum is exact, so the uppercase role name is refused here.
 */
const RUBRIC_KEYS = RUBRICS.map((rubric) => rubric.key) as [string, ...string[]];

export const SaveRubricExtractionConfigInput = z.object({
  rubricKey: z.enum(RUBRIC_KEYS, "That is not a rubric."),
  persona: z
    .string()
    .trim()
    .max(PERSONA_MAX, `A persona can hold at most ${PERSONA_MAX} characters.`),
  guidance: z
    .string()
    .trim()
    .max(GUIDANCE_MAX, `Guidance can hold at most ${GUIDANCE_MAX} characters.`),
  temperature: z
    .number()
    .min(0, `Temperature runs from 0 to ${TEMPERATURE_MAX}.`)
    .max(TEMPERATURE_MAX, `Temperature runs from 0 to ${TEMPERATURE_MAX}.`),
});

/**
 * Save one rubric's tuning. Creates the row on first save; bumps the version on
 * every save after, so a stamped observation stays traceable to its text.
 */
export async function saveRubricExtractionConfig(actor: Actor, raw: unknown): Promise<void> {
  assertMayTuneExtraction(actor);
  const input = SaveRubricExtractionConfigInput.parse(raw);

  await saveExtractionConfig({ ...input, updatedById: actor.id });
}
