// The Strength figure's sex, picked from the developer toolbar's Sample menu
// (development builds only), for checking both figures without an account of
// each. Renderer state like the physique presets (`sampleFigure.ts`): it stands
// in for the COROS profile's sex and writes nothing anywhere.

import { useSyncExternalStore } from "react";
import type { FigureSex } from "../training/body/physique";

export const HERO_SAMPLE_PRESETS: readonly { value: FigureSex; label: string; title: string }[] = [
  { value: "male", label: "Strength figure · man", title: "The Strength screen draws the man's figure" },
  { value: "female", label: "Strength figure · woman", title: "The Strength screen draws the woman's figure" }
];

let current: FigureSex | null = null;
const listeners = new Set<() => void>();

export function setHeroSample(sex: FigureSex | null): void {
  current = sex;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen figure, or null when the profile decides. */
export function useHeroSample(): FigureSex | null {
  return useSyncExternalStore(subscribe, () => current);
}
