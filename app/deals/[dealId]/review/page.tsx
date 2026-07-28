import Link from "next/link";
import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { ReviewBoard } from "@/components/ReviewBoard";

export default async function ReviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const counts = {
    drafted: rec.observations.length,
    needsPlacing: rec.observations.filter((o) => o.status === "draft").length,
    filed: rec.observations.filter((o) => o.status === "accepted").length,
    moved: rec.observations.filter((o) => o.status === "edited").length,
    rejected: rec.observations.filter((o) => o.status === "rejected").length,
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Step 2 · Only what the machine could not place</span>
        <h1 className="page-title">Review exceptions</h1>
        <p className="page-lede">
          Confidently mapped observations are already cited as evidence on their rows — you do not need to approve
          them. What waits here is the quotes the machine placed but was unsure about. You can still reject or move
          any quote from the capture row it sits on.
        </p>
      </div>

      <>
          <div className="summary" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
            <div className="cell">
              <span className="k">Extracted</span>
              <span className="v">{counts.drafted}</span>
            </div>
            <div className="cell">
              <span className="k">To place</span>
              <span className="v" style={{ color: counts.needsPlacing ? "var(--warn)" : "var(--good)" }}>
                {counts.needsPlacing}
              </span>
            </div>
            <div className="cell">
              <span className="k">Filed as evidence</span>
              <span className="v" style={{ color: "var(--good)" }}>
                {counts.filed}
              </span>
            </div>
            <div className="cell">
              <span className="k">Moved by you</span>
              <span className="v">{counts.moved}</span>
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

          {/*
            The claim ledger used to sit here as a second column, showing each
            claim's anchor as a raw database id. It now has its own page, which
            shows the quote instead — so this page is the exception queue and
            nothing else, and there is only one ledger to trust.
          */}
          <ReviewBoard dealId={dealId} observations={rec.observations} />

          {rec.claims.length > 0 && (
            <div className="card-note" style={{ marginTop: 14 }}>
              {rec.claims.length} claim{rec.claims.length === 1 ? "" : "s"} were drafted alongside these
              observations. They live in the{" "}
              <Link href={`/deals/${dealId}/claims`}>claim ledger</Link>, with the quote each one rests on.
            </div>
          )}
      </>
    </div>
  );
}
