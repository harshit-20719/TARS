import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RUBRICS, rubricByKey } from "@/framework";
import type { CallMeta, ExtractionBlockRun, Observation } from "@/mock/types";
import { ExtractionQualityBoard } from "./ExtractionQualityBoard";

/**
 * The extraction-quality board — the reading the review page became (R14, KTD16).
 *
 * It renders what the last run over each call actually did, block by block, from
 * the persisted run record: which blocks were read, which failed and whether a
 * re-run can help (R23), and what was dropped on the way (R20). It is read-only —
 * the verbs on the old exception queue (confirm, move, reject) all live on the
 * capture rows now, so a control here would rebuild the queue this page stopped
 * being.
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

const run = (rubricKey: string, over: Partial<ExtractionBlockRun> = {}): ExtractionBlockRun => ({
  rubricKey,
  outcome: "read",
  droppedQuotes: 0,
  droppedClaims: 0,
  mergedSpans: 0,
  ranAt: "22 Jul 2026",
  ...over,
});

/** Every block read clean — the baseline the failure fixtures override. */
const allRead = () => RUBRICS.map((r) => run(r.key));

let callSeq = 0;
const call = (blockRuns: ExtractionBlockRun[], over: Partial<CallMeta> = {}): CallMeta => ({
  id: `c${++callSeq}`,
  dealId: "d1",
  number: 1,
  label: "First founder call",
  date: "19 Jul 2026",
  extracted: blockRuns.length > 0 && blockRuns.every((r) => r.outcome === "read"),
  transcriptChars: 1200,
  blockRuns,
  ...over,
});

const board = (calls: CallMeta[], observations: Observation[] = []) =>
  render(<ExtractionQualityBoard dealId="d1" calls={calls} observations={observations} />);

/** The row a block renders as, found by its rubric's label. */
const rowOf = (rubricKey: string) => {
  const label = rubricByKey(rubricKey)!.label;
  const row = screen.getByText(label).closest("tr");
  expect(row).toBeTruthy();
  return within(row!);
};

describe("a partially read call", () => {
  it("renders which blocks were read and which failed", () => {
    const runs = allRead().map((r) =>
      r.rubricKey === "fl" ? run("fl", { outcome: "failed-retryable", reason: "rate limited" }) : r,
    );
    board([call(runs)]);

    expect(rowOf("fl").getByText(/failed/i)).toBeTruthy();
    expect(rowOf("ft").getByText(/^read$/i)).toBeTruthy();
    // The unread count is named on the call itself, durable after a refresh (R24).
    expect(screen.getByText(new RegExp(`1 of ${RUBRICS.length} blocks unread`, "i"))).toBeTruthy();
  });
});

describe("failed blocks", () => {
  it("presents a terminal failure as unreadable, with no re-run invitation", () => {
    const runs = allRead().map((r) =>
      r.rubricKey === "ft"
        ? run("ft", { outcome: "failed-terminal", reason: "the model declines to assess people" })
        : r,
    );
    board([call(runs)]);

    const row = rowOf("ft");
    expect(row.getByText(/cannot be read from this transcript/i)).toBeTruthy();
    // The reason is shown in the run's words…
    expect(row.getByText(/declines to assess people/i)).toBeTruthy();
    // …and nothing on the row suggests running it again (R23).
    expect(screen.getByText(rubricByKey("ft")!.label).closest("tr")!.textContent).not.toMatch(
      /re-?run|try again|retry/i,
    );
  });

  it("distinguishes a retryable failure — a re-run can pick it up", () => {
    const runs = allRead().map((r) =>
      r.rubricKey === "fl" ? run("fl", { outcome: "failed-retryable", reason: "rate limited" }) : r,
    );
    board([call(runs)]);

    const row = rowOf("fl");
    expect(row.getByText(/rate limited/i)).toBeTruthy();
    expect(screen.getByText(rubricByKey("fl")!.label).closest("tr")!.textContent).toMatch(/re-?run/i);
  });
});

describe("what a run dropped", () => {
  it("renders per-block dropped-quote and merged-span counts when non-zero", () => {
    const runs = allRead().map((r) =>
      r.rubricKey === "pm" ? run("pm", { droppedQuotes: 2, droppedClaims: 1, mergedSpans: 3 }) : r,
    );
    board([call(runs)]);

    const row = rowOf("pm");
    expect(row.getByText(/2 quotes dropped/i)).toBeTruthy();
    expect(row.getByText(/1 claim dropped/i)).toBeTruthy();
    expect(row.getByText(/3 spans merged/i)).toBeTruthy();
    // A clean block does not render zeros dressed up as findings.
    expect(screen.getByText(rubricByKey("ft")!.label).closest("tr")!.textContent).not.toMatch(
      /dropped|merged/i,
    );
  });
});

describe("the confidence mix", () => {
  it("renders the unconfirmed low-confidence count", () => {
    board(
      [call(allRead())],
      [
        obs({ confidence: "low" }),
        obs({ confidence: "low" }),
        obs({ confidence: "low", decidedById: "u1" }),
        obs({ confidence: "high" }),
      ],
    );
    const cell = screen.getByText(/unsure · unconfirmed/i).closest(".cell");
    expect(cell).toBeTruthy();
    expect(within(cell as HTMLElement).getByText("2")).toBeTruthy();
  });
});

describe("the clean state", () => {
  it("says every block read and nothing dropped — without claiming everything was confident", () => {
    const { container } = board([call(allRead())], [obs({ confidence: "low" })]);
    expect(screen.getByText(/nothing dropped/i)).toBeTruthy();
    // The old board's empty state claimed all observations "were mapped
    // confidently", which is false whenever any filing was low-confidence.
    expect(container.textContent).not.toMatch(/confidently/i);
  });
});

describe("before any run exists", () => {
  it("says extraction has not run yet and points at the transcript step", () => {
    const { container } = board([call([])]);
    expect(screen.getByText(/extraction has not run/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /transcript/i });
    expect(link.getAttribute("href")).toBe("/deals/d1/transcript");
    // Distinct from the all-read-and-clean state.
    expect(container.textContent).not.toMatch(/nothing dropped/i);
  });

  it("says the same when the deal has no calls at all", () => {
    board([]);
    expect(screen.getByText(/extraction has not run/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /transcript/i })).toBeTruthy();
  });
});

describe("what it must not do", () => {
  // The page is a reading now. Confirm, move, and reject all live on the
  // capture rows (U8) — a decideObservation-style control here would rebuild
  // the exception queue under a new name.
  it("offers no mutation, in any state", () => {
    const { container } = board(
      [
        call(
          allRead().map((r) =>
            r.rubricKey === "fl"
              ? run("fl", { outcome: "failed-retryable", reason: "rate limited" })
              : r,
          ),
        ),
      ],
      [obs({ confidence: "low" })],
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(container.querySelectorAll("form, input, select, textarea, button")).toHaveLength(0);
  });
});
