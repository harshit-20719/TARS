/**
 * The Prisma client, as a singleton.
 *
 * Next.js reloads modules on every edit in development, and each reload would
 * otherwise open a fresh connection pool until Postgres refuses new clients.
 * Stashing the instance on globalThis survives the reload. In production the
 * module is evaluated once per serverless instance, so the global is skipped and
 * the client is left to be reused across warm invocations of the same instance.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
