/**
 * The edge-safe half of the auth setup.
 *
 * Middleware runs on the edge runtime, where Prisma cannot go. Auth.js therefore
 * wants its config split in two: this file holds everything middleware needs to
 * decide whether a request is signed in, and lib/auth.ts adds the database
 * adapter and the password check on top for the Node runtime.
 *
 * Sessions are JWT-strategy rather than database-backed, because the dev
 * credentials provider requires it. The consequence worth knowing: a role change
 * takes effect on the user's next sign-in, not instantly.
 */

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import type { Role } from "@prisma/client";
import { resolveRole, type RoleName } from "@/lib/adminEmails";

/** Only Biome accounts may sign in with Google. */
export const ALLOWED_EMAIL_DOMAIN = "biome.in";

/**
 * How long a session survives without use. **Seconds** — Auth.js reads this as
 * seconds, and a millisecond value typechecks, builds, and yields a session
 * roughly a year long.
 */
export const IDLE_SESSION_SECONDS = 8 * 60 * 60;

/**
 * How long a session survives at all, in milliseconds, however much it is used.
 *
 * Two bounds are needed because `maxAge` above is only the first one. Under the
 * JWT strategy @auth/core recomputes the expiry and re-signs the token on every
 * session read, so an idle bound never fires for someone who keeps working —
 * which is precisely the person R23 is about. This bound is enforced in the jwt
 * callback instead, by returning null; Auth.js clears the session cookie when it
 * does.
 *
 * Twelve hours sits outside a working day, so people re-authenticate between
 * days rather than mid-deal.
 */
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const authConfig = {
  // Google is registered only when its credentials exist, so a local checkout
  // with no OAuth secrets still boots instead of failing at import time.
  providers: googleConfigured ? [Google] : [],
  session: { strategy: "jwt", maxAge: IDLE_SESSION_SECONDS },
  // Vercel terminates TLS upstream, so the host header has to be trusted for
  // callback URLs to be built correctly.
  trustHost: true,
  callbacks: {
    /**
     * Domain restriction. Anyone with a Google account could otherwise complete
     * the OAuth flow and land inside the deal record.
     */
    signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email = profile?.email;
      if (!email || !email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) return false;
      return profile?.email_verified === true;
    },

    /**
     * Carry the user id and role on the token.
     *
     * `user` is present only on the sign-in request, so the work here happens
     * once per session and never in middleware — which matters because this
     * callback also runs on the edge, where there is no database. The stored role
     * comes off the object the adapter or credentials provider returned; nothing
     * is queried here.
     *
     * ADMIN_EMAILS wins over the stored role, so promoting yourself is a config
     * change rather than a database edit. lib/auth.ts writes the same decision
     * back to the row so the two cannot drift.
     */
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        const stored = (user as { role?: Role }).role;
        token.role = resolveRole(user.email, stored as RoleName | undefined);
        // Stamped here, in the branch that runs only at sign-in, so nothing
        // below re-stamps it on a later pass. That is what makes the bound
        // absolute rather than a second idle window.
        token.signedInAt = Date.now();
      }

      /**
       * The absolute bound (R23). Returning null makes @auth/core clear the
       * session cookie.
       *
       * A token with no stamp predates this bound, and is expired rather than
       * grandfathered: leaving it unbounded would let a session issued before
       * the change outlive the rule indefinitely so long as it stayed in use,
       * which is the exact case R23 exists to close. The cost is that everyone
       * signs in once more when this ships.
       */
      const signedInAt = token.signedInAt;
      if (typeof signedInAt !== "number" || Date.now() - signedInAt >= ABSOLUTE_SESSION_MS) {
        return null;
      }
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },

    /** Used by middleware: every route requires a signed-in user. */
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
  interface User {
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** When this session began, in epoch milliseconds. Set once, at sign-in. */
    signedInAt?: number;
  }
}
