import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { L1_CAP } from "@/framework";
import { db } from "@/lib/db";
import { NotAuthorized, type Actor } from "@/lib/authz";
import { RuleViolation } from "@/lib/domain/rules";
import { createDeal } from "./capture";
import { clearSlide, setFounderTypeRead, setSlide } from "./judgment";

let pm: Actor;
let partner: Actor;
const createdDealIds: string[] = [];

beforeAll(async () => {
  const [pmUser, partnerUser] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "pm@biome.in" } }),
    db.user.findUniqueOrThrow({ where: { email: "partner@biome.in" } }),
  ]);
  pm = { id: pmUser.id, email: pmUser.email, name: pmUser.name, role: Role.PM };
  partner = { id: partnerUser.id, email: partnerUser.email, name: partnerUser.name, role: Role.PARTNER };
});

afterAll(async () => {
  if (createdDealIds.length) {
    await db.deal.deleteMany({ where: { id: { in: createdDealIds } } });
  }
});

async function newDeal(company: string): Promise<string> {
  const id = await createDeal(pm, {
    company,
    oneLiner: "Judgment fixture.",
    founders: "Test Founder",
  });
  createdDealIds.push(id);
  return id;
}

const guard = "Earned insight at 4 sets the ceiling; the settlement claim is unverified.";

