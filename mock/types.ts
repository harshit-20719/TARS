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
