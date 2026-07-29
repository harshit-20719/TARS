import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { NotAuthorized, type Actor } from "@/lib/authz";
import { RuleViolation } from "@/lib/domain/rules";
import { FirefliesError } from "@/lib/fireflies/types";
import type { FirefliesClient, FirefliesMeeting, ListMeetingsOptions } from "@/lib/fireflies/types";
import { getRecord } from "@/lib/repo/records";
import { addCall, createDeal } from "./capture";
import { importFirefliesCall, listFirefliesMeetings } from "./import";

/**
 * Importing a meeting from Fireflies.
 *
 * The property this file exists for is the order of operations: **every refusal
 * is settled before a transcript is fetched.** That is not a performance point.
 * The shared Fireflies account holds every call Biome has recorded, the `Call`
 * row is the only thing that records who reached into it, and a rejected import
 * never writes that row — so a fetch that happens before the checks is a founder
 * transcript pulled out of the workspace with nothing at all left behind saying
 * who pulled it. Hence the stub counts its own calls, and the assertions are
 * that it was never reached.
 *
 * No test here has a credential or touches the network: the client is injected,
 * the way the extraction stub is, and vitest.config.ts pins FIREFLIES_API_KEY
 * empty so a regression that resolved a real client would fail loudly instead of
 * reading somebody's board meeting.
 */

const TRANSCRIPT = `Rhea: We ran settlement operations at two clearing banks for six years.
Aparna: The head of operations at one of those banks has agreed to a paid pilot.`;

const MEETING: FirefliesMeeting = {
  id: "ff-halten-2",
  // AE7: the title names the founder, not the company the deal is filed under.
  title: "Biome <> Aparna",
  participants: ["aparna@halten.com", "pm@biome.in"],
  date: "2026-07-22T09:30:00.000Z",
  durationMinutes: 42,
};

const OTHER_MEETING: FirefliesMeeting = {
  id: "ff-board-1",
  title: "Biome board — Q3",
  participants: ["partner@biome.in"],
  date: "2026-07-01T09:30:00.000Z",
  durationMinutes: 90,
};

/**
 * A Fireflies that answers from a fixture and records what it was asked.
 *
 * `listMeetings` filters on title *or* participants because that is what the
 * real one does — the search reaches Fireflies as one term and is matched
 * against both there (SEARCH_QUERY in lib/fireflies/client.ts). Reproducing that
 * here is what makes AE7 assertable without a live key.
 */
function stubFireflies(meetings: FirefliesMeeting[], transcripts: Record<string, string> = {}) {
  const asked: { list: ListMeetingsOptions[]; transcripts: string[] } = {
    list: [],
    transcripts: [],
  };

  const client: FirefliesClient = {
    async listMeetings(options: ListMeetingsOptions = {}) {
      asked.list.push(options);
      const search = options.search?.trim().toLowerCase() ?? "";
      if (!search) return meetings;
      return meetings.filter(
        (m) =>
          m.title.toLowerCase().includes(search) ||
          m.participants.some((p) => p.toLowerCase().includes(search)),
      );
    },
    async fetchTranscript(meetingId: string) {
      asked.transcripts.push(meetingId);
      const text = transcripts[meetingId];
      if (text === undefined) {
        throw new FirefliesError(`Fireflies has no meeting with the id ${meetingId}.`);
      }
      return text;
    },
  };

  return { client, asked };
}

let pm: Actor;
const createdDealIds: string[] = [];

beforeAll(async () => {
  const row = await db.user.findUniqueOrThrow({ where: { email: "pm@biome.in" } });
  pm = { id: row.id, email: row.email, name: row.name, role: Role.PM };
});

// Own deals, removed again, so the seeded fixtures the repository test compares
// against are untouched.
afterAll(async () => {
  if (createdDealIds.length) {
    await db.deal.deleteMany({ where: { id: { in: createdDealIds } } });
  }
});

async function newDeal(company: string): Promise<string> {
  const id = await createDeal(pm, {
    company,
    oneLiner: "Continuous settlement reconciliation.",
    founders: "Aparna Rao",
  });
  createdDealIds.push(id);
  return id;
}

