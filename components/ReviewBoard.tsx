"use client";

import { useState } from "react";
import type { Observation } from "@/mock/types";
import { RUBRICS, subByKey } from "@/framework";

/**
 * The PM curates the machine's drafts before they become evidence (R3).
 * Accept / edit / reject is local state here — it maps to a repository
 * mutation when the backend lands (plan U6).
 */
export function ReviewBoard({ observations }: { observations: Observation[] }) {
  const [obs, setObs] = useState<Observation[]>(observations);
  const set = (id: string, status: Observation["status"]) =>
    setObs((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));

  const groups = RUBRICS.map((r) => ({
    r,
    items: obs.filter((o) => o.rubricKey === r.key),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="sc-block-title" style={{ marginTop: 0 }}>
        Observations · by rubric
      </div>
      {groups.map((g) => (
        <div key={g.r.key}>
          <div className="rg-head">
            <span className="rg-title">{g.r.label}</span>
            <span className="rg-rule" />
            <span className="chip line mono">{g.items.length}</span>
          </div>
          {g.items.map((o) => {
            const sub = subByKey(o.subDimensionKey);
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
                      edited
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
                  <span className="obs-actions">
                    <button className="btn sm ok" onClick={() => set(o.id, "accepted")}>
                      Accept
                    </button>
                    <button className="btn sm" onClick={() => set(o.id, "edited")}>
                      Edit
                    </button>
                    <button className="btn sm danger" onClick={() => set(o.id, "rejected")}>
                      Reject
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
