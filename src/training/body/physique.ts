// Which body the Overview draws: a sex and one of three physiques.
//
// Read from the COROS profile's height and weight and nothing else. Telling a
// muscular athlete from a heavy one needs measures COROS does not have — a
// body-fat estimate built on training history mistook the one for the other —
// so the figure states size, which is what height and weight do say. Strong
// and Bodybuilder figures are for the athlete to choose, later; they are not
// guessed. Node-free: `test:body-figure` reads it directly.

export type FigureSex = "male" | "female";
export type Physique = "lean" | "medium" | "heavy";

/**
 * The lines, on the height-adjusted scale below. Heavy from 26: a step past
 * the 25 at which Asian populations are counted obese (WHO's 2004 expert
 * consultation; Việt Nam uses it), because an athlete carries more of their
 * weight as muscle than the people that line was drawn on. 20 is the figure's
 * own line: the Lean figure is a slim build, not the underweight of the
 * medical 18.5.
 */
export const LEAN_BELOW_BMI = 20;
export const HEAVY_FROM_BMI = 26;

export const PHYSIQUE_LABEL: Record<Physique, string> = {
  lean: "Lean",
  medium: "Medium",
  heavy: "Heavy"
};

/** COROS encodes `sex` as 0 male, 1 female; anything else draws the male figure. */
export function figureSex(sex: number | undefined): FigureSex {
  return sex === 1 ? "female" : "male";
}

/**
 * Trefethen's height-adjusted BMI, 1.3 × kg / m^2.5, not BMI's kg / m². A
 * body's weight grows faster than the square of its height, so BMI reads the
 * same build heavier on a tall athlete and lighter on a short one; the 2.5
 * power takes most of that out, and 1.3 (√1.69) makes the two scales agree
 * at 1.69 m. Read as BMI, it moves the lines with height: Heavy from a BMI of
 * 24.9 at 1.55 m, 26.0 at 1.69 m, 26.8 at 1.80 m and 27.6 at 1.90 m.
 */
export function heightAdjustedBmi(statureCm: number | undefined, weightKg: number | undefined): number | undefined {
  if (statureCm === undefined || weightKg === undefined) return undefined;
  if (!Number.isFinite(statureCm) || !Number.isFinite(weightKg)) return undefined;
  // A profile that was never filled in comes back as zeros, and a stray value
  // outside any adult's range is not one to draw a body from.
  if (statureCm < 100 || statureCm > 250 || weightKg < 25 || weightKg > 300) return undefined;
  return (1.3 * weightKg) / Math.pow(statureCm / 100, 2.5);
}

export function physiqueForBmi(bmi: number): Physique {
  if (bmi < LEAN_BELOW_BMI) return "lean";
  if (bmi < HEAVY_FROM_BMI) return "medium";
  return "heavy";
}

export interface PhysiqueReading {
  sex: FigureSex;
  /** Undefined when the profile lacks a usable height or weight. */
  physique?: Physique;
  /** The height-adjusted BMI the physique was read from. */
  bmi?: number;
}

export function readPhysique(profile: {
  sex?: number;
  statureCm?: number;
  weightKg?: number;
} | null | undefined): PhysiqueReading {
  const sex = figureSex(profile?.sex);
  const bmi = heightAdjustedBmi(profile?.statureCm, profile?.weightKg);
  return bmi === undefined ? { sex } : { sex, physique: physiqueForBmi(bmi), bmi };
}
