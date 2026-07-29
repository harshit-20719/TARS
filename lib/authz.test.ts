import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import {
  AUTHOR_ROLES,
  type Actor,
  assertMayAuthor,
  assertMayDeleteDeal,
  canAuthorRecord,
  canDeleteDeal,
  canManageUsers,
  canReadRecord,
  NotAuthorized,
} from "./authz";

/**
 * The permission rules on their own, with no database and no services.
 *
 * capture.test.ts and judgment.test.ts prove that the services enforce these
 * through real writes. This file pins the rules themselves, which is where the
 * PARTNER change (R5) actually lives — one entry in a constant, read by 24
 * enforcement points that never mention PARTNER by name.
 */

const actor = (role: Role, id = "u1"): Actor => ({
  id,
  email: `${id}@biome.in`,
  name: null,
  role,
});

describe("authoring", () => {
  it("admits all three roles — a partner authors on the same terms as a PM", () => {
    expect(canAuthorRecord(Role.PM)).toBe(true);
    expect(canAuthorRecord(Role.PARTNER)).toBe(true);
    expect(canAuthorRecord(Role.ADMIN)).toBe(true);
  });

  it("lets a PARTNER past assertMayAuthor", () => {
    expect(() => assertMayAuthor(actor(Role.PARTNER))).not.toThrow();
  });

  /**
   * Every member of Role is now an author, so this guard narrows nothing today
   * (KTD11). It stays as the barrier a future read-only role would need, and
   * this assertion is what would notice if the enum grew one silently.
   */
  it("covers every role in the enum, so no role is left unable to author", () => {
    const roles = Object.values(Role);
    expect([...AUTHOR_ROLES].sort()).toEqual([...roles].sort());
  });
});

describe("user management", () => {
  it("stays ADMIN-only — the one privilege U1 does not widen", () => {
    expect(canManageUsers(Role.PARTNER)).toBe(false);
    expect(canManageUsers(Role.PM)).toBe(false);
    expect(canManageUsers(Role.ADMIN)).toBe(true);
  });
});

describe("reading", () => {
  it("is open to every authenticated role", () => {
    expect(canReadRecord(Role.PARTNER)).toBe(true);
  });
});

describe("deleting a deal", () => {
  // Both directions matter: before U1 a partner failed on role, so a test that
  // only checks the non-owner case would keep passing while proving nothing
  // about ownership.
  it("lets a PARTNER delete a deal they own", () => {
    expect(canDeleteDeal(actor(Role.PARTNER, "pa"), "pa")).toBe(true);
    expect(() => assertMayDeleteDeal(actor(Role.PARTNER, "pa"), "pa")).not.toThrow();
  });

  it("refuses a PARTNER a deal owned by someone else", () => {
    expect(canDeleteDeal(actor(Role.PARTNER, "pa"), "pm")).toBe(false);
    expect(() => assertMayDeleteDeal(actor(Role.PARTNER, "pa"), "pm")).toThrow(NotAuthorized);
  });

  it("refuses a PARTNER an unowned deal, as it refuses a PM", () => {
    expect(canDeleteDeal(actor(Role.PARTNER, "pa"), null)).toBe(false);
    expect(canDeleteDeal(actor(Role.PM, "pm"), null)).toBe(false);
    expect(() => assertMayDeleteDeal(actor(Role.PARTNER, "pa"), null)).toThrow(/no owner/);
  });

  it("lets an ADMIN delete any deal, owned or not", () => {
    expect(canDeleteDeal(actor(Role.ADMIN, "ad"), "pm")).toBe(true);
    expect(canDeleteDeal(actor(Role.ADMIN, "ad"), null)).toBe(true);
  });
});
