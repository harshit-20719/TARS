/**
 * Fireflies gives a transcript back as a list of diarised sentences. This turns
 * that list into the one thing the rest of TARS understands: a block of text.
 *
 * It is its own module because it is pure — no key, no network, nothing to stub —
 * and because it carries the rule R13 depends on, which deserves to be provable
 * on its own.
 *
 * **The line shape is load-bearing.** `lib/extraction/prompt.ts` tells the model
 * to attribute a speaker when the transcript names one and to use null when it
 * does not. What it reads as naming one is the `Name: said this` line that every
 * pasted transcript already uses (mock/data.ts is the reference). So a sentence
 * Fireflies attributed is written that way and a sentence it did not is written
 * bare — the extractor then sees names in exactly the places Fireflies put them,
 * and `Observation.speaker` carries them the rest of the way.
 *
 * The other half of that rule matters as much: an unattributed sentence gets no
 * prefix at all. Filling in "Speaker 1" or the meeting host would be inventing an
 * attribution the recording never made, which is the failure AE4 names — an
 * imported transcript with no names must draft observations with no speaker,
 * exactly as a pasted one does.
 */

/**
 * One sentence as Fireflies sends it, in Fireflies' own field names.
 *
 * Declared here rather than imported from schema.ts so this module stays free of
 * everything but the rule. It is the wire shape either way, which is why neither
 * it nor the array it comes in leaves lib/fireflies (KTD2).
 */
export interface FirefliesSentence {
  speaker_name?: string | null;
  text?: string | null;
}

/** Sentences in, one transcript out, speakers named where Fireflies named them. */
export function flattenTranscript(sentences: readonly FirefliesSentence[]): string {
  return sentences
    .map((s) => {
      const text = s.text?.trim() ?? "";
      // A sentence with no words is a diarisation artefact. Kept, it would write
      // a bare "Aparna:" line — a speaker attached to nothing said.
      if (!text) return null;

      // An empty speaker_name means diarisation ran and named nobody, which is
      // the same state as its absence.
      const speaker = s.speaker_name?.trim() ?? "";
      return speaker ? `${speaker}: ${text}` : text;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
}
