# Deploying TARS to Vercel — step by step

Written for someone who has not done this before. Follow it in order; each step
says what to click and how to know it worked. Total time: about 30 minutes, most
of it waiting for builds.

You will need accounts on: **GitHub** (have it), **Vercel** (free), and **Google
Cloud** (free, for sign-in).

There are five stages:

1. Get the code onto `main`
2. Create the Vercel project
3. Add a database
4. Set up Google sign-in
5. Turn sign-in on and verify

---

## What this costs

Running the app costs nothing. One optional feature is metered.

| Thing | Cost |
|---|---|
| Vercel Hobby | **Free** |
| Prisma Postgres free tier | **Free** |
| Google Cloud OAuth | **Free** — no billing account needed for a client ID |
| **Anthropic API** — the extraction step only | **Metered.** No subscription; billed per token |

**You can deploy and use the app with zero spend** by leaving
`ANTHROPIC_API_KEY` unset. With no key, the transcript page simply does not offer
extraction — the buttons are absent rather than present-and-failing, and it says
why. Transcripts still save, and you can score every row by hand. Add the key
whenever you want the machine to draft observations, and the buttons appear on
the next page load.

### One extraction is six calls

Extraction fans out: one request per macro-dimension, six running at once, each
reading the whole transcript against only its own six or seven rows.

That is not an optimisation, it is what makes the step work. A single request
against all forty-one rows was both stingy and slow — a model holding forty-one
rows in mind reports what stood out instead of working the list, and one response
carrying every row's evidence is a long generation, long enough to be what ran the
serverless function out of time. Six focused passes find the ordinary
middle-of-the-range evidence a single sweep skips, each response is a fraction of
the size, and because they are concurrent the wall clock is the slowest block
rather than the sum. Expect 20–40 seconds.

The cost is reading the transcript six times instead of once. Input tokens are the
cheap half of the bill, so a rough per-transcript cost — a 45-minute call, about
15k tokens in per block and 1k out:

| Model | Per transcript | Per month at ~8 calls/week | Notes |
|---|---|---|---|
| `claude-sonnet-5` (default) | ~50¢ | **~$16** | Introductory pricing until 31 Aug 2026, then ~75¢ |
| `claude-opus-5` | ~$1.50 | ~$48 | Strongest at picking the right row from anchor text |
| `claude-haiku-4-5` | ~15¢ | ~$5 | Cheapest and fastest; weakest at the mapping |

Set `EXTRACTION_MODEL` to switch; nothing else changes.

Sonnet 5 is the default, resolving spec D6 the way the plan recommended (KTD4).
The machine at this step quotes, files, and tags — it never judges — so the tier
buys mapping accuracy rather than judgment. Quoting is the easy half and is
guarded anyway: a quote that is not literally in the transcript is dropped before
it is written, whatever the model. What the tier actually buys is choosing the
right row from anchor text, and tagging whether the founder volunteered a claim or
merely agreed with the interviewer's framing.

The block split narrowed that gap enough to make the cheaper tier the sensible
default: each call now chooses between six or seven rows rather than forty-one,
and the schema makes a cross-block answer impossible rather than merely unlikely.
The model also reports its own uncertainty, so what it is unsure of waits for a
person in the exception queue rather than filing itself.

Opus is worth the switch if mis-mapping ever becomes the thing costing PM
attention; Haiku is defensible if cost matters more than the last few percent.

> Anthropic sells prepaid credits with a minimum purchase (usually \$5), so
> that is the practical floor for trying extraction at all.

> **One caveat on Vercel Hobby:** its terms are written for personal,
> non-commercial projects. An internal company POC sits in a grey area. Nothing
> will stop you today; worth knowing before this becomes something the firm
> depends on.

---

## Stage 1 — Confirm the code is on `main`

Vercel deploys whatever is on your repository's main branch. The backend is
already there, so there is nothing to merge — this stage is a check, not a step.

**How to know it worked:** open your repo on GitHub with `main` selected, and
confirm you can see a `prisma` folder in the file list.

If you are working on a feature branch and want its changes deployed, merge it
to `main` first — Vercel will not deploy from the branch:

```bash
git checkout main
git merge <your-branch>
git push origin main
```

---

## Stage 2 — Create the Vercel project

1. Go to **https://vercel.com** and sign in with GitHub.
2. On your dashboard click **Add New…** → **Project**.
3. Under *Import Git Repository*, find **TARS** and click **Import**.
   - If you don't see it, click **Adjust GitHub App Permissions** and grant
     Vercel access to the repository.
