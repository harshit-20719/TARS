"use client";

import { useState } from "react";
import type { FounderTypeRead } from "@/mock/types";
import { FOUNDER_TYPES, RUBRICS, founderTypeByLabel } from "@/framework";
import { setFounderTypeReadAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { ControlError } from "../ControlError";

/**
 * The founder-type read: context, not a verdict.
 *
 * Picking a type prefills the expected-pillar profile and the Founder-track floor
 * dimension from the framework's overlay — the machine's draft — and both stay
 * editable, because the PM's confirmation is the thing of record (spec D3). There
 * is no go / conditional-go / no-go here: that grid depends on gate logic, which
 * the framework leaves pending.
 */
export function FounderTypeForm({
  dealId,
  read,
}: {
  dealId: string;
  read: FounderTypeRead;
}) {
  const save = useAction(setFounderTypeReadAction);

  const [primary, setPrimary] = useState(read.primary);
  const [secondary, setSecondary] = useState(read.secondary ?? "");
  const [profile, setProfile] = useState(read.profile);
  const [floorDimension, setFloorDimension] = useState(read.floorDimension);
  const [pmConfirmation, setPmConfirmation] = useState(read.pmConfirmation);

  /** Prefill from the overlay, but only where the PM has not written something. */
  function pickPrimary(label: string) {
    setPrimary(label);
    const def = founderTypeByLabel(label);
    if (!def) return;
    if (!profile.trim()) setProfile(def.blurb);
    if (!floorDimension.trim()) setFloorDimension(def.floorDimension);
  }

  const dirty =
    primary !== read.primary ||
    secondary !== (read.secondary ?? "") ||
    profile !== read.profile ||
    floorDimension !== read.floorDimension ||
    pmConfirmation !== read.pmConfirmation;

  return (
    <div className="card-body auth-form">
      <div className="auth-grid">
        <div>
          <label htmlFor="ft-primary">Primary type</label>
          <select
            id="ft-primary"
            className="inp"
            value={primary}
            disabled={save.pending}
            onChange={(e) => pickPrimary(e.target.value)}
          >
            <option value="">— not read yet —</option>
            {FOUNDER_TYPES.map((t) => (
              <option key={t.key} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ft-secondary">Secondary (optional)</label>
          <select
            id="ft-secondary"
            className="inp"
            value={secondary}
            disabled={save.pending}
            onChange={(e) => setSecondary(e.target.value)}
          >
            <option value="">— none —</option>
            {FOUNDER_TYPES.filter((t) => t.label !== primary).map((t) => (
              <option key={t.key} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ft-floor">Founder-track floor reads on</label>
          <select
            id="ft-floor"
            className="inp"
            value={floorDimension}
            disabled={save.pending}
            onChange={(e) => setFloorDimension(e.target.value)}
          >
            <option value="">— not set —</option>
            {RUBRICS.map((r) => (
              <optgroup key={r.key} label={r.label}>
                {r.subs.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="ft-profile">Expected-pillar profile</label>
        <input
          id="ft-profile"
          className="inp"
          value={profile}
          disabled={save.pending}
          placeholder="Which pillars this founder must bring, and which the studio can fill"
          onChange={(e) => setProfile(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="ft-confirm">Your confirmation or override — one line</label>
        <input
          id="ft-confirm"
          className="inp"
          value={pmConfirmation}
          disabled={save.pending}
          placeholder="Start with 'Draft' while it is provisional; the read shows as PM-draft until you drop it."
          onChange={(e) => setPmConfirmation(e.target.value.replace(/[\r\n]+/g, " "))}
        />
      </div>

      <div className="auth-actions">
        <button
          type="button"
          className="btn sm primary"
          disabled={save.pending || !dirty || !primary || !pmConfirmation.trim()}
          onClick={() =>
            save.run({
              dealId,
              primary,
              secondary: secondary || null,
              profile,
              floorDimension,
              pmConfirmation,
            })
          }
        >
          {read.primary ? "Update read" : "Save read"}
        </button>
        {save.pending && <span className="ctl-saving">saving…</span>}
        {!save.pending && !dirty && read.primary && <span className="ctl-note">saved</span>}
      </div>

      <ControlError error={save.error} reauth={save.reauth} />
    </div>
  );
}
