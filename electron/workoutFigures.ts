import type {
  PlanWorkoutEntryInput,
  RunWorkoutCreateStep,
  RunWorkoutStepInput,
  WorkoutEditorContext
} from "./types";
import { encodeCorosIntensity } from "./workoutCapabilities";

/**
 * How far and how long a planned workout goes — the one rule every screen
 * that states it goes through: the Calendar's card and panel, the workout
 * view (Coach's proposed change, the Library, a plan session), the workout
 * builder's footer, the plan reader and Coach's plan text.
 *
 * **A figure is the whole session's or it is not stated as one.** COROS's
 * stored estimate comes first; else COROS's own arithmetic, done here
 * (`estimateWorkoutFigures`), which counts the timed steps into the distance
 * and the distance steps into the time; else the steps' sum when every step
 * is in that unit. A sum over some of the steps read as the whole session's:
 * a 14 km long run with a timed warm-up and cool-down said "Distance 11.5 km"
 * beside the Calendar's 14.08.
 *
 * Node-free: the renderer imports it as it is.
 */
export interface WorkoutFigures {
  /** The whole session's distance, in metres. */
  distanceMeters?: number;
  /** The whole session's time, in seconds. */
  durationSeconds?: number;
}

/** What a workout's steps add up to, one unit at a time. */
export interface StepFigures {
  /** Over the steps written in distance only. */
  distanceMeters?: number;
  /** Over the steps written in time only. */
  durationSeconds?: number;
  /** Leaf steps, a repeat group's children once each. */
  stepCount: number;
  distanceSteps: number;
  timedSteps: number;
}

/**
 * COROS's own estimate of a program's whole session. On a COROS program a `0`
 * is a field nobody filled in, so it is no estimate; distances are centimetres
 * on the wire. `plan*` is what `/training/program/calculate` answers, the
 * plain field what a stored program carries, `estimated*` what a schedule
 * entry and a plan's running copy carry (their `distance`/`duration` are 0).
 */
export function corosProgramFigures(program: Record<string, unknown> | undefined): WorkoutFigures {
  const centimetres = firstFilled(program, ["planDistance", "distance", "estimatedDistance"]);
  const seconds = firstFilled(program, ["planDuration", "duration", "estimatedTime"]);
  return {
    ...(centimetres !== undefined ? { distanceMeters: centimetres / 100 } : {}),
    ...(seconds !== undefined ? { durationSeconds: seconds } : {})
  };
}

