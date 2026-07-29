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
   * Observations still waiting on a person.
   *
   * A confidently mapped observation files itself as evidence now, so "drafts" no
   * longer means "everything the machine wrote" — it means the mappings it was
   * unsure about. That is the number worth putting in front of a PM, because it is
   * the only one that represents work they still have to do.
   */
  const needsReview = rec.observations.filter((o) => o.status === "draft").length;

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
  return [
    mk("", "Overview", false, ""),
    mk("transcript", "Transcript & calls", p.hasTranscript, p.calls ? `${p.calls} call${p.calls > 1 ? "s" : ""}` : "—"),
    /**
     * Review is an exception queue now, so "done" means the queue is empty rather
     * than that somebody visited the page — and a deal with no unsure mappings is
     * done without anybody going there, which is the point of the change.
     */
    mk(
      "review",
      "Review exceptions",
      p.hasDrafts && p.needsReview === 0,
      p.needsReview > 0 ? `${p.needsReview} to place` : p.hasDrafts ? "clear" : "—",
    ),
    mk("capture", "Capture scoring", p.total > 0 && p.scored >= p.total, `${p.scored}/${p.total}`),
    mk("judgment", "Judgment slides", p.slides >= p.totalSlides, `${p.slides}/${p.totalSlides}`),
    mk("scorecard", "Scorecard", false, p.scorecardReady ? "ready" : "—"),
  ];
}

/**
 * Cross-cutting views, kept out of the numbered flow.
 *
 * The floor and the ledger are not steps — they are readings of the same record
 * from a different angle, and a PM visits them whenever the question comes up
 * rather than at a fixed point. Numbering them would imply an order that is not
 * real, and would make the flow eight steps long for no gain.
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
  ];
}
