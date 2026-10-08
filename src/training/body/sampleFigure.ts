// Sample bodies for Overview's "Your physique" panel, for checking every
// figure without an account of each build.
//
// Picked from the developer toolbar's Sample menu (development builds only),
// like the Hall of Records' presets: renderer state, nothing written anywhere.
// A preset stands in for the COROS profile and the recovery % the panel reads;
// the panel reckons the build from it as it does from COROS (`readPhysique`),
// so what is drawn is what the rules make of those numbers. Between them the
// presets draw both ends and the blends between for each sex, one weight at
// three heights, the toning VO2max adds, each of the four recovery colours (100% green apart from
// 70–99 yellow), and a profile with no height or weight.

import { useSyncExternalStore } from "react";
import { heightAdjustedBmi } from "./physique";

export type FigureSamplePreset = string;

export interface FigureSample {
  /** As COROS's profile carries it; height and weight left out mean "not filled in". */
  profile: { sex: number; statureCm?: number; weightKg?: number };
  /** Undefined: no recovery from COROS, the panel's waiting state. */
  recoveryPct?: number;
  /** A VO2max read today; undefined is none at all. */
  vo2max?: number;
}

export interface FigureSampleEntry {
  value: FigureSamplePreset;
  label: string;
  title: string;
  sample: FigureSample;
}

function bodyPreset(
  sex: 0 | 1,
  statureCm: number,
  weightKg: number,
  recoveryPct: number,
  vo2max?: number
): FigureSampleEntry {
  const who = sex === 1 ? "woman" : "man";
  const bmi = heightAdjustedBmi(statureCm, weightKg) ?? 0;
  const vo2 = vo2max === undefined ? "" : `, VO2max ${vo2max}`;
  return {
    value: `${who}-${statureCm}-${weightKg}${vo2max === undefined ? "" : `-vo2-${vo2max}`}`,
    label: `Physique · ${who}, ${statureCm} cm ${weightKg} kg${vo2}, ${recoveryPct}%`,
    // No birthday reads as 30, the age the VO2max is graded for.
    title: `Your physique: ${statureCm} cm, ${weightKg} kg (adjusted BMI ${bmi.toFixed(1)})${vo2 && `${vo2} at 30`}, recovery ${recoveryPct}%`,
    sample: { profile: { sex, statureCm, weightKg }, recoveryPct, vo2max }
  };
}

// From the slimmest body to the heaviest, past both ends (each held there),
// through the blends between; then one weight at three heights, which is the
// height adjustment at work; then one man and one woman from below Good to
// Superior VO2max for 30-year-olds (no birthday reads as 30). Each recovery colour turns up along the way: 100%
// the full-recovery green, 70–99 yellow, 40–69 orange, under 40 red.
export const FIGURE_SAMPLE_PRESETS: readonly FigureSampleEntry[] = [
  bodyPreset(0, 175, 52, 100),
  bodyPreset(0, 175, 62, 88),
  bodyPreset(0, 175, 70, 58),
  bodyPreset(0, 175, 78, 34),
  bodyPreset(0, 175, 86, 72),
  bodyPreset(0, 175, 95, 100),
  bodyPreset(0, 175, 108, 88),
  bodyPreset(1, 160, 40, 58),
  bodyPreset(1, 160, 48, 34),
  bodyPreset(1, 160, 55, 72),
  bodyPreset(1, 160, 61, 100),
  bodyPreset(1, 160, 68, 88),
  bodyPreset(1, 160, 76, 58),
  bodyPreset(1, 160, 85, 34),
  bodyPreset(0, 160, 80, 72),
  bodyPreset(0, 178, 80, 72),
  bodyPreset(0, 195, 80, 72),
  bodyPreset(0, 175, 78, 100, 42),
  bodyPreset(0, 175, 78, 100, 49),
  bodyPreset(0, 175, 78, 100, 55),
  bodyPreset(1, 160, 61, 88, 36),
  bodyPreset(1, 160, 61, 88, 42.6),
  bodyPreset(1, 160, 61, 88, 48),
  {
    value: "no-body",
    label: "Physique · no height or weight, 72%",
    title: "Your physique with no height or weight on the profile: the medium body, recovery 72%",
    sample: { profile: { sex: 0 }, recoveryPct: 72 }
  }
];

let current: FigureSamplePreset | null = null;
const listeners = new Set<() => void>();

export function setFigureSample(preset: FigureSamplePreset | null): void {
  current = preset;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen preset's name, for the menu. */
export function useFigureSamplePreset(): FigureSamplePreset | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** The chosen preset's numbers, for the panel; null when none is chosen. */
export function useFigureSample(): FigureSample | null {
  const preset = useFigureSamplePreset();
  return FIGURE_SAMPLE_PRESETS.find((entry) => entry.value === preset)?.sample ?? null;
}
