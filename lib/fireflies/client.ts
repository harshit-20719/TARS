/**
 * Fireflies, reached over its GraphQL API (KTD1).
 *
 * Not the Fireflies MCP server: MCP needs a client and a host process to speak
 * to, and TARS imports from server-side code on Vercel serverless where no such
 * process exists. One authenticated fetch, no new runtime dependency.
 *
 * Three things this module is careful about.
 *
 * **The client is injected**, the way the Anthropic client is, so the suite runs
 * with no credential and reaches no network (KTD4). Nothing here is a
 * module-level singleton; `createFirefliesClient` is called where it is used.
 *
 * **The credential stays on the server** (KTD10). It is read from
 * FIREFLIES_API_KEY — deliberately without a `NEXT_PUBLIC_` prefix, which is the
 * one path by which Next would inline it into the browser bundle — and it never
 * appears in a message this module throws. That is a live risk rather than a
 * theoretical one: GraphQL reports its errors inside a 200 body, so the obvious
 * handler is one that stringifies the response, and the request sitting next to
 * it carries the Authorization header.
 *
 * **Every response is validated** before anything reads it (schema.ts), so a
 * change at Fireflies' end fails here with a message naming the field rather
 * than becoming an undefined that surfaces as a blank row in the picker.
 *
 * The list is the whole workspace, and there is nothing to narrow it with: Biome
 * records every call on one shared account, so `host_email` is identical for
 * every meeting (R11). Paging and search carry the entire load of finding a call.
 */

import { flattenTranscript } from "./format";
import {
  EnvelopeSchema,
  MeetingListSchema,
  MeetingSearchSchema,
  TranscriptSchema,
  type FirefliesMeetingWire,
} from "./schema";
import {
  FirefliesError,
  type FirefliesClient,
  type FirefliesMeeting,
  type ListMeetingsOptions,
  type MeetingPage,
} from "./types";
import type * as z from "zod";

export const FIREFLIES_API_URL = "https://api.fireflies.ai/graphql";

/** Fireflies' own ceiling on `limit`. Asking for more is an error, not a bigger page. */
export const MAX_PAGE_SIZE = 50;

/**
 * How long one GraphQL round trip may take before it is abandoned.
 *
 * listMeetings and fetchTranscript both run inside a server action invoked from
 * a page capped at maxDuration = 60 (app/deals/[dealId]/transcript/page.tsx) —
 * Vercel's free-tier ceiling. Past that limit the function is killed rather than
 * returning, so no error object ever reaches the handling in lib/actions.ts and
 * the browser gets React's generic "an error occurred in the Server Components
 * render" with the real cause stripped. The long comment on BLOCK_TIMEOUT_MS
 * (lib/extraction/extract.ts) makes the same argument for the same ceiling.
 * Left alone, a plain fetch has nothing bounding it at all — it waits exactly as
 * long as Fireflies takes — so a slow response would reintroduce that failure,
 * and a full transcript fetch is the slowest call this app makes.
 *
 * Sized to match BLOCK_TIMEOUT_MS rather than to some Fireflies-specific budget:
 * both answer to the same sixty-second ceiling, so there is no reason for them
 * to disagree.
 */
export const FIREFLIES_TIMEOUT_MS = 30_000;

/**
 * The slice of fetch this module uses. Narrow on purpose, following the
 * ExtractionClient precedent: a test stub is four lines rather than a mock of
 * Request and Response.
 */
export type FirefliesFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    /** Carries the FIREFLIES_TIMEOUT_MS ceiling; optional so existing stubs still typecheck. */
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * What the list needs to render a meeting a PM can recognise (R22), and nothing
 * more. The sentences are conspicuously absent: pulling every transcript's text
 * to draw a picker would be minutes of waiting for a list of titles.
 */
const MEETING_FIELDS = "id title date duration participants";

