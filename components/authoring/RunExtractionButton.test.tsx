import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";

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
  failedBlocks: { label: string; reason: string; kind: string }[];
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
  failedBlocks,
});

async function runWith(failedBlocks: Summary["failedBlocks"]) {
  runExtractionAction.mockResolvedValue({ ok: true, data: summary(failedBlocks) });
  render(<RunExtractionButton callId="c1" alreadyExtracted={false} />);
  await act(async () => {
    screen.getByRole("button", { name: /run extraction/i }).click();
  });
}

beforeEach(() => {
  runExtractionAction.mockReset();
});

describe("failed blocks, by what a re-run would actually do", () => {
  it("invites a re-run when the failure is retryable", async () => {
    await runWith([
      { label: "Founder–Problem Fit", reason: "rate limited — try again in a moment.", kind: "retryable" },
    ]);

    expect(screen.getByText(/re-run to try/i)).toBeTruthy();
    expect(screen.getByText("Founder–Problem Fit")).toBeTruthy();
    expect(screen.queryByText(/cannot be read from this transcript/i)).toBeNull();
  });

  it("does not invite a re-run when the failure is terminal", async () => {
    await runWith([
      {
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
      { label: "Founder–Problem Fit", reason: "rate limited.", kind: "retryable" },
      { label: "Personal Traits", reason: "the model declined (SAFETY).", kind: "terminal" },
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
