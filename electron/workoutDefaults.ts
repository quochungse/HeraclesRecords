/**
 * What a newly added workout step starts out holding.
 *
 * `workoutCapabilities.ts` says what a step *may* hold — which targets and
 * which intensities COROS accepts for a sport and a step kind. This file says
 * what it holds before anyone has typed anything, which is a different
 * question and was previously answered by leaving every number blank. A step
 * added that way fails `builderRowValidationMessage` the moment it appears:
 * the validator wants a target greater than zero and the field is `""`.
 *
 * Five rules the table below is built on.
 *
 * **A default must be a valid step.** Every `(sport, stepKind)` here passes
 * `validateWorkoutTarget` and `validateWorkoutIntensity`, and
 * `test:workout-defaults` asserts exactly that. It is the whole reason the
 * file exists, so nothing in it may be "roughly right and the user will fix
 * it".
 *
 * **Intensity is a zone, not a number.** A default says `threshold`, never
 * "165-172 bpm". `encodeCorosIntensity` already turns a preset into figures
 * out of the athlete's own thresholds (`WorkoutEditorContext`), so a preset
 * is right for everyone while an absolute figure is right for one person.
 *
 * **Nothing is invented that COROS does not report.** No default is ever a
 * `load` target: `/training/program/query` answers `0` for `trainingLoad` on
 * every row, and a load can only be obtained from a `calculate` POST — so a
 * prefilled one would be a number this app made up.
 *
 * **No default states a weight.** A load is the one figure that is both
 * wholly personal and capable of hurting someone, so a movement that takes
 * equipment starts at `none` and the athlete says what they are lifting.
 * Only bodyweight movements default to `{ weight, bodyweight }`.
 *
 * **A default degrades to what the athlete has.** Percent-of-FTP is
 * meaningless without an FTP — the preset would draw no figure at all — so
 * without one it falls back to percent-of-max-HR, and without a max HR to
 * `none`. Two lines of code, not a mechanism.
 *
 * It lives in `electron/` beside the capability table and is imported
 * directly by the renderer, like `activityMetrics.ts` and `sleepMetrics.ts`,
 * so the builder and the coach's workout tools cannot disagree about what an
 * unstated step means. **It must stay free of `node:` imports** or the
 * renderer build breaks; the suite asserts that too.
 */
import type {
  RunWorkoutEditorStepKind,
  RunWorkoutEditorTarget,
  WorkoutClimbSystem,
  WorkoutEditorContext,
  WorkoutFtpPreset,
  WorkoutHeartRateBasis,
  WorkoutHeartRatePreset,
  WorkoutIntensityInput,
  WorkoutPacePreset,
  WorkoutSport,
  WorkoutSwimStroke
} from "./types";
import {
  classifyWorkoutExerciseName,
  type ExerciseSearchEquipment,
  type ExerciseSearchMovement
} from "./exerciseCatalogSearch";
import {
  WORKOUT_SPORT_CAPABILITIES,
  normalizeWorkoutExerciseName,
  workoutIntensitiesForStep,
  workoutTargetsForStep,
  type WorkoutTargetType
} from "./workoutCapabilities";

export interface StepDefaults {
  /**
   * Canonical units throughout — metres and seconds — never the display unit.
   * A 400 m interval is 400 m for an athlete on miles too; the renderer
   * converts on the way into its field, as it already does for everything
   * else a step carries.
   */
  target: RunWorkoutEditorTarget;
  intensity: WorkoutIntensityInput;
  /** Strength training steps only: sets, and the recovery between them. */
  sets?: number;
  restSeconds?: number;
  /** Pool Swim send-off steps only. */
  sendOffSeconds?: number;
}

export interface StepDefaultsInput {
  sport: WorkoutSport;
  stepKind: RunWorkoutEditorStepKind;
  /**
   * A step inside a repeat group is one rep of something, not the session:
   * it is shorter, it is harder, and its rest is the gap between reps.
   */
  insideRepeat?: boolean;
  /** Strength and Hybrid Fitness: the movement this step is built around. */
  exerciseName?: string;
  /**
   * COROS's own kind for a Hybrid Fitness station. It narrows which targets
   * and intensities are legal, and nothing else — the figures come from the
   * movement's name, because the meaning of a kind number is not published
   * and would have to be guessed.
   */
  exerciseKind?: number;
  context?: WorkoutEditorContext;
}

