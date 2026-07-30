import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDeal as mockGetDeal,
  getRecord as mockGetRecord,
  listDeals as mockListDeals,
} from "@/mock/data";
import type { DealRecord } from "@/mock/types";
import { db } from "@/lib/db";
import { getDeal, getRecord, listDeals, listReassignCandidates } from "./records";

/**
 * Evidence is a set of cited observations, not a sequence — the database returns
 * it sorted by id while the fixtures list it in the order the PM happened to
 * pick. Normalise both sides so the comparison tests what actually matters.
 */
function normalise(record: DealRecord): DealRecord {
  return {
    ...record,
    scores: record.scores.map((s) => ({ ...s, evidenceObsIds: [...s.evidenceObsIds].sort() })),
  };
}

describe("the seam returns what the front end already expects", () => {
  it("lists the same deals in the same order", async () => {
    expect(await listDeals()).toEqual(mockListDeals());
  });

  it("returns a single deal identically", async () => {
    expect(await getDeal("halten")).toEqual(mockGetDeal("halten"));
  });

  it("returns undefined for a deal that does not exist", async () => {
    expect(await getDeal("nope")).toBeUndefined();
    expect(await getRecord("nope")).toBeUndefined();
  });

  // The whole point of the backend: every page reads through getRecord, so if
  // these match the fixtures then swapping the data source changed nothing the
  // UI can observe.
  for (const id of ["halten", "cirrus", "parch"]) {
    it(`round-trips the full ${id} record`, async () => {
      const fromDb = await getRecord(id);
      expect(fromDb).toBeDefined();
      expect(normalise(fromDb!)).toEqual(normalise(mockGetRecord(id)!));
    });
  }

  it("synthesises the empty founder-type read for a deal that has none", async () => {
    const record = await getRecord("parch");
    expect(record!.founderTypeRead).toEqual({
      dealId: "parch",
      primary: "",
      profile: "",
      floorDimension: "",
      pmConfirmation: "",
    });
    // Nothing was stored for it — the empty shape is produced, not persisted.
    expect(await db.founderTypeRead.findUnique({ where: { dealId: "parch" } })).toBeNull();
  });

  it("carries the layer stamp on everything that is layered", async () => {
    const r = (await getRecord("halten"))!;
    for (const o of r.observations) expect(o.layer).toBe("L1");
    for (const s of r.scores) expect(s.layer).toBe("L1");
    for (const s of r.slides) expect(s.layer).toBe("L1");
  });

  it("decodes both score scales without mixing them", async () => {
    const r = (await getRecord("halten"))!;
    const scale = r.scores.filter((s) => s.scoreType === "scale");
    const binary = r.scores.filter((s) => s.scoreType === "binary");
    expect(scale.length).toBeGreaterThan(0);
    expect(binary.length).toBeGreaterThan(0);
    for (const s of scale) expect(s.value === "NE" || typeof s.value === "number").toBe(true);
    for (const s of binary) expect(["pass", "unv", "fail"]).toContain(s.value);
  });
});

/**
 * KTD16. The per-block run record is what makes a partial extraction legible
 * after a refresh (R24): which blocks went unread is read from the record, not
 * from client state. The fixture round-trips above already pin the shape; these
 * pin the semantics the fixtures were built to carry.
 */
describe("per-block extraction outcomes on the record", () => {
  it("exposes a partial run's unread block with its reason, and derives extracted from it", async () => {
    const call = (await getRecord("cirrus"))!.calls[0];
    // The seeded partial-run path: one block failed, so the boolean is false.
    expect(call.extracted).toBe(false);
    const failed = call.blockRuns.filter((r) => r.outcome !== "read");
    expect(failed).toHaveLength(1);
    expect(failed[0].rubricKey).toBe("fl");
    // Retryable, distinguishably — the UI may invite a re-run on this kind only.
    expect(failed[0].outcome).toBe("failed-retryable");
    expect(failed[0].reason).toMatch(/rate limited/);
  });

  it("marks every read block read, carrying its drop counts and no reason key", async () => {
    const call = (await getRecord("halten"))!.calls[0];
    expect(call.extracted).toBe(true);
    expect(call.blockRuns).toHaveLength(6);
    for (const run of call.blockRuns) {
      expect(run.outcome).toBe("read");
      // Absent rather than undefined-valued — absence means "nothing to
      // explain", the same convention the import attribution argues for.
      expect(Object.keys(run)).not.toContain("reason");
      expect(Object.keys(run)).not.toContain("configVersion");
    }
    // The verbatim guard's work is on the record, attributed to its block.
    expect(call.blockRuns.find((r) => r.rubricKey === "pm")?.droppedQuotes).toBe(1);
  });

  it("gives a call that has never been extracted an empty run list, not a missing one", async () => {
    await db.deal.create({
      data: {
        id: "block-run-empty-fixture",
        company: "Blockless",
        oneLiner: "No extraction yet.",
        founders: "Test Founder",
        ownerPm: "You",
        opened: new Date("2026-07-26"),
        layer: "L1",
        calls: {
          create: { number: 1, label: "First", date: new Date("2026-07-26"), transcript: "t" },
        },
      },
    });
    try {
      const call = (await getRecord("block-run-empty-fixture"))!.calls[0];
      expect(call.blockRuns).toEqual([]);
      expect(call.extracted).toBe(false);
    } finally {
      await db.deal.delete({ where: { id: "block-run-empty-fixture" } });
    }
  });
});

