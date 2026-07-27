import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { NotAuthorized, type Actor } from "@/lib/authz";
import { RuleViolation } from "@/lib/domain/rules";
import type { ExtractionClient } from "@/lib/extraction/extract";
import type { ExtractionOutput } from "@/lib/extraction/schema";
import {
  addCall,
  clearScore,
  createDeal,
  decideObservation,
  runExtractionForCall,
  setScore,
} from "./capture";

const TRANSCRIPT = `[00:02] Rhea: We ran settlement operations at two clearing banks for six years.
[00:06] Rhea: Our matcher runs continuously instead of as a nightly batch job.
[00:11] Rhea: The head of operations at one of those banks has agreed to a paid pilot.`;

let pm: Actor;
let partner: Actor;
const createdDealIds: string[] = [];

beforeAll(async () => {
  const [pmUser, partnerUser] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "pm@biome.in" } }),
    db.user.findUniqueOrThrow({ where: { email: "partner@biome.in" } }),
  ]);
  pm = { id: pmUser.id, email: pmUser.email, name: pmUser.name, role: Role.PM };
  partner = {
    id: partnerUser.id,
    email: partnerUser.email,
    name: partnerUser.name,
    role: Role.PARTNER,
  };
});

// Tests create their own deals and remove them, so the seeded fixtures the
// repository test asserts against stay untouched.
afterAll(async () => {
  if (createdDealIds.length) {
    await db.deal.deleteMany({ where: { id: { in: createdDealIds } } });
  }
});

async function newDeal(company: string): Promise<string> {
  const id = await createDeal(pm, {
    company,
    oneLiner: "Continuous settlement reconciliation.",
    founders: "Rhea Menon",
  });
  createdDealIds.push(id);
  return id;
}

function stubClient(output: ExtractionOutput): ExtractionClient {
  return {
    messages: {
      parse: async () => ({ parsed_output: output, stop_reason: "end_turn" }),
    },
  };
}

describe("authorship is enforced on the server", () => {
  it("lets a PM create a deal", async () => {
    const id = await newDeal("Ledgerline Test");
    expect(id).toBe("ledgerline-test");
  });

  it("attributes the deal to its creator", async () => {
    const id = await newDeal("Attribution Test");
    const row = await db.deal.findUniqueOrThrow({ where: { id } });
    expect(row.ownerId).toBe(pm.id);
  });

  it("refuses a PARTNER creating a deal", async () => {
    await expect(
      createDeal(partner, { company: "X", oneLiner: "y", founders: "z" }),
    ).rejects.toThrow(NotAuthorized);
  });

  it("refuses a PARTNER scoring", async () => {
    const dealId = await newDeal("Partner Score Test");
    await expect(
      setScore(partner, { dealId, subDimensionKey: "earned-insight", value: 4 }),
    ).rejects.toThrow(NotAuthorized);
  });

  it("derives a distinct id when company names collide", async () => {
    const a = await newDeal("Collide Co");
    const b = await newDeal("Collide Co");
    expect(a).toBe("collide-co");
    expect(b).toBe("collide-co-2");
  });

  it("validates the input it is given", async () => {
    await expect(createDeal(pm, { company: "  ", oneLiner: "y", founders: "z" })).rejects.toThrow();
  });
});

