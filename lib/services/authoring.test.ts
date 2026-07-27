import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { L1_CAP, PILLARS, TRACKS, subByKey } from "@/framework";
import { db } from "@/lib/db";
import { NotAuthorized, type Actor } from "@/lib/authz";
import { getRecord } from "@/lib/repo/records";
import { addCall, createDeal, decideObservation, deleteCall, deleteDeal, setScore, clearScore } from "./capture";
import { setFounderTypeRead, setSlide } from "./judgment";

/**
 * The authoring controls' side of the contract.
 *
 * The tests in capture.test.ts and judgment.test.ts cover the services' rules.
 * These cover the shapes the forms in components/authoring actually send — the
 * seam where a UI change breaks a save without any type error, because the
 * services take `unknown` and validate at runtime. Every payload below is copied
 * from the component that produces it.
 */

let pm: Actor;
let admin: Actor;
let partner: Actor;
const createdDealIds: string[] = [];

beforeAll(async () => {
  const [p, a, pa] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "pm@biome.in" } }),
    db.user.findUniqueOrThrow({ where: { email: "harshit.agarwal@biome.in" } }),
    db.user.findUniqueOrThrow({ where: { email: "partner@biome.in" } }),
  ]);
  pm = { id: p.id, email: p.email, name: p.name, role: Role.PM };
  admin = { id: a.id, email: a.email, name: a.name, role: Role.ADMIN };
  partner = { id: pa.id, email: pa.email, name: pa.name, role: Role.PARTNER };
});

afterAll(async () => {
  if (createdDealIds.length) {
    await db.deal.deleteMany({ where: { id: { in: createdDealIds } } });
  }
});

async function newDeal(company: string): Promise<string> {
  const id = await createDeal(pm, {
    company,
    oneLiner: "Authoring fixture.",
    founders: "Test Founder",
  });
  createdDealIds.push(id);
  return id;
}

describe("AddCallForm payloads", () => {
  it("accepts the call number as the string an input element produces", async () => {
    const dealId = await newDeal("Add Call String");
    // The form keeps `number` as text so the field can be cleared while typing.
    const callId = await addCall(pm, {
      dealId,
      number: "2",
      label: "Technical deep-dive",
      transcript: "[00:01] Founder: we shipped the replay engine.",
    });
    const row = await db.call.findUniqueOrThrow({ where: { id: callId } });
    expect(row.number).toBe(2);
  });

  it("refuses a blank call number rather than guessing one", async () => {
    const dealId = await newDeal("Add Call Blank");
    await expect(
      addCall(pm, { dealId, number: "", label: "Call", transcript: "text" }),
    ).rejects.toThrow();
  });
});

