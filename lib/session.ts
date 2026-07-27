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

/** Shorthand for the common case: authoring the record. */
export const requireAuthor = (): Promise<Actor> => requireRole(...AUTHOR_ROLES);