4. Leave every setting alone. Vercel detects Next.js on its own, and the build
   command in the repo already handles the database setup.
5. Click **Deploy**.

**This first deploy will fail.** That is expected — there is no database yet.
You'll see a red error mentioning `DATABASE_URL` or `prisma migrate`. Carry on to
stage 3.

---

## Stage 3 — Add a database

The app needs Postgres. Vercel can create one and wire it up for you.

1. In your project, click the **Storage** tab.
2. Click **Create Database**. Vercel offers a few Postgres options — **Prisma
   Postgres** is the right one for this app, and is what these instructions
   assume. (Neon also works; see the note at the end of this stage.)
3. Accept the default name, and pick the region closest to you.
4. Click **Create**.
5. When asked which project to connect it to, choose **TARS**, with all three
   environments (Production, Preview, Development) ticked.

### Confirm the variable name — do not skip this

**Finding environment variables.** Vercel has two layouts in the wild:

- **Newer UI** (no "Environment Variables" item in the Settings sidebar): go
  **Settings** → **Environments** → click the **Production** row. The variables
  are inside that environment. Repeat for **Preview** if you want previews to
  work.
- **Older UI**: **Settings** → **Environment Variables**, with checkboxes for
  which environments each one applies to.

Either way, look for **`DATABASE_URL`**. Its value will start with
`prisma+postgres://`.

Depending on which version of the integration you get, Vercel sometimes names it
**`PRISMA_DATABASE_URL`** or **`POSTGRES_URL`** instead. The app reads
`DATABASE_URL` specifically, so if that exact name is missing:

1. Click the variable that does exist and copy its value.
2. **Add New** → key `DATABASE_URL`, paste the value, all three environments
   ticked → **Save**.

That is the single most likely thing to go wrong in this stage, and the symptom
is a build that fails complaining it cannot find `DATABASE_URL`.

### Why Prisma Postgres needs no code changes

Its connection string uses a `prisma+postgres://` scheme that goes through
Prisma's own proxy rather than a direct database socket. Both halves of this app
already understand it: the migration step routes through
`migrations.prisma-data.net` and the running app through
`accelerate.prisma-data.net`. Nothing to install, no schema change.

It also pools connections for you, which is the thing that usually bites a
serverless app talking to Postgres — so you can ignore any advice about
connection limits or `pgbouncer=true`. That applies to raw Neon setups, not this
one.

> **If you chose Neon instead**, everything else in this guide is identical; you
> just get a plain `postgres://` URL, and connection pooling is your problem
> rather than Prisma's.

---

## Stage 4 — Set up Google sign-in

The app has no public pages — everything requires signing in, and sign-in is
restricted to `@biome.in` Google accounts. This stage creates the credentials
that make that work.

> **Why this is not optional:** the app refuses all access when no sign-in method
> is configured. That is deliberate for something holding founder call
> transcripts, but it does mean skipping this stage leaves you locked out.

### 4a. Find your app's address

Your production domain is shown in **Settings** → **Environments**, on the
**Production** row (it is also on the **Deployments** tab). It looks like
`tars-henna.vercel.app`. Write it down — you need it below.

Use the **production** domain, not a per-deployment URL. Per-deployment URLs
contain a build hash and change on every push, so a redirect URI built from one
stops working immediately.

### 4b. Create the Google credentials

Google has renamed this area to **Google Auth Platform**. Opening
*APIs & Services → OAuth consent screen* on a fresh project shows
**"not configured yet"** with a **Get started** button — that is the expected
starting state, not an error.

1. Go to **https://console.cloud.google.com**.
2. Top left, click the project dropdown → **New Project**. Name it `TARS` →
   **Create**. Wait for the notification, then **reopen the dropdown and select
   `TARS`** — the console often leaves you on the previous project, and
   everything below would land in the wrong place.
3. Left menu → **APIs & Services** → **OAuth consent screen** → **Get started**.
   Work through the four steps:
   - **App Information** — App name `TARS`, your address as support email
   - **Audience** — **Internal** if `biome.in` is a Google Workspace domain (no
     verification, Biome accounts only). **External** if Internal is unavailable
     — see the note below.
   - **Contact Information** — your address
   - **Finish** — accept the User Data Policy → **Create**
