import { describe, expect, it } from "vitest";
import { flattenTranscript } from "./format";

describe("flattening a Fireflies transcript", () => {
  it("prefixes every sentence with the speaker Fireflies named, in order", () => {
    const text = flattenTranscript([
      { speaker_name: "Aparna", text: "We spent four years inside mid-market bank operations." },
      { speaker_name: "Daniel", text: "The ledger engine reconciles both feeds in a single pass." },
      { speaker_name: "Aparna", text: "Two of those banks will run a paid pilot." },
    ]);

    expect(text).toBe(
      [
        "Aparna: We spent four years inside mid-market bank operations.",
        "Daniel: The ledger engine reconciles both feeds in a single pass.",
        "Aparna: Two of those banks will run a paid pilot.",
      ].join("\n"),
    );
  });

  /**
   * Covers AE4. An unattributed recording must import exactly as a pasted
   * transcript with no names does — the extractor is told to use null when the
   * transcript does not say who spoke, so anything invented here becomes a
   * speaker on an observation that nobody actually said.
   */
  it("leaves an unattributed sentence bare rather than inventing a speaker", () => {
    const text = flattenTranscript([
      { speaker_name: null, text: "We spent four years inside mid-market bank operations." },
      { text: "The ledger engine reconciles both feeds in a single pass." },
    ]);

    expect(text).toBe(
      [
        "We spent four years inside mid-market bank operations.",
        "The ledger engine reconciles both feeds in a single pass.",
      ].join("\n"),
    );
    expect(text).not.toMatch(/:/);
  });

  it("keeps the distinction per sentence when only some are attributed", () => {
    const text = flattenTranscript([
      { speaker_name: "Aparna", text: "We spent four years inside bank operations." },
      { speaker_name: null, text: "Right, and the break shows up at cutover." },
      { speaker_name: "Daniel", text: "Nightly jobs are why nobody sees it." },
    ]);

    expect(text.split("\n")).toEqual([
      "Aparna: We spent four years inside bank operations.",
      "Right, and the break shows up at cutover.",
      "Daniel: Nightly jobs are why nobody sees it.",
    ]);
  });

  it("treats a blank speaker name as no attribution", () => {
    // Fireflies returns an empty string where diarisation ran but named nobody,
    // which is the same state as null and must not produce a ": " prefix.
    expect(flattenTranscript([{ speaker_name: "   ", text: "Nobody was named here." }])).toBe(
      "Nobody was named here.",
    );
  });

  it("drops a sentence with no words, so a named speaker never gets an empty line", () => {
    const text = flattenTranscript([
      { speaker_name: "Aparna", text: "" },
      { speaker_name: "Daniel", text: "   " },
      { speaker_name: "Aparna", text: "Only this one was said." },
    ]);

    expect(text).toBe("Aparna: Only this one was said.");
  });

  it("returns an empty string for a recording with no sentences", () => {
    // A meeting that Fireflies recorded but never transcribed. The caller decides
    // what to do with nothing; this returns nothing rather than throwing.
    expect(flattenTranscript([])).toBe("");
  });

  /**
   * R13 rides on this shape, not on the words. lib/extraction/prompt.ts tells the
   * model to "attribute the speaker when the transcript names one", and what it
   * recognises as naming one is the "Name: said this" line that every pasted
   * transcript in use already follows (see mock/data.ts). A different separator
   * would flatten cleanly and quietly cost every imported observation its speaker.
   */
  it("writes the line shape the extraction prompt already reads as a name", () => {
    const line = flattenTranscript([{ speaker_name: "Aparna", text: "Four years in banking." }]);
    expect(line).toMatch(/^Aparna: /);
  });
});