/**
 * The date bounds, added to a query only when one is actually set.
 *
 * Built rather than hardcoded so the unfiltered query stays byte-identical to
 * the one already proven against the live account. A declared-but-null variable
 * is not the same request as an absent argument — some servers read the
 * explicit null as a bound of null rather than as no bound — and this is the
 * one part of the query that has never been exercised against a real key. The
 * safe shape is to send nothing when there is nothing to send.
 */
function dateClauses(o: { fromDate?: string; toDate?: string }): {
  decl: string;
  args: string;
} {
  const decl: string[] = [];
  const args: string[] = [];
  if (o.fromDate) {
    decl.push("$fromDate: DateTime");
    args.push("fromDate: $fromDate");
  }
  if (o.toDate) {
    decl.push("$toDate: DateTime");
    args.push("toDate: $toDate");
  }
  return {
    decl: decl.length ? `, ${decl.join(", ")}` : "",
    args: args.length ? `, ${args.join(", ")}` : "",
  };
}

function listQuery(o: { fromDate?: string; toDate?: string }): string {
  const { decl, args } = dateClauses(o);
  return `query TarsMeetings($limit: Int!, $skip: Int!${decl}) {
  transcripts(limit: $limit, skip: $skip${args}) { ${MEETING_FIELDS} }
}`;
}

/**
 * A search asks the same question twice in one request, because a meeting is
 * identified by who was on it rather than by its title (R22) and the API has no
 * single argument covering both. The two branches are merged and de-duplicated
 * on the way out.
 *
 * Settled 2026-07-29 against the shared account's key: `participant_email`
 * matches a participant's **name** as well as their address, which is what AE7
 * needs — a meeting titled `Biome <> Aparna` is found by searching the founder's
 * name. The argument is address-shaped in the documentation and turns out not to
 * be address-only in practice. This matters more than a convenience: R11 dropped
 * the scoped list, so search is the only way to find a call in an archive of
 * everything the firm has recorded.
 */
function searchQuery(o: { fromDate?: string; toDate?: string }): string {
  const { decl, args } = dateClauses(o);
  return `query TarsMeetingSearch($limit: Int!, $skip: Int!, $search: String!${decl}) {
  byTitle: transcripts(title: $search, limit: $limit, skip: $skip${args}) { ${MEETING_FIELDS} }
  byParticipant: transcripts(participant_email: $search, limit: $limit, skip: $skip${args}) { ${MEETING_FIELDS} }
}`;
}

const TRANSCRIPT_QUERY = `query TarsTranscript($id: String!) {
  transcript(id: $id) { id sentences { speaker_name text } }
}`;

/**
 * Turn a Fireflies failure into something a PM can act on.
 *
 * The mapping matters as much as the error class. lib/actions.ts converts typed
 * domain failures into values and rethrows the rest, so an unrecognised error
 * escapes the server action and React renders its generic message with the real
 * one stripped — which is precisely where a mistyped key would land without
 * this. The same argument is made at length in describeApiFailure
 * (lib/extraction/extract.ts).
 *
 * Fireflies' own explanation is passed through because it names the problem.
 * Nothing else from the exchange is: not the query, not the variables, and above
 * all not the headers.
 *
 * `status: "timeout"` is deliberately its own case rather than folding into the
 * `null` branch at the bottom: `null` there means the connection failed outright,
 * and a PM who waited out FIREFLIES_TIMEOUT_MS did not get a failed connection —
 * they got no answer in time. Collapsing the two back into one "could not reach
 * Fireflies" message would erase the one distinction this case exists to draw.
 */
