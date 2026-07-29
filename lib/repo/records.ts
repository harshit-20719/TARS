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
  Person,
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
    ...importAttribution(row),
  };
}

/**
 * The Fireflies attribution, present only on an imported call.
 *
 * Spread conditionally, the way `toObservation` handles `speaker`. The record
 * contract makes absence mean something here — a call with no `sourceMeetingId`
 * is a pasted call, which is every call the fixtures describe and every call
 * written before importing existed — so emitting the keys with `undefined`
 * values would blur "pasted" into "imported, attribution missing" for anything
 * that inspects the shape rather than the values. `toEqual` would not notice;
 * lib/services/import.test.ts checks the keys themselves for that reason.
 */
function importAttribution(row: {
  importedByEmail: string | null;
  sourceMeetingId: string | null;
}): Pick<Call, "importedByEmail" | "sourceMeetingId"> {
  return {
    ...(row.importedByEmail ? { importedByEmail: row.importedByEmail } : {}),
    ...(row.sourceMeetingId ? { sourceMeetingId: row.sourceMeetingId } : {}),
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
  importedByEmail: true,
  sourceMeetingId: true,
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
    ...importAttribution(row),
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

/**
 * Every deal, newest first — the order the deals list renders in.
 *
 * KTD9. The optional owner filter is a `where` clause rather than something the
 * page does to an already-fetched array, so "Mine" keeps meaning "mine" once the
 * list outgrows one query. The seeded fixtures carry a display name and no owner
 * relation, so they belong to nobody and appear under no filter.
 */
export async function listDeals(ownerId?: string): Promise<Deal[]> {
  const rows = await db.deal.findMany({
    where: ownerId ? { ownerId } : undefined,
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
  /**
   * Transcript sizes, computed database-side and fetched alongside the record.
   *
   * Two queries rather than one, because the nested include cannot express a
   * computed column — but issued together, not in sequence. The size query needs
   * only the deal id, which is known on entry, so waiting for the record first
   * added a serial round trip to a read that every page and every save performs.
   */
  const [row, sizes] = await Promise.all([
    db.deal.findUnique({
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
    }),
    db.$queryRaw<{ id: string; chars: bigint }[]>`
      SELECT id, char_length(transcript) AS chars
      FROM "Call"
      WHERE "dealId" = ${id}
    `,
  ]);
  if (!row) return undefined;

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

// ------------------------------------------------------------------- people

/**
 * Everyone who holds an account, oldest first (R2).
 *
 * Every row, with no filter: an account that has never signed in still holds a
 * role, and a colleague who cannot be seen cannot be given one. The password
 * hash and the session tables are not selected — the page needs identity and
 * role, and nothing here should be one query away from leaking a credential.
 */
export async function listPeople(): Promise<Person[]> {
  const rows = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    created: formatRecordDate(row.createdAt),
  }));
}

/**
 * Someone a deal can be handed to: an id to send, and something to call them by.
 *
 * Its own type rather than `Person`, and declared here rather than in
 * mock/types.ts, because it is not part of the record contract the front end is
 * locked to — it is the shape one control needs.
 */
export interface ReassignCandidate {
  id: string;
  name: string;
}

/**
 * Who a deal can be handed to (R8).
 *
 * A narrower read than `listPeople` on purpose. That one carries roles and
 * timestamps and is reachable only from the ADMIN page; this one is rendered on
 * every deal, for every author, so it reads the two columns the picker uses and
 * stops. Reusing `listPeople` would have put the whole workspace's roles into the
 * page payload of a control that has no use for them.
 *
 * The name falls back the same way `createDeal` and `reassignDeal` do, so the
 * label someone picks is the one that lands in `ownerPm`.
 */
export async function listReassignCandidates(): Promise<ReassignCandidate[]> {
  const rows = await db.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, name: row.name ?? row.email }));
}
