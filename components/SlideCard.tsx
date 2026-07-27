import type { Slide, SubDimensionScore } from "@/mock/types";
import type { Pillar, Track } from "@/framework";
import { L1_CAP, isExceptionalAtL1, subByKey } from "@/framework";
import { driverRootKey } from "@/lib/judgment";
import { ScorePill } from "./ui";

/**
 * One pillar/track slide. The value, provisional, and guard are the PM's
 * human read (from the record); the app only surfaces the rooted sub-scores
 * and marks which one sets the ceiling under the lens (R9, R10). It never
 * computes the slide.
 */
export function SlideCard({
  def,
  slide,
  scores,
  kindLabel,
}: {
  def: Pillar | Track;
  slide?: Slide;
  scores: Map<string, SubDimensionScore>;
  kindLabel: "critical" | "fillable" | "track";
}) {
  const lens = slide?.lens ?? def.lens;
  const rootedKeys = def.rooted.map((r) => r.subKey);
  const driver = driverRootKey(lens, rootedKeys, scores);
  const banked = slide?.value;
  const prov = slide?.provisionalValue;
  const exceptional = banked !== undefined && isExceptionalAtL1(banked);

  const pct = (n: number) => `${(n / 10) * 100}%`;

  return (
    <div className={`slide-card ${exceptional ? "exceptional" : ""}`}>
      <div className="slide-top">
        <div>
          <div className="slide-name">{def.name}</div>
          <div className="slide-tags">
            {kindLabel === "critical" && <span className="chip bad">critical</span>}
            {kindLabel === "fillable" && <span className="chip accent">fillable</span>}
            {kindLabel === "track" && <span className="chip line">track</span>}
            <span className="chip line">lens · {lens}</span>
            {exceptional && (
              <span className="chip accent">
                <span className="dot" />
                exceptional at L1
              </span>
            )}
          </div>
        </div>
        <div className="slide-val">
          {banked !== undefined ? (
            <>
              <div className="big">
                {banked}
                <span>/10</span>
              </div>
              {prov !== undefined && <div className="prov">{prov} provisional</div>}
            </>
          ) : (
            <div className="chip line">not set</div>
          )}
        </div>
      </div>

      {banked !== undefined && (
        <div className="meter">
          <div className="meter-track">
            {prov !== undefined && <div className="meter-fill prov" style={{ width: pct(prov) }} />}
            <div className="meter-fill" style={{ width: pct(banked) }} />
            <div className="meter-cap" style={{ left: pct(L1_CAP) }} />
          </div>
          <div className="meter-scale">
            <span>0</span>
            <span>10</span>
          </div>
        </div>
      )}

      <div className="rooted">
        <span className="rl">rooted</span>
        {/* An empty rooting is a real state of the framework, not a missing config:
            no capture row's "Roots to" column names business-model innovation, and
            the Idea track reads the pillar slides rather than any capture row. Say
            so rather than showing an empty strip. */}
        {def.rooted.length === 0 ? (
          <span className="root-item mut">{def.note ?? "no capture row roots here"}</span>
        ) : (
          def.rooted.map((r) => {
            const sub = subByKey(r.subKey);
            const isDriver = r.subKey === driver;
            return (
              <span key={r.subKey} className={`root-item ${isDriver ? "cap-driver" : ""}`}>
                <ScorePill score={scores.get(r.subKey)} className="sm" /> {sub?.label ?? r.subKey}
                {isDriver ? " · sets ceiling" : ""}
              </span>
            );
          })
        )}
      </div>

      {slide?.ceilingGuard && (
        <div className="guard">
          <span className="gl">ceiling guard</span>
          <span>{slide.ceilingGuard}</span>
        </div>
      )}
    </div>
  );
}
