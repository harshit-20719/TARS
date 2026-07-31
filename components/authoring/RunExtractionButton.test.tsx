import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { RUBRICS } from "@/framework";

/**
 * The re-run button's honesty about failed blocks (KTD6).
 *
 * A failed block carries a machine-readable kind, and the wording must follow
 * it: a retryable failure (a rate limit, a timeout) is genuinely fixed by
 * pressing the button again, so the invitation stays. A terminal failure — a
 * content-policy block, a refused transcript — fails identically on every
 * press, and inviting a re-run there sends a PM into a loop that can never
 * succeed. The terminal wording says the block cannot be read from this
 * transcript and stops there.
 *
 * Named .test.tsx deliberately: vitest.components.config.ts includes only
 * .test.tsx under components/, so a .test.ts here would run in neither suite
 * and pass by never executing.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string; field?: string };

type Summary = {
  observations: number;
  claims: number;
  droppedQuotes: string[];
  droppedClaims: number;
  mergedSpans: number;
  failedBlocks: { rubricKey: string; label: string; reason: string; kind: string }[];
  succeededBlocks: string[];
};

const runExtractionAction = vi.fn<(...a: unknown[]) => Promise<Result<Summary>>>();

vi.mock("@/lib/actions", () => ({
  runExtractionAction: (...a: unknown[]) => runExtractionAction(...a),
}));

// ControlError reads the path to build its sign-in-again link.
vi.mock("next/navigation", () => ({ usePathname: () => "/deals/halten/transcript" }));

const { RunExtractionButton } = await import("./RunExtractionButton");

const summary = (failedBlocks: Summary["failedBlocks"]): Summary => ({
  observations: 4,
  claims: 1,
  droppedQuotes: [],
  droppedClaims: 0,
  mergedSpans: 0,
  failedBlocks,
  succeededBlocks: [],
});

/** A block that read cleanly and found nothing — what the other five answer. */
const nothing = (): Summary => ({
  observations: 0,
  claims: 0,
  droppedQuotes: [],
  droppedClaims: 0,
  mergedSpans: 0,
  failedBlocks: [],
  succeededBlocks: [],
});

/**
 * One press is now one request per macro-dimension, so the double the action
 * gets called six times and the button sums what comes back. The fixture rides
 * on the first block and the rest answer empty, which keeps every assertion
 * below about the *accumulated* summary — the thing the PM actually reads.
 */
async function runWith(failedBlocks: Summary["failedBlocks"]) {
  let call = 0;
  runExtractionAction.mockImplementation(async () => ({
    ok: true as const,
    data: call++ === 0 ? summary(failedBlocks) : nothing(),
  }));
  render(<RunExtractionButton callId="c1" alreadyExtracted={false} />);
  await act(async () => {
    screen.getByRole("button", { name: /run extraction/i }).click();
  });
}

beforeEach(() => {
  runExtractionAction.mockReset();
});

/**
 * One press, one request per macro-dimension.
 *
 * Six concurrent requests do not fit the deployment's budget — Gemini's free
 * tier served about one and left the rest queued until they hit the block
 * bound — so the button spreads the run across invocations instead. The PM
 * still presses once; what changed is underneath.
 */
