import { notFound } from "next/navigation";
import { getRecord } from "@/lib/data";
import { coverageOf } from "@/lib/coverage";
import { CoverageGrid } from "@/components/CoverageGrid";

/**
 * Coverage — what the calls so far have produced evidence for, and what they
 * have not (R17, R18).
 *
 * The page a PM opens between calls. L1 allows several, and after the first the
 * useful question stops being "what did the machine find" and becomes "what have
 * we still not touched". The record has always held the answer — every
 * observation carries the row it was filed under and the call it came from — but
 * reading it back meant scrolling the capture grid and remembering. Which is how
 * a PM gets to the IC note and finds a question was never asked.
 *
 * The distinction the page exists to make is between a row nobody has evidence
 * on and a row whose evidence was thrown out. On the capture grid both are blank.
 * On the next call they are completely different conversations: one is ground to
 * cover, the other is ground already walked that yielded nothing usable.
 *
 * It reports and does not gate (R20). No percentage, no threshold, no readiness
 * flag — spec §3 leaves those deferred, and the framework's rule is that the app
 * renders facts and returns no verdict. There is nothing to press here.
 */
export default async function CoveragePage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const rec = await getRecord(dealId);
  if (!rec) notFound();

  const reading = coverageOf(rec);
  const calls = reading.callNumbers.length;

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">View · Derived from the record</span>
        <h1 className="page-title">Coverage</h1>
        <p className="page-lede">
          Which sub-dimensions the calls so far have produced evidence for. Read it before the next
          call to see what is still untouched — and to tell a row nobody has asked about from one
          whose evidence you already refused. This reports; it does not gate anything.
        </p>
      </div>

      <div className="callout neutral">
        <span>
          {calls === 0 ? (
            <>
              No calls on this deal yet, so every row reads as no evidence. Add a call and run
              extraction, and this fills in.
            </>
          ) : (
            <>
              <b>{reading.unevidenced}</b> of {reading.rows.length} rows hold no evidence yet,
              across {calls} {calls === 1 ? "call" : "calls"}. Coverage reads evidence rather than
              questions: a row can be discussed at length and still record nothing, if nothing said
              was mappable to it.
            </>
          )}
        </span>
      </div>

      <CoverageGrid reading={reading} />
    </div>
  );
}