export function describeFirefliesFailure(
  status: number | null | "timeout",
  messages: string[],
): string {
  const said = messages.length ? ` Fireflies said: ${messages.join("; ")}` : "";

  if (status === "timeout") {
    return `Fireflies did not answer within ${FIREFLIES_TIMEOUT_MS / 1000} seconds, so nothing was imported.${said}`;
  }

  switch (status) {
    case 400:
      return `Fireflies rejected the request.${said}`;
    case 401:
      return `the FIREFLIES_API_KEY is not valid, so no meetings were read.${said}`;
    case 403:
      return `that Fireflies key is not permitted to read this workspace.${said}`;
    case 404:
      return `Fireflies has nothing at ${FIREFLIES_API_URL} — check the endpoint.${said}`;
    case 429:
      return `rate limited by Fireflies — nothing was imported, so try again in a moment.${said}`;
    default:
      break;
  }
  if (typeof status === "number") {
    if (status >= 500) return `Fireflies is unavailable right now — try again.${said}`;
    if (status >= 400) return `Fireflies refused the request (HTTP ${status}).${said}`;
    // A 200 carrying an errors array, which is how GraphQL reports most refusals.
    return `Fireflies refused the request.${said}`;
  }
  // No status at all: the connection failed, or fetch threw before sending.
  return `could not reach Fireflies, so nothing was imported.${said}`;
}

function resolveApiKey(injected?: string): string {
  const key = (injected ?? process.env.FIREFLIES_API_KEY ?? "").trim();
  if (!key) {
    throw new FirefliesError(
      "FIREFLIES_API_KEY is not set — importing from Fireflies cannot run. See docs/runbooks/deploy-vercel.md.",
    );
  }
  return key;
}

function messageOf(e: unknown): string {
  const message = (e as { message?: unknown })?.message;
  return typeof message === "string" ? message : "";
}

/**
 * True for what a timed-out fetch throws. `AbortSignal.timeout()` rejects with
 * a DOMException named "TimeoutError"; an AbortController fired some other way
 * rejects with "AbortError" — both are checked since either reaching here can
 * only mean the ceiling in graphql() was hit, this module never accepts an
 * external signal that could abort for its own reasons.
 *
 * Checked by `name` rather than `instanceof DOMException`, matching messageOf
 * just above: a test stub throwing a plain object shaped like the real thing
 * should be treated the same as the real thing, and `instanceof` would refuse it.
 */
function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Validate one operation's payload, and name the field that did not match.
 *
 * The issue paths travel; the body does not. What Fireflies sent is a recording
 * of a founder call, and this message ends up on a screen and in a log.
 */
