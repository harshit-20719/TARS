/**
 * The framework's invariants, as pure functions.
 *
 * These are the rules that make the record trustworthy rather than merely
 * well-typed: a score has to match the kind of row it sits on, a banked slide
 * cannot outrun what L1 can actually verify, and every slide has to say out loud
 * which sub-dimension set its ceiling. Every mutation runs through here before
 * it touches the database.
 *
 * What is deliberately absent is as important as what is here. There is no
 * total, no composite, no average, and no gate verdict — the framework does not
 * define one at L1 (spec D1), so the code cannot invent one. `floorBreaches`
 * reports a fact; it does not decide anything.
 */

import { L1_CAP, slideDefByKey, subByKey } from "@/framework";
import type { Layer, Lens, ScoreValue, SubDimensionScore } from "@/mock/types";
import { isBinaryValue, isScaleValue } from "./codec";

/** A domain rule was broken. Carries a message fit to show the PM. */
export class RuleViolation extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "RuleViolation";
    this.field = field;
  }
}

/** This build writes the L1 layer only; later layers attach through this stamp. */
export function assertLayer(layer: Layer): void {
  if (layer !== "L1") {
    throw new RuleViolation(`this build records the L1 layer only, got ${layer}`, "layer");
  }
}

// ------------------------------------------------------------------ scores

/**
 * A score's value must belong to the value set its sub-dimension declares. A
 * 1..5 read on a binary hygiene row is not a rounding problem, it is a category
 * error — the two scales mean different things and never share an axis.
 */
export function assertScoreValue(subDimensionKey: string, value: ScoreValue) {
  const sub = subByKey(subDimensionKey);
  if (!sub) {
    throw new RuleViolation(`no such sub-dimension: ${subDimensionKey}`, "subDimensionKey");
  }
  if (sub.type === "scale" && !isScaleValue(value)) {
    throw new RuleViolation(
      `"${sub.label}" is scored 1–5 (or NE), not ${JSON.stringify(value)}`,
      "value",
    );
  }
  if (sub.type === "binary" && !isBinaryValue(value)) {
    throw new RuleViolation(
      `"${sub.label}" is a pass/fail row, not ${JSON.stringify(value)}`,
      "value",
    );
  }
  return sub;
}

/**
 * A score saved with no evidence is allowed but incomplete (spec D7, the soft
 * option) — a PM works in progress, and the scorecard shows the gap rather than
 * blocking the save.
 */
export function isIncompleteScore(evidenceObsIds: readonly string[]): boolean {
  return evidenceObsIds.length === 0;
}

// ------------------------------------------------------------------ slides

export interface SlideInput {
  slideKey: string;
  value: number;
  provisionalValue?: number | null;
  ceilingGuard: string;
  lens: Lens;
}

/**
 * Validate a 0..10 human read.
 *
 * The cap is the load-bearing rule. At L1 the claims behind a slide are not yet
 * verified, so the *bankable* ceiling is L1_CAP. A higher read is still
 * recordable — as a provisional, which is exactly the "8 provisional, if the
 * claim verifies" the framework asks for. That is why the cap constrains the
 * banked value only.
 */
export function assertSlide(input: SlideInput) {
  const def = slideDefByKey(input.slideKey);
  if (!def) {
    throw new RuleViolation(`no such pillar or track: ${input.slideKey}`, "slideKey");
  }

  if (!Number.isInteger(input.value) || input.value < 0 || input.value > 10) {
    throw new RuleViolation(`a slide is 0–10, got ${input.value}`, "value");
  }

  if (input.value > L1_CAP) {
    throw new RuleViolation(
      `L1 banks at most ${L1_CAP} while the claims are unverified — ` +
        `record ${input.value} as a provisional instead`,
      "value",
    );
  }

  const prov = input.provisionalValue;
  if (prov !== undefined && prov !== null) {
    if (!Number.isInteger(prov) || prov < 0 || prov > 10) {
      throw new RuleViolation(`a provisional read is 0–10, got ${prov}`, "provisionalValue");
    }
    if (prov < input.value) {
      throw new RuleViolation(
        `a provisional read is a higher read pending verification — ` +
          `${prov} sits below the banked ${input.value}`,
        "provisionalValue",
      );
    }
  }

  const guard = input.ceilingGuard.trim();
  if (!guard) {
    throw new RuleViolation(
      "every slide needs one line naming which sub-dimension set the ceiling",
      "ceilingGuard",
    );
  }
  if (/[\r\n]/.test(guard)) {
    throw new RuleViolation("the ceiling guard is a single line", "ceilingGuard");
  }

  if (input.lens !== def.lens) {
    throw new RuleViolation(
      `"${def.name}" reads on its ${def.lens} lens, not ${input.lens}`,
      "lens",
    );
  }

  return def;
}

// ------------------------------------------------------------------- facts

export interface FloorBreach {
  subDimensionKey: string;
  label: string;
  /** The value that tripped the row, so a caller can show it without re-looking-up. */
  value: ScoreValue;
  /** What the framework attaches to this breach: a kill, or a mandatory-clear flag. */
  weight: "kill" | "flag";
  /** An unresolved framework call on this row, if it has one (spec D5). */
  open?: string;
}

/**
 * Which hygiene floor rows have been tripped.
 *
 * Each floor row declares the single value that trips it. That indirection is the
 * whole point: eight of the ten floor rows are binary and trip on Fail, but
 * Ambition & exit-type fit and Cap-table health are scored 1–5 and killed at 1.
 * A check written as "binary rows scored fail" — which is what this function used
 * to be — silently misses both, and misses them in the direction that matters:
 * the deal looks clean when the framework says drop it.
 *
 * A fact, reported for rendering. The framework says a Fail drops the deal, but it
 * leaves the G1 thresholds pending (spec D1) — so this function names the breaches
 * and stops there. Turning a breach into a verdict is a decision the partners have
 * not made yet, and nothing in this codebase may make it for them. `weight` is
 * likewise reported, not applied: it carries Notion's own distinction between a
 * kill and an elevated, mandatory-clear flag.
 */
export function floorBreaches(scores: readonly SubDimensionScore[]): FloorBreach[] {
  return scores.flatMap((s) => {
    const sub = subByKey(s.subDimensionKey);
    if (!sub?.floor) return [];
    if (s.value !== sub.floor.breachAt) return [];
    return [
      {
        subDimensionKey: s.subDimensionKey,
        label: sub.label,
        value: s.value,
        weight: sub.floor.weight,
        ...(sub.open ? { open: sub.open } : {}),
      },
    ];
  });
}

/** Breaches the framework treats as deal-dropping, as opposed to flagged. */
export function killBreaches(scores: readonly SubDimensionScore[]): FloorBreach[] {
  return floorBreaches(scores).filter((b) => b.weight === "kill");
}

/** Breaches the framework treats as an elevated, mandatory-clear condition. */
export function flagBreaches(scores: readonly SubDimensionScore[]): FloorBreach[] {
  return floorBreaches(scores).filter((b) => b.weight === "flag");
}
