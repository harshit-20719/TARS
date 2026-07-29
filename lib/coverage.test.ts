import { describe, expect, it } from "vitest";
import { ALL_SUBS, TOTAL_SUBS } from "@/framework";
import type { DealRecord, Observation } from "@/mock/types";
import {
  candidateEvidenceBySubDimension,
  coverageOf,
  observationsBySubDimension,
  unevidencedCount,
} from "./coverage";

/**
 * Coverage reads evidence, not questions.
 *
 * The record knows whether a quote was mapped to a row. It cannot know whether a
 * question was asked — a founder can answer at length and yield nothing mappable
 * — so the three states are named for what is actually recorded.
 *
 * The distinction the unit exists for is between a row nobody has evidence on and
 * a row whose evidence the PM threw out. Both render as empty on the capture grid
 * today; they are two entirely different conversations on the next call.
 */

const SUB_A = ALL_SUBS[0].key;
const SUB_B = ALL_SUBS[1].key;
const SUB_C = ALL_SUBS[2].key;

let seq = 0;
const obs = (over: Partial<Observation> = {}): Observation => ({
  id: `o${++seq}`,
  dealId: "d1",
  callNumber: 1,
  rubricKey: ALL_SUBS[0].rubricKey,
  subDimensionKey: SUB_A,
  quote: "…",
  status: "accepted",
  layer: "L1",
  ...over,
});

/** Only the fields coverage reads; the rest of the record is irrelevant to it. */
const record = (observations: Observation[], callNumbers: number[] = [1]): DealRecord =>
  ({
    deal: { id: "d1" },
    calls: callNumbers.map((number) => ({ number })),
    observations,
    claims: [],
    scores: [],
    slides: [],
    founderTypeRead: undefined,
  }) as unknown as DealRecord;

const stateOf = (rec: DealRecord, key: string) =>
  coverageOf(rec).rows.find((r) => r.key === key)?.state;

describe("the three states", () => {
  it("reads one accepted observation as evidence held", () => {
    expect(stateOf(record([obs()]), SUB_A)).toBe("has-evidence");
  });

  // AE6. The whole point of the unit: these two must not look the same.
  it("distinguishes evidence rejected from no evidence recorded", () => {
    const rec = record([
      obs({ subDimensionKey: SUB_A, status: "rejected" }),
      obs({ subDimensionKey: SUB_A, status: "rejected" }),
    ]);
    expect(stateOf(rec, SUB_A)).toBe("evidence-rejected");
    expect(stateOf(rec, SUB_B)).toBe("no-evidence");
    expect(stateOf(rec, SUB_A)).not.toBe(stateOf(rec, SUB_B));
  });

  it("reads a row with one rejected and one accepted as evidence held", () => {
    const rec = record([
      obs({ subDimensionKey: SUB_A, status: "rejected" }),
      obs({ subDimensionKey: SUB_A, status: "accepted" }),
    ]);
    expect(stateOf(rec, SUB_A)).toBe("has-evidence");
  });

  // A draft is pending review, not refused. Counting it as no-evidence would tell
  // a PM to go and ask again about something already sitting in their queue.
  it("counts a draft as evidence", () => {
    expect(stateOf(record([obs({ status: "draft" })]), SUB_A)).toBe("has-evidence");
  });

  it("counts an edited observation as evidence", () => {
    expect(stateOf(record([obs({ status: "edited" })]), SUB_A)).toBe("has-evidence");
  });
});

