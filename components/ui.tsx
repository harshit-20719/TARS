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

/**
 * What to call someone on screen.
 *
 * A blank label reads as a broken row, or as signed-out. Google supplies a name,
 * but the dev credentials provider and a row the adapter has just created need
 * not — so the email's local part stands in, which is short enough for a chip and
 * recognisable to colleagues.
 *
 * Distinct from the `name ?? email` fallback in `createDeal`/`reassignDeal`: that
 * one fills a stored display field and keeps the whole address, where this is for
 * a compact UI slot. Merging them would change what one of them renders.
 */
export function personLabel(name: string | null, email: string): string {
  return name?.trim() || email.split("@")[0];
}
