# TARS

Working software for Biome's **Idea-to-Enterprise framework** — the **L1 (Conviction)** layer: the six-rubric **capture** flow and the **scorecard** it renders.

A real Next.js app on Postgres, with Google SSO, role-gated authorship, and Claude-drafted evidence extraction. The front end was built mock-data-first against the record contract in `mock/types.ts`; the backend attached behind that contract without any change to the screens.

## What it does

A PM opens a deal, pastes a call transcript, and the machine drafts observations and claims mapped to the six rubrics. The PM authors every sub-dimension score and every 0–10 pillar/track slide. The app renders the scorecard — capture grid, judgment block, and roll-up. There is **no total, no composite, and no gate verdict** (the framework's gate logic is still pending).

The core rule the app enforces: **the machine drafts, the PM scores, the app renders.** It never sets a score.

## Run it

```bash
npm install
cp .env.example .env && npx auth secret   # then set DATABASE_URL
npm run db:migrate && npm run db:seed
npm run dev
# open http://localhost:3000  →  /api/auth/signin
```

Needs Postgres. Sign in with any seeded user (`pm@biome.in`, password `tars-dev`)
— full setup, including Vercel provisioning, is in
[`docs/runbooks/deploy-vercel.md`](docs/runbooks/deploy-vercel.md).

```bash
npm test         # 112 tests, against a real Postgres test database
npm run typecheck
```

Open the **Halten** deal for a fully populated record (transcript → drafts → scoring → slides → scorecard). **Cirrus Loop** is mid-capture and **Parch** is empty, to show the in-progress and not-started states.

## Structure

| Path | What lives there |
|---|---|
| `app/` | App Router routes — one per screen: `deals`, `deals/[dealId]` (overview), `.../transcript`, `.../review`, `.../capture`, `.../judgment`, `.../scorecard` |
| `framework/` | The framework as static typed config: six rubrics + anchors, seven pillars + three tracks (lens + rooted set), founder types, the L1 verification cap. Referenced by key. |
| `mock/` | `types.ts` — **the record contract** every layer speaks. `data.ts` is now the seed fixture source, not the runtime data source. |
| `prisma/` | Schema, migrations (including CHECK constraints), and the fixture seed. |
| `lib/` | `data.ts` (the seam the UI reads), `repo/` (Prisma → record types), `domain/` (the codec and the framework's invariants), `services/` (the write side), `extraction/` (Claude drafting), `actions.ts` (server actions), auth and session. Plus the original pure view logic: score bands, the peak/weakest-link driver, roll-up facts, per-step progress. |
| `components/` | Shared UI — top bar, sidebar stepper, slide card, review board, score pills, and the viz (`SlideProfile` dot-plot for the 0–10 slides, `CaptureGrid` fingerprint for the 1–5/hygiene scores). |
| `docs/` | The product spec (`docs/specs/…`) and the implementation plan (`docs/plans/…`). |

## How the backend holds the framework

The point of the record is that it can be trusted, so the rules are enforced in
code rather than by convention:

- **The machine never scores.** The extraction schema has no score field, so
  there is nowhere for a rating to go. Asserted by test.
- **Quotes are verified against the transcript.** A model asked for a verbatim
  quote will sometimes return a tidied paraphrase. An unverifiable quote is worse
  than a missing one — a PM would later score a founder against a fabrication —
  so quotes that cannot be found in the source are dropped, and claims anchored
  to them go with them.
- **Slides are never derived.** Nothing averages, maxes, or weights the scores
  that root to a pillar. A slide is a human read or it is absent.
- **The L1 cap binds the banked value only.** A higher read is recordable as a
  provisional, which is the point of provisionals.
- **A slide requires its ceiling guard** — one line naming what set the ceiling.
  The anti-vibe rule, enforced in the domain rules and again as a database
  constraint.
- **Authorship is server-side.** PM and ADMIN author; PARTNER reads. Checked on
  every mutation, not by hiding a button.

The seam: the UI reads `lib/data.ts` (`listDeals`, `getDeal`, `getRecord`) and
nothing else. Swapping mock literals for database reads changed only those three
functions and the `await` in front of them.

Backend plan: [`docs/plans/2026-07-27-002-backend-l1-plan.md`](docs/plans/2026-07-27-002-backend-l1-plan.md).

## Working-draft notes

- **Rubric content** is a representative draft of **26** sub-dimensions transcribed to the framework's shape — not the frozen `rubric_v1`. The real Notion grid is 41 sub-dimensions with verbatim anchors; freeze it (spec **D2**) before the pilot. The keys, types, floors, and rooting are structural and stable; the anchor wording is placeholder. Every score row stores a `rubricVersion` so scores set against this draft stay traceable after the freeze.
- **No gate verdict.** The roll-up renders facts — exceptional pillars, critical-pillar count, floor breaches — and stops. The framework leaves G1 pending (spec **D1**), so the code does not invent one.
- **Score history** is not versioned within L1 (spec **D11**); the layer stamp carries cross-layer history.
- **Accent orange** (`--accent` in `app/globals.css`) is a placeholder for Biome's exact brand orange — one token, one swap.
- **L1 verification cap** (`L1_CAP` in `framework/verificationCap.ts`) is the working value ~6, pending the partner call (spec **D4**).

## Design

Modern mainframe: IBM Plex Mono leads (titles, labels, data) with IBM Plex Sans for prose, zero corner radius, hairline rules instead of shadows, warm neutrals with Biome's orange as the single accent. The signature element is the status line — an always-dark terminal bar rendering the open record's facts, ending with the framework's covenant (`NO TOTAL · NO VERDICT`). Light ("paper terminal") and dark ("phosphor") themes via OS preference plus a toggle in the top bar.