// ---------------------------------------------------------------------------
// Target and intensity shorthands, so the table below reads as a table.
// ---------------------------------------------------------------------------

const time = (seconds: number): RunWorkoutEditorTarget => ({ type: "time", seconds });
const distance = (meters: number): RunWorkoutEditorTarget => ({ type: "distance", meters });
const reps = (count: number): RunWorkoutEditorTarget => ({ type: "reps", count });
const routes = (count: number): RunWorkoutEditorTarget => ({ type: "routes", count });

const NONE: WorkoutIntensityInput = { type: "none" };

/**
 * The bands a default asks for, named for what they are rather than for what
 * COROS calls them.
 *
 * It has to be this way round because **COROS names the same band differently
 * per family**: the easy aerobic band is "Aerobic" on Max HR and "Aerobic
 * Endurance" on Heart Rate Reserve and LTHR. A table that stated a preset
 * directly would be stating one family's vocabulary, and the athlete's account
 * may be scored in another.
 */
type HeartRateBand = "recovery" | "warmUp" | "aerobic" | "threshold";

const HEART_RATE_PRESET_BY_BAND: Readonly<Record<
  WorkoutHeartRateBasis,
  Readonly<Record<HeartRateBand, WorkoutHeartRatePreset>>
>> = {
  maxHr: {
    recovery: "recovery",
    warmUp: "warmUp",
    aerobic: "aerobic",
    threshold: "threshold"
  },
  // Neither of these families has a warm-up band of its own; the easy aerobic
  // one is where a warm-up sits.
  reserve: {
    recovery: "recovery",
    warmUp: "aerobicEndurance",
    aerobic: "aerobicEndurance",
    threshold: "threshold"
  },
  lthr: {
    recovery: "recovery",
    warmUp: "aerobicEndurance",
    aerobic: "aerobicEndurance",
    threshold: "threshold"
  }
};

/** A band, resolved against Max HR until `resolveStepDefaults` knows better. */
const hr = (band: HeartRateBand): WorkoutIntensityInput =>
  ({ type: "heartRatePercent", basis: "maxHr", preset: HEART_RATE_PRESET_BY_BAND.maxHr[band] });

/** The band a Max HR preset stands for, so it can be restated in any family. */
const HEART_RATE_BAND_BY_MAXHR_PRESET: Readonly<Partial<Record<string, HeartRateBand>>> = {
  recovery: "recovery",
  warmUp: "warmUp",
  fatBurn: "warmUp",
  aerobic: "aerobic",
  threshold: "threshold"
};

/**
 * Restate a heart-rate zone in the family the account is actually scored
 * against. COROS aggregates every activity against one `hrZoneType`, so a
 * step prescribed in another family would be read back in one the watch does
 * not use.
 */
export function withHeartRateBasis(
  intensity: WorkoutIntensityInput,
  basis: WorkoutHeartRateBasis | undefined
): WorkoutIntensityInput {
  if (intensity.type !== "heartRatePercent" || !basis || basis === intensity.basis) {
    return intensity;
  }
  const band = HEART_RATE_BAND_BY_MAXHR_PRESET[presetOf(intensity) ?? ""];
  return band
    ? { type: "heartRatePercent", basis, preset: HEART_RATE_PRESET_BY_BAND[basis][band] }
    : intensity;
}
const pacePercent = (preset: WorkoutPacePreset): WorkoutIntensityInput =>
  ({ type: "thresholdPacePercent", preset });
const ftpPercent = (preset: WorkoutFtpPreset): WorkoutIntensityInput =>
  ({ type: "ftpPercent", preset });
const swimStroke = (stroke: WorkoutSwimStroke): WorkoutIntensityInput =>
  ({ type: "swimStroke", stroke });
const climbGrade = (
  system: WorkoutClimbSystem,
  relativeToOnsight: number
): WorkoutIntensityInput => ({ type: "climbGrade", system, relativeToOnsight });

const MINUTE = 60;

/**
 * The climbing grade a warm-up and a cool-down are pitched at: three grades
 * below what the athlete can onsight. `validateWorkoutIntensity` allows
 * -8 through +4.
 */
const EASY_CLIMB_OFFSET = -3;

