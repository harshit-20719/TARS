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
/**
 * A value import rather than a type-only one, for `PrismaClientKnownRequestError`
 * — the one Prisma runtime name a service reaches for, the same way
 * lib/services/people.ts does. Everything else taken from this namespace here is
 * still a type.
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { subByKey } from "@/framework";
import { encodeScoreValue, parseRecordDate } from "@/lib/domain/codec";
import { assertLayer, assertScoreValue } from "@/lib/domain/rules";
import { RuleViolation } from "@/lib/domain/rules";
import {
  assertMayAuthor,
  assertMayDeleteDeal,
  assertMayReassignDeal,
  type Actor,
} from "@/lib/authz";
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

/**
 * Everything an ordinary edit may change — which is everything except the id and
 * the owner.
 *
 * The id is fixed at creation (R21): it is derived from the company name once and
 * is a handle from then on, so a rename leaves every existing link working rather
 * than trading a stale slug for a redirect table.
 *
 * The owner is absent for a permission reason. Zod strips what this schema does
 * not declare, so an `ownerId` sent to `updateDeal` goes nowhere — which is what
 * keeps `reassignDeal`, and therefore `assertMayReassignDeal`, the only path to a
 * change of owner (R9). `updateDeal` only asserts authorship, which since U1
 * refuses nobody.
 */
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
  // Where the transcript came from is deliberately absent — see `CallProvenance`
  // below, which is a permission boundary rather than a tidiness one.
});

/**
 * Where a transcript came from, stated by the only caller in a position to know
 * — and kept off `AddCallInput` on purpose.
 *
 * `addCallAction` hands a browser payload straight to `addCall`, so every field
 * that schema declares is a field a *pasted* call can state about itself. A
 * `sourceMeetingId` among them was not a harmless label: the insert below stamps
 * the actor's name alongside it, so a pasted call could render "Imported from
 * Fireflies by … · meeting ff-…" over a transcript nobody imported — an
 * attribution anyone can forge, which is the one thing R24 exists to prevent.
 * And because the import path answers "is this meeting already here?" from that
 * column, a pasted call carrying a real meeting id would make the genuine import
 * of that meeting refuse as already on the deal.
 *
 * A second parameter is the fix rather than a stricter schema, because it cannot
 * be reached from the wire at all: a server action passes one deserialized
 * argument, and Zod strips a smuggled `sourceMeetingId` out of it exactly as it
 * already strips a smuggled `importedById`. Only lib/services/import.ts — which
 * has just pulled the transcript out of that meeting — can fill this in.
 */
export interface CallProvenance {
  sourceMeetingId: string;
}

/**
 * Whether this deal can take a call on this number — the whole of that rule, so
 * that the paste path and the import path refuse in identical words.
 *
 * Separated out for the import path's sake specifically (AE5). Importing has to
 * settle the number *before* it fetches anything, because a transcript pulled
 * for a call that is then refused is a full workspace recording retrieved for
 * nothing, with no attributed row left behind to record that it happened. Left
 * inline in `addCall`, the import path would have had to either restate the rule
 * — two messages for one refusal, drifting apart on the first edit — or fetch
 * first and check after.
 */
export async function assertCallNumberFree(dealId: string, number: number): Promise<void> {
  const existing = await db.call.findUnique({
    where: { dealId_number: { dealId, number } },
    select: { id: true },
  });
  if (existing) {
    throw new RuleViolation(`call ${number} already exists for this deal`, "number");
  }

  /**
   * A number whose old evidence is still on the record cannot be reused.
   *
   * Deleting a call deliberately leaves its observations behind — they are keyed
   * by call number, not by the transcript, and a score may already cite them. So
   * a freed number can still have evidence hanging off it, and re-adding a call
   * there would silently adopt the removed call's quotes: coverage would show
   * them under the new call, and a PM reading which call produced what would be
   * told something untrue.
   *
   * Refused here rather than repaired in the reading, because the reading cannot
   * tell the two apart after the fact.
   */
  const orphaned = await db.observation.count({ where: { dealId, callNumber: number } });
  if (orphaned > 0) {
    throw new RuleViolation(
      `call ${number} still has ${orphaned} observation${orphaned === 1 ? "" : "s"} ` +
        `filed against it from a call that was removed. Use a different number, or clear those ` +
        `observations first.`,
      "number",
    );
  }
}

