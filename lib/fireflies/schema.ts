/**
 * What Fireflies is allowed to have sent.
 *
 * Everything here describes the wire, in Fireflies' own field names, and none of
 * it is exported past lib/fireflies (KTD2). The point is the same one
 * lib/extraction/schema.ts makes about the model's output: a response that does
 * not match fails here, at the boundary, with a typed error naming the field —
 * rather than becoming an undefined that surfaces three layers later as a blank
 * meeting in a picker or a call saved with no transcript.
 *
 * The optionality is deliberate rather than lazy. A meeting with no title, no
 * participants, no duration or no date is a real state of the API — a recording
 * that never got named, an ad-hoc call — and refusing to list it would hide a
 * meeting the PM can see in Fireflies itself. An `id` that is not a string is a
 * different matter: nothing can be done with that, so it fails.
 */

import * as z from "zod";

const MeetingSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  /**
   * Fireflies documents this as a number of epoch milliseconds, and some
   * responses carry an ISO string instead. Both are accepted and normalised on
   * the way out, because guessing wrong here would fail every list request.
   */
  date: z.union([z.number(), z.string()]).nullish(),
  /** Minutes. */
  duration: z.number().nullish(),
  participants: z.array(z.string()).nullish(),
});

export type FirefliesMeetingWire = z.infer<typeof MeetingSchema>;

/** The unfiltered list. */
export const MeetingListSchema = z.object({
  transcripts: z.array(MeetingSchema),
});

/**
 * A search, which asks Fireflies the same question twice in one request — once
 * against the title and once against the participants — because a meeting is
 * identified by who was on it (R22) and the API has no single argument spanning
 * both. Both branches are required: a response missing one is a response whose
 * result set is silently half the answer.
 */
export const MeetingSearchSchema = z.object({
  byTitle: z.array(MeetingSchema),
  byParticipant: z.array(MeetingSchema),
});

export const TranscriptSchema = z.object({
  transcript: z
    .object({
      id: z.string(),
      sentences: z
        .array(
          z.object({
            speaker_name: z.string().nullish(),
            text: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

/**
 * The GraphQL envelope, read loosely and on purpose.
 *
 * It is parsed before the operation's own schema so that a request Fireflies
 * refused is reported as what it is. GraphQL puts its errors in the body of a
 * 200, so without this step a rejected credential would arrive as "expected an
 * array, received undefined" — a validation error about the wrong thing.
 */
export const EnvelopeSchema = z.object({
  data: z.unknown().nullish(),
  errors: z.array(z.object({ message: z.string().nullish() })).nullish(),
});
