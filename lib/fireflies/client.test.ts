import { describe, expect, it, vi } from "vitest";
import {
  FIREFLIES_TIMEOUT_MS,
  MAX_PAGE_SIZE,
  createFirefliesClient,
  describeFirefliesFailure,
  type FirefliesFetch,
} from "./client";
import { FirefliesError } from "./types";

const KEY = "ff-secret-key-that-must-never-be-quoted-back";

type SentRequest = {
  url: string;
  headers: Record<string, string>;
  query: string;
  variables: Record<string, unknown>;
  signal: AbortSignal | undefined;
};

/**
 * A fetch that answers with the given bodies in order and records what it was
 * asked. Narrow on purpose — the client takes the smallest slice of fetch it
 * needs, so a stub is a few lines rather than a mock of the whole Response.
 */
function stub(bodies: unknown[], status = 200) {
  const sent: SentRequest[] = [];
  const queue = [...bodies];
  const fetch: FirefliesFetch = async (url, init) => {
    const parsed = JSON.parse(init.body) as {
      query: string;
      variables: Record<string, unknown>;
    };
    sent.push({
      url,
      headers: init.headers,
      query: parsed.query,
      variables: parsed.variables,
      signal: init.signal,
    });
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetch, sent };
}

const meeting = (o: Record<string, unknown> = {}) => ({
  id: "m1",
  title: "Biome <> Halten",
  date: 1753142400000,
  duration: 42.5,
  participants: ["aparna@halten.com", "pm@biome.in"],
  ...o,
});

const client = (fetch: FirefliesFetch) => createFirefliesClient({ apiKey: KEY, fetch });

describe("listing the workspace's meetings", () => {
  it("maps a list response to plain records with participants populated", async () => {
    const { fetch } = stub([{ data: { transcripts: [meeting()] } }]);
    const { meetings } = await client(fetch).listMeetings();

    expect(meetings).toEqual([
      {
        id: "m1",
        title: "Biome <> Halten",
        participants: ["aparna@halten.com", "pm@biome.in"],
        date: new Date(1753142400000).toISOString(),
        durationMinutes: 42.5,
      },
    ]);
  });

  /**
   * R22: a meeting is identified by its participants and its date, because the
   * titles follow no convention. A meeting Fireflies gives no participants for
   * still has to be listed and still has to be identifiable by what is left.
   */
  it("still carries title and date when a meeting has no participants", async () => {
    const { fetch } = stub([
      { data: { transcripts: [meeting({ participants: null, duration: null })] } },
    ]);
    const { meetings: [m] } = await client(fetch).listMeetings();

    expect(m.participants).toEqual([]);
    expect(m.title).toBe("Biome <> Halten");
    expect(m.date).toBe(new Date(1753142400000).toISOString());
    expect(m.durationMinutes).toBeNull();
  });

  it("accepts a date Fireflies sends as a string as well as one it sends as epoch millis", async () => {
    const { fetch } = stub([
      { data: { transcripts: [meeting({ id: "m2", date: "2026-07-22T00:00:00.000Z" })] } },
    ]);
    const { meetings: [m] } = await client(fetch).listMeetings();
    expect(m.date).toBe("2026-07-22T00:00:00.000Z");
  });

  it("never asks for the sentences while listing", async () => {
    // Pulling every transcript's text to render a picker would be minutes of
    // waiting and megabytes of founder transcript for a list of titles.
    const { fetch, sent } = stub([{ data: { transcripts: [meeting()] } }]);
    await client(fetch).listMeetings();
    expect(sent[0].query).not.toMatch(/sentences/);
  });

  it("sends the credential as a bearer token to the GraphQL endpoint", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [] } }]);
    await client(fetch).listMeetings();

    expect(sent[0].url).toBe("https://api.fireflies.ai/graphql");
    expect(sent[0].headers.Authorization).toBe(`Bearer ${KEY}`);
  });
});