describe("the run, spread across one request per block", () => {
  it("sends one request per macro-dimension, each naming its own block", async () => {
    runExtractionAction.mockResolvedValue({ ok: true, data: nothing() });
    render(<RunExtractionButton callId="c1" alreadyExtracted={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /run extraction/i }).click();
    });

    expect(runExtractionAction).toHaveBeenCalledTimes(RUBRICS.length);
    const asked = runExtractionAction.mock.calls.map(
      (c) => (c[1] as { blocks: string[] }).blocks,
    );
    // Every block, exactly once, each request carrying one.
    expect(asked.flat()).toEqual(RUBRICS.map((r) => r.key));
    for (const blocks of asked) expect(blocks).toHaveLength(1);
  });

  /**
   * A block that fails costs that block and nothing else. Stopping the sequence
   * on the first failure would throw away five good blocks for one bad one —
   * and the failing block is exactly the one a PM wants the others despite.
   */
  it("keeps going after a block fails, and reports every failure", async () => {
    let call = 0;
    runExtractionAction.mockImplementation(async () => {
      const i = call++;
      return {
        ok: true as const,
        data:
          i % 2 === 0
            ? { ...nothing(), failedBlocks: [{ rubricKey: RUBRICS[i].key, label: `Block ${i}`, reason: "timed out", kind: "retryable" }] }
            : nothing(),
      };
    });
    render(<RunExtractionButton callId="c1" alreadyExtracted={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /run extraction/i }).click();
    });

    expect(runExtractionAction).toHaveBeenCalledTimes(RUBRICS.length);
    // Three failures across six blocks, all named — not just the first.
    expect(screen.getByText(/3 of 6 blocks/i)).toBeTruthy();
    expect(screen.getByText("Block 0")).toBeTruthy();
    expect(screen.getByText("Block 4")).toBeTruthy();
  });

  /**
   * A refused request is about the whole call — auth, a rule, a database fault
   * — so the remaining blocks would be refused identically. Sending them would
   * spend five more round trips to collect the same answer.
   */
  /**
   * Recovering one block must cost one block. Pressing the main button again
   * sends all six — five transcript reads spent to fix the one that failed, and
   * five good blocks replaced by another draw from the same model for nothing.
   */
  it("retries only the blocks that failed", async () => {
    const failed = RUBRICS[0];
    let call = 0;
    runExtractionAction.mockImplementation(async () => ({
      ok: true as const,
      data:
        call++ === 0
          ? {
              ...nothing(),
              failedBlocks: [
                { rubricKey: failed.key, label: failed.label, reason: "timed out", kind: "retryable" },
              ],
            }
          : nothing(),
    }));
    render(<RunExtractionButton callId="c1" alreadyExtracted={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /run extraction/i }).click();
    });
    expect(runExtractionAction).toHaveBeenCalledTimes(RUBRICS.length);

    runExtractionAction.mockClear();
    await act(async () => {
      screen.getByRole("button", { name: /retry this block/i }).click();
    });

    expect(runExtractionAction).toHaveBeenCalledTimes(1);
    expect((runExtractionAction.mock.calls[0][1] as { blocks: string[] }).blocks).toEqual([
      failed.key,
    ]);
  });

  it("stops the sequence when a request is refused outright", async () => {
    runExtractionAction.mockResolvedValue({ ok: false, error: "you cannot author this record" });
    render(<RunExtractionButton callId="c1" alreadyExtracted={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /run extraction/i }).click();
    });

    expect(runExtractionAction).toHaveBeenCalledTimes(1);
  });
});

describe("failed blocks, by what a re-run would actually do", () => {
  it("invites a re-run when the failure is retryable", async () => {
    await runWith([
      { rubricKey: "ft", label: "Founder–Problem Fit", reason: "rate limited — try again in a moment.", kind: "retryable" },
    ]);

    expect(screen.getByText(/re-run to try/i)).toBeTruthy();
    expect(screen.getByText("Founder–Problem Fit")).toBeTruthy();
    expect(screen.queryByText(/cannot be read from this transcript/i)).toBeNull();
  });

  it("does not invite a re-run when the failure is terminal", async () => {
    await runWith([
      {
        rubricKey: "ft",
        label: "Founder–Problem Fit",
        reason: "Gemini stopped generating on this block (SAFETY).",
        kind: "terminal",
      },
    ]);

    // The block is named and the reason shown…
    expect(screen.getByText("Founder–Problem Fit")).toBeTruthy();
    expect(screen.getByText(/SAFETY/)).toBeTruthy();
    // …but the wording says a re-run would fail the same way, and never invites one.
    expect(screen.getByText(/cannot be read from this transcript/i)).toBeTruthy();
    expect(screen.queryByText(/re-run to try/i)).toBeNull();
  });

  it("invites a re-run for the retryable blocks only, when the kinds are mixed", async () => {
    await runWith([
      { rubricKey: "ft", label: "Founder–Problem Fit", reason: "rate limited.", kind: "retryable" },
      { rubricKey: "pm", label: "Personal Traits", reason: "the model declined (SAFETY).", kind: "terminal" },
    ]);

    expect(screen.getByText(/re-run to try/i)).toBeTruthy();
    expect(screen.getByText(/cannot be read from this transcript/i)).toBeTruthy();
  });

  it("says nothing about failures when every block succeeded", async () => {
    await runWith([]);

    expect(screen.getByText(/4 observations, 1 claim/)).toBeTruthy();
    expect(screen.queryByText(/blocks failed/i)).toBeNull();
  });
});
