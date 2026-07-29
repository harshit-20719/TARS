import { afterEach, describe, expect, it, vi } from "vitest";
import { adminEmails, isConfiguredAdmin, resolveRole } from "./adminEmails";

afterEach(() => vi.unstubAllEnvs());

describe("ADMIN_EMAILS parsing", () => {
  it("accepts a single address", () => {
    vi.stubEnv("ADMIN_EMAILS", "harshit.agarwal@biome.in");
    expect(adminEmails()).toEqual(["harshit.agarwal@biome.in"]);
  });

  it("accepts a comma-separated list with untidy spacing", () => {
    vi.stubEnv("ADMIN_EMAILS", " a@biome.in ,b@biome.in,  c@biome.in ");
    expect(adminEmails()).toEqual(["a@biome.in", "b@biome.in", "c@biome.in"]);
  });

  it("is case-insensitive on both sides", () => {
    vi.stubEnv("ADMIN_EMAILS", "Harshit.Agarwal@Biome.in");
    expect(isConfiguredAdmin("harshit.agarwal@biome.in")).toBe(true);
    expect(isConfiguredAdmin("HARSHIT.AGARWAL@BIOME.IN")).toBe(true);
  });

  it("treats an unset or empty value as nobody", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(adminEmails()).toEqual([]);
    expect(isConfiguredAdmin("anyone@biome.in")).toBe(false);
  });

  it("does not match on a prefix or substring", () => {
    // "a@biome.in" must not make "aa@biome.in" an admin.
    vi.stubEnv("ADMIN_EMAILS", "a@biome.in");
    expect(isConfiguredAdmin("aa@biome.in")).toBe(false);
    expect(isConfiguredAdmin("a@biome.in.evil.com")).toBe(false);
  });

  it("handles a null or missing email", () => {
    vi.stubEnv("ADMIN_EMAILS", "a@biome.in");
    expect(isConfiguredAdmin(null)).toBe(false);
    expect(isConfiguredAdmin(undefined)).toBe(false);
  });
});

describe("resolveRole", () => {
  it("promotes a configured admin over whatever is stored", () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@biome.in");
    expect(resolveRole("boss@biome.in", "PM")).toBe("ADMIN");
    expect(resolveRole("boss@biome.in", "PARTNER")).toBe("ADMIN");
    expect(resolveRole("boss@biome.in", null)).toBe("ADMIN");
  });

  it("defaults a brand-new colleague to PM, not admin", () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@biome.in");
    expect(resolveRole("newcomer@biome.in", null)).toBe("PM");
  });

  it("keeps a role set deliberately in the database", () => {
    // Not a demotion — a PARTNER authors the record on the same terms as a PM
    // (R5). What this pins is that a stored role survives the next sign-in
    // rather than being reset to the PM default.
    vi.stubEnv("ADMIN_EMAILS", "boss@biome.in");
    expect(resolveRole("reader@biome.in", "PARTNER")).toBe("PARTNER");
  });

  it("grants nobody admin when ADMIN_EMAILS is unset", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(resolveRole("anyone@biome.in", null)).toBe("PM");
  });
});
