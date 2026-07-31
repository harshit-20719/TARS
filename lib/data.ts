/**
 * The data seam.
 *
 * The whole front end reads the record through these three functions and nothing
 * else. They used to be synchronous literals in mock/data.ts; they are now
 * database reads. That substitution is the entire point of the seam — no page or
 * component needed a change beyond awaiting the result.
 *
 * mock/data.ts still exists, but its job is now to be the seed fixture source
 * (see prisma/seed.ts) rather than the runtime data source.
 *
 * Each getter opts the calling render into request time via `connection()`.
 * Without it Next prerenders /deals at build and bakes the deal list into the
 * bundle — a deal created after deploy would not appear until the next one.
 * Being request-time is a property of this data source rather than of any
 * individual page, so it is declared here once instead of relying on every
 * future page to remember a route-segment flag.
 *
 * The repository under lib/repo is the same thing without that coupling, which
 * is what the tests and the seed import.
 */

import { cache } from "react";
import { connection } from "next/server";
import * as repo from "@/lib/repo/records";
import type { ReassignCandidate } from "@/lib/repo/records";
import {
  latestDropCountsByRubric,
  listExtractionConfigs,
  type RubricDropCount,
  type RubricExtractionConfig,
} from "@/lib/repo/extractionConfig";
import type { Call, Deal, DealRecord, Person } from "@/mock/types";

export type { ReassignCandidate, RubricDropCount, RubricExtractionConfig };

/**
 * Every deal, or only the ones a given account holds (R7, KTD9).
 *
 * The filter is passed through to the query rather than applied here, so the
 * seam stays as thin as the rest of it and "Mine" keeps working once the list is
 * longer than one page.
 */
export async function listDeals(ownerId?: string): Promise<Deal[]> {
  await connection();
  return repo.listDeals(ownerId);
}

/**
 * Memoised per request, because the deal layout and the page inside it both need
 * the same record.
 *
 * Every route under /deals/[dealId] renders inside a layout that already fetched
 * the deal and its record, and then fetches them again for itself — sibling
 * server components cannot pass props to each other, so each one asks. Without
 * this, opening any deal page paid for the whole record twice, and
 * `revalidateDeal` busts that layout cache on nearly every mutation, so it
 * recurred through ordinary use rather than only on a cold load.
 *
 * React's `cache` is scoped to one render, so this folds the duplicates into a
 * single query and shares nothing between requests. `connection()` still runs on
 * the first call, so the request-time opt-in below is unchanged.
 */
export const getDeal = cache(async (id: string): Promise<Deal | undefined> => {
  await connection();
  return repo.getDeal(id);
});

export const getRecord = cache(async (id: string): Promise<DealRecord | undefined> => {
  await connection();
  return repo.getRecord(id);
});

/**
 * The transcripts themselves, for the one page that shows them.
 *
 * A fourth function at the seam rather than a flag on `getRecord`, so that the
 * cost is visible at the call site: a page that reads this is asking for tens of
 * kilobytes per call, and it should be obvious which page that is.
 */
export async function getCalls(dealId: string): Promise<Call[]> {
  await connection();
  return repo.getCallsWithTranscripts(dealId);
}

/**
 * Everyone who holds an account, for the people page (R2).
 *
 * The first thing at this seam that is not the deal record. It belongs here for
 * the same reason the others do: a page that reads it must be request-time, or a
 * colleague who signed in after the last deploy would not appear on it.
 */
export async function listPeople(): Promise<Person[]> {
  await connection();
  return repo.listPeople();
}

/**
 * Who a deal can be handed to (R8).
 *
 * Deliberately not `listPeople`: the picker needs a name and an id, and this
 * control renders for every author while the people page is ADMIN-only. The type
 * travels with it so the control can import both from the seam.
 */
export async function listReassignCandidates(): Promise<ReassignCandidate[]> {
  await connection();
  return repo.listReassignCandidates();
}

/**
 * Every rubric's extraction tuning, for the admin page (U11).
 *
 * Always six entries in framework order, with the default shape synthesized for
 * any rubric nobody has tuned (KTD15) — the page renders a section per rubric
 * either way. Request-time for the same reason as the rest of the seam: a save
 * must be visible on the next load, not the next deploy. Memoised like
 * `getDeal`, so a layout and its page asking in one render share the query.
 */
export const getExtractionConfigs = cache(async (): Promise<RubricExtractionConfig[]> => {
  await connection();
  return listExtractionConfigs();
});

/**
 * What each rubric's last extraction dropped, for the same page (R20).
 *
 * Kept separate from the tuning read rather than folded into it: one is what an
 * admin writes and the other is what the machine reported, and joining them
 * here would make a page that only wants the text pay for the run history.
 */
export const getLatestDropCounts = cache(async (): Promise<RubricDropCount[]> => {
  await connection();
  return latestDropCountsByRubric();
});
