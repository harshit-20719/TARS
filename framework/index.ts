export * from "./rubrics";
export * from "./pillars";
export * from "./founderTypes";
export * from "./verificationCap";

import { RUBRICS, type SubDimension } from "./rubrics";
import { PILLARS, TRACKS, type Pillar, type Track } from "./pillars";
import { FOUNDER_TYPES, type FounderTypeDef } from "./founderTypes";

/** Every sub-dimension, flattened with its rubric context. */
export const ALL_SUBS: (SubDimension & { rubricKey: string; rubricLabel: string })[] =
  RUBRICS.flatMap((r) => r.subs.map((s) => ({ ...s, rubricKey: r.key, rubricLabel: r.label })));

export const TOTAL_SUBS = ALL_SUBS.length;

export function subByKey(key: string) {
  return ALL_SUBS.find((s) => s.key === key);
}

export function rubricByKey(key: string) {
  return RUBRICS.find((r) => r.key === key);
}

export function pillarByKey(key: string): Pillar | undefined {
  return PILLARS.find((p) => p.key === key);
}

export function trackByKey(key: string): Track | undefined {
  return TRACKS.find((t) => t.key === key);
}

/** Pillar or track definition, whichever matches the slide key. */
export function slideDefByKey(key: string): Pillar | Track | undefined {
  return pillarByKey(key) ?? trackByKey(key);
}

export function founderTypeByLabel(label: string): FounderTypeDef | undefined {
  return FOUNDER_TYPES.find((t) => t.label === label || t.key === label);
}
