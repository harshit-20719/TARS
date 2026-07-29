"use client";

import { useState } from "react";
import { runExtractionAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Icon } from "@/components/icons";
import { ControlError } from "../ControlError";

/**
 * Run (or re-run) extraction on one saved call.
 *
 * Re-running needs `force`, and says so before it is pressed: the service replaces
 * the machine's drafts for that call, and a PM who has already accepted or
 * rejected drafts would lose those decisions. Naming that in the label is cheaper
 * than a confirmation dialog and harder to click through by accident.
 */
export function RunExtractionButton({
  callId,
  alreadyExtracted,
}: {
  callId: string;
  alreadyExtracted: boolean;
}) {
  const extract = useAction(runExtractionAction);
  type Summary = Extract<Awaited<ReturnType<typeof runExtractionAction>>, { ok: true }>["data"];
  const [summary, setSummary] = useState<Summary | null>(null);

  async function run() {
    setSummary(null);
    const r = await extract.run(callId, { force: alreadyExtracted });
    if (r.ok) setSummary(r.data);
  }

  return (
    <>
      <button
        type="button"
        className={alreadyExtracted ? "btn sm" : "btn sm primary"}
        disabled={extract.pending}
        onClick={run}
      >
        <Icon name="play" />
        {extract.pending
          ? "Reading all six blocks…"
          : alreadyExtracted
            ? "Re-extract (replaces drafts)"
            : "Run extraction"}
      </button>
      {/* Six calls run at once and each reads the whole transcript, so this is a
          twenty-to-forty second wait. Saying so stops it looking like a hang. */}
      {extract.pending && <span className="ctl-note">20–40 seconds</span>}
      {summary && (
        <span className="ctl-note">
          {summary.observations} observation{summary.observations === 1 ? "" : "s"},{" "}
          {summary.claims} claim{summary.claims === 1 ? "" : "s"}
        </span>
      )}
      <ControlError error={extract.error} reauth={extract.reauth} as="span" />

      {summary && summary.failedBlocks.length > 0 && (
        <div className="ctl-err" style={{ flexBasis: "100%" }}>
          {summary.failedBlocks.length} of six blocks failed and wrote nothing — the rest saved. Re-run to try
          them again.
          <ul className="drop-list">
            {summary.failedBlocks.map((f) => (
              <li key={f.label}>
                <b>{f.label}</b> — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        The quotes that failed the verbatim check, shown rather than counted. If the
        model is paraphrasing, this is the only place that becomes visible — and
        without it a thin extraction is indistinguishable from a quiet transcript.
      */}
      {summary && summary.droppedQuotes.length > 0 && (
        <details className="drop-note" style={{ flexBasis: "100%" }}>
          <summary>
            {summary.droppedQuotes.length} quote{summary.droppedQuotes.length === 1 ? "" : "s"} dropped — not
            found word-for-word in the transcript
          </summary>
          <ul className="drop-list">
            {summary.droppedQuotes.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <p>
            These were discarded rather than filed. A quote that is not literally in the transcript would be a
            fabricated citation once someone scores a founder against it.
          </p>
        </details>
      )}
    </>
  );
}
