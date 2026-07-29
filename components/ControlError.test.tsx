import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The shared refusal block.
 *
 * Worth its own tests because it is the one place the app distinguishes a refusal
 * a person can fix by changing their input from one they can only fix by signing
 * in again — and the second kind used to render as the first, which is the whole
 * complaint AE10 makes.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/deals/halten/capture",
}));

const { ControlError } = await import("./ControlError");

describe("an ordinary refusal", () => {
  it("renders the message the server gave", () => {
    render(<ControlError error="Call 2 already exists for this deal." />);
    expect(screen.getByText(/Call 2 already exists/)).toBeTruthy();
  });

  it("offers no sign-in link — the person can fix this by editing their input", () => {
    render(<ControlError error="Say what the condition is, in one line." />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing at all when there is no error", () => {
    const { container } = render(<ControlError error={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("an ended session", () => {
  // AE10. Told what happened, and offered a way back — rather than shown a bare
  // authorization error mid-scoring.
  it("offers a sign-in link beside the message", () => {
    render(<ControlError error="Your session ended, so that didn't save." reauth />);
    expect(screen.getByText(/Your session ended/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /sign in again/i })).toBeTruthy();
  });

  /**
   * Returning someone to the deals list after they signed in mid-scoring makes
   * them find their way back to the row they were on. The callback is what makes
   * the offer worth taking.
   */
  it("returns them to the page they were on", () => {
    render(<ControlError error="Your session ended." reauth />);
    const href = screen.getByRole("link", { name: /sign in again/i }).getAttribute("href");
    expect(href).toBe("/api/auth/signin?callbackUrl=%2Fdeals%2Fhalten%2Fcapture");
  });

  // The sign-in route is the one path middleware's matcher excludes, which is
  // what lets someone with no session reach it.
  it("points at the auth route middleware leaves open", () => {
    render(<ControlError error="Your session ended." reauth />);
    expect(
      screen.getByRole("link", { name: /sign in again/i }).getAttribute("href"),
    ).toMatch(/^\/api\/auth\/signin/);
  });
});

describe("layout", () => {
  it("renders as a span where the surrounding layout is inline", () => {
    const { container } = render(<ControlError error="nope" as="span" />);
    expect(container.querySelector("span.ctl-err")).toBeTruthy();
    expect(container.querySelector("div.ctl-err")).toBeNull();
  });

  it("defaults to a div", () => {
    const { container } = render(<ControlError error="nope" />);
    expect(container.querySelector("div.ctl-err")).toBeTruthy();
  });
});