type StepDefaultKey =
  | "warmup"
  | "training"
  | "trainingInRepeat"
  | "rest"
  | "restInRepeat"
  | "cooldown"
  | "sendOff";

type SportDefaults = Partial<Record<StepDefaultKey, StepDefaults>>;

/**
 * Table A: what each sport starts a step of each kind at.
 *
 * `trainingInRepeat` and `restInRepeat` are optional; a sport that does not
 * state them uses its plain `training` / `rest` entry.
 */
const SPORT_STEP_DEFAULTS: Readonly<Record<WorkoutSport, SportDefaults>> = {
  run: {
    warmup: { target: time(10 * MINUTE), intensity: hr("warmUp") },
    training: { target: time(20 * MINUTE), intensity: pacePercent("aerobicEndurance") },
    trainingInRepeat: { target: distance(400), intensity: pacePercent("threshold") },
    rest: { target: time(2 * MINUTE), intensity: NONE },
    restInRepeat: { target: time(90), intensity: NONE },
    cooldown: { target: time(10 * MINUTE), intensity: hr("recovery") }
  },
  trailRun: {
    warmup: { target: time(10 * MINUTE), intensity: hr("warmUp") },
    training: { target: time(30 * MINUTE), intensity: hr("aerobic") },
    trainingInRepeat: { target: time(3 * MINUTE), intensity: hr("threshold") },
    rest: { target: time(2 * MINUTE), intensity: NONE },
    cooldown: { target: time(10 * MINUTE), intensity: hr("recovery") }
  },
  bike: {
    warmup: { target: time(10 * MINUTE), intensity: ftpPercent("recovery") },
    training: { target: time(30 * MINUTE), intensity: ftpPercent("aerobicEndurance") },
    trainingInRepeat: { target: time(5 * MINUTE), intensity: ftpPercent("threshold") },
    rest: { target: time(3 * MINUTE), intensity: ftpPercent("recovery") },
    cooldown: { target: time(10 * MINUTE), intensity: ftpPercent("recovery") }
  },
  xcSki: {
    warmup: { target: time(10 * MINUTE), intensity: hr("warmUp") },
    training: { target: time(30 * MINUTE), intensity: hr("aerobic") },
    trainingInRepeat: { target: time(5 * MINUTE), intensity: hr("threshold") },
    rest: { target: time(3 * MINUTE), intensity: NONE },
    cooldown: { target: time(10 * MINUTE), intensity: hr("recovery") }
  },
  swim: {
    warmup: { target: distance(200), intensity: swimStroke("freestyle") },
    training: { target: distance(200), intensity: swimStroke("freestyle") },
    trainingInRepeat: { target: distance(100), intensity: swimStroke("freestyle") },
    rest: { target: time(30), intensity: NONE },
    restInRepeat: { target: time(20), intensity: NONE },
    cooldown: { target: distance(100), intensity: swimStroke("freestyle") },
    sendOff: {
      target: distance(100),
      intensity: swimStroke("freestyle"),
      sendOffSeconds: 2 * MINUTE
    }
  },
  strength: {
    // Strength durations are stated in seconds, not minutes: `rowToStep`
    // encodes them as-is and the field is labelled "Duration (sec)". Five
    // minutes of warming up is 300 here, and writing 5 would be five seconds.
    warmup: { target: time(5 * MINUTE), intensity: NONE },
    // Overridden per movement by Table B; this is what an unrecognised
    // movement falls back to.
    training: { target: reps(10), intensity: NONE, sets: 3, restSeconds: 90 },
    rest: { target: time(90), intensity: NONE },
    cooldown: { target: time(5 * MINUTE), intensity: NONE }
  },
  indoorClimb: {
    warmup: { target: time(10 * MINUTE), intensity: climbGrade("yds", EASY_CLIMB_OFFSET) },
    training: { target: routes(4), intensity: climbGrade("yds", 0) },
    trainingInRepeat: { target: routes(1), intensity: climbGrade("yds", 0) },
    rest: { target: time(3 * MINUTE), intensity: climbGrade("yds", EASY_CLIMB_OFFSET) },
    cooldown: { target: time(10 * MINUTE), intensity: climbGrade("yds", EASY_CLIMB_OFFSET) }
  },
  bouldering: {
    warmup: { target: time(10 * MINUTE), intensity: climbGrade("vScale", EASY_CLIMB_OFFSET) },
    training: { target: routes(5), intensity: climbGrade("vScale", 0) },
    trainingInRepeat: { target: routes(1), intensity: climbGrade("vScale", 0) },
    rest: { target: time(3 * MINUTE), intensity: climbGrade("vScale", EASY_CLIMB_OFFSET) },
    cooldown: { target: time(10 * MINUTE), intensity: climbGrade("vScale", EASY_CLIMB_OFFSET) }
  },
  hyrox: {
    warmup: { target: time(10 * MINUTE), intensity: NONE },
    // Overridden per station by Table C.
    training: { target: time(5 * MINUTE), intensity: NONE },
    trainingInRepeat: { target: time(3 * MINUTE), intensity: NONE },
    rest: { target: time(MINUTE), intensity: NONE },
    cooldown: { target: time(5 * MINUTE), intensity: NONE }
  }
};

