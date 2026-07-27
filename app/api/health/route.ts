/**
 * Deployment health check.
 *
 * Written because diagnosing a deployment through a dashboard, second-hand,
 * costs several round trips per question — and Auth.js deliberately reports
 * configuration problems to the browser as a single vague sentence. This answers
 * "is the config actually there, and does the database answer" in one request.
 *
 * It reports **presence, never values**: booleans for each variable, a count for
 * the admin list, and a reachable/unreachable for the database. No secret, no
 * connection string, and no email address is echoed. That is a deliberate line —
 * an endpoint that has to stay reachable while sign-in is broken cannot be
 * allowed to leak anything worth having.
 *
 * Unauthenticated on purpose (and excluded from the middleware matcher): it is
 * most needed precisely when authentication is the thing that is broken.
 */

import { db } from "@/lib/db";
import { adminEmails } from "@/lib/adminEmails";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth.config";

// Never prerender or cache — the whole point is the live state of this instance.
export const dynamic = "force-dynamic";

export async function GET() {
  const present = (v: string | undefined) => Boolean(v && v.trim());

  const env = {
    DATABASE_URL: present(process.env.DATABASE_URL),
    AUTH_SECRET: present(process.env.AUTH_SECRET),
    AUTH_GOOGLE_ID: present(process.env.AUTH_GOOGLE_ID),
    AUTH_GOOGLE_SECRET: present(process.env.AUTH_GOOGLE_SECRET),
    ADMIN_EMAILS: present(process.env.ADMIN_EMAILS),
    ANTHROPIC_API_KEY: present(process.env.ANTHROPIC_API_KEY),
  };

  let database: "reachable" | "unreachable" = "unreachable";
  let databaseError: string | undefined;
  let tables = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = "reachable";
    // Migrations having run is a separate question from the database answering.
    await db.user.count();
    tables = true;
  } catch (e) {
    // Prisma error messages can carry the host but not credentials; trim anyway.
    databaseError = String(e instanceof Error ? e.message : e)
      .split("\n")[0]
      .slice(0, 160);
  }

  const canSignIn = env.AUTH_SECRET && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET;

  const missing = [
    !env.AUTH_SECRET && "AUTH_SECRET",
    !env.AUTH_GOOGLE_ID && "AUTH_GOOGLE_ID",
    !env.AUTH_GOOGLE_SECRET && "AUTH_GOOGLE_SECRET",
    !env.ADMIN_EMAILS && "ADMIN_EMAILS (nobody will be an admin)",
  ].filter(Boolean);

  return Response.json(
    {
      ok: canSignIn && tables,
      // Confirms which commit this instance is actually running, which settles
      // "did my redeploy pick up the change" without reading build logs.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      env,
      // Surfaced because a sign-in that clears Google can still be refused here,
      // and the message Auth.js shows for that does not say which domain it wanted.
      allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
      expectedCallbackUrl: `${process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ""}/api/auth/callback/google`,
      adminEmailCount: adminEmails().length,
      database,
      migrationsApplied: tables,
      ...(databaseError ? { databaseError } : {}),
      canSignIn,
      ...(missing.length ? { missing } : {}),
      extractionEnabled: env.ANTHROPIC_API_KEY,
    },
    { status: 200 },
  );
}
