/**
 * The write side of user management: who holds an account, and what role they
 * hold (R2, R4, R6).
 *
 * One of the two services not about the deal record, and one of the two whose
 * permission check narrows anything (the other is extraction tuning, in
 * extractionConfig.ts) — since U1 every role authors, so `assertMayAuthor`
 * admits everybody and the ADMIN-only gates are the ones left standing.
 *
 * Like the capture services, this takes the acting user as an argument rather
 * than reading the session, so the suite can drive it directly. lib/actions.ts
 * is where the session is read, and it uses `requireRole(Role.ADMIN)` — not
 * `requireAuthor`, which after U1 would let a PM through.
 */

import * as z from "zod";
import { Prisma, Role } from "@prisma/client";

import { db } from "@/lib/db";
import { isConfiguredAdmin } from "@/lib/adminEmails";
import { assertMayManageUsers, type Actor } from "@/lib/authz";
import { RuleViolation } from "@/lib/domain/rules";

/**
 * Validated against Prisma's own `Role`, so the accepted set cannot drift from
 * the column. The role arrives from a button in the browser, which makes it
 * ordinary untrusted input however constrained the UI looks.
 */
export const SetRoleInput = z.object({
  userId: z.string().trim().min(1, "Say which person."),
  role: z.enum(Role, "That is not a role."),
});

export async function setRole(actor: Actor, raw: unknown): Promise<void> {
  assertMayManageUsers(actor);
  const input = SetRoleInput.parse(raw);

  const target = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true },
  });
  if (!target) throw new RuleViolation(`no such person: ${input.userId}`, "userId");

  /**
   * R4 / AE2. A configured address is promoted to ADMIN on every sign-in
   * (lib/auth.ts writes the role back), so a demotion here is not a change that
   * lasts — it is a row that reads wrong until that person next signs in, which
   * may be days. Refused before anything is written, rather than written and
   * repaired later: the people page renders the stored role, so accepting the
   * write would make the page lie for the whole interval.
   *
   * The control is also rendered in a stated-off form for these rows, but that
   * is a courtesy, not the boundary. A server action is a public endpoint.
   */
  if (isConfiguredAdmin(target.email) && input.role !== Role.ADMIN) {
    throw new RuleViolation(
      `${target.email} is configured in ADMIN_EMAILS, so their role cannot be changed here. ` +
        "Remove the address from ADMIN_EMAILS first.",
      "role",
    );
  }

  try {
    await db.$transaction(
      async (tx) => {
        /**
         * Re-read inside the transaction rather than trusting the lookup above.
         *
         * Whether this is a demotion decides whether the count below runs at
         * all, so a stale "they are already a PM" would skip the guard entirely
         * and let the last ADMIN go. Reading it here puts that decision under
         * the same snapshot as the count.
         */
        const current = await tx.user.findUnique({
          where: { id: target.id },
          select: { role: true },
        });
        if (!current) throw new RuleViolation(`no such person: ${target.id}`, "userId");

        /**
         * KTD12. The last ADMIN cannot be demoted.
         *
         * Stored ADMIN rows only — a configured address may belong to someone
         * who has never signed in, so counting them would let the real last
         * admin go on the strength of an account that does not exist yet.
         * PARTNER counts as a demotion the same as PM: the question is whether
         * anyone is left who can manage users, and a partner cannot.
         */
        if (current.role === Role.ADMIN && input.role !== Role.ADMIN) {
          const admins = await tx.user.count({ where: { role: Role.ADMIN } });
          if (admins <= 1) {
            throw new RuleViolation(
              "This is the last remaining ADMIN. Promote someone else first, or add an " +
                "address to ADMIN_EMAILS — otherwise nobody could change roles afterwards.",
              "role",
            );
          }
        }

        await tx.user.update({ where: { id: target.id }, data: { role: input.role } });
      },
      /**
       * Serializable, because the count and the write have to be one decision.
       *
       * At Postgres' default Read Committed, two admins demoting each other at
       * the same moment each read a count of two and both commit — the guard
       * passes twice and the workspace lands on zero admins, which is the exact
       * state KTD12 exists to prevent. Serializable makes the second one a
       * serialization failure instead.
       */
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    /**
     * A lost race is a refused change, not a crash.
     *
     * P2034 is Postgres' 40001 — this transaction read rows another one wrote,
     * so it could not be serialised. Nothing was written and the fix is to look
     * again, so it is reported the way every other refusal is rather than
     * escaping as an infrastructure error the page cannot render.
     */
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      throw new RuleViolation(
        "Someone else changed a role at the same moment. Reload the page and try again.",
        "role",
      );
    }
    throw e;
  }
}
