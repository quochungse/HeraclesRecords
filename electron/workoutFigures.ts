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
 * **A figure is the whole session's, marked by how it is known**
 * (`FigureMark`). COROS's stored estimate comes first; else COROS's own
 * arithmetic, done here (`estimateWorkoutFigures`), which counts the timed
 * steps into the distance and the distance steps into the time. Written in
 * the steps it is stated as it is, worked out from an intensity "≈", short of
 * a step nothing can be worked out for "+" — never a sum over some of the
 * steps read as the whole session's: a 14 km long run with a timed warm-up
 * and cool-down said "Distance 11.5 km" beside the Calendar's 14.08.
 *
 * Node-free: the renderer imports it as it is.
 */
export interface WorkoutFigures {
  /** The whole session's distance, in metres. */
  distanceMeters?: number;
  /** The whole session's time, in seconds. */
  durationSeconds?: number;
}

/** What a workout's steps add up to, one unit at a time (the Calendar's `computeTotals`). */
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
 * How a figure is known, which every screen marks it by: written in the
 * steps (`exact`, stated as it is), worked out from an intensity the way
 * COROS works it (`estimated`, "≈7.80 km"), or short of steps nothing works
 * out — an open step, an untargeted warm-up's distance, a swim's lengths'
 * time — so only at least that (`atLeast`, "7.80+ km"). A rest stands still:
 * the 0 it adds is exact. A figure both estimated and short is only `atLeast`.
 */
export type FigureMark = "exact" | "estimated" | "atLeast";

const MARK_ORDER: Record<FigureMark, number> = { exact: 0, estimated: 1, atLeast: 2 };

/** The mark of a sum: the least certain of its parts. */
export function combineMarks(...marks: Array<FigureMark | undefined>): FigureMark {
  return marks.reduce<FigureMark>(
    (least, mark) => (mark && MARK_ORDER[mark] > MARK_ORDER[least] ? mark : least),
    "exact"
  );
}

/**
 * A figure's text with its mark: "≈7.80 km", "7.80+ km", "4.5+ hr". The "+"
 * follows the number; a time written in parts ("1h 12m", "5:30") takes it at
 * its end ("1h 12m+").
 */
export function markFigure(text: string, mark: FigureMark | undefined, plusAt: "number" | "end" = "number"): string {
  if (mark === "estimated") return `≈${text}`;
  if (mark !== "atLeast") return text;
  if (plusAt === "end") return `${text}+`;
  return text.replace(/(\d)(?!.*\d)/, "$1+");
}

/** A figure in words, for text a model reads: "about 7.8 km", "at least 7.8 km". */
export function figureInWords(text: string, mark: FigureMark | undefined): string {
  return mark === "estimated" ? `about ${text}` : mark === "atLeast" ? `at least ${text}` : text;
}

/** What a screen states of a workout: each figure and how it is known. A figure that would be 0 is not stated. */
export interface StatedFigures {
  distanceMeters?: number;
  durationSeconds?: number;
  distanceMark: FigureMark;
  durationMark: FigureMark;
  /**
   * The figure is short of a heart-rate step whose speed waits for the
   * account's thresholds (its mark says `atLeast`): a screen still reading
   * them shows it as loading rather than as a figure that is about to change.
   */
  distanceAwaits: boolean;
  durationAwaits: boolean;
}

type FiguredWorkout = Pick<PlanWorkoutEntryInput, "sport" | "steps" | "distance_km">;
type FigureOptions = { coros?: WorkoutFigures; context?: WorkoutEditorContext };

/**
 * The rule for a workout held as steps: COROS's stored estimate figure by
 * figure (`coros`, from `corosProgramFigures`), else COROS's arithmetic done
 * here; each figure marked by how its steps let it be known.
 */
