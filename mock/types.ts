/**
 * Record types for the L1 (Conviction) deal record.
 *
 * These mirror the Prisma models in the plan's ER diagram
 * (Deal · Call · Observation · Claim · SubDimensionScore · Slide ·
 * FounderTypeRead). The mock data layer implements these shapes today; the
 * real backend (plan U3) implements the same shapes behind Prisma, so the
 * UI does not change when persistence lands.
 *
 * Framework definitions (rubrics, sub-dimensions, anchors, pillars, tracks,
 * founder types, the verification cap) are NOT in here — they are static
 * typed config under /framework (plan KTD2), referenced by key.
 */

import type { RoleName } from "@/lib/adminEmails";

export type Layer = "L1" | "L2" | "L3" | "IC";

export type ScoreType = "scale" | "binary";

/** Scale rows carry 1..5 or the sentinel "NE" (not enough — distinct from 1). */
export type ScaleValue = 1 | 2 | 3 | 4 | 5 | "NE";
/** Binary hygiene rows. */
export type BinaryValue = "pass" | "unv" | "fail";
export type ScoreValue = ScaleValue | BinaryValue;

export type ObservationStatus = "draft" | "accepted" | "edited" | "rejected";

export type OriginTag =
  | "founder-volunteered"
  | "founder-confirmed-after-PM-framing"
  | "machine-inferred";

/** At L1 the ledger opens at "claimed" only; validated/refuted are L2. */
export type ClaimStatus = "claimed" | "validated" | "refuted";

export type Lens = "peak" | "weakest-link";

export interface Deal {
  id: string;
  company: string;
  oneLiner: string;
  founders: string;
  ownerPm: string;
  opened: string;
  layer: Layer;
}

export interface Call {
  id: string;
  dealId: string;
  number: number;
  label: string;
  date: string;
  transcript: string;
  extracted: boolean;
  /**
   * Who pulled this call out of Fireflies, by address (R24). Absent on a pasted
   * call — which is what every call was before importing existed, so absent has
   * to keep meaning "pasted" rather than "attribution lost".
   *
   * The address and not the user id, for the same reason `Deal` carries
   * `ownerPm` and not `ownerId`: a user id is a permission handle and the record
   * contract is not where permissions are decided. It is also what survives the
   * account being deleted, which is the half of R24 that matters at offboarding.
   */
  importedByEmail?: string;
  /** The Fireflies meeting it came from. Absent on a pasted call. */
  sourceMeetingId?: string;
}

/**
 * How one macro-dimension block fared in one extraction run (R22): read, failed
 * but worth retrying, or failed for a reason retrying cannot fix.
 */
export type ExtractionOutcome = "read" | "failed-retryable" | "failed-terminal";

/**
 * What one extraction run did to one macro-dimension block of a call (KTD16).
 *
 * One entry per block per call — a re-run replaces the entries for the blocks
 * it attempted and leaves the others standing — so a partial run stays legible
 * after a refresh: which blocks went unread is read from here, never from
 * client state (R24). A block that returned no usable output is never recorded
 * "read" (R26); "read" with nothing filed means the block was read and the
 * transcript had nothing for it.
 */
export interface ExtractionBlockRun {
  /** Which macro-dimension block, from /framework. */
  rubricKey: string;
  outcome: ExtractionOutcome;
  /** Why the block failed, in the run's words. Absent on a read block. */
  reason?: string;
  /** Quotes this block returned that were not verbatim in the transcript. */
  droppedQuotes: number;
  /** Claims from this block whose anchor quote did not survive verification. */
  droppedClaims: number;
  /** Duplicate spans merged away. Stays 0 until the dedupe pass lands. */
  mergedSpans: number;
  /** Which extraction-config version the run read with. Absent until tuning lands. */
  configVersion?: number;
  /**
   * How long the block took, in milliseconds, across every attempt. Absent on
   * rows written before it was measured — which is not the same as instant.
   */
  durationMs?: number;
  /** When the run recorded this outcome. */
  ranAt: string;
}

/**
 * A call without its transcript.
 *
 * The record carries this instead of the full `Call`, and the split is a
 * performance rule rather than a modelling preference. Every page in the flow
 * reads the whole record, and every mutation revalidates it — so while the
 * transcript lived in here, pressing one score button re-read every transcript on
 * the deal out of the database and threw them away. A forty-minute call is tens of
 * kilobytes of text; six of them make each click feel broken.
 *
 * Only the transcript page needs the words, and it asks for them separately.
 */
