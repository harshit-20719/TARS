import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { NotAuthorized, type Actor } from "@/lib/authz";
import { listPeople } from "@/lib/repo/records";
import { setRole } from "./people";

/**
 * Who holds an account, and who may change what they hold (R2, R4, R6).
 *
 * Every assertion reads the stored row back rather than trusting the return
 * value. The two rules this service exists for — a configured admin cannot be
 * demoted, and the last ADMIN cannot be demoted — fail in the same direction if
 * implemented carelessly: the refusal is reported and the write lands anyway,
 * leaving the page telling the truth about a row that already changed underneath
 * it. Only reading the row afterwards can tell those apart.
 */

let admin: Actor;
const created: string[] = [];

/** The seeded pilot roles, restored after this file has finished moving them. */
const SEEDED: { email: string; role: Role }[] = [
  { email: "harshit.agarwal@biome.in", role: Role.ADMIN },
  { email: "pm@biome.in", role: Role.PM },
  { email: "partner@biome.in", role: Role.PARTNER },
];

async function person(email: string, role: Role, name: string | null = null) {
  const row = await db.user.create({ data: { email, name, role } });
  created.push(row.id);
  return row;
}

const actorFor = (row: { id: string; email: string; name: string | null }): Actor => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: Role.ADMIN,
});

const storedRole = async (id: string) =>
  (await db.user.findUniqueOrThrow({ where: { id }, select: { role: true } })).role;

const adminCount = () => db.user.count({ where: { role: Role.ADMIN } });

/**
 * Force the whole table into a known admin population.
 *
 * The last-ADMIN rule counts every stored ADMIN row in the workspace, so its
 * cases cannot be built out of fixtures of their own — the seeded pilot admin
 * counts too. The suite runs one file at a time (vitest.config.ts sets
 * fileParallelism false) and afterAll puts the seeded roles back.
 */
async function onlyAdmins(ids: string[]) {
  await db.user.updateMany({ data: { role: Role.PM } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { role: Role.ADMIN } });
}

beforeAll(async () => {
  admin = actorFor(await person("u3-actor@biome.in", Role.ADMIN, "Acting Admin"));
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: created } } });
  for (const u of SEEDED) {
    await db.user.update({ where: { email: u.email }, data: { role: u.role } });
  }
});

describe("changing a role", () => {
  it("moves a PM to PARTNER", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const target = await person("u3-promote-partner@biome.in", Role.PM, "Pat Manager");

    await setRole(admin, { userId: target.id, role: "PARTNER" });

    expect(await storedRole(target.id)).toBe(Role.PARTNER);
  });

  it("promotes someone to ADMIN", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const target = await person("u3-promote-admin@biome.in", Role.PM);

    await setRole(admin, { userId: target.id, role: "ADMIN" });

    expect(await storedRole(target.id)).toBe(Role.ADMIN);
  });

  it("refuses a role the column does not have", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const target = await person("u3-bad-role@biome.in", Role.PM);

    // The role reaches the server as a string from a button, so it is untrusted
    // input however constrained the control looks.
    await expect(setRole(admin, { userId: target.id, role: "OWNER" })).rejects.toThrow(
      /not a role/,
    );
    expect(await storedRole(target.id)).toBe(Role.PM);
  });

  it("reports a person who is not there rather than succeeding quietly", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    await expect(setRole(admin, { userId: "no-such-person", role: "PM" })).rejects.toThrow(
      /no such person/,
    );
  });
});