// ---------------------------------------------------------------------------
// Layer 3a — Table B: the movement a Strength step is built around.
//
// Not a list of exercises. COROS's catalog is a few hundred movements and a
// table of that size would be a second catalog to keep in step with theirs.
// The two rule sets the app already owns do the filing instead:
// `classifyWorkoutExerciseName` reads a movement pattern and the equipment off
// the name, and the exercise picker and the coach's `search_coros_exercises`
// read the same rules — so three surfaces cannot disagree about what a bench
// press is.
// ---------------------------------------------------------------------------

interface MovementDefaults {
  target: RunWorkoutEditorTarget;
  sets: number;
  restSeconds: number;
}

const MOVEMENT_DEFAULTS: Readonly<Record<ExerciseSearchMovement, MovementDefaults>> = {
  hinge: { target: reps(6), sets: 4, restSeconds: 150 },
  squat: { target: reps(8), sets: 4, restSeconds: 120 },
  push: { target: reps(8), sets: 4, restSeconds: 120 },
  pull: { target: reps(8), sets: 4, restSeconds: 120 },
  lunge: { target: reps(10), sets: 3, restSeconds: 90 },
  core: { target: reps(15), sets: 3, restSeconds: 45 },
  carry: { target: time(45), sets: 3, restSeconds: 90 },
  conditioning: { target: reps(15), sets: 4, restSeconds: 60 },
  climb: { target: time(30), sets: 4, restSeconds: 120 },
  mobility: { target: time(45), sets: 1, restSeconds: 15 }
};

/**
 * Which pattern wins when a name matches several, most specific first.
 *
 * `classifyWorkoutExerciseName` returns every rule that matched rather than
 * one, and plenty of movements match two — a jump squat is a squat and it is
 * conditioning, and it is prescribed like conditioning.
 *
 * Two known skews, left as they are because a special case here would be a
 * third rule set: a kettlebell swing files as `hinge` and so starts at 6 reps
 * where it is usually swung for more, and a mountain climber files as `climb`
 * on the word alone — which lands it on a 30-second hold, close enough to how
 * it is actually done that correcting it would cost more than it returns.
 */
const MOVEMENT_PRIORITY: readonly ExerciseSearchMovement[] = [
  "mobility",
  "climb",
  "carry",
  "conditioning",
  "hinge",
  "squat",
  "lunge",
  "push",
  "pull",
  "core"
];

/**
 * Movements held rather than repeated. A wall sit files as a squat and a
 * plank as core, and both are counted in seconds — so the hold decides the
 * target while the movement still decides the sets and the recovery.
 *
 * It only overrides a target measured in reps: `carry`, `climb` and
 * `mobility` already answer in seconds, and their own figure is the better
 * one.
 */
const ISOMETRIC_HOLD = /\b(plank|wall sit|dead bug|hollow|l sit|bird dog|hang|isometric|superman)\b/;

/** The equipment that means the athlete is carrying a load this app cannot know. */
const LOADED_EQUIPMENT: readonly ExerciseSearchEquipment[] = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "cable",
  "sled",
  "medicine_ball"
];

function movementOf(name: string): ExerciseSearchMovement | undefined {
  const matched = new Set(classifyWorkoutExerciseName(name).movementPatterns);
  return MOVEMENT_PRIORITY.find((movement) => matched.has(movement));
}

