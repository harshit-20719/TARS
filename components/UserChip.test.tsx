import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The identity chip in the top bar.
 *
 * Small surface, but it is the only thing on screen that answers "which account
 * am I using" — and before it existed the answer was nowhere. The sign-out action
 * is mocked: what matters here is that the control reaches it exactly once, not
 * what next-auth does afterwards.
 *
 * Named .test.tsx deliberately. vitest.components.config.ts includes only
 * .test.tsx files under components/, and vitest.config.ts covers lib/ and
 * framework/ — so a .test.ts file here would run in neither suite and pass by
 * never executing.
 */

const signOutAction = vi.fn<() => Promise<void>>(async () => {});

vi.mock("@/lib/actions", () => ({
  signOutAction: () => signOutAction(),
}));

const { UserChip } = await import("./UserChip");

beforeEach(() => {
  signOutAction.mockClear();
});

describe("UserChip", () => {
  it("names the signed-in person and their role", () => {
    render(<UserChip name="Harshit Agarwal" email="harshit@biome.in" role="ADMIN" />);
    expect(screen.getByText("Harshit Agarwal")).toBeTruthy();
    expect(screen.getByText("ADMIN")).toBeTruthy();
  });

  it("shows a PARTNER as a partner — the role is a label, not a restriction", () => {
    render(<UserChip name="Srini" email="srini@biome.in" role="PARTNER" />);
    expect(screen.getByText("PARTNER")).toBeTruthy();
  });

  // Google supplies a name, but the dev credentials provider and a freshly
  // adapter-created row need not. Blank would read as "signed out".
  it("falls back to the email local part when there is no name", () => {
    render(<UserChip name={null} email="pm@biome.in" role="PM" />);
    expect(screen.getByText("pm")).toBeTruthy();
    expect(screen.queryByText("pm@biome.in")).toBeNull();
  });

  it("treats a whitespace-only name as absent", () => {
    render(<UserChip name="   " email="mehul@biome.in" role="PM" />);
    expect(screen.getByText("mehul")).toBeTruthy();
  });

  it("signs out once when the control is activated", () => {
    render(<UserChip name="Harshit" email="harshit@biome.in" role="ADMIN" />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOutAction).toHaveBeenCalledTimes(1);
  });

  it("gives the sign-out control an accessible name, not an icon alone", () => {
    render(<UserChip name="Harshit" email="harshit@biome.in" role="ADMIN" />);
    const button = screen.getByRole("button", { name: /sign out/i });
    expect(button.textContent?.trim()).toBeTruthy();
  });
});