/**
 * Whether a write was refused by a particular unique index — the racing
 * counterpart of the check above.
 *
 * `assertCallNumberFree` is a read, and a read holds nothing: two PMs filing
 * call 3 on the same deal in the same second both see the number free, and the
 * database refuses the second write. Unhandled that surfaces as a raw Prisma
 * error, which `toResult` rethrows on purpose and React then renders as its
 * generic failed-render — with the message stripped off something the PM could
 * have fixed by typing a different number.
 *
 * Matched on a *field name* rather than on the constraint name because `Call`
 * carries two unique indexes over `dealId` now, and a catch that could not tell
 * them apart would report a duplicate meeting as a duplicate call number. Prisma
 * reports the offending columns in `meta.target`, as an array of field names on
 * Postgres; other engines and older clients report the constraint name, which
 * spells out the same fields, so both forms are matched.
 *
 * Exported for lib/services/import.ts, which owns the other index's refusal, for
 * the same reason `assertCallNumberFree` is (AE5): one rule, one wording.
 */
export function isUniqueViolationOn(e: unknown, field: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  return (Array.isArray(target) ? target.join(",") : String(target ?? "")).includes(field);
}

/**
 * Add a call to a deal.
 *
 * `provenance` is the third argument rather than a field of `raw` because `raw`
 * comes off the wire and this does not — see `CallProvenance`. Omitted is the
 * normal case: a pasted call has no provenance, and passing none is what leaves
 * the three attribution columns null (R12).
 */
