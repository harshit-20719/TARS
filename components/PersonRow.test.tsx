import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import type { Person } from "@/mock/types";

/**
 * One row of the people page (R2, R3, R4).
 *
 * The row carries two role columns because they can disagree, and the whole
 * reason this component exists rather than a plain table is that the disagreement
 * has to be legible: a configured admin stored as PM is an ADMIN the moment they
 * next sign in, and a page showing only the stored role would be quietly wrong
 * about who can do what.
 *
 * Rows that cannot be changed state why before being pressed. That is a courtesy
 * and not the boundary — lib/services/people.ts refuses the same two cases
 * server-side, and lib/services/people.test.ts is where that is proved. What is
 * proved here is that the reader is told, rather than shown a control that fails.
 *
 * Named .test.tsx deliberately: vitest.components.config.ts includes only
 * .test.tsx under components/, so a .test.ts here would run in neither suite.
 */

type Result = { ok: true } | { ok: false; error: string; field?: string };

const setRoleAction = vi.fn<(userId: string, role: string) => Promise<Result>>(async () => ({
  ok: true,
}));

vi.mock("@/lib/actions", () => ({
  setRoleAction: (userId: string, role: string) => setRoleAction(userId, role),
}));

const { PersonRow, RoleChangeNote } = await import("./PersonRow");

const person = (over: Partial<Person> = {}): Person => ({
  id: "u1",
  name: "Pilot PM",
  email: "pm@biome.in",
  role: "PM",
  created: "12 Jun 2026",
  ...over,
});

/** A `<tr>` needs its table, and the row is a row on purpose — it is a column view. */
function renderRow(props: Parameters<typeof PersonRow>[0]) {
  return render(
    <table>
      <tbody>
        <PersonRow {...props} />
      </tbody>
    </table>,
  );
}

const press = (label: string) =>
  act(async () => {
    screen.getByRole("button", { name: label }).click();
  });

beforeEach(() => {
  setRoleAction.mockClear();
  setRoleAction.mockImplementation(async () => ({ ok: true }));
});

describe("who the row is about", () => {
  it("names the person and shows the address the account is held under", () => {
    renderRow({ person: person(), roleAtNextSignIn: "PM" });
    expect(screen.getByText("Pilot PM")).toBeTruthy();
    expect(screen.getByText("pm@biome.in")).toBeTruthy();
  });

  // Google supplies a name; the dev credentials provider and a freshly
  // adapter-created row need not. A blank cell reads as a broken row.
  it("falls back to the email local part when there is no name", () => {
    renderRow({ person: person({ name: null }), roleAtNextSignIn: "PM" });
    expect(screen.getByText("pm")).toBeTruthy();
  });
});

describe("the two role columns", () => {
  it("shows the stored role and the role at next sign-in separately", () => {
    renderRow({ person: person({ role: "PARTNER" }), roleAtNextSignIn: "PARTNER" });
    expect(screen.getByRole("cell", { name: /stored role PARTNER/i })).toBeTruthy();
    expect(screen.getByRole("cell", { name: /at next sign-in PARTNER/i })).toBeTruthy();
  });

  /**
   * AE2's other half. The address is promoted on every sign-in, so a stored PM
   * row belonging to a configured admin is an ADMIN in every way that matters —
   * showing only the stored role would misreport who can manage users.
   */
  it("reads ADMIN at next sign-in for a configured admin whose stored role says otherwise", () => {
    renderRow({
      person: person({ role: "PM", email: "harshit@biome.in" }),
      roleAtNextSignIn: "ADMIN",
      configuredAdmin: true,
    });
    expect(screen.getByRole("cell", { name: /stored role PM/i })).toBeTruthy();
    expect(screen.getByRole("cell", { name: /at next sign-in ADMIN/i })).toBeTruthy();
  });
});

describe("changing the role", () => {
  it("offers all three roles with the stored one pressed", () => {
    renderRow({ person: person({ role: "PARTNER" }), roleAtNextSignIn: "PARTNER" });
    for (const role of ["PM", "PARTNER", "ADMIN"]) {
      expect(screen.getByRole("button", { name: role })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "PARTNER" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "PM" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("sends the pressed role for this person", async () => {
    renderRow({ person: person({ id: "u7" }), roleAtNextSignIn: "PM" });
    await press("ADMIN");
    expect(setRoleAction).toHaveBeenCalledWith("u7", "ADMIN");
  });

  it("does not re-send the role already stored", async () => {
    renderRow({ person: person({ role: "PM" }), roleAtNextSignIn: "PM" });
    await press("PM");
    expect(setRoleAction).not.toHaveBeenCalled();
  });

  /**
   * The server refuses more than the page can predict — a race that leaves one
   * admin, a row demoted from under this render. The refusal has to land on the
   * row rather than disappearing.
   */
  it("shows the server's refusal on the row", async () => {
    setRoleAction.mockImplementation(async () => ({
      ok: false,
      error: "This is the last remaining ADMIN.",
    }));
    renderRow({ person: person({ role: "ADMIN" }), roleAtNextSignIn: "ADMIN" });
    await press("PM");
    expect(screen.getByText(/last remaining ADMIN/)).toBeTruthy();
  });
});

describe("rows that cannot be changed say why", () => {
  it("states that a configured admin is set in ADMIN_EMAILS, before anything is pressed", () => {
    renderRow({
      person: person({ role: "ADMIN", email: "harshit@biome.in" }),
      roleAtNextSignIn: "ADMIN",
      configuredAdmin: true,
    });
    expect(screen.getByText(/ADMIN_EMAILS/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("states that the last ADMIN is the last one, before anything is pressed", () => {
    renderRow({ person: person({ role: "ADMIN" }), roleAtNextSignIn: "ADMIN", lastAdmin: true });
    expect(screen.getByText(/last remaining ADMIN/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  // The stated-off form still has to say what the role *is*, or the row loses
  // the column it was fixed in.
  it("still reads the stored role when the control is off", () => {
    renderRow({ person: person({ role: "ADMIN" }), roleAtNextSignIn: "ADMIN", lastAdmin: true });
    expect(screen.getByRole("cell", { name: /stored role ADMIN/i })).toBeTruthy();
  });

  it("leaves an ordinary row pressable", () => {
    renderRow({ person: person(), roleAtNextSignIn: "PM" });
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

/**
 * KTD7. Sessions are JWT-strategy and carry the role in the token, so a stored
 * change cannot reach a live session — the person keeps the role they signed in
 * with until that session ends. The page says so rather than implying the change
 * is immediate; this note is the sentence that does it, and it lives beside the
 * control it qualifies so it cannot drift away from it.
 */
describe("what the page promises", () => {
  it("says a change applies at the next sign-in", () => {
    render(<RoleChangeNote />);
    expect(screen.getByText(/next sign-in/i)).toBeTruthy();
  });

  it("does not claim the change is immediate", () => {
    const { container } = render(<RoleChangeNote />);
    expect(container.textContent).not.toMatch(/immediately|right away|at once|takes effect now/i);
  });
});
