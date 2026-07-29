import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Deal } from "@/mock/types";
import type { StepView } from "@/lib/steps";

/**
 * The sidebar's cross-cutting views.
 *
 * Coverage is the third of these, and the first to need anything of the icon
 * branch: it was a two-way choice defaulting everything non-floor to the ledger
 * icon, so a third view would silently have borrowed the ledger's. `Icon` returns
 * null for a name it does not know, so the failure mode is an empty element
 * rather than an error — nothing would have complained.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/deals/halten",
}));

const { Sidebar } = await import("./Sidebar");

const deal = {
  id: "halten",
  company: "Halten",
  oneLiner: "Continuous settlement reconciliation.",
  layer: "L1",
  ownerPm: "Pilot PM",
} as unknown as Deal;

const view = (over: Partial<StepView> & { seg: string }): StepView => ({
  name: over.seg,
  href: `/deals/halten/${over.seg}`,
  done: false,
  state: "—",
  ...over,
});

const iconOf = (name: string) =>
  screen.getByRole("link", { name: new RegExp(name, "i") }).querySelector("svg[data-icon]");

describe("view icons", () => {
  it("gives coverage its own icon rather than the claim ledger's", () => {
    render(
      <Sidebar
        deal={deal}
        steps={[]}
        views={[
          view({ seg: "floor", name: "Floor check" }),
          view({ seg: "claims", name: "Claim ledger" }),
          view({ seg: "coverage", name: "Coverage" }),
        ]}
      />,
    );

    const coverage = iconOf("Coverage")?.getAttribute("data-icon");
    const ledger = iconOf("Claim ledger")?.getAttribute("data-icon");
    const floor = iconOf("Floor check")?.getAttribute("data-icon");

    expect(coverage).toBeTruthy();
    expect(coverage).not.toBe(ledger);
    expect(coverage).not.toBe(floor);
    expect(floor).toBe("shield");
    expect(ledger).toBe("ledger");
  });

  it("renders an icon for every view, none falling through to nothing", () => {
    render(
      <Sidebar
        deal={deal}
        steps={[]}
        views={[
          view({ seg: "floor", name: "Floor check" }),
          view({ seg: "claims", name: "Claim ledger" }),
          view({ seg: "coverage", name: "Coverage" }),
        ]}
      />,
    );
    for (const name of ["Floor check", "Claim ledger", "Coverage"]) {
      expect(iconOf(name)?.querySelector("path, circle")).toBeTruthy();
    }
  });
});

describe("coverage never reads as a gate", () => {
  /**
   * R20. Deriving `done` from a zero unevidenced count would paint a completion
   * tick on a reading that must never read as a gate — so the sidebar shows the
   * count and no tick, whatever the count is.
   */
  it("shows no completion tick even when nothing is unevidenced", () => {
    render(
      <Sidebar
        deal={deal}
        steps={[]}
        views={[view({ seg: "coverage", name: "Coverage", done: false, state: "none unevidenced" })]}
      />,
    );
    const link = screen.getByRole("link", { name: /Coverage/i });
    expect(link.querySelector(".step-dot.done")).toBeNull();
    expect(screen.getByText("none unevidenced")).toBeTruthy();
  });
});