describe("slides", () => {
  it("stores a banked read with its ceiling guard and author", async () => {
    const dealId = await newDeal("Slide Test");
    await setSlide(pm, { dealId, slideKey: "earned-secret", value: 5, ceilingGuard: guard });

    const row = await db.slide.findFirstOrThrow({ where: { dealId, slideKey: "earned-secret" } });
    expect(row.value).toBe(5);
    expect(row.provisionalValue).toBeNull();
    expect(row.ceilingGuard).toBe(guard);
    expect(row.authorId).toBe(pm.id);
    expect(row.layer).toBe("L1");
  });

  /**
   * The guard is prefilled from the lowest rooted row now, so the record has to
   * keep whether a human actually signed off on that line. Unconfirmed it is a
   * mechanical note; confirmed it is the PM's stated reason, and the anti-vibe rule
   * only means something if the difference survives.
   */
  it("records whether the ceiling guard was confirmed by a human", async () => {
    const dealId = await newDeal("Guard Confirm Test");

    await setSlide(pm, { dealId, slideKey: "earned-secret", value: 5, ceilingGuard: guard });
    let row = await db.slide.findFirstOrThrow({ where: { dealId, slideKey: "earned-secret" } });
    expect(row.guardConfirmed).toBe(false);

    await setSlide(pm, {
      dealId,
      slideKey: "earned-secret",
      value: 5,
      ceilingGuard: guard,
      guardConfirmed: true,
    });
    row = await db.slide.findFirstOrThrow({ where: { dealId, slideKey: "earned-secret" } });
    expect(row.guardConfirmed).toBe(true);
  });

  it("takes the lens from the framework, not from the caller", async () => {
    const dealId = await newDeal("Lens Test");
    // gtm-engine reads weakest-link. Even if a caller claimed otherwise, the
    // stored lens is the framework's — the number's meaning is not negotiable.
    await setSlide(pm, {
      dealId,
      slideKey: "gtm-engine",
      value: 3,
      ceilingGuard: guard,
      lens: "peak",
    } as never);

    const row = await db.slide.findFirstOrThrow({ where: { dealId, slideKey: "gtm-engine" } });
    expect(row.lens).toBe("weakestLink");
  });

  it("refuses to bank above the L1 cap", async () => {
    const dealId = await newDeal("Cap Test");
    await expect(
      setSlide(pm, { dealId, slideKey: "earned-secret", value: L1_CAP + 1, ceilingGuard: guard }),
    ).rejects.toThrow(/provisional/);
    expect(await db.slide.count({ where: { dealId } })).toBe(0);
  });

  it("accepts a provisional above the cap alongside a banked value", async () => {
    const dealId = await newDeal("Provisional Test");
    await setSlide(pm, {
      dealId,
      slideKey: "earned-secret",
      value: 5,
      provisionalValue: 9,
      ceilingGuard: guard,
    });
    const row = await db.slide.findFirstOrThrow({ where: { dealId } });
    expect(row.value).toBe(5);
    expect(row.provisionalValue).toBe(9);
  });

  it("refuses a provisional below the banked value", async () => {
    const dealId = await newDeal("Prov Below Test");
    await expect(
      setSlide(pm, {
        dealId,
        slideKey: "earned-secret",
        value: 5,
        provisionalValue: 2,
        ceilingGuard: guard,
      }),
    ).rejects.toThrow(/below the banked/);
  });

  it("requires a ceiling guard", async () => {
    const dealId = await newDeal("Guard Test");
    await expect(
      setSlide(pm, { dealId, slideKey: "earned-secret", value: 4, ceilingGuard: "   " }),
    ).rejects.toThrow();
  });

  it("requires the ceiling guard to be one line", async () => {
    const dealId = await newDeal("Multiline Guard Test");
    await expect(
      setSlide(pm, {
        dealId,
        slideKey: "earned-secret",
        value: 4,
        ceilingGuard: "line one\nline two",
      }),
    ).rejects.toThrow(/single line/);
  });

  it("refuses an unknown slide key", async () => {
    const dealId = await newDeal("Bad Key Test");
    await expect(
      setSlide(pm, { dealId, slideKey: "vibes", value: 4, ceilingGuard: guard }),
    ).rejects.toThrow(RuleViolation);
  });

  it("re-authoring replaces rather than duplicating", async () => {
    const dealId = await newDeal("Reslide Test");
    await setSlide(pm, { dealId, slideKey: "bmi", value: 2, ceilingGuard: guard });
    await setSlide(pm, { dealId, slideKey: "bmi", value: 6, ceilingGuard: guard });

    const rows = await db.slide.findMany({ where: { dealId, slideKey: "bmi" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(6);
  });

  it("clears a slide", async () => {
    const dealId = await newDeal("Clear Slide Test");
    await setSlide(pm, { dealId, slideKey: "bmi", value: 4, ceilingGuard: guard });
    await clearSlide(pm, dealId, "bmi");
    expect(await db.slide.count({ where: { dealId } })).toBe(0);
  });

  it("refuses a PARTNER authoring a slide", async () => {
    const dealId = await newDeal("Partner Slide Test");
    await expect(
      setSlide(partner, { dealId, slideKey: "bmi", value: 4, ceilingGuard: guard }),
    ).rejects.toThrow(NotAuthorized);
  });

  // The framework's central prohibition: a slide is a human read, never derived.
  it("never computes a slide from the scores that root to it", async () => {
    const dealId = await newDeal("No Derive Test");
    // No slide exists until a person authors one, however many scores are set.
    expect(await db.slide.count({ where: { dealId } })).toBe(0);
  });
});

describe("the founder-type read", () => {
  it("stores the read with the PM's own confirmation line", async () => {
    const dealId = await newDeal("Founder Read Test");
    await setFounderTypeRead(pm, {
      dealId,
      primary: "Technical",
      secondary: "Corporate",
      profile: "Expect foundational tech; distribution is the risk.",
      floorDimension: "Privileged distribution",
      pmConfirmation: "Agreed — technical primary, distribution unproven.",
    });

    const row = await db.founderTypeRead.findUniqueOrThrow({ where: { dealId } });
    expect(row.primary).toBe("Technical");
    expect(row.secondary).toBe("Corporate");
    expect(row.pmConfirmation).toContain("technical primary");
    expect(row.authorId).toBe(pm.id);
  });

  it("requires the PM to confirm in their own words", async () => {
    const dealId = await newDeal("No Confirm Test");
    await expect(
      setFounderTypeRead(pm, { dealId, primary: "Technical", pmConfirmation: "" }),
    ).rejects.toThrow();
  });

  it("re-reading updates in place", async () => {
    const dealId = await newDeal("Reread Test");
    const base = { dealId, primary: "Technical", pmConfirmation: "First read." };
    await setFounderTypeRead(pm, base);
    await setFounderTypeRead(pm, { ...base, primary: "Serial", pmConfirmation: "Revised." });

    const rows = await db.founderTypeRead.findMany({ where: { dealId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].primary).toBe("Serial");
  });

  it("refuses a PARTNER authoring the read", async () => {
    const dealId = await newDeal("Partner Read Test");
    await expect(
      setFounderTypeRead(partner, { dealId, primary: "Technical", pmConfirmation: "x" }),
    ).rejects.toThrow(NotAuthorized);
  });
});
