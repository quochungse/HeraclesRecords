// The figures on the Heracles Training Load page, worked out at build time by
// the app's own engine (electron/heraclesLoad.ts, node-free), so the page
// cannot state a number the app does not compute. The worked example is a real
// run of the engine over two invented sessions.

import {
  heartRateReserveAtRpe,
  intensityAtReps,
  loadPerMinute,
  repsAtIntensity,
  rpeFromRir,
  runHeraclesLoads,
} from "../../electron/heraclesLoad";
import { HERACLES_EXERCISE_FACTORS } from "../../electron/heraclesLoadFactors";

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

/** Reps to failure at a share of the one-rep max (Nuzzo et al. 2024). */
export const repsTable = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5, 0.4, 0.3].map((share) => ({
  percent: Math.round(share * 100),
  reps: round(repsAtIntensity(share)),
}));

/** Reps in reserve to a set's RPE (Zourdos et al. 2016). */
export const rpeTable = [0, 1, 2, 3, 4, 5, 6, 8, 10].map((rir) => ({ rir, rpe: round(rpeFromRir(rir)) }));

/** The effort curve: heart-rate reserve and load per minute at a CR-10 rating. */
export const perMinuteTable = [1.5, 3, 5, 6, 7, 8, 9, 10].map((rpe) => ({
  rpe,
  reserve: Math.round(heartRateReserveAtRpe(rpe) * 100),
  perMinute: round(loadPerMinute(rpe), 2),
}));

/** How much of the body a bodyweight movement moves, by COROS key. */
const BODY_SHARE_EXAMPLES: [key: string, name: string][] = [
  ["T1002", "Pull-up"],
  ["T1051", "Parallel bar dip"],
  ["T1061", "Squat, with or without a bar"],
  ["T1064", "Lunge, with or without weights"],
  ["T1148", "Push-up"],
  ["T1340", "Inverted row"],
  ["T1033", "Bridge"],
  ["T1032", "Hanging leg raise"],
];
export const bodyShares = BODY_SHARE_EXAMPLES.map(([key, name]) => ({
  name,
  share: HERACLES_EXERCISE_FACTORS[key]?.bodyShare ?? 0,
}));

// The worked example: a 75 kg athlete whose best bench press in the last 120
// days is 80 kg × 6, lifting three sets at 70 kg and three sets of pull-ups.
export const EXAMPLE_BODY_KG = 75;
const BEST = { weightKg: 80, reps: 6 };
const WORK_SEC = 30;
const REST_SEC = 120;
const WARM_UP_SEC = 6 * 60;
const DAY = 86_400;
const TODAY = 20_000 * DAY;

const set = (weightKg: number, reps: number) => ({ reps, weightKg, workSec: WORK_SEC, restSec: REST_SEC, calories: 0 });
const exercise = (id: string, name: string, label: string, entries: ReturnType<typeof set>[]) => ({
  label,
  nameKey: name,
  rawName: name,
  externalId: id,
  sets: entries.length,
  totalReps: entries.reduce((sum, entry) => sum + entry.reps, 0),
  entries,
});
const session = (activityId: string, startTime: number, exercises: ReturnType<typeof exercise>[]) => {
  const sets = exercises.flatMap((entry) => entry.entries);
  const durationSec = WARM_UP_SEC + sets.reduce((sum, entry) => sum + entry.workSec + entry.restSec, 0);
  return {
    activityId,
    startTime,
    duration: durationSec,
    detail: {
      summary: { sets: sets.length, totalReps: 0, totalWeightKg: 0, exercises: exercises.length, calories: 0, durationSec },
      exercises,
    },
  };
};

const exampleExercises = [
  exercise("bench", "Bench Press (Barbell)", "Bench press", [set(70, 10), set(70, 9), set(70, 8)]),
  exercise("pullup", "Pull Up", "Pull-up", [set(0, 8), set(0, 7), set(0, 6)]),
];
const sessions = [
  session("earlier", TODAY - 30 * DAY, [exercise("bench", "Bench Press (Barbell)", "Bench press", [set(BEST.weightKg, BEST.reps)])]),
  session("today", TODAY, exampleExercises),
];
// The engine's own types are the app's; the invented sessions carry only the fields it reads.
const run = runHeraclesLoads(sessions as never, { bodyWeightKg: () => EXAMPLE_BODY_KG });
const scored = run.sessions.get("today")!;
const today = sessions[1]!;

export const example = {
  best: BEST,
  /** The bench press one-rep max the best set implies, two reps short of failure. */
  benchCapacity: round(BEST.weightKg / intensityAtReps(BEST.reps + 2)),
  pullUpShare: HERACLES_EXERCISE_FACTORS.T1002?.bodyShare ?? 0,
  workSec: WORK_SEC,
  restSec: REST_SEC,
  warmUpMin: WARM_UP_SEC / 60,
  minutes: round(today.duration / 60, 0),
  exercises: exampleExercises.map((entry, exerciseIndex) => ({
    name: entry.label,
    sets: entry.entries.map((planned, setIndex) => {
      const result = scored.sets?.[exerciseIndex]?.[setIndex];
      return {
        lifted: planned.weightKg > 0 ? `${planned.weightKg} kg × ${planned.reps}` : `Body × ${planned.reps}`,
        percent: result?.intensity !== undefined ? Math.round(result.intensity * 100) : undefined,
        rir: result?.rir !== undefined ? round(result.rir) : undefined,
        rpe: result ? round(result.rpe) : undefined,
        load: result ? round(result.load) : undefined,
        fatigued: result?.fatigued === true,
      };
    }),
  })),
  betweenLoad: round(loadPerMinute(1.5) * (WARM_UP_SEC / 60)),
  total: Math.round(scored.value),
  /** Minutes of steady effort at RPE 5 that carry the same load. */
  steadyMinutes: Math.round(scored.value / loadPerMinute(5)),
};
