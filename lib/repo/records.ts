/**
 * The repository — the boundary where Prisma stops.
 *
 * Every function here returns the plain record interfaces from mock/types.ts.
 * No Prisma model, enum, or Date escapes this module, which is what lets the
 * locked front end keep reading the same shapes it always has while the source
 * underneath changed from a literal to a database.
 *
 * Ordering is explicit on every collection. The seed writes ascending
 * createdAt stamps, so `createdAt asc` reproduces the fixture order exactly and
 * the UI's grouping stays stable between deploys.
 */

import { db } from "@/lib/db";
import { decodeScoreValue, formatRecordDate, toLens, toOriginTag } from "@/lib/domain/codec";
import type {
  Call,
  CallMeta,
  Claim,
  Deal,
  DealRecord,
  FounderTypeRead,
  Observation,
  Slide,
  SubDimensionScore,
} from "@/mock/types";
import type { Prisma } from "@prisma/client";

// ------------------------------------------------------------------ mapping

type DealRow = Prisma.DealGetPayload<{}>;

function toDeal(row: DealRow & { owner?: { name: string | null } | null }): Deal {
  return {
    id: row.id,
    company: row.company,
    oneLiner: row.oneLiner,
    founders: row.founders,
    ownerPm: row.owner?.name ?? row.ownerPm,
    opened: formatRecordDate(row.opened),
    layer: row.layer,
  };
}

function toCall(row: Prisma.CallGetPayload<{}>): Call {
  return {
    id: row.id,
    dealId: row.dealId,
    number: row.number,
    label: row.label,
    date: formatRecordDate(row.date),
    transcript: row.transcript,
    extracted: row.extracted,
  };
}

/**
 * The columns a `CallMeta` needs — everything except the transcript itself.
 *
 * Named and reused rather than inlined so there is one place that decides what
 * "call metadata" means, and so adding a column cannot accidentally start
 * dragging the transcript back into the hot path.
 */
const CALL_META_SELECT = {
  id: true,
  dealId: true,
  number: true,
  label: true,
  date: true,
  extracted: true,
} as const;

type CallMetaRow = Prisma.CallGetPayload<{ select: typeof CALL_META_SELECT }> & {
  transcriptChars: number;
};

function toCallMeta(row: CallMetaRow): CallMeta {
  return {
    id: row.id,
    dealId: row.dealId,
    number: row.number,
    label: row.label,
    date: formatRecordDate(row.date),
    extracted: row.extracted,
    transcriptChars: row.transcriptChars,
  };
}

function toObservation(row: Prisma.ObservationGetPayload<{}>): Observation {
  return {
    id: row.id,
    dealId: row.dealId,
    callNumber: row.callNumber,
    rubricKey: row.rubricKey,
    subDimensionKey: row.subDimensionKey,
    quote: row.quote,
    ...(row.speaker ? { speaker: row.speaker } : {}),
    ...(row.timestamp ? { timestamp: row.timestamp } : {}),
    status: row.status,
    ...(row.confidence ? { confidence: row.confidence } : {}),
    ...(row.mappingNote ? { mappingNote: row.mappingNote } : {}),
    layer: row.layer,
  };
}

function toClaim(row: Prisma.ClaimGetPayload<{}>): Claim {
  return {
    id: row.id,
    dealId: row.dealId,
    text: row.text,
    originTag: toOriginTag(row.originTag),
    anchorObsId: row.anchorObsId,
    status: row.status,
  };
}

type ScoreRow = Prisma.SubDimensionScoreGetPayload<{
  include: { evidence: { select: { observationId: true } } };
}>;

function toScore(row: ScoreRow): SubDimensionScore {
  return {
    dealId: row.dealId,
    subDimensionKey: row.subDimensionKey,
    scoreType: row.scoreType,
    value: decodeScoreValue(row.scoreType, row.value),
    evidenceObsIds: row.evidence.map((e) => e.observationId),
    // Absent rather than false, so the shape matches the record contract's
    // optional flag and deep comparisons against the fixtures hold.
    ...(row.flag ? { flag: true } : {}),
    ...(row.flagNote ? { flagNote: row.flagNote } : {}),
    layer: row.layer,
  };
}

