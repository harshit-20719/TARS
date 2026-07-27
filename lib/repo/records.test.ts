import { describe, expect, it } from "vitest";
import {
  getDeal as mockGetDeal,
  getRecord as mockGetRecord,
  listDeals as mockListDeals,
} from "@/mock/data";
import type { DealRecord } from "@/mock/types";
import { db } from "@/lib/db";
import { getDeal, getRecord, listDeals } from "./records";

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
