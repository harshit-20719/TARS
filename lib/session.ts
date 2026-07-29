/**
 * Reading the signed-in user out of the request.
 *
 * Separated from lib/authz so that the permission rules stay importable without
 * dragging in next-auth. Only lib/actions.ts (and any future route handler) needs
 * this file; the services take an Actor as an argument instead.
 */

import { cache } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRole } from "@/lib/adminEmails";
import { AUTHOR_ROLES, NotAuthenticated, NotAuthorized, type Actor } from "@/lib/authz";
import type { Role } from "@prisma/client";

/**
 * The signed-in user, or null.
 *
 * **The role comes from the database, not the token.** The token carries one
 * too, stamped at sign-in, but a role that only refreshes at sign-in is a role
 * that stays wrong for as long as the session lives — and the sharpest version
 * of that is a demoted ADMIN, who kept ADMIN authority for up to the twelve-hour
 * absolute bound and could simply promote themselves back before it expired.
 * Every guard in the app reads this Actor, so correcting it here corrects all of
 * them at once rather than patching the one endpoint where it was noticed.
 *
 * `resolveRole` still applies, so an ADMIN_EMAILS address outranks the stored
 * row exactly as it does at sign-in.
 *
 * The cost is one indexed primary-key read per request, not per call site:
 * `auth()` is not memoised by next-auth — each call rebuilds the request, parses
 * the cookie, decrypts and verifies the JWT, runs both callbacks and re-signs
 * the token — and TopBar renders from the root layout, so before this cache
 * every page paid for all of that at least twice. React's `cache` is scoped to a
 * single render, so it dedupes within one request and shares nothing across
 * them.
 *
 * A missing row means signed out. Someone whose row was deleted mid-session
 * loses this request rather than keeping stale authority — though deleting a row
 * still does not revoke access in any lasting way, because the sign-in path
 * requires no pre-existing row and recreates them on the next attempt.
 */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;

  const row = await db.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (!row) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: resolveRole(user.email, row.role),
  };
});

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
