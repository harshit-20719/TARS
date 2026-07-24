import type { SubDimensionScore } from "@/mock/types";
import { pillClass, scoreLabel } from "@/lib/scoring";
import { slideBand } from "@/framework";

/** A sub-dimension score rendered as a mono, band-colored pill. */
export function ScorePill({ score, className = "" }: { score?: SubDimensionScore; className?: string }) {
  return <span className={`${pillClass(score)} ${className}`.trim()}>{scoreLabel(score)}</span>;
}

/** A 0–10 slide (or NE) value pill. */
export function SlidePill({ value }: { value: number | "NE" }) {
  return <span className={`score-pill b-${slideBand(value)}`}>{value}</span>;
}
