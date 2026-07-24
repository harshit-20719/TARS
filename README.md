# TARS

Working software for Biome's **Idea-to-Enterprise framework** — the **L1 (Conviction)** layer: the six-rubric **capture** flow and the **scorecard** it renders.

This is the front end, built **mock-data-first**. It is a real Next.js app; the data it renders comes from an in-memory mock shaped exactly like the eventual database record, so the backend (Prisma + Anthropic extraction) drops in behind it without changing the UI.

## What it does

A PM opens a deal, pastes a call transcript, and the machine drafts observations and claims mapped to the six rubrics. The PM authors every sub-dimension score and every 0–10 pillar/track slide. The app renders the scorecard — capture grid, judgment block, and roll-up. There is **no total, no composite, and no gate verdict** (the framework's gate logic is still pending).

The core rule the app enforces: **the machine drafts, the PM scores, the app renders.** It never sets a score.

## Run it

```bash
npm install
npm run dev
# open http://localhost:3000  →  redirects to /deals
```

`npm run build` for a production build. No API keys or database are needed — the front end runs entirely on the mock data layer.

Open the **Halten** deal for a fully populated record (transcript → drafts → scoring → slides → scorecard). **Cirrus Loop** is mid-capture and **Parch** is empty, to show the in-progress and not-started states.

## Structure

| Path | What lives there |
|---|---|
| `app/` | App Router routes — one per screen: `deals`, `deals/[dealId]` (overview), `.../transcript`, `.../review`, `.../capture`, `.../judgment`, `.../scorecard` |
| `framework/` | The framework as static typed config: six rubrics + anchors, seven pillars + three tracks (lens + rooted set), founder types, the L1 verification cap. Referenced by key. |
| `mock/` | `types.ts` (the record types) and `data.ts` (fictional deals). Shapes mirror the Prisma models. |
| `lib/` | Pure logic: score bands, the peak/weakest-link driver, the roll-up facts, per-step progress. |
| `components/` | Shared UI — top bar, sidebar stepper, slide card, review board, score pills, and the viz (`SlideProfile` dot-plot for the 0–10 slides, `CaptureGrid` fingerprint for the 1–5/hygiene scores). |
| `docs/` | The product spec (`docs/specs/…`) and the implementation plan (`docs/plans/…`). |

## For the backend (next)

The UI reads through `mock/data.ts` (`listDeals`, `getDeal`, `getRecord`). Replace those getters with a Prisma-backed repository returning the same `mock/types.ts` shapes and the screens do not change. Then wire the extraction step (`client.messages.parse()` + a Zod schema) to populate observations and claims. See the plan's units U3 (schema) and U5 (extraction).

## Working-draft notes

- **Rubric content** is a representative draft transcribed to the framework's shape — not the frozen `rubric_v1`. The real Notion grid is 41 sub-dimensions with verbatim anchors; freeze it (spec **D2**) before pinning. The keys, types, floors, and rooting are structural and stable; the anchor wording is placeholder.
- **Accent orange** (`--accent` in `app/globals.css`) is a placeholder for Biome's exact brand orange — one token, one swap.
- **L1 verification cap** (`L1_CAP` in `framework/verificationCap.ts`) is the working value ~6, pending the partner call (spec **D4**).

## Design

Modern mainframe: IBM Plex Mono leads (titles, labels, data) with IBM Plex Sans for prose, zero corner radius, hairline rules instead of shadows, warm neutrals with Biome's orange as the single accent. The signature element is the status line — an always-dark terminal bar rendering the open record's facts, ending with the framework's covenant (`NO TOTAL · NO VERDICT`). Light ("paper terminal") and dark ("phosphor") themes via OS preference plus a toggle in the top bar.
