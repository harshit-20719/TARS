import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RUBRICS, TOTAL_SUBS } from "@/framework";
import type { DealRecord, Observation } from "@/mock/types";
import { coverageOf } from "@/lib/coverage";
import { CoverageGrid, STATE_LABEL } from "./CoverageGrid";

/**
 * The coverage grid.
 *
 * Built from the real derivation rather than a hand-written fixture, so the two
 * cannot drift — a 41-row literal would be wrong the first time the framework
 * changed.
 *
 * The accessibility requirement here is not decoration. CaptureGrid encodes its
 * state as colour-only CSS classes, which is why this grid could not inherit its
 * approach: three states that differ only by hue are three states a colourblind
 * PM cannot read, and the whole point is distinguishing them at a glance.
 */

let seq = 0;
const obs = (over: Partial<Observation> = {}): Observation => ({
  id: `o${++seq}`,
  dealId: "d1",
  callNumber: 1,
  rubricKey: RUBRICS[0].key,
  subDimensionKey: RUBRICS[0].subs[0].key,
  quote: "…",
  status: "accepted",
  layer: "L1",
  ...over,
});

const reading = (observations: Observation[], callNumbers: number[] = [1]) =>
  coverageOf({
    deal: { id: "d1" },
    calls: callNumbers.map((number) => ({ number })),
    observations,
    claims: [],
    scores: [],
    slides: [],
    founderTypeRead: undefined,
  } as unknown as DealRecord);

const FIRST = RUBRICS[0].subs[0];
const SECOND = RUBRICS[0].subs[1];

describe("the legend", () => {
  it("spells out all three states above the grid", () => {
    render(<CoverageGrid reading={reading([obs()])} />);
    const legend = screen.getByRole("list", { name: /what the marks mean/i });
    for (const label of Object.values(STATE_LABEL)) {
      expect(within(legend).getByText(label)).toBeTruthy();
    }
  });

  // Cells are 24px wide. The glyph is what fits; the legend is what makes it mean
  // something, so neither is optional.
  it("names each state in text, not by colour alone", () => {
    render(<CoverageGrid reading={reading([obs()])} />);
    expect(screen.getByText("has evidence")).toBeTruthy();
    expect(screen.getByText("evidence rejected")).toBeTruthy();
    expect(screen.getByText("no evidence")).toBeTruthy();
  });
});

describe("the grid", () => {
  it("renders every rubric as a group header", () => {
    render(<CoverageGrid reading={reading([obs()])} />);
    for (const r of RUBRICS) {
      expect(screen.getByRole("rowheader", { name: r.label })).toBeTruthy();
    }
  });

  it("renders every sub-dimension as a row, all forty-one", () => {
    render(<CoverageGrid reading={reading([obs()])} />);
    for (const r of RUBRICS) {
      for (const s of r.subs) {
        expect(screen.getByRole("rowheader", { name: s.label })).toBeTruthy();
      }
    }
    // Group headers plus sub-dimension rows.
    expect(screen.getAllByRole("rowheader")).toHaveLength(TOTAL_SUBS + RUBRICS.length);
  });

  it("gives each state an accessible name on the cell, not just a glyph", () => {
    render(<CoverageGrid reading={reading([obs({ subDimensionKey: FIRST.key })])} />);
    const cells = screen.getAllByRole("cell", {
      name: new RegExp(`${FIRST.label}.*has evidence`, "i"),
    });
    expect(cells.length).toBeGreaterThan(0);
  });

  it("distinguishes a rejected-evidence row from an unevidenced one", () => {
    const r = reading([
      obs({ subDimensionKey: FIRST.key, status: "rejected" }),
      obs({ subDimensionKey: SECOND.key, status: "accepted" }),
    ]);
    render(<CoverageGrid reading={r} />);
    expect(
      screen.getAllByRole("cell", { name: new RegExp(`${FIRST.label}.*evidence rejected`, "i") })
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("cell", { name: new RegExp(`${SECOND.label}.*has evidence`, "i") }).length,
    ).toBeGreaterThan(0);
  });
});

describe("call columns", () => {
  it("shows one column per call on the deal", () => {
    render(<CoverageGrid reading={reading([obs()], [1, 2, 3])} />);
    expect(screen.getByRole("columnheader", { name: /call 1/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /call 2/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /call 3/i })).toBeTruthy();
  });

  it("keeps a cumulative column separate from the per-call ones", () => {
    render(<CoverageGrid reading={reading([obs()], [1, 2])} />);
    expect(screen.getByRole("columnheader", { name: /across all calls/i })).toBeTruthy();
  });

  // A deal opened but not yet called is the first thing a PM sees. Rendering an
  // empty page there would read as broken rather than as "nothing yet".
  it("renders every row as no evidence when the deal has no calls", () => {
    render(<CoverageGrid reading={reading([], [])} />);
    expect(screen.queryAllByRole("columnheader", { name: /call \d/i })).toHaveLength(0);
    expect(
      screen.getAllByRole("cell", { name: new RegExp(`${FIRST.label}.*no evidence`, "i") }).length,
    ).toBeGreaterThan(0);
  });
});

describe("what it must not do", () => {
  // R19 and R20. Coverage is derived and reports; it does not author, and it does
  // not gate. A control here would be the beginning of both.
  it("renders no control that could mutate the record", () => {
    const { container } = render(<CoverageGrid reading={reading([obs()], [1, 2])} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(container.querySelectorAll("form, input, select, textarea")).toHaveLength(0);
  });

  it("shows no percentage, score, or readiness verdict", () => {
    const { container } = render(<CoverageGrid reading={reading([obs()], [1, 2])} />);
    expect(container.textContent).not.toMatch(/%|ready|complete|blocked|pass|fail/i);
  });
});
