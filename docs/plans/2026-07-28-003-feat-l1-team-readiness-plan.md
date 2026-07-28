---
title: L1 Team Readiness - Plan
type: feat
date: 2026-07-28
topic: l1-team-readiness
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# L1 Team Readiness - Plan

## Goal Capsule

- **Objective:** Make the L1 tool usable by a team rather than one operator — the app says who you are, deals have visible owners you can hand over, and transcripts arrive from Fireflies instead of the clipboard.
- **Product authority:** This plan owns identity, roles, deal ownership, and transcript ingestion at L1. The L2 layer — claim verification, structural reads, layer comparison — is not active scope here and is planned separately in `docs/plans/2026-07-28-004-feat-l2-verification-core-plan.md`.
- **Open blockers:** How a TARS user authenticates to Fireflies is unresolved and shapes what the import screen can offer.

---

## Product Contract

### Summary

Surface the identity the app already tracks, give deals owners that can be seen and transferred, and let a PM pull a transcript from Fireflies instead of pasting one. Partners become full authors of the record rather than read-only observers.

### Problem Frame

The L1 build runs end to end but assumes a single operator sitting in front of it. The machinery for a team is already there and none of it reaches a screen.

Auth is fully wired — `middleware.ts` protects every route, `lib/session.ts` reads the actor, `lib/authz.ts` guards every mutation — yet `components/TopBar.tsx` renders a brand and a theme toggle and nothing else. Nobody can tell which account they are using, and there is no way to sign out. `canManageUsers` in `lib/authz.ts` is defined and never called, so the only way to change someone's role is to edit the `ADMIN_EMAILS` environment variable and redeploy. `Deal.ownerId` is set once at creation in `lib/services/capture.ts` and can never change, while `listDeals` in `lib/repo/records.ts` hands every deal to everyone undifferentiated.

The role split is stricter than the team needs. `AUTHOR_ROLES` admits `PM` and `ADMIN` only, so a partner signing in today gets the full PM interface and an error on any control they touch.

Separately, every transcript still arrives by copy-paste. The team records founder calls in Fireflies, and moving that text by hand is both the slowest step in the flow and the one that discards the speaker labels the extraction path is already built to carry.

### Key Decisions

- **Partners author the record on the same terms as PMs.** Attribution survives the change: `authorId` is already on every score, slide, and founder read, so the record keeps saying who did the work even when both roles may. Governs R5.
- **A partner sees exactly what a PM sees.** No partner-specific view, no read-only mode. Combined with the decision above, `PM` and `PARTNER` become a label describing who someone is rather than a rule constraining them. Governs R5.
- **Only user management stays privileged.** `ADMIN` remains the sole role that gates anything. Governs R6.
- **Reassignment is limited to a deal's owner or an ADMIN.** Letting any author reassign would let anyone take a deal in order to delete it, which defeats the owner-scoped delete rule in `lib/authz.ts`. Governs R9, R10.
- **A deal's identifier is a stable handle, not a name.** Renaming a company leaves every existing link working, and a stale slug costs less than maintaining a redirect table. Governs R16.
- **Founders stay a single free-text field.** Nothing in the L2 design turned out to need founders modelled as separate people, so the structure would carry cost without a consumer.
- **Fireflies import is always chosen, never automatic.** Opening a call on a record is a judgment; a title match is not. Governs R15.
- **Imported transcripts keep their speaker labels.** Spec §3 deferred diarization because paste made it expensive; Fireflies makes it free, and `Observation.speaker` already carries it end to end. Governs R13.

### Actors

- A1. **PM** — authors the record. Owns the deals they create.
- A2. **Partner** — authors on the same terms as a PM (R5).
- A3. **ADMIN** — everything a PM or partner can do, plus user management and reassignment of any deal.
- A4. **Fireflies** — external meeting recorder. Lists a user's recent meetings and returns transcripts on request.

### Requirements

**Identity and access**

- R1. The app shows the signed-in user's name and role on every screen, with a control to sign out.
- R2. An ADMIN can list the people who hold accounts and change their roles without leaving the app.
- R3. A role change takes effect at that user's next sign-in.
- R4. An address configured in `ADMIN_EMAILS` is promoted to ADMIN on every sign-in and cannot be demoted from within the app; the people page says so rather than appearing to accept the change.
- R5. A PARTNER authors the record on the same terms as a PM, and sees the same screens.
- R6. Only an ADMIN can change roles.

**Deal ownership**

- R7. The deals list can be filtered to the deals the signed-in user owns.
- R8. A deal shows who owns it, and the owner can be changed to another account holder.
- R9. Only a deal's current owner or an ADMIN may reassign it.
- R10. Deletion rights follow ownership: after a reassignment the new owner may delete the deal and the previous owner may not.

**Transcript ingestion**

- R11. A PM can import a call transcript from Fireflies by searching or browsing their recent meetings and choosing one.
- R12. Pasting a transcript stays available and behaves as it does today.
- R13. Speaker labels on an imported transcript reach the observations drafted from it.
- R14. An imported call carries a call number and a label, supplied the same way a pasted call supplies them.
- R15. No meeting is ever attached to a deal without a person choosing it.

**Record identity**

- R16. A deal's identifier is fixed at creation and does not change when the company is renamed.

### Key Flows

- F1. Import a transcript from Fireflies
  - **Trigger:** A PM opens a deal's transcript page after recording a founder call.
  - **Actors:** A1, A4
  - **Steps:** The PM chooses to import; TARS lists their recent Fireflies meetings with title, date, and duration; the PM searches or scrolls and selects one; TARS fetches the transcript; the PM confirms the call number and label; the call is saved with its speaker labels intact.
  - **Outcome:** A call exists on the deal, ready for extraction, with no text moved by hand.
  - **Covers R11, R13, R14, R15.**

