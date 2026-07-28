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

import { connection } from "next/server";
import * as repo from "@/lib/repo/records";
import type { Call, Deal, DealRecord } from "@/mock/types";

export async function listDeals(): Promise<Deal[]> {
  await connection();
  return repo.listDeals();
}

export async function getDeal(id: string): Promise<Deal | undefined> {
  await connection();
  return repo.getDeal(id);
}

export async function getRecord(id: string): Promise<DealRecord | undefined> {
  await connection();
  return repo.getRecord(id);
}

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
