import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";

/**
 * Handing a deal to another account holder (R8, R9, R10, F2).
 *
 * The control is rendered for every author, because the page cannot tell who may
 * use it — `ownerId` deliberately never reaches the client (it is not on the
 * `Deal` record contract), so the server action is what refuses. That is the same
 * arrangement DeleteDeal already uses, and it makes the refusal path a first-class
 * case here rather than an edge one.
 *
 * The two presses are the gate, and what sits between them is the point: a
 * handover is recoverable, but *not by the person performing it* — R9 strips their
 * reassign right the moment the write lands. So the armed state has to say who is
 * getting the deal, that delete rights travel with it, and who can move it back.
 * These tests pin those three sentences, because they are the whole safeguard.
 *
 * Named .test.tsx deliberately: vitest.components.config.ts includes only
 * .test.tsx under components/, so a .test.ts here would run in neither suite.
 */

type Result = { ok: true } | { ok: false; error: string; field?: string };

const reassignDealAction = vi.fn<(dealId: string, ownerId: string) => Promise<Result>>(
  async () => ({ ok: true }),
);

vi.mock("@/lib/actions", () => ({
  reassignDealAction: (dealId: string, ownerId: string) => reassignDealAction(dealId, ownerId),
}));

// ControlError reads the path to build its sign-in-again link.
vi.mock("next/navigation", () => ({ usePathname: () => "/deals/halten" }));

const { ReassignDeal } = await import("./ReassignDeal");

const CANDIDATES = [
  { id: "u-pm", name: "Pilot PM" },
  { id: "u-partner", name: "Pilot Partner" },
];

function open(candidates = CANDIDATES) {
  render(<ReassignDeal dealId="halten" company="Halten" candidates={candidates} />);
  return press("Change owner");
}

const press = (label: string | RegExp) =>
  act(async () => {
    screen.getByRole("button", { name: label }).click();
  });

const pick = (name: string) =>
  act(async () => {
    const select = screen.getByLabelText(/hand .* to/i) as HTMLSelectElement;
    const option = [...select.options].find((o) => o.text === name)!;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

beforeEach(() => {
  reassignDealAction.mockClear();
  reassignDealAction.mockImplementation(async () => ({ ok: true }));
});

describe("choosing who gets the deal", () => {
  it("stays out of the way until it is opened", () => {
    render(<ReassignDeal dealId="halten" company="Halten" candidates={CANDIDATES} />);
    expect(screen.getByRole("button", { name: "Change owner" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("offers every account holder it was given", async () => {
    await open();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.text);
    expect(labels).toContain("Pilot PM");
    expect(labels).toContain("Pilot Partner");
  });

  it("will not hand the deal anywhere until someone is picked", async () => {
    await open();
    expect(screen.getByRole("button", { name: /hand over/i }).hasAttribute("disabled")).toBe(true);
  });
});

describe("the armed confirmation", () => {
  async function arm() {
    await open();
    await pick("Pilot Partner");
    await press(/hand over/i);
  }

  // The armed button is the last thing pressed, so it is where the name has to
  // be — a confirmation that says "confirm" tells the reader nothing.
  it("names the new owner", async () => {
    await arm();
    expect(screen.getByRole("button", { name: /Pilot Partner/ })).toBeTruthy();
  });

  it("says the delete right moves with the deal", async () => {
    await arm();
    expect(screen.getByText(/delete/i).textContent).toMatch(/delete/i);
  });

  it("says who can move it back — and that it is not the person pressing", async () => {
    await arm();
    const note = screen.getByText(/move it back/i).textContent ?? "";
    expect(note).toMatch(/ADMIN/);
    expect(note).toMatch(/new owner/i);
  });

  it("does not send anything on the first press", async () => {
    await arm();
    expect(reassignDealAction).not.toHaveBeenCalled();
  });

  it("sends the deal and the chosen owner on the second press", async () => {
    await arm();
    await press(/Pilot Partner/);
    expect(reassignDealAction).toHaveBeenCalledWith("halten", "u-partner");
  });

  it("can be backed out of without sending anything", async () => {
    await arm();
    await press(/keep it/i);
    expect(reassignDealAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Pilot Partner/ })).toBeNull();
  });

  /**
   * Re-picking has to disarm, or the confirmation names one person while the
   * press sends another — which is the one failure this control cannot have,
   * since the person pressing it cannot undo the result.
   */
  it("disarms when the owner is changed underneath it", async () => {
    await arm();
    await pick("Pilot PM");
    expect(screen.queryByRole("button", { name: /Hand Halten to Pilot Partner/ })).toBeNull();
    expect(reassignDealAction).not.toHaveBeenCalled();
  });
});

/**
 * The control renders for everyone; `assertMayReassignDeal` is what refuses. So
 * a PM who does not own the deal reaches the second press and gets the server's
 * answer — which has to land on the control rather than disappear.
 */
describe("when the server refuses", () => {
  async function refused() {
    reassignDealAction.mockImplementation(async () => ({
      ok: false,
      error: "You can only hand over a deal you own.",
    }));
    await open();
    await pick("Pilot Partner");
    await press(/hand over/i);
    await press(/Pilot Partner/);
  }

  it("shows what the server said", async () => {
    await refused();
    expect(screen.getByText(/only hand over a deal you own/)).toBeTruthy();
  });

  it("leaves the choice standing, so the refusal can be read against it", async () => {
    await refused();
    expect(screen.getByRole("button", { name: /Pilot Partner/ })).toBeTruthy();
  });

  // A refusal describes the press that caused it. Carrying it into a freshly
  // reopened control would report a failure that has not happened yet.
  it("does not follow the control into the next time it is opened", async () => {
    await refused();
    await press("Cancel");
    await press("Change owner");
    expect(screen.queryByText(/only hand over a deal you own/)).toBeNull();
  });
});
