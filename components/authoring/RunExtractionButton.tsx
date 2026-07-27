"use client";

import { useState } from "react";
import { runExtractionAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Icon } from "@/components/icons";

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
  const [summary, setSummary] = useState<string | null>(null);

  async function run() {
    setSummary(null);
    const r = await extract.run(callId, { force: alreadyExtracted });
    if (r.ok) {
      setSummary(
        `${r.data.observations} observation${r.data.observations === 1 ? "" : "s"}, ` +
          `${r.data.claims} claim${r.data.claims === 1 ? "" : "s"}` +
          (r.data.dropped > 0 ? `, ${r.data.dropped} dropped as not verbatim` : ""),
      );
    }
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
          ? "Extracting…"
          : alreadyExtracted
            ? "Re-extract (replaces drafts)"
            : "Run extraction"}
      </button>
      {summary && <span className="ctl-note">{summary}</span>}
      {extract.error && <span className="ctl-err">{extract.error}</span>}
    </>
  );
}
