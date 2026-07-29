"use client";

import { useState } from "react";
import type { Deal } from "@/mock/types";
import { updateDealAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { ControlError } from "../ControlError";

/**
 * Correct a deal's own details after it was opened.
 *
 * Collapsed by default, because the overview page is for reading the record and
 * these three fields rarely change. What is deliberately absent is `layer`: this
 * build records L1 only, and letting a stray click restamp a record as L2 would
 * silently detach every score on it from the layer it was authored at.
 */
export function DealHeaderForm({ deal }: { deal: Deal }) {
  const save = useAction(updateDealAction);
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(deal.company);
  const [oneLiner, setOneLiner] = useState(deal.oneLiner);
  const [founders, setFounders] = useState(deal.founders);

  if (!open) {
    return (
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>
        Edit details
      </button>
    );
  }

  const dirty =
    company !== deal.company || oneLiner !== deal.oneLiner || founders !== deal.founders;

  async function submit() {
    const r = await save.run(deal.id, { company, oneLiner, founders });
    if (r.ok) setOpen(false);
  }

  return (
    <div className="card" style={{ marginTop: 0, marginBottom: 18 }}>
      <div className="card-head">
        <h2>Deal details</h2>
        <div className="spacer" />
        <button type="button" className="btn sm ghost" disabled={save.pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="card-body auth-form">
        <div className="auth-grid">
          <div>
            <label htmlFor="ed-company">Company</label>
            <input id="ed-company" className="inp" value={company} disabled={save.pending}
              onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ed-founders">Founders</label>
            <input id="ed-founders" className="inp" value={founders} disabled={save.pending}
              onChange={(e) => setFounders(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="ed-oneliner">One-liner</label>
          <input id="ed-oneliner" className="inp" value={oneLiner} disabled={save.pending}
            onChange={(e) => setOneLiner(e.target.value)} />
        </div>
        <div className="auth-actions">
          <button type="button" className="btn sm primary" disabled={save.pending || !dirty} onClick={submit}>
            {save.pending ? "Saving…" : "Save"}
          </button>
        </div>
        <ControlError error={save.error} reauth={save.reauth} />
      </div>
    </div>
  );
}