/**
 * KTD9. "Mine" is a `where` clause, not a filter over an already-fetched list,
 * so it stays correct as the deal count grows past what one page can hold.
 *
 * These create their own deals and remove them again — the fixture-equality
 * assertion above reads the unfiltered list, so a stray row would break it.
 */
describe("filtering the deals list by owner", () => {
  let mine: string;
  let theirs: string;
  let ownerId: string;
  let otherOwnerId: string;

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: "pm@biome.in" } }),
      db.user.findUniqueOrThrow({ where: { email: "partner@biome.in" } }),
    ]);
    ownerId = a.id;
    otherOwnerId = b.id;

    const base = {
      oneLiner: "Owner filter fixture.",
      founders: "Test Founder",
      opened: new Date("2026-07-25"),
      layer: "L1" as const,
    };
    const [x, y] = await Promise.all([
      db.deal.create({ data: { ...base, id: "owner-filter-mine", company: "Filter Mine", ownerPm: a.name ?? a.email, ownerId } }),
      db.deal.create({ data: { ...base, id: "owner-filter-theirs", company: "Filter Theirs", ownerPm: b.name ?? b.email, ownerId: otherOwnerId } }),
    ]);
    mine = x.id;
    theirs = y.id;
  });

  afterAll(async () => {
    await db.deal.deleteMany({ where: { id: { in: [mine, theirs] } } });
  });

  it("returns only that owner's deals", async () => {
    const ids = (await listDeals(ownerId)).map((d) => d.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    // The seeded fixtures have no owner relation at all, so none of them qualify.
    expect(ids).not.toContain("halten");
  });

  it("returns every deal when no owner is given", async () => {
    const ids = (await listDeals()).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([mine, theirs, "halten"]));
  });

  it("returns nothing for an owner who holds no deals, rather than everything", async () => {
    // The failure mode worth pinning: an ignored filter looks like a working page
    // right up until someone reads a list that is not theirs.
    expect(await listDeals("nobody-owns-anything")).toEqual([]);
  });

  it("orders a filtered list the same way it orders the whole one", async () => {
    const filtered = await listDeals(ownerId);
    const all = (await listDeals()).filter((d) => filtered.some((f) => f.id === d.id));
    expect(filtered).toEqual(all);
  });
});

/**
 * The picker's read is deliberately narrower than `listPeople`.
 *
 * `listPeople` carries roles and timestamps and is reachable only from the ADMIN
 * page. Handing a deal over needs a name to choose from and an id to send, and
 * this control is rendered for every author — so it reads only those two.
 */
describe("who a deal can be handed to", () => {
  it("returns everyone who holds an account, with something to call them by", async () => {
    const people = await listReassignCandidates();
    expect(people.length).toBeGreaterThanOrEqual(3);
    const pm = people.find((p) => p.name === "Pilot PM");
    expect(pm).toBeDefined();
    expect(pm!.id).toBeTruthy();
  });

  it("carries no role — the control has no use for one and should not be handed it", async () => {
    for (const person of await listReassignCandidates()) {
      expect(person).not.toHaveProperty("role");
      expect(Object.keys(person).sort()).toEqual(["id", "name"]);
    }
  });
});

describe("database-level constraints", () => {
  // These live only in the migration SQL, so without a test they would be
  // entirely unverified.

  it("rejects a score value that contradicts its scoreType", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "SubDimensionScore" ("id","dealId","subDimensionKey","scoreType","value","layer","rubricVersion","flag","createdAt","updatedAt")
         VALUES ('bad-1','halten','earned-insight','scale','pass','L1','v1',false,now(),now())`,
      ),
    ).rejects.toThrow(/score_value_matches_type/);
  });

  it("rejects a slide outside 0–10", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "Slide" ("id","dealId","slideKey","value","lens","ceilingGuard","layer","createdAt","updatedAt")
         VALUES ('bad-2','halten','bmi',42,'peak','guard','L1',now(),now())`,
      ),
    ).rejects.toThrow(/slide_value_in_range/);
  });

  it("rejects a provisional read below the banked value", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "Slide" ("id","dealId","slideKey","value","provisionalValue","lens","ceilingGuard","layer","createdAt","updatedAt")
         VALUES ('bad-3','halten','bmi',5,2,'peak','guard','L1',now(),now())`,
      ),
    ).rejects.toThrow(/slide_provisional_not_below_banked/);
  });

  it("rejects an empty ceiling guard", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "Slide" ("id","dealId","slideKey","value","lens","ceilingGuard","layer","createdAt","updatedAt")
         VALUES ('bad-4','halten','bmi',5,'peak','   ','L1',now(),now())`,
      ),
    ).rejects.toThrow(/slide_ceiling_guard_present/);
  });

  it("keeps one score per deal, sub-dimension and layer", async () => {
    await expect(
      db.subDimensionScore.create({
        data: {
          dealId: "halten",
          subDimensionKey: "earned-insight",
          scoreType: "scale",
          value: "2",
          layer: "L1",
        },
      }),
    ).rejects.toThrow();
  });
});
