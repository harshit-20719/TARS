import type { SubDimensionScore } from "@/mock/types";
import { RUBRICS } from "@/framework";
import { ScorePill } from "./ui";

/**
 * Founder read radar: the Founder & Team 1–5 scale sub-scores only — the
 * capture behind the Founder/s track, never the 0–10 slide itself. Unscored
 * or NE axes get no vertex (a gap, not a fake zero), and the exact values sit
 * beside the chart so the shape is a summary, not the measurement.
 */

/** Short axis labels — the full Notion labels do not fit a 210px radar. */
const SHORT: Record<string, string> = {
  "earned-insight": "Earned insight",
  "learning-rate": "Learning rate",
  "track-record": "Track record",
  coachability: "Coachability",
  "drive-resilience": "Drive",
  communication: "Storytelling",
  "ambition-fit": "Ambition",
};

const R = 74;
const CX = 105;
const CY = 96;

function point(i: number, n: number, r: number): [number, number] {
  const a = (-90 + (360 / n) * i) * (Math.PI / 180);
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function ringPath(n: number, r: number): string {
  return (
    Array.from({ length: n }, (_, i) => point(i, n, r))
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ") + " Z"
  );
}

export function FounderRadar({ scores }: { scores: Map<string, SubDimensionScore> }) {
  const axes = (RUBRICS.find((r) => r.key === "ft")?.subs ?? []).filter((s) => s.type === "scale");
  const n = axes.length;
  const rOf = (v: number) => (v / 5) * R;

  const vertices = axes.map((s, i) => {
    const sc = scores.get(s.key);
    const v = typeof sc?.value === "number" ? sc.value : null;
    return { i, s, sc, v, pt: v !== null ? point(i, n, rOf(v)) : null };
  });
  const scored = vertices.filter((x) => x.pt !== null);
  const closed = scored.length === n;
  const path =
    scored.length >= 2
      ? scored.map((x, k) => `${k === 0 ? "M" : "L"}${x.pt![0].toFixed(1)},${x.pt![1].toFixed(1)}`).join(" ") +
        (closed ? " Z" : "")
      : "";

  return (
    <div className="fr">
      <svg viewBox="0 0 210 196" width={210} height={196} role="img" aria-label="Founder & Team sub-scores, 1 to 5">
        {[1, 3, 5].map((v) => (
          <path key={v} className="fr-ring" d={ringPath(n, rOf(v))} />
        ))}
        {axes.map((s, i) => {
          const [x, y] = point(i, n, R);
          return <line key={s.key} className="fr-spoke" x1={CX} y1={CY} x2={x} y2={y} />;
        })}
        {[1, 3, 5].map((v) => (
          <text key={v} className="fr-scale" x={CX + 4} y={CY - rOf(v) - 2}>
            {v}
          </text>
        ))}
        {path && <path className={`fr-poly${closed ? " closed" : ""}`} d={path} />}
        {scored.map((x) => (
          <circle key={x.s.key} className="fr-dot" cx={x.pt![0]} cy={x.pt![1]} r={3} />
        ))}
      </svg>
      <ul className="fr-list">
        {vertices.map((x) => (
          <li key={x.s.key}>
            <ScorePill score={x.sc} className="sm" />
            <span className="fr-name">{SHORT[x.s.key] ?? x.s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