describe("calls", () => {
  it("stores a transcript against a call number", async () => {
    const dealId = await newDeal("Call Test");
    const callId = await addCall(pm, {
      dealId,
      number: 1,
      label: "First founder call",
      transcript: TRANSCRIPT,
    });
    const row = await db.call.findUniqueOrThrow({ where: { id: callId } });
    expect(row.number).toBe(1);
    expect(row.extracted).toBe(false);
  });

  it("rejects a transcript with no call number", async () => {
    const dealId = await newDeal("No Number Test");
    await expect(
      addCall(pm, { dealId, label: "x", transcript: TRANSCRIPT }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate call number on the same deal", async () => {
    const dealId = await newDeal("Dup Call Test");
    const base = { dealId, number: 1, label: "First", transcript: TRANSCRIPT };
    await addCall(pm, base);
    await expect(addCall(pm, base)).rejects.toThrow(RuleViolation);
  });
});

describe("extraction persistence", () => {
  const verbatim = {
    quote: "Our matcher runs continuously instead of as a nightly batch job.",
    rubricKey: "pt",
    subDimensionKey: "defensibility",
    speaker: "Rhea",
    timestamp: "00:06",
  };
  const paraphrased = {
    quote: "Their matcher runs all the time rather than nightly.",
    rubricKey: "pt",
    subDimensionKey: "defensibility",
    speaker: "Rhea",
    timestamp: "00:06",
  };

  async function seedCall(company: string) {
    const dealId = await newDeal(company);
    const callId = await addCall(pm, {
      dealId,
      number: 1,
      label: "First founder call",
      transcript: TRANSCRIPT,
    });
    return { dealId, callId };
  }

  it("writes drafted observations and claimed claims", async () => {
    const { dealId, callId } = await seedCall("Extract Test");
    const summary = await runExtractionForCall(pm, callId, {
      client: stubClient({
        observations: [verbatim],
        claims: [
          {
            text: "The matcher reconciles continuously rather than in a nightly batch.",
            anchorQuote: verbatim.quote,
            originTag: "founder-volunteered",
          },
        ],
      }),
    });

    expect(summary.observationsWritten).toBe(1);
    expect(summary.claimsWritten).toBe(1);

    const obs = await db.observation.findMany({ where: { dealId } });
    expect(obs).toHaveLength(1);
    expect(obs[0].status).toBe("draft");
    expect(obs[0].layer).toBe("L1");

    const claims = await db.claim.findMany({ where: { dealId } });
    expect(claims[0].status).toBe("claimed");
    expect(claims[0].originTag).toBe("founderVolunteered");
    expect(claims[0].anchorObsId).toBe(obs[0].id);
  });

  // The authorship rule (spec R5): the machine drafts, it never scores. If this
  // ever fails, the framework has been broken, not just the code.
  it("writes no scores at all", async () => {
    const { dealId, callId } = await seedCall("No Score Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({
        observations: [verbatim],
        claims: [
          { text: "Continuous matching.", anchorQuote: verbatim.quote, originTag: "machine-inferred" },
        ],
      }),
    });
    expect(await db.subDimensionScore.count({ where: { dealId } })).toBe(0);
    expect(await db.slide.count({ where: { dealId } })).toBe(0);
  });

  it("drops a paraphrased quote rather than persisting it", async () => {
    const { dealId, callId } = await seedCall("Paraphrase Test");
    const summary = await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim, paraphrased], claims: [] }),
    });
    expect(summary.droppedQuotes).toEqual([paraphrased.quote]);
    expect(await db.observation.count({ where: { dealId } })).toBe(1);
  });

  it("marks the call extracted and refuses a silent re-run", async () => {
    const { callId } = await seedCall("Rerun Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });
    expect((await db.call.findUniqueOrThrow({ where: { id: callId } })).extracted).toBe(true);

    await expect(
      runExtractionForCall(pm, callId, { client: stubClient({ observations: [], claims: [] }) }),
    ).rejects.toThrow(/already been extracted/);
  });

  it("a forced re-run replaces drafts but keeps what the PM ruled on", async () => {
    const { dealId, callId } = await seedCall("Force Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });

    const kept = await db.observation.findFirstOrThrow({ where: { dealId } });
    await decideObservation(pm, kept.id, { status: "accepted" });

    await runExtractionForCall(pm, callId, {
      force: true,
      client: stubClient({
        observations: [
          {
            quote: "We ran settlement operations at two clearing banks for six years.",
            rubricKey: "ft",
            subDimensionKey: "earned-insight",
            speaker: "Rhea",
            timestamp: "00:02",
          },
        ],
        claims: [],
      }),
    });

    const after = await db.observation.findMany({ where: { dealId }, orderBy: { createdAt: "asc" } });
    expect(after).toHaveLength(2);
    expect(after.map((o) => o.status).sort()).toEqual(["accepted", "draft"]);
  });

  it("refuses a PARTNER running extraction", async () => {
    const { callId } = await seedCall("Partner Extract Test");
    await expect(
      runExtractionForCall(partner, callId, { client: stubClient({ observations: [], claims: [] }) }),
    ).rejects.toThrow(NotAuthorized);
  });
});

