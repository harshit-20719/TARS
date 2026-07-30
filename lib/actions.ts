"use server";

/**
 * Server actions — the only place auth and cache invalidation live.
 *
 * Each one does the same three things: establish who is acting, delegate to a
 * service, and revalidate the affected pages. The logic itself is in
 * lib/services, which is why these stay this thin and why the tests exercise the
 * services directly instead of trying to fake a request.
 *
 * Errors come back as values rather than thrown, so a form can render "call 2
 * already exists for this deal" next to the field instead of blowing up the
 * route. Programmer errors are not swallowed — only the typed domain, auth, and
 * validation failures are.
 */

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { Prisma, Role } from "@prisma/client";
import { signOut } from "@/lib/auth";
import { NotAuthenticated, NotAuthorized } from "@/lib/authz";
import { requireAuthor, requireRole } from "@/lib/session";
import { RuleViolation } from "@/lib/domain/rules";
import { CodecError } from "@/lib/domain/codec";
/**
 * Both error types come from their module's types file, not its client:
 * recognising a failure here must not pull the network client — the Anthropic
 * SDK on one side, the fetch wrapper and its credential read on the other —
 * into every module that imports an action.
 */
import { ExtractionError } from "@/lib/extraction/types";
import { FirefliesError, type MeetingPage } from "@/lib/fireflies/types";
import * as capture from "@/lib/services/capture";
import * as importing from "@/lib/services/import";
import * as judgment from "@/lib/services/judgment";
import * as people from "@/lib/services/people";
import type { ScoreValue } from "@/mock/types";

/**
 * A refused save. Declared once so `toResult` and `ActionResult` cannot drift —
 * they did, the moment `reauth` was added to only one of them.
 */
export type ActionFailure = { ok: false; error: string; field?: string; reauth?: true };

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | ActionFailure;

/**
 * Turn a database failure into a sentence, rather than into nothing.
 *
 * This is describeApiFailure (lib/extraction/extract.ts) applied to the other
 * half of the write path, and it exists because the argument made there was
 * only half-applied. `toResult` rethrows what it does not recognise, and a
 * rethrown error reaches the browser as React's "an unexpected response was
 * received from the server" with the message stripped — so the failure most
 * likely to happen on a cold serverless function was also the one that said
 * nothing at all. Extraction made that expensive rather than merely annoying:
 * the model is called *before* the transaction, so a refused write means the
 * tokens were already paid for and the PM is told only that something went
 * wrong.
 *
 * The Prisma message is deliberately not passed through. An initialization
 * failure quotes the connection string it could not reach, and DATABASE_URL
 * carries the password. The error *code* is safe and is the one thing worth
 * showing: it is what turns a support conversation into a lookup.
 *
 * Not exported, and it cannot be: this module is `"use server"`, where every
 * export is compiled into a callable server action and must therefore be async.
 * A sync helper here fails the build rather than silently shipping.
 */
function describeDatabaseFailure(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientInitializationError) {
    return "the database could not be reached, so nothing was saved.";
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      /** Our own ceiling: the transaction could not start or did not finish in time. */
      case "P2024":
      case "P2028":
        return (
          "the database took too long to accept the write, so nothing was saved. " +
          "The transcript is still here — try again."
        );
      case "P1001":
      case "P1002":
      case "P1008":
      case "P1017":
        return "the database was unreachable or too slow to answer, so nothing was saved.";
      /**
       * The schema the code expects is not the schema the database has, which
       * on this project means a migration that never ran. Naming it is the
       * difference between a five-minute fix and an afternoon.
       */
      case "P2021":
      case "P2022":
        return `the database is missing something this build expects (${e.code}) — a migration has not been applied.`;
      default:
        return `the database refused the write (${e.code}), so nothing was saved.`;
    }
  }
  if (
    e instanceof Prisma.PrismaClientUnknownRequestError ||
    e instanceof Prisma.PrismaClientRustPanicError
  ) {
    return "the database failed in a way this app does not recognise, so nothing was saved.";
  }
  /**
   * Null rather than a catch-all sentence, so PrismaClientValidationError — a
   * malformed query, which is a code bug and not something a PM can act on —
   * keeps falling through to the rethrow.
   */
  return null;
}

