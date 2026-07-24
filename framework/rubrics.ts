import type { ScoreType } from "@/mock/types";

/**
 * The six assessment rubrics (plan U2 / R6).
 *
 * WORKING DRAFT — transcribed to the framework's shape from the Notion
 * "Assessment Rubrics", but this is a representative subset with paraphrased
 * anchor text, NOT the frozen rubric_v1. The real Notion grid is 41
 * sub-dimensions (7/7/7/7/7/6) with verbatim anchors; freeze it under spec D2
 * before pinning. Keys here are the join target for scores in /mock/data.ts.
 */

export type ScaleAnchors = { low: string; mid: string; high: string };
export type BinaryAnchors = { fail: string; unv: string; pass: string };

export interface SubDimension {
  key: string;
  label: string;
  type: ScoreType;
  /** Human label for what this roots to (pillar / track / floor / capture). */
  rootsTo: string;
  anchors: ScaleAnchors | BinaryAnchors;
  /** Binary hygiene row that forms the floor. */
  floor?: boolean;
  /** Kill-floor: a Fail (or floor value) drops the deal. */
  kill?: boolean;
  /** An open framework call (e.g. spec D5) worth surfacing at scoring time. */
  open?: string;
}

export interface Rubric {
  key: string;
  label: string;
  blurb: string;
  subs: SubDimension[];
}

