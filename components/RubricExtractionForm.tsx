"use client";

import { useState } from "react";
import { saveRubricExtractionConfigAction } from "@/lib/actions";
import { useAction } from "@/lib/useAction";
import { ControlError } from "./ControlError";

/**
 * How the machine reads one macro-dimension (R17, KTD12).
 *
 * Three things an admin may shape, and no more: who the model is reading as,
 * what to watch for, and how loosely it may answer. What stays out is
 * deliberate — the rows themselves, the output schema, and the authorship rule
 * are generated from the framework so the prompt cannot drift from the rubric,
 * and putting them in a textarea would make that guarantee a suggestion.
 *
 * Flat components/ rather than components/authoring/: this mutates
 * configuration, not a deal record.
 */

/** The strip's steps. Every value here is at or under the cap, by construction. */
const STEPS = [0, 0.1, 0.2, 0.3, 0.4] as const;

export function RubricExtractionForm({
  rubricKey,
  label,
  persona: savedPersona,
  guidance: savedGuidance,
  temperature: savedTemperature,
  version,
  personaMax,
  guidanceMax,
  temperatureMax,
  temperatureApplies,
  providerLabel,
  lastRun,
}: {
  rubricKey: string;
  label: string;
  persona: string;
  guidance: string;
  temperature: number;
  /** Which saved text this is; null when nobody has saved one yet. */
  version: number | null;
  personaMax: number;
  guidanceMax: number;
  temperatureMax: number;
  /**
   * Whether the active provider's model accepts a temperature at all. Decided
   * on the server and passed as a boolean, the way UserChip takes its admin
   * flag — the rule about which model generations refuse the parameter belongs
   * to the adapter, not to a form.
   */
  temperatureApplies: boolean;
  providerLabel: string;
  /** What this rubric's last run dropped, and the text it ran under. */
  lastRun: { droppedQuotes: number; configVersion: number | null } | null;
}) {
  const save = useAction(saveRubricExtractionConfigAction);

  const [persona, setPersona] = useState(savedPersona);
  const [guidance, setGuidance] = useState(savedGuidance);
  const [temperature, setTemperature] = useState(savedTemperature);

  const dirty =
    persona !== savedPersona || guidance !== savedGuidance || temperature !== savedTemperature;

  return (
    <div className="card-body auth-form">
      <div>
        <label htmlFor={`persona-${rubricKey}`}>Persona — who the model reads as</label>
        <textarea
          id={`persona-${rubricKey}`}
          className="ta"
          style={{ minHeight: 90 }}
          value={persona}
          maxLength={personaMax}
          disabled={save.pending}
          placeholder={`An investor who has spent a decade on ${label.toLowerCase()}.`}
          onChange={(e) => setPersona(e.target.value)}
        />
        {save.field === "persona" && <ControlError error={save.error} reauth={save.reauth} />}
      </div>

      <div>
        <label htmlFor={`guidance-${rubricKey}`}>Guidance — what to watch for in this block</label>
        <textarea
          id={`guidance-${rubricKey}`}
          className="ta"
          style={{ minHeight: 120 }}
          value={guidance}
          maxLength={guidanceMax}
          disabled={save.pending}
          placeholder="Prefer specifics over adjectives. A named customer beats a claim about demand."
          onChange={(e) => setGuidance(e.target.value)}
        />
        {save.field === "guidance" && <ControlError error={save.error} reauth={save.reauth} />}
      </div>

      <div className="ctl-row">
        <span className="ctl-note" style={{ minWidth: 74 }}>
          temperature
        </span>
        <div className="seg" role="group" aria-label={`${label} temperature`}>
          {STEPS.map((step) => (
            <button
              key={step}
              type="button"
              aria-pressed={step === temperature}
              disabled={save.pending || !temperatureApplies}
              onClick={() => setTemperature(step)}
            >
              {step.toFixed(1)}
            </button>
          ))}
        </div>
        <span className="ctl-note">cap {temperatureMax.toFixed(1)}</span>
      </div>

      {/*
        The cap explained as a consequence rather than as a rule, in one
        sentence beside the control — the shape SlideForm uses for its own cap.
        What is deliberately absent is the banking half of that pattern: a slide
        above its cap still records a provisional read, so over-cap values stay
        pressable there. A temperature above this cap is refused outright, so
        rendering the higher values as pressable would be offering a press whose
        only outcome is a rejected save.
      */}
      <p className="ctl-note">
        {temperatureApplies ? (
          <>
            Above {temperatureMax.toFixed(1)} the verbatim check starts discarding more quotes than
            the looser reading finds — the cap is where more temperature stops buying evidence and
            starts buying silence.
          </>
        ) : (
          <>
            The active provider ({providerLabel}) refuses this parameter, so the setting is stored
            and ignored until a model that accepts it is configured. Persona and guidance still
            apply on every run.
          </>
        )}
      </p>

      {/*
        The feedback number for the control above it (R20), labelled with the
        text it ran under. Without that label the count is not comparable to
        what is in the boxes now: a drop count from before the last save
        describes words nobody can read any more.
      */}
      {lastRun && (
        <p className="ctl-note">
          Last run dropped {lastRun.droppedQuotes} quote{lastRun.droppedQuotes === 1 ? "" : "s"} on
          this block, reading under{" "}
          {lastRun.configVersion === null ? "the defaults" : `version ${lastRun.configVersion}`}.
        </p>
      )}

      <div className="auth-actions">
        <button
          type="button"
          className="btn sm primary"
          disabled={save.pending || !dirty}
          onClick={() => save.run({ rubricKey, persona, guidance, temperature })}
        >
          {save.pending ? "Saving…" : version === null ? "Save tuning" : "Update tuning"}
        </button>
        {save.pending && <span className="ctl-saving">saving…</span>}
        {!save.pending && !dirty && version !== null && (
          <span className="ctl-note">saved · version {version}</span>
        )}
      </div>

      {/*
        The unfielded errors — a refusal, an ended session, anything the schema
        did not attach to a box. Field-level messages render at their control
        above; rendering both would print the same sentence twice.
      */}
      {save.field === undefined && <ControlError error={save.error} reauth={save.reauth} />}
    </div>
  );
}