/**
 * What the step says about load.
 *
 * A movement that takes equipment says nothing, because the only honest
 * answer is the one the athlete gives. A movement that does not is a
 * bodyweight movement and may say so. Mobility work is neither, so it also
 * says nothing.
 */
function loadIntensity(name: string, movement: ExerciseSearchMovement | undefined): WorkoutIntensityInput {
  if (movement === "mobility") return NONE;
  const { equipment } = classifyWorkoutExerciseName(name);
  if (equipment.some((entry) => LOADED_EQUIPMENT.includes(entry))) return NONE;
  return equipment.length > 0 ? { type: "weight", mode: "bodyweight" } : NONE;
}

function strengthTrainingDefaults(
  name: string | undefined,
  fallback: StepDefaults
): StepDefaults {
  if (!name?.trim()) return fallback;
  const movement = movementOf(name);
  if (!movement) return { ...fallback, intensity: loadIntensity(name, undefined) };
  const base = MOVEMENT_DEFAULTS[movement];
  const held = base.target.type === "reps"
    && ISOMETRIC_HOLD.test(normalizeWorkoutExerciseName(name));
  return {
    target: held ? time(45) : base.target,
    sets: base.sets,
    restSeconds: base.restSeconds,
    intensity: loadIntensity(name, movement)
  };
}

// ---------------------------------------------------------------------------
// Layer 3b — Table C: a Hybrid Fitness station.
//
// Keyed off the movement's name, not off COROS's `exerciseKind`. The kinds are
// a closed set of numbers whose meaning COROS does not publish; reading them
// would mean guessing which number is the sled and which is the SkiErg, and a
// wrong guess would put a sled's 50 m on a rower. A name is a name.
//
// `exerciseKind` keeps the job it already had — narrowing which targets and
// intensities are legal — and `coerce` applies it after this.
//
// The figures are the competition distances, which is the only published set
// of numbers a Hybrid Fitness athlete measures themselves against. Every
// alternative would be a training distance this app made up.
// ---------------------------------------------------------------------------

const STATION_DEFAULTS: readonly {
  match: RegExp;
  target: RunWorkoutEditorTarget;
}[] = [
  { match: /\bski ?erg\b/, target: distance(1_000) },
  { match: /\brow(ing|er)?\b/, target: distance(1_000) },
  { match: /\b(run|running|roxzone)\b/, target: distance(1_000) },
  { match: /\bsled push\b/, target: distance(50) },
  { match: /\bsled pull\b/, target: distance(50) },
  { match: /\bburpee broad jump\b/, target: distance(80) },
  { match: /\bfarmer/, target: distance(200) },
  { match: /\bsandbag lunge/, target: distance(100) },
  { match: /\bwall ?ball/, target: reps(100) }
];

/**
 * One rep of a station rather than the station.
 *
 * The long pieces halve — half a SkiErg, half a row, fifty wall balls. The
 * short ones do not, because a 50 m sled push is already one effort and half
 * of it is not a smaller version of the same thing.
 */
function halveForRepeat(target: RunWorkoutEditorTarget): RunWorkoutEditorTarget {
  if (target.type === "distance" && target.meters >= 200) {
    return distance(Math.round(target.meters / 2));
  }
  if (target.type === "reps" && target.count >= 40) {
    return reps(Math.round(target.count / 2));
  }
  return target;
}

function hyroxTrainingDefaults(
  name: string | undefined,
  insideRepeat: boolean,
  fallback: StepDefaults
): StepDefaults {
  if (!name?.trim()) return fallback;
  const normalized = normalizeWorkoutExerciseName(name);
  const station = STATION_DEFAULTS.find((entry) => entry.match.test(normalized));
  if (!station) return fallback;
  return {
    target: insideRepeat ? halveForRepeat(station.target) : station.target,
    // Every station is left unstated: a weight is the athlete's to give, and
    // `coerce` reaches for RPE where COROS refuses to accept nothing.
    intensity: NONE
  };
}

// ---------------------------------------------------------------------------
// Layer 4: what the athlete's own numbers allow.
// ---------------------------------------------------------------------------

/**
 * The heart-rate zone that stands for a pace or power zone of the same name.
 *
 * Only the four presets the table above actually reaches are listed. A fifth
 * would need a considered answer rather than a nearest match, and leaving it
 * out means the fallback is `none` — which says nothing, where a wrong zone
 * would say something false.
 */
