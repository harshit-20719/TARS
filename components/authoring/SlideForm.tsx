"use client";

import { useState } from "react";
import type { Slide } from "@/mock/types";
import type { Pillar, Track } from "@/framework";
import { L1_CAP } from "@/framework";
import { clearSlideAction, setSlideAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";

/**
 * Author one 0–10 pillar or track slide.
 *
 * Three deliberate constraints show up in this form rather than only as server
 * errors, because each one is a rule the PM should see while deciding:
 *
 *  - Banked reads above the L1 cap are offered but marked, and choosing one moves
 *    the number into the provisional field instead of rejecting the click. That is
 *    exactly the framework's own move — "8 provisional, if the claim verifies".
 *  - A provisional below the banked read is not a provisional, so the options
 *    below the banked value are disabled.
 *  - The ceiling guard is required. One line naming which sub-dimension set the
 *    ceiling is the anti-vibe rule; a slide without it is just a number.
 *
 * The lens is never sent — it belongs to the pillar in the frozen config, so the
 * service looks it up. A client cannot relabel a weakest-link read as a peak one.
 */
export function SlideForm({
  dealId,
  def,
  slide,
  suggestedGuard,
}: {
  dealId: string;
  def: Pillar | Track;
  slide?: Slide;
  /** A starting sentence naming the row that currently sets the ceiling. */
  suggestedGuard?: string;
}) {
  const save = useAction(setSlideAction);
  const clear = useAction(clearSlideAction);

  const [value, setValue] = useState<number | null>(slide?.value ?? null);
  const [provisional, setProvisional] = useState<number | null>(slide?.provisionalValue ?? null);
  const [guard, setGuard] = useState(slide?.ceilingGuard ?? "");

  const pending = save.pending || clear.pending;
  const error = save.error ?? clear.error;

  /**
   * A read above the cap cannot be banked, so route it to the provisional and
   * bank at the cap — the reading the framework asks for, rather than an error.
   */
  function pickBanked(n: number) {
    if (n > L1_CAP) {
      setValue(L1_CAP);
      setProvisional(n);
      return;
    }
    setValue(n);
    if (provisional !== null && provisional < n) setProvisional(null);
  }

  async function submit() {
    if (value === null) return;
    await save.run({
      dealId,
      slideKey: def.key,
      value,
      provisionalValue: provisional,
      ceilingGuard: guard.trim() || suggestedGuard || "",
    });
  }

  const dirty =
    value !== (slide?.value ?? null) ||
    provisional !== (slide?.provisionalValue ?? null) ||
    guard !== (slide?.ceilingGuard ?? "");

  return (
    <div className="slide-auth">
      <div className="ctl-row">
        <span className="ctl-note" style={{ minWidth: 74 }}>banked</span>
        <div className="seg" role="group" aria-label={`${def.name} banked read`}>
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              className={n > L1_CAP ? "over-cap" : undefined}
              aria-pressed={n === value}
              disabled={pending}
              title={
                n > L1_CAP
                  ? `Above the L1 cap of ${L1_CAP} — records as a provisional, banked at ${L1_CAP}`
                  : undefined
              }
              onClick={() => pickBanked(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="ctl-note">cap {L1_CAP}</span>
      </div>

      <div className="ctl-row">
        <span className="ctl-note" style={{ minWidth: 74 }}>provisional</span>
        <div className="seg" role="group" aria-label={`${def.name} provisional read`}>
          <button type="button" aria-pressed={provisional === null} disabled={pending} onClick={() => setProvisional(null)}>
            none
          </button>
          <span className="seg-sep" />
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              aria-pressed={n === provisional}
              disabled={pending || value === null || n < value}
              title={value !== null && n < value ? "A provisional is a higher read, pending verification" : undefined}
              onClick={() => setProvisional(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl-row" style={{ alignItems: "flex-start" }}>
        <span className="ctl-note" style={{ minWidth: 74, paddingTop: 9 }}>ceiling guard</span>
        <input
          className="inp"
          style={{ flex: 1, minWidth: 260 }}
          value={guard}
          disabled={pending}
          placeholder={suggestedGuard ?? "Which sub-dimension set this ceiling, and what would lift it?"}
          onChange={(e) => setGuard(e.target.value.replace(/[\r\n]+/g, " "))}
        />
      </div>

      <div className="ctl-row">
        <button
          type="button"
          className="btn sm primary"
          disabled={pending || value === null || !dirty}
          onClick={submit}
        >
          {slide ? "Update slide" : "Set slide"}
        </button>
        {slide && (
          <button
            type="button"
            className="btn sm danger"
            disabled={pending}
            onClick={() => clear.run(dealId, def.key)}
          >
            Clear
          </button>
        )}
        {pending && <span className="ctl-saving">saving…</span>}
        {!pending && !dirty && slide && <span className="ctl-note">saved</span>}
        {suggestedGuard && !guard && (
          <button type="button" className="btn sm ghost" disabled={pending} onClick={() => setGuard(suggestedGuard)}>
            use suggested guard
          </button>
        )}
      </div>

      {error && <div className="ctl-err" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}
