/**
 * The write side of capture: deals, calls, extraction, observation review, and
 * sub-dimension scores.
 *
 * These take the acting user as an argument rather than reading the session
 * themselves. That keeps them ordinary functions the test suite can drive
 * directly, and leaves lib/actions.ts as the only place that touches auth — one
 * seam to audit instead of one per mutation.
 *
 * Every function that changes a score or an observation runs the domain rules
 * first (lib/domain/rules.ts). Nothing writes past them.
 */

import * as z from "zod";

import { db } from "@/lib/db";
import { subByKey } from "@/framework";
import { encodeScoreValue, parseRecordDate } from "@/lib/domain/codec";
import { assertLayer, assertScoreValue } from "@/lib/domain/rules";
import { RuleViolation } from "@/lib/domain/rules";
import { assertMayAuthor, assertMayDeleteDeal, type Actor } from "@/lib/authz";
import {
  extractFromTranscript,
  normaliseForComparison,
  type ExtractionClient,
  type ExtractionResult,
} from "@/lib/extraction/extract";
import type { ObservationStatus, ScoreValue } from "@/mock/types";

// -------------------------------------------------------------------- deals

export const CreateDealInput = z.object({
  company: z.string().trim().min(1, "A company name is required."),
  oneLiner: z.string().trim().min(1, "A one-line description is required."),
  founders: z.string().trim().min(1, "Name at least one founder."),
  opened: z.string().trim().optional(),
});

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "deal"
  );
}

/** A readable, stable id derived from the company name, de-duplicated on collision. */
async function uniqueDealId(company: string): Promise<string> {
  const base = slugify(company);
  for (let n = 0; n < 50; n++) {
    const id = n === 0 ? base : `${base}-${n + 1}`;
    if (!(await db.deal.findUnique({ where: { id }, select: { id: true } }))) return id;
  }
  throw new RuleViolation(`could not derive a free id for "${company}"`, "company");
}

export async function createDeal(actor: Actor, raw: unknown) {
  assertMayAuthor(actor);
  const input = CreateDealInput.parse(raw);

  const deal = await db.deal.create({
    data: {
      id: await uniqueDealId(input.company),
      company: input.company,
      oneLiner: input.oneLiner,
      founders: input.founders,
      // Kept for the record contract; the owner relation is what actually attributes it.
      ownerPm: actor.name ?? actor.email,
      ownerId: actor.id,
      opened: input.opened ? parseRecordDate(input.opened) : new Date(),
      layer: "L1",
    },
  });
  return deal.id;
}

export const UpdateDealInput = CreateDealInput.partial();

export async function updateDeal(actor: Actor, dealId: string, raw: unknown) {
  assertMayAuthor(actor);
  const input = UpdateDealInput.parse(raw);
  await db.deal.update({
    where: { id: dealId },
    data: {
      ...(input.company !== undefined ? { company: input.company } : {}),
      ...(input.oneLiner !== undefined ? { oneLiner: input.oneLiner } : {}),
      ...(input.founders !== undefined ? { founders: input.founders } : {}),
      ...(input.opened !== undefined ? { opened: parseRecordDate(input.opened) } : {}),
    },
  });
}

// -------------------------------------------------------------------- calls

export const AddCallInput = z.object({
  dealId: z.string().trim().min(1),
  // Required, not defaulted: the framework tracks which call evidence came from,
  // and silently guessing "1" would corrupt that for every later call.
  number: z.coerce.number().int().min(1, "Tag the transcript with a call number."),
  label: z.string().trim().min(1, "Give the call a label."),
  date: z.string().trim().optional(),
  transcript: z.string().trim().min(1, "Paste the transcript."),
});

export async function addCall(actor: Actor, raw: unknown) {
  assertMayAuthor(actor);
  const input = AddCallInput.parse(raw);

  const existing = await db.call.findUnique({
    where: { dealId_number: { dealId: input.dealId, number: input.number } },
    select: { id: true },
  });
  if (existing) {
    throw new RuleViolation(`call ${input.number} already exists for this deal`, "number");
  }

  const call = await db.call.create({
    data: {
      dealId: input.dealId,
      number: input.number,
      label: input.label,
      date: input.date ? parseRecordDate(input.date) : new Date(),
      transcript: input.transcript,
    },
  });
  return call.id;
}

