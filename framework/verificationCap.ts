/**
 * L1 verification cap (plan KTD2 / spec D4).
 *
 * At L1 the claims behind a slide are not yet verified, so the bankable
 * ceiling is capped. A higher read is recorded as a provisional
 * ("8 provisional — if the claim verifies"). The exact number is a partner
 * call (spec D4, still open) — this is the working value.
 */
export const L1_CAP = 6;

/** A pillar/track whose banked slide sits at the L1 ceiling is "exceptional for L1". */
export const isExceptionalAtL1 = (banked: number) => banked >= L1_CAP;

/** The band a 0–10 slide falls in, for display. */
export function slideBand(v: number | "NE"): "low" | "mid" | "high" | "peak" {
  if (v === "NE") return "mid";
  if (v >= 5) return "peak";
  if (v >= 4) return "high";
  if (v === 3) return "mid";
  return "low";
}
