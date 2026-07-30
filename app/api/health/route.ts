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
import { RUBRICS } from "@/framework";
import { resolveProvider } from "@/lib/extraction/provider";

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
    GOOGLE_API_KEY: present(process.env.GOOGLE_API_KEY),
    GEMINI_API_KEY: present(process.env.GEMINI_API_KEY),
    FIREFLIES_API_KEY: present(process.env.FIREFLIES_API_KEY),
  };

  /**
   * One resolver decides the provider for every surface (R1, R4) — the health
   * route reports its answer rather than re-deriving it from the env, so what
   * this endpoint says is what extraction will actually do.
   */
  const extraction = resolveProvider();

  /**
   * Shape checks on the Google credentials.
   *
   * A present-but-wrong value looks identical to a correct one through a boolean,
   * and Google answers a malformed client id with "invalid_client / The OAuth
   * client was not found" — which reads like the client was deleted rather than
   * mistyped. The commonest cause is copying the id from the console's truncated
   * list display ("6464…-pipg…") instead of using its copy button.
   *
   * Lengths and suffixes only. A Google client id is public by design — it is
   * sent to the browser on every sign-in — but the secret is not, so that one is
   * only ever checked for its prefix and length.
   */
  const clientId = process.env.AUTH_GOOGLE_ID?.trim() ?? "";
  const clientSecret = process.env.AUTH_GOOGLE_SECRET?.trim() ?? "";
  const googleCredentials = {
    clientIdLength: clientId.length,
    clientIdEndsCorrectly: clientId.endsWith(".apps.googleusercontent.com"),
    clientIdLooksTruncated: clientId.length > 0 && clientId.length < 40,
    secretLength: clientSecret.length,
    secretStartsCorrectly: clientSecret.startsWith("GOCSPX-"),
    // Catches a value pasted with surrounding quotes or a stray newline.
    hasStrayWhitespaceOrQuotes:
      /[\s"']/.test(process.env.AUTH_GOOGLE_ID ?? "") ||
      /[\s"']/.test(process.env.AUTH_GOOGLE_SECRET ?? ""),
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
      googleCredentials,
      expectedCallbackUrl: `${process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ""}/api/auth/callback/google`,
      adminEmailCount: adminEmails().length,
      database,
      migrationsApplied: tables,
      ...(databaseError ? { databaseError } : {}),
      canSignIn,
      ...(missing.length ? { missing } : {}),
      extractionEnabled: extraction.enabled,
      /**
       * Which provider extraction runs on and which model it will use — the two
       * answers a failing extraction raises first: did the cutover take (adding
       * the Gemini key switches provider; deleting it falls back), and did
       * EXTRACTION_MODEL take. Public identifiers, never secrets. The old
       * request-shape field is gone: it printed one provider's parameter names,
       * which on the other provider's deployment answered a question nobody
       * asked with words that did not apply.
       */
      extractionProvider: extraction.provider,
      extractionModel: extraction.model,
      /**
       * How many concurrent calls one extraction makes — one per macro-dimension.
       * Worth reporting because it is the number that decides whether a run fits in
       * the function's time limit, and it is derived from the rubric rather than
       * configured, so it changes if the framework does.
       */
      extractionBlocks: RUBRICS.length,
      /**
       * Whether the transcript page will offer the Fireflies picker at all. The
       * commonest report about this feature is "the import control says it is
       * off", and the variable is Production-only in the runbook — so preview
       * deployments answer false here correctly rather than being broken.
       */
      firefliesImportEnabled: env.FIREFLIES_API_KEY,
    },
    { status: 200 },
  );
}
