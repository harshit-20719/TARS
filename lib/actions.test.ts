import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { RuleViolation } from "@/lib/domain/rules";
import { FirefliesError } from "@/lib/fireflies/types";

/**
 * The action layer's guard on user management (R6), and what it lets back out
 * to a browser (the Fireflies block at the foot of the file).
 *
 * Nothing imported lib/actions.ts before this file. That was defensible while
 * every action shared one guard and the services were tested directly — but the
 * people actions are the first whose guard differs from the rest of the module,
 * and copying the module's house style would have produced `requireAuthor`,
 * which since U1 admits every role.
 *
 * The service is mocked, so the assertions are about what this module refuses on
 * its own rather than what lib/services/people refuses afterwards. That
 * distinction is the whole point of the file: `setRole` asserts the same
 * permission again, so a wrong guard here is invisible in the result value — both
 * paths return a refusal. Only "the service was never reached" tells them apart.
 *
 * lib/auth is mocked rather than lib/session, so `requireRole` itself is the real
 * thing under test; the mock only decides who is signed in.
 *
 * The signed-in users are real rows, because `currentActor` resolves the role
 * from the database rather than from the token — a change made precisely so a
 * demoted ADMIN cannot keep acting as one. A fake id would now resolve to no
 * actor at all, which is itself the guarantee: authorization here follows the
 * stored row, not what the session claims.
 */

let signedIn: { user: { id: string; email: string; name: string | null; role: Role } } | null =
  null;

const setRole = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const listFirefliesMeetings = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => []);
const importFirefliesCall = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
  callId: "c1",
  number: 2,
}));
const decideObservation = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const saveRubricExtractionConfig = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});

vi.mock("@/lib/auth", () => ({
  auth: async () => signedIn,
  signOut: async () => {},
}));

vi.mock("@/lib/services/people", () => ({
  setRole: (...a: unknown[]) => setRole(...a),
}));

vi.mock("@/lib/services/extractionConfig", () => ({
  saveRubricExtractionConfig: (...a: unknown[]) => saveRubricExtractionConfig(...a),
}));

vi.mock("@/lib/services/import", () => ({
  listFirefliesMeetings: (...a: unknown[]) => listFirefliesMeetings(...a),
  importFirefliesCall: (...a: unknown[]) => importFirefliesCall(...a),
}));

/**
 * Partial on purpose: lib/actions.ts imports the module as a namespace, so only
 * the member these tests reach needs to exist. The other capture services are
 * covered against the real database in lib/services/capture.test.ts.
 */
vi.mock("@/lib/services/capture", () => ({
  decideObservation: (...a: unknown[]) => decideObservation(...a),
}));

/**
 * Stubbed so a successful action can be inspected at all: revalidation runs
 * after the service returns and throws outside a request context, which would
 * otherwise leave the success path of every write action untestable here.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  decideObservationAction,
  importFirefliesCallAction,
  listFirefliesMeetingsAction,
  saveRubricExtractionConfigAction,
  setRoleAction,
} = await import("./actions");

/** One real row per role, so the database lookup in `currentActor` resolves. */
const ids: Partial<Record<Role, string>> = {};

