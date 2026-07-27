import { describe, expect, it } from "vitest";
import { Lens as PrismaLens, OriginTag as PrismaOriginTag } from "@prisma/client";
import type { OriginTag, ScaleValue } from "@/mock/types";
import {
  CodecError,
  decodeScoreValue,
  encodeScoreValue,
  formatRecordDate,
  fromLens,
  fromOriginTag,
  parseRecordDate,
  toLens,
  toOriginTag,
} from "./codec";

describe("score values", () => {
  it("round-trips every legal scale value", () => {
    const values: ScaleValue[] = [1, 2, 3, 4, 5, "NE"];
    for (const v of values) {
      expect(decodeScoreValue("scale", encodeScoreValue("scale", v))).toBe(v);
    }
  });

  it("round-trips every legal binary value", () => {
    for (const v of ["pass", "unv", "fail"] as const) {
      expect(decodeScoreValue("binary", encodeScoreValue("binary", v))).toBe(v);
    }
  });

  it("keeps NE distinct from 1", () => {
    // The framework treats "not enough" as a different statement from "weak",
    // so these must never collapse into each other.
    expect(encodeScoreValue("scale", "NE")).toBe("NE");
    expect(decodeScoreValue("scale", "NE")).toBe("NE");
    expect(decodeScoreValue("scale", "1")).toBe(1);
  });

  it("refuses a binary value on a scale row", () => {
    expect(() => encodeScoreValue("scale", "pass")).toThrow(CodecError);
  });

  it("refuses a scale value on a binary row", () => {
    expect(() => encodeScoreValue("binary", 4)).toThrow(CodecError);
  });

  it("refuses out-of-range and non-integer scale values", () => {
    for (const bad of [0, 6, -1, 2.5]) {
      expect(() => encodeScoreValue("scale", bad as ScaleValue)).toThrow(CodecError);
    }
  });

  it("refuses to decode corrupted storage rather than guessing", () => {
    expect(() => decodeScoreValue("scale", "9")).toThrow(CodecError);
    expect(() => decodeScoreValue("scale", "")).toThrow(CodecError);
    expect(() => decodeScoreValue("binary", "maybe")).toThrow(CodecError);
  });
});

describe("mapped enums", () => {
  it("round-trips every origin tag", () => {
    const tags: OriginTag[] = [
      "founder-volunteered",
      "founder-confirmed-after-PM-framing",
      "machine-inferred",
    ];
    for (const t of tags) {
      expect(toOriginTag(fromOriginTag(t))).toBe(t);
    }
  });

  it("maps origin tags to the hyphenated wire form the record contract uses", () => {
    expect(toOriginTag(PrismaOriginTag.founderConfirmedAfterPmFraming)).toBe(
      "founder-confirmed-after-PM-framing",
    );
  });

  it("round-trips both lenses", () => {
    expect(toLens(fromLens("peak"))).toBe("peak");
    expect(toLens(fromLens("weakest-link"))).toBe("weakest-link");
    expect(toLens(PrismaLens.weakestLink)).toBe("weakest-link");
  });

  it("rejects an unknown enum value instead of returning undefined", () => {
    expect(() => fromOriginTag("invented" as OriginTag)).toThrow(CodecError);
  });
});

describe("record dates", () => {
  it("formats the way the record contract carries dates", () => {
    expect(formatRecordDate(new Date(Date.UTC(2026, 6, 22)))).toBe("22 Jul 2026");
    expect(formatRecordDate(new Date(Date.UTC(2026, 0, 5)))).toBe("05 Jan 2026");
  });

  it("round-trips the fixture dates", () => {
    for (const s of ["22 Jul 2026", "19 Jul 2026", "12 Jul 2026"]) {
      expect(formatRecordDate(parseRecordDate(s))).toBe(s);
    }
  });

  it("accepts ISO input as well, for API callers", () => {
    expect(formatRecordDate(parseRecordDate("2026-07-22"))).toBe("22 Jul 2026");
  });

  it("throws on an unparseable date", () => {
    expect(() => parseRecordDate("sometime last summer")).toThrow(CodecError);
  });
});