- F2. Hand a deal to another PM
  - **Trigger:** A PM is going on leave, or a deal moves to a colleague.
  - **Actors:** A1, A3
  - **Steps:** The owner (or an ADMIN) opens the deal, changes the owner to another account holder, and confirms.
  - **Outcome:** The deal appears under the new owner's "Mine" filter, and delete rights move with it.
  - **Covers R8, R9, R10.**

- F3. Change someone's role
  - **Trigger:** A new colleague signs in, or someone's responsibilities change.
  - **Actors:** A3
  - **Steps:** An ADMIN opens the people page, finds the person, and sets their role.
  - **Outcome:** The change applies the next time that person signs in.
  - **Covers R2, R3, R6.**

### Acceptance Examples

- AE1. Reassignment moves delete rights
  - **Covers R10.**
  - **Given:** Harshit owns the deal `halten` and Mehul is a PM.
  - **When:** Harshit reassigns `halten` to Mehul.
  - **Then:** Mehul may delete `halten` and Harshit may not.

- AE2. A configured admin cannot be demoted in the app
  - **Covers R4.**
  - **Given:** `harshit@biome.in` is listed in `ADMIN_EMAILS`.
  - **When:** Another ADMIN sets that account's role to PM on the people page.
  - **Then:** The account is ADMIN again at its next sign-in, and the app says so rather than appearing to have applied the change.

- AE3. A partner authors a score
  - **Covers R5.**
  - **Given:** Srini is signed in as PARTNER.
  - **When:** Srini scores a sub-dimension with evidence.
  - **Then:** The score saves and the record attributes it to Srini.

- AE4. An imported transcript without speaker labels
  - **Covers R13.**
  - **Given:** A Fireflies meeting whose transcript carries no speaker attribution.
  - **When:** The PM imports it and runs extraction.
  - **Then:** Observations are drafted with no speaker, exactly as a pasted transcript produces today — the import never invents one.

- AE5. Importing into an occupied call number
  - **Covers R14.**
  - **Given:** The deal already has a call numbered 2.
  - **When:** The PM imports a Fireflies meeting and leaves the call number at 2.
  - **Then:** The import is rejected with the same collision message a pasted call produces, and the transcript is not saved.

### Scope Boundaries

- Partner-specific views and read-only modes — a partner sees the PM application.
- Structured founder records — founders remain one text field.
- Automatic or scheduled Fireflies attachment.
- File upload and material exchange with founders — that belongs to the L2 deal-room work, not here.
- Linking a transcript's speaker to a founder record — speaker stays a free-text label.
- Changing a deal's identifier when its company is renamed, and any redirect machinery that would require.

### Dependencies and Assumptions

- Fireflies exposes a programmatic way to list a user's meetings and fetch a transcript. **Unverified** — the requirements hold whether that turns out to be an MCP server or their API directly, but which one it is shapes the work.
- Every user who imports has a Fireflies account whose meetings they are entitled to list.
- Google SSO is domain-restricted to `biome.in` (backend plan B7), so everyone with an account is internal.
- User rows are created on first sign-in, so "people who hold accounts" means "people who have signed in at least once".

### Outstanding Questions

**Resolve before planning**

- How a TARS user authenticates to Fireflies: a per-user credential, or one workspace credential shared across the team. A shared credential would show every user the whole team's meetings, which changes what R11's list can safely display.

**Deferred to planning**

- Whether the people page shows role changes taking effect immediately in the interface or only reflects the stored value until the next sign-in.
- Whether the "Mine" filter is a client-side filter over the existing list or a separate query.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan owns L1 team readiness. The breakdown below is how the surrounding work is currently understood, not a committed roadmap — a later plan may revise, split, or discard any of it.

- **L2 verification core** (`docs/plans/2026-07-28-004-feat-l2-verification-core-plan.md`)
  - Depends on the partner-authoring change here (R5); structural reads at L2 assume partners can write to the record.
  - Shares the layer stamps already present on observations, scores, and slides.
- **L2 deal room** — materials, uploads, and document exchange with founders.
  - Can proceed independently of this plan and of the verification core; it needs storage infrastructure that exists nowhere yet.
- **L3 co-development and IC**
  - Still to decide. Gate logic remains Pending in the framework (spec D1), unchanged by this plan.

### Sources

- `docs/specs/2026-07-24-capture-scorecard-l1-spec.md` §3 (deferred items, including file upload and diarized transcripts), §4.4 (authorship rule), D8 (users, roles, and access), D10 (transcript ingestion).
- `docs/plans/2026-07-27-002-backend-l1-plan.md` — the authorization table this plan revises, and B7 for the domain-restricted SSO constraint.
- `lib/authz.ts` — `AUTHOR_ROLES`, `canManageUsers`, `canDeleteDeal`.
- `lib/adminEmails.ts` — `resolveRole`, and why configured admins survive a stored-role change.
- `lib/repo/records.ts` — `listDeals`, and `toDeal`'s preference for the owner relation over the stored display name.
- `lib/services/capture.ts` — `uniqueDealId`, `createDeal`, `updateDeal`, `AddCallInput`.
- `lib/extraction/prompt.ts` and `lib/extraction/schema.ts` — the speaker path that import would feed.
- `components/TopBar.tsx` — the surface with no identity on it.
