import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { ALL_SUBS, RUBRICS, type BinaryAnchors, type ScaleAnchors } from "@/framework";
import { scoreMap } from "@/lib/judgment";
import { ScorePill } from "@/components/ui";
import { ScoreControl } from "@/components/authoring/ScoreControl";
import { Icon } from "@/components/icons";

/**
 * The floor, on its own page.
 *
 * Ten of the forty-one rows carry a floor rule, and they are scattered across
 * three macro-dimensions — so the only way to read the floor used to be scrolling
 * the whole grid or trusting the banner on the scorecard. For a screening call
 * that is the wrong way round: the floor is the first thing worth knowing and the
 * cheapest thing to establish, because most of these rows are answered by a
 * document rather than by judgment.
 *
 * Two distinctions the page is built to make impossible to miss:
 *
 *  - **Kill vs mandatory condition.** Nine rows kill the deal at their breach
 *    value. One — engineering self-sufficiency — does not; it attaches a condition
 *    that has to be cleared. Rendering them identically would misreport both.
 *  - **Unscored is not clear.** A floor row nobody has looked at is an open
 *    question, and a page that showed it as "not tripped" would be quietly
 *    reassuring about the thing it exists to worry about. Unscored rows sort first.
 *
 * There is still no verdict here. Whether a tripped floor ends the deal is gate
 * logic, which the framework leaves pending (spec D1) — so this reports the facts
 * and stops.
 */
export default async function FloorPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const scores = scoreMap(rec);
  const floorSubs = ALL_SUBS.filter((s) => s.floor);

  const rows = floorSubs.map((s) => {
    const sc = scores.get(s.key);
    const rubric = RUBRICS.find((r) => r.subs.some((x) => x.key === s.key))!;
    const tripped = Boolean(sc && sc.value === s.floor!.breachAt);
    return { sub: s, rubric, score: sc, tripped, unscored: !sc };
  });

  /** Unscored first, then tripped, then clear — worst-known-first. */
  const ordered = [...rows].sort((a, b) => {
    const rank = (r: typeof a) => (r.unscored ? 0 : r.tripped ? 1 : 2);
    return rank(a) - rank(b) || a.sub.label.localeCompare(b.sub.label);
  });

  const kills = rows.filter((r) => r.sub.floor!.weight === "kill");
  const tripped = rows.filter((r) => r.tripped);
  const trippedKills = tripped.filter((r) => r.sub.floor!.weight === "kill");
  const unscored = rows.filter((r) => r.unscored);

  const obsBySub = new Map<string, typeof rec.observations>();
  for (const o of rec.observations) {
    if (o.status === "rejected") continue;
    const list = obsBySub.get(o.subDimensionKey);
    if (list) list.push(o);
    else obsBySub.set(o.subDimensionKey, [o]);
  }

  /**
   * Four states, not three.
   *
   * A tripped mandatory condition is neither a kill nor nothing, and with only
   * three states it fell through to "clear" — so the banner read "Floor: clear.
   * Every floor row is scored and none reads at its breach value" and then, in the
   * next sentence, named the outstanding condition. `lib/steps.ts` already makes
   * this distinction for the sidebar; the page now agrees with it.
   */
  const status: "fail" | "open" | "condition" | "clear" =
    trippedKills.length > 0
      ? "fail"
      : unscored.length > 0
        ? "open"
        : tripped.length > 0
          ? "condition"
          : "clear";

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">The floor · hygiene &amp; structural fit</span>
        <h1 className="page-title">Floor check</h1>
        <p className="page-lede">
          The {rows.length} rows that carry a floor rule, pulled out of the {ALL_SUBS.length}-row grid.{" "}
          {kills.length} of them kill at their breach value; {rows.length - kills.length} attaches a condition
          instead. Score them here — most are answered by a document, not by judgment.
        </p>
      </div>

      <div className={`floor-banner ${status}`} style={{ marginBottom: 18 }}>
        <span className="fb-icon">
          <Icon
            name={
              status === "fail" ? "alert" : status === "open" || status === "condition" ? "flag" : "ok"
            }
          />
        </span>
        <div>
          {status === "fail" ? (
            <>
              <b>Floor: failed.</b> Tripped at the kill value:{" "}
              {trippedKills.map((r) => r.sub.label).join(", ")}.
            </>
          ) : status === "open" ? (
            <>
              <b>Floor: open.</b> {unscored.length} of {rows.length} floor row
              {unscored.length === 1 ? " has" : "s have"} not been scored yet — an unscored floor row is an
              open question, not a pass.
            </>
          ) : status === "condition" ? (
            <>
              <b>Floor: condition outstanding.</b> Every floor row is scored and no kill value is tripped,
              but a mandatory condition has not been cleared.
            </>
          ) : (
            <>
              <b>Floor: clear.</b> Every floor row is scored and none reads at its breach value.
            </>
          )}
          {tripped.some((r) => r.sub.floor!.weight === "flag") && (
            <>
              {" "}
              Outstanding:{" "}
              {tripped
                .filter((r) => r.sub.floor!.weight === "flag")
                .map((r) => r.sub.label)
                .join(", ")}
              . That does not kill the deal — it has to be cleared.
            </>
          )}
        </div>
      </div>

      <div className="summary" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
        <div className="cell">
          <span className="k">Floor rows</span>
          <span className="v">{rows.length}</span>
        </div>
        <div className="cell">
          <span className="k">Scored</span>
          <span className="v">
            {rows.length - unscored.length}/{rows.length}
          </span>
        </div>
        <div className="cell">
          <span className="k">Tripped</span>
          <span className="v" style={{ color: tripped.length ? "var(--bad)" : "var(--good)" }}>
            {tripped.length}
          </span>
        </div>
        <div className="cell">
          <span className="k">Not yet looked at</span>
          <span className="v" style={{ color: unscored.length ? "var(--warn)" : "var(--good)" }}>
            {unscored.length}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-body flush">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Floor row</th>
                  <th style={{ width: "26%" }}>Anchors</th>
                  <th style={{ width: 90 }}>State</th>
                  <th style={{ width: "28%" }}>You author this</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map(({ sub: s, rubric, score: sc, tripped: isTripped, unscored: isUnscored }) => {
                  const kill = s.floor!.weight === "kill";
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
                    <tr key={s.key} className={isTripped ? (kill ? "row-bad" : "row-warn") : undefined}>
                      <td>
                        <div className="sub-label">
                          {rubric.key.toUpperCase()}-{s.index} · {s.label}
                        </div>
                        <div className="roots">{s.whatItTests}</div>
                        <div className="roots">
                          <span className={`chip xs ${kill ? "bad" : "warn"}`}>
                            {kill ? "kill" : "mandatory condition"} at{" "}
                            {s.floor!.breachAt === "fail" ? "Fail" : s.floor!.breachAt}
                          </span>{" "}
                          <span className="mut">in {rubric.label}</span>
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
                        <div style={{ marginTop: 6 }}>
                          {isUnscored ? (
                            <span className="chip warn xs">
                              <span className="dot" />
                              not looked at
                            </span>
                          ) : isTripped ? (
                            <span className={`chip xs ${kill ? "bad" : "warn"}`}>
                              <span className="dot" />
                              {kill ? "tripped" : "condition"}
                            </span>
                          ) : (
                            <span className="chip good xs">
                              <span className="dot" />
                              clear
                            </span>
                          )}
                        </div>
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
        </div>
        <div className="card-note">
          A tripped floor is a fact, not a verdict. Whether it ends the deal is gate logic, which the framework
          leaves open (spec D1) — so nothing here decides for you.
        </div>
      </div>
    </div>
  );
}
