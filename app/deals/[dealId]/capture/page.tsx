import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { RUBRICS, type ScaleAnchors, type BinaryAnchors } from "@/framework";
import { scoreMap } from "@/lib/judgment";
import { candidateEvidenceBySubDimension } from "@/lib/coverage";
import { ScorePill } from "@/components/ui";
import { ScoreControl } from "@/components/authoring/ScoreControl";
import { MacroBlock } from "@/components/authoring/MacroBlock";
import { Icon } from "@/components/icons";

export default async function CapturePage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const scores = scoreMap(rec);

  /**
   * Candidate evidence, grouped by the row it was filed under. A PM cites the
   * observations that speak to the row they are scoring; offering all of a deal's
   * observations on every one of forty-one rows would make the right answer harder
   * to find, not easier. Rejected drafts are left out — the PM already refused them.
   *
   * Shared with the floor page, which built the same map, and with coverage, which
   * needs the rejected ones this drops.
   */
  const obsBySub = candidateEvidenceBySubDimension(rec);

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Step 3 · You author every score</span>
        <h1 className="page-title">Capture scoring</h1>
        <p className="page-lede">
          Score each sub-dimension 1–5 or pass/fail against the anchors shown. The evidence is already attached —
          every observation filed under a row is cited by its score, so the only thing left is the number. A row
          with nothing filed under it still scores, and shows as incomplete.
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

      {RUBRICS.map((r, i) => {
        const scoredCount = r.subs.filter((s) => scores.has(s.key)).length;
        const floorRows = r.subs.filter((s) => s.floor);
        const trippedHere = floorRows.filter((s) => {
          const sc = scores.get(s.key);
          return sc && sc.value === s.floor!.breachAt;
        });
        return (
          <MacroBlock
            key={r.key}
            title={r.label}
            scored={scoredCount}
            total={r.subs.length}
            floorNote={
              floorRows.length === 0
                ? undefined
                : trippedHere.length > 0
                  ? `${trippedHere.length} floor tripped`
                  : `${floorRows.length} floor row${floorRows.length === 1 ? "" : "s"}`
            }
            floorBad={trippedHere.length > 0}
            // The first block opens so the page is not a wall of closed cards, and
            // so the grid explains itself without a click.
            defaultOpen={i === 0}
          >
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: "32%" }}>Sub-dimension</th>
                      <th style={{ width: "26%" }}>Anchors</th>
                      <th style={{ width: 56 }}>Score</th>
                      <th style={{ width: "27%" }}>You author this</th>
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
                          </td>
                          <td>
                            <ScoreControl
                              dealId={dealId}
                              sub={s}
                              score={sc}
                              candidates={obsBySub.get(s.key) ?? []}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          </MacroBlock>
        );
      })}
    </div>
  );
}
