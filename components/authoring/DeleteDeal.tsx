"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DealRecord } from "@/mock/types";
import { deleteDealAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Icon } from "@/components/icons";

/**
 * Delete a deal record, with a confirmation you cannot click through.
 *
 * Typing the company name rather than pressing "Are you sure?" is deliberate. The
 * delete cascades — every score, slide, accepted observation, and claim goes with
 * it, and there is no undo — so the confirmation should cost about as much
 * attention as the thing it destroys. It also states the count of what will be
 * lost, because "delete Halten" and "delete Halten and 35 scores" are different
 * decisions and only one of them is visible from the button.
 */
export function DeleteDeal({ record }: { record: DealRecord }) {
  const router = useRouter();
  const del = useAction(deleteDealAction);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const { company, id } = record.deal;
  const counts = [
    [record.calls.length, "transcript"],
    [record.observations.length, "observation"],
    [record.scores.length, "score"],
    [record.slides.length, "slide"],
  ] as const;
  const carried = counts
    .filter(([n]) => n > 0)
    .map(([n, noun]) => `${n} ${noun}${n === 1 ? "" : "s"}`);

  if (!open) {
    return (
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>
        Delete deal
      </button>
    );
  }

  async function submit() {
    const r = await del.run(id);
    if (r.ok) {
      // The page we are standing on is gone; go somewhere that still exists.
      router.push("/deals");
    }
  }

  return (
    <div className="card" style={{ marginTop: 0, marginBottom: 18, borderColor: "var(--bad)" }}>
      <div className="card-head">
        <h2>Delete {company}</h2>
        <div className="spacer" />
        <button type="button" className="btn sm ghost" disabled={del.pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="card-body auth-form">
        <div className="callout" style={{ background: "var(--bad-tint)", marginBottom: 0 }}>
          <span className="co-badge" style={{ color: "var(--bad)" }}>
            <Icon name="alert" className="i sm" /> no undo
          </span>
          <span>
            {carried.length > 0 ? (
              <>
                This removes the record and everything on it — {carried.join(", ")}. None of it can be
                recovered.
              </>
            ) : (
              <>Nothing has been recorded against this deal yet, so only the record itself goes.</>
            )}
          </span>
        </div>
        <div>
          <label htmlFor="del-confirm">
            Type <b>{company}</b> to confirm
          </label>
          <input
            id="del-confirm"
            className="inp"
            value={typed}
            autoFocus
            autoComplete="off"
            disabled={del.pending}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <div className="auth-actions">
          <button
            type="button"
            className="btn sm danger"
            disabled={del.pending || typed.trim() !== company}
            onClick={submit}
          >
            {del.pending ? "Deleting…" : `Delete ${company} permanently`}
          </button>
          <span className="ctl-note">
            A PM can delete a deal they opened; an ADMIN can delete any.
          </span>
        </div>
        {del.error && <div className="ctl-err">{del.error}</div>}
      </div>
    </div>
  );
}
