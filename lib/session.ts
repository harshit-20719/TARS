/**
 * Reading the signed-in user out of the request.
 *
 * Separated from lib/authz so that the permission rules stay importable without
 * dragging in next-auth. Only lib/actions.ts (and any future route handler) needs
 * this file; the services take an Actor as an argument instead.
 */

import { auth } from "@/lib/auth";
import { AUTHOR_ROLES, NotAuthenticated, NotAuthorized, type Actor } from "@/lib/authz";
import type { Role } from "@prisma/client";

/** The signed-in user, or null. */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email, name: user.name ?? null, role: user.role };
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new NotAuthenticated();
  return actor;
}

/** Require one of the given roles. */
export async function requireRole(...allowed: Role[]): Promise<Actor> {
  const actor = await requireActor();
  if (!allowed.includes(actor.role)) {
    throw new NotAuthorized(
      `This action is limited to ${allowed.join(" or ")}; you are signed in as ${actor.role}.`,
    );
  }
  return actor;
}

/**
 * Shorthand for the common case: authoring the record.
 *
 * Worth knowing before reaching for it — since U1 `AUTHOR_ROLES` is every role
 * there is, so this narrows nothing and refuses nobody who is signed in. It
 * still says what the action needs, and it is the barrier a future read-only
 * role would land on. But an action that means "an ADMIN only" has to say
 * `requireRole(Role.ADMIN)`: copying this one would leave it open to everybody.
 */
export const requireAuthor = (): Promise<Actor> => requireRole(...AUTHOR_ROLES);