describe("ScoreControl payloads", () => {
  it("saves a value with evidence and the flag together", async () => {
    const dealId = await newDeal("Score Control");
    const callId = await addCall(pm, {
      dealId,
      number: 1,
      label: "First",
      transcript: "[00:01] Founder: four years inside bank ops.",
    });
    expect(callId).toBeTruthy();
    const obs = await db.observation.create({
      data: {
        dealId,
        callNumber: 1,
        rubricKey: "ft",
        subDimensionKey: "earned-insight",
        quote: "four years inside bank ops",
        status: "accepted",
      },
    });

    await setScore(pm, {
      dealId,
      subDimensionKey: "earned-insight",
      value: 4,
      evidenceObsIds: [obs.id],
      flag: false,
    });

    const rec = await getRecord(dealId);
    const score = rec!.scores.find((s) => s.subDimensionKey === "earned-insight");
    expect(score).toMatchObject({ value: 4, scoreType: "scale", evidenceObsIds: [obs.id] });
  });

  it("re-saves the same value when only the evidence changed", async () => {
    // What the control does when a checkbox is toggled on an already-scored row.
    const dealId = await newDeal("Score Amend");
    await setScore(pm, { dealId, subDimensionKey: "why-now", value: 3, evidenceObsIds: [] });
    await setScore(pm, { dealId, subDimensionKey: "why-now", value: 3, evidenceObsIds: [], flag: true });
    const rec = await getRecord(dealId);
    const score = rec!.scores.find((s) => s.subDimensionKey === "why-now");
    expect(score).toMatchObject({ value: 3, flag: true });
    expect(rec!.scores.filter((s) => s.subDimensionKey === "why-now")).toHaveLength(1);
  });

  it("clears on a second press of the value already set", async () => {
    const dealId = await newDeal("Score Clear");
    await setScore(pm, { dealId, subDimensionKey: "coachability", value: 5 });
    await clearScore(pm, dealId, "coachability");
    const rec = await getRecord(dealId);
    expect(rec!.scores.find((s) => s.subDimensionKey === "coachability")).toBeUndefined();
  });

  it("offers only values the row accepts, for every row in the rubric", () => {
    // The control builds its options from `sub.type`; if a row's type and its
    // anchor set ever disagreed, it would render a picker the server rejects.
    for (const key of ["ambition-fit", "cap-table-health", "ip-ownership", "structural-fit"]) {
      const sub = subByKey(key)!;
      const offered = sub.type === "binary" ? ["fail", "unv", "pass"] : [1, 2, 3, 4, 5, "NE"];
      expect(offered).toContain(sub.floor ? sub.floor.breachAt : offered[0]);
    }
  });
});

describe("SlideForm payloads", () => {
  it("treats a null provisional as cleared, not as zero", async () => {
    // z.coerce.number() would turn null into 0 if the nullable wrapper were
    // missing, which would silently record "provisional 0" for "no provisional".
    const dealId = await newDeal("Slide Null Provisional");
    await setSlide(pm, {
      dealId,
      slideKey: "earned-secret",
      value: 5,
      provisionalValue: 8,
      ceilingGuard: "Earned insight (5) sets the ceiling.",
    });
    await setSlide(pm, {
      dealId,
      slideKey: "earned-secret",
      value: 5,
      provisionalValue: null,
      ceilingGuard: "Earned insight (5) sets the ceiling.",
    });
    const rec = await getRecord(dealId);
    expect(rec!.slides.find((s) => s.slideKey === "earned-secret")?.provisionalValue).toBeUndefined();
  });

  it("banks at the cap and records the excess as a provisional", async () => {
    // The form's pickBanked() move when a PM presses a value above the cap.
    const dealId = await newDeal("Slide Over Cap");
    await setSlide(pm, {
      dealId,
      slideKey: "foundational-tech",
      value: L1_CAP,
      provisionalValue: 9,
      ceilingGuard: "Replay depth (5) sets it; banked at cap pending a technical verify.",
    });
    const rec = await getRecord(dealId);
    const slide = rec!.slides.find((s) => s.slideKey === "foundational-tech");
    expect(slide).toMatchObject({ value: L1_CAP, provisionalValue: 9 });
  });

  it("accepts every pillar and track key the form renders a card for", async () => {
    const dealId = await newDeal("Slide All Keys");
    for (const def of [...PILLARS, ...TRACKS]) {
      await setSlide(pm, {
        dealId,
        slideKey: def.key,
        value: 3,
        provisionalValue: null,
        ceilingGuard: `${def.name} read from the rooted rows.`,
      });
    }
    const rec = await getRecord(dealId);
    expect(rec!.slides).toHaveLength(PILLARS.length + TRACKS.length);
    // The lens is the framework's, never the form's.
    for (const s of rec!.slides) {
      const def = [...PILLARS, ...TRACKS].find((d) => d.key === s.slideKey)!;
      expect(s.lens, s.slideKey).toBe(def.lens);
    }
  });
});