describe("a configured admin", () => {
  /**
   * AE2. The address is promoted on every sign-in (lib/auth.ts writes the role
   * back), so accepting the demotion would not make it stick — it would make the
   * row read wrong until that person next signed in, which may be days. The
   * refusal has to land before the write, not be repaired after it.
   */
  it("cannot be demoted, and the stored row is untouched", async () => {
    vi.stubEnv("ADMIN_EMAILS", "u3-configured@biome.in");
    const target = await person("u3-configured@biome.in", Role.ADMIN, "Configured Admin");

    await expect(setRole(admin, { userId: target.id, role: "PM" })).rejects.toThrow(
      /ADMIN_EMAILS/,
    );

    expect(await storedRole(target.id)).toBe(Role.ADMIN);
  });

  it("cannot be moved to PARTNER either — that is also a demotion", async () => {
    vi.stubEnv("ADMIN_EMAILS", "u3-configured-partner@biome.in");
    const target = await person("u3-configured-partner@biome.in", Role.ADMIN);

    await expect(setRole(admin, { userId: target.id, role: "PARTNER" })).rejects.toThrow(
      /ADMIN_EMAILS/,
    );
    expect(await storedRole(target.id)).toBe(Role.ADMIN);
  });

  /**
   * A row that drifted — configured in ADMIN_EMAILS but stored as PM because it
   * has not been signed into since the address was added. Confirming it as ADMIN
   * is not a demotion, so nothing should stand in the way.
   */
  it("can still be confirmed as ADMIN", async () => {
    vi.stubEnv("ADMIN_EMAILS", "u3-configured-drift@biome.in");
    const target = await person("u3-configured-drift@biome.in", Role.PM);

    await setRole(admin, { userId: target.id, role: "ADMIN" });

    expect(await storedRole(target.id)).toBe(Role.ADMIN);
  });
});

describe("the last ADMIN", () => {
  it("cannot be demoted to PM", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const only = await person("u3-last-pm@biome.in", Role.ADMIN);
    await onlyAdmins([only.id]);

    await expect(
      setRole(actorFor(only), { userId: only.id, role: "PM" }),
    ).rejects.toThrow(/last remaining ADMIN/);

    expect(await storedRole(only.id)).toBe(Role.ADMIN);
  });

  /**
   * PARTNER is a demotion too. A partner authors the record on the same terms as
   * a PM (R5) and manages nobody, so the workspace would be left with no way to
   * change a role — the state the guard exists to prevent, reached by the door
   * that looks less like a demotion.
   */
  it("cannot be demoted to PARTNER either", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const only = await person("u3-last-partner@biome.in", Role.ADMIN);
    await onlyAdmins([only.id]);

    await expect(
      setRole(actorFor(only), { userId: only.id, role: "PARTNER" }),
    ).rejects.toThrow(/last remaining ADMIN/);

    expect(await storedRole(only.id)).toBe(Role.ADMIN);
  });

  /** Demoting yourself is the likeliest way to reach zero, not an exotic case. */
  it("cannot demote themselves with ADMIN_EMAILS empty", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const only = await person("u3-last-self@biome.in", Role.ADMIN, "Solo Admin");
    await onlyAdmins([only.id]);

    await expect(
      setRole(actorFor(only), { userId: only.id, role: "PM" }),
    ).rejects.toThrow(/last remaining ADMIN/);

    expect(await adminCount()).toBe(1);
  });

  /** Not a demotion, so the guard must not stand in the way of a no-op. */
  it("can be set to ADMIN again", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const only = await person("u3-last-noop@biome.in", Role.ADMIN);
    await onlyAdmins([only.id]);

    await setRole(actorFor(only), { userId: only.id, role: "ADMIN" });

    expect(await storedRole(only.id)).toBe(Role.ADMIN);
  });

  /**
   * The count is of stored rows, not of configured addresses. A configured
   * address may belong to someone who has never signed in and so has no row at
   * all — counting it would let the real last admin go on the strength of an
   * account that does not exist.
   */
  it("is still the last one when ADMIN_EMAILS names somebody who has not signed in", async () => {
    vi.stubEnv("ADMIN_EMAILS", "never-signed-in@biome.in");
    const only = await person("u3-last-configured@biome.in", Role.ADMIN);
    await onlyAdmins([only.id]);

    await expect(
      setRole(actorFor(only), { userId: only.id, role: "PM" }),
    ).rejects.toThrow(/last remaining ADMIN/);
  });
});

