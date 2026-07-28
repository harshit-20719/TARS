import type {
  Deal,
  DealRecord,
  Observation,
  Claim,
  SubDimensionScore,
  Slide,
  FounderTypeRead,
  Call,
  CallMeta,
} from "./types";

/**
 * Mock data layer. Fictional deals; the shapes are the real record types
 * (mock/types.ts), so the UI reads exactly what a Prisma-backed repository
 * will return later (plan U3). Swap this module's getters for DB reads and
 * nothing in the UI changes.
 */

export const DEALS: Deal[] = [
  { id: "halten", company: "Halten", oneLiner: "Real-time reconciliation ledger for mid-market banks.",
    founders: "Aparna Rao · Daniel Okafor", ownerPm: "You", opened: "22 Jul 2026", layer: "L1" },
  { id: "cirrus", company: "Cirrus Loop", oneLiner: "Grid-edge battery orchestration for C&I sites.",
    founders: "Meera Iyer", ownerPm: "You", opened: "19 Jul 2026", layer: "L1" },
  { id: "parch", company: "Parch", oneLiner: "Underwriting copilot for specialty insurers.",
    founders: "Sam Vale · Nikhil Rao", ownerPm: "You", opened: "12 Jul 2026", layer: "L1" },
];

const HALTEN_TRANSCRIPT = `[00:02] Aparna (CEO): We spent four years inside mid-market bank operations. The reconciliation break that actually costs them happens at settlement cutover — and nobody models it, because you only ever see it from inside the back office.
[00:05] Daniel (CTO): The ledger engine we built reconciles the streaming feed and the batch file in a single pass. Every existing tool forces a nightly job; ours runs continuously, so a break surfaces in seconds, not the next morning.
[00:09] Aparna: Two of the banks we worked with directly have already told us they'll run a paid pilot. We have the head of operations at both of them on side.
[00:12] Daniel: I led the ledger infrastructure team at my last company for five years, so the hard part — the deterministic replay — is something we've already shipped once at scale.
[00:16] Aparna: We're both full-time, incorporated clean, and there's no overlap with our previous employer's IP — though the boundary is something we should walk through with you properly.
[00:20] PM: How do you think about pricing?
[00:21] Aparna: Per reconciled account, tiered. We think there's a platform play underneath it, but the wedge is the settlement break.`;

const HALTEN_CALLS: Call[] = [
  { id: "call1", dealId: "halten", number: 1, label: "First founder call", date: "22 Jul 2026",
    transcript: HALTEN_TRANSCRIPT, extracted: true },
];