describe("FounderTypeForm payloads", () => {
  it("accepts a null secondary from the '— none —' option", async () => {
    const dealId = await newDeal("Founder Read Null");
    await setFounderTypeRead(pm, {
      dealId,
      primary: "Technical",
      secondary: null,
      profile: "Brings the earned secret and the foundational tech.",
      floorDimension: "earned-insight",
      pmConfirmation: "Draft — solo technical founder.",
    });
    const rec = await getRecord(dealId);
    expect(rec!.founderTypeRead).toMatchObject({
      primary: "Technical",
      floorDimension: "earned-insight",
    });
    expect(rec!.founderTypeRead.secondary).toBeUndefined();
  });

  it("accepts any rubric row as the floor dimension the select offers", async () => {
    const dealId = await newDeal("Founder Read Floor");
    await setFounderTypeRead(pm, {
      dealId,
      primary: "Serial entrepreneur",
      secondary: null,
      profile: "Brings execution and narrative.",
      floorDimension: "learning-rate",
      pmConfirmation: "Confirmed.",
    });
    const rec = await getRecord(dealId);
    expect(rec!.founderTypeRead.floorDimension).toBe("learning-rate");
    expect(subByKey("learning-rate")).toBeTruthy();
  });
});

describe("ReviewBoard payloads", () => {
  it("re-maps a draft to another row, carrying the rubric key with it", async () => {
    // The board looks the rubric up from the chosen sub-dimension so the two
    // cannot disagree; a mismatch would file the observation under a rubric it
    // does not belong to and hide it from that rubric's group.
    const dealId = await newDeal("Remap Test");
    const obs = await db.observation.create({
      data: {
        dealId,
        callNumber: 1,
        rubricKey: "ft",
        subDimensionKey: "earned-insight",
        quote: "the wedge is the settlement break",
        status: "draft",
      },
    });

    await decideObservation(pm, obs.id, {
      status: "edited",
      subDimensionKey: "wedge",
      rubricKey: "pt",
    });

    const row = await db.observation.findUniqueOrThrow({ where: { id: obs.id } });
    expect(row).toMatchObject({ status: "edited", subDimensionKey: "wedge", rubricKey: "pt" });
    expect(row.decidedById).toBe(pm.id);
  });

  it("accepts and rejects without touching the quote", async () => {
    const dealId = await newDeal("Decide Test");
    const quote = "we're both full-time";
    const obs = await db.observation.create({
      data: { dealId, callNumber: 1, rubricKey: "sf", subDimensionKey: "founder-commitment", quote, status: "draft" },
    });
    await decideObservation(pm, obs.id, { status: "accepted" });
    expect((await db.observation.findUniqueOrThrow({ where: { id: obs.id } })).quote).toBe(quote);
    await decideObservation(pm, obs.id, { status: "rejected" });
    const row = await db.observation.findUniqueOrThrow({ where: { id: obs.id } });
    expect(row).toMatchObject({ status: "rejected", quote });
  });
});