export function statedWorkoutFigures(
  workout: FiguredWorkout,
  options: FigureOptions = {}
): StatedFigures {
  const coros = options.coros ?? {};
  const steps = planFigureSteps(workout, options.context);
  if (!steps.length) {
    const distanceKm = workout.distance_km ?? 0;
    return unmarked({
      distanceMeters: positive(coros.distanceMeters) ?? (distanceKm > 0 ? distanceKm * 1000 : undefined),
      durationSeconds: positive(coros.durationSeconds)
    });
  }
  return statedFromTally(tally(steps), coros, workout.sport ?? "run");
}

/**
 * A COROS program's figures as a screen states them: COROS's stored
 * estimate (else `known`, what a caller already holds of it), else what its
 * steps add up to; marked by its steps either way. COROS's own speeds are
 * not worked out here, so a program COROS left without a figure is stated
 * only as at least its steps in that unit.
 */
export function corosProgramStated(
  program: Record<string, unknown> | undefined,
  known: WorkoutFigures = {}
): StatedFigures {
  const stored = corosProgramFigures(program);
  const coros = {
    distanceMeters: stored.distanceMeters ?? positive(known.distanceMeters),
    durationSeconds: stored.durationSeconds ?? positive(known.durationSeconds)
  };
  const steps = corosFigureSteps(program);
  if (!steps.length) return unmarked(coros);
  return statedFromTally(tally(steps), coros, SPORT_BY_COROS_TYPE[Number(program?.sportType)] ?? "run");
}

function unmarked(figures: WorkoutFigures): StatedFigures {
  return {
    ...(positive(figures.distanceMeters) !== undefined ? { distanceMeters: figures.distanceMeters } : {}),
    ...(positive(figures.durationSeconds) !== undefined ? { durationSeconds: figures.durationSeconds } : {}),
    distanceMark: "exact",
    durationMark: "exact",
    distanceAwaits: false,
    durationAwaits: false
  };
}

/** One step as the figures read it, its repeat's passes folded into `amount`. */
interface FigureStep {
  unit: "time" | "distance" | "none";
  /** Seconds or metres, every pass of it. */
  amount: number;
  rest: boolean;
  /** COROS turns its intensity into a speed (Run and Trail Run only). */
  converts: boolean;
  /** That speed, metres a second; undefined where it waits for the account. */
  speed?: number;
}

/** What steps add up to, and why a figure is short or estimated. */
interface StepTally {
  meters: number;
  seconds: number;
  distanceEstimated: boolean;
  durationEstimated: boolean;
  /** A step adds nothing it has (an untargeted warm-up's distance). */
  distanceShort: boolean;
  durationShort: boolean;
  /** A step with no length at all — open, reps, load — leaves the time short. */
  durationUnitless: boolean;
  distanceAwaits: boolean;
  durationAwaits: boolean;
}

function tally(steps: readonly FigureStep[]): StepTally {
  const sum: StepTally = {
    meters: 0,
    seconds: 0,
    distanceEstimated: false,
    durationEstimated: false,
    distanceShort: false,
    durationShort: false,
    durationUnitless: false,
    distanceAwaits: false,
    durationAwaits: false
  };
  for (const step of steps) {
    if (step.unit === "none") {
      if (!step.rest) {
        sum.distanceShort = true;
        sum.durationUnitless = true;
      }
      continue;
    }
    const timed = step.unit === "time";
    if (timed) sum.seconds += step.amount;
    else sum.meters += step.amount;
    // The other unit goes through the step's speed, or a rest's standing still, or nothing.
    if (step.converts) {
      if (timed) sum.distanceEstimated = true;
      else sum.durationEstimated = true;
      if (step.speed === undefined) {
        if (timed) sum.distanceAwaits = true;
        else sum.durationAwaits = true;
      } else if (timed) {
        sum.meters += step.amount * step.speed;
      } else if (step.speed > 0) {
        sum.seconds += step.amount / step.speed;
      }
    } else if (!step.rest) {
      if (timed) sum.distanceShort = true;
      else sum.durationShort = true;
    }
  }
  return sum;
}

