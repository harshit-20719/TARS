"use client";

import { useState } from "react";
import { deleteCallAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";

/**
 * Remove one call's transcript — the fix for a paste that went wrong.
 *
 * Two presses rather than a typed confirmation, because this is the recoverable
 * one: a transcript can be pasted again, and the observations drafted from it are
 * keyed by call number rather than a foreign key, so they survive. The label says
 * so, since "delete" usually means the drafts go too.
 */
export function DeleteCall({
  dealId,
  callId,
  callNumber,
  draftedCount,
}: {
  dealId: string;
  callId: string;
  callNumber: number;
  draftedCount: number;
}) {
  const del = useAction(deleteCallAction);
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button type="button" className="btn sm ghost" onClick={() => setArmed(true)}>
        Remove transcript
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn sm danger"
        disabled={del.pending}
        onClick={() => del.run(dealId, callId)}
      >
        {del.pending ? "Removing…" : `Remove call ${callNumber}`}
      </button>
      <button type="button" className="btn sm ghost" disabled={del.pending} onClick={() => setArmed(false)}>
        Keep it
      </button>
      <span className="ctl-note">
        {draftedCount > 0
          ? `The ${draftedCount} observation${draftedCount === 1 ? "" : "s"} filed from this call stay — they are keyed by call number, not by the transcript.`
          : "Nothing was filed from this call."}
      </span>
      {del.error && <span className="ctl-err">{del.error}</span>}
    </>
  );
}
