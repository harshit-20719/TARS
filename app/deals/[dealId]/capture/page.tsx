import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { RUBRICS, type ScaleAnchors, type BinaryAnchors } from "@/framework";
import { scoreMap } from "@/lib/judgment";
import { ScorePill } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function CapturePage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const scores = scoreMap(rec);
  const obsById = new Map(rec.observations.map((o) => [o.id, o]));

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Step 3 · You author every score</span>
        <h1 className="page-title">Capture scoring</h1>
        <p className="page-lede">
          Score each sub-dimension 1–5 or pass/fail with the anchors shown, and attach at least one observation as
          evidence. A score with no evidence is flagged incomplete, not counted.
        </p>
      </div>

      <div className="callout neutral">
        <span className="co-badge">reading the grid</span>
        <span className="legend">
          <span>
            <span className="score-pill b-peak sm">5</span> peak
          </span>
          <span>
            <span className="score-pill b-high sm">4</span> strong
          </span>
          <span>
            <span className="score-pill b-mid sm">3</span> mid / NE
          </span>
          <span>
            <span className="score-pill b-low sm">2</span> weak
          </span>
          <span>
            <span className="score-pill b-pass sm">PASS</span> / <span className="score-pill b-fail sm">FAIL</span> binary floor
          </span>
          <span>
            <span className="chip warn">
              <span className="dot" />
              incomplete
            </span>{" "}
            scored, no evidence
          </span>
        </span>
      </div>

      {RUBRICS.map((r) => {
        const scoredCount = r.subs.filter((s) => scores.has(s.key)).length;
        return (
          <div className="card" key={r.key}>
            <div className="card-head">
              <h2>{r.label}</h2>
              <div className="spacer" />
              <span className="count">
                {scoredCount}/{r.subs.length} scored
              </span>
            </div>
            <div className="card-body flush">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: "32%" }}>Sub-dimension</th>
                      <th>Anchors</th>
                      <th style={{ width: 72 }}>Score</th>
                      <th style={{ width: "26%" }}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.subs.map((s) => {
                      const sc = scores.get(s.key);
                      const anchors: [string, string][] =
                        s.type === "binary"
                          ? [
                              ["F", (s.anchors as BinaryAnchors).fail],
                              ["U", (s.anchors as BinaryAnchors).unv],
                              ["P", (s.anchors as BinaryAnchors).pass],
                            ]
                          : [
                              ["1", (s.anchors as ScaleAnchors).low],
                              ["3", (s.anchors as ScaleAnchors).mid],
                              ["5", (s.anchors as ScaleAnchors).high],
                            ];
                      return (
                        <tr key={s.key}>
                          <td>
                            <div className="sub-label">
                              {r.key.toUpperCase()}-{s.index} · {s.label}
                            </div>
                            <div className="roots">{s.whatItTests}</div>
                            <div className="roots">
                              roots to · {s.rootsTo}
                              {s.floor && (
                                <>
                                  {" "}
                                  <span className={`chip xs ${s.floor.weight === "kill" ? "bad" : "warn"}`}>
                                    {s.floor.weight === "kill" ? "kill" : "flag"} at{" "}
                                    {s.floor.breachAt === "fail" ? "Fail" : s.floor.breachAt}
                                  </span>
                                </>
                              )}
                            </div>
                            {s.open && (
                              <div className="roots" style={{ color: "var(--warn)" }}>
                                <Icon name="flag" className="i sm" /> open: {s.open}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="anchors">
                              {anchors.map(([k, t]) => (
                                <span className="anchor" key={k}>
                                  <b>{k}</b>
                                  {t}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <ScorePill score={sc} />
                            {sc?.flag && (
                              <div style={{ marginTop: 4 }}>
                                <span className="chip warn xs">
                                  <span className="dot" />
                                  flagged
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            {sc && sc.evidenceObsIds.length > 0 ? (
                              <div className="ev-list">
                                {sc.evidenceObsIds.map((id) => {
                                  const o = obsById.get(id);
                                  return o ? (
                                    <span className="ev" key={id}>
                                      <span className="q">
                                        {o.quote.slice(0, 62)}
                                        {o.quote.length > 62 ? "…" : ""}
                                      </span>
                                    </span>
                                  ) : null;
                                })}
                              </div>
                            ) : sc ? (
                              <span className="ev-missing">
                                <Icon name="alert" className="i sm" /> no evidence — incomplete
                              </span>
                            ) : (
                              <span className="mut" style={{ fontSize: 12 }}>
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
