import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

/**
 * The action layer's guard on user management (R6).
 *
 * Nothing imported lib/actions.ts before this file. That was defensible while
 * every action shared one guard and the services were tested directly — but the
 * people actions are the first whose guard differs from the rest of the module,
 * and copying the module's house style would have produced `requireAuthor`,
 * which since U1 admits every role.
 *
 * The service is mocked, so the assertions are about what this module refuses on
 * its own rather than what lib/services/people refuses afterwards. That
 * distinction is the whole point of the file: `setRole` asserts the same
 * permission again, so a wrong guard here is invisible in the result value — both
 * paths return a refusal. Only "the service was never reached" tells them apart.
 *
 * lib/auth is mocked rather than lib/session, so `requireRole` itself is the real
 * thing under test; the mock only decides who is signed in.
 */

let signedIn: { user: { id: string; email: string; name: string | null; role: Role } } | null =
  null;

const setRole = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});

vi.mock("@/lib/auth", () => ({
  auth: async () => signedIn,
  signOut: async () => {},
}));

vi.mock("@/lib/services/people", () => ({
  setRole: (...a: unknown[]) => setRole(...a),
}));

const { setRoleAction } = await import("./actions");

const signInAs = (role: Role) => {
  signedIn = { user: { id: `u-${role}`, email: `${role.toLowerCase()}@biome.in`, name: null, role } };
};

beforeEach(() => setRole.mockClear());
afterEach(() => {
  signedIn = null;
});

describe("setRoleAction", () => {
  it("refuses a PM and a PARTNER without reaching the service", async () => {
    for (const role of [Role.PM, Role.PARTNER]) {
      signInAs(role);

      const result = await setRoleAction("someone", "ADMIN");

      expect(result.ok, `${role} was let through`).toBe(false);
      expect(setRole, `${role} reached the service`).not.toHaveBeenCalled();
    }
  });

  /**
   * A PARTNER is the case that matters. They author everything a PM does since
   * U1, so `requireAuthor` waves them through — and user management is the one
   * thing their role is meant to stop.
   */
  it("tells a PARTNER it is their role, not an ended session", async () => {
    signInAs(Role.PARTNER);

    const result = await setRoleAction("someone", "ADMIN");

    expect(result.ok === false && result.error).toMatch(/ADMIN/);
    expect(result.ok === false && result.reauth).toBeUndefined();
  });

  it("asks a signed-out caller to sign in again rather than reporting a wrong role", async () => {
    signedIn = null;

    const result = await setRoleAction("someone", "ADMIN");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reauth).toBe(true);
    expect(setRole).not.toHaveBeenCalled();
  });

  it("lets an ADMIN through to the service", async () => {
    signInAs(Role.ADMIN);

    // Deliberately not awaiting the result: past the service call this action
    // revalidates, which throws outside a request context. What is being pinned
    // is that the guard admits an ADMIN at all — the write itself is covered
    // against a real database in lib/services/people.test.ts.
    await setRoleAction("someone", "PARTNER").catch(() => {});

    expect(setRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.ADMIN }),
      { userId: "someone", role: "PARTNER" },
    );
  });
});
