import type { SubDimensionScore } from "@/mock/types";
import type { SubDimension } from "@/framework";
import { RUBRICS } from "@/framework";
import { bandOf, isIncomplete, scoreLabel } from "@/lib/scoring";

/**
 * Capture viz (R12): the whole capture block as one small grid — a cell per
 * sub-dimension, band-colored, carrying the score itself (1–5, NE, P/F/U).
 * Dashed = scored with no evidence (incomplete, KTD6); warn dot = flagged.
 * The 1–5 scale stays here and never shares an axis with the 0–10 slides.
 */

function cellLabel(sc?: SubDimensionScore): string {
  if (!sc) return "";
  if (sc.scoreType === "binary") return sc.value === "pass" ? "P" : sc.value === "fail" ? "F" : "U";
  return String(sc.value);
}

function cellTitle(rubricLabel: string, s: SubDimension, sc?: SubDimensionScore): string {
  const val = sc ? scoreLabel(sc) : "unscored";
  const inc = isIncomplete(sc) ? " · incomplete (no evidence)" : "";
  const flag = sc?.flag ? " · flagged" : "";
  return `${rubricLabel} · ${s.label} — ${val}${inc}${flag}`;
}

/** Full grid: one row per rubric, direct-labeled cells. */
export function CaptureGrid({ scores }: { scores: Map<string, SubDimensionScore> }) {
  return (
    <div className="cg">
      {RUBRICS.map((r) => (
        <div key={r.key} className="cg-row">
          <span className="cg-label">{r.label}</span>
          <span className="cg-cells">
            {r.subs.map((s) => {
              const sc = scores.get(s.key);
              return (
                <span
                  key={s.key}
                  className={`cg-cell b-${bandOf(sc)}${isIncomplete(sc) ? " inc" : ""}${sc?.flag ? " flag" : ""}`}
                  title={cellTitle(r.label, s, sc)}
                >
                  {cellLabel(sc)}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One-line fingerprint for list rows: a tick per sub-dimension, gap-grouped by rubric. */
export function CaptureStrip({ scores }: { scores: Map<string, SubDimensionScore> }) {
  return (
    <span className="cg-strip">
      {RUBRICS.map((r) => (
        <span key={r.key} className="cg-seg">
          {r.subs.map((s) => {
            const sc = scores.get(s.key);
            return <span key={s.key} className={`cg-tick b-${bandOf(sc)}`} title={cellTitle(r.label, s, sc)} />;
          })}
        </span>
      ))}
    </span>
  );
}
