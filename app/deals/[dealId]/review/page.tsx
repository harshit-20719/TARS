import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { ExtractionQualityBoard } from "@/components/ExtractionQualityBoard";

/**
 * Extraction quality — a reading of the record, not a step (R14).
 *
 * This page was the exception queue: step 2, where drafts waited for a person.
 * Nothing waits any more — every observation files itself as evidence and the
 * rulings live on the capture rows — so what the page answers now is the
 * question the queue always hid: how well did the machine read each call? It
 * renders from the per-block run record (KTD16), which is why a partial run is
 * still legible here after a refresh (R24). The URL segment stays /review so
 * every stored link keeps landing.
 */
export default async function ReviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">View · What the last extraction did</span>
        <h1 className="page-title">Extraction quality</h1>
        <p className="page-lede">
          How the machine read each call, block by block: what it read, what failed and why, and what it
          returned that was thrown out before filing. Everything that survived is already cited on its
          capture row — confirming, moving, or rejecting a filing happens there, on the quote itself. This
          page reports; it changes nothing.
        </p>
      </div>

      <ExtractionQualityBoard dealId={dealId} calls={rec.calls} observations={rec.observations} />
    </div>
  );
}
