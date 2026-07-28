---
name: TARS
last_updated: 2026-07-28
---

# TARS Strategy

## Target problem

Every layer of a deal re-covers the ground the last one did — the product head asks what the PM already asked, then partners surface differentiation nobody examined — because nothing structured survives a call. Judgment gets made on a read that goes undocumented, so the next person restarts instead of deepening, and the cost lands at the end: deals stuck in limbo, late exits, and a PM realising while writing the IC note that a question was never asked.

## Our approach

Decisions and their reasons live where the evidence does. Today a judgment is typed into a Google Doc in Drive, away from the transcript that produced it — so reasoning goes unlinked, intermediate reads go undocumented because writing a doc costs too much, and nobody can see what was never covered. TARS makes the reason structural: a score cites the quotes it rests on, a slide carries the line naming what capped it. Judgment stays human-authored throughout, because a machine that scored deals would be faster and would delete the reasoning that is the entire point.

## Who it's for

**Primary:** The PM — an investment analyst carrying a deal. They run the screening call, own the initial assessment, do the desk work or direct interns through it, fold partner reads back into the documents, and author or sign off everything partners review. They're hiring TARS to know what the record actually establishes and what it doesn't — at any point, not at IC.

**Secondary:** Partners, the product head among them. They take escalated calls, direct PMs, and later build the co-creation plan for a spin-out. They touch the tool least and gain most per minute: arriving at a call already knowing what is covered and what is thin.

## Key metrics

- **How late a hygiene kill surfaces** — which call number a floor breach shows up on. Today it lands after a product head's and partners' time is spent; the target is call one. Computable from the record, since every observation carries a call number.
- **Gaps caught before the next call** — how often a PM finds an unexamined area in time to act on it, rather than while writing the IC note. Read from coverage being opened ahead of a call.
- **Escalated calls that leave a record** — the share of partner and tech-operator calls that leave a structured read behind, against zero today. *Not measurable until L2 structural reads ship.*
- **Deals run in TARS rather than a Drive doc** — the adoption bet itself. If PMs still write the Google Doc, every other number here looks healthy on a sample that doesn't matter. Counted by hand.

## Tracks

### Capture cheaper than the shortcut

Transcripts arriving from Fireflies instead of the clipboard, coverage showing which rubrics hold no evidence yet, and the identity and ownership a team needs to share the tool.

_Why it serves the approach:_ It is the wedge — if running a deal through TARS costs a PM more than typing the Drive doc, none of the rest happens.

### Verification that leaves a record

Claims sharpened with the founder and proven or refuted, structural reads bracketing each escalated call, and the layer comparison that shows what changed. The desk work — market intel, product deep-dives, financial models — sits inside this track as a shaped process that facilitates verification, not a freeform folder.

_Why it serves the approach:_ It attacks the step where the most senior time is spent and nothing is written down.

### Framework fidelity

Folding Srini's outstanding changes into the encoded rubric without invalidating scores already set. The build started on a conditional green light and his time is hard to get, so the framework will keep moving underneath the product.

_Why it serves the approach:_ A record is only worth accumulating if a score stays interpretable after the rubric it was set against has changed. Every score is stamped with `rubricVersion`, though nothing reads it yet — making that stamp mean something is part of this track. Most changes fold in freely; a row moving between scored and binary does not, which is why D5's Market-size call has to land before real deals are scored.

## Not working on

- A machine that scores deals. It would be faster per deal and would delete the reasoning the product exists to keep.
- Any gate verdict — pass/fail, go/no-go. Spec D1 leaves the thresholds Pending; the roll-up renders facts only.
- Calibration across deals, founders and PMs. Where this leads, and explicitly not the wedge.
- A read-only role. Every role authors; the product has no way to express read-only and no plan to add one.
