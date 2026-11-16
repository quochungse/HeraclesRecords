// Where a VO2max stands for the athlete's age and sex, on The Cooper
// Institute's five ratings (Poor, Fair, Good, Excellent, Superior: the 40th,
// 60th, 80th and 95th percentiles), as Garmin rates it. COROS rates none.
//
// Node-free, so `npm run test:vo2-level` reaches it.

import {
  vo2FairThreshold,
  vo2RatingThreshold,
  type AthleteSex
} from "../records/fitnessStandards";

export type Vo2Level = "poor" | "fair" | "good" | "excellent" | "superior";

export const VO2_LEVELS: readonly Vo2Level[] = ["poor", "fair", "good", "excellent", "superior"];

/**
 * Six edges for the five ratings: the four the table states, and an open end
 * on each side drawn as wide as the rating beside it, so the dial has room to
 * show how far below Fair or above Superior a value lies.
 */
export function vo2LevelEdges(age: number, sex: AthleteSex): number[] {
  const fair = vo2FairThreshold(age, sex);
  const good = vo2RatingThreshold("good", age, sex);
  const excellent = vo2RatingThreshold("excellent", age, sex);
  const superior = vo2RatingThreshold("superior", age, sex);

  return [fair - (good - fair), fair, good, excellent, superior, superior + (superior - excellent)];
}

export function vo2LevelOf(value: number, edges: readonly number[]): Vo2Level {
  let index = 0;

  for (let edge = 1; edge < edges.length - 1; edge += 1) {
    if (value >= edges[edge]) index = edge;
  }

  return VO2_LEVELS[index];
}

/**
 * Where the value stands on a dial of five equal parts, 0 to 1: its rating's
 * part, and how far into it the value lies. Beyond the open ends it rests at
 * the end.
 */
export function vo2DialPosition(value: number, edges: readonly number[]): number {
  const index = VO2_LEVELS.indexOf(vo2LevelOf(value, edges));
  const from = edges[index];
  const to = edges[index + 1];
  const into = Math.max(0, Math.min(1, (value - from) / (to - from)));

  return (index + into) / VO2_LEVELS.length;
}