describe("observation review", () => {
  it("records who decided and when, and can re-map the sub-dimension", async () => {
    const dealId = await newDeal("Review Test");
    const obs = await db.observation.create({
      data: {
        dealId,
        callNumber: 1,
        rubricKey: "ft",
        subDimensionKey: "earned-insight",
        quote: "q",
        status: "draft",
      },
    });

    await decideObservation(pm, obs.id, {
      status: "edited",
      subDimensionKey: "execution",
      rubricKey: "ft",
    });

    const after = await db.observation.findUniqueOrThrow({ where: { id: obs.id } });
    expect(after.status).toBe("edited");
    expect(after.subDimensionKey).toBe("execution");
    expect(after.decidedById).toBe(pm.id);
    expect(after.decidedAt).toBeInstanceOf(Date);
  });

  it("refuses a re-map to a sub-dimension that does not exist", async () => {
    const dealId = await newDeal("Bad Remap Test");
    const obs = await db.observation.create({
      data: { dealId, callNumber: 1, rubricKey: "ft", subDimensionKey: "earned-insight", quote: "q" },
    });
    await expect(
      decideObservation(pm, obs.id, { status: "edited", subDimensionKey: "nonsense" }),
    ).rejects.toThrow(RuleViolation);
  });
});

describe("scores", () => {
  it("stores a scale score with its evidence", async () => {
    const dealId = await newDeal("Score Test");
    const obs = await db.observation.create({
      data: { dealId, callNumber: 1, rubricKey: "ft", subDimensionKey: "earned-insight", quote: "q" },
    });

    await setScore(pm, {
      dealId,
      subDimensionKey: "earned-insight",
      value: 4,
      evidenceObsIds: [obs.id],
    });

    const row = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId, subDimensionKey: "earned-insight" },
      include: { evidence: true },
    });
    expect(row.scoreType).toBe("scale");
    expect(row.value).toBe("4");
    expect(row.authorId).toBe(pm.id);
    expect(row.evidence.map((e) => e.observationId)).toEqual([obs.id]);
  });

  it("allows a score with no evidence, flagged incomplete downstream", async () => {
    const dealId = await newDeal("Incomplete Test");
    await setScore(pm, { dealId, subDimensionKey: "earned-insight", value: 3 });
    const row = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId },
      include: { evidence: true },
    });
    expect(row.evidence).toEqual([]);
  });

  it("takes the score type from the rubric, not the caller", async () => {
    const dealId = await newDeal("Type Test");
    await setScore(pm, { dealId, subDimensionKey: "ip-boundary", value: "unv", flag: true });
    const row = await db.subDimensionScore.findFirstOrThrow({ where: { dealId } });
    expect(row.scoreType).toBe("binary");
    expect(row.flag).toBe(true);
  });

  it("refuses a 1–5 value on a binary row", async () => {
    const dealId = await newDeal("Mismatch Test");
    await expect(
      setScore(pm, { dealId, subDimensionKey: "ip-boundary", value: 3 }),
    ).rejects.toThrow(RuleViolation);
  });

  it("refuses evidence belonging to another deal", async () => {
    const dealId = await newDeal("Cross Evidence Test");
    const foreign = await db.observation.findFirstOrThrow({ where: { dealId: "halten" } });
    await expect(
      setScore(pm, { dealId, subDimensionKey: "earned-insight", value: 4, evidenceObsIds: [foreign.id] }),
    ).rejects.toThrow(/observations on this deal/);
  });

  it("re-scoring replaces the value and the citation set", async () => {
    const dealId = await newDeal("Rescore Test");
    await setScore(pm, { dealId, subDimensionKey: "earned-insight", value: 2 });
    await setScore(pm, { dealId, subDimensionKey: "earned-insight", value: 5 });

    const rows = await db.subDimensionScore.findMany({ where: { dealId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("5");
  });

  it("clearing returns the row to unscored, which is not the same as NE", async () => {
    const dealId = await newDeal("Clear Test");
    await setScore(pm, { dealId, subDimensionKey: "earned-insight", value: "NE" });
    expect(await db.subDimensionScore.count({ where: { dealId } })).toBe(1);

    await clearScore(pm, dealId, "earned-insight");
    expect(await db.subDimensionScore.count({ where: { dealId } })).toBe(0);
  });
});