beforeAll(async () => {
  // Empty, so resolveRole returns the stored role rather than promoting anyone.
  vi.stubEnv("ADMIN_EMAILS", "");
  for (const role of [Role.PM, Role.PARTNER, Role.ADMIN]) {
    const row = await db.user.upsert({
      where: { email: `actions-${role.toLowerCase()}@biome.in` },
      update: { role },
      create: { email: `actions-${role.toLowerCase()}@biome.in`, name: null, role },
      select: { id: true },
    });
    ids[role] = row.id;
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.user.deleteMany({ where: { id: { in: Object.values(ids) as string[] } } });
});

const signInAs = (role: Role) => {
  signedIn = {
    user: { id: ids[role]!, email: `actions-${role.toLowerCase()}@biome.in`, name: null, role },
  };
};

beforeEach(() => {
  setRole.mockClear();
  saveRubricExtractionConfig.mockClear();
});
afterEach(() => {
  signedIn = null;
});

describe("setRoleAction", () => {
  it("refuses a PM and a PARTNER without reaching the service", async () => {
    for (const role of [Role.PM, Role.PARTNER]) {
      signInAs(role);

      const result = await setRoleAction("someone", "ADMIN");

      expect(result.ok, `${role} was let through`).toBe(false);
      expect(setRole, `${role} reached the service`).not.toHaveBeenCalled();
    }
  });

  /**
   * A PARTNER is the case that matters. They author everything a PM does since
   * U1, so `requireAuthor` waves them through — and user management is the one
   * thing their role is meant to stop.
   */
  it("tells a PARTNER it is their role, not an ended session", async () => {
    signInAs(Role.PARTNER);

    const result = await setRoleAction("someone", "ADMIN");

    expect(result.ok === false && result.error).toMatch(/ADMIN/);
    expect(result.ok === false && result.reauth).toBeUndefined();
  });

  /**
   * The point of resolving from the database: the session can claim ADMIN and be
   * refused anyway. This is the demoted-admin case — their token still says
   * ADMIN, the stored row says PM, and the row is what decides.
   */
  it("refuses a session claiming ADMIN when the stored row says otherwise", async () => {
    signedIn = {
      user: { id: ids[Role.PM]!, email: "actions-pm@biome.in", name: null, role: Role.ADMIN },
    };

    const result = await setRoleAction("someone", "PARTNER");

    expect(result.ok).toBe(false);
    expect(setRole).not.toHaveBeenCalled();
  });

  it("asks a signed-out caller to sign in again rather than reporting a wrong role", async () => {
    signedIn = null;

    const result = await setRoleAction("someone", "ADMIN");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reauth).toBe(true);
    expect(setRole).not.toHaveBeenCalled();
  });

  it("lets an ADMIN through to the service", async () => {
    signInAs(Role.ADMIN);

    // Deliberately not awaiting the result: past the service call this action
    // revalidates, which throws outside a request context. What is being pinned
    // is that the guard admits an ADMIN at all — the write itself is covered
    // against a real database in lib/services/people.test.ts.
    await setRoleAction("someone", "PARTNER").catch(() => {});

    expect(setRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.ADMIN }),
      { userId: "someone", role: "PARTNER" },
    );
  });
});

/**
 * The tuning guard (R21).
 *
 * Same shape as setRoleAction's, and for the same reason: the service asserts
 * the permission again, so a wrong guard here is invisible in what the caller
 * sees — both paths return a refusal. Only "the service was never reached"
 * tells a correct guard from a missing one. The stakes are higher than a role
 * change, in one respect: what this saves is read into every future run on
 * every deal.
 */
describe("saveRubricExtractionConfigAction", () => {
  const tuning = { rubricKey: "ft", persona: "", guidance: "", temperature: 0 };

  it("refuses a PM and a PARTNER without reaching the service", async () => {
    for (const role of [Role.PM, Role.PARTNER]) {
      signInAs(role);

      const result = await saveRubricExtractionConfigAction(tuning);

      expect(result.ok, `${role} was let through`).toBe(false);
      expect(saveRubricExtractionConfig, `${role} reached the service`).not.toHaveBeenCalled();
    }
  });

  it("asks a signed-out caller to sign in again", async () => {
    signedIn = null;

    const result = await saveRubricExtractionConfigAction(tuning);

    expect(result.ok === false && result.reauth).toBe(true);
    expect(saveRubricExtractionConfig).not.toHaveBeenCalled();
  });

  it("lets an ADMIN through to the service", async () => {
    signInAs(Role.ADMIN);

    // Not awaited past the service call, for the reason given above: revalidation
    // throws outside a request context. The write itself is covered against a
    // real database in lib/services/extractionConfig.test.ts.
    await saveRubricExtractionConfigAction(tuning).catch(() => {});

    expect(saveRubricExtractionConfig).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.ADMIN }),
      tuning,
    );
  });
});

/**
 * The confirm verb's guard (KTD18).
 *
 * Confirming is `decideObservationAction` carrying the accepted decision, and
 * its guard is `requireAuthor` — the same guard as Move and Reject, because a
 * confirmation is a person's ruling like any other. Every role authors, so
 * "non-author" here means exactly one thing: nobody signed in. That is the
 * refusal worth pinning at this layer; the decision's semantics are covered
 * against the real database in lib/services/capture.test.ts.
 */
describe("decideObservationAction", () => {
  beforeEach(() => decideObservation.mockClear());

  it("refuses a signed-out caller the confirm, without reaching the service", async () => {
    signedIn = null;

    const result = await decideObservationAction("halten", "o1", { status: "accepted" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reauth).toBe(true);
    expect(decideObservation).not.toHaveBeenCalled();
  });

  it("passes a signed-in author's confirmation through untouched", async () => {
    signInAs(Role.PM);

    const result = await decideObservationAction("halten", "o1", { status: "accepted" });

    expect(result.ok).toBe(true);
    expect(decideObservation).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.PM }),
      "o1",
      { status: "accepted" },
    );
  });
});