describe("nothing is fetched until the import is known to be legal", () => {
  /**
   * AE5. The number is taken, so the import is refused — and refused in the
   * words a pasted call is refused in, because it is the same rule and a PM
   * hitting it twice through two doors should not have to work out whether they
   * are the same problem. Asserted by comparing the two messages rather than by
   * matching a string, so the two cannot drift.
   */
  it("refuses an occupied call number before fetching, in the paste path's words", async () => {
    const dealId = await newDeal("Import Collision Test");
    await addCall(pm, { dealId, number: 2, label: "Second call", transcript: TRANSCRIPT });

    const { client, asked } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });

    const pasted = await addCall(pm, {
      dealId,
      number: 2,
      label: "Second call again",
      transcript: TRANSCRIPT,
    }).catch((e: unknown) => e as RuleViolation);
    const imported = await importFirefliesCall(
      pm,
      { dealId, meetingId: MEETING.id, number: 2, label: "Second call" },
      { client },
    ).catch((e: unknown) => e as RuleViolation);

    expect(imported).toBeInstanceOf(RuleViolation);
    expect((imported as RuleViolation).message).toBe((pasted as RuleViolation).message);
    expect((imported as RuleViolation).message).toContain("call 2 already exists");

    // The point of the unit: no transcript left Fireflies for a refused import.
    expect(asked.transcripts).toEqual([]);
    expect(await db.call.count({ where: { dealId } })).toBe(1);
  });

  /**
   * AE8. The call-number rule cannot catch this — call 3 is free, and every
   * other check passes. Only the source meeting id knows the deal already holds
   * this recording, which is half of why it is stored.
   */
  it("refuses a meeting already on the deal, naming the call it is already on", async () => {
    const dealId = await newDeal("Import Duplicate Test");
    const { client, asked } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });

    await importFirefliesCall(
      pm,
      { dealId, meetingId: MEETING.id, number: 2, label: "Second founder call" },
      { client },
    );

    await expect(
      importFirefliesCall(
        pm,
        { dealId, meetingId: MEETING.id, number: 3, label: "Second founder call again" },
        { client },
      ),
    ).rejects.toThrow(/already on this deal as call 2/);

    // One fetch, from the import that succeeded — the second was refused first.
    expect(asked.transcripts).toEqual([MEETING.id]);
    expect(await db.call.count({ where: { dealId } })).toBe(1);
  });

  /** The same meeting on a *different* deal is an ordinary import, not a duplicate. */
  it("lets the same meeting be imported onto a different deal", async () => {
    const first = await newDeal("Import Shared Meeting A");
    const second = await newDeal("Import Shared Meeting B");
    const { client } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });
    const call = { meetingId: MEETING.id, number: 1, label: "First founder call" };

    await importFirefliesCall(pm, { dealId: first, ...call }, { client });
    await expect(
      importFirefliesCall(pm, { dealId: second, ...call }, { client }),
    ).resolves.toMatchObject({ number: 1 });
  });

  /**
   * A Fireflies failure is not converted into a half-import. Nothing is written
   * before the fetch, so a refusal there leaves the deal exactly as it was.
   */
  it("writes nothing when Fireflies refuses the transcript", async () => {
    const dealId = await newDeal("Import Fetch Failure Test");
    // No transcript registered for this id, so the stub refuses the way the real
    // client refuses a meeting Fireflies recorded but never transcribed.
    const { client } = stubFireflies([MEETING]);

    await expect(
      importFirefliesCall(
        pm,
        { dealId, meetingId: MEETING.id, number: 1, label: "First founder call" },
        { client },
      ),
    ).rejects.toThrow(FirefliesError);

    expect(await db.call.count({ where: { dealId } })).toBe(0);
  });
});

