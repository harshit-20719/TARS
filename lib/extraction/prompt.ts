/**
 * The extraction prompt, generated from the frozen rubric config.
 *
 * Generated rather than hand-written so the prompt cannot drift from
 * framework/rubrics.ts. When a sub-dimension's anchor text changes, the guidance
 * the model reads changes with it in the same commit.
 *
 * The prompt's whole job is to keep the machine on its side of the authorship
 * line: quote, map, and tag — never judge, never score, never infer a rating.
 *
 * There is one prompt per macro-dimension rather than one for all forty-one rows.
 * The first version asked a single call to sweep the whole rubric and it was badly
 * stingy — attention spread across forty-one rows finds the obvious things and
 * stops. A block of six or seven rows, with the *full* anchor text for each and an
 * explicit instruction to work row by row, is a different task: it reads like a
 * checklist rather than a summarisation.
 */

import type { Rubric, SubDimension } from "@/framework";

/**
 * One row, with everything the model needs to recognise its evidence.
 *
 * All the scale anchors are shown, not only the extremes. The middle is where most
 * real evidence lands, and a model shown only 1 and 5 returns only
 * extreme-looking quotes — which was a large part of why the first version found
 * so little in an ordinary screening call.
 */
function rowReference(s: SubDimension): string {
  const anchors =
    "fail" in s.anchors
      ? [
          `      FAIL looks like: ${s.anchors.fail}`,
          `      UNVERIFIED looks like: ${s.anchors.unv}`,
          `      PASS looks like: ${s.anchors.pass}`,
        ]
      : [
          `      a 1 looks like: ${s.anchors.low}`,
          `      a 3 looks like: ${s.anchors.mid}`,
          `      a 5 looks like: ${s.anchors.high}`,
        ];

  return [`  ${s.key} — ${s.label}`, `      what it tests: ${s.whatItTests}`, ...anchors].join("\n");
}

/**
 * The system prompt for one macro-dimension.
 *
 * The transcript is deliberately not in here — it goes in the user message, so
 * this block prompt is identical for every deal and every call.
 */
export function systemPromptFor(rubric: Rubric): string {
  const n = rubric.subs.length;
  return `You extract evidence from venture-capital founder call transcripts for Biome's Idea-to-Enterprise framework, at the Conviction (L1) layer.

You are working on ONE block of the framework: **${rubric.label}**. It has ${n} rows, listed at the end. Ignore anything in the transcript that does not speak to one of these ${n} rows — separate passes cover the rest of the framework.

Your job has exactly two parts, and stops there.

1. OBSERVATIONS. Work through the ${n} rows below **one at a time**. For each row, re-read the transcript asking a single question: what in here is evidence about this row? Then quote it.

   - Go row by row. Do not skim the transcript once and report what stood out. A row with nothing about it gets nothing — but decide that per row, having actually looked.
   - Use the anchors as your guide to what counts. Each row tells you what its low, middle and high ends look like. Anything a person would cite while placing this founder anywhere on that range is worth quoting — including the mundane middle. Evidence does not have to be impressive to be evidence.
   - Quote the transcript exactly. Copy the words character for character. Do not paraphrase, tidy grammar, join separated sentences, or trim for brevity. A quote that is not literally present in the transcript is discarded before it reaches anyone, so a tidied quote is a lost observation.
   - Quote enough to stand alone. Someone will read this quote weeks later without the transcript beside them. One or two full sentences is usually right; a four-word fragment is not.
   - Several quotes per row is normal and useful. A row supported by three passages is better evidence than a row supported by one.
   - The same passage may be evidence for more than one row. Quote the relevant span for each separately.
   - Attribute the speaker when the transcript names one, and carry the timestamp when the transcript shows one. Use null when the transcript does not say. Never guess either.

   For each observation also return:
   - confidence: "high" if this quote plainly belongs to this row; "low" if you are filing it here but a reasonable person might file it elsewhere. This is about your own filing, not about the founder. Be honest — a "low" sends it to a person to re-file, which is exactly what should happen when you are unsure.
   - mappingNote: one short clause on why this row, e.g. "names a specific paying customer" or "describes the four years spent inside the industry". Not an assessment — just what in the quote put it here.

2. CLAIMS. Record the assertions the founder makes about the world that a later layer will have to verify — a moat, a technical capability, a named buyer, a performance figure. Only for the rows in this block.

   - State the claim in one sentence, in the founder's own terms.
   - Anchor every claim to one of the quotes you returned as an observation, copied exactly.
   - Tag where it came from:
       founder-volunteered — the founder raised it unprompted
       founder-confirmed-after-PM-framing — the founder agreed after the interviewer suggested or framed it
       machine-inferred — you inferred it from what was said; the founder did not assert it directly
     The distinction matters: a claim the founder volunteered carries different weight from one they merely agreed with, and that difference is lost if you tag by feel. When unsure between volunteered and confirmed-after-framing, read who introduced the idea first.

WHAT YOU MUST NOT DO.

You do not score, rate, rank, or grade the founder or the company. You do not decide whether evidence is strong or weak, whether a row is met, or whether the deal is good. You assign no numbers on any row and offer no assessment. A person authors every score in this framework, reading the evidence you surfaced; your drafts are the input to that judgment, never a substitute for it. Do not editorialise in the claim text or the mapping note either — record what was said and where you filed it, not what you make of it.

The confidence field is the one thing you rate, and it rates your own filing accuracy. It is not a view on the founder.

THE ROWS IN THIS BLOCK — ${rubric.label}. Map every observation to one of these keys:

${rubric.subs.map(rowReference).join("\n\n")}`;
}

export function buildExtractionUserMessage(input: {
  transcript: string;
  callNumber: number;
  company?: string;
  callLabel?: string;
}): string {
  const context = [
    input.company ? `Company: ${input.company}` : null,
    `Call number: ${input.callNumber}`,
    input.callLabel ? `Call: ${input.callLabel}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${context}

Extract observations and claims from the transcript below, for your block only.

<transcript>
${input.transcript}
</transcript>`;
}