describe("paging", () => {
  it("asks Fireflies to skip, rather than fetching everything and slicing", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [] } }]);
    await client(fetch).listMeetings({ skip: 50 });
    expect(sent[0].variables.skip).toBe(50);
  });

  it("never asks for more than the documented cap of 50", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [] } }]);
    await client(fetch).listMeetings({ limit: 200 });

    expect(MAX_PAGE_SIZE).toBe(50);
    expect(sent[0].variables.limit).toBe(MAX_PAGE_SIZE);
  });

  it("defaults to a full page and no skip", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [] } }]);
    await client(fetch).listMeetings();
    expect(sent[0].variables).toMatchObject({ limit: MAX_PAGE_SIZE, skip: 0 });
  });
});

describe("search", () => {
  const searchResponse = {
    data: {
      byTitle: [meeting({ id: "titled", title: "Biome <> Halten" })],
      byParticipant: [meeting({ id: "unnamed", title: "PM <> Founder", date: 1753228800000 })],
    },
  };

  it("passes the term to Fireflies rather than filtering the page here", async () => {
    const { fetch, sent } = stub([searchResponse]);
    const { meetings } = await client(fetch).listMeetings({ search: "aparna@halten.com" });

    expect(sent).toHaveLength(1);
    expect(sent[0].variables.search).toBe("aparna@halten.com");
    expect(sent[0].query).toMatch(/title: \$search/);
    expect(sent[0].query).toMatch(/participant_email: \$search/);
    // Both come back, including the one whose title contains nothing of the term —
    // proof the filtering happened at Fireflies and nothing was re-applied here.
    expect(meetings.map((m) => m.id)).toEqual(["unnamed", "titled"]);
  });

  it("lists a meeting once when it matches on both title and participant", async () => {
    const { fetch } = stub([
      { data: { byTitle: [meeting({ id: "same" })], byParticipant: [meeting({ id: "same" })] } },
    ]);
    const { meetings } = await client(fetch).listMeetings({ search: "halten" });
    expect(meetings.map((m) => m.id)).toEqual(["same"]);
  });

  it("ignores a blank search term rather than filtering on nothing", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [meeting()] } }]);
    await client(fetch).listMeetings({ search: "   " });
    expect(sent[0].query).not.toMatch(/participant_email/);
  });
});

describe("fetching one transcript", () => {
  it("returns the flattened text with the speakers Fireflies named", async () => {
    const { fetch, sent } = stub([
      {
        data: {
          transcript: {
            id: "m1",
            sentences: [
              { speaker_name: "Aparna", text: "We spent four years in bank operations." },
              { speaker_name: null, text: "And the break lands at cutover." },
            ],
          },
        },
      },
    ]);

    const text = await client(fetch).fetchTranscript("m1");

    expect(text).toBe(
      "Aparna: We spent four years in bank operations.\nAnd the break lands at cutover.",
    );
    expect(sent[0].variables.id).toBe("m1");
  });

  it("reports a meeting Fireflies has no transcript for, instead of importing nothing", async () => {
    const { fetch } = stub([{ data: { transcript: null } }]);
    await expect(client(fetch).fetchTranscript("gone")).rejects.toThrow(FirefliesError);
  });

  it("reports a recorded meeting with no words in it", async () => {
    // An empty transcript would save as a call nobody can extract from, and the
    // failure would surface two screens later as "cannot extract from an empty
    // transcript" with nothing naming the cause.
    const { fetch } = stub([{ data: { transcript: { id: "m1", sentences: [] } } }]);
    await expect(client(fetch).fetchTranscript("m1")).rejects.toThrow(/no transcript/i);
  });
});