const HEART_RATE_EQUIVALENT: Readonly<Partial<Record<string, HeartRateBand>>> = {
  recovery: "recovery",
  warmUp: "warmUp",
  aerobicEndurance: "aerobic",
  threshold: "threshold"
};

function presetOf(intensity: WorkoutIntensityInput): string | undefined {
  return "preset" in intensity && typeof intensity.preset === "string"
    ? intensity.preset
    : undefined;
}

/** The heart-rate equivalent of a zone the athlete has no reference for. */
function withoutReference(intensity: WorkoutIntensityInput): WorkoutIntensityInput {
  const band = HEART_RATE_EQUIVALENT[presetOf(intensity) ?? ""];
  return band ? hr(band) : NONE;
}

/**
 * A zone the athlete has no threshold behind draws no figure, so it is worse
 * than saying nothing. Percent-of-FTP needs an FTP, percent-of-threshold-pace
 * needs a threshold pace, and percent-of-max-HR needs a max HR — which COROS
 * fills in from the account, so the last of those rarely bites.
 */
function degradeIntensity(
  intensity: WorkoutIntensityInput,
  context: WorkoutEditorContext | undefined
): WorkoutIntensityInput {
  // No context at all is "not asked yet", not "the athlete has no FTP". The
  // builder mounts before COROS answers, and degrading on a missing answer
  // would put the first paint of every session on a zone the athlete does
  // have — with nothing to raise it again once the answer landed.
  if (!context) return intensity;
  if (intensity.type === "ftpPercent" && !context?.ftp) {
    return degradeIntensity(withoutReference(intensity), context);
  }
  if (intensity.type === "thresholdPacePercent" && !context?.thresholdPaceSecondsPerKm) {
    return degradeIntensity(withoutReference(intensity), context);
  }
  if (intensity.type === "heartRatePercent" && !context?.maxHr) return NONE;
  return intensity;
}

/** Metres of water one length of the athlete's pool is. */
function poolLengthMeters(context: WorkoutEditorContext | undefined): number | undefined {
  const pool = context?.defaultPoolLength;
  if (!pool || !Number.isFinite(pool.value) || pool.value <= 0) return undefined;
  return pool.unit === "yd" ? pool.value * 0.9144 : pool.value;
}

/**
 * A swim set is counted in lengths, so a distance that is not a whole number
 * of them is a distance nobody can swim. Rounded to the nearest metre after
 * the fact, because a 33⅓ m pool otherwise answers 199.98.
 */
function snapToPool(
  target: RunWorkoutEditorTarget,
  context: WorkoutEditorContext | undefined
): RunWorkoutEditorTarget {
  if (target.type !== "distance") return target;
  const pool = poolLengthMeters(context);
  if (!pool) return target;
  const lengths = Math.max(1, Math.round(target.meters / pool));
  return distance(Math.round(lengths * pool));
}

/**
 * The climbing system the athlete grades in, which is a setting rather than a
 * property of the route.
 */
function withClimbSystem(
  intensity: WorkoutIntensityInput,
  sport: WorkoutSport,
  context: WorkoutEditorContext | undefined
): WorkoutIntensityInput {
  if (intensity.type !== "climbGrade") return intensity;
  if (sport !== "indoorClimb" && sport !== "bouldering") return intensity;
  const system = context?.climbSystems?.[sport];
  return system ? { ...intensity, system } : intensity;
}

// ---------------------------------------------------------------------------
// The guard: whatever the layers above produced, it has to be legal.
// ---------------------------------------------------------------------------

/** A serviceable value for a target type reached through the fallback. */
function fallbackTarget(type: WorkoutTargetType): RunWorkoutEditorTarget {
  switch (type) {
    case "time": return time(10 * MINUTE);
    case "distance": return distance(1_000);
    case "reps": return reps(10);
    case "routes": return routes(4);
    case "elevationGain": return { type: "elevationGain", meters: 100 };
    case "hrRecovery": return { type: "hrRecovery", bpm: 120 };
    // A load target is never chosen on purpose (COROS reports 0 for every
    // one), so this arm exists only so the switch is total.
    case "load": return { type: "load", load: 0 };
    case "open": return { type: "open" };
  }
}

