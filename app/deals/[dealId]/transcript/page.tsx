import { notFound } from "next/navigation";
import { getDeal, getRecord } from "@/lib/data";
import { AddCallForm } from "@/components/authoring/AddCallForm";
import { RunExtractionButton } from "@/components/authoring/RunExtractionButton";
import { DeleteCall } from "@/components/authoring/DeleteCall";

export default async function TranscriptPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const [deal, rec] = await Promise.all([getDeal(dealId), getRecord(dealId)]);
  if (!deal || !rec) notFound();

  // Read on the server: the key must never reach the browser, and the form only
  // needs to know whether the offer is available.
  const extractionEnabled = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const nextNumber = rec.calls.reduce((max, c) => Math.max(max, c.number), 0) + 1;

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Step 1 · Capture</span>
        <h1 className="page-title">Transcript &amp; calls</h1>
        <p className="page-lede">
          Paste a call transcript tagged to a call number. On ingest the machine drafts observations and claim
          entries — it never scores.
        </p>
      </div>

      {rec.calls.length === 0 ? (
        <div className="card">
          <div className="empty">No transcript yet. Paste the first founder call below to open the record.</div>
        </div>
      ) : (
        rec.calls.map((c) => {
          const drafted = rec.observations.filter((o) => o.callNumber === c.number).length;
          return (
            <div className="card" key={c.id}>
              <div className="card-head">
                <h2>
                  Call #{c.number} — {c.label}
                </h2>
                {c.extracted && (
                  <span className="chip good">
                    <span className="dot" />
                    extracted
                  </span>
                )}
                <div className="spacer" />
                <span className="chip line mono">{c.date}</span>
              </div>
              <div className="card-body">
                <textarea className="ta" readOnly defaultValue={c.transcript} />
                <div className="ctl-row" style={{ marginTop: 12 }}>
                  {/*
                    Say which state this is in rather than hiding the control. An
                    absent button is indistinguishable from a broken page: the
                    reader cannot tell whether extraction is switched off or
                    whether the feature failed to render, and both look like
                    nothing happened.
                  */}
                  {extractionEnabled ? (
                    <RunExtractionButton callId={c.id} alreadyExtracted={c.extracted} />
                  ) : (
                    <span className="chip pending">
                      <span className="dot" />
                      extraction off · no ANTHROPIC_API_KEY on this deployment
                    </span>
                  )}
                  <span className="ctl-note">
                    {drafted} observation{drafted === 1 ? "" : "s"} filed from this call
                  </span>
                  <div className="spacer" style={{ flex: 1 }} />
                  <DeleteCall dealId={dealId} callId={c.id} callNumber={c.number} draftedCount={drafted} />
                </div>
              </div>
              <div className="card-note">
                Speaker labels and timestamps are used when present in the pasted text. File upload and diarization
                are deferred (spec D10).
              </div>
            </div>
          );
        })
      )}

      <AddCallForm dealId={dealId} nextNumber={nextNumber} extractionEnabled={extractionEnabled} />
    </div>
  );
}
