/**
 * Who may write what — the permission rules, with no dependency on the auth
 * library.
 *
 * The framework's authorship rule (spec §4.4, R5) is not a UI preference — it is
 * what makes the record mean anything. The machine drafts; the PM authors every
 * score and every slide; a partner reads. So authorship is checked on the server
 * on every mutation, rather than by hiding a button.
 *
 * This module is deliberately free of imports from lib/auth: the services check
 * permissions constantly, and making them transitively depend on next-auth would
 * drag an HTTP-request-shaped library into pure domain code (and into every test
 * that touches a mutation). Reading the session lives next door in
 * lib/session.ts.
 */

import { Role } from "@prisma/client";

/** Roles permitted to author the record. A PARTNER reads at L1. */
export const AUTHOR_ROLES: readonly Role[] = [Role.PM, Role.ADMIN];

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
