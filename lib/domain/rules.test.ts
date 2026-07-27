import { describe, expect, it } from "vitest";
import { L1_CAP } from "@/framework";
import type { SubDimensionScore } from "@/mock/types";
import { RuleViolation, assertLayer, assertScoreValue, assertSlide, floorBreaches } from "./rules";

/** A binary score on a real sub-dimension key, for the floor tests. */
const binary = (subDimensionKey: string, value: "pass" | "unv" | "fail"): SubDimensionScore => ({
  dealId: "d",
  subDimensionKey,
  scoreType: "binary",
  value,
  evidenceObsIds: [],
  layer: "L1",
});

describe("score values against their sub-dimension", () => {
  it("accepts a 1–5 read on a scale row", () => {
    expect(assertScoreValue("earned-insight", 4).type).toBe("scale");
  });

  it("accepts NE on a scale row", () => {
    expect(() => assertScoreValue("earned-insight", "NE")).not.toThrow();
  });

  it("accepts pass/unv/fail on a binary row", () => {
    for (const v of ["pass", "unv", "fail"] as const) {
      expect(() => assertScoreValue("ip-boundary", v)).not.toThrow();
    }
  });

  it("refuses a 1–5 read on a binary hygiene row", () => {
    // Not a rounding problem — the two scales mean different things.
    expect(() => assertScoreValue("ip-boundary", 3)).toThrow(RuleViolation);
  });

  it("refuses a pass/fail read on a scale row", () => {
    expect(() => assertScoreValue("earned-insight", "pass")).toThrow(RuleViolation);
  });

  it("refuses an unknown sub-dimension key", () => {
    expect(() => assertScoreValue("not-a-real-row", 3)).toThrow(/no such sub-dimension/);
  });
});

describe("slides", () => {
  const ok = {
    slideKey: "earned-secret",
    value: 5,
    ceilingGuard: "Earned insight at 4 sets the ceiling; the settlement claim is unverified.",
    lens: "peak" as const,
  };

  it("accepts a banked read at or below the L1 cap", () => {
    expect(() => assertSlide({ ...ok, value: L1_CAP })).not.toThrow();
  });

  it("refuses a banked read above the cap, and says what to do instead", () => {
    expect(() => assertSlide({ ...ok, value: L1_CAP + 1 })).toThrow(/provisional/);
  });

  it("allows a provisional above the cap — that is the whole point of it", () => {
    expect(() => assertSlide({ ...ok, value: 5, provisionalValue: 9 })).not.toThrow();
  });

  it("refuses a provisional below the banked value", () => {
    expect(() => assertSlide({ ...ok, value: 5, provisionalValue: 3 })).toThrow(
      /sits below the banked/,
    );
  });

  it("refuses a slide outside 0–10", () => {
    expect(() => assertSlide({ ...ok, value: -1 })).toThrow(RuleViolation);
    expect(() => assertSlide({ ...ok, value: 5, provisionalValue: 11 })).toThrow(RuleViolation);
  });

  it("requires a ceiling guard — the anti-vibe rule", () => {
    expect(() => assertSlide({ ...ok, ceilingGuard: "   " })).toThrow(/ceiling/);
  });

  it("requires the ceiling guard to be one line", () => {
    expect(() => assertSlide({ ...ok, ceilingGuard: "first line\nsecond line" })).toThrow(
      /single line/,
    );
  });

  it("refuses a lens the framework does not give that slide", () => {
    // gtm-engine reads weakest-link; claiming peak would change its meaning.
    expect(() => assertSlide({ ...ok, slideKey: "gtm-engine", lens: "peak" })).toThrow(/lens/);
    expect(() =>
      assertSlide({ ...ok, slideKey: "gtm-engine", lens: "weakest-link" }),
    ).not.toThrow();
  });

  it("accepts track slides too, on their own lens", () => {
    expect(() =>
      assertSlide({ ...ok, slideKey: "founder", lens: "weakest-link" }),
    ).not.toThrow();
  });

  it("refuses an unknown slide key", () => {
    expect(() => assertSlide({ ...ok, slideKey: "vibes" })).toThrow(/no such pillar or track/);
  });
});

describe("floor breaches", () => {
  it("reports a failed hygiene floor row", () => {
    const breaches = floorBreaches([binary("ip-boundary", "fail")]);
    expect(breaches.map((b) => b.subDimensionKey)).toEqual(["ip-boundary"]);
    expect(breaches[0].label).toBe("Prior-employer IP boundary");
  });

  it("ignores a passing or unverified floor row", () => {
    expect(floorBreaches([binary("ip-boundary", "pass")])).toEqual([]);
    expect(floorBreaches([binary("ip-boundary", "unv")])).toEqual([]);
  });

  it("ignores a failed row that is not a floor row", () => {
    // sales-efficiency is binary but roots to Capture, not the floor.
    expect(floorBreaches([binary("sales-efficiency", "fail")])).toEqual([]);
  });

  it("reports every breach, and only reports — it returns no verdict", () => {
    const result = floorBreaches([
      binary("ip-boundary", "fail"),
      binary("runway", "fail"),
      binary("cap-table-health", "pass"),
    ]);
    expect(result).toHaveLength(2);
    // The shape carries facts, nothing resembling a decision.
    expect(Object.keys(result[0]).sort()).toEqual(["label", "subDimensionKey"]);
  });
});

describe("layer stamping", () => {
  it("accepts L1", () => {
    expect(() => assertLayer("L1")).not.toThrow();
  });

  it("refuses layers this build does not record", () => {
    expect(() => assertLayer("L2")).toThrow(RuleViolation);
  });
});
