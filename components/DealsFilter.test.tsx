import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The deals list's owner filter, and what the list shows when it matches nothing
 * (R7, KTD9).
 *
 * The filter is two links rather than a client-side toggle, because the filtering
 * happens in the query (KTD9) — so the state lives in the URL, the result is
 * shareable, and the page stays a server component.
 *
 * The empty block is the half that is easy to skip. Before R7 an empty deals list
 * only happened on the very first run, so the page never grew a branch for it;
 * filtering to "Mine" makes it routine, and a filter that silently renders nothing
 * is indistinguishable from a page that failed to load.
 */

const { NoDealsFound, OwnerFilter, MINE, OWNER_PARAM } = await import("./DealsFilter");

describe("the filter itself", () => {
  it("offers both options, with all deals current by default", () => {
    render(<OwnerFilter mine={false} />);
    expect(screen.getByRole("link", { name: /all deals/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: /^mine$/i }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Mine as current when the filter is on", () => {
    render(<OwnerFilter mine />);
    expect(screen.getByRole("link", { name: /^mine$/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /all deals/i }).getAttribute("aria-current")).toBeNull();
  });

  // The param the links write is the one the page reads; both come from here so
  // they cannot drift into a filter that never turns on.
  it("puts the filter in the URL, and drops it again for all deals", () => {
    render(<OwnerFilter mine={false} />);
    expect(screen.getByRole("link", { name: /^mine$/i }).getAttribute("href")).toBe(
      `/deals?${OWNER_PARAM}=${MINE}`,
    );
    expect(screen.getByRole("link", { name: /all deals/i }).getAttribute("href")).toBe("/deals");
  });
});

describe("when the filter matches nothing", () => {
  it("names the filter that is hiding the deals", () => {
    const { container } = render(<NoDealsFound mine />);
    expect(container.textContent).toMatch(/mine/i);
  });

  it("offers the way back to the whole list", () => {
    render(<NoDealsFound mine />);
    expect(screen.getByRole("link", { name: /all deals/i }).getAttribute("href")).toBe("/deals");
  });

  // An unfiltered empty list is a different situation — there is nothing to
  // clear, so offering a link back to the same page would be a dead end.
  it("says something else entirely when there are simply no deals yet", () => {
    const { container } = render(<NoDealsFound mine={false} />);
    expect(container.textContent).not.toMatch(/mine/i);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders something either way, rather than a blank page", () => {
    for (const mine of [true, false]) {
      const { container } = render(<NoDealsFound mine={mine} />);
      expect(container.textContent?.trim().length, `mine=${mine}`).toBeGreaterThan(0);
    }
  });
});
