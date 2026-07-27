import type { Lens } from "@/mock/types";
import { RUBRICS } from "./rubrics";

/**
 * The seven pillars of differentiation and the three tracks — the 0–10 human
 * slides (plan U2 / R9).
 *
 * From Notion's rooting reference: the Idea track's pillars are critical (Earned
 * secret · Foundational tech · Cornered resource · Privileged distribution) or
 * fillable (GTM engine · Founder-led storytelling · Business-model innovation);
 * the Founder/s and Market tracks are the people/market reads, with Market judged
 * once Idea and Founder/s clear.
 *
 * `rooted` is derived from the rubric rows rather than listed here, so the two
 * files cannot drift: a row's Notion "Roots to" column is the single source of
 * truth for which slide it roots to. A pillar with nothing rooted to it is a real
 * state of the framework, not a gap in this file — see `bmi` and the Idea track.
 *
 * The per-deal slide itself — banked value, provisional, ceiling guard — lives in
 * the record, never here. Nothing in this module computes a slide from the rows
 * beneath it; a human reads them upward (spec R5).
 */

export type PillarKind = "critical" | "fillable";

export interface RootedRef {
  subKey: string;
}

interface SlideDefBase {
  key: string;
  name: string;
  lens: Lens;
  /** Sub-dimensions whose "Roots to" column names this slide. */
  rooted: RootedRef[];
  /** How this slide is read, where the framework says something specific. */
  note?: string;
}

export interface Pillar extends SlideDefBase {
  kind: PillarKind;
  track: "idea";
}

export type Track = SlideDefBase;

/** Every row whose Notion "Roots to" column resolves to this slide key. */
function rootedTo(slideKey: string): RootedRef[] {
  return RUBRICS.flatMap((r) => r.subs)
    .filter((s) => s.roots.includes(slideKey))
    .map((s) => ({ subKey: s.key }));
}

export const PILLARS: Pillar[] = [
  { key: "earned-secret", name: "Earned secret", kind: "critical", lens: "peak", track: "idea",
    rooted: rootedTo("earned-secret") },
  { key: "foundational-tech", name: "Foundational tech", kind: "critical", lens: "peak", track: "idea",
    rooted: rootedTo("foundational-tech"),
    note: "Corroborated by Architecture & scalability (capture) — read, not added." },
  { key: "cornered-resource", name: "Cornered resource", kind: "critical", lens: "peak", track: "idea",
    rooted: rootedTo("cornered-resource"),
    note: "Wedge & path to leadership (capture) carries the control-point read." },
  { key: "privileged-distribution", name: "Privileged distribution", kind: "critical", lens: "peak", track: "idea",
    rooted: rootedTo("privileged-distribution") },
  { key: "gtm-engine", name: "GTM engine", kind: "fillable", lens: "weakest-link", track: "idea",
    rooted: rootedTo("gtm-engine") },
  { key: "founder-storytelling", name: "Founder-led storytelling", kind: "fillable", lens: "peak", track: "idea",
    rooted: rootedTo("founder-storytelling") },
  { key: "bmi", name: "Business-model innovation", kind: "fillable", lens: "peak", track: "idea",
    rooted: rootedTo("bmi"),
    // Nothing roots here directly. Notion feeds this pillar only conditionally,
    // from two capture rows: pricing "only if the pricing counter-positions an
    // incumbent", and the financial model "only if the deal or pricing structure
    // is itself legacy-breaking". Both are judgment calls, so neither is rooted.
    note: "No capture row roots here. Read from pricing & packaging and the financial model, and only where either counter-positions an incumbent." },
];

export const TRACKS: Track[] = [
  { key: "idea", name: "Idea track", lens: "peak",
    rooted: rootedTo("idea"),
    note: "Peak of the pillar set — the strongest differentiation carries it. Read from the pillar slides, not from capture rows." },
  { key: "founder", name: "Founder/s track", lens: "weakest-link",
    rooted: rootedTo("founder"),
    note: "Weakest-link; the floor dimension is set by founder type." },
  { key: "market", name: "Market track", lens: "weakest-link",
    rooted: rootedTo("market"),
    note: "Read once Idea and Founder/s clear." },
];

export const CRITICAL_PILLARS = PILLARS.filter((p) => p.kind === "critical");
export const FILLABLE_PILLARS = PILLARS.filter((p) => p.kind === "fillable");
