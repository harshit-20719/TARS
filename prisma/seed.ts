/**
 * Seed the database from the fixture record in mock/data.ts.
 *
 * This is what makes a fresh local or preview database look exactly like the
 * mock-data build: the same three deals, the same observations with the same
 * ids, the same scores and slides. The fidelity matters because the seeded
 * record is what the repository round-trip test asserts against.
 *
 * Idempotent — every write is an upsert keyed the way the schema is, so running
 * it twice leaves one copy of everything.
 *
 * Ordering: rows are stamped with ascending createdAt values so that the
 * repository's `createdAt asc` ordering reproduces fixture order exactly.
 * Postgres would otherwise be free to return an unordered insert batch in any
 * sequence, and the review board's grouping would shuffle between deploys.
 */

import { hash } from "bcryptjs";
import { FIXTURE_CALLS, getRecord, listDeals } from "../mock/data";
import { fromLens, fromOriginTag, parseRecordDate } from "../lib/domain/codec";
import { PrismaClient, Role, type ScoreType } from "@prisma/client";

const db = new PrismaClient();

/** Fixed epoch so reseeding produces identical timestamps, and thus identical order. */
const EPOCH = Date.UTC(2026, 6, 1, 9, 0, 0);
const at = (i: number) => new Date(EPOCH + i * 1000);

/**
 * Pilot users. Passwords exist only for the dev credentials provider, which is
 * off unless AUTH_DEV_CREDENTIALS is set — production signs in with Google SSO
 * and these rows simply carry the role.
 */
const USERS = [
  { email: "harshit.agarwal@biome.in", name: "Harshit Agarwal", role: Role.ADMIN },
  { email: "pm@biome.in", name: "Pilot PM", role: Role.PM },
  { email: "partner@biome.in", name: "Pilot Partner", role: Role.PARTNER },
];

async function seedUsers() {
  const passwordHash = await hash("tars-dev", 10);
  for (const u of USERS) {
    await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: { ...u, passwordHash },
    });
  }
  console.log(`  users              ${USERS.length}`);
}

