import { describe, expect, it } from "vitest";
import { RUBRICS } from "@/framework";
import { systemPromptFor } from "./prompt";

/**
 * What tuning may and may not reach (KTD12, KTD14).
 *
 * The prompt used to be wholly derived from committed config, which is what
 * guaranteed it could not drift from framework/rubrics.ts. Admin tuning trades
 * half of that away deliberately — so these pin exactly which half. A persona
 * and a guidance note are seasoning around the job; the rows, the two parts of
 * the work, and the authorship rule are not reachable from the admin page at
 * all, and an untuned deployment gets byte-for-byte what it got before tuning
 * existed.
 */

const block = RUBRICS[0];

describe("an untuned prompt", () => {
  it("is byte-identical whether tuning is absent, empty, or blank", () => {
    const base = systemPromptFor(block);

    expect(systemPromptFor(block, {})).toBe(base);
    expect(systemPromptFor(block, { persona: "", guidance: "" })).toBe(base);
    // Whitespace is not a tuning: it must not open a gap in the prompt either.
    expect(systemPromptFor(block, { persona: "   ", guidance: "\n\n" })).toBe(base);
  });

  it("still opens on the framework's own identity line", () => {
    expect(systemPromptFor(block).startsWith("You extract evidence")).toBe(true);
  });
});

describe("a tuned prompt", () => {
  const persona = "An operator who has shipped in this category.";
  const guidance = "Prefer a named customer over a claim about demand.";

  it("puts the persona ahead of the identity line", () => {
    const prompt = systemPromptFor(block, { persona });

    expect(prompt.startsWith(persona)).toBe(true);
    // And the framework's own opening still follows it, unchanged.
    expect(prompt).toContain("You extract evidence from venture-capital founder call transcripts");
    expect(prompt.indexOf(persona)).toBeLessThan(prompt.indexOf("You extract evidence"));
  });

  it("puts the guidance ahead of the prohibitions, not inside them", () => {
    const prompt = systemPromptFor(block, { guidance });

    expect(prompt).toContain(guidance);
    expect(prompt.indexOf(guidance)).toBeLessThan(prompt.indexOf("WHAT YOU MUST NOT DO."));
  });

  it("leaves the rows, the job, and the authorship rule untouched", () => {
    const base = systemPromptFor(block);
    const tuned = systemPromptFor(block, { persona, guidance });

    // Everything the framework generates survives verbatim.
    for (const sub of block.subs) expect(tuned).toContain(sub.key);
    expect(tuned).toContain("THE ROWS IN THIS BLOCK");
    expect(tuned).toContain("You do not score, rate, rank, or grade");
    /**
     * Tuning only ever adds. Checked as two contiguous runs rather than one,
     * because the guidance is inserted *between* them — the job spec ends, the
     * guidance goes in, the prohibitions and the generated rows follow. Both
     * halves surviving verbatim is the guarantee; that they are no longer
     * adjacent is the insertion doing its job.
     */
    const jobSpec = base.slice(
      base.indexOf("Your job has exactly two parts"),
      base.indexOf("WHAT YOU MUST NOT DO."),
    );
    const fromProhibitions = base.slice(base.indexOf("WHAT YOU MUST NOT DO."));
    expect(tuned).toContain(jobSpec);
    expect(tuned).toContain(fromProhibitions);
  });

  it("keeps each block's tuning to its own block", () => {
    const other = RUBRICS[1];
    const tuned = systemPromptFor(block, { persona });

    expect(systemPromptFor(other)).not.toContain(persona);
    expect(tuned).toContain(block.label);
  });
});
