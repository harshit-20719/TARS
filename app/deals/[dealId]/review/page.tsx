import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { ReviewBoard } from "@/components/ReviewBoard";

const ORIGIN_CLASS: Record<string, string> = {
  "founder-volunteered": "good",
  "founder-confirmed-after-PM-framing": "warn",
  "machine-inferred": "pending",
};

export default async function ReviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const counts = {
    drafted: rec.observations.length,
    accepted: rec.observations.filter((o) => o.status === "accepted").length,
    edited: rec.observations.filter((o) => o.status === "edited").length,
    rejected: rec.observations.filter((o) => o.status === "rejected").length,
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Step 2 · Review the machine&apos;s drafts</span>
        <h1 className="page-title">Review drafts</h1>
        <p className="page-lede">
          Accept, edit, or reject each drafted observation before it becomes evidence. The claim ledger opens at
          status <em>claimed</em> — validation is an L2 activity.
        </p>
      </div>

      <>
          <div className="summary" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
            <div className="cell">
              <span className="k">Drafted</span>
              <span className="v">{counts.drafted}</span>
            </div>
            <div className="cell">
              <span className="k">Accepted</span>
              <span className="v" style={{ color: "var(--good)" }}>
                {counts.accepted}
              </span>
            </div>
            <div className="cell">
              <span className="k">Edited</span>
              <span className="v" style={{ color: "var(--warn)" }}>
                {counts.edited}
              </span>
            </div>
            <div className="cell">
              <span className="k">Rejected</span>
              <span className="v mut">{counts.rejected}</span>
            </div>
            <div className="cell">
              <span className="k">Claims</span>
              <span className="v">{rec.claims.length}</span>
            </div>
          </div>

          <div className="grid-2">
            <ReviewBoard dealId={dealId} observations={rec.observations} />

            <div>
              <div className="sc-block-title" style={{ marginTop: 0 }}>
                Claim ledger
              </div>
              <div className="card">
                <div className="card-head">
                  <h2>Claims</h2>
                  <span className="count">status: claimed</span>
                </div>
                <div className="card-body">
                  {rec.claims.map((c) => {
                    const anchor = rec.observations.find((o) => o.id === c.anchorObsId);
                    return (
                      <div className="claim" key={c.id}>
                        <div className="c-body">
                          <div className="c-text">{c.text}</div>
                          <div className="c-meta">
                            <span className={`chip ${ORIGIN_CLASS[c.originTag]} origin`}>{c.originTag}</span>
                            <span className="chip line">claimed</span>
                            {anchor && (
                              <span className="chip line" title={anchor.quote}>
                                ↳ {c.anchorObsId}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="card-note">
                  Origin tags: <b style={{ color: "var(--good)" }}>founder-volunteered</b>,{" "}
                  <b style={{ color: "var(--warn)" }}>founder-confirmed-after-PM-framing</b>,{" "}
                  <b style={{ color: "var(--pending)" }}>machine-inferred</b>. Claim <em>validated / refuted</em> and
                  the verification artefact come at L2.
                </div>
              </div>
            </div>
          </div>
      </>
    </div>
  );
}
