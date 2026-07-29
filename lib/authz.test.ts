import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import {
  AUTHOR_ROLES,
  type Actor,
  assertMayAuthor,
  assertMayDeleteDeal,
  assertMayManageUsers,
  assertMayReassignDeal,
  canAuthorRecord,
  canDeleteDeal,
  canManageUsers,
  canReadRecord,
  canReassignDeal,
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

  /**
   * With every role authoring, this is the only assertion in the module that
   * refuses anybody — so it is the one whose direction is worth pinning. A
   * flipped condition here would open user management to the whole workspace and
   * break no other test.
   */
  it("asserts in the same direction as it reads", () => {
    expect(() => assertMayManageUsers(actor(Role.ADMIN))).not.toThrow();
    expect(() => assertMayManageUsers(actor(Role.PM))).toThrow(NotAuthorized);
    expect(() => assertMayManageUsers(actor(Role.PARTNER))).toThrow(NotAuthorized);
  });

  it("says which role is required and which one you hold", () => {
    // The message reaches the person as the action's error, so it has to be
    // readable rather than a bare "forbidden".
    expect(() => assertMayManageUsers(actor(Role.PARTNER))).toThrow(/ADMIN/);
    expect(() => assertMayManageUsers(actor(Role.PARTNER))).toThrow(/PARTNER/);
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

describe("handing a deal over", () => {
  it("lets the owner move their own deal", () => {
    expect(canReassignDeal(actor(Role.PM, "pm"), "pm")).toBe(true);
    expect(() => assertMayReassignDeal(actor(Role.PM, "pm"), "pm")).not.toThrow();
  });

  it("refuses an author who does not own the deal", () => {
    expect(canReassignDeal(actor(Role.PM, "pm"), "other")).toBe(false);
    expect(canReassignDeal(actor(Role.PARTNER, "pa"), "other")).toBe(false);
    expect(() => assertMayReassignDeal(actor(Role.PM, "pm"), "other")).toThrow(NotAuthorized);
  });

  it("reserves an unowned deal for an ADMIN — nobody else can claim it", () => {
    expect(canReassignDeal(actor(Role.PM, "pm"), null)).toBe(false);
    expect(canReassignDeal(actor(Role.ADMIN, "ad"), null)).toBe(true);
    expect(() => assertMayReassignDeal(actor(Role.PM, "pm"), null)).toThrow(/no owner/);
  });

  it("lets an ADMIN move a deal they do not own", () => {
    expect(canReassignDeal(actor(Role.ADMIN, "ad"), "pm")).toBe(true);
    expect(() => assertMayReassignDeal(actor(Role.ADMIN, "ad"), "pm")).not.toThrow();
  });

  /**
   * R9's consequence, at the level of the rule rather than a write: the right to
   * move a deal is held by whoever owns it *now*. So the moment a handover lands,
   * the person who performed it can no longer undo it — which is why the control
   * discloses that rather than relying on the reader to work it out.
   */
  it("travels with ownership, so the previous owner cannot take it back", () => {
    const before = actor(Role.PM, "pm");
    const after = actor(Role.PARTNER, "pa");
    expect(canReassignDeal(after, "pa")).toBe(true);
    expect(canReassignDeal(before, "pa")).toBe(false);
  });

  /**
   * The two rules are the same rule on purpose (R9, R10), not by coincidence.
   * Letting any author reassign would let anyone take a deal in order to delete
   * it, which would leave the owner-scoped delete rule enforcing nothing — so a
   * change that widened one without the other would be a hole, and this is what
   * would notice.
   */
  it("is exactly as narrow as the delete rule", () => {
    for (const role of Object.values(Role)) {
      for (const ownerId of ["me", "someone-else", null]) {
        const a = actor(role, "me");
        expect(canReassignDeal(a, ownerId), `${role} / ${ownerId}`).toBe(canDeleteDeal(a, ownerId));
      }
    }
  });
});