4. In the Google Auth Platform menu, go to **Clients** → **+ Create client**.
   (This is where OAuth client IDs live now; the older
   *Credentials → OAuth client ID* path reaches the same thing.)
   - Application type: **Web application**
   - Name: `TARS Web`
   - **Authorised redirect URIs** → **+ Add URI** → enter exactly, with your own
     production domain:

     ```
     https://tars-henna.vercel.app/api/auth/callback/google
     ```

     The `/api/auth/callback/google` part must be character-exact.
   - **Create**
5. Copy the **Client ID** and **Client secret** — both are needed in stage 5.

> **If you had to choose External**, the app starts in **Testing**, where only
> listed test users can sign in. Go to **Audience** and either **Publish app** —
> safe, because TARS requests only `email` and `profile`, which are non-sensitive
> scopes needing no Google verification — or add each colleague under **Test
> users**. Skip this entirely if you chose Internal.

---

## Stage 5 — Turn sign-in on and verify

### 5a. Generate a session secret

On your machine, in the project folder:

```bash
npx auth secret --raw
```

That prints a long random string. Copy it. (If `--raw` isn't recognised, run
`npx auth secret` and copy the value it writes into `.env.local`.)

### 5b. Add the environment variables

Go to where the database variables already are (**Settings** → **Environments** →
**Production** in the newer UI) and click **Add Environment Variable** for each of
these. Set every one to **All Environments**:

| Key | Value | Needed? |
|---|---|---|
| `AUTH_SECRET` | the string from 5a | **Yes** |
| `AUTH_GOOGLE_ID` | Client ID from stage 4 | **Yes** |
| `AUTH_GOOGLE_SECRET` | Client secret from stage 4 | **Yes** |
| `ADMIN_EMAILS` | your own address, e.g. `you@biome.in` | **Yes** — otherwise nobody is an admin |
| `ANTHROPIC_API_KEY` | from https://console.anthropic.com → API Keys | Optional — costs money, add later |
| `EXTRACTION_MODEL` | `claude-sonnet-5` | Optional — cheaper extraction |
| `EXTRACTION_EFFORT` | `low` (the default) | Optional — raise to `medium`/`high` only if transcripts are short enough to finish inside 60s |

Do **not** add `AUTH_DEV_CREDENTIALS`. That is for local development only and is
ignored in production builds.

### How roles work

- **You** — listed in `ADMIN_EMAILS` — sign in as **ADMIN**.
- **Anyone else with a `@biome.in` Google account** who opens the URL signs in as
  **PM**: they can author the record (scores, slides, extraction) but cannot
  manage users. No provisioning step — they just sign in.
- **PARTNER** authors the record on exactly the same terms as a PM. The role
  records who someone is; it does not restrict them.
- **Non-Biome accounts** are refused at the Google step.

`ADMIN_EMAILS` takes several addresses if you want, comma-separated. Changing it
takes effect the next time that person signs in.

> **Worth being clear about:** anyone at Biome who has the URL can sign in and
> start authoring. There is no per-person approval step. For a POC among
> colleagues that is usually what you want; if you later need to approve
> individuals, that is a small change.

There is no read-only role to put someone in instead — every role authors. If
someone should not be in the record at all, the answer is their Google account,
not their TARS row: see *Removing someone* below.

### 5c. Redeploy

Environment variables only apply to new builds.

1. Go to the **Deployments** tab.
2. On the most recent deployment click the **⋯** menu → **Redeploy** →
   **Redeploy**.
3. Wait for the green tick. This build also creates the database tables.

### 5d. Verify

Open `https://your-domain.vercel.app/deals`. You should be redirected to a
sign-in page offering Google. Sign in with your `@biome.in` account.

You should land on an empty deals list. **Empty is correct** — the database is
new. Seeing the page at all means everything is wired up: the app authenticated
you, connected to Postgres, and rendered.

If you set `ADMIN_EMAILS` to your own address, you are signed in as **ADMIN**.
To confirm, visit `https://<your-domain>/api/auth/session` — it prints your
session as JSON, including `"role":"ADMIN"`. That is the quickest way to check the
role wiring without any UI for it.

---

