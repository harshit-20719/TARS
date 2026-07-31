"use client";

import { useState } from "react";
import { RUBRICS } from "@/framework";
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
  /** Which block the sequence is on, for the label. Null when not running. */
  const [progress, setProgress] = useState<{
    done: number;
    label: string;
    total: number;
  } | null>(null);

  /**
   * One request per macro-dimension, in sequence — still one press.
   *
   * Six concurrent requests do not fit the deployment's budget: Gemini's free
   * tier serves about one of them and leaves the rest queued until they hit the
   * forty-second block bound, which is why five of six blocks came back unread
   * with all five pinned at exactly that number. Raising the bound is not
   * available — 40s of model time plus the write phase already puts the worst
   * case at 50s against a 60-second function ceiling — so the run is spread
   * across invocations instead of across one.
   *
   * The sequence never aborts on a failure. Each request writes its own block
   * in its own transaction, so a block that fails costs that block and nothing
   * else, and stopping early would throw away five good blocks for one bad one.
   *
   * `force` is passed on every request once a call has been extracted before,
   * because the service refuses an extracted call without it — and the call
   * stays extracted throughout a re-run, since every block still holds a read
   * record from last time.
   */
  async function run(only?: readonly { key: string; label: string }[]) {
    const sequence = only ?? RUBRICS.map((r) => ({ key: r.key, label: r.label }));
    setSummary(null);
    const merged: Summary = {
      observations: 0,
      claims: 0,
      droppedQuotes: [],
      droppedClaims: 0,
      mergedSpans: 0,
      failedBlocks: [],
      succeededBlocks: [],
    };

    for (const [i, rubric] of sequence.entries()) {
      setProgress({ done: i, label: rubric.label, total: sequence.length });
      const r = await extract.run(callId, {
        force: alreadyExtracted,
        blocks: [rubric.key],
      });
      if (!r.ok) {
        // A refused request — auth, a rule, a database fault — is about the
        // whole call rather than this block, so there is nothing to gain by
        // sending the remaining five. `extract.error` renders it.
        setProgress(null);
        setSummary(merged.succeededBlocks.length || merged.failedBlocks.length ? merged : null);
        return;
      }
      merged.observations += r.data.observations;
      merged.claims += r.data.claims;
      merged.droppedQuotes.push(...r.data.droppedQuotes);
      merged.droppedClaims += r.data.droppedClaims;
      merged.mergedSpans += r.data.mergedSpans;
      merged.failedBlocks.push(...r.data.failedBlocks);
      merged.succeededBlocks.push(...r.data.succeededBlocks);
    }

    setProgress(null);
    setSummary(merged);
  }

  return (
    <>
      <button
        type="button"
        className={alreadyExtracted ? "btn sm" : "btn sm primary"}
        disabled={extract.pending}
        onClick={() => run()}
      >
        <Icon name="play" />
        {progress
          ? `Reading ${progress.done + 1} of ${progress.total}…`
          : alreadyExtracted
            ? "Re-extract (replaces drafts)"
            : "Run extraction"}
      </button>
      {/* The blocks are read one at a time now, so the wait is the sum rather
          than the slowest — minutes, not seconds. Naming the block being read
          is what makes a long wait legible instead of looking like a hang, and
          each block's evidence is saved by the time its name is replaced. */}
      {progress && (
        <span className="ctl-note">
          {progress.label} — each block is saved as it lands
        </span>
      )}
      {summary && (
        <span className="ctl-note">
          {summary.observations} observation{summary.observations === 1 ? "" : "s"},{" "}
          {summary.claims} claim{summary.claims === 1 ? "" : "s"}
        </span>
      )}
      <ControlError error={extract.error} reauth={extract.reauth} as="span" />

      {/*
        Failed blocks, split by what pressing the button again would actually do
        (KTD6). A retryable failure — a rate limit, a timeout — is genuinely
        fixed by a re-run, so the invitation stays. A terminal one — a content
        refusal — fails identically on every press, and inviting a re-run there
        sends a PM into a loop that spends a full transcript read each time and
        can never succeed.
      */}
      {summary && summary.failedBlocks.some((f) => f.kind !== "terminal") && (
        <div className="ctl-err" style={{ flexBasis: "100%" }}>
          {summary.failedBlocks.filter((f) => f.kind !== "terminal").length} of {RUBRICS.length} blocks
          failed and wrote nothing — the rest saved. Re-run to try them again.
          <ul className="drop-list">
            {summary.failedBlocks
              .filter((f) => f.kind !== "terminal")
              .map((f) => (
                <li key={f.label}>
                  <b>{f.label}</b> — {f.reason}
                </li>
              ))}
          </ul>
          {/*
            Re-read only what failed. Pressing the main button again would send
            all six, spending five transcript reads to recover one block — and
            re-reading a block that already succeeded replaces good evidence with
            another draw from the same model for no reason. The blocks that
            failed are exactly the ones with something to gain.
          */}
          <button
            type="button"
            className="btn sm"
            disabled={extract.pending}
            onClick={() =>
              run(
                summary.failedBlocks
                  .filter((f) => f.kind !== "terminal")
                  .map((f) => ({ key: f.rubricKey, label: f.label })),
              )
            }
          >
            <Icon name="play" />
            Retry{" "}
            {summary.failedBlocks.filter((f) => f.kind !== "terminal").length === 1
              ? "this block"
              : `these ${summary.failedBlocks.filter((f) => f.kind !== "terminal").length} blocks`}
          </button>
        </div>
      )}

      {summary && summary.failedBlocks.some((f) => f.kind === "terminal") && (
        <div className="ctl-err" style={{ flexBasis: "100%" }}>
          {summary.failedBlocks.filter((f) => f.kind === "terminal").length === 1
            ? "One block"
            : `${summary.failedBlocks.filter((f) => f.kind === "terminal").length} blocks`}{" "}
          cannot be read from this transcript — the model refuses it the same way on every run, so a re-run
          will not help. A different model or provider (EXTRACTION_MODEL) is the lever.
          <ul className="drop-list">
            {summary.failedBlocks
              .filter((f) => f.kind === "terminal")
              .map((f) => (
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
