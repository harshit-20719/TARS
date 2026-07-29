"use client";

import { useState } from "react";
import type { Slide } from "@/mock/types";
import type { Pillar, Track } from "@/framework";
import { L1_CAP } from "@/framework";
import { clearSlideAction, setSlideAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { ControlError } from "../ControlError";

/**
 * Author one 0–10 pillar or track slide.
 *
 * **One scale, not two.** The first version showed a banked strip and a provisional
 * strip, both 0–10, and two identical scales side by side is a genuinely confusing
 * thing to put in front of someone — it reads as though there are two independent
 * judgments to make. There is only one. What the cap does is split that single read
 * into a bankable part and a pending part, so the form now expresses it that way:
 * you press the number you actually believe, and if it is above the cap the form
 * banks at the cap and records the rest as provisional. The provisional is a
 * consequence of the press, shown back as a sentence, never a second control.
 *
 * That also removes the case the old form allowed and the framework has no use for:
 * a provisional above a banked 3. A provisional means "the cap is stopping me", and
 * at 3 nothing is — there are three unused numbers below the ceiling. Now it can
 * only arise where it means something.
 *
 * **The ceiling guard is prefilled.** The machine can find which rooted row sits
 * lowest under this slide's lens, and that is most of the sentence. What it cannot
 * know is whether that row is genuinely what holds the read down — so the line is
 * offered and the PM confirms or rewrites it, and the record keeps which of those
 * happened. Unconfirmed, it is a mechanical note; confirmed, it is the PM's stated
 * reason, which is the whole point of the anti-vibe rule.
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
  /** The machine's line, naming the row that currently sets the ceiling. */
  suggestedGuard?: string;
}) {
  const save = useAction(setSlideAction);
  const clear = useAction(clearSlideAction);

  /**
   * The number the PM pressed, which may be above the cap. Banked and provisional
   * are derived from it rather than stored separately, so the two cannot drift out
   * of agreement with each other.
   */
  const [read, setRead] = useState<number | null>(
    slide ? (slide.provisionalValue ?? slide.value) : null,
  );
  const [guard, setGuard] = useState(slide?.ceilingGuard ?? suggestedGuard ?? "");
  const [touchedGuard, setTouchedGuard] = useState(false);

  const pending = save.pending || clear.pending;
  const error = save.error ?? clear.error;

  const banked = read === null ? null : Math.min(read, L1_CAP);
  const provisional = read !== null && read > L1_CAP ? read : null;

  /**
   * Whether the guard on screen is the PM's line or still the machine's.
   *
   * Editing it makes it theirs. Pressing Confirm makes it theirs. Leaving the
   * suggestion untouched does not — and the saved slide says so.
   */
  const guardIsMine = touchedGuard || (slide?.guardConfirmed ?? false);

  async function submit() {
    if (read === null || banked === null) return;
    await save.run({
      dealId,
      slideKey: def.key,
      value: banked,
      provisionalValue: provisional,
      ceilingGuard: guard.trim(),
      guardConfirmed: guardIsMine,
    });
    setTouchedGuard(false);
  }

  const savedRead = slide ? (slide.provisionalValue ?? slide.value) : null;
  const dirty =
    read !== savedRead ||
    guard !== (slide?.ceilingGuard ?? suggestedGuard ?? "") ||
    (touchedGuard && !slide?.guardConfirmed);

  return (
    <div className="slide-auth">
      <div className="ctl-row">
        <span className="ctl-note" style={{ minWidth: 74 }}>your read</span>
        <div className="seg" role="group" aria-label={`${def.name} read`}>
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              className={n > L1_CAP ? "over-cap" : undefined}
              aria-pressed={n === read}
              disabled={pending}
              title={
                n > L1_CAP
                  ? `Above the L1 cap — banks at ${L1_CAP}, records ${n} as provisional`
                  : undefined
              }
              /**
               * Pressing the selected number again does nothing, unlike the score
               * grid where press-again clears. A slide has an explicit Clear
               * button, and toggling to "no read" here left the form looking
               * unscored while the saved slide was untouched — with Set disabled,
               * so the only way out was pressing a number again. A press that
               * appears to undo a save without doing so is worse than a press that
               * does nothing.
               */
              onClick={() => setRead(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="ctl-note">cap {L1_CAP}</span>
      </div>

      {/*
        What the press means, in words. This is the only place the split appears,
        and it appears as an explanation rather than as a second thing to fill in.
      */}
      {read !== null && (
        <div className={`slide-split ${provisional !== null ? "capped" : ""}`}>
          {provisional !== null ? (
            <>
              banks at <b>{banked}</b> — the L1 ceiling while the claims behind it are unverified — and records{" "}
              <b>{provisional} provisional</b>, if they verify.
            </>
          ) : (
            <>
              banks at <b>{banked}</b>. Below the cap, so nothing is held back.
            </>
          )}
        </div>
      )}

      <div className="ctl-row" style={{ alignItems: "flex-start" }}>
        <span className="ctl-note" style={{ minWidth: 74, paddingTop: 9 }}>ceiling guard</span>
        <input
          className="inp"
          style={{ flex: 1, minWidth: 260 }}
          value={guard}
          disabled={pending}
          placeholder="Which sub-dimension set this ceiling, and what would lift it?"
          onChange={(e) => {
            setGuard(e.target.value.replace(/[\r\n]+/g, " "));
            setTouchedGuard(true);
          }}
        />
      </div>

      {guard && !guardIsMine && (
        <div className="ctl-row">
          <span className="chip warn xs">
            <span className="dot" />
            machine-suggested · not yet yours
          </span>
          <button
            type="button"
            className="btn xs"
            disabled={pending}
            onClick={() => setTouchedGuard(true)}
          >
            Confirm this reason
          </button>
          <span className="ctl-note">or edit it above</span>
        </div>
      )}

      <div className="ctl-row">
        <button
          type="button"
          className="btn sm primary"
          disabled={pending || read === null || !guard.trim() || !dirty}
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
        {!pending && !dirty && slide && (
          <span className="ctl-note">
            saved{slide.guardConfirmed ? "" : " · guard still the machine's"}
          </span>
        )}
      </div>

      <ControlError error={error} reauth={save.reauth || clear.reauth} style={{ marginTop: 4 }} />
    </div>
  );
}