function firstFilled(program: Record<string, unknown> | undefined, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = Number(program?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/** A step's unit as the write reads it: `target_type`, else distance before time. */
function targetOf(step: RunWorkoutCreateStep): string | undefined {
  return step.target_type ??
    (step.target_distance_meters !== undefined ? "distance" : step.target_duration_seconds !== undefined ? "time" : undefined);
}

function leafSteps(steps: readonly RunWorkoutStepInput[] | undefined): Array<{ step: RunWorkoutCreateStep; repeat: number }> {
  return (steps ?? []).flatMap((node) =>
    "repeat" in node && Array.isArray(node.steps)
      ? node.steps.map((step) => ({ step, repeat: Math.max(1, node.repeat) }))
      : [{ step: node as RunWorkoutCreateStep, repeat: 1 }]
  );
}

/** What a plan or Coach step list adds up to, one unit at a time. */
export function stepFigures(steps: readonly RunWorkoutStepInput[] | undefined): StepFigures {
  let distanceMeters = 0;
  let durationSeconds = 0;
  let distanceSteps = 0;
  let timedSteps = 0;
  const leaves = leafSteps(steps);
  for (const { step, repeat } of leaves) {
    const type = targetOf(step);
    if (type === "distance" && (step.target_distance_meters ?? 0) > 0) {
      distanceMeters += step.target_distance_meters! * repeat;
      distanceSteps += 1;
    } else if (type === "time" && (step.target_duration_seconds ?? 0) > 0) {
      durationSeconds += step.target_duration_seconds! * repeat;
      timedSteps += 1;
    }
  }
  return {
    ...(distanceMeters > 0 ? { distanceMeters } : {}),
    ...(durationSeconds > 0 ? { durationSeconds } : {}),
    stepCount: leaves.length,
    distanceSteps,
    timedSteps
  };
}

/** The rule over step sums: the estimate figure by figure, else the steps' sum when every step is in that unit. */
export function sessionFigures(steps: StepFigures, estimate: WorkoutFigures = {}): WorkoutFigures {
  const everyStep = (count: number) => steps.stepCount > 0 && count === steps.stepCount;
  const distanceMeters = positive(estimate.distanceMeters) ??
    (everyStep(steps.distanceSteps) ? positive(steps.distanceMeters) : undefined);
  const durationSeconds = positive(estimate.durationSeconds) ??
    (everyStep(steps.timedSteps) ? positive(steps.durationSeconds) : undefined);
  return {
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {})
  };
}

/**
 * The rule for a workout held as steps: COROS's stored estimate figure by
 * figure (`coros`, from `corosProgramFigures`), else COROS's arithmetic done
 * here, else the steps' sum when every step is in that unit.
 */
export function workoutFigures(
  workout: FiguredWorkout,
  options: FigureOptions = {}
): WorkoutFigures {
  return wholeFigures(workout, stepFigures(workout.steps), options);
}

type FiguredWorkout = Pick<PlanWorkoutEntryInput, "sport" | "steps" | "distance_km">;
type FigureOptions = { coros?: WorkoutFigures; context?: WorkoutEditorContext };

function wholeFigures(workout: FiguredWorkout, steps: StepFigures, options: FigureOptions): WorkoutFigures {
  const coros = options.coros ?? {};
  const known = positive(coros.distanceMeters) !== undefined && positive(coros.durationSeconds) !== undefined;
  const estimated = known ? {} : estimateWorkoutFigures(workout, options.context);
  return sessionFigures(steps, {
    distanceMeters: positive(coros.distanceMeters) ?? estimated.distanceMeters,
    durationSeconds: positive(coros.durationSeconds) ?? estimated.durationSeconds
  });
}

/** What a screen states of a workout: each figure the whole session's where the rule knows it, else the steps' sum in that unit. */
export interface StatedFigures {
  distanceMeters?: number;
  durationSeconds?: number;
  /** `distanceMeters` is the whole session's; otherwise only its distance steps', to be named as such. */
  distanceWhole: boolean;
  /** `durationSeconds` is the whole session's; otherwise only its timed steps'. */
  durationWhole: boolean;
}

/** `workoutFigures`, with the partial sums a screen names as such where the rule has no whole figure. */
export function statedWorkoutFigures(
  workout: FiguredWorkout,
  options: FigureOptions = {}
): StatedFigures {
  const steps = stepFigures(workout.steps);
  const whole = wholeFigures(workout, steps, options);
  const distanceMeters = whole.distanceMeters ?? steps.distanceMeters;
  const durationSeconds = whole.durationSeconds ?? steps.durationSeconds;
  return {
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    distanceWhole: whole.distanceMeters !== undefined,
    durationWhole: whole.durationSeconds !== undefined
  };
}

/*
 * COROS's arithmetic, probed against `/training/program/calculate` on
 * 2026-11-03 (an account at max HR 190, resting 52, LTHR 168, threshold pace
 * 321, pace zone 6 at 285 s/km; `scripts/test-workout-figures.mjs` holds the
 * answers). Run and Trail Run only: a ride's heart-rate step is 0 m there.
 *
 *   - A step is driven at one speed, from its intensity as the write encodes
 *     it. Pace and effort pace: the middle of the band (300-330 s/km is 315).
 *     Heart rate: the middle bpm, whole (`floor`: 135-156 is 145), through
 *     `heartRateSpeed`. `%`, `hrType` and the zone id are not read.
 *   - No intensity, power or cadence: COROS drives these at 0 — a timed
 *     warm-up adds no distance, a 7 km warm-up no time — which is a sum over
 *     some of the steps stated as the session's. Here they leave that figure
 *     unknown, as an open step leaves both; only a rest is taken at 0, which
 *     is what standing still between repeats is.
 *   - The session is the sum: distance in centimetres, time in whole seconds.
 *
 * The real 14 km long run (15 min @125-150, 6.5 km @135-156, 5 km @135-160,
 * 5 min @110-145) comes to 14079.74 m and 5883 s, COROS's own figures.
 */
const CONVERTING_SPORTS = new Set(["run", "trailRun"]);

/** COROS's whole-session figures for a workout nobody has saved, as `calculate` would answer. */
export function estimateWorkoutFigures(
  workout: FiguredWorkout,
  context?: WorkoutEditorContext
): WorkoutFigures {
  const sport = workout.sport ?? "run";
  if ((workout.distance_km ?? 0) > 0 && !workout.steps?.length) {
    return { distanceMeters: workout.distance_km! * 1000 };
  }
  const leaves = leafSteps(workout.steps);
  if (!leaves.length || !CONVERTING_SPORTS.has(sport)) return {};
  let meters: number | undefined = 0;
  let seconds: number | undefined = 0;
  for (const { step, repeat } of leaves) {
    if (meters === undefined && seconds === undefined) return {};
    const type = targetOf(step);
    const speed = stepSpeed(step, context) ?? (step.kind === "rest" && !hasIntensity(step) ? 0 : undefined);
    if (type === "time") {
      const stepSeconds = (step.target_duration_seconds ?? 0) * repeat;
      if (seconds !== undefined) seconds += stepSeconds;
      if (meters !== undefined) meters = speed === undefined ? undefined : meters + stepSeconds * speed;
    } else if (type === "distance") {
      const stepMeters = (step.target_distance_meters ?? 0) * repeat;
      if (meters !== undefined) meters += stepMeters;
      if (seconds !== undefined) seconds = speed === undefined ? undefined : seconds + (speed > 0 ? stepMeters / speed : 0);
    } else {
      // Open, reps, load, a recovery to a heart rate: no length to add.
      return {};
    }
  }
  return {
    ...(meters ? { distanceMeters: Math.round(meters * 100) / 100 } : {}),
    ...(seconds ? { durationSeconds: Math.round(seconds) } : {})
  };
}

function hasIntensity(step: RunWorkoutCreateStep): boolean {
  return step.intensity ? step.intensity.type !== "none" : Boolean(step.intensity_type);
}

/** The intensities COROS turns into a speed; anything else is not handed to the encoder at all. */
const SPEED_INTENSITIES = new Set([
  "heartRate", "heartRatePercent", "lthrPercent", "pace", "effortPace", "thresholdPacePercent", "effortPacePercent"
]);

/** Metres a second COROS drives a step at; undefined where it converts nothing or cannot be known here. */
function stepSpeed(step: RunWorkoutCreateStep, context?: WorkoutEditorContext): number | undefined {
  if (step.intensity && !SPEED_INTENSITIES.has(step.intensity.type)) return undefined;
  const encoded = step.intensity
    ? encodeCorosIntensity(step.intensity, context)
    : {
        intensityType: step.intensity_type ?? 0,
        intensityValue: step.intensity_value ?? 0,
        intensityValueExtend: step.intensity_value_extend ?? 0
      };
  const type = Number(encoded.intensityType ?? 0);
  const low = Number(encoded.intensityValue ?? 0);
  const high = Number(encoded.intensityValueExtend ?? 0);
  switch (type) {
    case 3: // pace, in milliseconds a kilometre
    case 8: // effort pace
      return low > 0 && high > 0 ? 1_000_000 / ((low + high) / 2) : undefined;
    case 2: // heart rate, in bpm
      return low > 0 && high > 0 ? heartRateSpeed(Math.floor((low + high) / 2), context) : undefined;
    default:
      return undefined;
  }
}

/**
 * The speed COROS assumes at a heart rate, as a share of its speed at max HR
 * (`maxHrPaceSecondsPerKm`): 87% at LTHR; under it 1.05997 per unit of
 * heart-rate reserve (measured: 0.0269507 m/s a beat on one account, where
 * a round 1.06 drifts 5 cm a kilometre) and never below the reserve itself,
 * so walking pace runs down to 0 at resting HR; over it straight on to 100%
 * at max HR, and no faster past it.
 */
function heartRateSpeed(bpm: number, context?: WorkoutEditorContext): number | undefined {
  const rest = context?.restingHr;
  const max = context?.maxHr;
  const lthr = context?.lthrBpm;
  const maxHrPace = context?.maxHrPaceSecondsPerKm;
  if (!rest || !max || !lthr || !maxHrPace || !(rest < lthr && lthr < max)) return undefined;
  const reserve = (value: number) => (value - rest) / (max - rest);
  const share = bpm >= max
    ? 1
    : bpm >= lthr
      ? 0.87 + 0.13 * (bpm - lthr) / (max - lthr)
      : Math.max(reserve(bpm), 0.87 + 1.05997 * (reserve(bpm) - reserve(lthr)));
  return Math.max(0, share) * 1000 / maxHrPace;
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}
