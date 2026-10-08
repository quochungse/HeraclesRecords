// Which body the Overview draws: a sex, a shape that follows the athlete's
// height and weight continuously — not one of a set of sizes — and how toned
// that shape is, from their VO2max.
//
// Size is the COROS profile's height and weight. Telling a muscular athlete
// from a heavy one needs measures COROS does not have — a body-fat estimate
// built on training history mistook the one for the other — so the one hint
// taken is VO2max: it is stated per kilogram, so of two people the same height
// and weight, the one with the higher figure carries more of it as muscle. It
// only ever tones the figure, never softens it: below Good for the athlete's
// age and sex, or with no recent reading, the figure is as size draws it.
// Strong and Bodybuilder figures are for the athlete to choose, later. Node-free:
// `test:body-figure` reads it directly.

import { ageOnDay, athleteSex, vo2RatingThreshold } from "../../records/fitnessStandards";

export type FigureSex = "male" | "female";
/** The four bodies baked by hand (`npm run body-figures:bake`), each with a toned twin. */
export type FigureBody = "slim" | "medium" | "heavy" | "veryHeavy";
export type BakedBody = FigureBody | `${FigureBody}Fit`;

/**
 * Where each baked body stands on the height-adjusted scale below, evenly
 * apart and near the middle of where each was drawn when the figure came in
 * ten fixed sizes (under 18.5, 21.5–23, 26–27.5, 31 and over). Between two of
 * them the figure is drawn that far of the way from one to the other, so a
 * kilogram moves it a little and never across a line; outside them it is the
 * nearest, which keeps the slimmest and the heaviest figures the ones drawn by
 * hand.
 */
export const BODY_ANCHORS: ReadonlyArray<readonly [FigureBody, number]> = [
  ["slim", 18],
  ["medium", 22.5],
  ["heavy", 27],
  ["veryHeavy", 31.5]
];

/** What a profile with no usable height or weight draws: the medium body. */
export const DEFAULT_SHAPE = 22.5;

/** A shape as the two baked bodies it lies between and how far along it is, 0–1. */
export interface ShapeBlend {
  from: FigureBody;
  to: FigureBody;
  t: number;
}

export function shapeBlend(shape: number): ShapeBlend {
  const first = BODY_ANCHORS[0];
  if (!(shape > first[1])) return { from: first[0], to: first[0], t: 0 };
  for (let i = 1; i < BODY_ANCHORS.length; i++) {
    const [from, low] = BODY_ANCHORS[i - 1];
    const [to, high] = BODY_ANCHORS[i];
    if (shape <= high) return { from, to, t: (shape - low) / (high - low) };
  }
  const last = BODY_ANCHORS[BODY_ANCHORS.length - 1][0];
  return { from: last, to: last, t: 0 };
}

/** COROS encodes `sex` as 0 male, 1 female; anything else draws the male figure. */
export function figureSex(sex: number | undefined): FigureSex {
  return sex === 1 ? "female" : "male";
}

/**
 * Trefethen's height-adjusted BMI, 1.3 × kg / m^2.5, not BMI's kg / m². A
 * body's weight grows faster than the square of its height, so BMI reads the
 * same build heavier on a tall athlete and lighter on a short one; the 2.5
 * power takes most of that out, and 1.3 (√1.69) makes the two scales agree
 * at 1.69 m. Read as BMI, it moves with height: the heavy body's 27 is a BMI of
 * 25.9 at 1.55 m, 27.0 at 1.69 m, 27.9 at 1.80 m and 28.6 at 1.90 m.
 */
export function heightAdjustedBmi(statureCm: number | undefined, weightKg: number | undefined): number | undefined {
  if (statureCm === undefined || weightKg === undefined) return undefined;
  if (!Number.isFinite(statureCm) || !Number.isFinite(weightKg)) return undefined;
  // A profile that was never filled in comes back as zeros, and a stray value
  // outside any adult's range is not one to draw a body from.
  if (statureCm < 100 || statureCm > 250 || weightKg < 25 || weightKg > 300) return undefined;
  return (1.3 * weightKg) / Math.pow(statureCm / 100, 2.5);
}

export interface PhysiqueReading {
  sex: FigureSex;
  /**
   * The height-adjusted BMI, which is the shape the figure is drawn at.
   * Undefined when the profile lacks a usable height or weight.
   */
  shape?: number;
}

export function readPhysique(profile: {
  sex?: number;
  statureCm?: number;
  weightKg?: number;
} | null | undefined): PhysiqueReading {
  const sex = figureSex(profile?.sex);
  const bmi = heightAdjustedBmi(profile?.statureCm, profile?.weightKg);
  return bmi === undefined ? { sex } : { sex, shape: bmi };
}

// --- firmness, from VO2max ---------------------------------------------------

/** One VO2max COROS reported, on a `YYYYMMDD` day. */
export interface Vo2Reading {
  day: string;
  value: number;
}

/** The readings a VO2max is taken from: the four weeks up to the latest. */
export const VO2_WINDOW_DAYS = 28;
/** A latest reading older than this is no longer the athlete's fitness. */
export const VO2_STALE_DAYS = 90;

function dayNumber(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))) / 86_400_000;
}

/**
 * The athlete's VO2max now: the median of the readings in the four weeks up to
 * the latest one, so a hot day's run or a new watch does not reshape the figure
 * overnight. Undefined with no reading, or none within `VO2_STALE_DAYS` of
 * `today` — COROS estimates VO2max from runs, and one not run for months says
 * nothing about today.
 */
export function recentVo2max(readings: readonly Vo2Reading[], today: string): number | undefined {
  const dated = readings.flatMap((r) =>
    /^\d{8}$/.test(r.day) && Number.isFinite(r.value) && r.value > 0 ? [{ at: dayNumber(r.day), value: r.value }] : []
  );
  if (!dated.length) return undefined;
  const latest = Math.max(...dated.map((r) => r.at));
  if (dayNumber(today) - latest > VO2_STALE_DAYS) return undefined;
  const values = dated
    .filter((r) => latest - r.at < VO2_WINDOW_DAYS)
    .map((r) => r.value)
    .sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * How far towards its toned twin the figure is drawn, 0–1: nothing below the
 * Cooper Institute's Good for this age and sex (the 60th percentile), all the
 * way at Superior (the 95th) and above, evenly between.
 */
export function vo2Firmness(vo2max: number, age: number, sex: number | undefined): number {
  const athlete = athleteSex(sex);
  const from = vo2RatingThreshold("good", age, athlete);
  const to = vo2RatingThreshold("superior", age, athlete);
  return Math.min(1, Math.max(0, (vo2max - from) / (to - from)));
}

/** The figure's firmness for a profile and its VO2max readings; 0 with no recent reading. */
export function readFirmness(
  profile: { sex?: number; birthday?: number } | null | undefined,
  readings: readonly Vo2Reading[],
  today: string
): number {
  const vo2max = recentVo2max(readings, today);
  if (vo2max === undefined) return 0;
  return vo2Firmness(vo2max, ageOnDay(profile?.birthday, today), profile?.sex);
}
