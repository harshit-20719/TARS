# Capture & Scorecard (L1) — Product Spec & Build Brief

**Status:** Draft for review
**Date:** 2026-07-24
**Owner:** Harshit
**Companion document:** implementation plan at `docs/plans/2026-07-24-001-feat-capture-scorecard-skeleton-plan.md` (the how-to-build artifact; this document is the what-and-why-and-sign-off artifact)

## Executive summary

- We are building the first working software for the evaluation framework: the L1 (Conviction) layer, covering capture and the scorecard.
- Capture is the six assessment rubrics, scored by a PM from a call transcript. The scorecard renders those scores, the human judgment slides, and a roll-up.
- The machine drafts observations and claims from the transcript. The PM authors every score. The app renders and never judges. There is no total and no gate verdict.
- Structure is taken from the Notion "Idea to Enterprises Framework" only. The full skeleton (L1 to IC) is the eventual build. This brief covers L1 because it is the foundation the later layers deepen.
- This document is for a formal review. Section 7 lists the decisions already proposed. Section 8 is the register of decisions to finalize before building starts, with owners and a flag for which ones block the build.

## 1. What we are building

A web tool that runs the Conviction layer of the framework for one deal at a time. A PM opens a deal, pastes a call transcript, and gets back a set of machine-drafted observations and claims sorted into the six rubrics. The PM then scores each sub-dimension and sets the pillar and track slides. The tool renders the scorecard from that record.

The tool holds the deal record, enforces the split between capture and judgment, and produces the scorecard. It does not make the investment call and does not compute a gate pass or fail.

## 2. Why now

The framework currently lives as a written skeleton across Notion pages. There is no tool that holds a deal's record, keeps capture and judgment separate, or renders the scorecard the framework specifies. L1 is where a deal's record opens and every sub-dimension is scored for the first time. Every later layer refines or deepens that same record. Building L1 first makes the data model and the authorship flow real, and lets L2 and L3 attach later without rework. Getting L1's shape wrong would compound through every layer above it.

## 3. Scope

**In scope (L1):**

- One record per deal, opened at the first real call.
- Transcript ingestion, machine drafting of observations and claim-ledger entries.
- PM scoring of all six rubrics (1 to 5 or binary pass/fail), with evidence.
- PM authoring of the seven pillar and three track slides (0 to 10), with the lens and verification cap applied.
- The founder-type read.
- The scorecard: capture grid, judgment slides, and roll-up.

**Out of scope (deferred to later layers of the same skeleton):**

| Deferred item | Layer / reason |
|---|---|
| Claim validated / refuted, verification artefact, pitch-drift tracker | L2 |
| Co-development of fillable pillars, co-creation pre-pack, IC note | L3 and IC |
| Gate packages beyond the scorecard (conviction read, one-pager, partner reads) | later |
| Gate pass/fail and go / conditional-go / no-go verdicts | gate logic is Pending in the framework |
| Coverage percentage and readiness thresholds | later |
| File upload and diarized transcripts | later |
| Multi-user auth, roles, partner views | later |

**How it fits the full skeleton:** the record is layer-stamped from day one, so L2 and L3 refinement attach to the same record later. How L2 attaches is a separate design topic for a later session.

## 4. The framework as software

This section restates the Notion structure in the shape the tool implements, so reviewers can confirm the tool matches the framework.

### 4.1 Capture: the six rubrics

Each rubric holds the evidence and the sub-dimension scores. A PM scores each sub-dimension with evidence quoted from the transcript.

| Rubric | What it captures |
|---|---|
| Founder & Team | who the founders are as builders and partners |
| Problem & Market | the problem, its urgency, and the market and timing |
| Product / Tech & Solution | what is built, how it works, how it scales |
| GTM & Distribution Access | who buys, and how they are sold to and reached |
| Financial & Legal | capital, cap table, structure, and compliance |
| Studio Fit & Co-Develop | whether Biome is the right builder for this |

