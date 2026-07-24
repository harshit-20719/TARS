import Link from "next/link";
import { notFound } from "next/navigation";
import { getDeal, getRecord } from "@/mock/data";
import { Icon } from "@/components/icons";

export default async function TranscriptPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const deal = getDeal(dealId);
  const rec = getRecord(dealId);
  if (!deal || !rec) notFound();

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
        rec.calls.map((c) => (
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
            </div>
            <div className="card-note">
              Speaker labels and timestamps are used when present in the pasted text. File upload and diarization
              are deferred (spec D10).
            </div>
          </div>
        ))
      )}

      <div className="card">
        <div className="card-head">
          <h2>Add another call</h2>
        </div>
        <div className="card-body">
          <div className="field-row">
            <label htmlFor="callno">Call #</label>
            <input id="callno" className="inp narrow" defaultValue={rec.calls.length + 1} />
            <label htmlFor="calllabel" style={{ marginLeft: 8 }}>
              Label
            </label>
            <input id="calllabel" className="inp" placeholder="e.g. Technical deep-dive" style={{ flex: 1 }} />
          </div>
          <textarea className="ta" placeholder="Paste the next transcript here…" />
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <Link href={`/deals/${dealId}/review`} className="btn primary">
              <Icon name="play" /> Run extraction
            </Link>
            <span className="btn ghost">Save without extracting</span>
          </div>
        </div>
      </div>
    </div>
  );
}