export type CallMeta = Omit<Call, "transcript"> & {
  /** Length of the transcript, so the UI can say "40k characters" without loading them. */
  transcriptChars: number;
  /** Per-block outcomes of extraction over this call. Empty until a run happens. */
  blockRuns: ExtractionBlockRun[];
};

export interface Observation {
  id: string;
  dealId: string;
  callNumber: number;
  rubricKey: string;
  subDimensionKey: string;
  quote: string;
  speaker?: string;
  timestamp?: string;
  status: ObservationStatus;
  /**
   * How sure the machine was that this quote belongs to this row. Its own filing
   * confidence — never a view on the founder, which stays the PM's to author.
   * Absent on anything a human filed or re-mapped.
   */
  confidence?: "high" | "low";
  /** One clause on why this row, read while scoring. */
  mappingNote?: string;
  /**
   * Who ruled on the filing — confirmed, moved, or rejected it. Absent while
   * only the machine has touched the row, and *presence* is what the UI reads
   * (KTD18): the unsure chip and the outstanding count both clear when a person
   * has decided, whatever they decided, while the confidence stays on the
   * record saying the machine was unsure. Carried as the stored id rather than
   * a display string because nothing renders who — resolving a name would cost
   * the hottest read a join for a value no page shows.
   */
  decidedById?: string;
  layer: Layer;
}

export interface Claim {
  id: string;
  dealId: string;
  text: string;
  originTag: OriginTag;
  anchorObsId: string;
  status: ClaimStatus;
}

export interface SubDimensionScore {
  dealId: string;
  subDimensionKey: string;
  scoreType: ScoreType;
  value: ScoreValue;
  /** Observation ids cited as evidence. Empty => incomplete (soft rule, KTD6). */
  evidenceObsIds: string[];
  /** e.g. a flagged-but-not-failed hygiene row (advance-with-condition). */
  flag?: boolean;
  /** What the condition is, in one line. Required whenever `flag` is set. */
  flagNote?: string;
  layer: Layer;
}

export interface Slide {
  dealId: string;
  /** Pillar or track key from /framework. */
  slideKey: string;
  /** Banked 0..10 human read (capped at the L1 ceiling while unverified). */
  value: number;
  /** Optional higher provisional read, e.g. 8 "if the claim verifies". */
  provisionalValue?: number;
  lens: Lens;
  /** Required one-line ceiling guard naming which sub-dimension set the ceiling. */
  ceilingGuard: string;
  /** Whether a human confirmed that line, or left the machine's suggestion standing. */
  guardConfirmed?: boolean;
  layer: Layer;
}

export interface FounderTypeRead {
  dealId: string;
  primary: string;
  secondary?: string;
  /** Expected-pillar profile for the type (context only). */
  profile: string;
  /** Which dimension the Founder-track floor reads on, per type. */
  floorDimension: string;
  /** The PM's one-line confirmation / override. */
  pmConfirmation: string;
}

/**
 * Someone who holds an account, as the people page reads them (R2).
 *
 * Not part of the deal record — the only shape in here that describes the
 * workspace rather than a deal. It lives here anyway because the repository
 * returns plain records and nothing else, and a `User` row carrying Prisma's
 * `Role` enum and a `Date` would be the first exception to that.
 *
 * The role is the union from lib/adminEmails rather than Prisma's enum for the
 * same reason it is a union there: three literals should not drag the Prisma
 * client toward anything that renders them.
 */
export interface Person {
  id: string;
  /** Google supplies one; a dev-credentials or adapter-created row need not. */
  name: string | null;
  email: string;
  /** The role stored on the row — the one `resolveRole` starts from at sign-in. */
  role: RoleName;
  created: string;
}

/** Everything captured for one deal at one layer. The mock exposes one of these. */
export interface DealRecord {
  deal: Deal;
  /** Metadata only — the transcript page fetches the text it needs separately. */
  calls: CallMeta[];
  observations: Observation[];
  claims: Claim[];
  scores: SubDimensionScore[];
  slides: Slide[];
  founderTypeRead: FounderTypeRead;
}