describe("failures arrive typed", () => {
  it("rejects a malformed response at the boundary instead of propagating undefined", async () => {
    const { fetch } = stub([{ data: { transcripts: [{ id: 42 }] } }]);
    await expect(client(fetch).listMeetings()).rejects.toThrow(FirefliesError);
  });

  it("rejects a response missing the field it asked for", async () => {
    const { fetch } = stub([{ data: {} }]);
    await expect(client(fetch).listMeetings()).rejects.toThrow(FirefliesError);
  });

  /**
   * GraphQL reports its errors inside a 200 body, so the tempting handler is one
   * that stringifies the response — or the request beside it — into the message.
   * Either would put the workspace's credential in front of a PM and into
   * whatever logs the error reaches.
   */
  it("names a GraphQL error without quoting the credential or the request", async () => {
    const { fetch } = stub([
      { data: null, errors: [{ message: "Please login to access this resource" }] },
    ]);

    let failure: Error | undefined;
    try {
      await client(fetch).listMeetings();
    } catch (e) {
      failure = e as Error;
    }

    expect(failure).toBeInstanceOf(FirefliesError);
    expect(failure?.message).toMatch(/Please login/);
    for (const secret of [KEY, "Bearer", "Authorization", "transcripts("]) {
      expect(failure?.message).not.toContain(secret);
    }
  });

  it("explains a rejected key rather than reporting an unhandled fetch failure", async () => {
    const { fetch } = stub([{}], 401);
    await expect(client(fetch).listMeetings()).rejects.toThrow(/FIREFLIES_API_KEY is not valid/);
  });

  it("keeps the credential out of every status message", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const message = describeFirefliesFailure(status, ["Please login to access this resource"]);
      expect(message, String(status)).not.toContain(KEY);
      expect(message.length, String(status)).toBeGreaterThan(0);
    }
  });

  it("says a rate limit and an outage are worth retrying", () => {
    for (const status of [429, 500, 503]) {
      expect(describeFirefliesFailure(status, []), String(status)).toMatch(/again/);
    }
  });

  it("reports a dropped connection as a Fireflies failure", async () => {
    const fetch: FirefliesFetch = async () => {
      throw new Error("fetch failed");
    };
    await expect(client(fetch).listMeetings()).rejects.toThrow(/could not reach Fireflies/);
  });

  it("refuses to build a client with no credential configured", () => {
    // The suite runs with FIREFLIES_API_KEY pinned empty, so this is the state a
    // deployment that never set the variable is in.
    expect(() => createFirefliesClient()).toThrow(FirefliesError);
    expect(() => createFirefliesClient()).toThrow(/FIREFLIES_API_KEY/);
  });

  it("builds once the credential is present", () => {
    vi.stubEnv("FIREFLIES_API_KEY", KEY);
    expect(() => createFirefliesClient()).not.toThrow();
    vi.unstubAllEnvs();
  });
});

/**
 * The date range (R22's other half).
 *
 * Search narrows by who and what; this narrows by when. The arguments are built
 * into the query rather than declared always-present, because a declared-but-null
 * GraphQL variable is not the same request as an absent argument — and this is
 * the one part of the query never exercised against a live key.
 */
describe("narrowing by when a call was recorded", () => {
  it("sends neither date argument when neither bound is set", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [] } }]);
    await client(fetch).listMeetings();

    expect(sent[0].query).not.toMatch(/fromDate/);
    expect(sent[0].query).not.toMatch(/toDate/);
    expect(sent[0].variables).toEqual({ limit: MAX_PAGE_SIZE, skip: 0 });
  });

  it("sends only the bound that was set, so one-sided ranges stay one-sided", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [] } }]);
    await client(fetch).listMeetings({ fromDate: "2026-07-01" });

    expect(sent[0].query).toMatch(/\$fromDate: DateTime/);
    expect(sent[0].query).toMatch(/fromDate: \$fromDate/);
    // The absent bound must not travel as an explicit null.
    expect(sent[0].query).not.toMatch(/toDate/);
    expect(sent[0].variables).toEqual({ limit: MAX_PAGE_SIZE, skip: 0, fromDate: "2026-07-01" });
  });

  it("sends both bounds, and applies them to a search's two branches alike", async () => {
    const { fetch, sent } = stub([{ data: { byTitle: [], byParticipant: [] } }]);
    await client(fetch).listMeetings({
      search: "aparna",
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
    });

    const byTitle = /byTitle: transcripts\(([^)]*)\)/.exec(sent[0].query)![1];
    const byParticipant = /byParticipant: transcripts\(([^)]*)\)/.exec(sent[0].query)![1];
    for (const args of [byTitle, byParticipant]) {
      expect(args).toMatch(/fromDate: \$fromDate/);
      expect(args).toMatch(/toDate: \$toDate/);
    }
    expect(sent[0].variables.fromDate).toBe("2026-07-01");
    expect(sent[0].variables.toDate).toBe("2026-07-31");
  });
});