/**
 * Turn the failures a PM can act on into readable results, and let genuine
 * programmer errors through.
 *
 * Database failures are translated rather than rethrown — not because they are
 * validation messages, but because the alternative is a message-less error. See
 * describeDatabaseFailure.
 */
function toResult(e: unknown): ActionFailure {
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return { ok: false, error: first?.message ?? "That input is not valid.", field: String(first?.path?.[0] ?? "") || undefined };
  }
  if (e instanceof RuleViolation) return { ok: false, error: e.message, field: e.field };
  if (e instanceof CodecError) return { ok: false, error: e.message };
  if (e instanceof ExtractionError) return { ok: false, error: e.message };
  /**
   * Alongside ExtractionError for the same reason: everything below rethrows,
   * and a rethrown error leaves the action as React's generic render failure
   * with the message stripped. A mistyped Fireflies key, a meeting that was
   * recorded but never transcribed, a rate limit — all of them are things the
   * person pressing the button can act on, and all of them would otherwise
   * arrive as "an error occurred".
   */
  if (e instanceof FirefliesError) return { ok: false, error: e.message };
  /**
   * Flagged separately from NotAuthorized because the two need different
   * answers. A wrong role is a fact the person cannot act on; an ended session
   * is one they can, by signing in again — and R23 makes the second routine
   * where it previously never happened at all.
   */
  if (e instanceof NotAuthenticated) {
    return { ok: false, error: e.message, reauth: true };
  }
  if (e instanceof NotAuthorized) return { ok: false, error: e.message };
  /**
   * Last, so a service that already translated its own P2002 into a
   * RuleViolation ("call 2 already exists") keeps the better message and only
   * the failures nobody anticipated land here.
   */
  const db = describeDatabaseFailure(e);
  if (db) return { ok: false, error: db };
  throw e;
}

