import type { DealRecord } from "@/mock/types";
import { ALL_SUBS, TOTAL_SUBS, PILLARS, TRACKS } from "@/framework";
import { unevidencedCount } from "./coverage";

/** The floor rows, resolved once — ten of the forty-one carry a floor rule. */
const FLOOR_SUBS = ALL_SUBS.filter((s) => s.floor);

/** Progress across the PM flow, derived from the record (R13). */
export function progressOf(rec: DealRecord) {
  const scored = rec.scores.length;
  const complete = rec.scores.filter((s) => s.evidenceObsIds.length > 0).length;
  const slides = rec.slides.length;
  const totalSlides = PILLARS.length + TRACKS.length;
  const activeObs = rec.observations.filter((o) => o.status !== "rejected").length;

  /**
   * Unconfirmed low-confidence filings — the observations still waiting on a
   * person (KTD19).
   *
   * Every observation files itself as evidence now; nothing waits in a queue,
   * so status cannot carry this count any more. What still represents work a
   * person has is the filings the machine was unsure about that nobody has
   * ruled on: low confidence, no decider. Confirming, moving, or rejecting one
   * sets the decider and takes it out of the count. Rejected rows are excluded
   * whatever they carry — there is nothing left to look at — and legacy rows
   * (pre-confidence drafts) carry no confidence, so they never counted as
   * unsure and do not now.
   */
  const needsReview = rec.observations.filter(
    (o) => o.confidence === "low" && !o.decidedById && o.status !== "rejected",
  ).length;

  const byKey = new Map(rec.scores.map((s) => [s.subDimensionKey, s]));
  const floorScored = FLOOR_SUBS.filter((s) => byKey.has(s.key)).length;
  const floorTripped = FLOOR_SUBS.filter((s) => {
    const sc = byKey.get(s.key);
    return sc && sc.value === s.floor!.breachAt;
  });
  const killTripped = floorTripped.filter((s) => s.floor!.weight === "kill").length;

  return {
    scored,
    total: TOTAL_SUBS,
    complete,
    incomplete: scored - complete,
    slides,
    totalSlides,
    activeObs,
    needsReview,
    calls: rec.calls.length,
    claims: rec.claims.length,
    floorTotal: FLOOR_SUBS.length,
    floorScored,
    floorTripped: floorTripped.length,
    killTripped,
    /**
     * Rows holding no evidence yet — the sidebar badge, and only that.
     *
     * A single pass, deliberately: this function runs inside a per-deal loop on
     * the deals index, so the three-state per-call grid stays in lib/coverage
     * rather than making the index pay for data one page reads (KTD5).
     */
    unevidenced: unevidencedCount(rec),
    hasTranscript: rec.calls.length > 0,
    hasDrafts: rec.observations.length > 0,
    scorecardReady: slides > 0,
  };
}

export interface StepView {
  seg: string;
  name: string;
  href: string;
  done: boolean;
  state: string;
  /** Something needs attention here — rendered as a warning rather than progress. */
  alert?: boolean;
}

export function stepsFor(dealId: string, rec: DealRecord): StepView[] {
  const p = progressOf(rec);
  const base = `/deals/${dealId}`;
  const mk = (seg: string, name: string, done: boolean, state: string): StepView => ({
    seg,
    name,
    href: seg ? `${base}/${seg}` : base,
    done,
    state,
  });
  /**
   * Review is not in here any more (R14). Nothing queues on that page — every
   * observation files itself as evidence — so "visit it between transcript and
   * capture, then be done" stopped being true of it. It re-registers below as a
   * reading of the record, alongside the floor and coverage.
   */
  return [
    mk("", "Overview", false, ""),
    mk("transcript", "Transcript & calls", p.hasTranscript, p.calls ? `${p.calls} call${p.calls > 1 ? "s" : ""}` : "—"),
    mk("capture", "Capture scoring", p.total > 0 && p.scored >= p.total, `${p.scored}/${p.total}`),
    mk("judgment", "Judgment slides", p.slides >= p.totalSlides, `${p.slides}/${p.totalSlides}`),
    mk("scorecard", "Scorecard", false, p.scorecardReady ? "ready" : "—"),
  ];
}

/**
 * Cross-cutting views, kept out of the numbered flow.
 *
 * The floor, the ledger, coverage, and extraction quality are not steps — they
 * are readings of the same record from a different angle, and a PM visits them
 * whenever the question comes up rather than at a fixed point. Numbering them
 * would imply an order that is not real, and would make the flow eight steps
 * long for no gain.
 */
export function viewsFor(dealId: string, rec: DealRecord): StepView[] {
  const p = progressOf(rec);
  const base = `/deals/${dealId}`;
  return [
    {
      seg: "floor",
      name: "Floor check",
      href: `${base}/floor`,
      done: p.floorScored === p.floorTotal && p.floorTripped === 0,
      state:
        p.killTripped > 0
          ? `${p.killTripped} tripped`
          : p.floorScored < p.floorTotal
            ? `${p.floorScored}/${p.floorTotal}`
            : p.floorTripped > 0
              ? "condition"
              : "clear",
      alert: p.killTripped > 0,
    },
    {
      seg: "claims",
      name: "Claim ledger",
      href: `${base}/claims`,
      done: false,
      state: p.claims > 0 ? `${p.claims}` : "—",
    },
    {
      seg: "coverage",
      name: "Coverage",
      href: `${base}/coverage`,
      /**
       * Never done, whatever the count (R20). Deriving `done` from a zero
       * unevidenced count would paint a completion tick on a reading the
       * framework says must never read as a gate — the claim ledger is
       * registered the same way, for the same reason.
       */
      done: false,
      state: p.unevidenced > 0 ? `${p.unevidenced} unevidenced` : "none unevidenced",
    },
    {
      /**
       * What the last extraction actually did — the reading the review step
       * became (R14, KTD16). The segment keeps its old name so every stored
       * link to /review still lands.
       *
       * The state carries the unconfirmed low-confidence count, the way
       * coverage's carries its unevidenced one: five of six capture blocks
       * render collapsed, so this is the one place the number stays visible
       * without expanding them. Never done, like coverage — a quality reading
       * must never read as a gate. And no `alert`: the floor's flags a
       * kill-tripped deal, a verdict-shaped fact, while unconfirmed filings
       * are ordinary work and a failed block already reads as such on the
       * page and the transcript card (R23 — presented, not nagged about).
       */
      seg: "review",
      name: "Extraction quality",
      href: `${base}/review`,
      done: false,
      state: p.needsReview > 0 ? `${p.needsReview} unconfirmed` : "none unconfirmed",
    },
  ];
}