/**
 * A tally's figures, COROS's stored ones first. COROS converted every step
 * its figure counts, so a step waiting here for the account is an estimate
 * there; and on a strength session COROS gives a set of reps or an open hold
 * time of its own, an estimate, where this adds none.
 */
function statedFromTally(sum: StepTally, coros: WorkoutFigures, sport: string): StatedFigures {
  const corosDistance = positive(coros.distanceMeters);
  const corosDuration = positive(coros.durationSeconds);
  const setsTimed = STRENGTH_STYLE_SPORTS.has(sport);
  const distanceMark: FigureMark = sum.distanceShort
    ? "atLeast"
    : !corosDistance && sum.distanceAwaits
      ? "atLeast"
      : sum.distanceEstimated ? "estimated" : "exact";
  const durationMark: FigureMark = sum.durationShort || (sum.durationUnitless && !(corosDuration && setsTimed))
    ? "atLeast"
    : !corosDuration && sum.durationAwaits
      ? "atLeast"
      : sum.durationEstimated || sum.durationUnitless ? "estimated" : "exact";
  const distanceMeters = corosDistance ?? positive(Math.round(sum.meters * 100) / 100);
  const durationSeconds = corosDuration ?? positive(Math.round(sum.seconds));
  return {
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    distanceMark,
    durationMark,
    distanceAwaits: !corosDistance && sum.distanceAwaits,
    durationAwaits: !corosDuration && sum.durationAwaits
  };
}

/** A plan or Coach workout's steps as the figures read them, each driven at COROS's speed for it. */
function planFigureSteps(workout: FiguredWorkout, context?: WorkoutEditorContext): FigureStep[] {
  const converting = CONVERTING_SPORTS.has(workout.sport ?? "run");
  return leafSteps(workout.steps).map(({ step, repeat }) => {
    const type = targetOf(step);
    const unit = type === "time" ? "time" : type === "distance" ? "distance" : "none";
    const amount = unit === "time"
      ? (step.target_duration_seconds ?? 0) * repeat
      : unit === "distance" ? (step.target_distance_meters ?? 0) * repeat : 0;
    const converts = converting && drivesAtSpeed(step);
    return {
      unit,
      amount,
      rest: step.kind === "rest",
      converts,
      ...(converts ? { speed: stepSpeed(step, context) } : {})
    };
  });
}

/** COROS's sport codes, for the figures of a program read straight off COROS. */
const SPORT_BY_COROS_TYPE: Record<number, string> = {
  1: "run", 2: "bike", 3: "swim", 4: "strength", 5: "trailRun", 6: "indoorClimb", 7: "bouldering", 8: "xcSki", 9: "hyrox"
};
const STRENGTH_STYLE_SPORTS = new Set(["strength", "hyrox"]);
/** COROS intensity codes it turns into a speed: heart rate, pace, effort pace. */
const COROS_SPEED_INTENSITY_TYPES = new Set([2, 3, 8]);

/**
 * A COROS program's steps as the figures read them: `targetType` 2 is time,
 * 5 distance in centimetres, anything else (1 open, 3 reps, 6 load…) no
 * length; `exerciseType` 4 is a rest; a group row's `sets` is its repeat
 * count, its steps naming it in `groupId`. No speed: COROS's own figure is
 * the one stated wherever it has one.
 */
function corosFigureSteps(program: Record<string, unknown> | undefined): FigureStep[] {
  const exercises = (Array.isArray(program?.exercises) ? program.exercises : []).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"
  );
  const repeats = new Map<string, number>();
  for (const exercise of exercises) {
    if (exercise.isGroup) repeats.set(String(exercise.id ?? ""), Math.max(1, Number(exercise.sets) || 1));
  }
  const converting = CONVERTING_SPORTS.has(SPORT_BY_COROS_TYPE[Number(program?.sportType)] ?? "");
  return exercises
    .filter((exercise) => !exercise.isGroup)
    .map((exercise) => {
      const targetType = Number(exercise.targetType);
      const value = Math.max(0, Number(exercise.targetValue) || 0);
      const passes = Math.max(1, Number(exercise.sets) || 1) * (repeats.get(String(exercise.groupId ?? "")) ?? 1);
      const unit = targetType === 2 ? "time" : targetType === 5 ? "distance" : "none";
      return {
        unit,
        amount: unit === "time" ? value * passes : unit === "distance" ? (value / 100) * passes : 0,
        rest: Number(exercise.exerciseType) === 4,
        converts: converting && COROS_SPEED_INTENSITY_TYPES.has(Number(exercise.intensityType))
      };
    });
}

