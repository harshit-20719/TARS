/**
 * The per-rubric extraction tuning — the only module that touches Prisma for it.
 *
 * Reads go through absent rows (KTD15). The production build runs migrations
 * and never the seed, so a fresh deploy has no config rows at all; rather than
 * make every consumer handle a hole, the read synthesizes the default shape —
 * persona "", guidance "", temperature 0 — the same choice the repository
 * already makes for an absent founder-type read. An admin's first save creates
 * the row.
 *
 * An absent row has no version: `version` is null there, not 0, because a
 * version names a saved text and nobody has saved one — so a run under
 * defaults stamps nothing on what it drafts (Observation.configVersion stays
 * null), and a stamped row is always traceable to real words.
 */

import { RUBRICS } from "@/framework/rubrics";
import { db } from "@/lib/db";
import { DEFAULT_EXTRACTION_TEMPERATURE } from "@/lib/extraction/types";

/** One rubric's tuning as the rest of the app sees it — a plain record, no Prisma. */
export interface RubricExtractionConfig {
  rubricKey: string;
  persona: string;
  guidance: string;
  temperature: number;
  /** Which saved text this is. Null when nobody has saved one. */
  version: number | null;
}

/**
 * Every rubric's tuning, one entry per rubric, in the framework's canonical
 * order — stored rows where they exist, the default shape where they do not.
 * Always six entries, so the admin page can render a section per rubric without
 * asking which rows happen to exist yet.
 */
export async function listExtractionConfigs(): Promise<RubricExtractionConfig[]> {
  const rows = await db.rubricExtractionConfig.findMany();
  const byKey = new Map(rows.map((row) => [row.rubricKey, row]));

  return RUBRICS.map(({ key }) => {
    const row = byKey.get(key);
    return row
      ? {
          rubricKey: key,
          persona: row.persona,
          guidance: row.guidance,
          temperature: row.temperature,
          version: row.version,
        }
      : {
          rubricKey: key,
          persona: "",
          guidance: "",
          /**
           * The real default, not zero. Zero is greedy decoding, and this
           * synthesized shape is what supplied it to every untuned run — the
           * adapter's own default could never fire, because a value was always
           * present. The page and the model must agree on what "untuned" means.
           */
          temperature: DEFAULT_EXTRACTION_TEMPERATURE,
          version: null,
        };
  });
}

/** What a save carries. Validation is the service's job; this module stores. */
export interface SaveExtractionConfig {
  rubricKey: string;
  persona: string;
  guidance: string;
  temperature: number;
  updatedById: string;
}

/**
 * Create or replace one rubric's tuning, bumping the version.
 *
 * The first save creates the row at version 1 (the column's default); every
 * save after that increments it, and the increment happens in the database
 * rather than as read-add-write, so two admins saving at once cannot mint the
 * same version number. Monotonic, never reused — that is what lets an
 * observation's configVersion stamp name exactly one text (U12).
 */
export async function saveExtractionConfig(input: SaveExtractionConfig): Promise<void> {
  const { rubricKey, persona, guidance, temperature, updatedById } = input;
  await db.rubricExtractionConfig.upsert({
    where: { rubricKey },
    create: { rubricKey, persona, guidance, temperature, updatedById },
    update: { persona, guidance, temperature, updatedById, version: { increment: 1 } },
  });
}

/** What the last run of one rubric dropped, and which text it ran under. */
export interface RubricDropCount {
  rubricKey: string;
  droppedQuotes: number;
  /**
   * Whether that run actually read the block. Carried because the count alone
   * cannot say: a failed block's row takes the column default of 0, so without
   * this a run that read nothing reports "dropped 0 quotes" — which reads as a
   * clean pass on the admin page and invites raising temperature on the
   * strength of a reading that never happened.
   */
  read: boolean;
  /** The tuning version that run carried. Null when it ran under defaults. */
  configVersion: number | null;
  ranAt: Date;
}

/**
 * The most recent run of each rubric, across every call.
 *
 * This is the feedback number beside the temperature control (R20). It is
 * reported per rubric because that is the grain an admin tunes at, and it
 * carries the version it ran under because without that the number is not
 * comparable to the text on the page — a drop count from before the last save
 * says nothing about the words now in the box.
 *
 * One indexed read of the whole table, reduced in memory rather than six
 * grouped queries: the table holds six rows per extracted call, so even a busy
 * pilot deal set is small, and a per-rubric `findFirst` loop would be six round
 * trips for the same answer.
 */
export async function latestDropCountsByRubric(): Promise<RubricDropCount[]> {
  const rows = await db.extractionBlockRun.findMany({
    orderBy: { ranAt: "desc" },
    select: {
      rubricKey: true,
      droppedQuotes: true,
      outcome: true,
      configVersion: true,
      ranAt: true,
    },
  });

  const latest = new Map<string, RubricDropCount>();
  for (const row of rows) {
    // Descending by time, so the first row seen for a rubric is its latest run.
    if (!latest.has(row.rubricKey)) {
      const { outcome, ...rest } = row;
      latest.set(row.rubricKey, { ...rest, read: outcome === "READ" });
    }
  }
  return RUBRICS.map(({ key }) => latest.get(key)).filter((r): r is RubricDropCount => Boolean(r));
}
