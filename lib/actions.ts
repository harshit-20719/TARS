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
import { NotAuthenticated, NotAuthorized } from "@/lib/authz";
import { requireAuthor } from "@/lib/session";
import { RuleViolation } from "@/lib/domain/rules";
import { CodecError } from "@/lib/domain/codec";
import { ExtractionError } from "@/lib/extraction/extract";
import * as capture from "@/lib/services/capture";
import * as judgment from "@/lib/services/judgment";
import type { ScoreValue } from "@/mock/types";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; field?: string };

/**
 * Turn the failures a PM can actually cause into readable results, and let
 * everything else through — a Prisma connection failure is not a validation
 * message and should not be reported as one.
 */
function toResult(e: unknown): { ok: false; error: string; field?: string } {
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return { ok: false, error: first?.message ?? "That input is not valid.", field: String(first?.path?.[0] ?? "") || undefined };
  }
  if (e instanceof RuleViolation) return { ok: false, error: e.message, field: e.field };
  if (e instanceof CodecError) return { ok: false, error: e.message };
  if (e instanceof ExtractionError) return { ok: false, error: e.message };
  if (e instanceof NotAuthorized || e instanceof NotAuthenticated) {
    return { ok: false, error: e.message };
  }
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
    /** Macro-dimensions whose call failed. A partial run still writes the rest. */
    failedBlocks: { label: string; reason: string }[];
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
        failedBlocks: summary.failedBlocks.map((f) => ({ label: f.label, reason: f.reason })),
      },
    };
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
