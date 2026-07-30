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
      : { rubricKey: key, persona: "", guidance: "", temperature: 0, version: null };
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
