/**
 * Who is an admin, decided by configuration rather than by a database edit.
 *
 * The alternative — everyone signs in as a PM and then someone runs UPDATE
 * "User" SET role = 'ADMIN' — needs database console access at exactly the moment
 * you are least likely to have it set up. An environment variable is something
 * the operator can change from the Vercel dashboard, takes effect on next
 * sign-in, and is visible in one place.
 *
 * Deliberately free of any Prisma value import: this module is read by the auth
 * config that middleware runs on the edge, where the Prisma client cannot go.
 * Roles are plain strings here for that reason.
 */

export type RoleName = "PM" | "PARTNER" | "ADMIN";

/** Emails listed in ADMIN_EMAILS, normalised. Comma- or whitespace-separated. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when this address is configured as an admin.
 *
 * An empty ADMIN_EMAILS means nobody is an admin — which is the safe direction to
 * fail, since the alternative default (first user wins, or everyone is an admin)
 * hands out user management by accident.
 */
export function isConfiguredAdmin(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

/**
 * The role a signing-in user should hold.
 *
 * Configured admins are promoted. Everyone else keeps whatever the database says,
 * defaulting to PM — so a partner demoted to read-only in the database stays
 * read-only, and a new Biome colleague signing in for the first time can author
 * the record without anyone provisioning them.
 */
export function resolveRole(email: string | null | undefined, stored?: RoleName | null): RoleName {
  if (isConfiguredAdmin(email)) return "ADMIN";
  return stored ?? "PM";
}
