import type { DealRecord } from "@/mock/types";
import { PILLARS, L1_CAP, subByKey } from "@/framework";
import { floorBreaches } from "./domain/rules";
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
  /** Floor rows tripped at the framework's kill value — what sets floorStatus. */
  killedBy: string[];
  /** Floor rows tripped where the framework says flag, not kill (spec D5). */
  mandatoryClears: string[];
  /** Conditions the PM flagged on a score, which is a separate thing from a breach. */
  flags: string[];
}

export function computeRollup(rec: DealRecord): Rollup {
  const slideBy = new Map(rec.slides.map((s) => [s.slideKey, s]));
  const scoreBy = new Map(rec.scores.map((s) => [s.subDimensionKey, s]));

  const exceptional = PILLARS.filter((p) => (slideBy.get(p.key)?.value ?? -1) >= L1_CAP);
  const critEx = exceptional.filter((p) => p.kind === "critical");

  /**
   * Delegated to the domain rule so the scorecard and the capture grid agree on
   * what a breach is. Each floor row declares its own trip value, which is why a
   * 1 on Ambition & exit-type fit or Cap-table health lands here — both are 1–5
   * rows the framework kills at 1, not binary Fails (AE2).
   */
  const breaches = floorBreaches(rec.scores);
  const killedBy = breaches.filter((b) => b.weight === "kill");
  const mandatoryClears = breaches.filter((b) => b.weight === "flag");

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
    floorStatus: killedBy.length > 0 ? "fail" : "clear",
    killedBy: killedBy.map((b) => b.label),
    mandatoryClears: mandatoryClears.map((b) => b.label),
    flags,
  };
}
