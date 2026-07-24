/**
 * Founder-type overlay (plan U2 / R11). WORKING DRAFT from Notion "Founder type
 * overlay". Context only at L1: the type sets the Founder-track floor dimension
 * and the expected-pillar profile. No go / conditional-go / no-go verdict at L1
 * (spec D3) — the verdict grid depends on gate logic (D1), which is Pending.
 */

export interface FounderTypeDef {
  key: string;
  label: string;
  /** Pillars the founder is expected to bring themselves. */
  expects: string[];
  /** Which sub-dimension the Founder-track floor reads on for this type. */
  floorDimension: string;
  blurb: string;
}

export const FOUNDER_TYPES: FounderTypeDef[] = [
  {
    key: "technical",
    label: "Technical",
    expects: ["Earned secret", "Foundational tech"],
    floorDimension: "earned-insight",
    blurb: "Brings the earned secret and the foundational tech. GTM engine and storytelling are studio-fillable.",
  },
  {
    key: "corporate",
    label: "Corporate / functional expert",
    expects: ["Privileged distribution", "Earned secret"],
    floorDimension: "privileged-access",
    blurb: "Brings privileged access and domain insight. Foundational tech may need a technical co-founder.",
  },
  {
    key: "serial",
    label: "Serial entrepreneur",
    expects: ["GTM engine", "Founder-led storytelling"],
    floorDimension: "execution",
    blurb: "Brings execution and narrative. The earned secret and foundational tech still have to be real.",
  },
];
