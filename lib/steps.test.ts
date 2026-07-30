import { describe, expect, it } from "vitest";
import type { DealRecord, Observation } from "@/mock/types";
import { progressOf, stepsFor, viewsFor } from "./steps";

/**
 * The outstanding-work count, redefined (KTD19).
 *
 * Nothing waits in a queue any more — every observation files itself as
 * evidence — so status stopped being able to say what still needs a person.
 * What can is the pairing the confirm verb reads: low confidence with no
 * decider. These pin the cross product from the plan's observation state
 * table: only the unconfirmed low-confidence row counts; confirming it (which
 * sets the decider and nothing else) takes it out; high-confidence, rejected,
 * and legacy pre-confidence rows never count.
 */

let seq = 0;
const obs = (over: Partial<Observation> = {}): Observation => ({
  id: `o${++seq}`,
  dealId: "d1",
  callNumber: 1,
  rubricKey: "pt",
  subDimensionKey: "compounding-moat",
  quote: "…",
  status: "accepted",
  layer: "L1",
  ...over,
});

/** Only the fields progressOf reads; the rest of the record is irrelevant here. */
const record = (observations: Observation[]): DealRecord =>
  ({
    deal: { id: "d1" },
    calls: observations.length ? [{ number: 1 }] : [],
    observations,
    claims: [],
    scores: [],
    slides: [],
    founderTypeRead: undefined,
  }) as unknown as DealRecord;

describe("what counts as outstanding", () => {
  it("counts an unconfirmed low-confidence filing", () => {
    expect(progressOf(record([obs({ confidence: "low" })])).needsReview).toBe(1);
  });

  it("stops counting it once a person has ruled — the confidence itself stays", () => {
    const confirmed = obs({ confidence: "low", decidedById: "u1" });
    expect(progressOf(record([confirmed])).needsReview).toBe(0);
  });

  it("never counts a high-confidence filing", () => {
    expect(progressOf(record([obs({ confidence: "high" })])).needsReview).toBe(0);
  });

  it("never counts a rejected row, ruled on or not", () => {
    // Decider absent on purpose: rejection alone must be enough to leave the
    // count, since there is nothing on the row left to look at.
    const rejected = obs({ confidence: "low", status: "rejected" });
    expect(progressOf(record([rejected])).needsReview).toBe(0);
  });

  it("never counts a legacy pre-confidence draft — it was never marked unsure", () => {
    const legacy = obs({ status: "draft" });
    expect(progressOf(record([legacy])).needsReview).toBe(0);
  });

  it("reaches zero exactly when every unsure filing is confirmed", () => {
    const a = obs({ confidence: "low" });
    const b = obs({ confidence: "low" });
    const noise = [obs({ confidence: "high" }), obs({ status: "rejected", confidence: "low" })];

    expect(progressOf(record([a, b, ...noise])).needsReview).toBe(2);
    expect(
      progressOf(record([{ ...a, decidedById: "u1" }, b, ...noise])).needsReview,
    ).toBe(1);
    expect(
      progressOf(
        record([
          { ...a, decidedById: "u1" },
          { ...b, decidedById: "u2" },
          ...noise,
        ]),
      ).needsReview,
    ).toBe(0);
  });
});

describe("what the sidebar makes of it", () => {
  /**
   * Review left the numbered flow (R14). Nothing queues there any more, so
   * "step 2, then done" stopped being true of it — it is a reading of the
   * record now, like the floor and coverage, and the flow renumbers without it.
   */
  it("numbers the flow without review, consecutively", () => {
    const steps = stepsFor("d1", record([obs()]));
    expect(steps.map((s) => s.seg)).toEqual(["", "transcript", "capture", "judgment", "scorecard"]);
  });

  const reviewView = (rec: DealRecord) => viewsFor("d1", rec).find((v) => v.seg === "review")!;

  it("registers the extraction-quality reading among the views, never done", () => {
    // Like coverage (R20's reasoning): a quality reading must never read as a
    // gate, so `done` stays false even when nothing is left unconfirmed.
    expect(reviewView(record([obs({ confidence: "low" })])).done).toBe(false);
    expect(reviewView(record([obs({ confidence: "high" })])).done).toBe(false);
    expect(reviewView(record([])).done).toBe(false);
  });

  it("shows the unconfirmed count, and the none-form once everything is ruled on", () => {
    const unsure = obs({ confidence: "low" });

    const before = reviewView(record([unsure, obs({ confidence: "high" })]));
    expect(before.state).toBe("1 unconfirmed");

    const after = reviewView(
      record([{ ...unsure, decidedById: "u1" }, obs({ confidence: "high" })]),
    );
    expect(after.state).toBe("none unconfirmed");
  });
});
