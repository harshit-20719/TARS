import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { NotAuthorized, type Actor } from "@/lib/authz";
import { RuleViolation } from "@/lib/domain/rules";
import type { ExtractionClient } from "@/lib/extraction/extract";
import type { ExtractionOutput } from "@/lib/extraction/types";
import { RUBRICS } from "@/framework";
import {
  addCall,
  clearScore,
  createDeal,
  decideObservation,
  deleteCall,
  deleteDeal,
  runExtractionForCall,
  setScore,
  updateDeal,
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

/**
 * A stub standing in for six concurrent calls, one per macro-dimension.
 *
 * It has to route by block rather than answer every call with the same payload:
 * extraction fans out, so a stub that returned the whole output six times would
 * write six copies of every observation and quietly invalidate every count in this
 * file. Each call gets only the observations whose row actually belongs to the
 * block being asked — which is what the real per-block schema enforces.
 *
 * Routed on the rubric key the request now carries (KTD7), not on the prompt
 * text — and a request for a block this stub cannot place throws rather than
 * answering with a default, so a routing mistake fails as a routing error
 * instead of as a dozen quietly wrong counts.
 */
function stubClient(output: ExtractionOutput): ExtractionClient {
  return {
    messages: {
      parse: async (params) => {
        const rubric = RUBRICS.find((r) => r.key === params.rubricKey);
        if (!rubric) {
          throw new Error(`stub asked for an unrouted rubric key: ${String(params.rubricKey)}`);
        }
        const mine = output.observations.filter((o) =>
          rubric.subs.some((s) => s.key === o.subDimensionKey),
        );
        const quotes = new Set(mine.map((o) => o.quote));
        return {
          parsed_output: {
            observations: mine,
            claims: output.claims.filter((c) => quotes.has(c.anchorQuote)),
          },
          stop_reason: "end_turn",
        };
      },
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

  it("lets a PARTNER create a deal, attributed to them", async () => {
    const id = await createDeal(partner, {
      company: "Partner Create Test",
      oneLiner: "y",
      founders: "z",
    });
    createdDealIds.push(id);
    const row = await db.deal.findUniqueOrThrow({ where: { id } });
    expect(row.ownerId).toBe(partner.id);
  });

  // AE3. Partners author on the same terms as PMs, and the record keeps saying
  // who did the work — which is the whole reason widening the role is safe.
  it("lets a PARTNER score, and records the partner as author", async () => {
    const dealId = await newDeal("Partner Score Test");
    await setScore(partner, { dealId, subDimensionKey: "earned-insight", value: 4 });
    const row = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId, subDimensionKey: "earned-insight" },
    });
    expect(row.authorId).toBe(partner.id);
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

  /**
   * R21. The id is derived from the company name once, at creation, and is a
   * handle from then on — every link into the deal, every bookmark, and every
   * revalidated path is keyed on it. A rename that re-derived it would break all
   * of them, and the alternative to a stale slug is a redirect table nobody wants
   * to maintain.
   */
  it("keeps the id fixed when the company is renamed", async () => {
    const dealId = await newDeal("Renameable Co");
    expect(dealId).toBe("renameable-co");

    await updateDeal(pm, dealId, { company: "Something Else Entirely" });

    const row = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(row.id).toBe("renameable-co");
    expect(row.company).toBe("Something Else Entirely");
    // Nothing was created alongside it under a re-derived id.
    expect(await db.deal.findUnique({ where: { id: "something-else-entirely" } })).toBeNull();
  });

  /**
   * `updateDeal` takes `unknown` and validates at runtime, so a caller can send
   * whatever it likes. Zod strips what the schema does not declare — which is
   * what keeps `reassignDeal` the only path to a change of owner, and therefore
   * the only path past `assertMayReassignDeal` (R9).
   */
  it("ignores an ownerId smuggled into an ordinary edit", async () => {
    const dealId = await newDeal("Owner Smuggle Test");
    const partnerId = partner.id;

    await updateDeal(pm, dealId, { oneLiner: "Edited.", ownerId: partnerId });

    const row = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(row.oneLiner).toBe("Edited.");
    expect(row.ownerId).toBe(pm.id);
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

  /**
   * Deleting a call leaves its observations behind on purpose — they are keyed by
   * call number and a score may already cite them. Re-adding a call on that
   * number would silently adopt them, and coverage would then attribute a removed
   * call's quotes to the new one.
   */
  it("refuses to reuse a call number that still has evidence filed against it", async () => {
    const dealId = await newDeal("Reused Number Test");
    const callId = await addCall(pm, {
      dealId,
      number: 2,
      label: "Second",
      transcript: TRANSCRIPT,
    });
    await db.observation.create({
      data: {
        dealId,
        callNumber: 2,
        rubricKey: "ft",
        subDimensionKey: "earned-insight",
        quote: "six years inside bank ops",
        status: "accepted",
      },
    });

    await deleteCall(pm, callId);
    // The observation survives the call, which is the documented behaviour.
    expect(await db.observation.count({ where: { dealId, callNumber: 2 } })).toBe(1);

    await expect(
      addCall(pm, { dealId, number: 2, label: "Replacement", transcript: TRANSCRIPT }),
    ).rejects.toThrow(/still has 1 observation/);

    // A free number is unaffected.
    await expect(
      addCall(pm, { dealId, number: 3, label: "Replacement", transcript: TRANSCRIPT }),
    ).resolves.toBeTruthy();
  });

  /**
   * R24, from the other side. `addCallAction` hands this browser input straight
   * through, so an importer taken from the payload would be an attribution
   * anybody could write — and the point of recording who reached into the shared
   * Fireflies account is that they cannot.
   *
   * All three columns are smuggled, because the meeting id is the one that made
   * the other two happen: the insert stamps the actor's name *because* a source
   * meeting is present, so a payload carrying one alone would have produced a
   * pasted call that reads "Imported from Fireflies by …". It is out of
   * `AddCallInput` entirely now and arrives as a separate argument only
   * lib/services/import.ts passes, so Zod strips it here like the other two.
   *
   * The same argument, and the same shape of test, as the smuggled `ownerId`
   * above.
   */
  it("ignores an importer smuggled into a pasted call", async () => {
    const dealId = await newDeal("Forged Attribution Test");

    const callId = await addCall(pm, {
      dealId,
      number: 1,
      label: "First founder call",
      transcript: TRANSCRIPT,
      sourceMeetingId: "ff-forged-1",
      importedById: partner.id,
      importedByEmail: "someone.else@biome.in",
    });

    const row = await db.call.findUniqueOrThrow({ where: { id: callId } });
    expect(row.importedById).toBeNull();
    expect(row.importedByEmail).toBeNull();
    expect(row.sourceMeetingId).toBeNull();
  });
});

describe("extraction persistence", () => {
  /** A drafted observation as the model now returns it. */
  const draft = (o: {
    quote: string;
    subDimensionKey?: string;
    rubricKey?: string;
    confidence?: "high" | "low";
  }) => ({
    rubricKey: "pt",
    subDimensionKey: "compounding-moat",
    speaker: "Rhea",
    timestamp: "00:06",
    confidence: "high" as const,
    mappingNote: "describes the matcher's cadence",
    ...o,
  });

  const verbatim = draft({
    quote: "Our matcher runs continuously instead of as a nightly batch job.",
  });
  const paraphrased = draft({ quote: "Their matcher runs all the time rather than nightly." });
  /**
   * A second span, filed with the model unsure of the row. Its own span, not
   * `verbatim`'s: the same span filed twice now merges to the higher-confidence
   * filing (KTD10), so a low-confidence duplicate would never reach the
   * database — and these tests need a low-confidence row that does.
   */
  const unsure = draft({
    quote: "The head of operations at one of those banks has agreed to a paid pilot.",
    confidence: "low",
  });

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

  it("writes observations and claimed claims", async () => {
    const { dealId, callId } = await seedCall("Extract Test");
    const summary = await runExtractionForCall(pm, callId, {
      client: stubClient({
        observations: [verbatim],
        claims: [
          {
            text: "The matcher reconciles continuously rather than in a nightly batch.",
            anchorQuote: verbatim.quote,
            originTag: "founder-volunteered",
            rubricKey: "pt",
          },
        ],
      }),
    });

    expect(summary.observationsWritten).toBe(1);
    expect(summary.claimsWritten).toBe(1);

    const obs = await db.observation.findMany({ where: { dealId } });
    expect(obs).toHaveLength(1);
    expect(obs[0].layer).toBe("L1");
    expect(obs[0].mappingNote).toBe(verbatim.mappingNote);

    const claims = await db.claim.findMany({ where: { dealId } });
    expect(claims[0].status).toBe("claimed");
    expect(claims[0].originTag).toBe("founderVolunteered");
    expect(claims[0].anchorObsId).toBe(obs[0].id);
  });

  /**
   * The change that took review off the PM's critical path: a confident mapping is
   * evidence on arrival, an unsure one waits for a person. If this inverts, either
   * the PM is back to approving clerical work or the machine is filing things
   * nobody checked.
   */
  it("files a confident mapping as evidence and leaves an unsure one as a draft", async () => {
    const a = await seedCall("Confident Test");
    await runExtractionForCall(pm, a.callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });
    const confident = await db.observation.findFirstOrThrow({ where: { dealId: a.dealId } });
    expect(confident.status).toBe("accepted");
    expect(confident.confidence).toBe("high");
    // Nobody decided it — the machine filed it. That distinction has to survive.
    expect(confident.decidedById).toBeNull();

    const b = await seedCall("Unsure Test");
    await runExtractionForCall(pm, b.callId, {
      client: stubClient({ observations: [unsure], claims: [] }),
    });
    const queued = await db.observation.findFirstOrThrow({ where: { dealId: b.dealId } });
    expect(queued.status).toBe("draft");
    expect(queued.confidence).toBe("low");
  });

  /**
   * The other half of removing the checkbox grid: a score cites the row's evidence
   * without being told to. A PM who scores a row and never opens the evidence list
   * should still have a complete, cited score.
   */
  it("a score cites the row's observations without being asked", async () => {
    const { dealId, callId } = await seedCall("Auto Evidence Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });

    await setScore(pm, { dealId, subDimensionKey: "compounding-moat", value: 4 });

    const score = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId, subDimensionKey: "compounding-moat" },
      include: { evidence: true },
    });
    expect(score.evidence).toHaveLength(1);
  });

  it("does not cite an observation the PM rejected", async () => {
    const { dealId, callId } = await seedCall("Rejected Evidence Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });
    const o = await db.observation.findFirstOrThrow({ where: { dealId } });
    await decideObservation(pm, o.id, { status: "rejected" });

    await setScore(pm, { dealId, subDimensionKey: "compounding-moat", value: 2 });

    const score = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId, subDimensionKey: "compounding-moat" },
      include: { evidence: true },
    });
    expect(score.evidence).toEqual([]);
  });

  /**
   * The order that matters, and the one the old test had backwards: score first,
   * reject second. Evidence is frozen at save time, so the rejection has to reach
   * back and remove the citation — otherwise the scorecard keeps printing a quote
   * its author threw out, and the row still counts as complete.
   */
  it("rejecting a quote after scoring removes it from the score", async () => {
    const { dealId, callId } = await seedCall("Reject After Score Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });
    await setScore(pm, { dealId, subDimensionKey: "compounding-moat", value: 4 });

    const before = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId, subDimensionKey: "compounding-moat" },
      include: { evidence: true },
    });
    expect(before.evidence).toHaveLength(1);

    const o = await db.observation.findFirstOrThrow({ where: { dealId } });
    await decideObservation(pm, o.id, { status: "rejected" });

    const after = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId, subDimensionKey: "compounding-moat" },
      include: { evidence: true },
    });
    expect(after.evidence).toEqual([]);
  });

  /** Moving a quote takes it off the row it left, for the same reason. */
  it("moving a quote after scoring removes it from the row it left", async () => {
    const { dealId, callId } = await seedCall("Move After Score Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });
    await setScore(pm, { dealId, subDimensionKey: "compounding-moat", value: 4 });

    const o = await db.observation.findFirstOrThrow({ where: { dealId } });
    await decideObservation(pm, o.id, {
      status: "edited",
      subDimensionKey: "earned-insight",
      rubricKey: "ft",
    });

    const old = await db.subDimensionScore.findFirstOrThrow({
      where: { dealId, subDimensionKey: "compounding-moat" },
      include: { evidence: true },
    });
    expect(old.evidence).toEqual([]);
  });

  // The authorship rule (spec R5): the machine drafts, it never scores. If this
  // ever fails, the framework has been broken, not just the code.
  it("writes no scores at all", async () => {
    const { dealId, callId } = await seedCall("No Score Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({
        observations: [verbatim],
        claims: [
          { text: "Continuous matching.", anchorQuote: verbatim.quote, originTag: "machine-inferred", rubricKey: "pt" },
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

  /**
   * The rule a re-extract must not break: a PM decision outlives the machine's
   * output. This got sharper when confident mappings started arriving already
   * accepted — "delete the drafts" is no longer the same set as "delete what the
   * machine wrote", so the re-run keys on whether a human touched the row.
   */
  it("a forced re-run replaces the machine's rows but keeps what the PM ruled on", async () => {
    const { dealId, callId } = await seedCall("Force Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim, unsure], claims: [] }),
    });

    // One machine row the PM has re-mapped by hand, which must survive.
    const kept = await db.observation.findFirstOrThrow({
      where: { dealId, confidence: "low" },
    });
    await decideObservation(pm, kept.id, {
      status: "edited",
      subDimensionKey: "earned-insight",
      rubricKey: "ft",
    });

    await runExtractionForCall(pm, callId, {
      force: true,
      client: stubClient({
        observations: [
          draft({
            quote: "We ran settlement operations at two clearing banks for six years.",
            rubricKey: "ft",
            subDimensionKey: "earned-insight",
          }),
        ],
        claims: [],
      }),
    });

    const after = await db.observation.findMany({ where: { dealId }, orderBy: { createdAt: "asc" } });
    // The PM's re-map plus the one new machine row. The untouched machine rows went.
    expect(after).toHaveLength(2);
    const survivor = after.find((o) => o.id === kept.id);
    expect(survivor).toBeDefined();
    expect(survivor!.subDimensionKey).toBe("earned-insight");
    // Re-mapping retires the machine's metadata — the note described the old row.
    expect(survivor!.confidence).toBeNull();
    expect(survivor!.mappingNote).toBeNull();
  });

  /**
   * The destructive case the review found: a re-run whose own extraction partially
   * fails must not delete the evidence the earlier run wrote for blocks it did not
   * re-read. The button tells the PM to re-run after a partial failure, so this is
   * the ordinary path, not an exotic one.
   */
  it("a re-run that fails a block keeps the other blocks' rows", async () => {
    const { dealId, callId } = await seedCall("Partial Rerun Test");

    // First run: both blocks answer.
    const ftRow = draft({
      quote: "We ran settlement operations at two clearing banks for six years.",
      rubricKey: "ft",
      subDimensionKey: "earned-insight",
    });
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim, ftRow], claims: [] }),
    });
    expect(await db.observation.count({ where: { dealId } })).toBe(2);

    // Second run: the Product/Tech block fails, every other block answers.
    const failing: ExtractionClient = {
      messages: {
        parse: async (params) => {
          if (params.rubricKey === "pt") throw Object.assign(new Error("nope"), { status: 429 });
          const rubric = RUBRICS.find((r) => r.key === params.rubricKey);
          if (!rubric) {
            throw new Error(`stub asked for an unrouted rubric key: ${String(params.rubricKey)}`);
          }
          const mine = [ftRow].filter((o) => rubric.subs.some((s) => s.key === o.subDimensionKey));
          return { parsed_output: { observations: mine, claims: [] }, stop_reason: "end_turn" };
        },
      },
    };
    const summary = await runExtractionForCall(pm, callId, { force: true, client: failing });

    expect(summary.failedBlocks.map((f) => f.rubricKey)).toEqual(["pt"]);
    const quotes = (await db.observation.findMany({ where: { dealId } })).map((o) => o.quote);
    // The failed block's row survived because this run never re-read that block.
    expect(quotes).toContain(verbatim.quote);
    expect(quotes).toContain(ftRow.quote);
    expect(quotes).toHaveLength(2);
  });

  /** A partial run is not a complete read, and the record must not claim it was. */
  it("leaves the call un-extracted when a block failed", async () => {
    const { callId } = await seedCall("Partial Flag Test");
    const failing: ExtractionClient = {
      messages: {
        parse: async (params) => {
          if (params.rubricKey === "pt") throw Object.assign(new Error("nope"), { status: 429 });
          return { parsed_output: { observations: [], claims: [] }, stop_reason: "end_turn" };
        },
      },
    };
    await runExtractionForCall(pm, callId, { client: failing });
    expect((await db.call.findUniqueOrThrow({ where: { id: callId } })).extracted).toBe(false);
  });

  /**
   * Rows written before the confidence column existed carry a null marker. The
   * predicate has to see them, or the next re-run duplicates them instead of
   * replacing them.
   */
  it("a forced re-run replaces rows written before confidence existed", async () => {
    const { dealId, callId } = await seedCall("Legacy Row Test");
    await db.observation.create({
      data: {
        dealId,
        callNumber: 1,
        rubricKey: "pt",
        subDimensionKey: "compounding-moat",
        quote: verbatim.quote,
        status: "draft",
        confidence: null,
        layer: "L1",
      },
    });
    await db.call.update({ where: { id: callId }, data: { extracted: true } });

    await runExtractionForCall(pm, callId, {
      force: true,
      client: stubClient({ observations: [verbatim], claims: [] }),
    });

    // Replaced, not duplicated.
    expect(await db.observation.count({ where: { dealId } })).toBe(1);
  });

  /**
   * The authorship rule, in its sharpest form: the machine may not undo a human's
   * rejection by re-drafting the same quote and filing it as evidence.
   */
  it("does not re-create a quote the PM has already rejected", async () => {
    const { dealId, callId } = await seedCall("No Resurrect Test");
    await runExtractionForCall(pm, callId, {
      client: stubClient({ observations: [verbatim], claims: [] }),
    });
    const o = await db.observation.findFirstOrThrow({ where: { dealId } });
    await decideObservation(pm, o.id, { status: "rejected" });

    const summary = await runExtractionForCall(pm, callId, {
      force: true,
      client: stubClient({ observations: [verbatim], claims: [] }),
    });

    expect(summary.skippedAlreadyRuledOn).toBe(1);
    const rows = await db.observation.findMany({ where: { dealId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("rejected");
  });

  /**
   * Two blocks can still return the same quote — six independent calls cannot
   * coordinate, whatever the prompt says. One filing survives (KTD10; here a
   * tie, so the earlier rubric, ft) and the claim must anchor to it — this
   * test predates the dedupe pass and passes across it by design, because
   * repointing (KTD11) carries the claim to the surviving filing.
   */
  it("anchors a claim to its own block when two blocks share a quote", async () => {
    const { dealId, callId } = await seedCall("Anchor Collision Test");
    const shared = "Our matcher runs continuously instead of as a nightly batch job.";

    const ptRow = draft({ quote: shared, rubricKey: "pt", subDimensionKey: "compounding-moat" });
    const ftRow = draft({ quote: shared, rubricKey: "ft", subDimensionKey: "earned-insight" });

    await runExtractionForCall(pm, callId, {
      client: stubClient({
        observations: [ptRow, ftRow],
        claims: [
          {
            text: "Continuous reconciliation is the moat.",
            anchorQuote: shared,
            originTag: "founder-volunteered",
            rubricKey: "ft",
          },
        ],
      }),
    });

    const claim = await db.claim.findFirstOrThrow({ where: { dealId } });
    const anchor = await db.observation.findUniqueOrThrow({ where: { id: claim.anchorObsId } });
    expect(anchor.rubricKey).toBe("ft");
  });

  /**
   * KTD10: one span, one filing — the higher-confidence one, with rubric order
   * breaking ties. KTD11: the collapse never costs a claim; it is repointed to
   * the surviving filing. R10: the invariant holds across partial re-runs too,
   * where the colliding filings live in different runs and only one of them is
   * in memory.
   */
  describe("one span, one filing", () => {
    const SPAN = "Our matcher runs continuously instead of as a nightly batch job.";

    /** One filing of the span, as a block's parsed output carries it. */
    const filing = (subDimensionKey: string, confidence: "high" | "low") => ({
      quote: SPAN,
      subDimensionKey,
      speaker: null,
      timestamp: null,
      confidence,
      mappingNote: "n",
    });

    const moatClaim = {
      text: "Continuous reconciliation is the moat.",
      anchorQuote: SPAN,
      originTag: "founder-volunteered" as const,
    };

    /**
     * A client answering per block: the payload for the blocks named, a
     * retryable failure for the blocks told to fail, empty output everywhere
     * else. Unlike `stubClient` it does not fan a shared quote's claim out to
     * every block that observed it, which is exactly the control these tests
     * need — a claim here belongs to one block.
     */
    const routed = (
      perBlock: Record<string, { observations?: unknown[]; claims?: unknown[] }>,
      failOn: string[] = [],
    ): ExtractionClient => ({
      messages: {
        parse: async (params) => {
          const key = String(params.rubricKey);
          if (failOn.includes(key)) throw Object.assign(new Error("nope"), { status: 429 });
          const mine = perBlock[key];
          return {
            parsed_output: { observations: mine?.observations ?? [], claims: mine?.claims ?? [] },
            stop_reason: "end_turn",
          };
        },
      },
    });

    it("persists the higher-confidence filing when two blocks return the same span", async () => {
      const { dealId, callId } = await seedCall("Span Merge Test");
      const summary = await runExtractionForCall(pm, callId, {
        client: routed({
          ft: { observations: [filing("earned-insight", "low")], claims: [moatClaim] },
          pt: { observations: [filing("compounding-moat", "high")] },
        }),
      });

      const rows = await db.observation.findMany({ where: { dealId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].rubricKey).toBe("pt");
      expect(rows[0].confidence).toBe("high");

      // The losing block's claim followed the span to the winner (KTD11).
      const claim = await db.claim.findFirstOrThrow({ where: { dealId } });
      expect(claim.anchorObsId).toBe(rows[0].id);
      expect(summary.droppedClaims).toEqual([]);

      // Counted, and attributed to the block whose filing lost.
      expect(summary.mergedSpans).toBe(1);
      const ftRun = await db.extractionBlockRun.findUniqueOrThrow({
        where: { callId_rubricKey: { callId, rubricKey: "ft" } },
      });
      expect(ftRun.mergedSpans).toBe(1);
    });

    it("keeps the earlier rubric on an equal-confidence tie, run after run", async () => {
      const { dealId, callId } = await seedCall("Span Tie Test");
      const client = routed({
        ft: { observations: [filing("earned-insight", "high")] },
        pt: { observations: [filing("compounding-moat", "high")] },
      });

      await runExtractionForCall(pm, callId, { client });
      const first = await db.observation.findMany({ where: { dealId } });
      expect(first).toHaveLength(1);
      expect(first[0].rubricKey).toBe("ft");

      // The same drafts arriving again settle the same way — deterministic,
      // so re-running cannot flip the filing between rubrics.
      await runExtractionForCall(pm, callId, { force: true, client });
      const second = await db.observation.findMany({ where: { dealId } });
      expect(second).toHaveLength(1);
      expect(second[0].rubricKey).toBe("ft");
    });

    it("collapses a span one block returned twice to one filing", async () => {
      const { dealId, callId } = await seedCall("Twice Filed Test");
      await runExtractionForCall(pm, callId, {
        client: routed({
          pt: {
            observations: [filing("compounding-moat", "low"), filing("time-to-value", "high")],
          },
        }),
      });

      const rows = await db.observation.findMany({ where: { dealId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].subDimensionKey).toBe("time-to-value");
    });

    /**
     * R10, the direction that loses data if unhandled: run one filed the span
     * from a block this re-run does not read, so the incumbent survives the
     * scoped delete — and without the cross-run comparison, the re-run's own
     * filing lands beside it as a second copy of the same span.
     */
    it("a partial re-run does not reinsert a span an unread block's filing already carries", async () => {
      const { dealId, callId } = await seedCall("Cross Run Newcomer Wins Test");

      // Run one: the ft block files the span unsure, with a claim anchored to it.
      await runExtractionForCall(pm, callId, {
        client: routed({
          ft: { observations: [filing("earned-insight", "low")], claims: [moatClaim] },
        }),
      });
      const incumbent = await db.observation.findFirstOrThrow({ where: { dealId } });
      expect(incumbent.rubricKey).toBe("ft");

      // Run two: ft fails (so it stays unread), pt files the same span confidently.
      const summary = await runExtractionForCall(pm, callId, {
        force: true,
        client: routed(
          { pt: { observations: [filing("compounding-moat", "high")] } },
          ["ft"],
        ),
      });

      // One filing — the surer one. The incumbent went.
      const rows = await db.observation.findMany({ where: { dealId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].rubricKey).toBe("pt");
      expect(rows[0].confidence).toBe("high");

      // The incumbent's claim was repointed to the survivor before the delete
      // (KTD11) — the cascade would otherwise have taken it silently.
      const claim = await db.claim.findFirstOrThrow({ where: { dealId } });
      expect(claim.anchorObsId).toBe(rows[0].id);
      expect(claim.text).toBe(moatClaim.text);

      // Counted on the run row of the block this run read.
      expect(summary.mergedSpans).toBe(1);
      const ptRun = await db.extractionBlockRun.findUniqueOrThrow({
        where: { callId_rubricKey: { callId, rubricKey: "pt" } },
      });
      expect(ptRun.mergedSpans).toBe(1);
    });

    /**
     * The same collision, other winner: the persisted filing is the surer one,
     * so the newcomer is dropped — and the claims it arrived with anchor to
     * the incumbent instead of vanishing with it.
     */
    it("keeps the persisted filing when it is the surer one, and anchors new claims to it", async () => {
      const { dealId, callId } = await seedCall("Cross Run Incumbent Wins Test");

      // Run one: the ft block files the span confidently.
      await runExtractionForCall(pm, callId, {
        client: routed({ ft: { observations: [filing("earned-insight", "high")] } }),
      });
      const incumbent = await db.observation.findFirstOrThrow({ where: { dealId } });

      // Run two: ft fails, pt re-files the same span unsure, with a claim.
      const summary = await runExtractionForCall(pm, callId, {
        force: true,
        client: routed(
          { pt: { observations: [filing("compounding-moat", "low")], claims: [moatClaim] } },
          ["ft"],
        ),
      });

      // The incumbent stood; the newcomer was never written.
      const rows = await db.observation.findMany({ where: { dealId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(incumbent.id);
      expect(rows[0].confidence).toBe("high");

      // The re-run's claim anchors to the filing that survived (KTD11).
      const claim = await db.claim.findFirstOrThrow({ where: { dealId } });
      expect(claim.anchorObsId).toBe(incumbent.id);
      expect(summary.claimsWritten).toBe(1);
      expect(summary.mergedSpans).toBe(1);
    });
  });

  it("lets a PARTNER run extraction", async () => {
    const { callId } = await seedCall("Partner Extract Test");
    await expect(
      runExtractionForCall(partner, callId, { client: stubClient({ observations: [], claims: [] }) }),
    ).resolves.toBeDefined();
  });

  /**
   * KTD16. The run record is what survives a refresh: one row per block per
   * call, written in the run's own transaction. Before it existed the failure
   * list lived in one component's useState and the only durable trace was the
   * `extracted` boolean, so a partial run stopped being legible the moment the
   * page reloaded (R24).
   */
  describe("per-block run records", () => {
    /** A client that fails exactly one block and answers the rest empty. */
    const failingOn = (rubricKey: string, status: number): ExtractionClient => ({
      messages: {
        parse: async (params) => {
          if (params.rubricKey === rubricKey) {
            throw Object.assign(new Error("nope"), { status });
          }
          return { parsed_output: { observations: [], claims: [] }, stop_reason: "end_turn" };
        },
      },
    });

    it("a run where every block reads writes one read row per block", async () => {
      const { callId } = await seedCall("Block Run Full Test");
      await runExtractionForCall(pm, callId, {
        client: stubClient({ observations: [verbatim], claims: [] }),
      });

      const rows = await db.extractionBlockRun.findMany({ where: { callId } });
      expect(rows).toHaveLength(RUBRICS.length);
      expect(new Set(rows.map((r) => r.rubricKey))).toEqual(new Set(RUBRICS.map((r) => r.key)));
      for (const row of rows) {
        expect(row.outcome).toBe("READ");
        // A read block has no failure to explain.
        expect(row.reason).toBeNull();
        // Merges arrive with the dedupe pass (U6); config versions with U10.
        expect(row.mergedSpans).toBe(0);
        expect(row.configVersion).toBeNull();
      }
    });

    /**
     * R26's other face: only one block returned any observations above, and
     * here none do — and "read it and there was nothing there" is still read.
     * The failed states are reserved for blocks that returned no usable output,
     * which the adapters signal by throwing (KTD5).
     */
    it("a block that read and found nothing is recorded read, not failed", async () => {
      const { callId } = await seedCall("Block Run Empty Test");
      await runExtractionForCall(pm, callId, {
        client: stubClient({ observations: [], claims: [] }),
      });

      const rows = await db.extractionBlockRun.findMany({ where: { callId } });
      expect(rows).toHaveLength(RUBRICS.length);
      for (const row of rows) expect(row.outcome).toBe("READ");
    });

    it("a failed block's row carries the reason; the other five read", async () => {
      const { callId } = await seedCall("Block Run Partial Test");
      await runExtractionForCall(pm, callId, { client: failingOn("pt", 429) });

      const rows = await db.extractionBlockRun.findMany({ where: { callId } });
      expect(rows).toHaveLength(RUBRICS.length);
      const failed = rows.find((r) => r.rubricKey === "pt");
      expect(failed?.outcome).toBe("FAILED_RETRYABLE");
      expect(failed?.reason).toMatch(/rate limited/);
      expect(rows.filter((r) => r.outcome === "READ")).toHaveLength(RUBRICS.length - 1);

      // The boolean stays, derived from the same run: not every block read.
      expect((await db.call.findUniqueOrThrow({ where: { id: callId } })).extracted).toBe(false);
    });

    /**
     * R22's two failure classes must not collapse: a retryable row invites the
     * re-run that fixes it, a terminal one fails identically on every press.
     * 404 is the terminal case a PM actually hits — a mistyped EXTRACTION_MODEL.
     */
    it("a terminal failure is recorded distinguishably from a retryable one", async () => {
      const { callId } = await seedCall("Block Run Terminal Test");
      await runExtractionForCall(pm, callId, { client: failingOn("gtm", 404) });

      const failed = await db.extractionBlockRun.findFirstOrThrow({
        where: { callId, rubricKey: "gtm" },
      });
      expect(failed.outcome).toBe("FAILED_TERMINAL");
      expect(failed.reason).toMatch(/no model by that name/);
    });

    /**
     * The replacement rule, which mirrors the scoped observation delete above:
     * a re-run replaces the rows for the blocks it attempted — read *or*
     * failed — and leaves every other row standing. The standing row is
     * planted directly because the service reads every framework block today;
     * per-rubric config (U10) is what will make a subset run reachable.
     */
    it("re-running replaces the attempted blocks' rows and leaves the others standing", async () => {
      const { callId } = await seedCall("Block Run Replace Test");
      await runExtractionForCall(pm, callId, {
        client: stubClient({ observations: [verbatim], claims: [] }),
      });
      await db.extractionBlockRun.create({
        data: { callId, rubricKey: "legacy-block", outcome: "READ" },
      });
      const before = await db.extractionBlockRun.findMany({ where: { callId } });
      expect(before).toHaveLength(RUBRICS.length + 1);

      await runExtractionForCall(pm, callId, { force: true, client: failingOn("pt", 429) });

      const after = await db.extractionBlockRun.findMany({ where: { callId } });
      expect(after).toHaveLength(RUBRICS.length + 1);
      // The failed block was attempted, so its earlier read row is replaced —
      // the record now says this block went unread, in this run's words.
      expect(after.find((r) => r.rubricKey === "pt")?.outcome).toBe("FAILED_RETRYABLE");
      // The block outside the run's read set keeps its exact row.
      const legacy = after.find((r) => r.rubricKey === "legacy-block");
      expect(legacy?.id).toBe(before.find((r) => r.rubricKey === "legacy-block")?.id);
      expect(legacy?.outcome).toBe("READ");
      // The attempted blocks' rows are this run's rows, not the first run's.
      const beforeIds = new Set(before.map((r) => r.id));
      for (const row of after.filter((r) => r.rubricKey !== "legacy-block")) {
        expect(beforeIds.has(row.id)).toBe(false);
      }

      // A full re-run heals the record: the failed block reads, and the derived
      // boolean flips back to true only now that every block read.
      await runExtractionForCall(pm, callId, {
        force: true,
        client: stubClient({ observations: [], claims: [] }),
      });
      const healed = await db.extractionBlockRun.findFirstOrThrow({
        where: { callId, rubricKey: "pt" },
      });
      expect(healed.outcome).toBe("READ");
      expect((await db.call.findUniqueOrThrow({ where: { id: callId } })).extracted).toBe(true);
    });

    /**
     * The verbatim guard's drops, attributed to the block that produced them —
     * what the flat droppedQuotes list cannot say. The quality view (U9) and
     * the tuning page (U11) both read these counts per block.
     */
    it("counts dropped quotes and claims against the block that produced them", async () => {
      const { callId } = await seedCall("Block Run Drop Count Test");
      const ftInvented = draft({
        quote: "We are the category leader in reconciliation.",
        rubricKey: "ft",
        subDimensionKey: "earned-insight",
      });
      await runExtractionForCall(pm, callId, {
        client: stubClient({
          observations: [verbatim, paraphrased, ftInvented],
          claims: [
            {
              text: "The matcher runs continuously.",
              anchorQuote: paraphrased.quote,
              originTag: "founder-volunteered",
              rubricKey: "pt",
            },
          ],
        }),
      });

      const rows = await db.extractionBlockRun.findMany({ where: { callId } });
      const pt = rows.find((r) => r.rubricKey === "pt");
      // The paraphrase was dropped, and the claim anchored to it went with it.
      expect(pt?.droppedQuotes).toBe(1);
      expect(pt?.droppedClaims).toBe(1);
      const ft = rows.find((r) => r.rubricKey === "ft");
      expect(ft?.droppedQuotes).toBe(1);
      expect(ft?.droppedClaims).toBe(0);
      // A block with nothing dropped says so.
      expect(rows.find((r) => r.rubricKey === "gtm")?.droppedQuotes).toBe(0);
    });

    it("deleting the deal cascades the run records away", async () => {
      const { dealId, callId } = await seedCall("Block Run Cascade Test");
      await runExtractionForCall(pm, callId, {
        client: stubClient({ observations: [verbatim], claims: [] }),
      });
      expect(await db.extractionBlockRun.count({ where: { callId } })).toBe(RUBRICS.length);

      await deleteDeal(pm, dealId);
      expect(await db.extractionBlockRun.count({ where: { callId } })).toBe(0);
    });
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
      subDimensionKey: "learning-rate",
      rubricKey: "ft",
    });

    const after = await db.observation.findUniqueOrThrow({ where: { id: obs.id } });
    expect(after.status).toBe("edited");
    expect(after.subDimensionKey).toBe("learning-rate");
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
    await setScore(pm, {
      dealId,
      subDimensionKey: "ip-ownership",
      value: "unv",
      flag: true,
      flagNote: "Assignment deeds requested, not yet received.",
    });
    const row = await db.subDimensionScore.findFirstOrThrow({ where: { dealId } });
    expect(row.scoreType).toBe("binary");
    expect(row.flag).toBe(true);
    expect(row.flagNote).toBe("Assignment deeds requested, not yet received.");
  });

  it("refuses a 1–5 value on a binary row", async () => {
    const dealId = await newDeal("Mismatch Test");
    await expect(
      setScore(pm, { dealId, subDimensionKey: "ip-ownership", value: 3 }),
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
