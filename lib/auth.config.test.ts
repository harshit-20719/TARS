import { describe, expect, it } from "vitest";
import type { JWT } from "next-auth/jwt";
import { ABSOLUTE_SESSION_MS, IDLE_SESSION_SECONDS, authConfig } from "./auth.config";

/**
 * The session bounds, asserted at the config rather than through a browser.
 *
 * R23 is the one requirement here with no visible surface: nothing renders, and
 * the failure mode is a session that quietly never ends. Two things make it worth
 * pinning in a test.
 *
 * `maxAge` is in **seconds**. A millisecond value typechecks, builds, and yields a
 * session roughly a year long — the exact bug this requirement exists to prevent,
 * expressed as a unit slip nothing else would catch.
 *
 * And `maxAge` on its own is an *idle* timeout: @auth/core recomputes the expiry
 * and re-signs the token on every session read, so it never fires for the active
 * user R23 actually targets. The absolute bound is the jwt callback returning
 * null, which is what clears the cookie.
 */

const jwt = authConfig.callbacks.jwt;

/**
 * The callback's real shape, narrowed to what these cases exercise. Declared
 * async so the sync callback is still awaitable — Auth.js allows either.
 */
const call = async (
  token: Record<string, unknown>,
  user?: Record<string, unknown>,
): Promise<JWT | null> =>
  (await jwt({ token, user } as unknown as Parameters<typeof jwt>[0])) as JWT | null;

describe("session bounds", () => {
  it("uses the jwt strategy", () => {
    expect(authConfig.session.strategy).toBe("jwt");
  });

  it("sets the idle bound in seconds, not milliseconds", () => {
    expect(authConfig.session.maxAge).toBe(28800);
    expect(authConfig.session.maxAge).toBe(IDLE_SESSION_SECONDS);
    // Eight hours. Stated as a bare number too, so a refactor of the constant
    // cannot quietly move the bound while the test keeps passing.
    expect(IDLE_SESSION_SECONDS).toBe(8 * 60 * 60);
  });

  it("sets the absolute bound outside a working day", () => {
    expect(ABSOLUTE_SESSION_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("the absolute bound", () => {
  it("stamps a sign-in time on the token, but only at sign-in", async () => {
    const signedIn = await call({}, { id: "u1", email: "pm@biome.in", role: "PM" });
    expect(signedIn).not.toBeNull();
    expect(typeof signedIn?.signedInAt).toBe("number");

    // A later pass carries no `user`, so nothing re-stamps — which is what makes
    // the bound absolute rather than another idle window. The stamp has to sit
    // inside the window for this to be testing re-stamping rather than expiry.
    const stamp = Date.now() - 60_000;
    const later = await call({ signedInAt: stamp, id: "u1", role: "PM" });
    expect(later).not.toBeNull();
    expect(later?.signedInAt).toBe(stamp);
  });

  it("returns the token while inside the bound", async () => {
    const token = { signedInAt: Date.now() - 60_000, id: "u1", role: "PM" };
    await expect(call(token)).resolves.not.toBeNull();
  });

  it("returns null once the bound is passed, which clears the cookie", async () => {
    const token = { signedInAt: Date.now() - (ABSOLUTE_SESSION_MS + 1_000), id: "u1", role: "PM" };
    await expect(call(token)).resolves.toBeNull();
  });

  // AE9. A colleague who has left keeps their issued session until a bound ends
  // it — deleting their TARS row would not, since signing in requires no
  // pre-existing row and would recreate them as an author.
  it("expires a token carrying no sign-in stamp, rather than grandfathering it", async () => {
    await expect(call({ id: "u1", role: "PM" })).resolves.toBeNull();
  });
});
