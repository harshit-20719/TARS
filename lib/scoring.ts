import type { SubDimensionScore, ScoreValue } from "@/mock/types";

/** Numeric value of a score, or null for NE / binary / unset (plan U7). */
export function scoreToNumber(v: ScoreValue | undefined | null): number | null {
  return typeof v === "number" ? v : null;
}

export type Band = "low" | "mid" | "high" | "peak" | "pass" | "fail" | "unv" | "none";

export function bandOf(score?: SubDimensionScore): Band {
  if (!score) return "none";
  if (score.scoreType === "binary") {
    return score.value === "pass" ? "pass" : score.value === "fail" ? "fail" : "unv";
  }
  if (score.value === "NE") return "mid";
  const n = Number(score.value);
  if (n >= 5) return "peak";
  if (n >= 4) return "high";
  if (n === 3) return "mid";
  return "low";
}

export function scoreLabel(score?: SubDimensionScore): string {
  if (!score) return "–";
  if (score.scoreType === "binary") {
    return score.value === "pass" ? "PASS" : score.value === "fail" ? "FAIL" : "UNV";
  }
  return String(score.value);
}

export function pillClass(score?: SubDimensionScore): string {
  return `score-pill b-${bandOf(score)}`;
}

/** Soft completeness rule (plan KTD6): a value with no evidence is incomplete. */
export function isIncomplete(score?: SubDimensionScore): boolean {
  return !!score && score.evidenceObsIds.length === 0;
}
