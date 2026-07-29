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
npm test         # 176 tests, against a real Postgres test database
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
| `components/` | Shared UI — top bar, sidebar stepper, slide card, review board, score pills, and the viz (`SlideProfile` dot-plot for the 0–10 slides, `CaptureGrid` fingerprint for the 1–5/hygiene scores). `authoring/` holds the write controls: the score picker, the slide form, the founder-type read, and the deal/transcript forms. |
| `docs/` | The product spec (`docs/specs/…`) and the implementation plan (`docs/plans/…`). |

## How the backend holds the framework

The point of the record is that it can be trusted, so the rules are enforced in
code rather than by convention:

- **The machine never scores.** The extraction schema has no score field, so
  there is nowhere for a rating to go. Asserted by test. The one thing the model
  does rate is its own filing — "am I sure this quote belongs to this row" — which
  is a clerical question, and the vocabulary is fixed at high/low so it cannot
  drift into being a score by another name.
- **The machine does map, though, and the PM does not re-do it.** A confidently
  mapped quote is cited as evidence on arrival; an unsure one waits in an
  exception queue. The framework reserves the *score* for the PM, not the filing,
  and making them approve every quote turned seven screening calls a week into
  data entry. Rejecting or moving a quote stays available on the row itself.
- **Quotes are verified against the transcript.** A model asked for a verbatim
  quote will sometimes return a tidied paraphrase. An unverifiable quote is worse
  than a missing one — a PM would later score a founder against a fabrication —
  so quotes that cannot be found in the source are dropped, and claims anchored
  to them go with them. The dropped quotes are shown, not counted: a paraphrasing
  model otherwise looks exactly like a quiet transcript.
- **A condition has to be readable.** "Advance with condition" was a bare boolean;
  it now requires one line saying what the condition is, because one that nobody
  can read is not actionable at IC.
- **Slides are never derived.** Nothing averages, maxes, or weights the scores
  that root to a pillar. A slide is a human read or it is absent.
- **The L1 cap binds the banked value only.** A higher read is recordable as a
  provisional, which is the point of provisionals. The form offers one 0–10 scale,
  not two: pressing above the cap banks at the cap and records the rest as the
  provisional. A provisional can therefore only arise where the cap is what is
  stopping you, which is the only place it means anything.
- **A slide requires its ceiling guard** — one line naming what set the ceiling.
  The anti-vibe rule, enforced in the domain rules and again as a database
  constraint. The line is prefilled from whichever rooted row is lowest under the
  lens, because finding that is mechanical; whether it is genuinely what holds the
  read down is not, so the slide records whether a human confirmed it.
- **Authorship is server-side.** Every role authors — PM, PARTNER, and ADMIN
  alike. The split the rule protects is machine versus human, not one human role
  versus another, and it is checked on every mutation rather than by hiding a
  button. Attribution is what keeps the record honest about who did the work.
- **Deletion is narrower than authoring.** Any PM may score any deal — that is
  what makes a second read possible — but a PM may only delete a deal they own.
  An ADMIN may delete any. The delete cascades, so the UI asks for the company
  name typed out rather than a confirm click.

The seam: the UI reads `lib/data.ts` (`listDeals`, `getDeal`, `getRecord`,
`getCalls`) and nothing else. Swapping mock literals for database reads changed
only those functions and the `await` in front of them.

`getCalls` is separate from `getRecord` on purpose. The record carries call
*metadata* only, because transcripts are by far the largest thing on a deal, every
mutation revalidates the record, and exactly one page needs the words — while they
travelled in the record, pressing one score button re-read every transcript on the
deal out of the database and threw it away.

Backend plan: [`docs/plans/2026-07-27-002-backend-l1-plan.md`](docs/plans/2026-07-27-002-backend-l1-plan.md).

## Working-draft notes

- **Rubric content** is `rubric_v1`: the full Notion grid, **41** sub-dimensions (7/7/7/7/7/6), with every label, "what it tests", rooting, and 1/3/5 anchor transcribed verbatim (spec **D2**). Ten rows form the hygiene floor — eight binary, plus **Ambition & exit-type fit** and **Cap-table health**, which are scored 1–5 and killed at 1. Notion's four row-scoped open questions ride on the rows they belong to and surface in the capture grid; `framework/rubrics.ts` carries all six in `OPEN_CALLS`. Every score row stores a `rubricVersion`, so scores survive the next revision traceably.
- **No gate verdict.** The roll-up renders facts — exceptional pillars, critical-pillar count, floor breaches — and stops. The framework leaves G1 pending (spec **D1**), so the code does not invent one.
- **Score history** is not versioned within L1 (spec **D11**); the layer stamp carries cross-layer history.
- **Accent orange** (`--accent` in `app/globals.css`) is a placeholder for Biome's exact brand orange — one token, one swap.
- **L1 verification cap** (`L1_CAP` in `framework/verificationCap.ts`) is the working value ~6, pending the partner call (spec **D4**).

## Design

Modern mainframe: IBM Plex Mono leads (titles, labels, data) with IBM Plex Sans for prose, zero corner radius, hairline rules instead of shadows, warm neutrals with Biome's orange as the single accent. The signature element is the status line — an always-dark terminal bar rendering the open record's facts, ending with the framework's covenant (`NO TOTAL · NO VERDICT`). Light ("paper terminal") and dark ("phosphor") themes via OS preference plus a toggle in the top bar.