const revalidateDeal = (dealId: string) => {
  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`, "layout");
};

// -------------------------------------------------------------------- deals

export async function createDealAction(raw: unknown): Promise<ActionResult<string>> {
  try {
    const actor = await requireAuthor();
    const dealId = await capture.createDeal(actor, raw);
    revalidatePath("/deals");
    return { ok: true, data: dealId };
  } catch (e) {
    return toResult(e);
  }
}

export async function updateDealAction(dealId: string, raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await capture.updateDeal(actor, dealId, raw);
    revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Hand a deal to another account holder (R8, R9, R10).
 *
 * `requireAuthor` and not `requireRole(Role.ADMIN)`, because the rule is about
 * ownership rather than role: the owner of a deal may move it whatever their
 * role, and an ADMIN may move any. `reassignDeal` asserts that, which is the
 * boundary — the control is rendered for everyone, since `ownerId` is not on the
 * `Deal` record contract and the page has no way to know who owns it.
 *
 * `revalidateDeal` covers both halves of what changed: the deal page's sidebar
 * names the owner, and /deals is where the "Mine" filter reads it — for the
 * account losing the deal as much as the one gaining it.
 */
export async function reassignDealAction(
  dealId: string,
  ownerId: string,
): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await capture.reassignDeal(actor, dealId, { ownerId });
    revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Delete a deal and everything on it.
 *
 * Redirects rather than revalidating: the page the user is standing on no longer
 * exists, so re-rendering it would 404. The client navigates on `ok`.
 */
export async function deleteDealAction(dealId: string): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await capture.deleteDeal(actor, dealId);
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// -------------------------------------------------------- calls & extraction

export async function addCallAction(raw: unknown): Promise<ActionResult<string>> {
  try {
    const actor = await requireAuthor();
    const callId = await capture.addCall(actor, raw);
    const dealId = (raw as { dealId?: string })?.dealId;
    if (dealId) revalidateDeal(dealId);
    return { ok: true, data: callId };
  } catch (e) {
    return toResult(e);
  }
}

export async function runExtractionAction(
  callId: string,
  options: { force?: boolean } = {},
): Promise<
  ActionResult<{
    observations: number;
    claims: number;
    /** Quotes the model returned that were not literally in the transcript. */
    droppedQuotes: string[];
    /**
     * Macro-dimensions whose call failed. A partial run still writes the rest.
     * `kind` is what lets the button tell a failure a re-run can fix from one
     * it cannot (KTD6) — "terminal" must not render a re-run invitation.
     */
    failedBlocks: { label: string; reason: string; kind: string }[];
  }>
> {
  try {
    const actor = await requireAuthor();
    const summary = await capture.runExtractionForCall(actor, callId, { force: options.force });
    revalidatePath("/deals", "layout");
    return {
      ok: true,
      data: {
        observations: summary.observationsWritten,
        claims: summary.claimsWritten,
        /**
         * The dropped quotes themselves, not just a count.
         *
         * A count says "3 dropped as not verbatim", which reads as housekeeping. The
         * text says which three, and that is what reveals the actual failure mode —
         * a model tidying grammar as it quotes. Without seeing them, a thin
         * extraction looks like a quiet transcript.
         */
        droppedQuotes: summary.droppedQuotes,
        failedBlocks: summary.failedBlocks.map((f) => ({ label: f.label, reason: f.reason, kind: f.kind })),
      },
    };
  } catch (e) {
    return toResult(e);
  }
}

// ------------------------------------------------------- fireflies import

/**
 * What the picker may ask the shared account for.
 *
 * Declared because a server action's argument is a deserialized browser payload
 * whatever its TypeScript type says, and this one was the only new action taking
 * it on trust. The ceilings are the picker's own — 50 is Fireflies' page limit,
 * and a search term longer than a couple of hundred characters is not a founder's
 * name — so nothing legitimate is turned away by them.
 */
const ListMeetingsRequest = z.object({
  search: z.string().trim().max(200).optional(),
  /**
   * `YYYY-MM-DD`, pinned by a pattern rather than left as a free string.
   *
   * The value is interpolated into a GraphQL variable of Fireflies' `DateTime`
   * type, so a malformed one comes back as a query error naming their schema —
   * a confusing way to learn you typed the date wrong. Refusing it here turns
   * that into the field-level message the picker already knows how to render.
   */
  fromDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional(),
  toDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional(),
  /**
   * Enums rather than free strings: both reach the client as behaviour, and one
   * of them (`searchField`) decides which GraphQL argument the term is sent as.
   * A value outside the set is a caller error, refused here.
   */
  searchField: z.enum(["both", "title", "participants"]).optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

/**
 * The meetings the picker lists (R11).
 *
 * `requireAuthor` like every other action here, and worth being explicit about
 * what that does and does not do: since U1 every role authors, so this refuses
 * nobody who is signed in (KTD11). What it does refuse is a signed-out caller —
 * and the whole shared Fireflies account sits behind it, which is why a read
 * gets the same guard the writes have rather than none.
 *
 * `raw: unknown`, parsed, and then the three fields named individually — the
 * shape `runExtractionAction` uses for the one option it forwards. Spreading
 * what arrived was the bug: `listFirefliesMeetings` took its injected Fireflies
 * client out of the same object, so a `client` key in the payload reached the
 * service's dependency slot. Parsing strips it, and picking the three fields
 * means a later option added to the service is not silently settable from a
 * browser either.
 *
 * Nothing is revalidated: this reads Fireflies, not the record.
 */
export async function listFirefliesMeetingsAction(
  raw: unknown = {},
): Promise<ActionResult<MeetingPage>> {
  try {
    const actor = await requireAuthor();
    const { search, fromDate, toDate, searchField, sort, limit, skip } =
      ListMeetingsRequest.parse(raw);
    const page = await importing.listFirefliesMeetings(actor, {
      search,
      fromDate,
      toDate,
      searchField,
      sort,
      limit,
      skip,
    });
    return { ok: true, data: page };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Import one chosen meeting onto a deal (R14, R15, R24, R25).
 *
 * The result carries the new call's id and number and stops there. The service
 * returns no transcript, and this restates the two fields rather than spreading
 * what it was handed, so a later change to the service's return cannot start
 * shipping a founder call back through a server-action response.
 */
export async function importFirefliesCallAction(raw: unknown): Promise<
  ActionResult<{ callId: string; number: number }>
> {
  try {
    const actor = await requireAuthor();
    const imported = await importing.importFirefliesCall(actor, raw);
    const dealId = (raw as { dealId?: string })?.dealId;
    if (dealId) revalidateDeal(dealId);
    return { ok: true, data: { callId: imported.callId, number: imported.number } };
  } catch (e) {
    return toResult(e);
  }
}

export async function deleteCallAction(dealId: string, callId: string): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await capture.deleteCall(actor, callId);
    revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ------------------------------------------------------------------- review

export async function decideObservationAction(
  dealId: string,
  observationId: string,
  raw: unknown,
): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await capture.decideObservation(actor, observationId, raw);
    revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ------------------------------------------------------------------- scores

export async function setScoreAction(input: {
  dealId: string;
  subDimensionKey: string;
  value: ScoreValue;
  /** Omitted on the normal path — the service cites the row's own evidence. */
  evidenceObsIds?: string[];
  flag?: boolean;
  flagNote?: string;
}): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await capture.setScore(actor, input);
    revalidateDeal(input.dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function clearScoreAction(
  dealId: string,
  subDimensionKey: string,
): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await capture.clearScore(actor, dealId, subDimensionKey);
    revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// ----------------------------------------------------------------- judgment

export async function setSlideAction(raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await judgment.setSlide(actor, raw);
    const dealId = (raw as { dealId?: string })?.dealId;
    if (dealId) revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function clearSlideAction(dealId: string, slideKey: string): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await judgment.clearSlide(actor, dealId, slideKey);
    revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function setFounderTypeReadAction(raw: unknown): Promise<ActionResult> {
  try {
    const actor = await requireAuthor();
    await judgment.setFounderTypeRead(actor, raw);
    const dealId = (raw as { dealId?: string })?.dealId;
    if (dealId) revalidateDeal(dealId);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// -------------------------------------------------------------------- people

/**
 * Change someone's role (R2, R6).
 *
 * `requireRole(Role.ADMIN)` and not `requireAuthor`, which every other action in
 * this module uses. Since U1 authoring is open to all three roles, so
 * `requireAuthor` refuses nobody signed in — copying the shape above would have
 * left user management open to a PM. `setRole` asserts the same permission
 * again, which is why the mistake would not have shown in what a caller sees:
 * only "the service was never reached" tells the two apart, which is what
 * lib/actions.test.ts asserts.
 *
 * Revalidates the people page rather than the deal paths `revalidateDeal`
 * covers: no deal changed, and the row whose role moved is on one page only.
 */
export async function setRoleAction(userId: string, role: string): Promise<ActionResult> {
  try {
    const actor = await requireRole(Role.ADMIN);
    await people.setRole(actor, { userId, role });
    revalidatePath("/admin/people");
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

// -------------------------------------------------------------------- session

/**
 * Sign out.
 *
 * Lives here rather than being called from the component because this module
 * declares itself the only place auth lives, and `signOut` needs the Node-runtime
 * half of the setup (lib/auth.ts) that the browser cannot reach.
 *
 * Returns nothing: `signOut` redirects, so there is no result for a caller to
 * branch on and no cache to revalidate — the destination is the sign-in page.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