/**
 * The Fireflies actions (R11, R24, KTD10, KTD11).
 *
 * Two things are checked here and nowhere else. `toResult` rethrows what it does
 * not recognise, and a rethrown error leaves a server action as React's generic
 * render failure with the message removed — so the Fireflies branch is the
 * difference between "the FIREFLIES_API_KEY is not valid" and "an error
 * occurred". And the import action's result crosses back to a browser, so what
 * it carries is a disclosure decision rather than a convenience one.
 *
 * The service is mocked for the same reason it is above: these assertions are
 * about this module, not about what lib/services/import does afterwards.
 */
describe("the Fireflies actions", () => {
  beforeEach(() => {
    listFirefliesMeetings.mockClear();
    importFirefliesCall.mockClear();
    listFirefliesMeetings.mockImplementation(async () => []);
    importFirefliesCall.mockImplementation(async () => ({ callId: "c1", number: 2 }));
  });

  /**
   * KTD11, honestly labelled: `requireAuthor` admits all three roles, so the
   * only caller it turns away today is one with no session — which is still the
   * thing standing between a signed-out request and the list of every call Biome
   * has recorded. A read-only role would land here too, and this is the test
   * that would notice the guard going missing before then.
   */
  it("refuses a signed-out caller the meeting list, without reaching Fireflies", async () => {
    signedIn = null;

    const result = await listFirefliesMeetingsAction({});

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reauth).toBe(true);
    expect(listFirefliesMeetings).not.toHaveBeenCalled();
  });

  it("admits a signed-in PM, passing the search through untouched", async () => {
    signInAs(Role.PM);

    const result = await listFirefliesMeetingsAction({ search: "aparna@halten.com", skip: 50 });

    expect(result.ok).toBe(true);
    expect(listFirefliesMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.PM }),
      { search: "aparna@halten.com", skip: 50 },
    );
  });

  /**
   * The listing argument is a browser payload, and it used to reach the service
   * unparsed — into the very parameter the injected Fireflies client was taken
   * out of. A `client` key in it therefore landed in the service's dependency
   * slot, which is the one thing a caller must never be able to fill.
   *
   * Three smuggled shapes in one press, because the fix is two halves and each
   * covers a different one: the schema refuses a `limit` far past Fireflies' page
   * ceiling, and naming the three fields on the way through is what drops
   * `client` however the schema evolves. What is asserted is the same thing the
   * guard tests assert — the service was never reached.
   */
  it("refuses a malformed listing request without reaching the service", async () => {
    signInAs(Role.PM);

    const result = await listFirefliesMeetingsAction({
      client: { listMeetings: async () => [], fetchTranscript: async () => "" },
      search: { $ne: null },
      limit: 5000,
    });

    expect(result.ok).toBe(false);
    expect(listFirefliesMeetings).not.toHaveBeenCalled();
  });

  /**
   * And the same key on an otherwise valid request, which is the dangerous one:
   * nothing here is malformed, so the schema has no reason to refuse the call —
   * only to strip what it does not declare.
   */
  it("drops an injected client from an otherwise valid listing request", async () => {
    signInAs(Role.PM);
    const forged = { listMeetings: async () => [], fetchTranscript: async () => "" };

    const result = await listFirefliesMeetingsAction({ search: "aparna@halten.com", client: forged });

    expect(result.ok).toBe(true);
    expect(listFirefliesMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.PM }),
      { search: "aparna@halten.com" },
    );
    // Not as a third argument either — the dependency slot is not reachable from
    // a payload at all now that it is a parameter of its own.
    expect(listFirefliesMeetings.mock.calls[0]).toHaveLength(2);
  });

  /**
   * A typed Fireflies failure comes back as a value. Without the branch in
   * `toResult` this test throws instead of returning, which is exactly what the
   * PM would see — a page that failed to render, with the reason stripped off.
   */
  it("returns a Fireflies failure as a result rather than letting it escape", async () => {
    signInAs(Role.PM);
    listFirefliesMeetings.mockImplementation(async () => {
      throw new FirefliesError("rate limited by Fireflies — nothing was imported.");
    });

    const result = await listFirefliesMeetingsAction({});

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/rate limited by Fireflies/);
  });

  it("returns an import failure the same way", async () => {
    signInAs(Role.PM);
    importFirefliesCall.mockImplementation(async () => {
      throw new FirefliesError("that meeting has no transcript yet.");
    });

    const result = await importFirefliesCallAction({ dealId: "halten", meetingId: "m1" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/no transcript yet/);
  });

  /**
   * The transcript does not travel back. The service is made to return one
   * anyway, because the risk is not the service's current shape — it is that
   * this action might one day hand back whatever it was given. It restates two
   * fields instead, and this is what holds it to that.
   */
  it("never carries transcript text back to the caller", async () => {
    signInAs(Role.PM);
    importFirefliesCall.mockImplementation(async () => ({
      callId: "c9",
      number: 3,
      transcript: "Rhea: we ran settlement operations at two clearing banks.",
    }));

    const result = await importFirefliesCallAction({
      dealId: "halten",
      meetingId: "m1",
      number: 3,
      label: "Second founder call",
    });

    expect(result).toEqual({ ok: true, data: { callId: "c9", number: 3 } });
    expect(JSON.stringify(result)).not.toContain("settlement operations");
  });
});

