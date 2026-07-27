/**
 * The Node-runtime half of the auth setup: the Prisma adapter plus the
 * development-only credentials provider.
 *
 * Production signs in with Google SSO restricted to the Biome domain. The
 * credentials provider exists so that a local checkout and the test suite can
 * authenticate without OAuth secrets, and it is registered only when
 * AUTH_DEV_CREDENTIALS is explicitly "true" — the guard below additionally
 * refuses to enable it in a production build, so an env var set by accident on
 * Vercel cannot open a password door.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { isConfiguredAdmin } from "@/lib/adminEmails";

const devCredentialsEnabled =
  process.env.AUTH_DEV_CREDENTIALS === "true" && process.env.NODE_ENV !== "production";

const devCredentials = Credentials({
  id: "dev-credentials",
  name: "Development sign-in",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(raw) {
    const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
    const password = typeof raw?.password === "string" ? raw.password : "";
    if (!email || !password) return null;

    const user = await db.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return null;
    if (!(await compare(password, user.passwordHash))) return null;

    // The role travels on the returned user so the jwt callback never needs a
    // database round trip (it also runs on the edge).
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers: devCredentialsEnabled
    ? [...authConfig.providers, devCredentials]
    : authConfig.providers,
  events: {
    /**
     * Persist the ADMIN_EMAILS decision to the row.
     *
     * The session already got the right role from the jwt callback, so this is
     * about keeping the database honest: score and slide attribution is read
     * back by user, and a row claiming PM for someone operating as an admin
     * would make the audit trail lie. Runs here rather than in the shared config
     * because it touches Prisma, which the edge runtime cannot load.
     */
    async signIn({ user }) {
      if (!user?.email || !isConfiguredAdmin(user.email)) return;
      await db.user.updateMany({
        where: { email: user.email, role: { not: Role.ADMIN } },
        data: { role: Role.ADMIN },
      });
    },
  },
});