describe("with two ADMINs", () => {
  it("either may be demoted", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const first = await person("u3-two-a@biome.in", Role.ADMIN);
    const second = await person("u3-two-b@biome.in", Role.ADMIN);

    await onlyAdmins([first.id, second.id]);
    await setRole(actorFor(first), { userId: second.id, role: "PM" });
    expect(await storedRole(second.id)).toBe(Role.PM);

    await onlyAdmins([first.id, second.id]);
    await setRole(actorFor(second), { userId: first.id, role: "PM" });
    expect(await storedRole(first.id)).toBe(Role.PM);
  });

  /**
   * KTD12's reason for the isolation level, as a test.
   *
   * At Read Committed both transactions read a count of two and both commit, and
   * the workspace lands on zero admins with nobody able to change a role. Under
   * Serializable one of them fails to serialise, which `setRole` reports as a
   * refused change.
   *
   * Repeated because whether the two transactions actually overlap is a matter
   * of timing — each call does a lookup before it opens one, and on a warm
   * connection the first can finish inside that lookup. A single round passed
   * against a deliberately weakened Read Committed build; five did not.
   */
  it("cannot both be demoted at the same moment", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const first = await person("u3-race-a@biome.in", Role.ADMIN);
    const second = await person("u3-race-b@biome.in", Role.ADMIN);
    let refused = 0;

    for (let round = 1; round <= 5; round++) {
      await onlyAdmins([first.id, second.id]);

      const results = await Promise.allSettled([
        setRole(actorFor(first), { userId: second.id, role: "PM" }),
        setRole(actorFor(second), { userId: first.id, role: "PM" }),
      ]);
      refused += results.filter((r) => r.status === "rejected").length;

      expect(await adminCount(), `round ${round} left no ADMIN`).toBeGreaterThanOrEqual(1);
    }

    // Whichever way the two land — one serialisation failure, or one late enough
    // to see a count of one — exactly one of the pair has to be turned away.
    expect(refused).toBe(5);
  });
});

describe("only an ADMIN may change a role", () => {
  it("refuses a PM and a PARTNER, and writes nothing", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const target = await person("u3-guard-target@biome.in", Role.PM);
    const asRole = (role: Role): Actor => ({
      id: "someone",
      email: "someone@biome.in",
      name: null,
      role,
    });

    for (const role of [Role.PM, Role.PARTNER]) {
      await expect(
        setRole(asRole(role), { userId: target.id, role: "PARTNER" }),
      ).rejects.toThrow(NotAuthorized);
    }
    expect(await storedRole(target.id)).toBe(Role.PM);
  });
});

describe("listPeople", () => {
  it("returns every account, including one with no name", async () => {
    const nameless = await person("u3-nameless@biome.in", Role.PM);
    const named = await person("u3-named@biome.in", Role.PARTNER, "Named Person");

    const people = await listPeople();
    const byId = new Map(people.map((p) => [p.id, p]));

    // Every row in the table, not only the ones that have signed in or been
    // given a name — a colleague who cannot be seen cannot be given a role.
    expect(people).toHaveLength(await db.user.count());
    expect(byId.get(nameless.id)).toMatchObject({ name: null, email: nameless.email, role: "PM" });
    expect(byId.get(named.id)).toMatchObject({ name: "Named Person", role: "PARTNER" });
    // A plain record, not a Prisma row: the date is already a string.
    expect(typeof byId.get(named.id)!.created).toBe("string");
  });

  it("reads back the role a change just stored", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const target = await person("u3-readback@biome.in", Role.PM);

    await setRole(admin, { userId: target.id, role: "PARTNER" });

    const seen = (await listPeople()).find((p) => p.id === target.id);
    expect(seen?.role).toBe("PARTNER");
  });
});
