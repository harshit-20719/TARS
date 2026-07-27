"use client";

import { useState } from "react";
import type { Observation } from "@/mock/types";
import { RUBRICS, subByKey } from "@/framework";
import { decideObservationAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";

/**
 * The PM curates the machine's drafts before they become evidence (R3).
 *
 * Accept / reject write straight through. "Re-map" exists because the commonest
 * thing wrong with a draft is not the quote but the row it was filed under, and
 * re-filing it is a smaller, truer edit than rejecting a good quote. The re-map
 * list is the whole rubric tree, so the corrected key is always a real one — and
 * the service records who decided and when either way.
 *
 * The quote itself is not editable here. It is a verbatim excerpt checked against
 * the transcript before it was written; letting it be typed over would quietly
 * turn a citation into a paraphrase.
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

  const groups = RUBRICS.map((r) => ({
    r,
    items: observations.filter((o) => o.rubricKey === r.key),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          No observations drafted yet. Paste a transcript and run extraction, and the drafts land here for you to
          accept, re-map, or reject.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sc-block-title" style={{ marginTop: 0 }}>
        Observations · by rubric
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
              <div key={o.id} className={`obs ${o.status === "rejected" ? "rejected" : ""}`}>
                <div className="quote">{o.quote}</div>
                <div className="obs-meta">
                  <span className="chip mono line">{sub?.label ?? o.subDimensionKey}</span>
                  <span className="chip mono line">call {o.callNumber}</span>
                  {o.speaker && <span className="chip mono line">{o.speaker}</span>}
                  {o.status === "accepted" && (
                    <span className="chip good">
                      <span className="dot" />
                      accepted
                    </span>
                  )}
                  {o.status === "edited" && (
                    <span className="chip warn">
                      <span className="dot" />
                      re-mapped
                    </span>
                  )}
                  {o.status === "draft" && (
                    <span className="chip pending">
                      <span className="dot" />
                      draft
                    </span>
                  )}
                  {o.status === "rejected" && (
                    <span className="chip">
                      <span className="dot" />
                      rejected
                    </span>
                  )}
                  {busy && <span className="ctl-saving">saving…</span>}
                  <span className="obs-actions">
                    <button
                      className="btn sm ok"
                      disabled={busy || o.status === "accepted"}
                      onClick={() => set(o, "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      className="btn sm"
                      disabled={busy}
                      onClick={() => setRemapping(remapping === o.id ? null : o.id)}
                    >
                      Re-map
                    </button>
                    <button
                      className="btn sm danger"
                      disabled={busy || o.status === "rejected"}
                      onClick={() => set(o, "rejected")}
                    >
                      Reject
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
