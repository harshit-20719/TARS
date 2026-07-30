import { describe, expect, it } from "vitest";
import { RUBRICS } from "@/framework";
import type { DraftClaim, DraftObservation } from "./types";
import { anchorKey, compareFilings, dedupeSpans, normaliseForComparison } from "./dedupe";

/**
 * KTD10: one span, one row. The pass keys on the normalised quote alone, the
 * higher-confidence filing wins, and a tie breaks on rubric order so the same
 * input always survives the same way. Dropping the cross-row copies is the
 * point — evidence is structured MECE — but a claim anchored to a losing
 * filing is repointed to the winner rather than orphaned (KTD11), because the
 * claim ledger is what L2 verifies against.
 */

// The keys are taken from RUBRICS rather than hard-coded, because the tie rule
// under test is "earlier in RUBRICS order", not "ft beats pt".
const EARLIER = RUBRICS[0].key;
const LATER = RUBRICS[2].key;

const obs = (o: Partial<DraftObservation> & { quote: string }): DraftObservation => ({
  rubricKey: EARLIER,
  subDimensionKey: "row-a",
  speaker: null,
  timestamp: null,
  confidence: "high",
  mappingNote: "why this row",
  ...o,
});

const claim = (c: Partial<DraftClaim> & { anchorQuote: string }): DraftClaim => ({
  text: "The founder asserts a thing.",
  originTag: "founder-volunteered",
  rubricKey: EARLIER,
  ...c,
});

const Q = "Our matcher runs continuously instead of as a nightly batch job.";

describe("dedupeSpans", () => {
  it("keeps the higher-confidence filing when two blocks return the same span", () => {
    const low = obs({ quote: Q, rubricKey: EARLIER, confidence: "low" });
    const high = obs({ quote: Q, rubricKey: LATER, confidence: "high" });

    const r = dedupeSpans({ observations: [low, high], claims: [] });

    expect(r.observations).toEqual([high]);
    expect(r.merges).toEqual([
      { quote: normaliseForComparison(Q), losingRubricKey: EARLIER, winningRubricKey: LATER },
    ]);
    expect(r.mergedByBlock).toEqual({ [EARLIER]: 1 });
  });

  it("breaks an equal-confidence tie on rubric order, whatever order the filings arrive", () => {
    const earlier = obs({ quote: Q, rubricKey: EARLIER });
    const later = obs({ quote: Q, rubricKey: LATER });

    const oneWay = dedupeSpans({ observations: [earlier, later], claims: [] });
    const otherWay = dedupeSpans({ observations: [later, earlier], claims: [] });

    // The outcome is a property of the filings, not of arrival order.
    expect(oneWay.observations).toEqual([earlier]);
    expect(otherWay.observations).toEqual([earlier]);
    expect(oneWay.mergedByBlock).toEqual({ [LATER]: 1 });
    expect(otherWay.mergedByBlock).toEqual({ [LATER]: 1 });
  });

  it("repoints a claim anchored to the losing filing rather than dropping it", () => {
    const loser = obs({ quote: Q, rubricKey: EARLIER, confidence: "low" });
    const winner = obs({ quote: Q, rubricKey: LATER, confidence: "high" });
    const anchored = claim({ anchorQuote: Q, rubricKey: EARLIER });

    const r = dedupeSpans({ observations: [loser, winner], claims: [anchored] });

    expect(r.claims).toHaveLength(1);
    // Re-keyed to the surviving filing, so the anchor map still finds it.
    expect(r.claims[0].rubricKey).toBe(LATER);
    expect(r.claims[0].anchorQuote).toBe(Q);
    expect(r.claims[0].text).toBe(anchored.text);
  });

  it("leaves a claim anchored to the surviving filing untouched", () => {
    const winner = obs({ quote: Q, rubricKey: EARLIER });
    const anchored = claim({ anchorQuote: Q, rubricKey: EARLIER });

    const r = dedupeSpans({ observations: [winner], claims: [anchored] });

    expect(r.claims).toEqual([anchored]);
    expect(r.merges).toEqual([]);
  });

  it("keeps two distinct spans from one block filed against different rows", () => {
    const a = obs({ quote: "Span the first.", rubricKey: LATER, subDimensionKey: "row-a" });
    const b = obs({ quote: "Span the second.", rubricKey: LATER, subDimensionKey: "row-b" });

    const r = dedupeSpans({ observations: [a, b], claims: [] });

    expect(r.observations).toEqual([a, b]);
    expect(r.merges).toEqual([]);
    expect(r.mergedByBlock).toEqual({});
  });

  it("collapses the same span returned twice by one block to one filing", () => {
    const first = obs({ quote: Q, rubricKey: LATER, subDimensionKey: "row-a" });
    const second = obs({ quote: Q, rubricKey: LATER, subDimensionKey: "row-b" });

    const r = dedupeSpans({ observations: [first, second], claims: [] });

    expect(r.observations).toEqual([first]);
    expect(r.mergedByBlock).toEqual({ [LATER]: 1 });
  });

  it("prefers the confident filing within a block too", () => {
    const unsure = obs({ quote: Q, rubricKey: LATER, confidence: "low" });
    const sure = obs({ quote: Q, rubricKey: LATER, confidence: "high" });

    const r = dedupeSpans({ observations: [unsure, sure], claims: [] });

    expect(r.observations).toEqual([sure]);
  });

  it("treats typographic variants of one span as one span", () => {
    // The same words; a transcript wrap and a curly apostrophe do not make a
    // second span. This is the verbatim guard's normalisation, reused — one
    // definition of "the same", not two.
    const straight = obs({ quote: "they'll run  a paid pilot", rubricKey: EARLIER });
    const curly = obs({ quote: "they’ll run a paid pilot", rubricKey: LATER });

    const r = dedupeSpans({ observations: [straight, curly], claims: [] });

    expect(r.observations).toHaveLength(1);
    expect(r.merges).toHaveLength(1);
  });
});

describe("compareFilings", () => {
  it("ranks high confidence above low, whichever block filed it", () => {
    expect(
      compareFilings(
        { rubricKey: LATER, confidence: "high" },
        { rubricKey: EARLIER, confidence: "low" },
      ),
    ).toBeLessThan(0);
  });

  it("ranks a null confidence below a stated low", () => {
    // A row written before the confidence column existed cannot claim to be
    // surer than a filing that says "low" out loud.
    expect(
      compareFilings(
        { rubricKey: EARLIER, confidence: null },
        { rubricKey: LATER, confidence: "low" },
      ),
    ).toBeGreaterThan(0);
  });

  it("falls back to rubric order on a confidence tie", () => {
    expect(
      compareFilings(
        { rubricKey: EARLIER, confidence: "high" },
        { rubricKey: LATER, confidence: "high" },
      ),
    ).toBeLessThan(0);
  });
});

describe("anchorKey", () => {
  it("normalises the quote and carries the block", () => {
    expect(anchorKey("ft", "a  b’s span")).toBe(anchorKey("ft", "a b's span"));
    expect(anchorKey("ft", Q)).not.toBe(anchorKey("pt", Q));
  });
});
