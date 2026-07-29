import type { DealRecord, Observation } from "@/mock/types";
import { ALL_SUBS, RUBRICS, TOTAL_SUBS } from "@/framework";

/**
 * Which parts of the rubrics the calls so far have actually produced evidence
 * for (R17, R18).
 *
 * L1 allows several calls on one deal, and after the first one the question a PM
 * has is no longer "what did the machine find" but "what have we still not
 * touched". Every observation already records the row it was filed under and the
 * call it came from, so the record has known the answer all along — nothing read
 * it back. It was answered by scrolling the capture grid and remembering.
 *
 * Two things this deliberately is not.
 *
 * It reads **evidence, not questions**. The record knows whether a quote was
 * mapped to a row; it cannot know whether a question was asked, because a founder
 * can answer at length and yield nothing mappable. The states are named for what
 * is recorded so the reading never claims more than it knows.
 *
 * And it **reports, never gates** (R20). No percentage, no threshold, no ready
 * flag — consistent with the framework's rule that the app renders facts and
 * returns no verdict. Spec §3 leaves coverage thresholds deferred; this builds
 * the reading and leaves the gate where it is.
 *
 * Derived, never authored (R19). Nothing here reads or writes a score.
 */

export type CoverageState = "has-evidence" | "evidence-rejected" | "no-evidence";

export interface CoverageRow {
  key: string;
  label: string;
  rubricKey: string;
  rubricLabel: string;
  /** Across every L1 call on the deal. */
  state: CoverageState;
  /** One state per call, aligned to `callNumbers` on the reading. */
  perCall: CoverageState[];
  /** Calls that contributed evidence still standing. */
  callNumbers: number[];
}

export interface CoverageRubricGroup {
  rubricKey: string;
  rubricLabel: string;
  rows: CoverageRow[];
}

export interface CoverageReading {
  rows: CoverageRow[];
  byRubric: CoverageRubricGroup[];
  /** The deal's call numbers in order — the columns `perCall` aligns to. */
  callNumbers: number[];
  /** Rows holding no evidence at all. A count, not a score. */
  unevidenced: number;
}

/** The layer this reading covers. L2 refines the same record rather than replacing it. */
const LAYER = "L1";

/**
 * Every observation on the record, grouped by the row it was filed under.
 *
 * Rejected ones are kept — that is the whole superset argument. Coverage needs
 * them, because a row whose only evidence was thrown out is a different state
 * from a row nobody has evidence on, and dropping them collapses the two.
 *
 * Deliberately **not** filtered by layer: the capture and floor pages consume
 * this and never filtered by layer, so filtering here would change what they
 * render. Coverage applies its own layer filter on top.
 */
export function observationsBySubDimension(rec: DealRecord): Map<string, Observation[]> {
  const bySub = new Map<string, Observation[]>();
  for (const o of rec.observations) {
    const list = bySub.get(o.subDimensionKey);
    if (list) list.push(o);
    else bySub.set(o.subDimensionKey, [o]);
  }
  return bySub;
}

/**
 * The citable subset: rejected observations dropped.
 *
 * This is what the capture and floor pages offer beside each row — a PM cites the
 * quotes that speak to the row being scored, and one they already refused is not
 * a candidate. Both pages built this inline, byte-identically, before it lived
 * here.
 */
export function candidateEvidenceBySubDimension(rec: DealRecord): Map<string, Observation[]> {
  const bySub = new Map<string, Observation[]>();
  for (const o of rec.observations) {
    if (o.status === "rejected") continue;
    const list = bySub.get(o.subDimensionKey);
    if (list) list.push(o);
    else bySub.set(o.subDimensionKey, [o]);
  }
  return bySub;
}

/** No observations at all, all of them rejected, or something still standing. */
function stateOf(observations: Observation[] | undefined): CoverageState {
  if (!observations?.length) return "no-evidence";
  return observations.some((o) => o.status !== "rejected") ? "has-evidence" : "evidence-rejected";
}

export function coverageOf(rec: DealRecord): CoverageReading {
  const atLayer = rec.observations.filter((o) => o.layer === LAYER);

  // Call columns come from the deal's calls, not from the observations, so a call
  // that yielded nothing still gets a column — which is itself worth seeing.
  const callNumbers = [...rec.calls.map((c) => c.number)].sort((a, b) => a - b);

  const bySub = new Map<string, Observation[]>();
  for (const o of atLayer) {
    const list = bySub.get(o.subDimensionKey);
    if (list) list.push(o);
    else bySub.set(o.subDimensionKey, [o]);
  }

  const rows: CoverageRow[] = ALL_SUBS.map((sub) => {
    const observations = bySub.get(sub.key);
    return {
      key: sub.key,
      label: sub.label,
      rubricKey: sub.rubricKey,
      rubricLabel: sub.rubricLabel,
      state: stateOf(observations),
      perCall: callNumbers.map((n) => stateOf(observations?.filter((o) => o.callNumber === n))),
      callNumbers: callNumbers.filter((n) =>
        observations?.some((o) => o.callNumber === n && o.status !== "rejected"),
      ),
    };
  });

  const byKey = new Map(rows.map((r) => [r.key, r]));

  return {
    rows,
    // Framework order, so the page's group headers match the rubric grid.
    byRubric: RUBRICS.map((r) => ({
      rubricKey: r.key,
      rubricLabel: r.label,
      rows: r.subs.map((s) => byKey.get(s.key)!).filter(Boolean),
    })),
    callNumbers,
    unevidenced: rows.filter((r) => r.state === "no-evidence").length,
  };
}

/**
 * The count behind the sidebar badge.
 *
 * Separate from `coverageOf` on purpose (KTD5): app/deals/page.tsx calls
 * `progressOf` inside a per-deal loop over full records, so a 41-row per-call
 * derivation there would make the index pay for data one page reads. This is one
 * pass and no grouping.
 */
export function unevidencedCount(rec: DealRecord): number {
  const evidenced = new Set(
    rec.observations
      .filter((o) => o.layer === LAYER && o.status !== "rejected")
      .map((o) => o.subDimensionKey),
  );
  return TOTAL_SUBS - ALL_SUBS.filter((s) => evidenced.has(s.key)).length;
}
