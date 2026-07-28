import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import type { SubDimensionScore } from "@/mock/types";
import { subByKey } from "@/framework";

/**
 * Component tests for the capture control.
 *
 * These exist because of a specific miss: three defects in this file's local state
 * shipped past a fully green service suite. Nothing was wrong with the services —
 * the bugs lived entirely in what the component chose to send, which no
 * database-level test can see. Each case below is one of those defects.
 *
 * The server actions are mocked so the assertions are about the payload the control
 * builds, not about persistence. That is the seam where the bugs were.
 */

type Ok = { ok: true };
type Payload = Record<string, unknown>;

const setScoreAction = vi.fn<(input: Payload) => Promise<Ok>>(async () => ({ ok: true }));
const clearScoreAction = vi.fn<(dealId: string, key: string) => Promise<Ok>>(async () => ({
  ok: true,
}));
const decideObservationAction = vi.fn<(...a: unknown[]) => Promise<Ok>>(async () => ({ ok: true }));

vi.mock("@/lib/actions", () => ({
  setScoreAction: (input: Payload) => setScoreAction(input),
  clearScoreAction: (dealId: string, key: string) => clearScoreAction(dealId, key),
  decideObservationAction: (...a: unknown[]) => decideObservationAction(...a),
}));

const { ScoreControl } = await import("./ScoreControl");

const SUB = subByKey("why-now")!;

/** A saved score, as the record would carry it. */
const score = (over: Partial<SubDimensionScore> = {}): SubDimensionScore => ({
  dealId: "d1",
  subDimensionKey: SUB.key,
  scoreType: "scale",
  value: 3,
  evidenceObsIds: [],
  layer: "L1",
  ...over,
});

function press(label: string) {
  return act(async () => {
    screen.getByRole("button", { name: label }).click();
  });
}

beforeEach(() => {
  setScoreAction.mockClear();
  clearScoreAction.mockClear();
  decideObservationAction.mockClear();
});

describe("ScoreControl", () => {
  it("sends the pressed value for the row", async () => {
    render(<ScoreControl dealId="d1" sub={SUB} candidates={[]} />);
    await press("4");
    expect(setScoreAction).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: "d1", subDimensionKey: SUB.key, value: 4 }),
    );
  });

  it("clears the score when the set value is pressed again", async () => {
    render(<ScoreControl dealId="d1" sub={SUB} score={score({ value: 3 })} candidates={[]} />);
    await press("3");
    expect(clearScoreAction).toHaveBeenCalledWith("d1", SUB.key);
    expect(setScoreAction).not.toHaveBeenCalled();
  });

  /**
   * The P0. A row flagged before the note column existed carries flag true with no
   * note, and the service refuses that pair — so sending it on an ordinary score
   * press made the row impossible to re-score at all.
   */
  it("does not send a condition that was never written down", async () => {
    render(
      <ScoreControl
        dealId="d1"
        sub={SUB}
        score={score({ value: 3, flag: true })}
        candidates={[]}
      />,
    );
    await press("5");

    expect(setScoreAction).toHaveBeenCalledTimes(1);
    const payload = setScoreAction.mock.calls[0]![0];
    expect(payload.value).toBe(5);
    expect(payload.flag).toBe(false);
    expect(payload).not.toHaveProperty("flagNote");
  });

  it("does send a condition once it has been written", async () => {
    render(
      <ScoreControl
        dealId="d1"
        sub={SUB}
        score={score({ value: 3, flag: true, flagNote: "Deed not yet received." })}
        candidates={[]}
      />,
    );
    await press("5");

    const payload = setScoreAction.mock.calls[0]![0];
    expect(payload.flag).toBe(true);
    expect(payload.flagNote).toBe("Deed not yet received.");
  });

  /**
   * Clearing a score deletes the whole row server-side, flagNote included. Leaving
   * the pair in local state made the condition reappear, silently re-attached to a
   * score the PM had just cleared.
   */
  it("forgets the condition when the score is cleared", async () => {
    render(
      <ScoreControl
        dealId="d1"
        sub={SUB}
        score={score({ value: 3, flag: true, flagNote: "Deed not yet received." })}
        candidates={[]}
      />,
    );

    await press("3"); // clears
    await waitFor(() => expect(clearScoreAction).toHaveBeenCalled());
    await press("2"); // re-scores

    const payload = setScoreAction.mock.calls[0]![0];
    expect(payload.value).toBe(2);
    expect(payload.flag).toBe(false);
    expect(payload).not.toHaveProperty("flagNote");
  });

  /** The condition read-out must not linger on a row that no longer has a score. */
  it("stops showing the condition after the score is cleared", async () => {
    render(
      <ScoreControl
        dealId="d1"
        sub={SUB}
        score={score({ value: 3, flag: true, flagNote: "Deed not yet received." })}
        candidates={[]}
      />,
    );
    expect(screen.getByText(/Deed not yet received/)).toBeDefined();

    await press("3");
    await waitFor(() => expect(screen.queryByText(/Deed not yet received/)).toBeNull());
  });

  /**
   * Ticking the box without writing anything used to record the flag as set, which
   * then rode along on every later press and got each one refused.
   */
  it("does not arm the condition until a note is typed", async () => {
    render(<ScoreControl dealId="d1" sub={SUB} score={score({ value: 3 })} candidates={[]} />);

    await act(async () => {
      (screen.getByRole("checkbox") as HTMLInputElement).click();
    });
    // Ticking alone must not save — there is nothing valid to save yet.
    expect(setScoreAction).not.toHaveBeenCalled();

    await press("5");
    const payload = setScoreAction.mock.calls[0]![0];
    expect(payload.flag).toBe(false);
  });

  /**
   * Two overlapping saves on one row can resolve out of order, so the PM's last
   * press is the one that gets lost. The optimistic value already gives immediate
   * feedback, so the press is ignored rather than the button being disabled.
   */
  it("ignores a second press while a save is in flight", async () => {
    let release: (v: Ok) => void = () => {};
    setScoreAction.mockImplementationOnce(
      () => new Promise<Ok>((r) => { release = r; }),
    );

    render(<ScoreControl dealId="d1" sub={SUB} candidates={[]} />);
    await press("4");
    await press("5");

    expect(setScoreAction).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: true }));
  });
});