describe("the shape of the reading", () => {
  it("returns every sub-dimension in the framework, not only the mentioned ones", () => {
    const rows = coverageOf(record([obs()])).rows;
    expect(rows).toHaveLength(TOTAL_SUBS);
    expect(new Set(rows.map((r) => r.key)).size).toBe(TOTAL_SUBS);
    for (const s of ALL_SUBS) expect(rows.some((r) => r.key === s.key)).toBe(true);
  });

  it("returns every row as no-evidence for a deal with no calls", () => {
    const rec = record([], []);
    const reading = coverageOf(rec);
    expect(reading.rows.every((r) => r.state === "no-evidence")).toBe(true);
    expect(reading.unevidenced).toBe(TOTAL_SUBS);
  });

  it("groups rows by rubric, covering all six with none lost", () => {
    const reading = coverageOf(record([obs()]));
    expect(reading.byRubric).toHaveLength(6);
    expect(reading.byRubric.flatMap((g) => g.rows)).toHaveLength(TOTAL_SUBS);
    for (const group of reading.byRubric) {
      expect(group.rows.every((r) => r.rubricKey === group.rubricKey)).toBe(true);
    }
  });

  it("counts the rows holding no evidence", () => {
    const rec = record([obs({ subDimensionKey: SUB_A }), obs({ subDimensionKey: SUB_B })]);
    expect(coverageOf(rec).unevidenced).toBe(TOTAL_SUBS - 2);
  });

  // R20: the reading reports. Nothing here says ready, blocked, or done.
  it("carries no verdict, threshold, or percentage", () => {
    const reading = coverageOf(record([obs()]));
    expect(Object.keys(reading).sort()).toEqual(
      ["byRubric", "callNumbers", "rows", "unevidenced"].sort(),
    );
  });
});

describe("per call", () => {
  it("attributes each observation to the call it came from", () => {
    const rec = record(
      [
        obs({ subDimensionKey: SUB_A, callNumber: 1 }),
        obs({ subDimensionKey: SUB_B, callNumber: 2 }),
      ],
      [1, 2],
    );
    const reading = coverageOf(rec);
    expect(reading.callNumbers).toEqual([1, 2]);

    const a = reading.rows.find((r) => r.key === SUB_A)!;
    const b = reading.rows.find((r) => r.key === SUB_B)!;
    expect(a.perCall).toEqual(["has-evidence", "no-evidence"]);
    expect(b.perCall).toEqual(["no-evidence", "has-evidence"]);
  });

  it("reads a call that produced only rejected evidence as rejected for that call", () => {
    const rec = record(
      [
        obs({ subDimensionKey: SUB_A, callNumber: 1, status: "rejected" }),
        obs({ subDimensionKey: SUB_A, callNumber: 2, status: "accepted" }),
      ],
      [1, 2],
    );
    const row = coverageOf(rec).rows.find((r) => r.key === SUB_A)!;
    expect(row.perCall).toEqual(["evidence-rejected", "has-evidence"]);
    // Cumulatively the row holds evidence — call 2 supplied it.
    expect(row.state).toBe("has-evidence");
  });

  it("orders call columns by call number, not by insertion", () => {
    const rec = record([obs({ callNumber: 3 })], [3, 1, 2]);
    expect(coverageOf(rec).callNumbers).toEqual([1, 2, 3]);
  });

  it("gives every row one cell per call", () => {
    const reading = coverageOf(record([obs()], [1, 2, 3]));
    expect(reading.rows.every((r) => r.perCall.length === 3)).toBe(true);
  });
});

describe("layer", () => {
  // Only L1 rows are written today, but the L2 plan is the declared successor and
  // an unfixed derivation would start mixing layers the moment it lands.
  it("ignores observations stamped at another layer", () => {
    const rec = record([obs({ subDimensionKey: SUB_A, layer: "L2" as Observation["layer"] })]);
    expect(stateOf(rec, SUB_A)).toBe("no-evidence");
  });

  it("does not let a rejected L2 observation make an L1 row read as rejected", () => {
    const rec = record([
      obs({ subDimensionKey: SUB_A, layer: "L2" as Observation["layer"], status: "rejected" }),
    ]);
    expect(stateOf(rec, SUB_A)).toBe("no-evidence");
  });
});

