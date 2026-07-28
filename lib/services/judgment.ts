/**
 * The write side of judgment: the 0–10 pillar and track slides, and the
 * founder-type read.
 *
 * A slide is a human read, not a computation. Nothing in here derives a slide
 * from the scores that root to it — no average, no max, no weighting — because
 * the moment the app computes a slide, the number stops being anybody's judgment
 * and the ceiling guard becomes decoration. The PM supplies the value; the code's
 * job is to hold them to the L1 cap and to make them say what set the ceiling.
 */

import * as z from "zod";
import { db } from "@/lib/db";
import { slideDefByKey } from "@/framework";
import { fromLens } from "@/lib/domain/codec";
import { RuleViolation, assertLayer, assertSlide } from "@/lib/domain/rules";
import { assertMayAuthor, type Actor } from "@/lib/authz";
import type { Lens } from "@/mock/types";

// ------------------------------------------------------------------- slides

export const SetSlideInput = z.object({
  dealId: z.string().trim().min(1),
  slideKey: z.string().trim().min(1),
  value: z.coerce.number().int(),
  provisionalValue: z.coerce.number().int().nullable().optional(),
  ceilingGuard: z.string().trim().min(1, "Name what set the ceiling."),
  /**
   * Whether a human signed off on the guard line, or left the machine's
   * suggestion standing. Defaults to false so a caller that does not know about
   * confirmation cannot accidentally assert one.
   */
  guardConfirmed: z.coerce.boolean().optional(),
});

/**
 * Author one slide.
 *
 * The lens is not accepted from the caller — it is a property of the pillar or
 * track in the frozen framework config, so it is looked up rather than supplied.
 * A caller cannot relabel a weakest-link slide as a peak read and change what the
 * number means.
 */
export async function setSlide(actor: Actor, raw: unknown) {
  assertMayAuthor(actor);
  assertLayer("L1");

  const input = SetSlideInput.parse(raw);
  const def = slideDefByKey(input.slideKey);
  if (!def) throw new RuleViolation(`no such pillar or track: ${input.slideKey}`, "slideKey");

  const lens: Lens = def.lens;
  assertSlide({
    slideKey: input.slideKey,
    value: input.value,
    provisionalValue: input.provisionalValue ?? null,
    ceilingGuard: input.ceilingGuard,
    lens,
  });

  const fields = {
    value: input.value,
    provisionalValue: input.provisionalValue ?? null,
    lens: fromLens(lens),
    ceilingGuard: input.ceilingGuard.trim(),
    guardConfirmed: input.guardConfirmed ?? false,
    authorId: actor.id,
  };

  await db.slide.upsert({
    where: {
      dealId_slideKey_layer: { dealId: input.dealId, slideKey: input.slideKey, layer: "L1" },
    },
    update: fields,
    create: { dealId: input.dealId, slideKey: input.slideKey, layer: "L1", ...fields },
  });
}

export async function clearSlide(actor: Actor, dealId: string, slideKey: string) {
  assertMayAuthor(actor);
  await db.slide.deleteMany({ where: { dealId, slideKey, layer: "L1" } });
}

// ------------------------------------------------------- founder-type read

export const SetFounderTypeReadInput = z.object({
  dealId: z.string().trim().min(1),
  primary: z.string().trim().min(1, "Name the primary founder type."),
  secondary: z.string().trim().nullable().optional(),
  profile: z.string().trim().default(""),
  floorDimension: z.string().trim().default(""),
  // The PM's own line. Required, because the type read is context the PM has to
  // own rather than a label the app applies to a founder on their behalf.
  pmConfirmation: z.string().trim().min(1, "Confirm or override the read in one line."),
});

export async function setFounderTypeRead(actor: Actor, raw: unknown) {
  assertMayAuthor(actor);
  const input = SetFounderTypeReadInput.parse(raw);

  const fields = {
    primary: input.primary,
    secondary: input.secondary ?? null,
    profile: input.profile,
    floorDimension: input.floorDimension,
    pmConfirmation: input.pmConfirmation,
    authorId: actor.id,
  };

  await db.founderTypeRead.upsert({
    where: { dealId: input.dealId },
    update: fields,
    create: { dealId: input.dealId, ...fields },
  });
}