const HALTEN_OBS: Observation[] = [
  { id: "o1", dealId: "halten", callNumber: 1, rubricKey: "pm", subDimensionKey: "problem-intensity",
    quote: "The reconciliation break that actually costs them happens at settlement cutover — nobody models it because you only see it from inside the back office.", speaker: "Aparna", timestamp: "00:02", status: "accepted", layer: "L1" },
  { id: "o2", dealId: "halten", callNumber: 1, rubricKey: "ft", subDimensionKey: "earned-insight",
    quote: "We spent four years inside mid-market bank operations.", speaker: "Aparna", timestamp: "00:02", status: "accepted", layer: "L1" },
  { id: "o3", dealId: "halten", callNumber: 1, rubricKey: "pm", subDimensionKey: "competitive-landscape",
    quote: "Every existing tool forces a nightly job; ours runs continuously, so a break surfaces in seconds.", speaker: "Daniel", timestamp: "00:05", status: "accepted", layer: "L1" },
  { id: "o4", dealId: "halten", callNumber: 1, rubricKey: "ft", subDimensionKey: "track-record",
    quote: "I led the ledger infrastructure team at my last company for five years — the deterministic replay is something we've shipped once at scale.", speaker: "Daniel", timestamp: "00:12", status: "accepted", layer: "L1" },
  { id: "o5", dealId: "halten", callNumber: 1, rubricKey: "pt", subDimensionKey: "foundational-tech",
    quote: "The ledger engine reconciles the streaming feed and the batch file in a single pass.", speaker: "Daniel", timestamp: "00:05", status: "accepted", layer: "L1" },
  { id: "o6", dealId: "halten", callNumber: 1, rubricKey: "pt", subDimensionKey: "foundational-tech",
    quote: "The hard part — the deterministic replay — we've already shipped once at scale.", speaker: "Daniel", timestamp: "00:12", status: "accepted", layer: "L1" },
  { id: "o7", dealId: "halten", callNumber: 1, rubricKey: "gtm", subDimensionKey: "privileged-access",
    quote: "Two of the banks we worked with have already told us they'll run a paid pilot. We have the head of operations at both on side.", speaker: "Aparna", timestamp: "00:09", status: "accepted", layer: "L1" },
  { id: "o8", dealId: "halten", callNumber: 1, rubricKey: "ft", subDimensionKey: "coachability",
    quote: "The boundary is something we should walk through with you properly.", speaker: "Aparna", timestamp: "00:16", status: "accepted", layer: "L1" },
  { id: "o9", dealId: "halten", callNumber: 1, rubricKey: "fl", subDimensionKey: "ip-ownership",
    quote: "We're both full-time, incorporated clean, and there's no overlap with our previous employer's IP — though the boundary is worth walking through.", speaker: "Aparna", timestamp: "00:16", status: "accepted", layer: "L1" },
  { id: "o10", dealId: "halten", callNumber: 1, rubricKey: "gtm", subDimensionKey: "pricing-packaging",
    quote: "Per reconciled account, tiered. We think there's a platform play underneath it, but the wedge is the settlement break.", speaker: "Aparna", timestamp: "00:21", status: "edited", layer: "L1" },
  { id: "o11", dealId: "halten", callNumber: 1, rubricKey: "pt", subDimensionKey: "wedge",
    quote: "We think there's a platform play underneath it.", speaker: "Aparna", timestamp: "00:21", status: "draft", layer: "L1" },
  { id: "o12", dealId: "halten", callNumber: 1, rubricKey: "sf", subDimensionKey: "founder-commitment",
    quote: "We're both full-time.", speaker: "Aparna", timestamp: "00:16", status: "rejected", layer: "L1" },
];

const HALTEN_CLAIMS: Claim[] = [
  { id: "c1", dealId: "halten", text: "Two banks have verbally committed to a paid pilot.", originTag: "founder-volunteered", anchorObsId: "o7", status: "claimed" },
  { id: "c2", dealId: "halten", text: "The ledger engine reconciles streaming + batch in a single continuous pass.", originTag: "founder-volunteered", anchorObsId: "o5", status: "claimed" },
  { id: "c3", dealId: "halten", text: "Deterministic replay was already shipped at scale at Daniel's prior company.", originTag: "founder-volunteered", anchorObsId: "o4", status: "claimed" },
  { id: "c4", dealId: "halten", text: "No overlap with previous-employer IP.", originTag: "founder-confirmed-after-PM-framing", anchorObsId: "o9", status: "claimed" },
  { id: "c5", dealId: "halten", text: "A platform layer exists beneath the settlement-break wedge.", originTag: "machine-inferred", anchorObsId: "o11", status: "claimed" },
];

/**
 * One call in, so six of the forty-one rows are unscored — which is the normal
 * outcome of a first call, not a gap in the fixture. Silence on a row is not
 * evidence, and the grid shows the hole rather than filling it.
 */