/**
 * Remove a call and its transcript.
 *
 * The observations drafted from it are left alone deliberately. They carry a
 * `callNumber`, not a foreign key, so they survive — and that is the right
 * outcome: a PM who has already accepted a quote as evidence should not lose it
 * because the transcript it came from was re-pasted. Deleting the deal is the way
 * to discard everything.
 */
export async function deleteCall(actor: Actor, callId: string) {
  assertMayAuthor(actor);
  await db.call.delete({ where: { id: callId } });
}

/**
 * Delete a deal and everything recorded against it.
 *
 * Irreversible, and it cascades: calls, observations, claims, scores and their
 * evidence links, slides, and the founder-type read all go. That is the point —
 * a practice run should leave nothing behind — but it is also why the permission
 * is narrower than authoring (see canDeleteDeal) and why the UI makes you type
 * the company name rather than clicking a confirm.
 */
export async function deleteDeal(actor: Actor, dealId: string) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { ownerId: true } });
  if (!deal) throw new RuleViolation(`no such deal: ${dealId}`, "dealId");
  assertMayDeleteDeal(actor, deal.ownerId);
  await db.deal.delete({ where: { id: dealId } });
}

// --------------------------------------------------------------- extraction

export interface RunExtractionOptions {
  client?: ExtractionClient;
  model?: string;
  /** Re-run over a call already extracted, replacing drafts the PM has not ruled on. */
  force?: boolean;
}

export interface RunExtractionSummary extends ExtractionResult {
  observationsWritten: number;
  claimsWritten: number;
}

/**
 * Draft observations and claims for one call and persist them.
 *
 * Re-running is guarded. An already-extracted call keeps whatever the PM has
 * accepted, edited, or rejected — only untouched drafts are replaced — because
 * silently discarding a review pass is worse than refusing to repeat one.
 */
