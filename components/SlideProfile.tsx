import type { Slide } from "@/mock/types";
import type { Pillar, Track } from "@/framework";
import { PILLARS, TRACKS, L1_CAP, isExceptionalAtL1 } from "@/framework";

/**
 * Judgment viz (R9/R12): every 0–10 slide plotted as a dot on one shared axis
 * so pillars and tracks compare by position. Banked = filled dot, provisional
 * = open dot, the L1 cap is one rule across all rows. Positions only — no
 * total, no average, and the 1–5 capture scale never appears here.
 */

const pct = (n: number) => `${(n / 10) * 100}%`;

/** One slide as a dot-strip on the 0–10 axis. Pair with SlideAxis for the scale. */
export function SlideStrip({ slide, labelProvisional = false }: { slide?: Slide; labelProvisional?: boolean }) {
  const banked = slide?.value;
  const prov = slide?.provisionalValue;
  const hot = banked !== undefined && isExceptionalAtL1(banked);
  return (
    <div className="ss" title={slide?.ceilingGuard}>
      <span className="ss-base" />
      <span className="ss-cap" style={{ left: pct(L1_CAP) }} />
      {banked !== undefined && prov !== undefined && prov > banked && (
        <span className="ss-link" style={{ left: pct(banked), width: pct(prov - banked) }} />
      )}
      {prov !== undefined && (
        <>
          <span className="ss-dot prov" style={{ left: pct(prov) }} />
          {labelProvisional && (
            <span className={`ss-num${prov >= 9 ? " flip" : ""}`} style={{ left: pct(prov) }}>
              {prov} prov
            </span>
          )}
        </>
      )}
      {banked !== undefined && <span className={`ss-dot${hot ? " hot" : ""}`} style={{ left: pct(banked) }} />}
    </div>
  );
}

/** The shared 0–10 scale, labeled once above a set of SlideStrips. */
export function SlideAxis() {
  return (
    <div className="ss-axis">
      <span className="t0">0</span>
      <span className="tc" style={{ left: pct(L1_CAP) }}>
        L1 cap · {L1_CAP}
      </span>
      <span className="t10">10</span>
    </div>
  );
}

const GROUPS: { label: string; defs: (Pillar | Track)[] }[] = [
  { label: "Critical pillars", defs: PILLARS.filter((p) => p.kind === "critical") },
  { label: "Fillable pillars", defs: PILLARS.filter((p) => p.kind === "fillable") },
  { label: "Tracks", defs: TRACKS },
];

/** All ten slides on the shared axis, grouped, with the precise values alongside. */
export function SlideProfile({ slides }: { slides: Slide[] }) {
  const slideBy = new Map(slides.map((s) => [s.slideKey, s]));
  return (
    <div className="sp">
      <div className="sp-row head">
        <span />
        <SlideAxis />
        <span className="sp-vh">banked</span>
      </div>
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="sp-group">{g.label}</div>
          {g.defs.map((d) => {
            const sl = slideBy.get(d.key);
            return (
              <div key={d.key} className="sp-row">
                <span className="sp-name">{d.name}</span>
                <SlideStrip slide={sl} />
                <span className="sp-val">
                  {sl ? sl.value : <span className="mut">—</span>}
                  {sl?.provisionalValue !== undefined && <em>{sl.provisionalValue} prov</em>}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The seven pillars as dots: filled = exceptional at L1, square = critical. */
export function PillarDots({ slides }: { slides: Slide[] }) {
  const slideBy = new Map(slides.map((s) => [s.slideKey, s]));
  return (
    <span className="pdots">
      {PILLARS.map((p) => {
        const v = slideBy.get(p.key)?.value;
        const on = v !== undefined && isExceptionalAtL1(v);
        return (
          <span
            key={p.key}
            className={`pdot${on ? " on" : ""}${p.kind === "critical" ? " crit" : ""}`}
            title={`${p.name} (${p.kind}) — ${v ?? "not set"}${on ? " · exceptional at L1" : ""}`}
          />
        );
      })}
    </span>
  );
}
