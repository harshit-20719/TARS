import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";

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
 *
 * The signed-in users are real rows, because `currentActor` resolves the role
 * from the database rather than from the token — a change made precisely so a
 * demoted ADMIN cannot keep acting as one. A fake id would now resolve to no
 * actor at all, which is itself the guarantee: authorization here follows the
 * stored row, not what the session claims.
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

/** One real row per role, so the database lookup in `currentActor` resolves. */
const ids: Partial<Record<Role, string>> = {};

beforeAll(async () => {
  // Empty, so resolveRole returns the stored role rather than promoting anyone.
  vi.stubEnv("ADMIN_EMAILS", "");
  for (const role of [Role.PM, Role.PARTNER, Role.ADMIN]) {
    const row = await db.user.upsert({
      where: { email: `actions-${role.toLowerCase()}@biome.in` },
      update: { role },
      create: { email: `actions-${role.toLowerCase()}@biome.in`, name: null, role },
      select: { id: true },
    });
    ids[role] = row.id;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.user.deleteMany({ where: { id: { in: Object.values(ids) as string[] } } });
});

const signInAs = (role: Role) => {
  signedIn = {
    user: { id: ids[role]!, email: `actions-${role.toLowerCase()}@biome.in`, name: null, role },
  };
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

  /**
   * The point of resolving from the database: the session can claim ADMIN and be
   * refused anyway. This is the demoted-admin case — their token still says
   * ADMIN, the stored row says PM, and the row is what decides.
   */
  it("refuses a session claiming ADMIN when the stored row says otherwise", async () => {
    signedIn = {
      user: { id: ids[Role.PM]!, email: "actions-pm@biome.in", name: null, role: Role.ADMIN },
    };

    const result = await setRoleAction("someone", "PARTNER");

    expect(result.ok).toBe(false);
    expect(setRole).not.toHaveBeenCalled();
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
