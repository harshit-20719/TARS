import type { DealRecord } from "@/mock/types";
import { TOTAL_SUBS, PILLARS, TRACKS } from "@/framework";

/** Progress across the PM flow, derived from the record (R13). */
export function progressOf(rec: DealRecord) {
  const scored = rec.scores.length;
  const complete = rec.scores.filter((s) => s.evidenceObsIds.length > 0).length;
  const slides = rec.slides.length;
  const totalSlides = PILLARS.length + TRACKS.length;
  const activeObs = rec.observations.filter((o) => o.status !== "rejected").length;
  return {
    scored,
    total: TOTAL_SUBS,
    complete,
    incomplete: scored - complete,
    slides,
    totalSlides,
    activeObs,
    calls: rec.calls.length,
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
    mk("review", "Review drafts", p.hasDrafts, p.hasDrafts ? `${p.activeObs} obs` : "—"),
    mk("capture", "Capture scoring", p.total > 0 && p.scored >= p.total, `${p.scored}/${p.total}`),
    mk("judgment", "Judgment slides", p.slides >= p.totalSlides, `${p.slides}/${p.totalSlides}`),
    mk("scorecard", "Scorecard", false, p.scorecardReady ? "ready" : "—"),
  ];
}
