"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDealAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { Icon } from "@/components/icons";
import { ControlError } from "../ControlError";

/**
 * Open a deal record. Collapsed until asked for, so the deals list stays a list.
 *
 * `opened` is left to the server when blank — the service stamps today's date in
 * the record's own format rather than trusting a client clock.
 */
export function NewDealForm() {
  const router = useRouter();
  const create = useAction(createDealAction);
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [founders, setFounders] = useState("");

  if (!open) {
    return (
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        <Icon name="plus" /> New deal
      </button>
    );
  }

  async function submit() {
    const result = await create.run({ company, oneLiner, founders });
    if (result.ok) router.push(`/deals/${result.data}/transcript`);
  }

  return (
    <div className="card" style={{ marginTop: 0, width: "100%" }}>
      <div className="card-head">
        <h2>Open a deal record</h2>
        <div className="spacer" />
        <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="card-body auth-form">
        <div className="auth-grid">
          <div>
            <label htmlFor="nd-company">Company</label>
            <input
              id="nd-company"
              className="inp"
              value={company}
              autoFocus
              disabled={create.pending}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="nd-founders">Founders</label>
            <input
              id="nd-founders"
              className="inp"
              value={founders}
              placeholder="Aparna Rao · Daniel Okafor"
              disabled={create.pending}
              onChange={(e) => setFounders(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label htmlFor="nd-oneliner">One-liner</label>
          <input
            id="nd-oneliner"
            className="inp"
            value={oneLiner}
            placeholder="What they do, in one sentence."
            disabled={create.pending}
            onChange={(e) => setOneLiner(e.target.value)}
          />
        </div>
        <div className="auth-actions">
          <button
            type="button"
            className="btn primary"
            disabled={create.pending || !company.trim() || !oneLiner.trim() || !founders.trim()}
            onClick={submit}
          >
            {create.pending ? "Opening…" : "Open record"}
          </button>
          <span className="ctl-note">You become the owning PM. Next step is the first transcript.</span>
        </div>
        <ControlError error={create.error} reauth={create.reauth} />
      </div>
    </div>
  );
}
