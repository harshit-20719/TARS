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

## Stage 1 — Get the code onto `main`

Vercel deploys whatever is on your repository's main branch. The backend is
currently on a branch called `claude/capture-scorecard-skeleton-1299ab`, so it
has to be merged first.

Ask Claude to do it, or run:

```bash
git checkout main
git merge claude/capture-scorecard-skeleton-1299ab
git push origin main
```

**How to know it worked:** open your repo on GitHub, and confirm you can see a
`prisma` folder in the file list.

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
2. Click **Create Database** → choose **Postgres** → **Continue**.
3. Accept the default name and region — pick the region closest to you.
4. Click **Create**.
5. When it asks which project to connect it to, choose **TARS**, with all three
   environments (Production, Preview, Development) ticked.

Vercel now sets `DATABASE_URL` for you automatically. You never see or copy the
password.

**How to know it worked:** go to **Settings** → **Environment Variables** and
confirm a `DATABASE_URL` row exists.

---

## Stage 4 — Set up Google sign-in

The app has no public pages — everything requires signing in, and sign-in is
restricted to `@biome.in` Google accounts. This stage creates the credentials
that make that work.

> **Why this is not optional:** the app refuses all access when no sign-in method
> is configured. That is deliberate for something holding founder call
> transcripts, but it does mean skipping this stage leaves you locked out.

### 4a. Find your app's address

In your project, click the **Deployments** tab and note the domain, something
like `tars-abc123.vercel.app`. Write it down — you need it twice below.

### 4b. Create the Google credentials

1. Go to **https://console.cloud.google.com**.
2. At the top left, click the project dropdown → **New Project**. Name it
   `TARS` → **Create**. Wait for it, then make sure it's selected.
3. In the left menu go to **APIs & Services** → **OAuth consent screen**.
   - User type: **Internal** if `biome.in` is a Google Workspace domain — pick
     this if you can, it's simpler. Otherwise **External**.
   - App name: `TARS`. Support email: your address. Developer email: your
     address. Click through **Save and Continue** to the end.
4. In the left menu go to **Credentials** → **Create Credentials** → **OAuth
   client ID**.
   - Application type: **Web application**
   - Name: `TARS Web`
   - Under **Authorised redirect URIs** click **Add URI** and enter exactly,
     replacing the domain with yours:

     ```
     https://tars-abc123.vercel.app/api/auth/callback/google
     ```

     The `/api/auth/callback/google` part must be exact.
   - Click **Create**.
5. A box appears with **Client ID** and **Client secret**. Keep it open — you
   need both in the next stage.

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

In Vercel: **Settings** → **Environment Variables**. Add these four, one at a
time. For each, leave all three environment checkboxes ticked, then **Save**:

| Key | Value |
|---|---|
| `AUTH_SECRET` | the string from 5a |
| `AUTH_GOOGLE_ID` | Client ID from stage 4 |
| `AUTH_GOOGLE_SECRET` | Client secret from stage 4 |
| `ANTHROPIC_API_KEY` | from https://console.anthropic.com → API Keys |

Do **not** add `AUTH_DEV_CREDENTIALS`. That is for local development only and is
ignored in production.

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

You are now signed in as a **PM**, which can author the record. The first person
to sign in with any `@biome.in` account gets the PM role automatically.

---

## If something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| Build fails, mentions `DATABASE_URL` | No database attached yet | Stage 3 |
| Build fails, mentions `prisma migrate` | Database attached but unreachable | Check Storage tab shows it connected to this project |
| Sign-in page shows no Google button | Google variables missing or not yet built | Recheck 5b spelling, then redeploy (5c) |
| `redirect_uri_mismatch` from Google | The redirect URI doesn't match your domain | Stage 4b step 4 — it must be `https://<domain>/api/auth/callback/google` exactly |
| Signed in, then immediately signed out | `AUTH_SECRET` missing or changed | Recheck 5b, redeploy |
| "Access blocked" from Google | Account isn't `@biome.in` | Sign in with a Biome account |
| Pages load but extraction errors | `ANTHROPIC_API_KEY` missing | Add it (5b), redeploy |

Build logs are the fastest diagnosis: **Deployments** → click the failed one →
scroll the log for the first red line.

---

## After it's live

**Pushing updates.** Any push to `main` redeploys automatically. Nothing else to
do.

**Giving someone the partner role.** Everyone starts as PM. To make someone a
read-only PARTNER, they sign in once, then in Vercel go **Storage** → your
database → **Data** / query editor and run:

```sql
UPDATE "User" SET role = 'PARTNER' WHERE email = 'someone@biome.in';
```

Roles are `PM` (authors), `PARTNER` (reads), `ADMIN` (both, plus user
management). A role change takes effect the next time they sign in.

**Custom domain.** Settings → Domains. If you add one, go back to stage 4b and
add a second redirect URI for the new domain.

---

## Notes for later

**Migrations run during the build.** The build command is
`prisma generate && prisma migrate deploy && next build`, so schema changes apply
themselves on deploy. The trade-off: a broken migration fails the deploy rather
than half-applying. That is the safer failure for a pilot, but as the team grows
you may want to move migrations to a deliberate step.

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
