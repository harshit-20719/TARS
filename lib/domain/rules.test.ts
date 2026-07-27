import { describe, expect, it } from "vitest";
import { L1_CAP } from "@/framework";
import type { ScaleValue, SubDimensionScore } from "@/mock/types";
import {
  RuleViolation,
  assertLayer,
  assertScoreValue,
  assertSlide,
  flagBreaches,
  floorBreaches,
  killBreaches,
} from "./rules";

/** A binary score on a real sub-dimension key, for the floor tests. */
const binary = (subDimensionKey: string, value: "pass" | "unv" | "fail"): SubDimensionScore => ({
  dealId: "d",
  subDimensionKey,
  scoreType: "binary",
  value,
  evidenceObsIds: [],
  layer: "L1",
});

/** A 1–5 score, for the two hygiene rows the framework kills at 1. */
const scale = (subDimensionKey: string, value: ScaleValue): SubDimensionScore => ({
  dealId: "d",
  subDimensionKey,
  scoreType: "scale",
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
      expect(() => assertScoreValue("ip-ownership", v)).not.toThrow();
    }
  });

  it("refuses a 1–5 read on a binary hygiene row", () => {
    // Not a rounding problem — the two scales mean different things.
    expect(() => assertScoreValue("ip-ownership", 3)).toThrow(RuleViolation);
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
  it("reports a failed binary hygiene row", () => {
    const breaches = floorBreaches([binary("ip-ownership", "fail")]);
    expect(breaches.map((b) => b.subDimensionKey)).toEqual(["ip-ownership"]);
    expect(breaches[0].label).toBe("IP ownership & cleanliness");
    expect(breaches[0].weight).toBe("kill");
  });

  it("ignores a passing or unverified binary floor row", () => {
    expect(floorBreaches([binary("ip-ownership", "pass")])).toEqual([]);
    expect(floorBreaches([binary("ip-ownership", "unv")])).toEqual([]);
  });

  /**
   * The case a "binary rows scored fail" check silently misses. Both of these
   * rows are scored 1–5 in Notion with the kill written at 1, so a floor check
   * keyed on binary/fail reports the deal clean exactly when the framework says
   * drop it — a false negative in the one direction that costs money.
   */
  it.each(["ambition-fit", "cap-table-health"])("reports a 1 on the %s kill-floor", (key) => {
    const breaches = floorBreaches([scale(key, 1)]);
    expect(breaches.map((b) => b.subDimensionKey)).toEqual([key]);
    expect(breaches[0].weight).toBe("kill");
    expect(breaches[0].value).toBe(1);
  });

  it("does not report a kill-floor row above its kill value", () => {
    for (const v of [2, 3, 4, 5] as const) {
      expect(floorBreaches([scale("cap-table-health", v)])).toEqual([]);
    }
    // NE is "not enough evidence", explicitly distinct from a 1.
    expect(floorBreaches([scale("cap-table-health", "NE")])).toEqual([]);
  });

  it("ignores a 1 on a scale row that is not a floor row", () => {
    // Earned insight can be a 1 without any hygiene consequence.
    expect(floorBreaches([scale("earned-insight", 1)])).toEqual([]);
  });

  it("separates a flag from a kill, because the framework does", () => {
    // Engineering self-sufficiency reads "Flag, not an auto-kill" (spec D5).
    const all = floorBreaches([binary("eng-self-sufficiency", "fail")]);
    expect(all).toHaveLength(1);
    expect(all[0].weight).toBe("flag");
    expect(all[0].open).toMatch(/flag vs hard kill/);
    expect(killBreaches([binary("eng-self-sufficiency", "fail")])).toEqual([]);
    expect(flagBreaches([binary("eng-self-sufficiency", "fail")])).toHaveLength(1);
  });

  it("reports every breach, and only reports — it returns no verdict", () => {
    const result = floorBreaches([
      binary("ip-ownership", "fail"),
      binary("india-incorporation", "fail"),
      scale("cap-table-health", 1),
      binary("capital-cleanliness", "pass"),
      scale("ambition-fit", 4),
    ]);
    expect(result.map((b) => b.subDimensionKey)).toEqual([
      "ip-ownership",
      "india-incorporation",
      "cap-table-health",
    ]);
    // The shape carries facts, nothing resembling a decision.
    expect(Object.keys(result[1]).sort()).toEqual(["label", "subDimensionKey", "value", "weight"]);
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
