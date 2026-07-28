"use client";

import { useState } from "react";
import { addCallAction, runExtractionAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Icon } from "@/components/icons";

/**
 * Paste a transcript, and optionally run extraction on it in the same step.
 *
 * The call number is required rather than defaulted. The framework tracks which
 * call each piece of evidence came from — that is how "visibly moved between two
 * calls" is ever checkable — so guessing the number silently would corrupt the
 * one thing the field exists for. It is prefilled with the next number and stays
 * editable, which is not the same as being invented.
 *
 * Extraction is offered as a second, separate press even when saving and
 * extracting together, because the two failures are different: a transcript that
 * saved but did not extract is recoverable, and the PM should be told which
 * happened.
 */
export function AddCallForm({
  dealId,
  nextNumber,
  extractionEnabled,
}: {
  dealId: string;
  nextNumber: number;
  /** False when no ANTHROPIC_API_KEY is set — the offer is hidden rather than failing. */
  extractionEnabled: boolean;
}) {
  const addCall = useAction(addCallAction);
  const extract = useAction(runExtractionAction);

  const [number, setNumber] = useState(String(nextNumber));
  const [label, setLabel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const pending = addCall.pending || extract.pending;
  const ready = label.trim() !== "" && transcript.trim() !== "" && number.trim() !== "";

  function reset() {
    setNumber(String(nextNumber + 1));
    setLabel("");
    setTranscript("");
  }

  async function save(thenExtract: boolean) {
    setNote(null);
    const saved = await addCall.run({ dealId, number, label, transcript });
    if (!saved.ok) return;
    if (!thenExtract) {
      setNote("Transcript saved. Run extraction whenever you are ready.");
      reset();
      return;
    }
    const ran = await extract.run(saved.data);
    if (ran.ok) {
      const dropped = ran.data.droppedQuotes.length;
      setNote(
        `Drafted ${ran.data.observations} observation${ran.data.observations === 1 ? "" : "s"} and ` +
          `${ran.data.claims} claim${ran.data.claims === 1 ? "" : "s"}. ` +
          "Confident mappings are already cited as evidence on their rows." +
          (dropped > 0
            ? ` ${dropped} quote${dropped === 1 ? "" : "s"} dropped for not matching the transcript — see the call above.`
            : "") +
          (ran.data.failedBlocks.length > 0
            ? ` ${ran.data.failedBlocks.length} of six blocks failed; re-run to try them again.`
            : ""),
      );
      reset();
    } else {
      setNote("Transcript saved, but extraction failed. You can run it again from the call above.");
      reset();
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{nextNumber === 1 ? "Paste the first call" : "Add another call"}</h2>
      </div>
      <div className="card-body auth-form">
        <div className="field-row" style={{ marginBottom: 0 }}>
          <label htmlFor="callno" style={{ margin: 0 }}>Call #</label>
          <input
            id="callno"
            className="inp narrow"
            value={number}
            inputMode="numeric"
            disabled={pending}
            onChange={(e) => setNumber(e.target.value)}
          />
          <label htmlFor="calllabel" style={{ marginLeft: 8, margin: 0 }}>Label</label>
          <input
            id="calllabel"
            className="inp"
            value={label}
            placeholder="e.g. First founder call"
            style={{ flex: 1, minWidth: 200 }}
            disabled={pending}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <textarea
          className="ta"
          value={transcript}
          placeholder="Paste the transcript here. Speaker labels and [00:00] timestamps are used when present."
          disabled={pending}
          onChange={(e) => setTranscript(e.target.value)}
        />
        <div className="auth-actions">
          {extractionEnabled && (
            <button type="button" className="btn primary" disabled={pending || !ready} onClick={() => save(true)}>
              <Icon name="play" /> {pending ? "Working…" : "Save & run extraction"}
            </button>
          )}
          <button
            type="button"
            className={extractionEnabled ? "btn" : "btn primary"}
            disabled={pending || !ready}
            onClick={() => save(false)}
          >
            {extractionEnabled ? "Save without extracting" : "Save transcript"}
          </button>
          {!extractionEnabled && (
            <span className="ctl-note">
              Extraction is off — no ANTHROPIC_API_KEY set. Transcripts still save.
            </span>
          )}
        </div>
        {(addCall.error || extract.error) && (
          <div className="ctl-err">{addCall.error ?? extract.error}</div>
        )}
        {note && !addCall.error && !extract.error && (
          <div className="callout neutral" style={{ marginBottom: 0 }}>
            <span className="co-badge">done</span>
            <span>{note}</span>
          </div>
        )}
      </div>
    </div>
  );
}
