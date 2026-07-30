/**
 * The translation layer between how Postgres stores the record and how the
 * record contract (mock/types.ts) describes it.
 *
 * Two things need translating:
 *
 *  1. A sub-dimension score is one union in the domain (`1..5 | "NE" | "pass" |
 *     "unv" | "fail"`) but a (scoreType, text) pair in the database. This is the
 *     only module that parses or renders that pair.
 *  2. Two Prisma enums carry hyphenated database values that are not valid
 *     identifiers, so the generated client names them differently from the wire
 *     format the record contract uses.
 *
 * Nothing here touches Prisma or the network — it is pure and unit-tested.
 */

import type {
  BinaryValue,
  ExtractionOutcome,
  Lens,
  OriginTag,
  ScaleValue,
  ScoreType,
  ScoreValue,
} from "@/mock/types";
import {
  ExtractionOutcome as PrismaExtractionOutcome,
  Lens as PrismaLens,
  OriginTag as PrismaOriginTag,
} from "@prisma/client";

/** Thrown when stored data cannot be read back as a valid domain value. */
export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

// ------------------------------------------------------------ score values

const SCALE_VALUES = ["1", "2", "3", "4", "5", "NE"] as const;
const BINARY_VALUES: readonly BinaryValue[] = ["pass", "unv", "fail"] as const;

/** True when the value is legal for a 1..5 sub-dimension. */
export function isScaleValue(v: unknown): v is ScaleValue {
  return v === "NE" || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5);
}

/** True when the value is legal for a binary hygiene row. */
export function isBinaryValue(v: unknown): v is BinaryValue {
  return typeof v === "string" && (BINARY_VALUES as readonly string[]).includes(v);
}

/**
 * Validate a domain score value against its declared type and render it for
 * storage. Throws rather than coercing — a scale value on a binary row is a
 * caller bug, not something to silently reinterpret.
 */
export function encodeScoreValue(scoreType: ScoreType, value: ScoreValue): string {
  if (scoreType === "scale") {
    if (!isScaleValue(value)) {
      throw new CodecError(`${JSON.stringify(value)} is not a 1..5 or "NE" value`);
    }
    return String(value);
  }
  if (!isBinaryValue(value)) {
    throw new CodecError(`${JSON.stringify(value)} is not a pass/unv/fail value`);
  }
  return value;
}

/** Read a stored (scoreType, text) pair back as the domain union. */
export function decodeScoreValue(scoreType: ScoreType, raw: string): ScoreValue {
  if (scoreType === "scale") {
    if (!(SCALE_VALUES as readonly string[]).includes(raw)) {
      throw new CodecError(`stored scale value ${JSON.stringify(raw)} is out of range`);
    }
    return raw === "NE" ? "NE" : (Number(raw) as ScaleValue);
  }
  if (!isBinaryValue(raw)) {
    throw new CodecError(`stored binary value ${JSON.stringify(raw)} is not pass/unv/fail`);
  }
  return raw;
}

// ------------------------------------------------------------ mapped enums

const ORIGIN_TAG_TO_RECORD: Record<PrismaOriginTag, OriginTag> = {
  founderVolunteered: "founder-volunteered",
  founderConfirmedAfterPmFraming: "founder-confirmed-after-PM-framing",
  machineInferred: "machine-inferred",
};

const ORIGIN_TAG_FROM_RECORD: Record<OriginTag, PrismaOriginTag> = {
  "founder-volunteered": PrismaOriginTag.founderVolunteered,
  "founder-confirmed-after-PM-framing": PrismaOriginTag.founderConfirmedAfterPmFraming,
  "machine-inferred": PrismaOriginTag.machineInferred,
};

export const toOriginTag = (v: PrismaOriginTag): OriginTag => ORIGIN_TAG_TO_RECORD[v];

export function fromOriginTag(v: OriginTag): PrismaOriginTag {
  const mapped = ORIGIN_TAG_FROM_RECORD[v];
  if (!mapped) throw new CodecError(`unknown origin tag ${JSON.stringify(v)}`);
  return mapped;
}

const LENS_TO_RECORD: Record<PrismaLens, Lens> = {
  peak: "peak",
  weakestLink: "weakest-link",
};

const LENS_FROM_RECORD: Record<Lens, PrismaLens> = {
  peak: PrismaLens.peak,
  "weakest-link": PrismaLens.weakestLink,
};

export const toLens = (v: PrismaLens): Lens => LENS_TO_RECORD[v];

export function fromLens(v: Lens): PrismaLens {
  const mapped = LENS_FROM_RECORD[v];
  if (!mapped) throw new CodecError(`unknown lens ${JSON.stringify(v)}`);
  return mapped;
}

const EXTRACTION_OUTCOME_TO_RECORD: Record<PrismaExtractionOutcome, ExtractionOutcome> = {
  READ: "read",
  FAILED_RETRYABLE: "failed-retryable",
  FAILED_TERMINAL: "failed-terminal",
};

const EXTRACTION_OUTCOME_FROM_RECORD: Record<ExtractionOutcome, PrismaExtractionOutcome> = {
  read: PrismaExtractionOutcome.READ,
  "failed-retryable": PrismaExtractionOutcome.FAILED_RETRYABLE,
  "failed-terminal": PrismaExtractionOutcome.FAILED_TERMINAL,
};

export const toExtractionOutcome = (v: PrismaExtractionOutcome): ExtractionOutcome =>
  EXTRACTION_OUTCOME_TO_RECORD[v];

export function fromExtractionOutcome(v: ExtractionOutcome): PrismaExtractionOutcome {
  const mapped = EXTRACTION_OUTCOME_FROM_RECORD[v];
  if (!mapped) throw new CodecError(`unknown extraction outcome ${JSON.stringify(v)}`);
  return mapped;
}

// ------------------------------------------------------------------ dates

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Render a stored timestamp the way the record contract carries dates
 * ("22 Jul 2026"). Spelled out rather than delegated to toLocaleDateString so
 * the output does not depend on the runtime's ICU data.
 */
export function formatRecordDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Parse the record's display date form back to a UTC timestamp. */
export function parseRecordDate(s: string): Date {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(s.trim());
  if (m) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    if (month >= 0) {
      return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
    }
  }
  const iso = new Date(s);
  if (Number.isNaN(iso.getTime())) throw new CodecError(`unparseable date ${JSON.stringify(s)}`);
  return iso;
}
