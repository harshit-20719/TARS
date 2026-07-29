/**
 * Who may write what — the permission rules, with no dependency on the auth
 * library.
 *
 * The framework's authorship rule (spec §4.4, R5) is not a UI preference — it is
 * what makes the record mean anything. The machine drafts and renders; a person
 * authors every score and every slide. The split that matters is machine versus
 * human, not one human role versus another — so authorship is checked on the
 * server on every mutation, rather than by hiding a button.
 *
 * This module is deliberately free of imports from lib/auth: the services check
 * permissions constantly, and making them transitively depend on next-auth would
 * drag an HTTP-request-shaped library into pure domain code (and into every test
 * that touches a mutation). Reading the session lives next door in
 * lib/session.ts.
 */

import { Role } from "@prisma/client";

/**
 * Roles permitted to author the record — every role there is.
 *
 * A partner authors on the same terms as a PM (R5): they take the escalated
 * calls and their read is worth recording, and attribution rather than
 * permission is what keeps the record honest about who did the work. So the
 * role is a label describing who someone is, not a rule constraining them, and
 * the product has no way to express read-only access at all.
 *
 * This constant is the only place that decides. `canAuthorRecord`,
 * `assertMayAuthor`, `requireAuthor`, and `canDeleteDeal` all read it, so a
 * future read-only role becomes an omission here rather than 24 edits.
 */
export const AUTHOR_ROLES: readonly Role[] = [Role.PM, Role.PARTNER, Role.ADMIN];

export const canAuthorRecord = (role: Role): boolean => AUTHOR_ROLES.includes(role);

export const canManageUsers = (role: Role): boolean => role === Role.ADMIN;

/** Every authenticated role may read a deal record. */
export const canReadRecord = (_role: Role): boolean => true;

export class NotAuthenticated extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "NotAuthenticated";
  }
}

export class NotAuthorized extends Error {
  constructor(message = "Your role does not permit this.") {
    super(message);
    this.name = "NotAuthorized";
  }
}

export interface Actor {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

/** Throw unless this actor may author the record. Used by every mutation. */
export function assertMayAuthor(actor: Actor): void {
  if (!canAuthorRecord(actor.role)) {
    throw new NotAuthorized(
      `Authoring the record is limited to ${AUTHOR_ROLES.join(" and ")}; ` +
        `you are signed in as ${actor.role}.`,
    );
  }
}

/**
 * Throw unless this actor may manage people. The one thing role still gates.
 *
 * Since U1 every role authors the record, so `assertMayAuthor` narrows nothing —
 * which leaves this as the only assertion here that refuses anybody. It is
 * spelled as an `assertMay*` sibling rather than left as the bare predicate
 * because that is the shape every service reaches for, and a caller writing
 * `if (!canManageUsers(...))` by hand is a caller who can forget the `!`.
 */
export function assertMayManageUsers(actor: Actor): void {
  if (!canManageUsers(actor.role)) {
    throw new NotAuthorized(
      `Managing people is limited to ${Role.ADMIN}; you are signed in as ${actor.role}.`,
    );
  }
}

/**
 * Owner-or-ADMIN — the shape both of the deal-scoped permissions take.
 *
 * Shared rather than written twice, because the two rules being identical is a
 * decision and not a coincidence (R9, R10). Deleting is owner-scoped; if
 * reassignment were merely author-scoped, anyone could take a deal in order to
 * delete it and the delete rule would enforce nothing. Widening one without the
 * other is the hole, so there is one predicate to widen.
 *
 * A deal with no owner — the fixtures, which carry a display name rather than a
 * user relation — is ADMIN-only under both: nobody can claim it.
 */
function ownsDealOrIsAdmin(actor: Actor, ownerId: string | null): boolean {
  if (actor.role === Role.ADMIN) return true;
  return canAuthorRecord(actor.role) && ownerId !== null && ownerId === actor.id;
}

/**
 * Deleting a whole deal record is a narrower permission than editing one.
 *
 * Authoring is a shared activity — any PM may score any deal, which is what makes
 * a second read possible. Destroying the record is not: it takes every score,
 * slide, and accepted observation with it, and there is no undo. So a PM may
 * delete a deal they own (their own practice run, a duplicate they opened by
 * mistake) and an ADMIN may delete any. A PM cannot delete someone else's work.
 */
export function canDeleteDeal(actor: Actor, ownerId: string | null): boolean {
  return ownsDealOrIsAdmin(actor, ownerId);
}

export function assertMayDeleteDeal(actor: Actor, ownerId: string | null): void {
  if (!canDeleteDeal(actor, ownerId)) {
    throw new NotAuthorized(
      ownerId === null
        ? "This deal has no owner, so only an ADMIN can delete it."
        : "You can only delete a deal you own. Ask an ADMIN to remove someone else's.",
    );
  }
}

/**
 * Handing a deal to another account holder (R8, R9).
 *
 * The same rule as deleting, for the reason above — and with one consequence
 * worth stating where the rule lives, because the UI has to disclose it: the
 * right travels with the deal. The instant a handover lands, the person who
 * performed it is no longer the owner and can no longer move it back. The
 * handover is recoverable, just not by them.
 */
export function canReassignDeal(actor: Actor, ownerId: string | null): boolean {
  return ownsDealOrIsAdmin(actor, ownerId);
}

export function assertMayReassignDeal(actor: Actor, ownerId: string | null): void {
  if (!canReassignDeal(actor, ownerId)) {
    throw new NotAuthorized(
      ownerId === null
        ? "This deal has no owner, so only an ADMIN can hand it over."
        : "You can only hand over a deal you own. Ask its owner or an ADMIN to move it.",
    );
  }
}