function toSlide(row: Prisma.SlideGetPayload<{}>): Slide {
  return {
    dealId: row.dealId,
    slideKey: row.slideKey,
    value: row.value,
    ...(row.provisionalValue !== null ? { provisionalValue: row.provisionalValue } : {}),
    lens: toLens(row.lens),
    ceilingGuard: row.ceilingGuard,
    ...(row.guardConfirmed ? { guardConfirmed: true } : {}),
    layer: row.layer,
  };
}

function toFounderTypeRead(row: Prisma.FounderTypeReadGetPayload<{}>): FounderTypeRead {
  return {
    dealId: row.dealId,
    primary: row.primary,
    ...(row.secondary ? { secondary: row.secondary } : {}),
    profile: row.profile,
    floorDimension: row.floorDimension,
    pmConfirmation: row.pmConfirmation,
  };
}

/**
 * A deal with no founder-type read yet still has to satisfy the record
 * contract, which carries the read as a required field. An all-empty read is
 * how the fixtures represent "not yet done", and the UI already renders that as
 * an empty state — so the repository produces the same thing rather than
 * forcing every consumer to handle a null.
 */
const emptyFounderTypeRead = (dealId: string): FounderTypeRead => ({
  dealId,
  primary: "",
  profile: "",
  floorDimension: "",
  pmConfirmation: "",
});

// ------------------------------------------------------------------ queries

/** Every deal, newest first — the order the deals list renders in. */
export async function listDeals(): Promise<Deal[]> {
  const rows = await db.deal.findMany({
    include: { owner: { select: { name: true } } },
    orderBy: [{ opened: "desc" }, { id: "asc" }],
  });
  return rows.map(toDeal);
}

export async function getDeal(id: string): Promise<Deal | undefined> {
  const row = await db.deal.findUnique({
    where: { id },
    include: { owner: { select: { name: true } } },
  });
  return row ? toDeal(row) : undefined;
}

/**
 * The whole record for one deal, minus the transcripts.
 *
 * Every page in the flow reads the full record — the status line alone needs
 * calls, observations, scores and slides — so fetching it as one nested query
 * beats six sequential ones on a serverless connection.
 *
 * The transcripts are the deliberate exception. They are by far the largest thing
 * on a deal and exactly one page needs them, while every mutation revalidates this
 * read. Selecting their length instead of their text is what makes pressing a
 * score button feel immediate: `char_length` is computed in the database, so the
 * bytes never cross the wire.
 */
export async function getRecord(id: string): Promise<DealRecord | undefined> {
  const row = await db.deal.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true } },
      calls: { select: CALL_META_SELECT, orderBy: { number: "asc" } },
      observations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      claims: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      scores: {
        include: { evidence: { select: { observationId: true }, orderBy: { observationId: "asc" } } },
        orderBy: [{ createdAt: "asc" }, { subDimensionKey: "asc" }],
      },
      slides: { orderBy: [{ createdAt: "asc" }, { slideKey: "asc" }] },
      founderTypeRead: true,
    },
  });
  if (!row) return undefined;

  /**
   * Transcript sizes, computed database-side. A second round trip rather than a
   * bigger one: the nested include above cannot express a computed column, and
   * two small queries beat one that carries the text.
   */
  const sizes = row.calls.length
    ? await db.$queryRaw<{ id: string; chars: bigint }[]>`
        SELECT id, char_length(transcript) AS chars
        FROM "Call"
        WHERE "dealId" = ${id}
      `
    : [];
  const charsById = new Map(sizes.map((s) => [s.id, Number(s.chars)]));

  return {
    deal: toDeal(row),
    calls: row.calls.map((c) => toCallMeta({ ...c, transcriptChars: charsById.get(c.id) ?? 0 })),
    observations: row.observations.map(toObservation),
    claims: row.claims.map(toClaim),
    scores: row.scores.map(toScore),
    slides: row.slides.map(toSlide),
    founderTypeRead: row.founderTypeRead
      ? toFounderTypeRead(row.founderTypeRead)
      : emptyFounderTypeRead(row.id),
  };
}

/** One call with its transcript, for the extraction step. */
export async function getCall(callId: string) {
  return db.call.findUnique({ where: { id: callId } });
}

/**
 * Every call on a deal *with* its transcript text.
 *
 * The counterpart to `getRecord` leaving transcripts out: the transcript page is
 * the one place that needs the words, so it is the one place that pays for them.
 */
export async function getCallsWithTranscripts(dealId: string): Promise<Call[]> {
  const rows = await db.call.findMany({ where: { dealId }, orderBy: { number: "asc" } });
  return rows.map(toCall);
}
