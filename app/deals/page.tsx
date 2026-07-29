import Link from "next/link";
import { listDeals, getRecord } from "@/lib/data";
import { progressOf } from "@/lib/steps";
import { Icon } from "@/components/icons";
import { StatusLine } from "@/components/StatusLine";
import { CaptureStrip } from "@/components/CaptureGrid";
import { PillarDots } from "@/components/SlideProfile";
import { scoreMap } from "@/lib/judgment";
import { computeRollup } from "@/lib/rollup";
import { NewDealForm } from "@/components/authoring/NewDealForm";
import { MINE, NoDealsFound, OWNER_PARAM, OwnerFilter } from "@/components/DealsFilter";
import { currentActor } from "@/lib/session";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, actor] = await Promise.all([searchParams, currentActor()]);
  const mine = params[OWNER_PARAM] === MINE;

  /**
   * KTD9. "Mine" is a `where` clause, not a filter applied after the fact, so the
   * page asks for the right rows rather than fetching every deal and discarding
   * most of them.
   *
   * The null-actor branch is not defensive noise. `listDeals(undefined)` returns
   * *everything*, so falling through would label the whole workspace's deals as
   * one person's — a filter that silently shows too much is worse than one that
   * shows nothing.
   */
  const deals = mine ? (actor ? await listDeals(actor.id) : []) : await listDeals();
  // Each row renders from its deal's record, so fetch them all up front
  // rather than awaiting inside the map below.
  const records = new Map(
    await Promise.all(deals.map(async (d) => [d.id, await getRecord(d.id)] as const)),
  );
  return (
    <main className="main">
      <div className="deals-wrap">
        <div className="page-head">
          <span className="eyebrow">
            <Icon name="dot" className="i sm" /> Conviction · Layer 1
          </span>
          <h1 className="page-title">Deals</h1>
          <p className="page-lede">
            One record per deal, opened at the first real call. Open a deal to paste a transcript, review the
            machine&apos;s drafts, score the six rubrics, and read the scorecard.
          </p>
        </div>

        <div className="deals-toolbar">
          <div className="search">
            <Icon name="dot" className="i sm" />
            <input placeholder="Search deals…" aria-label="Search deals" />
          </div>
          <OwnerFilter mine={mine} />
          <div className="spacer" />
          <NewDealForm />
        </div>

        {deals.length === 0 && <NoDealsFound mine={mine} />}

        {deals.map((d) => {
          const rec = records.get(d.id);
          const p = rec ? progressOf(rec) : null;
          const roll = rec ? computeRollup(rec) : null;
          return (
            <Link key={d.id} href={`/deals/${d.id}`} className="deal-row">
              <div>
                <div className="dr-name">{d.company}</div>
                <div className="dr-desc">{d.oneLiner}</div>
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="chip line">{d.founders}</span>
                  {p?.hasDrafts ? (
                    <span className="chip good">
                      <span className="dot" />
                      drafts in
                    </span>
                  ) : (
                    <span className="chip pending">
                      <span className="dot" />
                      no transcript
                    </span>
                  )}
                  {p?.scorecardReady && <span className="chip accent">scorecard ready</span>}
                  {roll?.floorStatus === "fail" ? (
                    <span className="chip bad">
                      <span className="dot" />
                      floor failed
                    </span>
                  ) : roll && roll.flags.length + roll.mandatoryClears.length > 0 ? (
                    <span className="chip warn">
                      <span className="dot" />
                      {roll.flags.length + roll.mandatoryClears.length} flag
                      {roll.flags.length + roll.mandatoryClears.length !== 1 ? "s" : ""}
                    </span>
                  ) : null}
                </div>
                {rec && rec.scores.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <CaptureStrip scores={scoreMap(rec)} />
                    {rec.slides.length > 0 && <PillarDots slides={rec.slides} />}
                  </div>
                )}
              </div>
              <div className="dr-col">
                <span className="k">Layer</span>
                <span className="v">{d.layer}</span>
              </div>
              <div className="dr-col">
                <span className="k">Scored</span>
                <span className="v">
                  {p ? `${p.scored}/${p.total}` : "—"}
                </span>
              </div>
              <div className="dr-col">
                <span className="k">Opened</span>
                <span className="v">{d.opened}</span>
              </div>
            </Link>
          );
        })}
      </div>
      <StatusLine
        segments={[
          { label: "RECORDS", value: String(deals.length) },
          { label: "LAYER", value: "L1 · CONVICTION" },
          { label: "MODE", value: "machine drafts · you score · app renders", tone: "accent" },
        ]}
      />
    </main>
  );
}