/**
 * Database failures, which used to be the one class of failure that reached the
 * PM saying nothing.
 *
 * `toResult` translated the typed domain errors and rethrew the rest, and a
 * rethrown error arrives in the browser as React's "an unexpected response was
 * received from the server" with the message stripped — so the failure most
 * likely to happen on a cold serverless function was the least legible one.
 * These run through the import action because the service is already mocked
 * there; the branch under test is shared by every action in the module.
 */
describe("database failures", () => {
  beforeEach(() => {
    importFirefliesCall.mockReset();
  });

  it("returns a transaction timeout as a result rather than letting it escape", async () => {
    signInAs(Role.PM);
    importFirefliesCall.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Transaction API error", {
        code: "P2028",
        clientVersion: "6.19.3",
      });
    });

    const result = await importFirefliesCallAction({ dealId: "halten", meetingId: "m1" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/took too long|nothing was saved/i);
  });

  /**
   * A missing migration is the one database failure with a specific fix, so it
   * gets a specific sentence and keeps its code.
   */
  it("names a schema mismatch as a migration that has not run", async () => {
    signInAs(Role.PM);
    importFirefliesCall.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError("column does not exist", {
        code: "P2022",
        clientVersion: "6.19.3",
      });
    });

    const result = await importFirefliesCallAction({ dealId: "halten", meetingId: "m1" });

    expect(result.ok === false && result.error).toMatch(/migration/i);
    expect(result.ok === false && result.error).toContain("P2022");
  });

  /**
   * The load-bearing one. Prisma quotes the connection string it could not
   * reach, and DATABASE_URL carries the password — so the message is described,
   * never passed through. A translation that leaked the credential would be
   * worse than the silence it replaced.
   */
  it("never passes the Prisma message through, because it can carry the credential", async () => {
    signInAs(Role.PM);
    importFirefliesCall.mockImplementation(async () => {
      throw new Prisma.PrismaClientInitializationError(
        "Can't reach database server at postgresql://tars:hunter2@db.internal:5432/tars",
        "6.19.3",
      );
    });

    const result = await importFirefliesCallAction({ dealId: "halten", meetingId: "m1" });

    expect(result.ok).toBe(false);
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("hunter2");
    expect(rendered).not.toContain("postgresql://");
    expect(rendered).not.toContain("db.internal");
    expect(result.ok === false && result.error).toMatch(/could not be reached/i);
  });

  /**
   * A service that already turned its own P2002 into a RuleViolation keeps that
   * message — "call 2 already exists for this deal" is worth more than anything
   * the generic branch could say, so the database branch has to run last.
   */
  it("does not override a message a service already translated", async () => {
    signInAs(Role.PM);
    importFirefliesCall.mockImplementation(async () => {
      throw new RuleViolation("call 2 already exists for this deal", "number");
    });

    const result = await importFirefliesCallAction({ dealId: "halten", meetingId: "m1" });

    expect(result.ok === false && result.error).toBe("call 2 already exists for this deal");
    expect(result.ok === false && result.field).toBe("number");
  });

  /** A programmer error is still a programmer error and must not be swallowed. */
  it("still rethrows what it does not recognise", async () => {
    signInAs(Role.PM);
    importFirefliesCall.mockImplementation(async () => {
      throw new TypeError("cannot read properties of undefined");
    });

    await expect(
      importFirefliesCallAction({ dealId: "halten", meetingId: "m1" }),
    ).rejects.toThrow(TypeError);
  });
});
