/**
 * Importing a call from Fireflies: list the workspace's meetings, and turn one
 * chosen meeting into an attributed call on a deal.
 *
 * Its own module rather than part of capture.ts, whose header declares that file
 * the write side of capture. This one is mostly a read of somebody else's system
 * and exactly one write, and it is the only place in the app that reaches a third
 * party on a *list* rather than on a submit.
 *
 * Three things are load-bearing.
 *
 * **Nothing is fetched until the import is known to be legal.** Every refusal —
 * the meeting is already here, the call number is taken, the deal is gone — is
 * settled before the transcript is asked for. Any other order pulls a full
 * recording out of the shared account for an import that then fails, and leaves
 * nothing behind saying who pulled it, because the `Call` row that carries the
 * attribution is never written. Retrieval is the thing being attributed, so an
 * unattributed retrieval is the failure, not an inefficiency.
 *
 * **Choosing is a person's job (R15).** There is no title match, no "looks like
 * this deal", no automatic attach. A meeting reaches a deal because somebody
 * picked it.
 *
 * **The client is injected, resolved here if it is not** — the same arrangement
 * `resolveClient` makes in lib/extraction/extract.ts, so the suite drives this
 * with a stub and no test run can reach a workspace full of founder calls.
 */

import * as z from "zod";

import { db } from "@/lib/db";
import { assertMayAuthor, type Actor } from "@/lib/authz";
import { RuleViolation } from "@/lib/domain/rules";
import { createFirefliesClient } from "@/lib/fireflies/client";
import type {
  FirefliesClient,
  FirefliesMeeting,
  ListMeetingsOptions,
} from "@/lib/fireflies/types";
import { addCall, assertCallNumberFree, isUniqueViolationOn } from "@/lib/services/capture";

export interface FirefliesOptions {
  /** Injected by the tests; constructed from the environment otherwise. */
  client?: FirefliesClient;
}

/**
 * Constructed per call, never memoised at module scope.
 *
 * A module-level client would read FIREFLIES_API_KEY at import time, which would
 * make importing this module — from lib/actions.ts, which every action goes
 * through — fail on a deployment that has no Fireflies key at all. The
 * credential belongs to the request that uses it.
 */
function resolveClient(injected?: FirefliesClient): FirefliesClient {
  return injected ?? createFirefliesClient();
}

/**
 * The meetings the picker draws (R11).
 *
 * Every meeting on the shared account, because there is nothing to narrow it
 * with: Biome records every call under one host, so no per-person scope exists
 * to offer and search plus paging is the whole of finding a call. The caller
 * states that to the reader rather than pretending the list is personal — see
 * components/authoring/ImportFromFireflies.tsx.
 *
 * `assertMayAuthor` guards a read, which is unusual here, and today it refuses
 * nobody: every `Role` authors the record (KTD11). It is a regression barrier
 * rather than a control — the day a read-only role exists, listing the
 * workspace's recordings is not something it should be able to do, and this is
 * where that lands.
 *
 * `options` and `deps` are two arguments rather than one intersection, which is
 * the shape `extractFromTranscript` already uses. They were merged, and that put
 * the injection slot inside the object a browser fills: `listFirefliesMeetingsAction`
 * forwards a deserialized payload, so a `client` key smuggled into it landed in
 * the rest-spread — where a plausible-looking object would have been *used* as
 * the Fireflies client. What a caller may say and what the process may be handed
 * are different kinds of thing, and they now arrive through different doors.
 */
export async function listFirefliesMeetings(
  actor: Actor,
  options: ListMeetingsOptions = {},
  deps: FirefliesOptions = {},
): Promise<FirefliesMeeting[]> {
  assertMayAuthor(actor);
  return resolveClient(deps.client).listMeetings(options);
}

export const ImportCallInput = z.object({
  dealId: z.string().trim().min(1),
  meetingId: z.string().trim().min(1, "Choose a meeting to import."),
  /**
   * Supplied the same way a pasted call supplies them (R14). Prefilled by the
   * picker and editable there, but arriving here as ordinary input — an imported
   * call is a call, and the framework's evidence trail does not care how the
   * text got in.
   */
  number: z.coerce.number().int().min(1, "Tag the transcript with a call number."),
  label: z.string().trim().min(1, "Give the call a label."),
  /** The meeting's own date, so an imported call is dated when it happened. */
  date: z.string().trim().optional(),
});

export interface ImportedCall {
  callId: string;
  number: number;
}