describe("the shared grouping", () => {
  /**
   * The riskiest edit in the unit. The capture and floor pages each built this
   * map inline, byte-identically, and both dropped rejected observations. A page
   * render test would run in neither Vitest suite, so the equivalence is asserted
   * here at the module instead.
   */
  it("filtered to non-rejected, reproduces what the pages built inline", () => {
    const observations = [
      obs({ subDimensionKey: SUB_A, status: "accepted" }),
      obs({ subDimensionKey: SUB_A, status: "rejected" }),
      obs({ subDimensionKey: SUB_B, status: "draft" }),
      obs({ subDimensionKey: SUB_C, status: "rejected" }),
    ];
    const rec = record(observations);

    // The exact loop both pages ran before this unit.
    const asPagesBuiltIt = new Map<string, Observation[]>();
    for (const o of rec.observations) {
      if (o.status === "rejected") continue;
      const list = asPagesBuiltIt.get(o.subDimensionKey);
      if (list) list.push(o);
      else asPagesBuiltIt.set(o.subDimensionKey, [o]);
    }

    expect(candidateEvidenceBySubDimension(rec)).toEqual(asPagesBuiltIt);
  });

  it("keeps rejected observations in the superset, which is what coverage needs", () => {
    const rec = record([
      obs({ subDimensionKey: SUB_A, status: "rejected" }),
      obs({ subDimensionKey: SUB_A, status: "accepted" }),
    ]);
    expect(observationsBySubDimension(rec).get(SUB_A)).toHaveLength(2);
    expect(candidateEvidenceBySubDimension(rec).get(SUB_A)).toHaveLength(1);
  });

  /**
   * The pages never filtered by layer, and this unit must not start: the equality
   * above is only meaningful if the shared version reproduces today's behaviour
   * exactly. Coverage applies its own layer filter on top.
   */
  it("does not filter by layer, matching what the pages do today", () => {
    const rec = record([obs({ layer: "L2" as Observation["layer"] })]);
    expect(candidateEvidenceBySubDimension(rec).get(SUB_A)).toHaveLength(1);
  });

  it("preserves observation order within a row", () => {
    const first = obs({ subDimensionKey: SUB_A, quote: "first" });
    const second = obs({ subDimensionKey: SUB_A, quote: "second" });
    const got = observationsBySubDimension(record([first, second])).get(SUB_A)!;
    expect(got.map((o) => o.quote)).toEqual(["first", "second"]);
  });
});

describe("the sidebar badge", () => {
  /**
   * `unevidencedCount` exists separately from `coverageOf` for cost (KTD5): it
   * runs inside a per-deal loop on the deals index, where the 41-row per-call
   * grid would be wasted work. That split is what let the two drift — the badge
   * counted a rejected-only row as unevidenced while the page called it
   * evidence-rejected, so the same record read 41 in one place and 40 in the
   * other. These pin them together.
   */
  it("agrees with the page for a record holding every state at once", () => {
    const rec = record([
      obs({ subDimensionKey: SUB_A, status: "accepted" }),
      obs({ subDimensionKey: SUB_B, status: "rejected" }),
      obs({ subDimensionKey: SUB_B, status: "rejected" }),
    ]);
    // SUB_C and the other 38 rows have nothing recorded against them.
    expect(unevidencedCount(rec)).toBe(coverageOf(rec).unevidenced);
    expect(unevidencedCount(rec)).toBe(TOTAL_SUBS - 2);
  });

  it("does not count a rejected-only row as unevidenced", () => {
    const rec = record([obs({ subDimensionKey: SUB_A, status: "rejected" })]);
    expect(coverageOf(rec).rows.find((r) => r.key === SUB_A)?.state).toBe("evidence-rejected");
    expect(unevidencedCount(rec)).toBe(TOTAL_SUBS - 1);
    expect(unevidencedCount(rec)).toBe(coverageOf(rec).unevidenced);
  });

  it("agrees with the page when nothing is recorded at all", () => {
    const rec = record([], []);
    expect(unevidencedCount(rec)).toBe(TOTAL_SUBS);
    expect(unevidencedCount(rec)).toBe(coverageOf(rec).unevidenced);
  });

  it("ignores another layer, as the page does", () => {
    const rec = record([obs({ subDimensionKey: SUB_A, layer: "L2" as Observation["layer"] })]);
    expect(unevidencedCount(rec)).toBe(TOTAL_SUBS);
    expect(unevidencedCount(rec)).toBe(coverageOf(rec).unevidenced);
  });
});