Each sub-dimension is one of two kinds: a sliding scale from 1 to 5, or a binary pass/fail. Sliding rows carry anchor text at 1, 3, and 5. Binary rows relabel those columns Fail, Unverified, Pass. The binary hygiene rows form the floor, and any Fail drops the deal.

### 4.2 Judgment: pillars and tracks

Judgment is a human read on a 0 to 10 slide, drawn from the sub-dimension scores that root to it. It is never a sub-dimension score copied upward, and never an average.

- **Idea track:** the seven pillars of differentiation. Four are critical (the founder must bring them): earned secret, foundational tech, cornered resource, privileged distribution. Three are fillable (the studio can help build them): go-to-market engine, founder-led storytelling, business-model innovation.
- **Founder/s track:** one 0 to 10 slide, drawn mainly from the Founder & Team rubric.
- **Market track:** one 0 to 10 slide, drawn mainly from the Problem & Market rubric, read once Idea and Founder/s clear.

Scales stay in one place: sub-dimensions are 1 to 5 or binary, and pillars and tracks are always 0 to 10.

### 4.3 How a slide is set

Each slide reads through one fixed lens:

- **Peak:** the strongest verified rooted sub-score sets the ceiling. Used where one scarce thing is the differentiation.
- **Weakest-link:** the weakest required rooted sub-score caps the slide. Used where the slide is a system and one dead part breaks it.

At L1 the claims are not yet verified, so the bankable ceiling is capped at roughly 6. A higher read can be recorded as a provisional, for example "8 provisional, if the claim verifies." Every slide ships with one written line naming which sub-dimension set the ceiling and why. That line is the anti-vibe guard.

### 4.4 The authorship rule

| Who | What they do |
|---|---|
| Machine (the app) | drafts verbatim observations and claim entries from the transcript, maps each to a rubric and sub-dimension, origin-tags the claims, and renders every view |
| PM | authors every sub-dimension score and every 0 to 10 slide, verifies and edits the machine's drafts, confirms the founder-type read |
| Partners | author the structural reads and the gate decision (this is L2 and later, out of scope here) |

The machine never sets a score. The PM authors judgment. The app renders.

### 4.5 The scorecard

The scorecard is rendered from the record, never authored directly. It has three parts:

- **Capture block:** rubric, sub-dimension, score, evidence, layer.
- **Judgment block:** pillar or track, critical or fillable, the 0 to 10 slide, the rooted sub-dimensions, and the one-line ceiling guard.
- **Roll-up:** number of exceptional pillars, whether at least one is critical, whether the Founder/s track floor clears, and floor status.

There is no total, no composite, and no gate verdict.

## 5. Product requirements

| ID | Requirement |
|---|---|
| R1 | One record per deal (company). Create, list, open a deal. Every observation and score is stamped with the layer it was made at. |
| R2 | A PM pastes a call transcript into a deal, tagged with a call number. |
| R3 | The machine drafts verbatim observations, each mapped to a rubric and sub-dimension, with source and any speaker/timestamp. The PM can accept, edit, or reject each. |
| R4 | The machine drafts claim-ledger entries, quote-anchored and origin-tagged. At L1 the ledger opens at status claimed only. |
| R5 | The machine never sets a score. A sub-dimension stays unscored until the PM sets its value. |
| R6 | The six rubrics and sub-dimensions are encoded from Notion, each typed 1 to 5 or binary, with anchor text and a roots-to target. |
| R7 | A PM scores each sub-dimension with at least one evidence quote. A score with no evidence is treated as incomplete. |
| R8 | The binary hygiene rows form the floor. The scorecard surfaces floor status and flags any Fail as deal-dropping. |
| R9 | The seven pillars and three tracks each carry a 0 to 10 human slide. The app shows the rooted sub-scores as context but never computes or averages the slide. |
| R10 | Each slide is authored under its lens and the L1 verification cap, and requires a one-line ceiling guard. |
| R11 | The machine drafts the founder-type read; the PM confirms in one line. The type sets the Founder/s-track floor and is shown as context, with no automated verdict. |
| R12 | The scorecard renders the capture block, judgment block, and roll-up. No total, no composite, no gate verdict. |
| R13 | Views are generated from the record. Editing the scorecard means editing the underlying scores. |