/**
 * Whether more exists is Fireflies' answer, not an inference from the row count.
 *
 * A search runs two filtered selections merged and de-duplicated, so a full page
 * from Fireflies can reach the caller as a short list. Reading that short list as
 * "the end of the archive" is what hid matches behind a control that had already
 * disappeared.
 */
describe("saying whether there is more", () => {
  it("reports more when an unfiltered page comes back full", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => meeting({ id: `m${i}` }));
    const { fetch } = stub([{ data: { transcripts: rows } }]);
    const page = await client(fetch).listMeetings({ limit: 3 });

    expect(page.meetings).toHaveLength(3);
    expect(page.hasMore).toBe(true);
  });

  it("reports no more when an unfiltered page comes back short", async () => {
    const { fetch } = stub([{ data: { transcripts: [meeting()] } }]);
    expect((await client(fetch).listMeetings({ limit: 3 })).hasMore).toBe(false);
  });

  it("reports more when one search branch is full, even if the merge is short", async () => {
    // Both branches full and identical: two pages of results that merge to two
    // rows. The merged count says "short"; the branches say "there is more".
    const both = [meeting({ id: "a" }), meeting({ id: "b" })];
    const { fetch } = stub([{ data: { byTitle: both, byParticipant: both } }]);
    const page = await client(fetch).listMeetings({ search: "halten", limit: 2 });

    expect(page.meetings.map((m) => m.id)).toEqual(["a", "b"]);
    expect(page.hasMore).toBe(true);
  });

  it("keeps every unique match instead of trimming the union to one page", async () => {
    // Two disjoint full branches. Trimming to `limit` used to discard the second
    // branch's rows — and the caller pages by skip, so they were never asked for
    // again. Search is the only way to find a call, so a dropped match is lost.
    const { fetch } = stub([
      {
        data: {
          byTitle: [meeting({ id: "t1" }), meeting({ id: "t2" })],
          byParticipant: [meeting({ id: "p1" }), meeting({ id: "p2" })],
        },
      },
    ]);
    const page = await client(fetch).listMeetings({ search: "halten", limit: 2 });

    expect(page.meetings.map((m) => m.id).sort()).toEqual(["p1", "p2", "t1", "t2"]);
    expect(page.hasMore).toBe(true);
  });
});

describe("bounding how long Fireflies may take", () => {
  it("carries an abort signal on every request", async () => {
    const { fetch, sent } = stub([{ data: { transcripts: [] } }]);
    await client(fetch).listMeetings();

    expect(sent[0].signal).toBeInstanceOf(AbortSignal);
    expect(sent[0].signal!.aborted).toBe(false);
  });

  it("bounds the transcript fetch too, which is the slow one", async () => {
    const { fetch, sent } = stub([
      { data: { transcript: { id: "m1", sentences: [{ speaker_name: "A", text: "hi" }] } } },
    ]);
    await client(fetch).fetchTranscript("m1");

    expect(sent[0].signal).toBeInstanceOf(AbortSignal);
  });

  /**
   * A timeout is not a dropped connection, and the difference matters to the PM
   * reading it: one says wait and retry, the other says the network failed. The
   * function is killed at 60s on Vercel, so an unbounded request returns React's
   * generic render error with no cause at all — the failure this prevents.
   */
  it("names the timeout rather than reporting a failed connection", async () => {
    const timedOut: FirefliesFetch = async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    };

    await expect(client(timedOut).listMeetings()).rejects.toThrow(FirefliesError);
    await expect(client(timedOut).listMeetings()).rejects.toThrow(/did not answer within/i);
  });

  it("keeps the credential out of a timeout message", async () => {
    const timedOut: FirefliesFetch = async () => {
      const e = new Error("aborted");
      e.name = "TimeoutError";
      throw e;
    };

    await expect(client(timedOut).listMeetings()).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(KEY) }),
    );
  });

  it("is bounded at the same ceiling the extraction path answers to", () => {
    expect(FIREFLIES_TIMEOUT_MS).toBe(30_000);
  });
});
