import type { DealRecord, Lens, SubDimensionScore } from "@/mock/types";
import { scoreToNumber } from "./scoring";

export function scoreMap(rec: DealRecord): Map<string, SubDimensionScore> {
  return new Map(rec.scores.map((s) => [s.subDimensionKey, s]));
}

/**
 * Which rooted sub-dimension sets the slide's ceiling (plan R10).
 * peak -> the strongest rooted sub-score; weakest-link -> the weakest.
 * The app surfaces this as context; it never authors the slide value.
 */
export function driverRootKey(
  lens: Lens,
  rootedSubKeys: string[],
  scores: Map<string, SubDimensionScore>,
): string | null {
  const scored = rootedSubKeys
    .map((k) => ({ k, n: scoreToNumber(scores.get(k)?.value ?? null) }))
    .filter((x): x is { k: string; n: number } => x.n !== null);
  if (scored.length === 0) return null;
  return scored.reduce((best, cur) =>
    lens === "peak" ? (cur.n > best.n ? cur : best) : cur.n < best.n ? cur : best,
  ).k;
}
