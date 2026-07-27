/**
 * Every route requires a signed-in user.
 *
 * Built from the edge-safe config only (lib/auth.config.ts) — the Prisma adapter
 * in lib/auth.ts cannot run on the edge runtime. Because sessions are
 * JWT-strategy, verifying the cookie here needs no database.
 *
 * This fails closed: with no auth provider configured, nobody can sign in and
 * the app is inaccessible. That is deliberate — an app holding founder call
 * transcripts should not fall open — but it does mean AUTH_GOOGLE_ID and
 * AUTH_GOOGLE_SECRET are required for a usable deployment, not optional. See
 * the runbook in docs/runbooks.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Everything except the auth endpoints themselves (which must stay reachable
  // to sign in) and Next's own static assets.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
