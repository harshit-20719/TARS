import { execSync } from "node:child_process";

/**
 * Bring the test database up to the current schema once per run.
 *
 * `migrate deploy` rather than `migrate dev`: deploy applies committed
 * migrations and never prompts or invents a new one, which is what a test run
 * and a production deploy both want. It also means the migrations themselves are
 * under test — including the CHECK constraints, which only exist in the
 * migration SQL and would otherwise go unverified.
 */
export default function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for the test run");
  if (!/tars_test|_test\b/.test(url)) {
    throw new Error(
      `refusing to run tests against ${url} — the test database name must contain "_test"`,
    );
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });

  // Seed with the real script, so the fixture-fidelity test is checking the
  // seeding path that dev and preview environments actually use. Tests that
  // mutate data create their own deals under unique ids and clean up after
  // themselves — nothing truncates, so these fixtures stay intact for the run.
  execSync("npx tsx prisma/seed.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
