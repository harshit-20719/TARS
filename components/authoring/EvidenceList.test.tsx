import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { act } from "react";
import type { Observation } from "@/mock/types";

/**
 * The evidence list's marking of an unsure filing, and the verb that clears it
 * (KTD18, R12, R13).
 *
 * Nothing waits in a queue any more: a low-confidence filing sits on its row as
 * evidence, wearing the "unsure of this row" chip until a person rules on it.
 * The chip is gated on there being *no decider* rather than on the confidence
 * value — the record keeps saying the machine was unsure, while the row stops
 * asking for attention. "Row is right" is that ruling made in place: it renders
 * only where the chip renders, sits beside Move and Reject, and disappears with
 * the chip once the decider is set, because both read the same predicate.
 *
 * The old second chip ("needs a look", off the draft status) is gone with the
 * queue: draft is a legacy status nothing writes any more, and a chip on it
 * would flag rows no verb on this page could clear.
 *
 * Named .test.tsx deliberately: vitest.components.config.ts includes only
 * .test.tsx under components/, so a .test.ts here would run in neither suite
 * and pass by never executing.
 */

type Result = { ok: true } | { ok: false; error: string; field?: string };

const decideObservationAction = vi.fn<(...a: unknown[]) => Promise<Result>>();

vi.mock("@/lib/actions", () => ({
  decideObservationAction: (...a: unknown[]) => decideObservationAction(...a),
}));

// ControlError reads the path to build its sign-in-again link.
vi.mock("next/navigation", () => ({ usePathname: () => "/deals/halten/capture" }));

const { EvidenceList } = await import("./EvidenceList");

let seq = 0;
const obs = (over: Partial<Observation> = {}): Observation => ({
  id: `o${++seq}`,
  dealId: "halten",
  callNumber: 1,
  rubricKey: "pt",
  subDimensionKey: "compounding-moat",
  quote: "Our matcher runs continuously instead of as a nightly batch job.",
  status: "accepted",
  layer: "L1",
  ...over,
});

const unsure = (over: Partial<Observation> = {}): Observation =>
  obs({ confidence: "low", mappingNote: "cadence could be moat or product state", ...over });

beforeEach(() => {
  decideObservationAction.mockReset();
});

describe("the unsure chip, gated on there being no decider", () => {
  it("marks a low-confidence filing nobody has ruled on", () => {
    render(<EvidenceList dealId="halten" observations={[unsure()]} />);
    expect(screen.getByText(/unsure of this row/i)).toBeTruthy();
  });

  it("does not mark a confident filing", () => {
    render(<EvidenceList dealId="halten" observations={[obs({ confidence: "high" })]} />);
    expect(screen.queryByText(/unsure of this row/i)).toBeNull();
  });

  it("clears once a person has ruled on it, though the confidence stays on the record", () => {
    render(
      <EvidenceList dealId="halten" observations={[unsure({ decidedById: "u1" })]} />,
    );
    expect(screen.queryByText(/unsure of this row/i)).toBeNull();
  });

  it("no longer renders the draft-status chip — the queue it flagged is gone", () => {
    render(<EvidenceList dealId="halten" observations={[obs({ status: "draft" })]} />);
    expect(screen.queryByText(/needs a look/i)).toBeNull();
  });
});

describe("the confirm control", () => {
  it("appears beside Move and Reject, only on a row carrying the chip", () => {
    render(
      <EvidenceList
        dealId="halten"
        observations={[
          unsure({ quote: "the unsure quote" }),
          obs({ confidence: "high", quote: "the confident quote" }),
        ]}
      />,
    );

    // Exact text, so the chip ("unsure of this row") cannot match a quote.
    const rowOf = (quote: string) => screen.getByText(quote).closest(".ev-item") as HTMLElement;
    const unsureRow = rowOf("the unsure quote");
    const confidentRow = rowOf("the confident quote");

    // On the chip's row: all three verbs, sharing one action cluster.
    const confirm = within(unsureRow).getByRole("button", { name: /row is right/i });
    const actions = confirm.closest(".ev-actions") as HTMLElement;
    expect(within(actions).getByRole("button", { name: /move/i })).toBeTruthy();
    expect(within(actions).getByRole("button", { name: /reject/i })).toBeTruthy();

    // On the confident row: Move and Reject only.
    expect(within(confidentRow).queryByRole("button", { name: /row is right/i })).toBeNull();
    expect(within(confidentRow).getByRole("button", { name: /move/i })).toBeTruthy();
    expect(within(confidentRow).getByRole("button", { name: /reject/i })).toBeTruthy();
  });

  it("does not render once the row is decided — it disappears with the chip", () => {
    render(
      <EvidenceList dealId="halten" observations={[unsure({ decidedById: "u1" })]} />,
    );
    expect(screen.queryByRole("button", { name: /row is right/i })).toBeNull();
  });

  it("sends the accepted decision and nothing else", async () => {
    decideObservationAction.mockResolvedValue({ ok: true });
    const row = unsure();
    render(<EvidenceList dealId="halten" observations={[row]} />);

    await act(async () => {
      screen.getByRole("button", { name: /row is right/i }).click();
    });

    expect(decideObservationAction).toHaveBeenCalledWith("halten", row.id, {
      status: "accepted",
    });
  });

  it("disables while the action is pending, and leaves with the chip on success", async () => {
    let resolve!: (r: Result) => void;
    decideObservationAction.mockReturnValue(new Promise<Result>((r) => (resolve = r)));
    const row = unsure();
    const { rerender } = render(<EvidenceList dealId="halten" observations={[row]} />);

    const button = screen.getByRole("button", { name: /row is right/i }) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    // The action has not answered yet: the press is in flight, the button held.
    expect(button.disabled).toBe(true);

    await act(async () => {
      resolve({ ok: true });
    });

    // On success the server re-renders the row with its decider set, and the
    // button and the chip — one predicate — go together.
    rerender(
      <EvidenceList dealId="halten" observations={[{ ...row, decidedById: "u1" }]} />,
    );
    expect(screen.queryByRole("button", { name: /row is right/i })).toBeNull();
    expect(screen.queryByText(/unsure of this row/i)).toBeNull();
  });
});
