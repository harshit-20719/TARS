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

/** The four readings, as viewsFor registers them. */
const ALL_VIEWS = [
  view({ seg: "floor", name: "Floor check" }),
  view({ seg: "claims", name: "Claim ledger" }),
  view({ seg: "coverage", name: "Coverage" }),
  view({ seg: "review", name: "Extraction quality" }),
];

describe("view icons", () => {
  it("gives every view its own icon rather than another's", () => {
    render(<Sidebar deal={deal} steps={[]} views={ALL_VIEWS} />);

    const icons = ALL_VIEWS.map((v) => iconOf(v.name)?.getAttribute("data-icon"));
    for (const icon of icons) expect(icon).toBeTruthy();
    // All distinct — none silently borrowing the fallback.
    expect(new Set(icons).size).toBe(ALL_VIEWS.length);
    expect(iconOf("Floor check")?.getAttribute("data-icon")).toBe("shield");
    expect(iconOf("Claim ledger")?.getAttribute("data-icon")).toBe("ledger");
  });

  it("renders an icon for every view, none falling through to nothing", () => {
    render(<Sidebar deal={deal} steps={[]} views={ALL_VIEWS} />);
    for (const v of ALL_VIEWS) {
      expect(iconOf(v.name)?.querySelector("path, circle")).toBeTruthy();
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
