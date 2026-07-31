import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Component tests, in a browser-like environment.
 *
 * A separate config from vitest.config.ts because the two suites need genuinely
 * different worlds: the service tests run in Node against a real Postgres database
 * and must not run in parallel, while these run in jsdom, touch no database, and
 * are happy to parallelise. Forcing one config to serve both meant the components
 * simply went untested — which is how three client-state defects shipped past a
 * green suite of 197 tests.
 *
 * Run with `npm run test:components`, or both suites with `npm test`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "jsdom",
    include: ["components/**/*.test.tsx"],
    setupFiles: ["./test/components.setup.ts"],
    globals: true,
    /**
     * The same credential pins the service config carries, and for the same
     * reason: test.env merges into the inherited process.env, so any name left
     * unpinned lets a developer's shell credential route a test run at a live
     * endpoint. Nothing under components/ reaches a provider today — the
     * exposure is the future component test that stubs at the wrong layer on a
     * machine where a real key is exported.
     */
    env: {
      ANTHROPIC_API_KEY: "",
      GOOGLE_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_CLOUD_PROJECT: "",
      GOOGLE_CLOUD_LOCATION: "",
      GOOGLE_GENAI_USE_VERTEXAI: "",
      GOOGLE_GENAI_USE_ENTERPRISE: "",
      FIREFLIES_API_KEY: "",
    },
  },
});
