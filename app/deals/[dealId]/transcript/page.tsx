import { notFound } from "next/navigation";
import { getCalls, getDeal, getRecord } from "@/lib/data";
import { AddCallForm } from "@/components/authoring/AddCallForm";
import { ImportFromFireflies } from "@/components/authoring/ImportFromFireflies";
import { RunExtractionButton } from "@/components/authoring/RunExtractionButton";
import { DeleteCall } from "@/components/authoring/DeleteCall";

/**
 * Extraction runs inside a server action invoked from this page, so this page's
 * limit is the one that applies to it. Vercel's default is a few seconds — fine
 * for every other action in the app, and far too short for this one: a
 * forty-minute transcript takes the model tens of seconds to read. Past the
 * limit the function is killed rather than returning, so no error object ever
 * reaches the error handling, and the browser gets the generic
 * "an error occurred in the Server Components render" instead.
 *
 * 60 is the ceiling on Vercel's free tier. If a transcript still outruns it, the
 * lever that costs nothing is EXTRACTION_EFFORT (see lib/extraction/extract.ts).
 */
export const maxDuration = 60;

export default async function TranscriptPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  // The transcripts are fetched here and only here — the record deliberately
  // leaves them out so every other page and every save stays small.
  const [deal, rec, calls] = await Promise.all([getDeal(dealId), getRecord(dealId), getCalls(dealId)]);
  if (!deal || !rec) notFound();

  // Read on the server: the key must never reach the browser, and the form only
  // needs to know whether the offer is available.
  const extractionEnabled = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  /**
   * The same treatment for the Fireflies credential, and here it carries more
   * weight (KTD10): this key opens every call Biome has ever recorded, and a
   * `NEXT_PUBLIC_`-shaped mistake would put it in the browser bundle of a page
   * every PM loads. A boolean is the whole of what the picker needs.
   */
  const firefliesEnabled = Boolean(process.env.FIREFLIES_API_KEY?.trim());
  const nextNumber = rec.calls.reduce((max, c) => Math.max(max, c.number), 0) + 1;

  return (
    <div className="page">
      <div className="page-head">
        <span className="eyebrow">Step 1 · Capture</span>
        <h1 className="page-title">Transcript &amp; calls</h1>
        <p className="page-lede">
          Paste a call transcript tagged to a call number, or import one from Fireflies. On ingest the machine
          drafts observations and claim entries — it never scores.
        </p>
      </div>

      {calls.length === 0 ? (
        <div className="card">
          <div className="empty">No transcript yet. Paste the first founder call below to open the record.</div>
        </div>
      ) : (
        calls.map((c) => {
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
                {/*
                  Who reached into the shared Fireflies account for this call, on
                  the call itself (R24). Rendered from the stored address rather
                  than from a user relation, so it still reads correctly after
                  that account is deleted — which is the case the attribution
                  exists for.
                */}
                {c.sourceMeetingId && (
                  <div>
                    Imported from Fireflies
                    {c.importedByEmail ? ` by ${c.importedByEmail}` : ""} · meeting{" "}
                    <code>{c.sourceMeetingId}</code>
                  </div>
                )}
                Speaker labels and timestamps are used when present in the pasted text. File upload and diarization
                are deferred (spec D10).
              </div>
            </div>
          );
        })
      )}

      {/*
        Importing first and pasting second, because importing is the path with a
        disclosure attached to it and the one a PM will reach for by default.
        Pasting stays exactly where it was and exactly as it was (R12) — the two
        are alternatives, not a migration.
      */}
      <ImportFromFireflies dealId={dealId} nextNumber={nextNumber} firefliesEnabled={firefliesEnabled} />
      <AddCallForm dealId={dealId} nextNumber={nextNumber} extractionEnabled={extractionEnabled} />
    </div>
  );
}