## 6. The PM's flow

1. Create a deal, or open an existing one.
2. Paste a call transcript, tagged with a call number.
3. The machine drafts observations and claims, sorted into the rubrics.
4. Review the drafts. Accept, edit, or reject each observation. Read the claim ledger.
5. Score each sub-dimension, 1 to 5 or pass/fail, attaching evidence.
6. Set the pillar and track slides, within the verification cap, each with its one-line guard. Confirm the founder-type read.
7. Open the scorecard: capture grid, judgment slides, and roll-up.

## 7. Decisions already proposed (please confirm at review)

These were settled during the working sessions. They are recorded here so the review can confirm or challenge them.

| Decision | Rationale |
|---|---|
| Scope is the L1 layer only; the full skeleton is the eventual build | L1 is the foundation the later layers deepen |
| Build the full authorship model now (transcript, machine drafts, PM scores, render), not a manual-first version | It is the real operating model |
| TypeScript full stack (Next.js, Prisma, Anthropic SDK) | One language front to back, strong for the scorecard screen |
| The founder-type read is included in L1 | Cheap, L1-native, and it sets the Founder/s-track floor |
| Structure is taken from the Notion subpages only | The Notion framework is the source of truth |
| The machine never scores; no total, composite, or gate verdict | The framework's capture-versus-judgment rule and no-average rule |
| The record is layer-stamped from day one | So L2 and L3 attach later without rework |

## 8. Decisions to finalize before building

This is the register for the review. Each item names the question, the recommended answer, the owner, and whether it blocks the build. Building should not start on the items marked "blocks build" until they are settled.

| ID | Decision | Owner | Blocks build? |
|---|---|---|---|
| D1 | Gate logic for L1: render facts only, no verdict | Srini | No |
| D2 | Freeze the rubric content for v1 | Harshit + PMs (Srini for anchors) | Yes |
| D3 | Founder-type overlay depth for L1 | Srini | Partly |
| D4 | Verification cap value at L1 | Partners | Yes |
| D5 | Four open rubric calls | Srini | Partly |
| D6 | Extraction model | Harshit | No |
| D7 | Evidence enforcement strictness | PMs | No |
| D8 | Users, roles, and access for the pilot | Harshit + partners | Yes |
| D9 | Persistence and hosting for the pilot | Harshit | Low |
| D10 | Transcript ingestion for v1 | PMs | No |
| D11 | Score history within a layer | Harshit | Low |

**D1. Gate logic for L1.** The framework leaves the G1 thresholds Pending. Proposal: build L1 to render the roll-up facts (exceptional pillars, at least one critical, Founder/s-track floor, floor status) with no gate verdict, and add gate logic later once it is defined. This does not block the build if we accept facts-only for now. This is the single largest open framework item.

**D2. Freeze the rubric content for v1.** The tool encodes the six rubrics, their sub-dimensions, the 1/3/5 anchor text, the roots-to targets, the lens per slide, and the verification cap. This content must match the current Notion Assessment Rubrics exactly. Proposal: freeze the current Notion version as version 1, and stamp every score with the rubric version so a later edit is traceable. This blocks the build, because building against a moving rubric wastes rework.

**D3. Founder-type overlay depth for L1.** Proposal: include the type read and the Founder/s-track floor as context only. Defer the go / conditional-go / no-go verdict grid, since it depends on gate logic (D1). Confirm we defer the verdict grid.

**D4. Verification cap value at L1.** The framework sets the L1 bankable ceiling at roughly 6, with the exact number left to partner judgment. Confirm the number, and confirm that a higher provisional read is shown alongside the banked value. This blocks the build, because the scoring screen enforces it.

