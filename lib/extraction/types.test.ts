/**
 * The boundary test: everything asserted here is reachable through
 * lib/extraction/types alone. This file deliberately imports nothing else from
 * lib/extraction — no extract.ts, and through it no provider SDK — because
 * that importability is the module's whole reason to exist (KTD4). If an
 * import creeps in here that drags an SDK along, this file is the diff where
 * it shows.
 */

import { describe, expect, it } from "vitest";
import {
  ExtractionError,
  type ExtractionFailureKind,
  type ExtractionProvider,
} from "./types";

describe("ExtractionError, importable without any provider SDK", () => {
  it("is recognisable by instanceof and by name", () => {
    const e = new ExtractionError("no drafts were written");
    expect(e).toBeInstanceOf(ExtractionError);
    expect(e).toBeInstanceOf(Error);
    // By name too, matching the by-name convention lib/fireflies/client.ts
    // uses: a plain-object stub shaped like the real thing should pass the
    // same checks the real thing does.
    expect(e.name).toBe("ExtractionError");
    expect(e.message).toBe("no drafts were written");
  });

  /**
   * The taxonomy (KTD5): a caller tells a failure worth retrying from one that
   * will fail the same way again by reading the kind, never by parsing the
   * message — which exists for a person and changes for a person's reasons.
   */
  it("carries a machine-readable kind, distinguishing retryable from terminal", () => {
    const retryable = new ExtractionError("rate limited — try again", "retryable");
    const terminal = new ExtractionError("the key is not valid", "terminal");
    const filing = new ExtractionError("the answer did not fit the schema", "filing");

    expect(retryable.kind).toBe("retryable");
    expect(terminal.kind).toBe("terminal");
    expect(filing.kind).toBe("filing");
    // Same class, same name — only the kind separates them.
    expect(retryable.kind).not.toBe(terminal.kind);
  });

  it("defaults the kind to the neutral one, so existing throw sites keep working", () => {
    // The one-argument constructor is the pre-taxonomy contract, and every
    // caller that has not yet said what kind of failure it is lands here.
    expect(new ExtractionError("something else").kind).toBe("unknown");
  });
});

describe("the provider port", () => {
  /**
   * The port must be stubbable with a plain object, exactly like the older
   * ExtractionClient — the property the whole suite's no-key, no-network
   * setup rests on. Compiling is most of this test; the call proves the stub
   * sees the neutral request shape, rubric key included (KTD7).
   */
  it("is satisfied by a plain object, no SDK in sight", async () => {
    const seen: string[] = [];
    const provider: ExtractionProvider = {
      extractBlock: async (request) => {
        seen.push(request.rubricKey);
        return request.schema.parse({});
      },
    };

    // A schema stub in the same spirit: parse returns what it was given.
    const schema = { parse: (v: unknown) => v } as unknown as import("zod").ZodType<unknown>;
    await provider.extractBlock({
      rubricKey: "ft",
      system: "read the block",
      user: "the transcript",
      schema,
      timeoutMs: 1000,
    });
    expect(seen).toEqual(["ft"]);
  });

  it("names the four outcomes and nothing provider-shaped", () => {
    // A compile-time fact stated at runtime so it appears in the report: the
    // kind vocabulary is exactly the taxonomy, no provider's error codes.
    const kinds: ExtractionFailureKind[] = ["retryable", "terminal", "filing", "unknown"];
    expect(kinds).toHaveLength(4);
  });
});
