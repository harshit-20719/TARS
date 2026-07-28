# Concepts

The vocabulary of TARS. These are the framework's terms, with the precise
meaning they carry in this codebase — use them in code, plans, and
conversation rather than synonyms.

Structure comes from Biome's "Idea to Enterprises" framework. Where a term
has a general startup meaning and a narrower one here, the narrower one wins.

---

## Layers

**Layer** — how far a deal has been taken through the framework. `L1`, `L2`,
`L3`, `IC`. Every observation, score, and slide is stamped with the layer it
was authored at, so a later layer refines the same record instead of
replacing it.

**L1 — Conviction** — the first layer. A deal record opens at the first real
call, every sub-dimension is scored for the first time, and claims are
recorded but not verified.

**L2 — Refine & Verify** — where claims are sharpened with the founder and
proven or disproven, and the rubrics that prompted the escalation are
re-scored.

**Escalation** — moving a deal from L1 to L2 because conviction exists but
understanding is thin on specific rubrics. A judgment, never automatic.

---

## The record

**Deal record** (or just **the record**) — everything captured for one deal:
its calls, observations, claims, scores, slides, and founder-type read. Every
view in the app is rendered from it and never authored directly.

**Call** — one founder conversation, tagged with a call number and holding a
transcript. A deal may have several; the call number is how evidence stays
traceable to the conversation it came from.

**Observation** — a verbatim excerpt from a transcript, drafted by the machine
and mapped to one sub-dimension. Never a score, never a summary — the
machine's job is to quote, not to characterize.

**Mapping confidence** — how sure the machine is that a quote belongs to the
row it filed it under. This rates the machine's own filing, never the founder.
A confident mapping files itself; an unsure one goes to a person.

**Claim** — an assertion the founder makes about the world that a later layer
will have to verify: a moat, a capability, a named buyer, a performance
figure. Quote-anchored to the observation it came from.

**Claim ledger** — the full set of claims on a deal, and their status.

**Origin tag** — where a claim came from: `founder-volunteered`,
`founder-confirmed-after-PM-framing`, or `machine-inferred`. Volunteered
carries more weight than extracted.

---

## Capture

**Capture** — the evidence-gathering half of the framework: observations,
claims, and sub-dimension scores. Distinct from judgment.

**Rubric** — one of six assessment areas: Founder & Team, Problem & Market,
Product / Tech & Solution, GTM & Distribution Access, Financial & Legal,
Studio Fit & Co-Develop.

**Sub-dimension** — one scored row inside a rubric. Forty-one in total. Each
is either a 1-to-5 sliding scale or a binary pass/fail.

**Anchor** — the written description of what a 1, 3, or 5 looks like on a
sliding row. Binary rows relabel those columns Fail, Unverified, Pass.

**NE** — "not enough". A sliding-scale sentinel meaning the evidence does not
support any score. Distinct from 1, which is a real and low score.

**Evidence** — the observations a score cites. A score with no evidence saves
but is flagged incomplete.

**Floor** — the binary hygiene rows. A `fail` on one is a floor breach and
drops the deal. Recorded as a fact; the app never returns the verdict.

**Coverage** — which sub-dimensions the calls so far have produced usable
evidence for. Distinguishes a row nobody asked about from one that was asked
about and yielded nothing. Reports; never gates.

---

## Judgment

**Judgment** — the human half: the 0-to-10 reads a PM authors on pillars and
tracks. Never a sub-dimension score copied upward, and never an average.

**Slide** — one 0-to-10 human read on a pillar or track.

**Pillar** — one of seven dimensions of differentiation. Four are **critical**
(the founder must bring them): earned secret, foundational tech, cornered
resource, privileged distribution. Three are **fillable** (the studio can help
build them): go-to-market engine, founder-led storytelling, business-model
innovation.

**Track** — one of three: Idea, Founder/s, Market.

**Lens** — how a slide reads its rooted sub-dimensions. **Peak**: the
strongest verified row sets the ceiling, used where one scarce thing is the
differentiation. **Weakest-link**: the weakest required row caps the slide,
used where the slide is a system and one dead part breaks it.

**Rooted** — the sub-dimensions a given pillar or track draws from.

**Verification cap** — the highest value a slide may be banked at while the
claims behind it are unverified. 6 at L1; the cap lifts at L2 because
verification retires the reason for it.

**Banked value** — the slide value that counts, held under the cap.

**Provisional value** — a higher read recorded alongside it, meaning "this is
what it becomes if the claim verifies". May exceed the cap.

**Ceiling guard** — the one written line naming which sub-dimension held the
slide down and why. The anti-vibe guard: it is what stops a slide being a
feeling. A guard is **confirmed** when a person signed off on that line rather
than leaving the machine's suggestion standing.

**Founder-type read** — the read on what kind of founder this is. Sets the
Founder/s-track floor and is shown as context. Never a verdict.

---

## Output

**Scorecard** — the rendered view of a deal: the capture block, the judgment
block, and the roll-up. Rendered from the record, never authored.

**Roll-up** — the summary facts: how many pillars are exceptional, whether at
least one of those is critical, whether the Founder/s-track floor clears, and
floor status. No total, no composite, no verdict.

**Exceptional** — a pillar or track whose banked slide sits at the layer's
ceiling.

---

## Rules that carry weight

**The authorship rule** — the machine drafts observations and claims and
renders every view. The PM authors every score and every slide. The app never
judges. This is not a UI preference; it is what makes the record mean
anything, so it is enforced on the server on every mutation.

**No total, no verdict** — the framework produces facts, not a number and not
a decision. There is no composite score and no gate pass/fail.

**Layer-stamped from day one** — every score, slide, and observation records
the layer it was authored at, so later layers attach without rework and the
change between layers stays legible.
