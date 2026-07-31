import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUBRICS } from "@/framework/rubrics";
import { db } from "@/lib/db";
import { DEFAULT_EXTRACTION_TEMPERATURE } from "@/lib/extraction/types";
import { listExtractionConfigs, saveExtractionConfig } from "./extractionConfig";

/**
 * KTD15. Defaults come from reading through absent rows: the production build
 * runs migrations and never the seed, so a fresh deploy has no config rows at
 * all and the repository synthesizes the empty shape — the same choice the
 * founder-type read already made. An admin's first save creates the row.
 */

const RUBRIC_KEYS = RUBRICS.map((r) => r.key);

async function tunerId(): Promise<string> {
  return (await db.user.findUniqueOrThrow({ where: { email: "pm@biome.in" } })).id;
}

// The table holds at most six global rows and the seed never writes it, so each
// test starts it empty rather than inventing per-test keys.
beforeEach(async () => {
  await db.rubricExtractionConfig.deleteMany();
});

afterAll(async () => {
  await db.rubricExtractionConfig.deleteMany();
});

describe("reading configuration with no rows", () => {
  it("returns six default entries, one per rubric, in framework order", async () => {
    const configs = await listExtractionConfigs();

    expect(configs.map((c) => c.rubricKey)).toEqual(RUBRIC_KEYS);
    for (const config of configs) {
      // An absent row has no version — null, not 0 — so a run under defaults
      // stamps nothing rather than naming a text nobody wrote.
      expect(config).toEqual({
        rubricKey: config.rubricKey,
        persona: "",
        guidance: "",
        // The real default, never 0. Zero is greedy decoding, and this
        // synthesized shape is what fed it to every untuned run while the
        // adapter's own default sat unreachable behind a nullish check.
        temperature: DEFAULT_EXTRACTION_TEMPERATURE,
        version: null,
      });
    }
    // Synthesized, not persisted — the read must not create rows.
    expect(await db.rubricExtractionConfig.count()).toBe(0);
  });
});

describe("saving one rubric's config", () => {
  it("creates at version 1, then increments on every later save", async () => {
    const updatedById = await tunerId();

    await saveExtractionConfig({
      rubricKey: "pt",
      persona: "A CTO reading a build story.",
      guidance: "Weight what is running over what is planned.",
      temperature: 0.3,
      updatedById,
    });
    expect(
      await db.rubricExtractionConfig.findUnique({ where: { rubricKey: "pt" } }),
    ).toMatchObject({ version: 1, updatedById });

    await saveExtractionConfig({
      rubricKey: "pt",
      persona: "A CTO reading a build story.",
      guidance: "Weight what is running over what is demoed.",
      temperature: 0.1,
      updatedById,
    });
    expect(
      await db.rubricExtractionConfig.findUnique({ where: { rubricKey: "pt" } }),
    ).toMatchObject({ version: 2, temperature: 0.1 });
  });
});

describe("a mixed table — some rubrics tuned, some never touched", () => {
  it("returns real values for saved rows and defaults for the rest, in order", async () => {
    const updatedById = await tunerId();
    await saveExtractionConfig({
      rubricKey: "fl",
      persona: "A diligence lawyer.",
      guidance: "Filings over assurances.",
      temperature: 0.2,
      updatedById,
    });

    const configs = await listExtractionConfigs();
    expect(configs.map((c) => c.rubricKey)).toEqual(RUBRIC_KEYS);

    const fl = configs.find((c) => c.rubricKey === "fl");
    expect(fl).toEqual({
      rubricKey: "fl",
      persona: "A diligence lawyer.",
      guidance: "Filings over assurances.",
      temperature: 0.2,
      version: 1,
    });
    for (const config of configs.filter((c) => c.rubricKey !== "fl")) {
      // Not zero: the synthesized "nothing saved" shape must name the real
      // default, or the admin page shows one number while the model reads with
      // another — which is exactly how greedy decoding shipped unnoticed.
      expect(config).toMatchObject({
        persona: "",
        guidance: "",
        temperature: DEFAULT_EXTRACTION_TEMPERATURE,
        version: null,
      });
    }
  });
});

describe("the observation's config-version stamp", () => {
  // The migration ran against a database already holding seeded observations
  // (globalSetup migrate-deploys before anything truncates), so these rows
  // predate the column — proof the addition is nullable and non-destructive.
  it("left every existing observation without one", async () => {
    const rows = await db.observation.findMany({ select: { configVersion: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.configVersion).toBeNull();
  });

  it("stays null on a new observation that does not carry one", async () => {
    await db.deal.create({
      data: {
        id: "u10-config-version-fixture",
        company: "Unstamped",
        oneLiner: "No config version yet.",
        founders: "Test Founder",
        ownerPm: "You",
        opened: new Date("2026-07-30"),
        layer: "L1",
        observations: {
          create: {
            callNumber: 1,
            rubricKey: "ft",
            subDimensionKey: "earned-insight",
            quote: "we lived this problem",
            status: "draft",
          },
        },
      },
    });
    try {
      const row = await db.observation.findFirstOrThrow({
        where: { dealId: "u10-config-version-fixture" },
      });
      expect(row.configVersion).toBeNull();
    } finally {
      await db.deal.delete({ where: { id: "u10-config-version-fixture" } });
    }
  });
});
