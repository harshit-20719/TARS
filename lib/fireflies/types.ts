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
   */
  search?: string;
  /** Capped at MAX_PAGE_SIZE, which is Fireflies' own limit. */
  limit?: number;
  skip?: number;
}

/**
 * The two operations the app needs. Injected wherever it is used, so tests run
 * with no key and reach no network (KTD4).
 */
export interface FirefliesClient {
  listMeetings(options?: ListMeetingsOptions): Promise<FirefliesMeeting[]>;
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
