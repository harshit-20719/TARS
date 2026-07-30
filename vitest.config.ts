import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Load .env by hand. @prisma/client does not read .env at runtime — Next.js
 * normally does that — so under Vitest the connection string has to be put on
 * the environment before any test imports lib/db.
 */
function loadEnv(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path.resolve(__dirname, file), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const eq = line.indexOf("=");
          const key = line.slice(0, eq).trim();
          const raw = line.slice(eq + 1).trim();
          return [key, raw.replace(/^["']|["']$/g, "")];
        })
        .filter(([k]) => k),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(".env"), ...process.env } as Record<string, string>;

/**
 * Tests run against a *separate* database. Pointing them at the dev database
 * would let a truncating test wipe the seeded record mid-session.
 */
const TEST_DATABASE_URL =
  env.TEST_DATABASE_URL ?? "postgresql://tars:tars@127.0.0.1:5433/tars_test?schema=public";

// globalSetup runs in the main process, before `test.env` is applied to workers,
// so the connection string has to be on the real environment as well.
process.env.DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      /**
       * The Gemini adapter opens with `import "server-only"`, whose default
       * (non-react-server) build throws on import by design — that is the
       * guard. Vitest runs under the default condition, so the tests resolve
       * the marker to the package's own react-server build, which is empty.
       */
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "framework/**/*.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      AUTH_SECRET: env.AUTH_SECRET ?? "test-secret-not-used-for-anything-real-0123456789",
      // Kept unset on purpose: the extraction tests inject a stub client, and a
      // real key here would let a bug reach the live API from a test run.
      ANTHROPIC_API_KEY: "",
      // The Gemini adapter's credentials, unset for the same reason — its
      // tests inject a stub client and must never reach the live API.
      GOOGLE_API_KEY: "",
      GEMINI_API_KEY: "",
      // Same reasoning, and one more: the Fireflies account holds every call
      // Biome has recorded, so a test that reached it would be reading founder
      // transcripts from a suite run.
      FIREFLIES_API_KEY: "",
    },
    // The database-backed suites share one Postgres database, so test files run
    // one at a time rather than racing each other's writes.
    pool: "forks",
    fileParallelism: false,
  },
});
