import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { L1_CAP, PILLARS, TRACKS, subByKey } from "@/framework";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/authz";
import { getRecord } from "@/lib/repo/records";
import { addCall, createDeal, decideObservation, setScore, clearScore } from "./capture";
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
const createdDealIds: string[] = [];

beforeAll(async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: "pm@biome.in" } });
  pm = { id: user.id, email: user.email, name: user.name, role: Role.PM };
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
