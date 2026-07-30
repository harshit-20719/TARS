import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { NotAuthorized, type Actor } from "@/lib/authz";
import { GUIDANCE_MAX, PERSONA_MAX, saveRubricExtractionConfig } from "./extractionConfig";

/**
 * The write side of extraction tuning (R17–R19; KTD13).
 *
 * The temperature cap is enforced in three places — the schema here, the CHECK
 * constraint in the migration, and the control's bounds (U11) — so this file
 * proves the first two independently: the service refusal with its readable
 * message, and the raw insert the constraint alone can stop. Every refusal
 * asserts the stored table afterwards, because a refusal that writes anyway is
 * the failure mode worth catching.
 */

let admin: Actor;
const createdUsers: string[] = [];

/** A synthetic non-admin: the guard refuses before any row could need to exist. */
const asRole = (role: Role): Actor => ({
  id: "someone",
  email: "someone@biome.in",
  name: null,
  role,
});

const valid = (overrides: Record<string, unknown> = {}) => ({
  rubricKey: "gtm",
  persona: "You are a GTM operator reading a founder call.",
  guidance: "Prefer what buyers did over what founders said.",
  temperature: 0.2,
  ...overrides,
});

const stored = (rubricKey: string) =>
  db.rubricExtractionConfig.findUnique({ where: { rubricKey } });

beforeAll(async () => {
  const row = await db.user.create({
    data: { email: "u10-tuning-admin@biome.in", name: "Tuning Admin", role: Role.ADMIN },
  });
  createdUsers.push(row.id);
  admin = { id: row.id, email: row.email, name: row.name, role: Role.ADMIN };
});

// The table holds at most six global rows and the seed never writes it (KTD15),
// so each test starts it empty rather than inventing per-test keys.
beforeEach(async () => {
  await db.rubricExtractionConfig.deleteMany();
});

afterAll(async () => {
  await db.rubricExtractionConfig.deleteMany();
  await db.user.deleteMany({ where: { id: { in: createdUsers } } });
});

describe("saving a rubric's extraction config", () => {
  it("creates the row at version 1, trimmed and attributed", async () => {
    await saveRubricExtractionConfig(admin, valid({ persona: "  A patient reader.  " }));

    const row = await stored("gtm");
    expect(row).toMatchObject({
      rubricKey: "gtm",
      persona: "A patient reader.",
      guidance: "Prefer what buyers did over what founders said.",
      temperature: 0.2,
      version: 1,
      updatedById: admin.id,
    });
  });

  it("bumps the version on every save after the first", async () => {
    await saveRubricExtractionConfig(admin, valid());
    await saveRubricExtractionConfig(admin, valid({ guidance: "Second reading." }));

    const row = await stored("gtm");
    expect(row?.version).toBe(2);
    expect(row?.guidance).toBe("Second reading.");
  });

  it("accepts an empty persona and guidance — untuned is a valid tuning", async () => {
    await saveRubricExtractionConfig(admin, valid({ persona: "", guidance: "", temperature: 0 }));

    expect(await stored("gtm")).toMatchObject({ persona: "", guidance: "", temperature: 0 });
  });

  it("accepts the cap itself — 0.4 is the top of the range, not past it", async () => {
    await saveRubricExtractionConfig(admin, valid({ temperature: 0.4 }));
    expect((await stored("gtm"))?.temperature).toBe(0.4);
  });
});

describe("what the input schema refuses", () => {
  it("refuses a temperature above the cap, naming the cap, and writes nothing", async () => {
    await expect(saveRubricExtractionConfig(admin, valid({ temperature: 0.5 }))).rejects.toThrow(
      /0\.4/,
    );
    expect(await stored("gtm")).toBeNull();
  });

  it("refuses a negative temperature", async () => {
    await expect(saveRubricExtractionConfig(admin, valid({ temperature: -0.1 }))).rejects.toThrow(
      /0\.4/,
    );
    expect(await stored("gtm")).toBeNull();
  });

  it("refuses a persona beyond the cap, naming the limit", async () => {
    await expect(
      saveRubricExtractionConfig(admin, valid({ persona: "p".repeat(PERSONA_MAX + 1) })),
    ).rejects.toThrow(new RegExp(String(PERSONA_MAX)));
    expect(await stored("gtm")).toBeNull();
  });

  it("refuses guidance beyond the cap, naming the limit", async () => {
    await expect(
      saveRubricExtractionConfig(admin, valid({ guidance: "g".repeat(GUIDANCE_MAX + 1) })),
    ).rejects.toThrow(new RegExp(String(GUIDANCE_MAX)));
    expect(await stored("gtm")).toBeNull();
  });

  it("trims before it measures, so trailing whitespace cannot trip the cap", async () => {
    const exact = "p".repeat(PERSONA_MAX);
    await saveRubricExtractionConfig(admin, valid({ persona: `  ${exact}  ` }));
    expect((await stored("gtm"))?.persona).toBe(exact);
  });

  it("refuses a rubric key the framework does not have", async () => {
    await expect(
      saveRubricExtractionConfig(admin, valid({ rubricKey: "market" })),
    ).rejects.toThrow(/not a rubric/);
    expect(await db.rubricExtractionConfig.count()).toBe(0);
  });

  it('refuses "PM" the role — the rubric is "pm", and the collision must not blur', async () => {
    await expect(saveRubricExtractionConfig(admin, valid({ rubricKey: "PM" }))).rejects.toThrow(
      /not a rubric/,
    );
    expect(await db.rubricExtractionConfig.count()).toBe(0);
  });
});

describe("who may tune extraction", () => {
  it("refuses a PM before anything is written", async () => {
    await expect(saveRubricExtractionConfig(asRole(Role.PM), valid())).rejects.toThrow(
      "Tuning extraction is limited to ADMIN; you are signed in as PM.",
    );
    expect(await db.rubricExtractionConfig.count()).toBe(0);
  });

  it("refuses a PARTNER too — authoring the record does not cover tuning the machine", async () => {
    await expect(saveRubricExtractionConfig(asRole(Role.PARTNER), valid())).rejects.toThrow(
      NotAuthorized,
    );
    expect(await db.rubricExtractionConfig.count()).toBe(0);
  });

  it("lets an ADMIN through", async () => {
    await saveRubricExtractionConfig(admin, valid());
    expect(await db.rubricExtractionConfig.count()).toBe(1);
  });
});

describe("the database constraint", () => {
  // The CHECK lives only in the migration SQL, so only a raw insert — past the
  // service and past the client — can prove it holds (KTD13's second fence).

  it("rejects a temperature above the cap inserted directly", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "RubricExtractionConfig" ("id","rubricKey","persona","guidance","temperature","version","createdAt","updatedAt")
         VALUES ('u10-bad-temp','ft','','',0.9,1,now(),now())`,
      ),
    ).rejects.toThrow(/rubric_extraction_config_temperature_range/);
  });

  it("rejects a negative temperature inserted directly", async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "RubricExtractionConfig" ("id","rubricKey","persona","guidance","temperature","version","createdAt","updatedAt")
         VALUES ('u10-bad-neg','pm','','',-0.1,1,now(),now())`,
      ),
    ).rejects.toThrow(/rubric_extraction_config_temperature_range/);
  });
});
