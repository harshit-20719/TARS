import Link from "next/link";
import { notFound } from "next/navigation";
import { getDeal, getRecord, listReassignCandidates } from "@/lib/data";
import { progressOf, stepsFor } from "@/lib/steps";
import { computeRollup } from "@/lib/rollup";
import { scoreMap } from "@/lib/judgment";
import { SlideProfile } from "@/components/SlideProfile";
import { CaptureGrid } from "@/components/CaptureGrid";
import { DealHeaderForm } from "@/components/authoring/DealHeaderForm";
import { DeleteDeal } from "@/components/authoring/DeleteDeal";
import { ReassignDeal } from "@/components/authoring/ReassignDeal";

export default async function OverviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  /**
   * The candidate list is fetched for everyone, because the page cannot tell who
   * may hand the deal over — `ownerId` is not on the `Deal` record contract, and
   * `assertMayReassignDeal` is the boundary. It is three columns' worth of names,
   * and it is fetched alongside the record rather than after it.
   */
  const [deal, rec, candidates] = await Promise.all([
    getDeal(dealId),
    getRecord(dealId),
    listReassignCandidates(),
  ]);
  if (!deal || !rec) notFound();

  const p = progressOf(rec);
  const roll = computeRollup(rec);
  const steps = stepsFor(dealId, rec).slice(1);

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">{deal.founders}</span>
        <h1 className="page-title">{deal.company}</h1>
        <p className="page-lede">{deal.oneLiner}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <DealHeaderForm deal={deal} />
          {/* The owner is named in the sidebar, not here — one display, so there
              is nothing for a second one to contradict. */}
          <ReassignDeal dealId={deal.id} company={deal.company} candidates={candidates} />
          <DeleteDeal record={rec} />
        </div>
      </div>

      <div className="summary">
        <div className="cell">
          <span className="k">Layer</span>
          <span className="v sm">L1 · Conviction</span>
          <span className="sub">opened {deal.opened}</span>
        </div>
        <div className="cell">
          <span className="k">Calls captured</span>
          <span className="v">{p.calls}</span>
          <span className="sub">{p.hasTranscript ? "transcript in" : "none yet"}</span>
        </div>
        <div className="cell">
          <span className="k">Sub-dimensions scored</span>
          <span className="v">
            {p.scored}
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>/{p.total}</span>
          </span>
          <span className="sub">{p.incomplete > 0 ? `${p.incomplete} incomplete` : "PM-authored"}</span>
        </div>
        <div className="cell">
          <span className="k">Slides set</span>
          <span className="v">
            {p.slides}
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>/{p.totalSlides}</span>
          </span>
          <span className="sub">7 pillars · 3 tracks</span>
        </div>
        <div className="cell">
          <span className="k">Floor</span>
          <span className="v sm" style={{ color: roll.floorStatus === "fail" ? "var(--bad)" : "var(--good)" }}>
            {roll.floorStatus === "fail" ? "Failed" : "Clear"}
          </span>
          <span className="sub">
            {roll.flags.length + roll.mandatoryClears.length} flag
            {roll.flags.length + roll.mandatoryClears.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {(rec.scores.length > 0 || rec.slides.length > 0) && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          <div className="card">
            <div className="card-head">
              <h2>Judgment · 0–10</h2>
              <div className="spacer" />
              <span className="count">
                {p.slides}/{p.totalSlides} set
              </span>
            </div>
            <div className="card-body">
              {rec.slides.length > 0 ? (
                <SlideProfile slides={rec.slides} />
              ) : (
                <div className="empty">No slides authored yet.</div>
              )}
            </div>
          </div>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-head">
              <h2>Capture · 1–5 &amp; hygiene</h2>
              <div className="spacer" />
              <span className="count">
                {p.scored}/{p.total} scored
              </span>
            </div>
            <div className="card-body" style={{ paddingTop: 14 }}>
              <CaptureGrid scores={scoreMap(rec)} />
            </div>
          </div>
        </div>
      )}

      <div className="callout">
        <span className="co-badge">authorship</span>
        <span>
          The machine drafts observations and claims and maps them to sub-dimensions. It never sets a score. You
          author every 1–5 / pass–fail value and every 0–10 slide. The scorecard is rendered from that record — no
          total, no gate verdict.
        </span>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Continue the flow</h2>
        </div>
        <div className="card-body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 12,
              paddingTop: 6,
            }}
          >
            {steps.map((s) => (
              <Link key={s.seg} href={s.href} className="deal-row" style={{ gridTemplateColumns: "1fr auto", margin: 0 }}>
                <div>
                  <div className="dr-name" style={{ fontSize: 14 }}>
                    {s.name}
                  </div>
                  <div className="dr-desc">{s.state || "—"}</div>
                </div>
                <span className={`chip ${s.done ? "good" : "pending"}`}>
                  <span className="dot" />
                  {s.done ? "done" : "open"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