describe("an imported call", () => {
  it("is persisted in one insert, attributed, with its flattened transcript", async () => {
    const dealId = await newDeal("Import Attribution Test");
    const { client } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });

    const { callId, number } = await importFirefliesCall(
      pm,
      {
        dealId,
        meetingId: MEETING.id,
        number: 2,
        label: "Second founder call",
        date: MEETING.date ?? undefined,
      },
      { client },
    );

    const row = await db.call.findUniqueOrThrow({ where: { id: callId } });
    expect(number).toBe(2);
    expect(row.transcript).toBe(TRANSCRIPT);
    expect(row.label).toBe("Second founder call");
    expect(row.importedById).toBe(pm.id);
    expect(row.importedByEmail).toBe(pm.email);
    expect(row.sourceMeetingId).toBe(MEETING.id);
    // The meeting's date, not the day it was imported.
    expect(row.date.toISOString()).toBe(MEETING.date);

    /**
     * One insert and no follow-up write (KTD14). `updatedAt` is stamped on every
     * update, so a second statement — the shape where a failure leaves an
     * unattributed transcript sitting on the deal — would move it past
     * `createdAt`. This is what asserts the attribution and the transcript
     * landed together.
     */
    expect(row.updatedAt.getTime()).toBe(row.createdAt.getTime());
  });

  /**
   * R24's real test is the account being deleted, which is what offboarding
   * does. The relation goes null, the address stays, and the call still says who
   * imported it.
   */
  it("still names its importer after that account is deleted", async () => {
    const dealId = await newDeal("Import Offboarding Test");
    const leaver = await db.user.create({
      data: { email: "leaver-import@biome.in", name: "Leaver", role: Role.PM },
    });
    const { client } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });

    const { callId } = await importFirefliesCall(
      { id: leaver.id, email: leaver.email, name: leaver.name, role: Role.PM },
      { dealId, meetingId: MEETING.id, number: 1, label: "First founder call" },
      { client },
    );

    await db.user.delete({ where: { id: leaver.id } });

    const row = await db.call.findUniqueOrThrow({ where: { id: callId } });
    expect(row.importedById).toBeNull();
    expect(row.importedByEmail).toBe("leaver-import@biome.in");
    expect(row.sourceMeetingId).toBe(MEETING.id);
  });

  /** R12. A pasted call is untouched by any of this — three nulls, as before. */
  it("leaves a pasted call unattributed and unsourced", async () => {
    const dealId = await newDeal("Import Paste Untouched Test");
    const callId = await addCall(pm, {
      dealId,
      number: 1,
      label: "First founder call",
      transcript: TRANSCRIPT,
    });

    const row = await db.call.findUniqueOrThrow({ where: { id: callId } });
    expect(row.importedById).toBeNull();
    expect(row.importedByEmail).toBeNull();
    expect(row.sourceMeetingId).toBeNull();
  });

  /**
   * The record contract keeps the keys off a pasted call entirely rather than
   * carrying them as undefined, which is what keeps the fixture round-trip in
   * lib/repo/records.test.ts — a deep comparison against records that predate
   * importing — passing untouched.
   */
  it("appears in the record with attribution, while a pasted one carries no such keys", async () => {
    const dealId = await newDeal("Import Record Shape Test");
    const { client } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });
    await addCall(pm, { dealId, number: 1, label: "Pasted", transcript: TRANSCRIPT });
    await importFirefliesCall(
      pm,
      { dealId, meetingId: MEETING.id, number: 2, label: "Imported" },
      { client },
    );

    const record = await getRecord(dealId);
    const [pasted, imported] = record!.calls;

    expect("importedByEmail" in pasted).toBe(false);
    expect("sourceMeetingId" in pasted).toBe(false);
    expect(imported.importedByEmail).toBe(pm.email);
    expect(imported.sourceMeetingId).toBe(MEETING.id);
  });

  /**
   * The transcript has just crossed a network and been written; handing it back
   * as well would put a founder call into a server-action response and every log
   * that records one, for a caller that has no use for it.
   */
  it("returns identifiers only, never the transcript", async () => {
    const dealId = await newDeal("Import Return Shape Test");
    const { client } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });

    const result = await importFirefliesCall(
      pm,
      { dealId, meetingId: MEETING.id, number: 1, label: "First founder call" },
      { client },
    );

    expect(Object.keys(result).sort()).toEqual(["callId", "number"]);
    expect(JSON.stringify(result)).not.toContain("settlement operations");
  });

  /** R14. The number and the label are required of an import exactly as of a paste. */
  it("refuses an import with no label, before fetching", async () => {
    const dealId = await newDeal("Import Label Required Test");
    const { client, asked } = stubFireflies([MEETING], { [MEETING.id]: TRANSCRIPT });

    await expect(
      importFirefliesCall(pm, { dealId, meetingId: MEETING.id, number: 1, label: "  " }, { client }),
    ).rejects.toThrow();
    expect(asked.transcripts).toEqual([]);
  });
});

