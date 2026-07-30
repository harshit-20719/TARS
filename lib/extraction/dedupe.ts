/**
 * One span, one filing (KTD10) — and no claim lost to the collapse (KTD11).
 *
 * Six blocks each read the whole transcript, so the same passage routinely
 * comes back filed under two rows — and before this pass, both filings were
 * persisted. That was deliberate once: the prompt used to say one passage may
 * be evidence for several rows. The settled decision reverses it. Evidence is
 * structured MECE: a span belongs to its single best row, the prompt now says
 * so, and this pass enforces it on what actually comes back, because six
 * independent calls cannot coordinate however clearly each one is instructed.
 *
 * The rules are small and deterministic:
 *
 * - Two filings are "the same span" when their normalised quotes match. The
 *   row they chose does not enter into it — that is what keying on the quote
 *   alone means, and it drops cross-row evidence by design.
 * - The higher-confidence filing wins. A tie breaks on rubric order — the
 *   order in RUBRICS — so re-running the pass over the same drafts always
 *   keeps the same one.
 * - A claim anchored to a losing filing is re-keyed to the winner, never
 *   dropped. The claim ledger is what L2 verifies against; discarding a claim
 *   because its anchor moved one row over would quietly shrink that ledger.
 *
 * The pass runs in memory, between the verbatim guard and the persistence
 * transaction. Inside the transaction it would spend a time budget already
 * sized against the function ceiling. The one comparison that *must* happen
 * inside the transaction — this run's survivors against another run's
 * persisted rows (R10) — lives in lib/services/capture.ts and reuses
 * `compareFilings` and `anchorKey` from here, so both passes settle a
 * collision by the same rule.
 */

import { RUBRICS } from "@/framework";
import type { DraftClaim, DraftObservation, ExtractionOutput } from "./types";

/**
 * Normalise for comparison only.
 *
 * Collapsing whitespace and folding typographic quotes to their ASCII forms is
 * not a loosening of "verbatim" — transcripts wrap lines arbitrarily, and models
 * routinely return a curly apostrophe where the source had a straight one.
 * Neither changes a single word. Everything else, including case, must match.
 *
 * This is also the whole definition of "the same span". The verbatim guard
 * (extract.ts), this pass, and the claim anchor map in capture.ts all compare
 * through this one function — two normalisers would mean two opinions on
 * sameness, and a claim could then survive one and miss the other.
 */
export function normaliseForComparison(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The key a claim is matched to its anchor observation by: the block that
 * filed it and the span it quotes. Declared once, here, because three places
 * key on it — the verbatim guard's kept-set, this pass's repointing, and the
 * transaction's anchor map — and the bug this fixes was exactly those keys
 * disagreeing: the kept-set keyed on the quote alone, so a claim could survive
 * verification on the strength of another block's observation and then be
 * dropped by the transaction with no counter.
 */
export function anchorKey(rubricKey: string, quote: string): string {
  return `${rubricKey}::${normaliseForComparison(quote)}`;
}

/** Where a block sits in the frozen rubric order. Unknown keys sort last. */
const RUBRIC_ORDER = new Map(RUBRICS.map((r, i) => [r.key, i]));

/**
 * What a collision contest needs to know about a filing — enough to say which
 * one survives, nothing about where it is stored. The persisted rows the
 * cross-run pass reads satisfy it as readily as in-memory drafts do.
 */
export interface SpanFiling {
  rubricKey: string;
  /**
   * Null on rows written before the confidence column existed. Ranked below a
   * stated "low": a filing that cannot say how sure it was does not outrank
   * one that said "unsure" out loud.
   */
  confidence: "high" | "low" | null;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 0, low: 1 };
const rank = (c: SpanFiling["confidence"]) => (c ? CONFIDENCE_RANK[c] : 2);

/**
 * Which of two filings of the same span survives: negative keeps `a`,
 * positive keeps `b` (a sort comparator, so it composes with `sort` and with
 * a running-minimum alike). Higher confidence first; rubric order breaks the
 * tie, which is what makes the outcome deterministic (KTD10) — the winner is a
 * property of the filings, never of the order they arrived in.
 */
export function compareFilings(a: SpanFiling, b: SpanFiling): number {
  const byConfidence = rank(a.confidence) - rank(b.confidence);
  if (byConfidence !== 0) return byConfidence;
  return (
    (RUBRIC_ORDER.get(a.rubricKey) ?? RUBRICS.length) -
    (RUBRIC_ORDER.get(b.rubricKey) ?? RUBRICS.length)
  );
}

/** One filing merged away: which block lost the span, and to which block. */
export interface SpanMerge {
  /** The span both filings quoted, in its normalised form. */
  quote: string;
  losingRubricKey: string;
  winningRubricKey: string;
}

export interface DedupeResult {
  /** The surviving filings, in their original order. */
  observations: DraftObservation[];
  /** Every claim that came in — repointed where its anchor lost, never dropped. */
  claims: DraftClaim[];
  /** Every losing pair, with its winner, for the run's record. */
  merges: SpanMerge[];
  /**
   * Losing filings, attributed to the block that filed them, keyed by rubric
   * key. A key appears only when its block lost something; absent means zero
   * — the same convention as `droppedByBlock` on the extraction result.
   */
  mergedByBlock: Record<string, number>;
}

/**
 * Collapse every set of same-span filings to its one winner, and re-key the
 * claims whose anchors lost. Pure: same drafts in, same survivors out.
 *
 * Within-block duplicates collapse through the same contest (R9): equal
 * confidence and equal rubric order leave the comparator at zero, and the
 * strict less-than below keeps the earliest filing — deterministic, like
 * every other outcome here.
 */
export function dedupeSpans(drafts: ExtractionOutput): DedupeResult {
  // Group filings by the span they quote, in arrival order.
  const bySpan = new Map<string, DraftObservation[]>();
  for (const o of drafts.observations) {
    const span = normaliseForComparison(o.quote);
    const group = bySpan.get(span);
    if (group) group.push(o);
    else bySpan.set(span, [o]);
  }

  const survivors = new Set<DraftObservation>();
  const merges: SpanMerge[] = [];
  const mergedByBlock: Record<string, number> = {};
  /** Losing anchor key → the rubric key a claim anchored there moves to. */
  const repoint = new Map<string, string>();

  for (const [span, group] of bySpan) {
    let winner = group[0];
    for (const contender of group.slice(1)) {
      if (compareFilings(contender, winner) < 0) winner = contender;
    }
    survivors.add(winner);
    for (const loser of group) {
      if (loser === winner) continue;
      merges.push({
        quote: span,
        losingRubricKey: loser.rubricKey,
        winningRubricKey: winner.rubricKey,
      });
      mergedByBlock[loser.rubricKey] = (mergedByBlock[loser.rubricKey] ?? 0) + 1;
      repoint.set(anchorKey(loser.rubricKey, span), winner.rubricKey);
    }
  }

  // Original order, minus the losers — the caller's lists keep their shape.
  const observations = drafts.observations.filter((o) => survivors.has(o));

  const claims = drafts.claims.map((c) => {
    const movedTo = repoint.get(anchorKey(c.rubricKey, c.anchorQuote));
    // Unchanged when its anchor survived — including when the "loser" was a
    // within-block duplicate, where the winner's key equals the claim's own.
    if (movedTo === undefined || movedTo === c.rubricKey) return c;
    return { ...c, rubricKey: movedTo };
  });

  return { observations, claims, merges, mergedByBlock };
}