describe("deleting a deal", () => {
  /**
   * The delete cascades, so these assert the blast radius as much as the
   * permission: everything recorded against the deal has to go, and nothing
   * belonging to another deal may.
   */
  async function populated(company: string) {
    const dealId = await newDeal(company);
    await addCall(pm, { dealId, number: 1, label: "First", transcript: "[00:01] F: we shipped it." });
    const obs = await db.observation.create({
      data: { dealId, callNumber: 1, rubricKey: "ft", subDimensionKey: "earned-insight", quote: "we shipped it", status: "accepted" },
    });
    await setScore(pm, { dealId, subDimensionKey: "earned-insight", value: 4, evidenceObsIds: [obs.id] });
    await setSlide(pm, { dealId, slideKey: "earned-secret", value: 5, ceilingGuard: "Earned insight (4) sets it." });
    await setFounderTypeRead(pm, {
      dealId, primary: "Technical", secondary: null,
      profile: "p", floorDimension: "earned-insight", pmConfirmation: "Confirmed.",
    });
    return dealId;
  }

  it("takes calls, observations, scores, slides, and the founder read with it", async () => {
    const dealId = await populated("Cascade Test");
    const survivor = await populated("Cascade Bystander");

    await deleteDeal(pm, dealId);

    expect(await getRecord(dealId)).toBeUndefined();
    for (const [table, count] of [
      ["call", () => db.call.count({ where: { dealId } })],
      ["observation", () => db.observation.count({ where: { dealId } })],
      ["score", () => db.subDimensionScore.count({ where: { dealId } })],
      ["slide", () => db.slide.count({ where: { dealId } })],
      ["founderTypeRead", () => db.founderTypeRead.count({ where: { dealId } })],
    ] as const) {
      expect(await count(), `${table} rows left behind`).toBe(0);
    }

    // The neighbouring deal is untouched.
    const other = await getRecord(survivor);
    expect(other?.scores).toHaveLength(1);
    expect(other?.slides).toHaveLength(1);
  });

  it("lets a PM delete a deal they opened", async () => {
    const dealId = await newDeal("Own Deal Test");
    await expect(deleteDeal(pm, dealId)).resolves.toBeUndefined();
  });

  it("refuses a PM deleting someone else's deal", async () => {
    // Owned by the other PM-capable actor, so the role is fine and only the
    // ownership check can reject it.
    const dealId = await createDeal(admin, {
      company: "Admin Owned Test", oneLiner: "x", founders: "y",
    });
    createdDealIds.push(dealId);
    await expect(deleteDeal(pm, dealId)).rejects.toThrow(NotAuthorized);
    expect(await getRecord(dealId)).toBeTruthy();
  });

  it("lets an ADMIN delete anyone's deal", async () => {
    const dealId = await newDeal("Admin Deletes Test");
    await expect(deleteDeal(admin, dealId)).resolves.toBeUndefined();
    expect(await getRecord(dealId)).toBeUndefined();
  });

  it("refuses a PARTNER outright", async () => {
    const dealId = await newDeal("Partner Delete Test");
    await expect(deleteDeal(partner, dealId)).rejects.toThrow(NotAuthorized);
  });

  it("reserves an unowned deal — the seeded fixtures — for an ADMIN", async () => {
    // The fixtures carry a display name rather than an owner relation, so nobody
    // can claim them.
    const dealId = await newDeal("Unowned Test");
    await db.deal.update({ where: { id: dealId }, data: { ownerId: null } });
    await expect(deleteDeal(pm, dealId)).rejects.toThrow(/no owner/);
    await expect(deleteDeal(admin, dealId)).resolves.toBeUndefined();
  });

  it("reports a deal that is not there rather than succeeding quietly", async () => {
    await expect(deleteDeal(admin, "no-such-deal")).rejects.toThrow(/no such deal/);
  });
});

describe("removing a call", () => {
  it("keeps the observations drafted from it", async () => {
    // They are keyed by call number, so an accepted quote is not lost when the
    // transcript is re-pasted.
    const dealId = await newDeal("Call Removal Test");
    const callId = await addCall(pm, {
      dealId, number: 1, label: "First", transcript: "[00:01] F: four years inside.",
    });
    await db.observation.create({
      data: { dealId, callNumber: 1, rubricKey: "ft", subDimensionKey: "earned-insight", quote: "four years inside", status: "accepted" },
    });

    await deleteCall(pm, callId);

    const rec = await getRecord(dealId);
    expect(rec!.calls).toHaveLength(0);
    expect(rec!.observations).toHaveLength(1);
  });

  it("frees the call number for a re-paste", async () => {
    const dealId = await newDeal("Call Repaste Test");
    const callId = await addCall(pm, { dealId, number: 1, label: "First", transcript: "wrong text" });
    await expect(
      addCall(pm, { dealId, number: 1, label: "First", transcript: "right text" }),
    ).rejects.toThrow(/already exists/);
    await deleteCall(pm, callId);
    await expect(
      addCall(pm, { dealId, number: 1, label: "First", transcript: "right text" }),
    ).resolves.toBeTruthy();
  });
});