/**
 * The refusal the call-number rule cannot cover (AE8).
 *
 * Importing the same meeting again as a *free* number is a legal call in every
 * respect except that the deal already holds this recording, and the PM who is
 * about to file the same quotes twice is the only one who can decide that. It
 * names the number it is already on, because "already imported" without saying
 * where is not something anyone can act on.
 *
 * A function rather than four inline lines because it is asked twice: once
 * before the fetch, and once by whoever loses the race to the unique index that
 * backs it. Both callers then refuse in the same words by construction, rather
 * than by two string literals somebody has to keep in step.
 */
async function assertMeetingNotOnDeal(dealId: string, meetingId: string): Promise<void> {
  const already = await db.call.findFirst({
    where: { dealId, sourceMeetingId: meetingId },
    select: { number: true },
    orderBy: { number: "asc" },
  });
  if (already) {
    throw new RuleViolation(
      `that Fireflies meeting is already on this deal as call ${already.number}`,
      "meetingId",
    );
  }
}

/**
 * Put one chosen meeting on a deal as a call.
 *
 * The return value is deliberately two identifiers and nothing else. The
 * transcript has just crossed a network and been written; sending it back to the
 * browser as well would put a founder call into a server-action response, a
 * React payload, and any log that records one — for a caller whose next move is
 * to re-render the page that already has it.
 */
export async function importFirefliesCall(
  actor: Actor,
  raw: unknown,
  options: FirefliesOptions = {},
): Promise<ImportedCall> {
  assertMayAuthor(actor);
  const input = ImportCallInput.parse(raw);

  /** Every refusal, before the fetch. */
  await assertMeetingNotOnDeal(input.dealId, input.meetingId);
  await assertCallNumberFree(input.dealId, input.number);

  /**
   * The third one, which is easy to miss because it is not a rule — it is
   * `addCall`'s remaining way to fail.
   *
   * A deal deleted while the picker was open (or an id that never existed)
   * reaches the insert as a foreign-key violation, and a foreign-key violation
   * *after* the fetch is precisely the shape this ordering exists to prevent: a
   * founder's recording pulled out of the shared account, and then no `Call` row
   * to say who pulled it. Deletion cascades to the calls, so nothing here can be
   * salvaged from the wreckage afterwards either. One indexed read closes it.
   *
   * The window is genuinely reachable rather than theoretical — deleting a deal
   * is a normal thing to do to a practice run, and the import dialog holds a
   * `dealId` from before it.
   */
  const deal = await db.deal.findUnique({ where: { id: input.dealId }, select: { id: true } });
  if (!deal) {
    throw new RuleViolation("that deal no longer exists, so nothing was imported.", "dealId");
  }

  const transcript = await resolveClient(options.client).fetchTranscript(input.meetingId);

  /**
   * Straight through `addCall`, which re-checks the number it was just given.
   *
   * The second check is not redundant: the fetch above is the longest gap in the
   * app between deciding a number is free and using it, and two PMs importing
   * onto the same deal is exactly the situation this feature creates. It costs
   * one indexed read against a unique index that would refuse the write anyway —
   * with a message about a database constraint rather than about call numbers.
   *
   * The meeting id travels beside the payload rather than inside it. `addCall`'s
   * schema takes what a browser may state about a call; this is the one thing
   * only an importer knows, and keeping it out of the schema is what stops a
   * pasted call claiming it — see `CallProvenance` in lib/services/capture.ts.
   */
  try {
    const callId = await addCall(
      actor,
      {
        dealId: input.dealId,
        number: input.number,
        label: input.label,
        date: input.date,
        transcript,
      },
      { sourceMeetingId: input.meetingId },
    );
    return { callId, number: input.number };
  } catch (e) {
    /**
     * The loser of the race the check above cannot win.
     *
     * A read decides nothing across a network fetch: two PMs importing the same
     * meeting onto the same deal both find it absent, both fetch, and
     * `@@unique([dealId, sourceMeetingId])` refuses the second insert. Asking the
     * same question again is what turns that into the named refusal — the row
     * the winner just wrote is the answer, so the wording, the field, and the
     * call number it points at all come out identical to the pre-flight case
     * rather than being restated here.
     *
     * If the winner has since rolled back there is nothing to name, nothing is
     * thrown, and the original error goes on up rather than being dressed as a
     * rule.
     */
    if (isUniqueViolationOn(e, "sourceMeetingId")) {
      await assertMeetingNotOnDeal(input.dealId, input.meetingId);
    }
    throw e;
  }
}
