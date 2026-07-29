/**
 * What lib/fireflies lets out.
 *
 * The module is a boundary, and the precedent for a boundary here is
 * lib/extraction rather than lib/repo: the wire shapes stay inside. Fireflies'
 * GraphQL envelope and, above all, the `sentences` array never leave — format.ts
 * collapses the sentences to a string on the way out (KTD2). What does cross is
 * this one meeting record, because the picker has to render something, and one
 * plain record is the whole of that contract.
 *
 * The credential is not in here either. It is read from the environment on the
 * server and used by client.ts; nothing that reaches the browser carries it, and
 * nothing here would let it (KTD10).
 */

/** One meeting as the rest of TARS sees it. */
export interface FirefliesMeeting {
  id: string;
  /**
   * Empty where Fireflies has no title. That is survivable rather than broken:
   * a meeting is identified by its participants and its date (R22), because the
   * titles in the workspace follow no convention.
   */
  title: string;
  /** As Fireflies records them — addresses, in practice. Empty when it has none. */
  participants: string[];
  /** ISO 8601, or null where Fireflies did not date the recording. */
  date: string | null;
  /** Minutes, which is the unit Fireflies reports. Null where it reports none. */
  durationMinutes: number | null;
}

export interface ListMeetingsOptions {
  /**
   * Matched by Fireflies against the meeting title and its participants, not
   * here. There is no scope option beside it: Biome records every call on one
   * shared account, so `host_email` is identical across the workspace and there
   * is no per-person filter to offer (R11). Paging and search are the whole of
   * finding a call.
   *
   * Settled 2026-07-29 against the shared account's key: this matches a
   * participant's **name**, not only their address, so R22 and AE7 hold as
   * written and a PM can find `Biome <> Aparna` by typing "Aparna".
   */
  search?: string;
  /**
   * Inclusive bounds on the recording date, as `YYYY-MM-DD`.
   *
   * Search narrows by *who and what*; this narrows by *when*, and the two are
   * independent — one shared account holding every call the firm has recorded
   * makes "the week we met them" the other thing a PM actually remembers. Either
   * bound stands alone: a `from` with no `to` is everything since, and the
   * reverse is everything up to.
   */
  fromDate?: string;
  toDate?: string;
  /**
   * Which side of the search to run.
   *
   * `both` is the default and the reason paging is approximate: it runs two
   * filtered selections and merges them, so neither branch's count survives to
   * the caller. Narrowing to one branch makes the page exact — one selection,
   * one count — which is why this is worth offering rather than hiding.
   */
  searchField?: SearchField;
  /**
   * Orders the page that came back, **not** the archive.
   *
   * Fireflies decides which meetings land in a page; this decides how they read
   * once they have. Asking for oldest-first does not walk the archive backwards,
   * and the picker says so rather than implying it.
   */
  sort?: SortOrder;
  /** Capped at MAX_PAGE_SIZE, which is Fireflies' own limit. */
  limit?: number;
  skip?: number;
}

export type SearchField = "both" | "title" | "participants";

export type SortOrder = "newest" | "oldest";

/**
 * One page of meetings, and whether asking again could return more.
 *
 * `hasMore` is a returned fact rather than something the caller infers from
 * `meetings.length`, and that distinction is the whole reason this type exists.
 * A search runs as two filtered selections merged and de-duplicated, so a full
 * page from Fireflies can arrive here as forty rows — and a caller counting
 * those rows would conclude the archive was exhausted while a branch still had
 * fifty more waiting. Only the client can see the per-branch counts that answer
 * the question, so only the client answers it.
 */
export interface MeetingPage {
  meetings: FirefliesMeeting[];
  hasMore: boolean;
}

/**
 * The two operations the app needs. Injected wherever it is used, so tests run
 * with no key and reach no network (KTD4).
 */
export interface FirefliesClient {
  listMeetings(options?: ListMeetingsOptions): Promise<MeetingPage>;
  /** The meeting's transcript, flattened to text with its speakers named (R13). */
  fetchTranscript(meetingId: string): Promise<string>;
}

/**
 * Declared beside the contract rather than beside the fetch, so lib/actions.ts
 * can recognise a Fireflies failure without importing the network client. That
 * matters more than it sounds: `toResult` rethrows what it does not recognise,
 * and an unrecognised error reaches the PM as React's generic render failure
 * with the message stripped — see describeApiFailure in lib/extraction/extract.ts
 * for the same argument made about the Anthropic SDK.
 */
export class FirefliesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirefliesError";
  }
}
