import { describe, expect, it } from "vitest";
import { ALL_SUBS, OPEN_CALLS, PILLARS, RUBRICS, TRACKS, subByKey } from ".";
import type { BinaryAnchors, ScaleAnchors } from "./rubrics";
import { getRecord, listDeals } from "@/mock/data";

/**
 * These tests pin rubric_v1 to the shape of the Notion grid it was transcribed
 * from. They are not testing logic — they are the thing that fails loudly if a
 * row is dropped, a key is duplicated, or a floor rule is written against the
 * wrong value set, all of which are silent at the type level.
 *
 * The counts are the load-bearing ones. Notion's grid is 7/7/7/7/7/6; a row lost
 * in a hand-edit would otherwise show up as nothing more than a shorter table.
 */

const EXPECTED = [
  { key: "ft", label: "Founder & Team", subs: 7 },
  { key: "pm", label: "Problem & Market", subs: 7 },
  { key: "pt", label: "Product / Tech & Solution", subs: 7 },
  { key: "gtm", label: "GTM & Distribution Access", subs: 7 },
  { key: "fl", label: "Financial & Legal", subs: 7 },
  { key: "sf", label: "Studio Fit & Co-Develop", subs: 6 },
];

describe("rubric_v1 shape", () => {
  it("has the six rubrics in Notion's order, with Notion's row counts", () => {
    expect(RUBRICS.map((r) => ({ key: r.key, label: r.label, subs: r.subs.length }))).toEqual(
      EXPECTED,
    );
  });

  it("has 41 sub-dimensions in total", () => {
    expect(ALL_SUBS).toHaveLength(41);
  });

  it("gives every sub-dimension a unique key", () => {
    const keys = ALL_SUBS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("numbers rows 1..n within each rubric, in order", () => {
    for (const r of RUBRICS) {
      expect(r.subs.map((s) => s.index)).toEqual(r.subs.map((_, i) => i + 1));
    }
  });
});

describe("anchors", () => {
  it("gives each row the anchor set its value type calls for", () => {
    for (const s of ALL_SUBS) {
      const keys = Object.keys(s.anchors).sort();
      expect(keys, s.key).toEqual(
        s.type === "binary" ? ["fail", "pass", "unv"] : ["high", "low", "mid"],
      );
    }
  });

  it("writes all three anchors — a blank one would be scored against", () => {
    for (const s of ALL_SUBS) {
      const a = s.type === "binary" ? (s.anchors as BinaryAnchors) : (s.anchors as ScaleAnchors);
      for (const [col, text] of Object.entries(a)) {
        expect(text.trim().length, `${s.key}.${col}`).toBeGreaterThan(20);
      }
    }
  });

  it("carries Notion's 'what it tests' on every row", () => {
    for (const s of ALL_SUBS) {
      expect(s.whatItTests.trim().length, s.key).toBeGreaterThan(20);
    }
  });

  it("keeps the anchors free of Notion's markup", () => {
    for (const s of ALL_SUBS) {
      const all = [s.whatItTests, s.rootsTo, ...Object.values(s.anchors)].join(" ");
      expect(all, s.key).not.toMatch(/\*\*|^\*|\\\$/);
      // The "Fail:/Unverified:/Pass:" column prefixes belong to the column, not
      // the text — a leftover would read as part of the anchor.
      for (const text of Object.values(s.anchors)) {
        expect(text, s.key).not.toMatch(/^(Fail|Unverified|Pass):/);
      }
    }
  });
});

describe("the hygiene floor", () => {
  const floorRows = ALL_SUBS.filter((s) => s.floor);

  it("has ten floor rows — eight binary, and two scored 1–5", () => {
    expect(floorRows.map((s) => s.key)).toEqual([
      "ambition-fit",
      "capital-cleanliness",
      "ip-ownership",
      "india-incorporation",
      "regulated-readiness",
      "cap-table-health",
      "studio-alignment",
      "eng-self-sufficiency",
      "founder-commitment",
      "structural-fit",
    ]);
    expect(floorRows.filter((s) => s.type === "scale").map((s) => s.key)).toEqual([
      "ambition-fit",
      "cap-table-health",
    ]);
  });

  it("declares a trip value from the row's own value set", () => {
    for (const s of floorRows) {
      const breachAt = s.floor!.breachAt;
      if (s.type === "binary") {
        expect(breachAt, s.key).toBe("fail");
      } else {
        // Notion writes both scale kill-floors at 1, never at NE.
        expect(breachAt, s.key).toBe(1);
      }
    }
  });

  it("marks engineering self-sufficiency as the one flag, not a kill", () => {
    expect(floorRows.filter((s) => s.floor!.weight === "flag").map((s) => s.key)).toEqual([
      "eng-self-sufficiency",
    ]);
  });

  it("roots no floor row to a slide — hygiene is not judgment", () => {
    for (const s of floorRows) {
      // Ambition & exit-type fit is the exception Notion itself makes: it roots to
      // the Founder/s track and carries a kill-floor at 1.
      if (s.key === "ambition-fit") continue;
      expect(s.roots, s.key).toEqual([]);
    }
  });
});

describe("rooting", () => {
  const slideKeys = new Set([...PILLARS.map((p) => p.key), ...TRACKS.map((t) => t.key)]);

  it("resolves every root to a real pillar or track", () => {
    for (const s of ALL_SUBS) {
      for (const key of s.roots) {
        expect(slideKeys.has(key), `${s.key} -> ${key}`).toBe(true);
      }
    }
  });

  it("derives each slide's rooted rows from the rows themselves", () => {
    for (const p of PILLARS) {
      for (const r of p.rooted) {
        expect(subByKey(r.subKey)?.roots, r.subKey).toContain(p.key);
      }
    }
  });

  it("names a note wherever nothing roots to a slide", () => {
    // An empty rooting is a real state of the framework — business-model
    // innovation has no row rooted to it, and the Idea track reads the pillars.
    for (const def of [...PILLARS, ...TRACKS]) {
      if (def.rooted.length === 0) expect(def.note, def.key).toBeTruthy();
    }
  });

  it("gives every capture row its 'feeds at judgment' prose", () => {
    const capture = ALL_SUBS.filter((s) => s.roots.length === 0 && !s.floor);
    expect(capture).toHaveLength(11);
    for (const s of capture) {
      expect(s.feedsAtJudgment, s.key).toBeTruthy();
    }
  });
});

describe("open framework calls", () => {
  it("carries the six unresolved calls, four of them on a row", () => {
    expect(OPEN_CALLS).toHaveLength(6);
    const scoped = OPEN_CALLS.filter((c) => c.subKey);
    expect(scoped.map((c) => c.subKey)).toEqual([
      "coachability",
      "market-size",
      "ip-ownership",
      "eng-self-sufficiency",
    ]);
    for (const c of scoped) {
      expect(subByKey(c.subKey!)?.open, c.subKey).toBeTruthy();
    }
  });

  it("puts an `open` note on exactly those four rows", () => {
    expect(ALL_SUBS.filter((s) => s.open).map((s) => s.key)).toEqual([
      "coachability",
      "market-size",
      "ip-ownership",
      "eng-self-sufficiency",
    ]);
  });
});

describe("the fixtures speak this rubric", () => {
  /**
   * The guard that catches a half-finished rename. Every key the fixtures use has
   * to exist, and every score's value type has to match the row it sits on —
   * otherwise the seed writes rows the UI cannot render and the failure only turns
   * up in a browser.
   */
  it("uses only real sub-dimension keys, at the right value type", () => {
    for (const deal of listDeals()) {
      const rec = getRecord(deal.id)!;
      for (const o of rec.observations) {
        const sub = subByKey(o.subDimensionKey);
        expect(sub, `${o.id} -> ${o.subDimensionKey}`).toBeTruthy();
        expect(sub!.key, o.id).toBe(o.subDimensionKey);
        // The observation's rubricKey must be the rubric the row actually sits in.
        const rubric = RUBRICS.find((r) => r.subs.some((s) => s.key === o.subDimensionKey));
        expect(rubric?.key, `${o.id} filed under ${o.rubricKey}`).toBe(o.rubricKey);
      }
      for (const s of rec.scores) {
        const sub = subByKey(s.subDimensionKey);
        expect(sub, `${deal.id}/${s.subDimensionKey}`).toBeTruthy();
        expect(s.scoreType, s.subDimensionKey).toBe(sub!.type);
      }
      for (const sl of rec.slides) {
        const def = [...PILLARS, ...TRACKS].find((d) => d.key === sl.slideKey);
        expect(def, sl.slideKey).toBeTruthy();
        expect(sl.lens, sl.slideKey).toBe(def!.lens);
      }
      expect(
        rec.founderTypeRead.floorDimension === "" ||
          subByKey(rec.founderTypeRead.floorDimension) !== undefined,
        `${deal.id} floor dimension`,
      ).toBe(true);
    }
  });
});
