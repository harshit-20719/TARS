"use client";

import { useState } from "react";
import type { Observation, ScaleValue, ScoreValue, SubDimensionScore } from "@/mock/types";
import type { SubDimension } from "@/framework";
import { clearScoreAction, setScoreAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";

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
  /** Observations filed under this row — the only sensible evidence for it. */
  candidates: Observation[];
}) {
  const setScore = useAction(setScoreAction);
  const clearScore = useAction(clearScoreAction);

  // Evidence and the flag are held here so they can be chosen before a value
  // exists; they are sent with whichever save happens next.
  const [evidence, setEvidence] = useState<string[]>(score?.evidenceObsIds ?? []);
  const [flag, setFlag] = useState<boolean>(score?.flag ?? false);

  const pending = setScore.pending || clearScore.pending;
  const error = setScore.error ?? clearScore.error;
  const current = score?.value;

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

  async function pick(value: ScoreValue) {
    if (value === current) {
      await clearScore.run(dealId, sub.key);
      return;
    }
    await setScore.run({ dealId, subDimensionKey: sub.key, value, evidenceObsIds: evidence, flag });
  }

  /** Save immediately when a score already exists; otherwise hold until one does. */
  async function amend(next: { evidence?: string[]; flag?: boolean }) {
    const ev = next.evidence ?? evidence;
    const fl = next.flag ?? flag;
    if (next.evidence) setEvidence(next.evidence);
    if (next.flag !== undefined) setFlag(next.flag);
    if (current === undefined) return;
    await setScore.run({
      dealId,
      subDimensionKey: sub.key,
      value: current,
      evidenceObsIds: ev,
      flag: fl,
    });
  }

  const tripped = score && sub.floor && score.value === sub.floor.breachAt;

  return (
    <div>
      <div className="ctl-row">
        <div className="seg" role="group" aria-label={`${sub.label} score`}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              className={o.cls}
              aria-pressed={o.value === current}
              disabled={pending}
              title={o.value === current ? "Press again to clear" : undefined}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {pending && <span className="ctl-saving">saving…</span>}
        {tripped && (
          <span className={`chip xs ${sub.floor!.weight === "kill" ? "bad" : "warn"}`}>
            <span className="dot" />
            {sub.floor!.weight === "kill" ? "floor tripped" : "flagged condition"}
          </span>
        )}
      </div>

      <div className="ctl-row">
        <label className="ctl-note" style={{ display: "inline-flex", gap: 5, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={flag}
            disabled={pending}
            onChange={(e) => amend({ flag: e.target.checked })}
          />
          flag condition
        </label>
        {score && score.evidenceObsIds.length === 0 && (
          <span className="chip warn xs">
            <span className="dot" />
            incomplete
          </span>
        )}
      </div>

      {candidates.length > 0 ? (
        <details className="ev-pick" open={evidence.length === 0 && current !== undefined}>
          <summary>
            evidence · {evidence.length}/{candidates.length}
          </summary>
          {candidates.map((o) => (
            <label className="ev-opt" key={o.id}>
              <input
                type="checkbox"
                checked={evidence.includes(o.id)}
                disabled={pending}
                onChange={(e) =>
                  amend({
                    evidence: e.target.checked
                      ? [...evidence, o.id]
                      : evidence.filter((id) => id !== o.id),
                  })
                }
              />
              <span>
                {o.quote.length > 110 ? `${o.quote.slice(0, 110)}…` : o.quote}{" "}
                <span className="st">
                  call {o.callNumber}
                  {o.speaker ? ` · ${o.speaker}` : ""} · {o.status}
                </span>
              </span>
            </label>
          ))}
        </details>
      ) : (
        <div className="ctl-note">no observations filed here yet</div>
      )}

      {error && <div className="ctl-err" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