describe("listing the shared account's meetings", () => {
  /**
   * AE7. The meeting is titled after the founder and the deal is filed under the
   * company, so the title match finds nothing — the participants are what make
   * it findable, and the row that comes back carries the participants and the
   * date the PM confirms it by (R22).
   */
  it("finds a meeting by a participant the title does not mention", async () => {
    const { client, asked } = stubFireflies([MEETING, OTHER_MEETING]);

    const byEmail = await listFirefliesMeetings(pm, { search: "aparna@halten.com", client });

    expect(byEmail.map((m) => m.id)).toEqual([MEETING.id]);
    expect(byEmail[0].title).not.toContain("halten");
    expect(byEmail[0].participants).toContain("aparna@halten.com");
    expect(byEmail[0].date).toBe(MEETING.date);
    // Passed through to Fireflies rather than filtered here: the workspace is
    // far bigger than a page, so a local filter would only ever search 50 rows.
    expect(asked.list).toEqual([{ search: "aparna@halten.com" }]);
  });

  /**
   * The founder's *name* rather than their address. Fireflies matches the term
   * against the title and the participants, and whether a participant matches by
   * name is unverified against a live key (see SEARCH_QUERY in
   * lib/fireflies/client.ts) — so what is pinned here is that the term reaches
   * Fireflies untouched, which is the half TARS controls.
   */
  it("passes a name search through untouched rather than matching it locally", async () => {
    const { client, asked } = stubFireflies([MEETING, OTHER_MEETING]);

    await listFirefliesMeetings(pm, { search: "Aparna Rao", client });

    expect(asked.list).toEqual([{ search: "Aparna Rao" }]);
  });

  /** R11. No scope argument exists to pass — every meeting, one shared account. */
  it("returns the whole workspace when nothing is searched for", async () => {
    const { client } = stubFireflies([MEETING, OTHER_MEETING]);

    const all = await listFirefliesMeetings(pm, { client });

    expect(all.map((m) => m.id)).toEqual([MEETING.id, OTHER_MEETING.id]);
  });

  it("passes paging through, so the picker can ask for the next 50", async () => {
    const { client, asked } = stubFireflies([MEETING]);

    await listFirefliesMeetings(pm, { skip: 50, limit: 50, client });

    expect(asked.list).toEqual([{ skip: 50, limit: 50 }]);
  });

  /**
   * KTD11. Every `Role` authors the record today, so this guard refuses nobody
   * who can sign in — the role below is a cast to something the enum does not
   * contain, which is the only way to exercise it. It is here as a regression
   * barrier: the day a read-only role exists, listing every call the firm has
   * recorded is precisely what it must not be able to do, and deleting the
   * assertion from the service would fail this test rather than pass silently.
   */
  it("refuses an actor who cannot author, without reaching Fireflies", async () => {
    const { client, asked } = stubFireflies([MEETING]);
    const readOnly: Actor = { ...pm, role: "VIEWER" as Role };

    await expect(listFirefliesMeetings(readOnly, { client })).rejects.toThrow(NotAuthorized);
    await expect(
      importFirefliesCall(
        readOnly,
        { dealId: "halten", meetingId: MEETING.id, number: 9, label: "x" },
        { client },
      ),
    ).rejects.toThrow(NotAuthorized);

    expect(asked.list).toEqual([]);
    expect(asked.transcripts).toEqual([]);
  });
});
