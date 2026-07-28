"use client";

import { useOptimistic, useState } from "react";
import type { Observation, ScaleValue, ScoreValue, SubDimensionScore } from "@/mock/types";
import type { SubDimension } from "@/framework";
import { clearScoreAction, setScoreAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { EvidenceList } from "./EvidenceList";

/**
 * Author one sub-dimension score (spec R5 — the PM authors every score).
 *
 * The options offered are the row's own value set, taken from the frozen rubric
 * config: 1–5 plus NE on a scale row, Fail/Unverified/Pass on a binary one. There
 * is no free-text box, so the two scales cannot be confused at the point of entry
 * the way they can in a spreadsheet — and the server checks the same rule again.
 *
 * Every interaction saves. A PM works through a grid of forty-one rows in one
 * sitting, so a per-row Save button would be forty-one extra clicks and a
 * half-entered grid on any navigation. Pressing the value that is already set
 * clears the score, which is how a mis-click is undone.
 *
 * **The press is optimistic.** The pill moves the instant it is clicked and only
 * reverts if the server refuses. Saving a score revalidates the deal, and even a
 * fast round trip is a visible stall when it sits between the click and the
 * feedback — forty-one times over, that reads as a broken app rather than a slow
 * one. The truth still comes from the server; this only changes whether the PM is
 * made to wait for it.
 *
 * Evidence is not picked here any more. Observations filed under this row are cited
 * automatically; this component shows them so the score is authored beside the
 * quotes it rests on, and offers the two corrections that matter — reject a quote,
 * or re-file it under the row where it belongs.
 */
export function ScoreControl({
  dealId,
  sub,
  score,
  candidates,
}: {
  dealId: string;
  sub: SubDimension;
  score?: SubDimensionScore;
  /** Observations filed under this row — cited as this score's evidence. */
  candidates: Observation[];
}) {
  const setScore = useAction(setScoreAction);
  const clearScore = useAction(clearScoreAction);

  /**
   * The value the buttons render, which leads the server by one press.
   *
   * `useOptimistic` rather than plain state because it resets to the prop when the
   * transition settles: a refusal or a concurrent edit snaps back to the truth
   * without this component having to work out which happened.
   */
  const [shown, showValue] = useOptimistic<ScoreValue | undefined, ScoreValue | undefined>(
    score?.value,
    (_, next) => next,
  );

  const [flag, setFlag] = useState<boolean>(score?.flag ?? false);
  const [flagNote, setFlagNote] = useState(score?.flagNote ?? "");
  const [editingNote, setEditingNote] = useState(false);

  const error = setScore.error ?? clearScore.error;
  /** A save is in flight on this row. Overlapping saves can resolve out of order. */
  const busy = setScore.pending || clearScore.pending;

  const options: { value: ScoreValue; label: string; cls?: string }[] =
    sub.type === "binary"
      ? [
          { value: "fail", label: "FAIL", cls: "b-fail" },
          { value: "unv", label: "UNV", cls: "b-unv" },
          { value: "pass", label: "PASS", cls: "b-pass" },
        ]
      : ([1, 2, 3, 4, 5, "NE"] as ScaleValue[]).map((v) => ({
          value: v,
          label: String(v),
        }));

  /**
   * The condition as the server will accept it.
   *
   * A ticked box with nothing written in it is not a condition the service will
   * store, so pressing a score must not try to send one. Without this, any row
   * flagged before the note existed — or flagged a moment ago and not yet written
   * up — refuses every subsequent score press with "say what the condition is",
   * an error about the checkbox raised against a click on the number.
   */
  const effectiveFlag = flag && flagNote.trim().length > 0;

  async function pick(value: ScoreValue) {
    // Ignore presses while a save is in flight. Two overlapping saves on one row
    // can land out of order, and the later response wins — so the PM's last press
    // is the one that gets lost. The optimistic value already gives the
    // immediate feedback that made disabling the button feel wrong.
    if (busy) return;

    // The optimistic update is handed to runWith so it lands inside the transition.
    // Outside it, React cannot tie the value to anything that completes, and a
    // refused save would leave the wrong number on screen looking saved.
    if (value === shown) {
      /**
       * Clearing the score clears its condition too, because that is what the
       * server does — clearScore deletes the whole row, flagNote included. Leaving
       * the pair in local state made the condition reappear on the next press,
       * silently re-attached to a score the PM had just cleared.
       */
      setFlag(false);
      setFlagNote("");
      setEditingNote(false);
      await clearScore.runWith(() => showValue(undefined), dealId, sub.key);
      return;
    }
    // evidenceObsIds is deliberately omitted: the service cites every
    // non-rejected observation on the row, which is what the PM would have ticked.
    await setScore.runWith(() => showValue(value), {
      dealId,
      subDimensionKey: sub.key,
      value,
      flag: effectiveFlag,
      ...(effectiveFlag ? { flagNote } : {}),
    });
  }

  /** Save the condition alongside the existing value. A no-op before a score exists. */
  async function saveCondition(nextFlag: boolean, nextNote: string) {
    setFlagNote(nextNote);
    if (nextFlag && !nextNote.trim()) {
      /**
       * Wait for the line rather than sending a save the server will refuse — and
       * crucially, do not record the flag as set yet. Setting it here left the row
       * holding a flag with no note, which then rode along on every later score
       * press and got each one refused.
       */
      setEditingNote(true);
      return;
    }
    setFlag(nextFlag);
    if (shown === undefined) return;
    setEditingNote(false);
    await setScore.run({
      dealId,
      subDimensionKey: sub.key,
      value: shown,
      flag: nextFlag,
      ...(nextFlag ? { flagNote: nextNote } : {}),
    });
  }

  const tripped = shown !== undefined && sub.floor && shown === sub.floor.breachAt;

  return (
    <div>
      <div className="ctl-row">
        <div className="seg" role="group" aria-label={`${sub.label} score`}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              className={o.cls}
              aria-pressed={o.value === shown}
              // Not `disabled` — the optimistic value has already moved, so greying
              // the strip out would flicker on every press. `pick` ignores the click.
              aria-busy={busy || undefined}
              title={o.value === shown ? "Press again to clear" : undefined}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {busy && <span className="ctl-saving">saving…</span>}
        {tripped && (
          <span className={`chip xs ${sub.floor!.weight === "kill" ? "bad" : "warn"}`}>
            <span className="dot" />
            {sub.floor!.weight === "kill" ? "floor tripped" : "mandatory condition"}
          </span>
        )}
      </div>

      {shown !== undefined && (
        <div className="ctl-row">
          <label className="ctl-note" style={{ display: "inline-flex", gap: 5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={flag}
              onChange={(e) => saveCondition(e.target.checked, flagNote)}
            />
            advance with condition
          </label>
          {flag && !editingNote && (
            <button type="button" className="btn xs ghost" onClick={() => setEditingNote(true)}>
              {flagNote ? "edit" : "say what it is"}
            </button>
          )}
        </div>
      )}

      {/*
        Only while actually editing, which is always something the PM started.
        Rendering this for any flagged-but-unwritten row would put an autofocused
        input on the page at load — and with forty-one rows, whichever one won the
        race would steal focus and scroll the grid to itself. Scores flagged before
        the note existed are exactly that case, so they get a prompt instead.
      */}
      {flag && editingNote && (
        <div className="ctl-row">
          <input
            className="inp sm"
            style={{ flex: 1, minWidth: 200 }}
            value={flagNote}
            autoFocus
            placeholder="What has to be true before this clears?"
            onChange={(e) => setFlagNote(e.target.value.replace(/[\r\n]+/g, " "))}
            onBlur={() => flagNote.trim() && saveCondition(true, flagNote)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && flagNote.trim()) saveCondition(true, flagNote);
            }}
          />
        </div>
      )}
      {flag && !editingNote && (
        <div className="cond-note">
          {flagNote ? `condition · ${flagNote}` : "condition attached but not written down"}
        </div>
      )}

      <EvidenceList dealId={dealId} observations={candidates} />

      {error && <div className="ctl-err" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