**D5. Four open rubric calls.** The Notion "Open for discussion with Srini" list carries four specific calls: whether co-founder dynamics earns its own row or stays under Coachability; whether Market size stays scored in Problem & Market or moves to hygiene; whether engineering self-sufficiency is a flag or a hard kill; and whether the flagged prior-employer IP boundary is advance-with-condition or hold at G1. Most refine anchors or flags rather than architecture. Any that change whether a row is scored or binary must be settled inside the D2 freeze.

**D6. Extraction model.** The drafting step uses a Claude model through the Anthropic SDK. Proposal: default to `claude-opus-4-8` in config, and set `EXTRACTION_MODEL=claude-sonnet-5` for the pilot, since this is a high-volume drafting step where the PM authors every score and Sonnet is the production-volume tier. It is one setting and does not block the build.

**D7. Evidence enforcement strictness.** Proposal: a score saved with no evidence is allowed but flagged incomplete, so a PM can work in progress. The alternative is to hard-block a score with no evidence. Default is set to the softer option and is simple to change.

**D8. Users, roles, and access for the pilot.** L1 is planned as a local, single-workspace tool with no login, where the operator acts as the PM. Confirm that partners do not need live read access during L1, since their structural reads are an L2 activity. This blocks the build if multi-user access is needed now, because that adds authentication and changes the data model.

**D9. Persistence and hosting for the pilot.** Proposal: SQLite for local development, moving to Postgres when hosted. Confirm that a local or single-machine pilot is acceptable to start, or state that a hosted shared instance is needed from day one. Low build impact on its own, but it is tied to D8.

**D10. Transcript ingestion for v1.** Proposal: paste transcript text tagged to a call number, with file upload and diarization deferred. Confirm paste is enough for the pilot.

**D11. Score history within a layer.** Proposal: L1 stores one current score per deal, sub-dimension, and layer, and does not version edits within L1. Cross-layer history comes from the layer stamp. Confirm we do not need within-L1 edit history for the pilot.

## 9. Success criteria for the L1 slice

- A PM can take one deal from a pasted transcript to a rendered scorecard without leaving the tool.
- Every sub-dimension across the six rubrics can be scored with evidence, and the floor behaves correctly on a binary Fail.
- Every pillar and track slide can be set within the verification cap, each with a one-line guard, and the founder-type read is confirmed.
- The scorecard renders capture, judgment, and roll-up from the record, with no total and no verdict.
- The machine writes only observations and claims, never a score.

## 10. Build approach

The build follows the companion implementation plan. It is nine ordered steps, each with its own tests.

| Step | What it delivers |
|---|---|
| 1 | Project scaffold and tooling |
| 2 | Rubric and judgment config, encoded from Notion |
| 3 | Data model and storage for the deal record |
| 4 | Deal and transcript management |
| 5 | The extraction step (machine drafts observations and claims) |
| 6 | Review of the machine's drafts |
| 7 | The capture scoring screen and rules |
| 8 | The judgment slide screen and rules |
| 9 | The scorecard render and roll-up |

The stack is Next.js with TypeScript, Prisma for storage, the Anthropic SDK for extraction, and a test suite covering the scoring rules, the extraction contract, and the scorecard render.

## Open for discussion with Srini

- **Gate logic (D1).** Confirm we build L1 as facts-only for now, and that gate thresholds come later.
- **Rubric freeze and the four open calls (D2, D5).** Confirm the current Notion rubrics are final enough to encode as version 1, and settle the four open rubric calls, since they set what the tool encodes.
- **Founder-type verdict (D3).** Confirm we defer the go / conditional-go / no-go grid to when gate logic lands.
- **Verification cap (D4).** Confirm the L1 bankable ceiling number.
- **Founder-type weighting.** How far the anchors flex for technical versus corporate versus serial founders remains open in the framework and will shape later scoring, though not the L1 build.