export async function runExtractionForCall(
  actor: Actor,
  callId: string,
  options: RunExtractionOptions = {},
): Promise<RunExtractionSummary> {
  assertMayAuthor(actor);

  const call = await db.call.findUnique({
    where: { id: callId },
    include: { deal: { select: { company: true } } },
  });
  if (!call) throw new RuleViolation(`no such call: ${callId}`, "callId");
  if (call.extracted && !options.force) {
    throw new RuleViolation(
      "this call has already been extracted; re-running would duplicate its drafts",
      "callId",
    );
  }

  const result = await extractFromTranscript(
    {
      transcript: call.transcript,
      callNumber: call.number,
      company: call.deal.company,
      callLabel: call.label,
    },
    { client: options.client, model: options.model },
  );

  /**
   * Batched, and given a longer ceiling than the default.
   *
   * The first version wrote one row per round trip inside the transaction — a
   * couple of dozen sequential queries against a connection that goes through
   * Prisma Postgres's proxy. Prisma's interactive transactions time out after
   * five seconds by default, so a slow network turned a successful extraction
   * into a failed write, and the model tokens were paid for either way. Four
   * queries instead of N, and a ceiling that a bad minute cannot reach.
   */
  const written = await db.$transaction(
    async (tx) => {
      // Only drafts are cleared. Anything the PM ruled on stays.
      await tx.observation.deleteMany({
        where: { dealId: call.dealId, callNumber: call.number, status: "draft" },
      });

      await tx.observation.createMany({
        data: result.observations.map((o) => ({
          dealId: call.dealId,
          callNumber: call.number,
          rubricKey: o.rubricKey,
          subDimensionKey: o.subDimensionKey,
          quote: o.quote,
          speaker: o.speaker,
          timestamp: o.timestamp,
          status: "draft" as const,
          layer: "L1" as const,
        })),
      });

      // createMany does not return ids, and claims need one to anchor to.
      const persisted = await tx.observation.findMany({
        where: { dealId: call.dealId, callNumber: call.number, status: "draft" },
        select: { id: true, quote: true },
      });
      const quoteToId = new Map(persisted.map((o) => [normaliseForComparison(o.quote), o.id]));

      const claimRows = result.claims.flatMap((c) => {
        const anchorObsId = quoteToId.get(normaliseForComparison(c.anchorQuote));
        // verifyDrafts should already have dropped these.
        if (!anchorObsId) return [];
        return [
          {
            dealId: call.dealId,
            text: c.text,
            originTag:
              c.originTag === "founder-volunteered"
                ? ("founderVolunteered" as const)
                : c.originTag === "founder-confirmed-after-PM-framing"
                  ? ("founderConfirmedAfterPmFraming" as const)
                  : ("machineInferred" as const),
            // Every claim opens unverified at L1 — validated/refuted are L2.
            status: "claimed" as const,
            anchorObsId,
          },
        ];
      });
      if (claimRows.length) await tx.claim.createMany({ data: claimRows });

      await tx.call.update({ where: { id: callId }, data: { extracted: true } });

      return { observationsWritten: persisted.length, claimsWritten: claimRows.length };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );

  return { ...result, ...written };
}

// ------------------------------------------------------------------- review

export const DecideObservationInput = z.object({
  status: z.enum(["accepted", "edited", "rejected"]),
  /** Only meaningful with status "edited". */
  quote: z.string().trim().min(1).optional(),
  subDimensionKey: z.string().trim().min(1).optional(),
  rubricKey: z.string().trim().min(1).optional(),
});

/**
 * Record the PM's decision on a drafted observation. "edited" may also re-map it
 * to a different sub-dimension — the machine's mapping is a suggestion, and
 * correcting it is a large part of what review is for.
 */
export async function decideObservation(actor: Actor, observationId: string, raw: unknown) {
  assertMayAuthor(actor);
  const input = DecideObservationInput.parse(raw);

  if (input.subDimensionKey && !subByKey(input.subDimensionKey)) {
    throw new RuleViolation(`no such sub-dimension: ${input.subDimensionKey}`, "subDimensionKey");
  }

  await db.observation.update({
    where: { id: observationId },
    data: {
      status: input.status as ObservationStatus,
      ...(input.quote !== undefined ? { quote: input.quote } : {}),
      ...(input.subDimensionKey !== undefined ? { subDimensionKey: input.subDimensionKey } : {}),
      ...(input.rubricKey !== undefined ? { rubricKey: input.rubricKey } : {}),
      decidedById: actor.id,
      decidedAt: new Date(),
    },
  });
}

// ------------------------------------------------------------------- scores

export interface SetScoreInput {
  dealId: string;
  subDimensionKey: string;
  value: ScoreValue;
  evidenceObsIds?: string[];
  flag?: boolean;
}

/**
 * Author one sub-dimension score.
 *
 * The score type is taken from the frozen rubric config rather than from the
 * caller, so a client cannot declare a binary row to be a scale row in order to
 * store a number on it. A score with no evidence is allowed and shows as
 * incomplete (spec D7) — a PM works in progress.
 */
export async function setScore(actor: Actor, input: SetScoreInput) {
  assertMayAuthor(actor);
  assertLayer("L1");

  const sub = assertScoreValue(input.subDimensionKey, input.value);
  const encoded = encodeScoreValue(sub.type, input.value);
  const evidenceObsIds = [...new Set(input.evidenceObsIds ?? [])];

  if (evidenceObsIds.length) {
    const found = await db.observation.count({
      where: { id: { in: evidenceObsIds }, dealId: input.dealId },
    });
    if (found !== evidenceObsIds.length) {
      throw new RuleViolation(
        "evidence must be observations on this deal",
        "evidenceObsIds",
      );
    }
  }

  return db.$transaction(async (tx) => {
    const score = await tx.subDimensionScore.upsert({
      where: {
        dealId_subDimensionKey_layer: {
          dealId: input.dealId,
          subDimensionKey: input.subDimensionKey,
          layer: "L1",
        },
      },
      update: { scoreType: sub.type, value: encoded, flag: input.flag ?? false, authorId: actor.id },
      create: {
        dealId: input.dealId,
        subDimensionKey: input.subDimensionKey,
        layer: "L1",
        scoreType: sub.type,
        value: encoded,
        flag: input.flag ?? false,
        authorId: actor.id,
      },
      select: { id: true },
    });

    // The citation set is replaced wholesale — "these are the quotes" is the
    // operation, not "add one more".
    await tx.scoreEvidence.deleteMany({ where: { scoreId: score.id } });
    if (evidenceObsIds.length) {
      await tx.scoreEvidence.createMany({
        data: evidenceObsIds.map((observationId) => ({ scoreId: score.id, observationId })),
        skipDuplicates: true,
      });
    }
    return score.id;
  });
}

/** Return a sub-dimension to unscored. Distinct from scoring it "NE". */
export async function clearScore(actor: Actor, dealId: string, subDimensionKey: string) {
  assertMayAuthor(actor);
  await db.subDimensionScore.deleteMany({
    where: { dealId, subDimensionKey, layer: "L1" },
  });
}

