# Runbook — local setup and Vercel deployment

Two audiences: someone starting work on the backend locally, and someone
provisioning the deployed app. The Vercel half needs dashboard access, which the
agent that wrote this does not have — those steps are for you or Mehul.

---

## Local development

### 1. Postgres

Any Postgres 14+ will do. Two databases, one for development and one for tests:

```bash
createdb tars
createdb tars_test
```

Or with Docker:

```bash
docker run -d --name tars-pg -p 5433:5432 \
  -e POSTGRES_USER=tars -e POSTGRES_PASSWORD=tars -e POSTGRES_DB=tars \
  postgres:16-alpine
docker exec tars-pg createdb -U tars tars_test
```

### 2. Environment

```bash
cp .env.example .env
npx auth secret          # writes AUTH_SECRET
```

Set `DATABASE_URL` and `TEST_DATABASE_URL` to match your Postgres. Leave
`AUTH_DEV_CREDENTIALS="true"` so you can sign in without Google credentials.

### 3. Schema and data

```bash
npm install
npm run db:migrate       # apply migrations
npm run db:seed          # load the three fixture deals + three users
```

### 4. Run it

```bash
npm run dev
```

Sign in at `/api/auth/signin` with any seeded user, password `tars-dev`:

| Email | Role | Can do |
|---|---|---|
| `harshit.agarwal@biome.in` | ADMIN | everything |
| `pm@biome.in` | PM | author the record |
| `partner@biome.in` | PARTNER | read only |

### 5. Tests

```bash
npm test                 # 112 tests; migrates + seeds tars_test first
npm run typecheck
```

The suite refuses to run against a database whose name does not contain
`_test`.

---

## Vercel deployment

### 1. Move the project off the personal fork

The current deployment was created from a personal fork. To own it:

1. In Vercel, create a new project against `harshit-20719/TARS` under the Biome
   team.
2. Framework preset: **Next.js**. Build command and output directory are
   detected — the `build` script already runs `prisma generate` first, which is
   required because the generated client is not committed.
3. Delete the old project once the new one serves traffic, so pushes stop
   deploying twice.

### 2. Postgres

Vercel dashboard → **Storage** → create a Postgres database → connect it to the
project. Vercel injects `DATABASE_URL` (and `POSTGRES_*` aliases) automatically.

> Vercel's Postgres is Neon-backed. Either way it is a standard Postgres
> connection string and needs no code change.

### 3. Environment variables

Project → Settings → Environment Variables. Set for **Production** and
**Preview**:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | *(injected by Storage)* | Verify it is present |
| `AUTH_SECRET` | `npx auth secret` output | Different from local |
| `AUTH_GOOGLE_ID` | from Google Cloud | See step 4 |
| `AUTH_GOOGLE_SECRET` | from Google Cloud | See step 4 |
| `ANTHROPIC_API_KEY` | from the Anthropic console | Extraction fails without it |
| `EXTRACTION_MODEL` | *(omit)* | Defaults to `claude-opus-5` |

**Do not set `AUTH_DEV_CREDENTIALS`.** It is ignored in production builds, but
leaving it unset removes the question entirely.

### 4. Google OAuth

Required — without it nobody can sign in (auth fails closed by design).

1. Google Cloud Console → **APIs & Services** → **Credentials** → Create
   credentials → **OAuth client ID** → Web application.
2. Authorised redirect URIs — add one per domain you will use:
   - `https://<your-domain>/api/auth/callback/google`
   - `https://<preview-domain>/api/auth/callback/google` if previews need sign-in
3. Copy the client ID and secret into the Vercel variables above.

Sign-in is restricted to `@biome.in` addresses with a verified email, in
`lib/auth.config.ts`. Change `ALLOWED_EMAIL_DOMAIN` there to widen it.

### 5. Migrate and seed production

Migrations do not run automatically. From your machine, against the production
connection string:

```bash
DATABASE_URL="<production url>" npx prisma migrate deploy
```

Then create the real users. **Do not run `npm run db:seed` against
production** — it loads three fictional deals. Instead insert the actual people,
with `passwordHash` left null so they can only sign in with Google:

```sql
INSERT INTO "User" (id, email, name, role, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'someone@biome.in', 'Someone', 'PM', now(), now());
```

Roles are `PM`, `PARTNER`, `ADMIN`.

> A first-time Google sign-in creates a `User` row automatically with the default
> role `PM`. Pre-inserting is only needed to give somebody `PARTNER` or `ADMIN`
> before their first sign-in.

### 6. Verify

- `https://<domain>/deals` redirects to sign-in when signed out.
- Sign in with a `@biome.in` Google account; the three routes render.
- A non-Biome Google account is refused.

---

## Operational notes

**Migrations on deploy.** Adding `prisma migrate deploy` to the build command
would let a failed migration take the site down mid-deploy, and Vercel builds
can run concurrently. Running it deliberately from a machine is the safer
default at this size.

**Connection limits.** Serverless opens a pool per instance, and Postgres
providers cap connections. If you see connection-limit errors under load, add a
pooled connection string (`?pgbouncer=true` on Neon-backed Vercel Postgres)
rather than raising the cap.

**Rolling back.** Prisma has no down-migrations. To undo a schema change, write
a new migration that reverses it.

**Secret rotation.** Rotating `AUTH_SECRET` invalidates every session — everyone
signs in again. Rotating `ANTHROPIC_API_KEY` affects nothing but extraction.