/**
 * The intensity to reach for when the one a layer proposed is not on offer.
 *
 * In order of how little it claims. `none` says nothing and is always first
 * choice — but a Hybrid Fitness station does not always offer it: COROS gives
 * the sled and the wall balls `["weight", "rpe"]` and nothing else, so
 * something has to be said. RPE is what says least: it is an effort the
 * athlete is being asked for, not a figure this app has invented on their
 * behalf, which is what an added weight would be.
 */
const FALLBACK_INTENSITY_ORDER = [
  "none",
  "rpe",
  "swimStroke",
  "weight",
  "climbGrade",
  "cadence"
] as const;

/** RPE 6 of 10: working, and not the day's hard effort. */
const MODERATE_RPE = 6;

function fallbackIntensity(
  sport: WorkoutSport,
  intensities: readonly string[]
): WorkoutIntensityInput {
  for (const type of FALLBACK_INTENSITY_ORDER) {
    if (!intensities.includes(type)) continue;
    switch (type) {
      case "none": return NONE;
      case "rpe": return { type: "rpe", value: MODERATE_RPE };
      case "swimStroke": return swimStroke("freestyle");
      case "weight": return { type: "weight", mode: "bodyweight" };
      case "climbGrade": return WORKOUT_SPORT_CAPABILITIES[sport].defaultIntensity;
      case "cadence": return {
        type: "cadence",
        low: 80,
        high: 90,
        unit: sport === "bike" ? "rpm" : "spm"
      };
    }
  }
  return WORKOUT_SPORT_CAPABILITIES[sport].defaultIntensity;
}

/**
 * Whatever a layer proposed, only what the sport accepts may leave here.
 *
 * This is what makes a wrong guess cheap. Table C keys its figures off a
 * station's name, which is a guess about COROS's catalog; a guess that misses
 * produces a number for a target the sport does not take, and this turns that
 * into the sport's own first target rather than into an invalid step.
 */
function coerce(
  defaults: StepDefaults,
  input: StepDefaultsInput
): StepDefaults {
  const { sport, stepKind, exerciseKind } = input;
  const targets = workoutTargetsForStep(sport, stepKind, exerciseKind);
  const intensities = workoutIntensitiesForStep(sport, stepKind, exerciseKind);
  const target = targets.includes(defaults.target.type)
    ? defaults.target
    : fallbackTarget(targets[0] ?? "open");
  // `lthrPercent` is read-compatibility for old drafts and is not a type any
  // default may carry, so it fails the check rather than being cast past it.
  const intensity = defaults.intensity.type !== "lthrPercent"
    && intensities.includes(defaults.intensity.type)
    ? defaults.intensity
    : fallbackIntensity(sport, intensities);
  return { ...defaults, target, intensity };
}

// ---------------------------------------------------------------------------

function baseDefaults(input: StepDefaultsInput): StepDefaults {
  const table = SPORT_STEP_DEFAULTS[input.sport];
  const { stepKind, insideRepeat } = input;
  if (insideRepeat && stepKind === "training" && table.trainingInRepeat) {
    return table.trainingInRepeat;
  }
  if (insideRepeat && stepKind === "rest" && table.restInRepeat) {
    return table.restInRepeat;
  }
  return table[stepKind] ?? table.training ?? { target: time(10 * MINUTE), intensity: NONE };
}

/**
 * What a step of this kind starts out holding, for this sport, this movement
 * and this athlete.
 *
 * Pure: the same input always answers the same way. It reads no preference,
 * no storage and no database, which is deliberate — a prefilled value that
 * depends on what was filled in last time is a different feature, and one
 * that makes today's interval inherit yesterday's warm-up.
 */
export function resolveStepDefaults(input: StepDefaultsInput): StepDefaults {
  const { sport, stepKind, insideRepeat = false, exerciseName, context } = input;
  const table = baseDefaults(input);
  const base = stepKind !== "training"
    ? table
    : sport === "strength"
      ? strengthTrainingDefaults(exerciseName, table)
      : sport === "hyrox"
        ? hyroxTrainingDefaults(exerciseName, insideRepeat, table)
        : table;
  const intensity = withHeartRateBasis(
    withClimbSystem(degradeIntensity(base.intensity, context), sport, context),
    context?.heartRateBasis
  );
  const target = sport === "swim" ? snapToPool(base.target, context) : base.target;
  return coerce({ ...base, target, intensity }, input);
}
