import type { Lens } from "@/mock/types";

/**
 * The seven pillars of differentiation + three tracks (plan U2 / R9).
 * WORKING DRAFT from Notion "Idea — the differentiation" and "How the Capture
 * and Judgment connect?". Each carries its lens and the sub-dimension keys that
 * root to it; the per-deal 0–10 slide (banked/provisional/guard) lives in the
 * record, never here.
 */

export type PillarKind = "critical" | "fillable";

export interface RootedRef {
  subKey: string;
}

export interface Pillar {
  key: string;
  name: string;
  kind: PillarKind;
  lens: Lens;
  track: "idea";
  rooted: RootedRef[];
}

export interface Track {
  key: string;
  name: string;
  lens: Lens;
  rooted: RootedRef[];
  /** How the track is read, per the Notion connect table. */
  note: string;
}

export const PILLARS: Pillar[] = [
  { key: "earned-secret", name: "Earned secret", kind: "critical", lens: "peak", track: "idea",
    rooted: [{ subKey: "earned-insight" }] },
  { key: "foundational-tech", name: "Foundational tech", kind: "critical", lens: "peak", track: "idea",
    rooted: [{ subKey: "foundational-tech" }, { subKey: "scalability" }] },
  { key: "cornered-resource", name: "Cornered resource", kind: "critical", lens: "peak", track: "idea",
    rooted: [{ subKey: "defensibility" }] },
  { key: "privileged-distribution", name: "Privileged distribution", kind: "critical", lens: "peak", track: "idea",
    rooted: [{ subKey: "privileged-access" }] },
  { key: "gtm-engine", name: "GTM engine", kind: "fillable", lens: "weakest-link", track: "idea",
    rooted: [{ subKey: "icp-clarity" }, { subKey: "gtm-motion" }] },
  { key: "founder-storytelling", name: "Founder-led storytelling", kind: "fillable", lens: "peak", track: "idea",
    rooted: [{ subKey: "founder-narrative" }] },
  { key: "bmi", name: "Business-model innovation", kind: "fillable", lens: "peak", track: "idea",
    rooted: [{ subKey: "wedge" }] },
];

export const TRACKS: Track[] = [
  { key: "idea", name: "Idea track", lens: "peak",
    rooted: [{ subKey: "foundational-tech" }, { subKey: "earned-insight" }],
    note: "Peak of the pillar set — the strongest differentiation carries it." },
  { key: "founder", name: "Founder/s track", lens: "weakest-link",
    rooted: [{ subKey: "earned-insight" }, { subKey: "execution" }, { subKey: "coachability" }],
    note: "Weakest-link; the floor dimension is set by founder type." },
  { key: "market", name: "Market track", lens: "weakest-link",
    rooted: [{ subKey: "problem-severity" }, { subKey: "market-size" }],
    note: "Read once Idea and Founder/s clear." },
];

export const CRITICAL_PILLARS = PILLARS.filter((p) => p.kind === "critical");
export const FILLABLE_PILLARS = PILLARS.filter((p) => p.kind === "fillable");
