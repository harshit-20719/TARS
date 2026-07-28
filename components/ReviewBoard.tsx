"use client";

import { useState } from "react";
import type { Observation } from "@/mock/types";
import { RUBRICS, subByKey } from "@/framework";
import { decideObservationAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";

/**
 * The exception queue: the mappings the machine was not sure about.
 *
 * This used to be every drafted observation, and a PM with seven or eight screening
 * calls a week was ruling on all of them by hand — mostly agreeing, because a quote
 * about a paying customer really does belong under the customer row. That is
 * clerical work, and the framework never asked for it: what it reserves for the PM
 * is the score (spec R5), not the filing.
 *
 * So confident mappings now file themselves as evidence and never appear here. What
 * lands here is the residue — quotes the model placed but flagged as uncertain. That
 * is a page a PM clears in a minute rather than an afternoon, and the count in the
 * sidebar means something again.
 *
 * Accept and Reject write straight through. "Move" exists because the commonest
 * thing wrong with a draft is not the quote but the row, and re-filing it is a
 * smaller, truer edit than rejecting a good quote. Anything accepted or moved becomes
 * evidence on its row immediately — there is no second step where the PM attaches it
 * to a score.
 *
 * The quote itself is not editable. It is a verbatim excerpt checked against the
 * transcript before it was written; letting it be typed over would quietly turn a
 * citation into a paraphrase.
 */
export function ReviewBoard({
  dealId,
  observations,
}: {
  dealId: string;
  observations: Observation[];
}) {
  const decide = useAction(decideObservationAction);
  const [remapping, setRemapping] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function set(o: Observation, status: Observation["status"], subDimensionKey?: string) {
    setBusyId(o.id);
    const rubricKey = subDimensionKey
      ? RUBRICS.find((r) => r.subs.some((s) => s.key === subDimensionKey))?.key
      : undefined;
    await decide.run(dealId, o.id, {
      status,
      ...(subDimensionKey ? { subDimensionKey, rubricKey } : {}),
    });
    setBusyId(null);
    setRemapping(null);
  }

  /**
   * Only what still needs a person. Everything filed confidently is already evidence
   * and is read on the capture row it belongs to, where the PM is scoring — showing
   * it again here would rebuild the queue this page just stopped being.
   */
  const queue = observations.filter((o) => o.status === "draft");

  const groups = RUBRICS.map((r) => ({
    r,
    items: queue.filter((o) => o.rubricKey === r.key),
  })).filter((g) => g.items.length > 0);

  if (observations.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          No observations drafted yet. Paste a transcript and run extraction — confident mappings file themselves
          as evidence, and anything the machine is unsure about waits here.
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    const filed = observations.filter((o) => o.status !== "rejected").length;
    return (
      <div className="card">
        <div className="empty">
          <b>Nothing to place.</b> All {filed} observation{filed === 1 ? "" : "s"} were mapped confidently and are
          already cited as evidence on their rows. Go straight to capture scoring — you can still reject or move any
          quote from the row it sits on.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sc-block-title" style={{ marginTop: 0 }}>
        Unsure of the row · {queue.length}
      </div>
      {decide.error && <div className="ctl-err" style={{ marginBottom: 10 }}>{decide.error}</div>}
      {groups.map((g) => (
        <div key={g.r.key}>
          <div className="rg-head">
            <span className="rg-title">{g.r.label}</span>
            <span className="rg-rule" />
            <span className="chip line mono">{g.items.length}</span>
          </div>
          {g.items.map((o) => {
            const sub = subByKey(o.subDimensionKey);
            const busy = busyId === o.id && decide.pending;
            return (
              <div key={o.id} className="obs">
                <div className="quote">{o.quote}</div>
                {/*
                  Why the machine put it here. Together with the unsure flag this makes
                  it a two-second decision: read one clause, then either agree or pick
                  the right row.
                */}
                {o.mappingNote && <div className="obs-why">filed here because · {o.mappingNote}</div>}
                <div className="obs-meta">
                  <span className="chip mono line">{sub?.label ?? o.subDimensionKey}</span>
                  <span className="chip mono line">call {o.callNumber}</span>
                  {o.speaker && <span className="chip mono line">{o.speaker}</span>}
                  <span className="chip warn">
                    <span className="dot" />
                    unsure of this row
                  </span>
                  {busy && <span className="ctl-saving">saving…</span>}
                  <span className="obs-actions">
                    <button className="btn sm ok" disabled={busy} onClick={() => set(o, "accepted")}>
                      Row is right
                    </button>
                    <button
                      className="btn sm"
                      disabled={busy}
                      onClick={() => setRemapping(remapping === o.id ? null : o.id)}
                    >
                      Move
                    </button>
                    <button className="btn sm danger" disabled={busy} onClick={() => set(o, "rejected")}>
                      Not evidence
                    </button>
                  </span>
                </div>
                {remapping === o.id && (
                  <div className="ctl-row" style={{ marginTop: 10 }}>
                    <span className="ctl-note">file under</span>
                    <select
                      className="inp"
                      defaultValue={o.subDimensionKey}
                      disabled={busy}
                      style={{ flex: 1, minWidth: 240 }}
                      onChange={(e) => set(o, "edited", e.target.value)}
                    >
                      {RUBRICS.map((r) => (
                        <optgroup key={r.key} label={r.label}>
                          {r.subs.map((s) => (
                            <option key={s.key} value={s.key}>
                              {r.key.toUpperCase()}-{s.index} · {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button className="btn sm ghost" disabled={busy} onClick={() => setRemapping(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