export const RUBRICS: Rubric[] = [
  {
    key: "ft",
    label: "Founder & Team",
    blurb: "Who the founders are as builders and partners.",
    subs: [
      { key: "earned-insight", label: "Earned insight / secret", type: "scale", rootsTo: "Earned secret · Founder track",
        anchors: { low: "Generic market take, no lived exposure", mid: "Sector experience, secondhand insight", high: "Non-obvious insight only insiders hold, lived" } },
      { key: "execution", label: "Execution track record", type: "scale", rootsTo: "Founder track",
        anchors: { low: "Ideas, little shipped", mid: "Shipped inside a team", high: "Repeatedly shipped hard things end-to-end" } },
      { key: "founder-narrative", label: "Founder-led narrative", type: "scale", rootsTo: "Founder-led storytelling",
        anchors: { low: "Can't articulate the why", mid: "Clear, credible", high: "Magnetic — a recruiting & fundraising edge" } },
      { key: "coachability", label: "Coachability", type: "scale", rootsTo: "Founder track",
        anchors: { low: "Defensive, fixed", mid: "Listens, adapts slowly", high: "Seeks disconfirming input, updates fast" } },
      { key: "cofounder-dynamics", label: "Co-founder dynamics", type: "scale", rootsTo: "Founder track",
        anchors: { low: "Unclear roles, friction", mid: "Defined roles", high: "Complementary, tested under stress" },
        open: "D5 — own row vs folded under Coachability (no anchor text in Notion yet)" },
      { key: "ambition-fit", label: "Ambition & exit-type fit", type: "binary", rootsTo: "Floor (kill)", floor: true, kill: true,
        anchors: { fail: "Lifestyle / exit misaligned with venture scale", unv: "Ambition unclear", pass: "Venture-scale ambition, exit-type fit" } },
      { key: "tech-self-suff", label: "Engineering self-sufficiency", type: "binary", rootsTo: "Floor", floor: true,
        anchors: { fail: "No technical capacity, fully dependent", unv: "Partial", pass: "Can build the core without hiring the whole team" },
        open: "D5 — flag vs hard kill" },
    ],
  },
  {
    key: "pm",
    label: "Problem & Market",
    blurb: "The problem, its urgency, and the market and timing.",
    subs: [
      { key: "problem-severity", label: "Problem severity / urgency", type: "scale", rootsTo: "Market track",
        anchors: { low: "Nice-to-have", mid: "Real but tolerated", high: "Urgent, already budgeted pain" } },
      { key: "why-now", label: "Why now / catalyst", type: "scale", rootsTo: "Market track",
        anchors: { low: "No catalyst", mid: "Gradual shift", high: "Sharp enabling change, now" } },
      { key: "market-size", label: "Market size", type: "scale", rootsTo: "Capture",
        anchors: { low: "Niche, capped", mid: "Sizable segment", high: "Large and expanding" },
        open: "D5 — scored here vs moved to hygiene" },
      { key: "wedge", label: "Wedge / beachhead", type: "scale", rootsTo: "Market track · GTM",
        anchors: { low: "Undefined entry", mid: "Plausible wedge", high: "Sharp wedge into a beachhead" } },
    ],
  },
  {
    key: "pt",
    label: "Product / Tech & Solution",
    blurb: "What is built, how it works, how it scales.",
    subs: [
      { key: "foundational-tech", label: "Foundational tech depth", type: "scale", rootsTo: "Foundational tech (pillar)",
        anchors: { low: "Thin wrapper on commodity parts", mid: "Solid engineering, replicable", high: "Hard technical moat, years to copy" } },
      { key: "defensibility", label: "Defensibility", type: "scale", rootsTo: "Cornered resource (pillar)",
        anchors: { low: "No lock-in", mid: "Some switching cost", high: "Compounding advantage" } },
      { key: "scalability", label: "Scalability", type: "scale", rootsTo: "Capture",
        anchors: { low: "Manual, breaks with scale", mid: "Scales with effort", high: "Architected to scale cleanly" } },
      { key: "maturity", label: "Product maturity", type: "scale", rootsTo: "Capture",
        anchors: { low: "Concept", mid: "Working prototype", high: "In production with users" } },
    ],
  },
  {
    key: "gtm",
    label: "GTM & Distribution Access",
    blurb: "Who buys, and how they are sold to and reached.",
    subs: [
      { key: "privileged-access", label: "Privileged distribution access", type: "scale", rootsTo: "Privileged distribution (pillar)",
        anchors: { low: "Cold, no access", mid: "Some warm intros", high: "Owned channel / privileged access" } },
      { key: "icp-clarity", label: "ICP clarity", type: "scale", rootsTo: "GTM engine (pillar)",
        anchors: { low: "Vague ICP", mid: "Defined ICP", high: "Sharp ICP with proof" } },
      { key: "gtm-motion", label: "Repeatable GTM motion", type: "scale", rootsTo: "GTM engine (pillar)",
        anchors: { low: "No repeatable motion", mid: "Early signs", high: "Repeatable, efficient motion" } },
      { key: "sales-efficiency", label: "Sales efficiency", type: "binary", rootsTo: "Capture",
        anchors: { fail: "Burns to acquire", unv: "Unproven", pass: "Efficient at this stage" } },
    ],
  },
  {
    key: "fl",
    label: "Financial & Legal",
    blurb: "Capital, cap table, structure, and compliance.",
    subs: [
      { key: "cap-table-health", label: "Cap-table health", type: "binary", rootsTo: "Floor (kill)", floor: true, kill: true,
        anchors: { fail: "Broken cap table / dead equity", unv: "Some concerns", pass: "Clean, investable cap table" } },
      { key: "runway", label: "Runway & burn", type: "binary", rootsTo: "Floor", floor: true,
        anchors: { fail: "<3mo, no plan", unv: "Tight", pass: "Adequate runway / plan" } },
      { key: "ip-boundary", label: "Prior-employer IP boundary", type: "binary", rootsTo: "Floor", floor: true,
        anchors: { fail: "Clear prior-employer IP conflict", unv: "Unresolved boundary — flagged", pass: "Clean IP ownership" },
        open: "D5 — advance-with-condition vs hold at G1" },
      { key: "regulatory", label: "Regulatory exposure", type: "scale", rootsTo: "Capture",
        anchors: { low: "Blocking regulatory risk", mid: "Manageable", high: "Clear / low" } },
    ],
  },
  {
    key: "sf",
    label: "Studio Fit & Co-Develop",
    blurb: "Whether Biome is the right builder for this.",
    subs: [
      { key: "thesis-fit", label: "Studio thesis fit", type: "scale", rootsTo: "Idea track · Studio fit",
        anchors: { low: "Off-thesis", mid: "Adjacent", high: "Dead-centre thesis" } },
      { key: "codev-leverage", label: "Co-development leverage", type: "scale", rootsTo: "Fillable pillars",
        anchors: { low: "Studio adds little", mid: "Some leverage", high: "Studio meaningfully accelerates" } },
      { key: "terms-fit", label: "Ownership / terms fit", type: "binary", rootsTo: "Floor",
        anchors: { fail: "Terms unworkable", unv: "Open", pass: "Workable ownership / terms" } },
    ],
  },
];