const HALTEN_SCORES: SubDimensionScore[] = [
  { dealId: "halten", subDimensionKey: "earned-insight", scoreType: "scale", value: 5, evidenceObsIds: ["o2"], layer: "L1" },
  // learning-rate: unscored — one call shows no movement between calls yet.
  { dealId: "halten", subDimensionKey: "track-record", scoreType: "scale", value: 4, evidenceObsIds: ["o4"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "coachability", scoreType: "scale", value: 4, evidenceObsIds: ["o8"], layer: "L1" },
  // drive-resilience: unscored — no adversity story on this call.
  { dealId: "halten", subDimensionKey: "communication", scoreType: "scale", value: 4, evidenceObsIds: ["o1"], layer: "L1" },
  // Ambition & exit-type fit is a 1–5 row the framework kills at 1, not a binary.
  { dealId: "halten", subDimensionKey: "ambition-fit", scoreType: "scale", value: 3, evidenceObsIds: [], layer: "L1" }, // incomplete (no evidence)

  { dealId: "halten", subDimensionKey: "problem-intensity", scoreType: "scale", value: 5, evidenceObsIds: ["o1"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "problem-validation", scoreType: "scale", value: 4, evidenceObsIds: ["o7"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "why-now", scoreType: "scale", value: 3, evidenceObsIds: [], layer: "L1" }, // incomplete
  { dealId: "halten", subDimensionKey: "willingness-to-pay", scoreType: "scale", value: 3, evidenceObsIds: ["o7"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "root-cause", scoreType: "scale", value: 4, evidenceObsIds: ["o1"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "market-size", scoreType: "scale", value: 3, evidenceObsIds: [], layer: "L1" }, // incomplete
  { dealId: "halten", subDimensionKey: "competitive-landscape", scoreType: "scale", value: 3, evidenceObsIds: ["o3"], layer: "L1" },

  { dealId: "halten", subDimensionKey: "problem-solution-fit", scoreType: "scale", value: 4, evidenceObsIds: ["o5"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "foundational-tech", scoreType: "scale", value: 5, evidenceObsIds: ["o5", "o6"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "compounding-moat", scoreType: "scale", value: "NE", evidenceObsIds: ["o6"], layer: "L1" }, // NE distinct from 1
  // time-to-value: unscored
  { dealId: "halten", subDimensionKey: "architecture", scoreType: "scale", value: 4, evidenceObsIds: ["o5"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "wedge", scoreType: "scale", value: 4, evidenceObsIds: ["o10"], layer: "L1" },
  // product-state: unscored

  { dealId: "halten", subDimensionKey: "selling-motion", scoreType: "scale", value: 2, evidenceObsIds: ["o7"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "icp-precision", scoreType: "scale", value: 4, evidenceObsIds: ["o7"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "buying-unit", scoreType: "scale", value: 4, evidenceObsIds: ["o7"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "privileged-access", scoreType: "scale", value: 5, evidenceObsIds: ["o7"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "access-credibility", scoreType: "scale", value: 4, evidenceObsIds: ["o7"], layer: "L1" },
  // channel-reach: unscored
  { dealId: "halten", subDimensionKey: "pricing-packaging", scoreType: "scale", value: 3, evidenceObsIds: ["o10"], layer: "L1" },

  { dealId: "halten", subDimensionKey: "capital-cleanliness", scoreType: "binary", value: "unv", evidenceObsIds: [], layer: "L1" }, // incomplete
  // Advance-with-condition, with the condition written out — a flagged score whose
  // note is missing is a state the service refuses, so the fixture must not model one.
  { dealId: "halten", subDimensionKey: "ip-ownership", scoreType: "binary", value: "unv", evidenceObsIds: ["o9"], flag: true, flagNote: "Prior-employer IP boundary confirmed in writing before term sheet.", layer: "L1" },
  { dealId: "halten", subDimensionKey: "india-incorporation", scoreType: "binary", value: "pass", evidenceObsIds: ["o9"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "regulated-readiness", scoreType: "binary", value: "unv", evidenceObsIds: [], layer: "L1" }, // incomplete
  // Cap-table health is the other 1–5 row with a kill at 1.
  { dealId: "halten", subDimensionKey: "cap-table-health", scoreType: "scale", value: 3, evidenceObsIds: [], layer: "L1" }, // incomplete
  { dealId: "halten", subDimensionKey: "capital-efficiency", scoreType: "scale", value: 3, evidenceObsIds: [], layer: "L1" }, // incomplete
  // financial-model: unscored

  { dealId: "halten", subDimensionKey: "studio-alignment", scoreType: "binary", value: "unv", evidenceObsIds: [], layer: "L1" }, // incomplete
  { dealId: "halten", subDimensionKey: "eng-self-sufficiency", scoreType: "binary", value: "pass", evidenceObsIds: ["o4"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "founder-commitment", scoreType: "binary", value: "pass", evidenceObsIds: ["o9"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "structural-fit", scoreType: "binary", value: "pass", evidenceObsIds: [], layer: "L1" }, // incomplete
  { dealId: "halten", subDimensionKey: "fillable-gap-fit", scoreType: "scale", value: 4, evidenceObsIds: ["o10"], layer: "L1" },
  { dealId: "halten", subDimensionKey: "codev-willingness", scoreType: "scale", value: 4, evidenceObsIds: ["o8"], layer: "L1" },
];

const HALTEN_SLIDES: Slide[] = [
  { dealId: "halten", slideKey: "earned-secret", value: 6, provisionalValue: 8, lens: "peak", layer: "L1",
    ceilingGuard: "Peak: earned insight (5) sets the ceiling. Banked at the L1 cap until the sector-insight claim verifies at L2." },
  { dealId: "halten", slideKey: "foundational-tech", value: 6, provisionalValue: 8, lens: "peak", layer: "L1",
    ceilingGuard: "Deterministic-replay depth (5) sets the ceiling; banked at cap pending a technical verify of the single-pass claim." },
  { dealId: "halten", slideKey: "cornered-resource", value: 3, lens: "peak", layer: "L1",
    ceilingGuard: "Compounding moat not yet evidenced (NE) — nothing cornered banked beyond the customer relationships." },
  { dealId: "halten", slideKey: "privileged-distribution", value: 5, provisionalValue: 7, lens: "peak", layer: "L1",
    ceilingGuard: "Access (5) sets the read; credibility to convert it (4) is stated, so banked below cap until a pilot is contracted." },
  { dealId: "halten", slideKey: "gtm-engine", value: 3, lens: "weakest-link", layer: "L1",
    ceilingGuard: "Weakest-link: no repeatable selling motion yet (2) caps the engine, despite a sharp ICP and buying unit (4). Studio-fillable." },
  { dealId: "halten", slideKey: "founder-storytelling", value: 5, provisionalValue: 6, lens: "peak", layer: "L1",
    ceilingGuard: "Communication & storytelling (4) sets the ceiling; banked at 5, upside if the platform story sharpens." },
  { dealId: "halten", slideKey: "bmi", value: 4, lens: "peak", layer: "L1",
    ceilingGuard: "No capture row roots here; read from pricing & packaging (3), which does not counter-position an incumbent. Conventional at L1." },
  { dealId: "halten", slideKey: "idea", value: 6, provisionalValue: 8, lens: "peak", layer: "L1",
    ceilingGuard: "Peak of the pillar set: foundational tech and earned secret both at the L1 ceiling. Two critical pillars exceptional." },
  { dealId: "halten", slideKey: "founder", value: 5, lens: "weakest-link", layer: "L1",
    ceilingGuard: "Weakest-link: ambition & exit-type fit (3, no evidence) caps the track; learning rate and drive unscored after one call." },
  { dealId: "halten", slideKey: "market", value: 5, lens: "weakest-link", layer: "L1",
    ceilingGuard: "Read after idea & founder cleared. Severe, validated problem (5/4), but willingness to pay (3) caps the track." },
];

const HALTEN_FOUNDER_TYPE: FounderTypeRead = {
  dealId: "halten",
  primary: "Technical",
  secondary: "Corporate / functional expert",
  profile: "Must bring earned secret + foundational tech. GTM engine and business-model innovation are studio-fillable.",
  floorDimension: "earned-insight",
  pmConfirmation: "Confirmed — Aparna carries the earned secret, Daniel the foundational tech. Classic technical + domain pair; Founder-track floor reads on earned insight.",
};

// --- Cirrus Loop: transcript in, partial scoring, no slides yet ---
const CIRRUS_OBS: Observation[] = [
  { id: "co1", dealId: "cirrus", callNumber: 1, rubricKey: "pm", subDimensionKey: "problem-intensity",
    quote: "C&I sites are getting hit with demand charges they can't predict; the battery just sits idle at the wrong moments.", speaker: "Meera", timestamp: "00:03", status: "accepted", layer: "L1" },
  { id: "co2", dealId: "cirrus", callNumber: 1, rubricKey: "pt", subDimensionKey: "foundational-tech",
    quote: "Our controller re-forecasts every ninety seconds and re-dispatches — most orchestration is hourly.", speaker: "Meera", timestamp: "00:07", status: "accepted", layer: "L1" },
  { id: "co3", dealId: "cirrus", callNumber: 1, rubricKey: "ft", subDimensionKey: "track-record",
    quote: "I built the dispatch stack at a grid-scale storage operator before this.", speaker: "Meera", timestamp: "00:11", status: "draft", layer: "L1" },
  { id: "co4", dealId: "cirrus", callNumber: 1, rubricKey: "gtm", subDimensionKey: "privileged-access",
    quote: "I don't have warm access to the installers yet — that's the open question.", speaker: "Meera", timestamp: "00:15", status: "accepted", layer: "L1" },
];

const CIRRUS_SCORES: SubDimensionScore[] = [
  { dealId: "cirrus", subDimensionKey: "problem-intensity", scoreType: "scale", value: 4, evidenceObsIds: ["co1"], layer: "L1" },
  { dealId: "cirrus", subDimensionKey: "foundational-tech", scoreType: "scale", value: 4, evidenceObsIds: ["co2"], layer: "L1" },
  // Scored off a draft observation, so it carries no citable evidence yet.
  { dealId: "cirrus", subDimensionKey: "track-record", scoreType: "scale", value: 4, evidenceObsIds: [], layer: "L1" },
  { dealId: "cirrus", subDimensionKey: "privileged-access", scoreType: "scale", value: 2, evidenceObsIds: ["co4"], layer: "L1" },
  { dealId: "cirrus", subDimensionKey: "cap-table-health", scoreType: "scale", value: 3, evidenceObsIds: [], layer: "L1" },
  { dealId: "cirrus", subDimensionKey: "ambition-fit", scoreType: "scale", value: 3, evidenceObsIds: [], layer: "L1" },
];

const CIRRUS_CLAIMS: Claim[] = [
  { id: "cc1", dealId: "cirrus", text: "The controller re-forecasts and re-dispatches every 90 seconds.", originTag: "founder-volunteered", anchorObsId: "co2", status: "claimed" },
];

const CIRRUS_FOUNDER_TYPE: FounderTypeRead = {
  dealId: "cirrus",
  primary: "Technical",
  profile: "Solo technical founder; distribution is the open gap the studio may fill.",
  floorDimension: "earned-insight",
  pmConfirmation: "Draft — solo technical founder, distribution unproven. Not yet confirmed.",
};

const EMPTY_FOUNDER_TYPE = (dealId: string): FounderTypeRead => ({
  dealId,
  primary: "",
  profile: "",
  floorDimension: "",
  pmConfirmation: "",
});

/**
 * The fixture calls with their transcripts.
 *
 * Kept separately from the records because the record contract carries call
 * *metadata* only — the transcripts are the largest thing on a deal and only the
 * transcript page reads them. The seed writes from here; the records below expose
 * the metadata derived from it, so there is still one source for both.
 */
export const FIXTURE_CALLS: Record<string, Call[]> = {
  halten: HALTEN_CALLS,
  cirrus: [
    {
      id: "ccall1",
      dealId: "cirrus",
      number: 1,
      label: "First founder call",
      date: "19 Jul 2026",
      transcript:
        "[00:03] Meera: C&I sites are getting hit with demand charges they can't predict...",
      extracted: true,
    },
  ],
  parch: [],
};

const metaOf = (dealId: string): CallMeta[] =>
  (FIXTURE_CALLS[dealId] ?? []).map(({ transcript, ...rest }) => ({
    ...rest,
    transcriptChars: transcript.length,
  }));

const RECORDS: Record<string, DealRecord> = {
  halten: {
    deal: DEALS[0],
    calls: metaOf("halten"),
    observations: HALTEN_OBS,
    claims: HALTEN_CLAIMS,
    scores: HALTEN_SCORES,
    slides: HALTEN_SLIDES,
    founderTypeRead: HALTEN_FOUNDER_TYPE,
  },
  cirrus: {
    deal: DEALS[1],
    calls: metaOf("cirrus"),
    observations: CIRRUS_OBS,
    claims: CIRRUS_CLAIMS,
    scores: CIRRUS_SCORES,
    slides: [],
    founderTypeRead: CIRRUS_FOUNDER_TYPE,
  },
  parch: {
    deal: DEALS[2],
    calls: metaOf("parch"),
    observations: [],
    claims: [],
    scores: [],
    slides: [],
    founderTypeRead: EMPTY_FOUNDER_TYPE("parch"),
  },
};

export function listDeals(): Deal[] {
  return DEALS;
}

export function getDeal(id: string): Deal | undefined {
  return DEALS.find((d) => d.id === id);
}

export function getRecord(id: string): DealRecord | undefined {
  return RECORDS[id];
}
