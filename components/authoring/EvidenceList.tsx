"use client";

import { useState } from "react";
import type { Observation } from "@/mock/types";
import { RUBRICS } from "@/framework";
import { decideObservationAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { ControlError } from "../ControlError";

/**
 * The evidence cited by one score, with the rulings worth making in place.
 *
 * This replaced a checkbox per quote. Ticking boxes was asking the PM to restate a
 * mapping the machine had already made, forty-one rows over, at one round trip per
 * tick — and it made the common case (cite everything on the row) the most
 * laborious one. Every non-rejected observation on the row is now cited
 * automatically, so this is a read-out rather than a picker.
 *
 * What stays interactive is the part that is genuinely a judgment:
 *
 *  - **Reject** — this quote is not evidence. It leaves every score that cites it,
 *    not just this one, which is the honest meaning of rejecting it.
 *  - **Move** — this quote is evidence, but for a different row. The commonest thing
 *    wrong with a filing is the row, not the quote, and re-filing beats rejecting a
 *    good quote. Fixing it here rather than on a separate page is the point: the PM
 *    is already reading it, and they only notice the mis-filing while scoring.
 *  - **Row is right** — the machine filed this unsure, and the person says the
 *    filing is correct (KTD18). It renders only where the "unsure of this row"
 *    chip does — low confidence, nobody has ruled — and both read the same
 *    predicate, so they disappear together once the decider is set. The
 *    confidence itself stays on the record; what a confirmation buys is that
 *    the row stops asking for attention and survives a re-extraction, which
 *    until this verb existed only a move could do.
 *
 * The quote itself is not editable. It was checked against the transcript before it
 * was written; letting it be typed over would quietly turn a citation into a
 * paraphrase.
 */
export function EvidenceList({
  dealId,
  observations,
}: {
  dealId: string;
  observations: Observation[];
}) {
  const decide = useAction(decideObservationAction);
  const [moving, setMoving] = useState<string | null>(null);

  const cited = observations.filter((o) => o.status !== "rejected");
  const rejected = observations.filter((o) => o.status === "rejected");

  async function move(o: Observation, subDimensionKey: string) {
    const rubricKey = RUBRICS.find((r) => r.subs.some((s) => s.key === subDimensionKey))?.key;
    setMoving(null);
    await decide.run(dealId, o.id, { status: "edited", subDimensionKey, rubricKey });
  }

  if (cited.length === 0) {
    return (
      <div className="ctl-note">
        {rejected.length > 0
          ? `no evidence here — ${rejected.length} rejected`
          : "no observations filed here yet"}
      </div>
    );
  }

  return (
    <div className="ev-list">
      <div className="ev-head">
        cited as evidence · {cited.length}
        {rejected.length > 0 && <span className="ev-rej"> · {rejected.length} rejected</span>}
      </div>
      {cited.map((o) => (
        <div className="ev-item" key={o.id}>
          <div className="ev-quote">{o.quote}</div>
          <div className="ev-meta">
            <span className="st">
              call {o.callNumber}
              {o.speaker ? ` · ${o.speaker}` : ""}
              {o.timestamp ? ` · ${o.timestamp}` : ""}
            </span>
            {/*
              The model's reason for filing it here. Shown because it is what makes
              a mis-filing catchable in a glance rather than by re-reading the quote
              against the anchors.
            */}
            {o.mappingNote && <span className="ev-why">{o.mappingNote}</span>}
            {/*
              Gated on "nobody has ruled", not on the confidence alone (KTD18):
              the confidence stays on a confirmed row — the record keeps saying
              the machine was unsure — while the chip's job is to ask for
              attention, which a decided row no longer needs. The old second
              chip (the draft status) is gone with the queue it flagged: draft
              is a legacy status nothing writes any more.
            */}
            {o.confidence === "low" && !o.decidedById && (
              <span className="chip warn xs">
                <span className="dot" />
                unsure of this row
              </span>
            )}
            {o.status === "edited" && (
              <span className="chip xs line">moved here by you</span>
            )}
            <span className="ev-actions">
              {/*
                The confirm verb, in ReviewBoard's words for the same act. It is
                the accepted decision with nothing else on it: sets the decider,
                changes nothing — so on success the server re-renders the row
                with `decidedById` set and this button leaves with the chip,
                both being the same predicate.
              */}
              {o.confidence === "low" && !o.decidedById && (
                <button
                  type="button"
                  className="btn xs ok"
                  disabled={decide.pending}
                  onClick={() => decide.run(dealId, o.id, { status: "accepted" })}
                >
                  Row is right
                </button>
              )}
              <button
                type="button"
                className="btn xs ghost"
                onClick={() => setMoving(moving === o.id ? null : o.id)}
              >
                Move
              </button>
              <button
                type="button"
                className="btn xs danger"
                onClick={() => decide.run(dealId, o.id, { status: "rejected" })}
              >
                Reject
              </button>
            </span>
          </div>
          {moving === o.id && (
            <div className="ctl-row" style={{ marginTop: 6 }}>
              <span className="ctl-note">move to</span>
              <select
                className="inp sm"
                defaultValue={o.subDimensionKey}
                style={{ flex: 1, minWidth: 200 }}
                onChange={(e) => move(o, e.target.value)}
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
            </div>
          )}
        </div>
      ))}
      <ControlError error={decide.error} reauth={decide.reauth} />
    </div>
  );
}