/*
 * COROS's arithmetic, probed against `/training/program/calculate` on
 * 2026-11-03 (an account at max HR 190, resting 52, LTHR 168, threshold pace
 * 321, pace zone 6 at 285 s/km; `scripts/test-workout-figures.mjs` holds the
 * answers). Only Run and Trail Run convert an intensity: a ride's heart-rate
 * step is 0 m there, and a swim's stored time is its timed rests alone.
 *
 *   - A step is driven at one speed, from its intensity as the write encodes
 *     it. Pace and effort pace: the middle of the band (300-330 s/km is 315).
 *     Heart rate: the middle bpm, whole (`floor`: 135-156 is 145), through
 *     `heartRateSpeed`. `%`, `hrType` and the zone id are not read.
 *   - No intensity, power or cadence, any step of another sport, an open
 *     step: COROS drives these at 0 — a timed warm-up adds no distance, a
 *     7 km warm-up no time, an open step neither — and so does this, or a
 *     workout nobody has saved would state another figure than the Calendar
 *     beside it once it is. Only a step this cannot convert yet (a heart rate
 *     before the account's thresholds arrive) leaves that figure unknown.
 *   - The session is the sum: distance in centimetres, time in whole seconds.
 *
 * The real 14 km long run (15 min @125-150, 6.5 km @135-156, 5 km @135-160,
 * 5 min @110-145) comes to 14079.74 m and 5883 s, COROS's own figures.
 */
const CONVERTING_SPORTS = new Set(["run", "trailRun"]);

/**
 * COROS's whole-session figures for a workout nobody has saved, as `calculate`
 * would answer: a figure short of a step whose speed waits for the account is
 * left out, as one that comes to 0 is.
 */
export function estimateWorkoutFigures(
  workout: FiguredWorkout,
  context?: WorkoutEditorContext
): WorkoutFigures {
  if ((workout.distance_km ?? 0) > 0 && !workout.steps?.length) {
    return { distanceMeters: workout.distance_km! * 1000 };
  }
  const steps = planFigureSteps(workout, context);
  if (!steps.length) return {};
  const sum = tally(steps);
  return {
    ...(sum.meters > 0 && !sum.distanceAwaits ? { distanceMeters: Math.round(sum.meters * 100) / 100 } : {}),
    ...(sum.seconds > 0 && !sum.durationAwaits ? { durationSeconds: Math.round(sum.seconds) } : {})
  };
}

/** A step whose intensity COROS turns into a speed, on a sport where it does. */
function drivesAtSpeed(step: RunWorkoutCreateStep): boolean {
  return step.intensity
    ? SPEED_INTENSITIES.has(step.intensity.type)
    : COROS_SPEED_INTENSITY_TYPES.has(Number(step.intensity_type ?? 0));
}

/** The intensities COROS turns into a speed; anything else is not handed to the encoder at all. */
const SPEED_INTENSITIES = new Set([
  "heartRate", "heartRatePercent", "lthrPercent", "pace", "effortPace", "thresholdPacePercent", "effortPacePercent"
]);

/** Metres a second COROS drives a step at: 0 where it converts nothing, undefined where it cannot be known here. */
function stepSpeed(step: RunWorkoutCreateStep, context?: WorkoutEditorContext): number | undefined {
  if (step.intensity && !SPEED_INTENSITIES.has(step.intensity.type)) return 0;
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
    default: // none, power, cadence
      return 0;
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
