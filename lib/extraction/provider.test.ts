import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Provider selection (U4, R1/R4): one place decides which provider extraction
 * runs on, and everything that mentions extraction reads it.
 *
 * The rule under test: Gemini by default, Anthropic when only its key is set,
 * and **Gemini wins when both are configured** — adding the Gemini key is the
 * cutover, removing it is the fallback. No provider configured is a legible
 * off state naming both credential paths, never a silent one.
 */

const { resolveProvider, missingCredentialCopy } = await import("./provider");

/**
 * Every credential empty is the suite's baseline (vitest.config.ts pins them),
 * so each test only stubs what it means to set.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveProvider", () => {
  it("reports Gemini when only GOOGLE_API_KEY is set", () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-key");

    const r = resolveProvider();
    expect(r.provider).toBe("gemini");
    expect(r.model).toBe("gemini-2.5-flash-lite");
    expect(r.enabled).toBe(true);
  });

  it("honours GEMINI_API_KEY as the second name for the same credential", () => {
    vi.stubEnv("GEMINI_API_KEY", "g-key");

    expect(resolveProvider().provider).toBe("gemini");
  });

  it("reports Anthropic when only ANTHROPIC_API_KEY is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");

    const r = resolveProvider();
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.enabled).toBe(true);
  });

  /**
   * The cutover rule itself (R1). With both keys present, Gemini is the active
   * provider — deploying the Gemini key IS the switch, and deleting it falls
   * back to Anthropic with no other change.
   */
  it("picks Gemini when both providers are configured", () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");

    const r = resolveProvider();
    expect(r.provider).toBe("gemini");
    expect(r.model).toBe("gemini-2.5-flash-lite");
  });

  it("disables extraction when no provider is configured, naming both credential paths", () => {
    const r = resolveProvider();
    expect(r.provider).toBeNull();
    expect(r.enabled).toBe(false);
    expect(r.model).toBeNull();
    // Every way to switch extraction on is named — the off state must explain itself.
    expect(r.missing).toContain("GOOGLE_API_KEY");
    expect(r.missing).toContain("GEMINI_API_KEY");
    expect(r.missing).toContain("ANTHROPIC_API_KEY");

    const copy = missingCredentialCopy();
    expect(copy).toMatch(/GOOGLE_API_KEY/);
    expect(copy).toMatch(/ANTHROPIC_API_KEY/);
    expect(copy).toMatch(/Gemini/);
    expect(copy).toMatch(/Anthropic/);
  });

  it("ignores whitespace-only credentials", () => {
    vi.stubEnv("GOOGLE_API_KEY", "   ");
    vi.stubEnv("ANTHROPIC_API_KEY", "  ");

    expect(resolveProvider().provider).toBeNull();
  });

  it("applies EXTRACTION_MODEL to whichever provider is active", () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-key");
    vi.stubEnv("EXTRACTION_MODEL", "gemini-2.5-pro");
    expect(resolveProvider().model).toBe("gemini-2.5-pro");

    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "a-key");
    vi.stubEnv("EXTRACTION_MODEL", "claude-haiku-4-5");
    expect(resolveProvider().model).toBe("claude-haiku-4-5");
  });

  it("falls through an empty EXTRACTION_MODEL to the provider default", () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-key");
    vi.stubEnv("EXTRACTION_MODEL", "   ");

    expect(resolveProvider().model).toBe("gemini-2.5-flash-lite");
  });
});

describe("the test environment itself", () => {
  /**
   * The service suite must be incapable of reaching a live Google API: every
   * credential and Vertex routing variable is pinned empty in vitest.config.ts,
   * because test.env merges into the inherited process.env — an unpinned name
   * would let a developer's shell credential reach a live API from a test run.
   */
  it("pins every Google credential and routing variable empty", () => {
    for (const name of [
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_LOCATION",
      "GOOGLE_GENAI_USE_VERTEXAI",
      "GOOGLE_GENAI_USE_ENTERPRISE",
      "ANTHROPIC_API_KEY",
    ]) {
      expect(process.env[name] ?? "", name).toBe("");
    }
  });
});