export async function addCall(actor: Actor, raw: unknown, provenance?: CallProvenance) {
  assertMayAuthor(actor);
  const input = AddCallInput.parse(raw);

  await assertCallNumberFree(input.dealId, input.number);

  try {
    const call = await db.call.create({
      data: {
        dealId: input.dealId,
        number: input.number,
        label: input.label,
        date: input.date ? parseRecordDate(input.date) : new Date(),
        transcript: input.transcript,
        /**
         * The attribution R24 asks for, written in the same insert as the
         * transcript (KTD14).
         *
         * One insert rather than a follow-up update, because the update is the
         * failure that matters: a transcript pulled out of the shared Fireflies
         * account and then saved with nobody's name on it is precisely the row
         * the attribution exists to prevent, and a second statement is a second
         * chance to leave one.
         *
         * All three columns are gated on `provenance` and nothing in `input`.
         * The importer is read off the actor, so it cannot be set to somebody
         * else; the meeting id is off the wire entirely, so a pasted call cannot
         * claim to be an imported one. An attribution anyone can write is not
         * attribution — see `CallProvenance`.
         */
        ...(provenance
          ? {
              sourceMeetingId: provenance.sourceMeetingId,
              importedById: actor.id,
              importedByEmail: actor.email,
            }
          : {}),
      },
    });
    return call.id;
  } catch (e) {
    /**
     * The refusal `assertCallNumberFree` would have given, for the caller that
     * lost the race to it. Identical wording, because it is the same rule
     * arriving a few milliseconds later — a PM who hits it should not have to
     * work out whether "call 3 already exists" and a Prisma constraint name are
     * the same problem.
     *
     * A duplicate *meeting* also lands here and is deliberately not caught:
     * lib/services/import.ts owns that rule and its message, and this catch
     * would only be able to name the wrong one.
     */
    if (isUniqueViolationOn(e, "number")) {
      throw new RuleViolation(`call ${input.number} already exists for this deal`, "number");
    }
    throw e;
  }
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

export const ReassignDealInput = z.object({
  ownerId: z.string().trim().min(1, "Choose who should own the deal."),
});

/**
 * Hand a deal to another account holder (R8, R9, R10).
 *
 * The permission is checked against who owns the deal *now*, which is what makes
 * a handover one-way for the person performing it: the moment this write lands
 * they are no longer the owner, so they cannot move it back. The new owner or an
 * ADMIN can. The control says so before the second press, because a rule the
 * reader only discovers afterwards is not a safeguard.
 *
 * Both representations of the owner move together. `ownerId` is the relation the
 * permissions read; `ownerPm` is the display string the record contract carries
 * (the `Deal` type has no `ownerId` — see mock/types.ts). Writing one without the
 * other leaves the sidebar naming somebody who can no longer delete the deal,
 * which is the kind of drift nothing else would catch.
 *
 * The target is looked up rather than trusted: the id arrives from a select in a
 * browser, and Prisma's own foreign-key failure would surface as an infrastructure
 * error rather than something the control can render.
 */
export async function reassignDeal(actor: Actor, dealId: string, raw: unknown) {
  const input = ReassignDealInput.parse(raw);

  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { ownerId: true } });
  if (!deal) throw new RuleViolation(`no such deal: ${dealId}`, "dealId");
  assertMayReassignDeal(actor, deal.ownerId);

  const target = await db.user.findUnique({
    where: { id: input.ownerId },
    select: { id: true, name: true, email: true },
  });
  if (!target) throw new RuleViolation(`no such person: ${input.ownerId}`, "ownerId");

  await db.deal.update({
    where: { id: dealId },
    // The same fallback `createDeal` uses, so a deal that changes hands reads the
    // way one opened by that person would.
    data: { ownerId: target.id, ownerPm: target.name ?? target.email },
  });
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
  /** Quotes the machine re-drafted that the PM had already ruled on, so were skipped. */
  skippedAlreadyRuledOn: number;
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
  /**
   * Rows written by this run, so the re-run delete and the id lookup can both
   * address exactly them.
   *
   * This used to be `status: "draft"` for both, which worked only because every
   * machine-written row was a draft. They are not any more — a confidently mapped
   * observation is written already accepted (see below) — so the marker has to be
   * something else. `confidence: { not: null }` is that marker: it is set on
   * everything the machine files and on nothing a human does, including a re-map,
   * which clears it.
   */
  const machineWritten: Prisma.ObservationWhereInput = {
    dealId: call.dealId,
    callNumber: call.number,
    decidedById: null,
    /**
     * Either marker identifies an undecided machine row. `confidence` is set on
     * everything this version writes, but rows written before that column existed
     * have it null — and matching only on `confidence` left them behind on a
     * re-run, so the next extraction duplicated them instead of replacing them.
     */
    OR: [{ confidence: { not: null } }, { status: "draft" }],
  };

  /**
   * Only the blocks this run actually re-read.
   *
   * Scoping the delete is what makes a retry after a partial failure safe. The
   * delete used to cover the whole call, so re-running when five of six blocks had
   * succeeded and one had failed would remove the five blocks' evidence and write
   * back only the sixth — destroying real work while looking like a normal retry,
   * which is exactly what the button invites the PM to do.
   */
  const rewritten: Prisma.ObservationWhereInput = {
    ...machineWritten,
    rubricKey: { in: result.succeededBlocks },
  };

  const written = await db.$transaction(
    async (tx) => {
      /**
       * Clear this run's own previous rows, and nothing else. A row the PM has
       * ruled on carries `decidedById`, so it survives — silently discarding a
       * review pass is the one thing a re-extract must not do.
       */
      await tx.observation.deleteMany({ where: rewritten });

      /**
       * Quotes a human has already ruled on, so the machine cannot undo them.
       *
       * A rejected observation survives the delete above (it carries `decidedById`),
       * and without this the re-run wrote the same quote again — filed `accepted`
       * when confidence was high, and auto-cited as evidence. The PM's rejection
       * was reversed by a machine, which is the one thing the authorship rule
       * exists to prevent.
       */
      const decided = await tx.observation.findMany({
        where: { dealId: call.dealId, callNumber: call.number, decidedById: { not: null } },
        select: { quote: true },
      });
      const alreadyRuledOn = new Set(decided.map((o) => normaliseForComparison(o.quote)));

      const fresh = result.observations.filter(
        (o) => !alreadyRuledOn.has(normaliseForComparison(o.quote)),
      );

      await tx.observation.createMany({
        data: fresh.map((o) => ({
          dealId: call.dealId,
          callNumber: call.number,
          rubricKey: o.rubricKey,
          subDimensionKey: o.subDimensionKey,
          quote: o.quote,
          speaker: o.speaker,
          timestamp: o.timestamp,
          /**
           * A confident mapping files itself.
           *
           * The framework reserves *scoring* for the PM (spec R5). It does not ask
           * them to hand-approve each quote, and treating it as though it did turned
           * seven screening calls a week into clerical work: a PM confirming that a
           * quote about a paying customer belongs under the customer row is not
           * exercising judgment, they are doing data entry. So a high-confidence
           * mapping lands as evidence directly, and an unsure one waits as a draft
           * in the exception queue. The PM's attention goes on the score, which is
           * the part only they can do — and re-mapping stays available in place, so
           * nothing is locked in.
           */
          status: o.confidence === "high" ? ("accepted" as const) : ("draft" as const),
          confidence: o.confidence,
          mappingNote: o.mappingNote,
          layer: "L1" as const,
        })),
      });

      // createMany does not return ids, and claims need one to anchor to.
      const persisted = await tx.observation.findMany({
        where: rewritten,
        select: { id: true, quote: true, rubricKey: true },
      });
      /**
       * Keyed on block *and* quote, not quote alone.
       *
       * The prompt deliberately tells the model that one passage may be evidence
       * for several rows, and six blocks each read the whole transcript — so the
       * same quote text arriving from two blocks is routine, not rare. A map keyed
       * on quote alone kept whichever row the database returned last, so a claim
       * could end up anchored to a different block's observation and the ledger
       * would print the wrong "filed under" row.
       */
      const anchorKey = (rubricKey: string, quote: string) =>
        `${rubricKey}::${normaliseForComparison(quote)}`;
      const quoteToId = new Map(
        persisted.map((o) => [anchorKey(o.rubricKey, o.quote), o.id]),
      );

      const claimRows = result.claims.flatMap((c) => {
        const anchorObsId = quoteToId.get(anchorKey(c.rubricKey, c.anchorQuote));
        // verifyDrafts should already have dropped these; a claim whose quote was
        // ruled on by a human and therefore not re-created also lands here.
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

      /**
       * A call is only "extracted" when every block was read.
       *
       * Marking it extracted after a partial run made the missing blocks
       * indistinguishable from blocks that genuinely had nothing in them: the
       * failure list lived only in the button's local state, so one refresh and the
       * transcript page showed a plain green chip over an incomplete read.
       */
      await tx.call.update({
        where: { id: callId },
        data: { extracted: result.failedBlocks.length === 0 },
      });

      return {
        observationsWritten: persisted.length,
        claimsWritten: claimRows.length,
        /** Re-created quotes the PM had already ruled on, and so were skipped. */
        skippedAlreadyRuledOn: result.observations.length - fresh.length,
      };
    },
    /**
     * Sized against the function's sixty-second ceiling, not chosen freely.
     * Extraction is bounded by BLOCK_TIMEOUT_MS (30s, concurrent across blocks), so
     * this phase gets a ceiling that keeps the worst case comfortably inside the
     * free tier's limit — 30 + 12 — rather than requiring a paid one. The writes
     * are batched into four queries, so twelve seconds is a failure ceiling, not an
     * expected duration.
     */
    { timeout: 12_000, maxWait: 5_000 },
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

  /**
   * The decision and its consequences for the citation set, in one transaction.
   *
   * Evidence is resolved when a score is saved and then frozen into ScoreEvidence,
   * so a decision taken afterwards has to maintain it. Without this, rejecting a
   * quote left every score that already cited it still citing it: the capture page
   * hid the quote while the scorecard kept printing it, and the row still counted
   * as complete. That contradicted what the reject button promises, and it let a
   * score rest on evidence its author had thrown out.
   */
  await db.$transaction(async (tx) => {
    if (input.status === "rejected") {
      // Not evidence anywhere, not just on the row it was read from.
      await tx.scoreEvidence.deleteMany({ where: { observationId } });
    } else if (input.subDimensionKey !== undefined) {
      /**
       * A move takes the quote off the row it left. It is not added to the
       * destination row's score here: that score may not exist yet, and when it is
       * next saved `setScore` cites the row's observations from scratch, which now
       * includes this one.
       */
      const current = await tx.observation.findUnique({
        where: { id: observationId },
        select: { subDimensionKey: true },
      });
      if (current && current.subDimensionKey !== input.subDimensionKey) {
        await tx.scoreEvidence.deleteMany({ where: { observationId } });
      }
    }

    await tx.observation.update({
      where: { id: observationId },
      data: {
        status: input.status as ObservationStatus,
        ...(input.quote !== undefined ? { quote: input.quote } : {}),
        ...(input.subDimensionKey !== undefined
          ? { subDimensionKey: input.subDimensionKey }
          : {}),
        ...(input.rubricKey !== undefined ? { rubricKey: input.rubricKey } : {}),
        /**
         * A re-map retires the machine's mapping metadata.
         *
         * Once a human has chosen the row, the model's confidence and its "why this
         * row" note describe a filing that no longer exists — leaving them attached
         * would show the PM a rationale for the wrong row. Clearing them also takes
         * the row out of the re-extract's blast radius, which is the behaviour a PM
         * expects: a correction should survive re-running the machine.
         */
        ...(input.subDimensionKey !== undefined
          ? { confidence: null, mappingNote: null }
          : {}),
        decidedById: actor.id,
        decidedAt: new Date(),
      },
    });
  });
}

// ------------------------------------------------------------------- scores

export interface SetScoreInput {
  dealId: string;
  subDimensionKey: string;
  value: ScoreValue;
  /**
   * Which observations this score cites.
   *
   * Omit it and every non-rejected observation filed under the row is cited — see
   * below. Pass an explicit list (including an empty one) to override that.
   */
  evidenceObsIds?: string[];
  flag?: boolean;
  /** What the condition is. Required when `flag` is true. */
  flagNote?: string;
}

/**
 * Author one sub-dimension score.
 *
 * The score type is taken from the frozen rubric config rather than from the
 * caller, so a client cannot declare a binary row to be a scale row in order to
 * store a number on it. A score with no evidence is allowed and shows as
 * incomplete (spec D7) — a PM works in progress.
 *
 * **Evidence defaults to everything filed under the row.** Leaving
 * `evidenceObsIds` out is the normal case, and it cites every observation on the
 * row that has not been rejected. The alternative — which is what shipped first —
 * was making the PM tick a checkbox per quote per row: forty-one rows of clicking
 * to restate a mapping the machine had already made, with a database round trip
 * per tick. It was also a trap, because a score saved before the ticking showed as
 * having no evidence at all. Citing the row's evidence is the sane default; the
 * PM's real lever is rejecting a quote, which removes it from every score at once.
 */
export async function setScore(actor: Actor, input: SetScoreInput) {
  assertMayAuthor(actor);
  assertLayer("L1");

  const sub = assertScoreValue(input.subDimensionKey, input.value);
  const encoded = encodeScoreValue(sub.type, input.value);

  const flag = input.flag ?? false;
  const flagNote = input.flagNote?.trim() || null;
  /**
   * A condition nobody can read is not a condition. The flag used to be a bare
   * boolean, which meant "advance with condition" reached IC with no way to learn
   * what the condition was.
   */
  if (flag && !flagNote) {
    throw new RuleViolation("say what the condition is, in one line", "flagNote");
  }

  const evidenceObsIds =
    input.evidenceObsIds !== undefined
      ? [...new Set(input.evidenceObsIds)]
      : (
          await db.observation.findMany({
            where: {
              dealId: input.dealId,
              subDimensionKey: input.subDimensionKey,
              status: { not: "rejected" },
            },
            select: { id: true },
          })
        ).map((o) => o.id);

  if (input.evidenceObsIds !== undefined && evidenceObsIds.length) {
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
      update: { scoreType: sub.type, value: encoded, flag, flagNote, authorId: actor.id },
      create: {
        dealId: input.dealId,
        subDimensionKey: input.subDimensionKey,
        layer: "L1",
        scoreType: sub.type,
        value: encoded,
        flag,
        flagNote,
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

