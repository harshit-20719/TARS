"use client";

import { useState } from "react";
import type { ReassignCandidate } from "@/lib/data";
import { reassignDealAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Icon } from "@/components/icons";
import { ControlError } from "../ControlError";

/**
 * Hand a deal to another account holder (R8, F2).
 *
 * Two presses rather than DeleteDeal's type-the-company-name gate, because this
 * is not the irreversible one — the record survives intact and the new owner (or
 * an ADMIN) can move it back. What the gate cannot be light about is *who* can
 * move it back: R9 checks against the current owner, so the moment this write
 * lands the person who pressed it has no reassign right left. The handover is
 * recoverable, just not by them. That is the sentence the armed state carries,
 * and it is why the disclosure does the work here rather than a heavier gate.
 *
 * Rendered for everybody, including people the server will refuse. `ownerId` is
 * deliberately not on the `Deal` record contract (mock/types.ts), so the page
 * cannot tell who owns the deal and hiding the control would mean leaking that —
 * the same arrangement DeleteDeal already uses. `assertMayReassignDeal` is the
 * boundary, and its refusal lands under the button.
 *
 * The owner is not displayed here. The sidebar already names them, and a second
 * display is a second thing that can contradict the first.
 */
export function ReassignDeal({
  dealId,
  company,
  candidates,
}: {
  dealId: string;
  company: string;
  /** Everyone who holds an account — id and display name, nothing else. */
  candidates: ReassignCandidate[];
}) {
  const move = useAction(reassignDealAction);
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [armed, setArmed] = useState(false);

  const chosen = candidates.find((c) => c.id === ownerId);

  /**
   * Put the control back the way it was found — including the error, which
   * describes the press that caused it. A refusal left lying around reports a
   * failure that has not happened yet the next time the card is opened.
   */
  function close() {
    setOpen(false);
    setArmed(false);
    setOwnerId("");
    move.clearError();
  }

  if (!open) {
    return (
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>
        Change owner
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 0, marginBottom: 18 }}>
      <div className="card-head">
        <h2>Change who owns {company}</h2>
        <div className="spacer" />
        <button
          type="button"
          className="btn sm ghost"
          disabled={move.pending}
          onClick={() => close()}
        >
          Cancel
        </button>
      </div>
      <div className="card-body auth-form">
        <div>
          <label htmlFor="reassign-owner">Hand {company} to</label>
          <select
            id="reassign-owner"
            className="inp"
            value={ownerId}
            disabled={move.pending}
            onChange={(e) => {
              setOwnerId(e.target.value);
              /**
               * Re-picking disarms. Without this the confirm button keeps naming
               * whoever was chosen when it was armed while sending whoever is
               * chosen now — and this is the one control where a mismatch cannot
               * be undone by the person who caused it.
               */
              setArmed(false);
            }}
          >
            <option value="">— choose an account holder —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {armed && chosen ? (
          <>
            <div className="callout" style={{ marginBottom: 0 }}>
              <span className="co-badge">
                <Icon name="alert" className="i sm" /> what moves
              </span>
              <span>
                {chosen.name} becomes the owner of {company}. The right to delete this deal moves
                with it — they will be able to, and you will not. Only the new owner or an ADMIN can
                move it back, so you will not be able to undo this yourself.
              </span>
            </div>
            <div className="auth-actions">
              <button
                type="button"
                className="btn sm primary"
                disabled={move.pending}
                onClick={async () => {
                  // The sidebar names the new owner once the page revalidates,
                  // so the card has nothing left to say.
                  if ((await move.run(dealId, ownerId)).ok) close();
                }}
              >
                {move.pending ? "Handing over…" : `Hand ${company} to ${chosen.name}`}
              </button>
              <button
                type="button"
                className="btn sm ghost"
                disabled={move.pending}
                onClick={() => setArmed(false)}
              >
                Keep it
              </button>
            </div>
          </>
        ) : (
          <div className="auth-actions">
            <button
              type="button"
              className="btn sm"
              disabled={!chosen || move.pending}
              onClick={() => setArmed(true)}
            >
              Hand over…
            </button>
            <span className="ctl-note">
              A deal&apos;s owner or an ADMIN can change who owns it.
            </span>
          </div>
        )}

        <ControlError error={move.error} reauth={move.reauth} />
      </div>
    </div>
  );
}