function parseData<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const where = result.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "response"}: ${i.message}`)
    .join("; ");
  throw new FirefliesError(`Fireflies sent a ${what} TARS could not read — ${where}`);
}

export function createFirefliesClient(
  deps: { apiKey?: string; fetch?: FirefliesFetch } = {},
): FirefliesClient {
  // Resolved at construction, so a deployment with no credential fails with this
  // rather than with whatever an unauthenticated request comes back as.
  const apiKey = resolveApiKey(deps.apiKey);
  const fetchImpl = deps.fetch ?? fetch;

  async function graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    let response: Awaited<ReturnType<FirefliesFetch>>;
    try {
      response = await fetchImpl(FIREFLIES_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        // See FIREFLIES_TIMEOUT_MS just above: bounds this call to the same
        // ceiling the extraction path next door already answers to.
        signal: AbortSignal.timeout(FIREFLIES_TIMEOUT_MS),
      });
    } catch (e) {
      if (isTimeout(e)) {
        // Hitting the ceiling is not the same failure as a dropped connection —
        // a PM who waited FIREFLIES_TIMEOUT_MS out should be told it timed out,
        // not that the network failed, so this gets its own status rather than
        // falling into the generic `null` branch below.
        throw new FirefliesError(describeFirefliesFailure("timeout", []));
      }
      // Anything else thrown here is a transport failure the timeout above did
      // not cause. Only what it said travels — not what was sent.
      throw new FirefliesError(describeFirefliesFailure(null, [messageOf(e)].filter(Boolean)));
    }

    const body = await response.json().catch(() => undefined);
    const envelope = EnvelopeSchema.safeParse(body);
    const messages = envelope.success
      ? (envelope.data.errors ?? []).map((e) => e.message?.trim() ?? "").filter(Boolean)
      : [];

    if (!response.ok || messages.length) {
      throw new FirefliesError(describeFirefliesFailure(response.status, messages));
    }
    if (!envelope.success) {
      throw new FirefliesError("Fireflies sent a response that is not GraphQL at all.");
    }
    return envelope.data.data;
  }

  async function listMeetings(options: ListMeetingsOptions = {}): Promise<MeetingPage> {
    const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? MAX_PAGE_SIZE)), MAX_PAGE_SIZE);
    const skip = Math.max(0, Math.trunc(options.skip ?? 0));
    const search = options.search?.trim() ?? "";
    const bounds = { fromDate: options.fromDate?.trim(), toDate: options.toDate?.trim() };
    const vars = {
      limit,
      skip,
      ...(bounds.fromDate ? { fromDate: bounds.fromDate } : {}),
      ...(bounds.toDate ? { toDate: bounds.toDate } : {}),
    };

    if (!search) {
      const data = await graphql(listQuery(bounds), vars);
      const rows = parseData(MeetingListSchema, data, "meeting list").transcripts;
      // One branch, so a full page is the whole of the question.
      return { meetings: rows.map(toMeeting), hasMore: rows.length === limit };
    }

    const data = await graphql(searchQuery(bounds), { ...vars, search });
    const { byTitle, byParticipant } = parseData(MeetingSearchSchema, data, "search result");
    return {
      meetings: mergeBranches([...byTitle, ...byParticipant].map(toMeeting)),
      /**
       * Either branch coming back full means Fireflies still has matches behind
       * it, whatever the merged count looks like. Reading the merged length
       * instead is the bug this replaces: two branches returning fifty each,
       * overlapping heavily, merge to a short list that looks like the end of
       * the archive while a hundred rows sit unread.
       */
      hasMore: byTitle.length === limit || byParticipant.length === limit,
    };
  }

  async function fetchTranscript(meetingId: string): Promise<string> {
    const data = await graphql(TRANSCRIPT_QUERY, { id: meetingId });
    const { transcript } = parseData(TranscriptSchema, data, "transcript");

    if (!transcript) {
      throw new FirefliesError(`Fireflies has no meeting with the id ${meetingId}.`);
    }

    const text = flattenTranscript(transcript.sentences ?? []);
    if (!text) {
      /**
       * Refused here rather than returned empty. An empty import would save as a
       * call nobody can extract from, and the failure would surface two screens
       * later as "cannot extract from an empty transcript" with nothing naming
       * the cause.
       */
      throw new FirefliesError(
        "that meeting has no transcript yet — Fireflies recorded it but transcribed nothing.",
      );
    }
    return text;
  }

  return { listMeetings, fetchTranscript };
}

function toMeeting(m: FirefliesMeetingWire): FirefliesMeeting {
  return {
    id: m.id,
    title: m.title?.trim() ?? "",
    participants: m.participants ?? [],
    date: toIsoDate(m.date),
    durationMinutes: m.duration ?? null,
  };
}

/** Fireflies dates a recording in epoch milliseconds; some responses use ISO. */
function toIsoDate(date: number | string | null | undefined): string | null {
  if (date === null || date === undefined) return null;
  if (typeof date === "string") return date;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Fold the two search branches into one list.
 *
 * A meeting matching on both its title and its participants comes back twice, so
 * ids are de-duplicated. The order has to be re-established because two merged
 * lists have none: newest first, matching how Fireflies returns an unfiltered
 * page.
 *
 * Deliberately **not** capped to the page size. Trimming the union threw away
 * meetings Fireflies had already found and returned — and the caller pages by
 * asking for the next `skip`, so a row dropped here was never asked for again.
 * Handing back up to twice the page size beats silently losing a match in an
 * archive where search is the only way to find anything.
 */
function mergeBranches(meetings: FirefliesMeeting[]): FirefliesMeeting[] {
  const byId = new Map<string, FirefliesMeeting>();
  for (const m of meetings) if (!byId.has(m.id)) byId.set(m.id, m);

  return [...byId.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