## If something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| Any `/api/auth/*` URL returns `{"message":"There was a problem with the server configuration…"}` | **`AUTH_SECRET` is not set.** Auth.js logs the real reason (`MissingSecret`) server-side but deliberately keeps the browser message vague so config details do not leak | Add `AUTH_SECRET` (5a/5b), redeploy. `/api/auth/providers` then returns `{}` until Google is configured too |
| Build fails, mentions `DATABASE_URL` | No database yet, **or** the integration named the variable something else | Stage 3, including the "Confirm the variable name" step |
| Build fails, mentions `prisma migrate` or `P1001` | Database attached but unreachable | Check the Storage tab shows it connected to *this* project, and that `DATABASE_URL` is set for Production |
| `Environment variable not found: DATABASE_URL` | The variable exists under a different name | Copy its value into a new variable named exactly `DATABASE_URL` |
| Sign-in page shows no Google button | Google variables missing or not yet built | Recheck 5b spelling, then redeploy (5c) |
| `redirect_uri_mismatch` from Google | The redirect URI doesn't match your domain | Stage 4b step 4 — it must be `https://<domain>/api/auth/callback/google` exactly |
| Signed in, then immediately signed out | `AUTH_SECRET` missing or changed | Recheck 5b, redeploy |
| "Access blocked" from Google | Account isn't `@biome.in` | Sign in with a Biome account |
| The call card shows "extraction off · no ANTHROPIC_API_KEY" | The key is not set for **Production** | Settings → Environment Variables → tick Production, redeploy. `/api/health` confirms with `extractionEnabled` |
| Extraction returns "An error occurred in the Server Components render" | The function was killed at its time limit before it could return, so there is no error to report | Long transcripts need time. `maxDuration` is 60s (the free-tier ceiling); if a transcript still outruns it, set `EXTRACTION_EFFORT=low` (the default) or split the call in two |
| Extraction runs but drops most quotes | The model paraphrased; unverifiable quotes are discarded on purpose | Open the "quotes dropped" list on the call card — it shows the text, so you can see whether it is tidying grammar. Re-run, or paste a cleaner transcript |
| "2 of six blocks failed" after extraction | One or more of the six concurrent calls failed; the rest saved their evidence | Press Re-extract. It replaces the machine's rows and keeps anything you have ruled on. If it repeats, the named reason says why (rate limit, credit balance) |
| Extraction returns very few observations | Was one call against all 41 rows; now six focused passes | Fixed by the block split. If still thin, check the dropped-quotes list first — a paraphrasing model looks identical to a quiet transcript |

Build logs are the fastest diagnosis: **Deployments** → click the failed one →
scroll the log for the first red line.

---

## After it's live

**Pushing updates.** Any push to `main` redeploys automatically. Nothing else to
do.

**Adding another admin.** Edit `ADMIN_EMAILS` to include them, comma-separated.
No redeploy needed for the value to be read, but they must sign out and back in.

**Roles.** `PM` and `PARTNER` both author the record, on the same terms — the
role says who someone is, not what they may do. `ADMIN` adds user management.
There is no read-only role, and no way to make one from the app.

**Removing someone.** Deleting their row in the database does **not** remove
their access: signing in requires no pre-existing row, so they would sign in
again and be recreated as an author. Suspend their `biome.in` Google account —
that is the only thing that actually ends access.

**Custom domain.** Settings → Domains. If you add one, go back to stage 4b and
add a second redirect URI for the new domain.

---

## Notes for later

**Migrations run during the build.** Vercel prefers a `vercel-build` script over
`build` when one exists, and this repo has one:
`prisma generate && prisma migrate deploy && next build`. So schema changes apply
themselves on deploy, with no command for you to remember, while a plain local
`npm run build` still works without a database. The trade-off: a broken migration
fails the deploy rather than half-applying. That is the safer failure for a pilot,
but as the team grows you may want to move migrations to a deliberate step.

**Preview deployments share the production database** with the default Vercel
setup. Fine for now; worth separating before anyone tests destructive changes on
a branch.

**Rotating `AUTH_SECRET`** signs everybody out. Rotating `ANTHROPIC_API_KEY`
affects only extraction.

---

## Local development

Separate from deployment — this is for running the app on your own machine.

```bash
# One-time: a local Postgres
docker run -d --name tars-pg -p 5433:5432 \
  -e POSTGRES_USER=tars -e POSTGRES_PASSWORD=tars -e POSTGRES_DB=tars \
  postgres:16-alpine
docker exec tars-pg createdb -U tars tars_test

cp .env.example .env      # then set AUTH_SECRET
npm install
npm run db:migrate
npm run db:seed           # loads three fictional deals
npm run dev
```

Sign in at `/api/auth/signin` with `pm@biome.in` and password `tars-dev` — no
Google setup needed locally.

```bash
npm test          # against the separate tars_test database
npm run typecheck
```
