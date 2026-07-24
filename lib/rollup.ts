import type { DealRecord } from "@/mock/types";
import { PILLARS, ALL_SUBS, L1_CAP, subByKey } from "@/framework";
import { scoreToNumber } from "./scoring";

/**
 * The scorecard roll-up (plan R12 / AE6). Facts only — no total, no composite,
 * no gate verdict. Gate logic is Pending in the framework (spec D1).
 */
export interface Rollup {
  exceptionalPillars: string[];
  exceptionalCount: number;
  totalPillars: number;
  hasCriticalExceptional: boolean;
  criticalExceptionalNames: string[];
  founderFloorClears: boolean;
  floorStatus: "clear" | "fail";
  flags: string[];
}

export function computeRollup(rec: DealRecord): Rollup {
  const slideBy = new Map(rec.slides.map((s) => [s.slideKey, s]));
  const scoreBy = new Map(rec.scores.map((s) => [s.subDimensionKey, s]));

  const exceptional = PILLARS.filter((p) => (slideBy.get(p.key)?.value ?? -1) >= L1_CAP);
  const critEx = exceptional.filter((p) => p.kind === "critical");

  // Floor fails only on a binary hygiene row scored Fail (AE2).
  const floorFail = ALL_SUBS.some((s) => s.floor && scoreBy.get(s.key)?.value === "fail");

  const floorDim = rec.founderTypeRead.floorDimension;
  const floorDimScore = floorDim ? scoreBy.get(floorDim) : undefined;
  const founderFloorClears = !!floorDimScore && (scoreToNumber(floorDimScore.value) ?? 0) >= 3;

  const flags = rec.scores
    .filter((s) => s.flag)
    .map((s) => subByKey(s.subDimensionKey)?.label ?? s.subDimensionKey);

  return {
    exceptionalPillars: exceptional.map((p) => p.name),
    exceptionalCount: exceptional.length,
    totalPillars: PILLARS.length,
    hasCriticalExceptional: critEx.length > 0,
    criticalExceptionalNames: critEx.map((p) => p.name),
    founderFloorClears,
    floorStatus: floorFail ? "fail" : "clear",
    flags,
  };
}