async function seedRecord() {
  let counts = { deals: 0, calls: 0, obs: 0, claims: 0, scores: 0, slides: 0, reads: 0 };

  for (const deal of listDeals()) {
    const record = getRecord(deal.id);
    if (!record) continue;

    // The fixtures carry ownerPm as the display string "You" and have no user
    // relation. Deals created through the app set ownerId instead, and the
    // repository prefers that when present.
    await db.deal.upsert({
      where: { id: deal.id },
      update: {
        company: deal.company,
        oneLiner: deal.oneLiner,
        founders: deal.founders,
        ownerPm: deal.ownerPm,
        opened: parseRecordDate(deal.opened),
        layer: deal.layer,
      },
      create: {
        id: deal.id,
        company: deal.company,
        oneLiner: deal.oneLiner,
        founders: deal.founders,
        ownerPm: deal.ownerPm,
        opened: parseRecordDate(deal.opened),
        layer: deal.layer,
      },
    });
    counts.deals++;

    // From the fixture calls, not record.calls — the record carries metadata only.
    for (const [i, c] of (FIXTURE_CALLS[deal.id] ?? []).entries()) {
      await db.call.upsert({
        where: { dealId_number: { dealId: c.dealId, number: c.number } },
        update: { label: c.label, date: parseRecordDate(c.date), transcript: c.transcript, extracted: c.extracted },
        create: {
          id: c.id,
          dealId: c.dealId,
          number: c.number,
          label: c.label,
          date: parseRecordDate(c.date),
          transcript: c.transcript,
          extracted: c.extracted,
          createdAt: at(i),
        },
      });
      counts.calls++;
    }

    // Observation ids are preserved verbatim: claims anchor to them and scores
    // cite them by id, so regenerating ids here would break those links.
    for (const [i, o] of record.observations.entries()) {
      const fields = {
        dealId: o.dealId,
        callNumber: o.callNumber,
        rubricKey: o.rubricKey,
        subDimensionKey: o.subDimensionKey,
        quote: o.quote,
        speaker: o.speaker ?? null,
        timestamp: o.timestamp ?? null,
        status: o.status,
        layer: o.layer,
      };
      await db.observation.upsert({
        where: { id: o.id },
        update: fields,
        create: { id: o.id, ...fields, createdAt: at(i) },
      });
      counts.obs++;
    }

    for (const [i, c] of record.claims.entries()) {
      const fields = {
        dealId: c.dealId,
        text: c.text,
        originTag: fromOriginTag(c.originTag),
        status: c.status,
        anchorObsId: c.anchorObsId,
      };
      await db.claim.upsert({
        where: { id: c.id },
        update: fields,
        create: { id: c.id, ...fields, createdAt: at(i) },
      });
      counts.claims++;
    }

    for (const [i, s] of record.scores.entries()) {
      const key = {
        dealId_subDimensionKey_layer: {
          dealId: s.dealId,
          subDimensionKey: s.subDimensionKey,
          layer: s.layer,
        },
      };
      const fields = {
        scoreType: s.scoreType as ScoreType,
        // Stored as text next to its scoreType; the CHECK constraint in the
        // migration and lib/domain/codec.ts both police the pair.
        value: String(s.value),
        flag: s.flag ?? false,
      };
      const score = await db.subDimensionScore.upsert({
        where: key,
        update: fields,
        create: {
          dealId: s.dealId,
          subDimensionKey: s.subDimensionKey,
          layer: s.layer,
          ...fields,
          createdAt: at(i),
        },
      });

      // Evidence is replaced wholesale rather than diffed — the citation set is
      // small and "these are the quotes" is the operation being expressed.
      await db.scoreEvidence.deleteMany({ where: { scoreId: score.id } });
      if (s.evidenceObsIds.length) {
        await db.scoreEvidence.createMany({
          data: s.evidenceObsIds.map((observationId) => ({ scoreId: score.id, observationId })),
          skipDuplicates: true,
        });
      }
      counts.scores++;
    }

    for (const [i, sl] of record.slides.entries()) {
      const fields = {
        value: sl.value,
        provisionalValue: sl.provisionalValue ?? null,
        lens: fromLens(sl.lens),
        ceilingGuard: sl.ceilingGuard,
      };
      await db.slide.upsert({
        where: {
          dealId_slideKey_layer: { dealId: sl.dealId, slideKey: sl.slideKey, layer: sl.layer },
        },
        update: fields,
        create: {
          dealId: sl.dealId,
          slideKey: sl.slideKey,
          layer: sl.layer,
          ...fields,
          createdAt: at(i),
        },
      });
      counts.slides++;
    }

    // The fixtures give an all-empty read for a deal that has not been read yet.
    // Storing that would be indistinguishable from a real blank read, so skip it
    // and let the repository synthesize the empty shape instead.
    const ft = record.founderTypeRead;
    if (ft.primary.trim()) {
      const fields = {
        primary: ft.primary,
        secondary: ft.secondary ?? null,
        profile: ft.profile,
        floorDimension: ft.floorDimension,
        pmConfirmation: ft.pmConfirmation,
      };
      await db.founderTypeRead.upsert({
        where: { dealId: ft.dealId },
        update: fields,
        create: { dealId: ft.dealId, ...fields },
      });
      counts.reads++;
    }
  }

  console.log(`  deals              ${counts.deals}`);
  console.log(`  calls              ${counts.calls}`);
  console.log(`  observations       ${counts.obs}`);
  console.log(`  claims             ${counts.claims}`);
  console.log(`  scores             ${counts.scores}`);
  console.log(`  slides             ${counts.slides}`);
  console.log(`  founder reads      ${counts.reads}`);
}

async function main() {
  console.log("Seeding TARS L1 record…");
  await seedUsers();
  await seedRecord();
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
