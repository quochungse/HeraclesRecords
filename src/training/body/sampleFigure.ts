// Sample bodies for Overview's "Your physique" panel, for checking every
// figure without an account of each build.
//
// Picked from the developer toolbar's Sample menu (development builds only),
// like the Hall of Records' presets: renderer state, nothing written anywhere.
// A preset stands in for the COROS profile and the recovery % the panel reads;
// the panel reckons the build from it as it does from COROS (`readPhysique`),
// so what is drawn is what the rules make of those numbers. Between them the
// presets draw all eight bodies, each of the four recovery colours (100% green
// apart from 70–99 yellow), and a profile with no height or weight.

import { useSyncExternalStore } from "react";

export type FigureSamplePreset =
  | "male-lean"
  | "male-medium"
  | "male-sturdy"
  | "male-heavy"
  | "female-lean"
  | "female-medium"
  | "female-sturdy"
  | "female-heavy"
  | "no-body";

export interface FigureSample {
  /** As COROS's profile carries it; height and weight left out mean "not filled in". */
  profile: { sex: number; statureCm?: number; weightKg?: number };
  /** Undefined: no recovery from COROS, the panel's waiting state. */
  recoveryPct?: number;
}

export const FIGURE_SAMPLE_PRESETS: ReadonlyArray<{
  value: FigureSamplePreset;
  label: string;
  title: string;
  sample: FigureSample;
}> = [
  {
    value: "male-lean",
    label: "Physique · man, lean, 100%",
    title: "Your physique: 176 cm, 58 kg (adjusted BMI 18.3), recovery 100% — Ready, the full-recovery green",
    sample: { profile: { sex: 0, statureCm: 176, weightKg: 58 }, recoveryPct: 100 }
  },
  {
    value: "male-medium",
    label: "Physique · man, medium, 58%",
    title: "Your physique: 174 cm, 68 kg (adjusted BMI 22.1), recovery 58% — Moderate",
    sample: { profile: { sex: 0, statureCm: 174, weightKg: 68 }, recoveryPct: 58 }
  },
  {
    value: "male-sturdy",
    label: "Physique · man, sturdy, 72%",
    title: "Your physique: 175 cm, 76 kg (adjusted BMI 24.4), recovery 72% — Ready, in yellow: not full",
    sample: { profile: { sex: 0, statureCm: 175, weightKg: 76 }, recoveryPct: 72 }
  },
  {
    value: "male-heavy",
    label: "Physique · man, heavy, 34%",
    title: "Your physique: 172 cm, 82 kg (adjusted BMI 27.5), recovery 34% — Recover",
    sample: { profile: { sex: 0, statureCm: 172, weightKg: 82 }, recoveryPct: 34 }
  },
  {
    value: "female-lean",
    label: "Physique · woman, lean, 34%",
    title: "Your physique: 160 cm, 47 kg (adjusted BMI 18.9), recovery 34% — Recover",
    sample: { profile: { sex: 1, statureCm: 160, weightKg: 47 }, recoveryPct: 34 }
  },
  {
    value: "female-medium",
    label: "Physique · woman, medium, 88%",
    title: "Your physique: 160 cm, 56 kg (adjusted BMI 22.5), recovery 88% — Ready, in yellow: not full",
    sample: { profile: { sex: 1, statureCm: 160, weightKg: 56 }, recoveryPct: 88 }
  },
  {
    value: "female-sturdy",
    label: "Physique · woman, sturdy, 100%",
    title: "Your physique: 160 cm, 60 kg (adjusted BMI 24.1), recovery 100% — Ready, the full-recovery green",
    sample: { profile: { sex: 1, statureCm: 160, weightKg: 60 }, recoveryPct: 100 }
  },
  {
    value: "female-heavy",
    label: "Physique · woman, heavy, 58%",
    title: "Your physique: 158 cm, 66 kg (adjusted BMI 27.3), recovery 58% — Moderate",
    sample: { profile: { sex: 1, statureCm: 158, weightKg: 66 }, recoveryPct: 58 }
  },
  {
    value: "no-body",
    label: "Physique · no height or weight, 72%",
    title: "Your physique with no height or weight on the profile: the Medium figure, recovery 72%",
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
