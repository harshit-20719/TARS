import { notFound } from "next/navigation";
import { getDeal, getRecord } from "@/mock/data";
import { RUBRICS, PILLARS, TRACKS } from "@/framework";
import { computeRollup } from "@/lib/rollup";
import { scoreMap } from "@/lib/judgment";
import { isIncomplete } from "@/lib/scoring";
import { ScorePill, SlidePill } from "@/components/ui";
import { FounderRadar } from "@/components/FounderRadar";
import { SlideStrip, SlideAxis, PillarDots } from "@/components/SlideProfile";
import { Icon } from "@/components/icons";

export default async function ScorecardPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const deal = getDeal(dealId);
  const rec = getRecord(dealId);
  if (!deal || !rec) notFound();

  const head = (
    <div className="page-head">
      <span className="eyebrow">{deal.company} · rendered from the record</span>
      <h1 className="page-title">Scorecard</h1>
      <p className="page-lede">
        Capture, judgment, and roll-up — generated from the deal record, never authored directly. There is no total,
        no composite, and no gate verdict.
      </p>
    </div>
  );

  if (rec.slides.length === 0) {
    return (
      <div className="page">
        {head}
        <div className="card">
          <div className="empty">
            The scorecard renders once slides are authored. Complete capture scoring and set the judgment slides first.
          </div>
        </div>
      </div>
    );
  }

  const roll = computeRollup(rec);
  const scores = scoreMap(rec);
  const slideBy = new Map(rec.slides.map((s) => [s.slideKey, s]));
  const obsById = new Map(rec.observations.map((o) => [o.id, o]));

  return (
    <div className="page">
      {head}

      <div className={`floor-banner ${roll.floorStatus}`} style={{ marginBottom: 18 }}>
        <span className="fb-icon">
          <Icon name={roll.floorStatus === "fail" ? "alert" : "ok"} />
        </span>
        <div>
          {roll.floorStatus === "fail" ? (
            <>
              <b>Floor: failed.</b> A binary hygiene row is Fail — deal-dropping.
            </>
          ) : (
            <>
              <b>Floor: clear.</b> All binary hygiene rows pass or are pending — no deal-dropping Fail.
            </>
          )}
          {roll.flags.length > 0 && <> One condition flagged: {roll.flags.join(", ")} (spec D5).</>}
        </div>
      </div>

      <div className="sc-block-title" style={{ marginTop: 8 }}>
        Roll-up · facts only
      </div>
      <div className="rollup">
        <div className="rollup-stat">
          <div className="rk">Exceptional pillars</div>
          <div className="rv">
            {roll.exceptionalCount}
            <span className="u">of {roll.totalPillars} · at L1 cap</span>
          </div>
          <div style={{ marginTop: 8 }}><PillarDots slides={rec.slides} /></div>
        </div>
        <div className="rollup-stat">
          <div className="rk">At least one critical?</div>
          <div className="rv" style={{ color: roll.hasCriticalExceptional ? "var(--good)" : "var(--ink-3)" }}>
            {roll.hasCriticalExceptional ? "Yes" : "No"}
            <span className="u">{roll.criticalExceptionalNames.join(", ") || "—"}</span>
          </div>
        </div>
        <div className="rollup-stat">
          <div className="rk">Founder-track floor</div>
          <div className="rv" style={{ color: roll.founderFloorClears ? "var(--good)" : "var(--ink-3)" }}>
            {roll.founderFloorClears ? "Clears" : "Open"}
            <span className="u">on {rec.founderTypeRead.floorDimension || "—"}</span>
          </div>
        </div>
        <div className="rollup-stat">
          <div className="rk">Floor status</div>
          <div className="rv" style={{ color: roll.floorStatus === "fail" ? "var(--bad)" : "var(--good)" }}>
            {roll.floorStatus === "fail" ? "Failed" : "Clear"}
            <span className="u">
              {roll.flags.length} flag{roll.flags.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>
      <div className="no-verdict" style={{ marginTop: 12 }}>
        <Icon name="dot" className="i sm" /> No pass / fail. No go · conditional-go · no-go. Gate logic is Pending in
        the framework (spec D1) — the scorecard reports facts and decides nothing.
      </div>

      <div className="sc-block-title">Founder read</div>
      <div className="card">
        <div className="card-body" style={{ paddingTop: 16, display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
          <FounderRadar scores={scores} />
          {rec.founderTypeRead.primary && (
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", maxWidth: 400 }}>
              <div className="ft-type">{rec.founderTypeRead.primary}</div>
              <div className="ft-secondary" style={{ marginBottom: 6 }}>
                Founder-track floor reads on {rec.founderTypeRead.floorDimension}
              </div>
              {rec.founderTypeRead.pmConfirmation}
            </div>
          )}
        </div>
        <div className="card-note">F&amp;T sub-scores (1–5) — the capture behind the Founder/s track, not the 0–10 slide.</div>
      </div>

      <div className="sc-block-title">Judgment block</div>
      <div className="card">
        <div className="card-body flush">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pillar / track</th>
                  <th style={{ width: 92 }}>Type</th>
                  <th style={{ width: 64 }}>Slide</th>
                  <th style={{ width: 210 }}><SlideAxis /></th>
                  <th>Ceiling guard</th>
                </tr>
              </thead>
              <tbody>
                {PILLARS.map((p) => {
                  const sl = slideBy.get(p.key);
                  return (
                    <tr key={p.key}>
                      <td className="sub-label">{p.name}</td>
                      <td>
                        {p.kind === "critical" ? (
                          <span className="chip bad xs">critical</span>
                        ) : (
                          <span className="chip accent xs">fillable</span>
                        )}
                      </td>
                      <td>
                        {sl ? <SlidePill value={sl.value} /> : <span className="mut">—</span>}
                      </td>
                      <td><SlideStrip slide={sl} labelProvisional /></td>
                      <td style={{ fontSize: 12, color: "var(--ink-2)" }}>{sl?.ceilingGuard}</td>
                    </tr>
                  );
                })}
                {TRACKS.map((t) => {
                  const sl = slideBy.get(t.key);
                  return (
                    <tr key={t.key} style={{ background: "var(--surface-2)" }}>
                      <td className="sub-label">{t.name}</td>
                      <td>
                        <span className="chip line xs">track</span>
                      </td>
                      <td>{sl ? <SlidePill value={sl.value} /> : <span className="mut">—</span>}</td>
                      <td><SlideStrip slide={sl} labelProvisional /></td>
                      <td style={{ fontSize: 12, color: "var(--ink-2)" }}>{sl?.ceilingGuard}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="sc-block-title">Capture block</div>
      <div className="card">
        <div className="card-body flush">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Rubric</th>
                  <th>Sub-dimension</th>
                  <th style={{ width: 64 }}>Score</th>
                  <th style={{ width: "30%" }}>Evidence</th>
                  <th style={{ width: 56 }}>Layer</th>
                </tr>
              </thead>
              <tbody>
                {RUBRICS.flatMap((r) =>
                  r.subs.map((s, i) => {
                    const sc = scores.get(s.key);
                    return (
                      <tr key={s.key}>
                        <td
                          style={{
                            color: i === 0 ? "var(--ink)" : "var(--ink-3)",
                            fontWeight: i === 0 ? 600 : 400,
                            fontSize: i === 0 ? 13 : 12,
                          }}
                        >
                          {i === 0 ? r.label : ""}
                        </td>
                        <td>
                          {s.label}{" "}
                          {isIncomplete(sc) && (
                            <span className="chip warn xs">
                              <span className="dot" />
                              incomplete
                            </span>
                          )}
                          {sc?.flag && (
                            <span className="chip warn xs">
                              <span className="dot" />
                              flag
                            </span>
                          )}
                        </td>
                        <td>
                          <ScorePill score={sc} />
                        </td>
                        <td>
                          {sc && sc.evidenceObsIds.length > 0 ? (
                            sc.evidenceObsIds.map((id) => {
                              const o = obsById.get(id);
                              return o ? (
                                <span className="ev" key={id}>
                                  <span className="q">
                                    {o.quote.slice(0, 54)}
                                    {o.quote.length > 54 ? "…" : ""}
                                  </span>
                                </span>
                              ) : null;
                            })
                          ) : (
                            <span className="mut">—</span>
                          )}
                        </td>
                        <td>
                          <span className="chip line mono xs">L1</span>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card-note">
          Editing the scorecard means editing the underlying scores — every view is generated from the one record
          (R13).
        </div>
      </div>
    </div>
  );
}
