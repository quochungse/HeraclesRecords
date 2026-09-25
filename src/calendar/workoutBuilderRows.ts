/**
 * The workout builder's rows, without the builder.
 *
 * One builder writes every workout in the app: Create workout (Calendar and
 * Training Library), a plan session (new and edited) and Edit workout in the
 * Training Library. This is the part of it a test can reach — the row model,
 * its defaults, its validator and its encoder, moved here unchanged from
 * `AddWorkoutModal`, plus the two conversions an edit needs:
 * `editorDraftToBuilderRows` reads a workout into rows and
 * `builderRowsToEditorDraft` writes them back.
 *
 * **A row read from a workout remembers the node it was read from**
 * (`BuilderRow.origin`), and a row the athlete did not change writes that node
 * back untouched. That is not an optimisation. A row holds display strings —
 * kilometres to three places, a pace as `mm:ss` — so re-encoding an untouched
 * step would drift it by a metre or a fraction of a second, and it would lose
 * what the builder has no field for: a step's own name, a strength step's
 * instructions, a send-off, and the COROS exercise id that lets a save update
 * the exercise in place instead of replacing it (`workoutDraftToCorosProgram`
 * clones the source exercise by `sourceExerciseId`). A step the builder cannot
 * represent at all arrives `locked` and is carried through as COROS has it,
 * which is what the editor this replaced did with a step it could not edit.
 *
 * It imports nothing from React, so it runs under strip-types:
 * `npm run test:workout-builder-rows`.
 */
import type {
  RunWorkoutEditorDraft,
  RunWorkoutEditorIntensity,
  RunWorkoutEditorNode,
  RunWorkoutEditorRepeatGroup,
  RunWorkoutEditorStep,
  RunWorkoutEditorStepKind,
  RunWorkoutStepInput,
  UnitSystem,
  WorkoutCreateStep,
  WorkoutEditorContext,
  WorkoutExerciseOption,
  WorkoutHeartRateBasis,
  WorkoutIntensityInput,
  WorkoutSport,
  WorkoutSportOptions
} from "../../electron/types";
import type { ExerciseComboboxSelection } from "./ExerciseCombobox";
import {
  displayDistanceToMeters,
  distanceUnit,
  elevationToMeters,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation,
  metersToSwimDistance,
  swimDistanceToMeters,
  swimDistanceUnit
} from "../units/units";
import {
  resolveStepDefaults,
  withHeartRateBasis,
  type StepDefaults
} from "../../electron/workoutDefaults";
import { planWorkoutInputToEditorDraft } from "../../electron/planWorkoutEditor";
import {
  CLIMB_GRADES,
  CLIMB_SYSTEM_IDS,
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  SWIM_STROKE_IDS,
  formatIntensityType,
  validateWorkoutIntensity,
  workoutSportType
} from "../../electron/workoutCapabilities";

/**
 * A pace as it is typed: minutes, a colon, two seconds.
 *
 * `mm` runs 0-99 and `ss` 00-59, which is the whole of the format. Anything
 * else is refused rather than guessed at — "4:75" is not 5:15, it is a typo,
 * and a step built from a guess would reach the watch without the athlete
 * ever seeing what it became.
 */
export const CLOCK_PATTERN = /^(\d{1,2}):([0-5]\d)$/;

export function isClockValue(value: string): boolean {
  return CLOCK_PATTERN.test(value.trim());
}

export function clockSeconds(value: string): number {
  const match = value.trim().match(CLOCK_PATTERN);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export type BuilderKind = "warmup" | "training" | "intervals" | "rest" | "cooldown" | "sendOff";

export interface BuilderRow {
  id: number;
  kind: BuilderKind;
  targetType: "distance" | "time" | "load" | "hrRecovery" | "open" | "reps" | "elevationGain" | "routes";
  /**
   * The one number a step holds itself to, in the unit `targetType` names:
   * kilometres or metres for a distance, minutes for a duration (**seconds**
   * for Strength, which is what `builderTargetLabel` says and what
   * `rowToStep` encodes), reps, routes, bpm or metres of climbing.
   *
   * It is one field because a step has one target. It was two — `distanceKm`
   * and `timeMin` — for eight target types, so reps lived in `distanceKm` and
   * a step's repetitions read as kilometres everywhere they were written.
   */
  targetValue: string;
  /**
   * A pace band, as two clock values rather than one string.
   *
   * Each side is `mm:ss` in the unit on screen — the unit is not typed in, it
   * is whatever the athlete's account measures in, which is what every other
   * figure in this form already does. It was one free-text field holding
   * "4:30-4:45/km", which asked the athlete to type a range, a separator and
   * a unit correctly before the step would validate.
   */
  paceFast: string;
  paceSlow: string;
  // repeat groups only
  repeats: string;
  children?: BuilderRow[];
  sets: string;
  restSeconds: string;
  intensityType: Exclude<WorkoutIntensityInput["type"], "lthrPercent">;
  intensityLow: string;
  intensityHigh: string;
  intensityPreset: string;
  intensityBasis: WorkoutHeartRateBasis;
  intensityUnit: "kg" | "lb" | "km/h" | "mph" | "rpm" | "spm";
  exerciseName: string;
  exerciseId: string;
  exerciseKind?: number;
  /**
   * The node this row was read from, and what the row's fields said when it
   * was. Absent on a row the builder made. See the file header.
   */
  origin?: BuilderRowOrigin;
  /**
   * Why this step cannot be edited here. A locked row is drawn, can be moved
   * and deleted, and is written back as its `origin` node, never re-encoded.
   */
  locked?: string;
  /**
   * The heart-rate family this row's zone was written in, kept.
   *
   * A new row follows the account's family (`syncRowHeartRateBasis`), because
   * its zone is a default. A row read from a workout carries a zone somebody
   * chose, and restating it in another family would change the workout
   * without being asked — so it keeps its own until its intensity or its kind
   * is changed, which is the moment it becomes a default again.
   */
  keepBasis?: boolean;
}

export interface BuilderRowOrigin {
  node: RunWorkoutEditorNode;
  /** `rowFingerprint` of the row as it was read. */
  fingerprint: string;
}

/** The words for each kind, for the parts of the builder that have no icon. */
export const BUILDER_KIND_LABELS: Readonly<Record<BuilderKind, string>> = {
  warmup: "Warm-up",
  training: "Training",
  intervals: "Repeat",
  rest: "Rest",
  cooldown: "Cool-down",
  sendOff: "Send-off"
};

/** Preferred ordering for the quick-add step chips. */
export const BUILDER_ADD_KIND_ORDER: readonly BuilderKind[] = [
  "warmup",
  "training",
  "intervals",
  "rest",
  "cooldown",
  "sendOff"
];

let builderRowId = 0;

/**
 * A step's defaults, expressed in the fields a `BuilderRow` holds.
 *
 * `resolveStepDefaults` answers in canonical metres and seconds, because that
 * is what COROS stores and what a test can check. A row holds display units
 * and strings, because that is what an input is. This is the one place the
 * two meet; nothing else in the builder needs to know a default exists.
 */
export function defaultsToRowFields(
  defaults: StepDefaults,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): Partial<BuilderRow> {
  const { target, intensity } = defaults;
  const targetValue = target.type === "time"
    // Strength states a duration in seconds; every other sport in minutes.
    ? String(sport === "strength" ? target.seconds : round(target.seconds / 60))
    : target.type === "distance"
      ? String(round(sport === "swim"
        ? metersToSwimDistance(target.meters, unitSystem)
        : metersToDisplayDistance(target.meters, unitSystem), 2))
      : target.type === "elevationGain"
        ? String(round(metersToElevation(target.meters, unitSystem)))
        : target.type === "reps" || target.type === "routes"
          ? String(target.count)
          : target.type === "hrRecovery"
            ? String(target.bpm)
            : target.type === "load" ? String(target.load) : "";

  return {
    targetType: target.type,
    targetValue,
    ...intensityToRowFields(intensity, unitSystem),
    ...(defaults.sets !== undefined ? { sets: String(defaults.sets) } : {}),
    ...(defaults.restSeconds !== undefined
      ? { restSeconds: String(defaults.restSeconds) }
      : {})
  };
}

/**
 * Picking a movement reseeds the step's prescription.
 *
 * Choosing an exercise is choosing what the step *is*, so the figures follow
 * it: a deadlift is six reps with a long recovery and a plank is forty-five
 * seconds, and leaving a bench press's eight reps standing on a deadlift
 * would be keeping the shape of a step the athlete just replaced. What the
 * movement says about load follows too — a bar says nothing, a push-up says
 * bodyweight.
 */
export function exerciseSelectionFields(
  selection: ExerciseComboboxSelection,
  sport: WorkoutSport,
  stepKind: RunWorkoutEditorStepKind,
  seed: RowSeed
): Partial<BuilderRow> {
  const defaults = resolveStepDefaults({
    sport,
    stepKind,
    insideRepeat: seed.insideRepeat ?? false,
    exerciseName: selection.name || undefined,
    exerciseKind: selection.exerciseKind,
    context: seed.context
  });
  return {
    exerciseName: selection.name,
    exerciseId: selection.id ?? "",
    exerciseKind: selection.exerciseKind,
    ...defaultsToRowFields(defaults, sport, seed.unitSystem ?? "metric")
  };
}

export function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The inverse of `rowIntensity`, for the shapes a default can take.
 *
 * Only those shapes: a default is a zone or it is nothing, never a band of
 * raw numbers, so there is no arm here for an explicit pace or a heart-rate
 * range. Anything unexpected clears the fields rather than half-filling them.
 */
export function intensityToRowFields(
  intensity: WorkoutIntensityInput,
  unitSystem: UnitSystem
): Partial<BuilderRow> {
  const blank = {
    intensityLow: "",
    intensityHigh: "",
    intensityPreset: "",
    paceFast: "",
    paceSlow: ""
  } satisfies Partial<BuilderRow>;
  switch (intensity.type) {
    case "heartRatePercent":
      return {
        ...blank,
        intensityType: "heartRatePercent",
        intensityBasis: intensity.basis,
        intensityPreset: intensity.preset ?? ""
      };
    case "thresholdPacePercent":
    case "effortPacePercent":
    case "ftpPercent":
      return { ...blank, intensityType: intensity.type, intensityPreset: intensity.preset ?? "" };
    case "swimStroke":
      return { ...blank, intensityType: "swimStroke", intensityPreset: intensity.stroke };
    case "weight":
      return {
        ...blank,
        intensityType: "weight",
        intensityPreset: intensity.mode,
        intensityUnit: unitSystem === "imperial" ? "lb" : "kg"
      };
    case "rpe":
      return { ...blank, intensityType: "rpe", intensityLow: String(intensity.value) };
    case "climbGrade":
      return intensity.relativeToOnsight === undefined
        ? { ...blank, intensityType: "climbGrade", intensityPreset: `${intensity.system}:${intensity.absoluteGrade}` }
        : {
            ...blank,
            intensityType: "climbGrade",
            intensityPreset: `relative:${intensity.system}`,
            intensityLow: String(intensity.relativeToOnsight)
          };
    case "cadence":
      return {
        ...blank,
        intensityType: "cadence",
        intensityLow: String(intensity.low),
        intensityHigh: String(intensity.high),
        intensityUnit: intensity.unit
      };
    default:
      return { ...blank, intensityType: "none" };
  }
}

export interface RowSeed {
  context?: WorkoutEditorContext;
  unitSystem?: UnitSystem;
  /** The step is one rep inside a repeat group rather than the session. */
  insideRepeat?: boolean;
}

/**
 * A step in the state it is added in.
 *
 * Every figure comes from `resolveStepDefaults`, so the builder does not hold
 * a second opinion about what an unstated step means — the coach's workout
 * tools read the same table. What is left here is the row's own bookkeeping:
 * its id, its repeat count, and the two children a repeat group starts with.
 *
 * `seed.context` may be absent because COROS has not answered yet, which is
 * not the same as the athlete having no thresholds; `resolveStepDefaults`
 * tells the two apart.
 */
export function emptyRow(
  kind: BuilderKind,
  sport: WorkoutSport = "run",
  seed: RowSeed = {}
): BuilderRow {
  const stepKind = kind === "intervals" ? "training" : kind;
  const unitSystem = seed.unitSystem ?? "metric";
  const defaults = resolveStepDefaults({
    sport,
    stepKind,
    insideRepeat: seed.insideRepeat ?? false,
    context: seed.context
  });
  builderRowId += 1;
  const row: BuilderRow = {
    id: builderRowId,
    kind,
    targetType: "time",
    targetValue: "",
    paceFast: "",
    paceSlow: "",
    repeats: "4",
    sets: "1",
    restSeconds: "0",
    intensityType: "none",
    intensityLow: "",
    intensityHigh: "",
    intensityPreset: "",
    intensityBasis: "maxHr",
    intensityUnit: sport === "run" || sport === "trailRun" || sport === "hyrox" ? "spm" : "rpm",
    exerciseName: "",
    exerciseId: "",
    ...defaultsToRowFields(defaults, sport, unitSystem)
  };
  return kind === "intervals"
    ? {
        ...row,
        children: [
          emptyRow("training", sport, { ...seed, insideRepeat: true }),
          emptyRow("rest", sport, { ...seed, insideRepeat: true })
        ]
      }
    : row;
}

/**
 * Restate a row's heart-rate zone in the family the account is scored in.
 *
 * The first steps are seeded before COROS has answered, so they carry the Max
 * HR family by default. Once the account arrives, a row still holding the
 * wrong family would send COROS a zone from a table it does not score
 * against — and the preset name would not even be in the list the athlete is
 * shown, so the picker would read "Custom range" for a zone that was chosen.
 *
 * Nothing the athlete typed is touched: the family is not a choice any more,
 * so there is nothing here to overwrite.
 */
export function syncRowHeartRateBasis(
  row: BuilderRow,
  basis: WorkoutHeartRateBasis
): BuilderRow {
  const children = row.children?.map((child) => syncRowHeartRateBasis(child, basis));
  const changed = children?.some((child, index) => child !== row.children?.[index]);
  if (row.keepBasis || row.intensityType !== "heartRatePercent" || row.intensityBasis === basis) {
    return changed ? { ...row, children } : row;
  }
  const restated = withHeartRateBasis(
    { type: "heartRatePercent", basis: row.intensityBasis, preset: row.intensityPreset as never },
    basis
  );
  return {
    ...row,
    ...(children ? { children } : {}),
    intensityBasis: basis,
    intensityPreset: "preset" in restated && restated.preset ? restated.preset : ""
  };
}

/**
 * A copy is a new step: it claims neither the node its source was read from —
 * two rows writing back one COROS exercise would be one exercise — nor, so,
 * anything that node carried and the builder has no field for.
 */
export function cloneBuilderRow(row: BuilderRow): BuilderRow {
  builderRowId += 1;
  const { origin: _origin, ...rest } = row;
  return {
    ...rest,
    id: builderRowId,
    children: row.children?.map(cloneBuilderRow)
  };
}

/**
 * Turning a step into a step of another kind.
 *
 * The figures are reseeded rather than carried over, because a kind is what a
 * step *is*: ten minutes of warming up turned into a rest is not a ten-minute
 * rest, it is a rest, and a rest is two minutes. What survives is what the
 * athlete chose independently of the kind — the movement, the repeat count
 * and the steps already inside a repeat group.
 */
export function changeBuilderRowKind(
  row: BuilderRow,
  kind: BuilderKind,
  sport: WorkoutSport,
  seed: RowSeed = {}
): BuilderRow {
  const stepKind = kind === "intervals" ? "training" : kind;
  const defaults = resolveStepDefaults({
    sport,
    stepKind,
    insideRepeat: seed.insideRepeat ?? false,
    exerciseName: row.exerciseName || undefined,
    exerciseKind: row.exerciseKind,
    context: seed.context
  });
  return {
    ...row,
    kind,
    keepBasis: undefined,
    ...defaultsToRowFields(defaults, sport, seed.unitSystem ?? "metric"),
    children: kind === "intervals"
      ? row.children?.length
        ? row.children
        : [
            emptyRow("training", sport, { ...seed, insideRepeat: true }),
            emptyRow("rest", sport, { ...seed, insideRepeat: true })
          ]
      : row.children
  };
}

export function moveBuilderRow(rows: BuilderRow[], sourceId: number, targetId: number): BuilderRow[] {
  const fromIndex = rows.findIndex((row) => row.id === sourceId);
  const toIndex = rows.findIndex((row) => row.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return rows;
  const nextRows = [...rows];
  const [movedRow] = nextRows.splice(fromIndex, 1);
  if (!movedRow) return rows;
  nextRows.splice(Math.min(toIndex, nextRows.length), 0, movedRow);
  return nextRows;
}

export function paceSeconds(value: string, fallbackUnit: "km" | "mi" = "km"): number {
  const match = value.trim().match(/^(\d+):([0-5]\d)(?:\/(km|mi))?$/i);
  if (!match) return 0;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  const unit = (match[3]?.toLowerCase() ?? fallbackUnit) as "km" | "mi";
  return unit === "mi" ? seconds / 1.609344 : seconds;
}

export function rowIntensity(
  row: BuilderRow,
  unitSystem: UnitSystem
): WorkoutIntensityInput {
  const low = Number(row.intensityLow);
  const high = Number(row.intensityHigh || row.intensityLow);
  const preset = row.intensityPreset;
  switch (row.intensityType) {
    case "heartRate": return { type: "heartRate", lowBpm: low, highBpm: high };
    case "heartRatePercent": return preset ? { type: "heartRatePercent", basis: row.intensityBasis, preset: preset as never } : { type: "heartRatePercent", basis: row.intensityBasis, lowPercent: low, highPercent: high };
    case "pace":
    case "effortPace": {
      const displayUnit = distanceUnit(unitSystem);
      const fast = paceSeconds(row.paceFast, displayUnit);
      const slow = paceSeconds(row.paceSlow, displayUnit);
      return {
        type: row.intensityType,
        lowSecondsPerKm: fast || slow || 300,
        highSecondsPerKm: slow || fast || 300,
        displayUnit
      };
    }
    case "thresholdPacePercent":
    case "effortPacePercent": return preset ? { type: row.intensityType, preset: preset as never } as WorkoutIntensityInput : { type: row.intensityType, lowPercent: low, highPercent: high } as WorkoutIntensityInput;
    case "ftpPercent": return preset ? { type: "ftpPercent", preset: preset as never } : { type: "ftpPercent", lowPercent: low, highPercent: high };
    case "power": return { type: "power", lowWatts: low, highWatts: high };
    case "speed": return { type: "speed", low, high, unit: row.intensityUnit === "mph" ? "mph" : "km/h" };
    case "cadence": return { type: "cadence", low, high, unit: row.intensityUnit === "spm" ? "spm" : "rpm" };
    case "swimStroke": return { type: "swimStroke", stroke: (preset || "freestyle") as keyof typeof SWIM_STROKE_IDS };
    case "weight": return preset === "bodyweight" || !preset ? { type: "weight", mode: "bodyweight" } : { type: "weight", mode: "weight", value: low, unit: row.intensityUnit === "lb" ? "lb" : "kg" };
    case "rpe": return { type: "rpe", value: Math.round(low || 5) };
    case "climbGrade": return preset.startsWith("relative:") ? { type: "climbGrade", system: (preset.split(":")[1] || "yds") as keyof typeof CLIMB_SYSTEM_IDS, relativeToOnsight: Math.round(low || 0) } : { type: "climbGrade", system: (preset.split(":")[0] || "yds") as keyof typeof CLIMB_SYSTEM_IDS, absoluteGrade: preset.split(":")[1] || CLIMB_GRADES.yds[0]! };
    default: return { type: "none" };
  }
}

export function builderRowValidationMessage(
  row: BuilderRow,
  sport: WorkoutSport,
  exerciseOptions: WorkoutExerciseOption[],
  exercisesLoading: boolean,
  unitSystem: UnitSystem
): string | undefined {
  /* Neither is the athlete's to fix here: a locked step is written back as it
     came, and an untouched one as it was read — the shared validator still has
     the last word on the workout it lands in. Holding an untouched strength
     step to "wait for the catalog" would lock Save on a workout nobody edited
     for as long as COROS took to answer. */
  if (row.locked || (row.kind !== "intervals" && rowIsUnchanged(row))) {
    return undefined;
  }
  if (row.kind === "intervals") {
    const repeatCount = Number(row.repeats);
    if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 99) {
      return "Enter between 1 and 99 repeats.";
    }
    if (!row.children?.length) {
      return "Add at least one step inside this repeat.";
    }
    for (const [index, child] of row.children.entries()) {
      if (child.kind === "intervals") {
        return `Sub-step ${index + 1}: nested repeats are not supported.`;
      }
      const message = builderRowValidationMessage(
        child,
        sport,
        exerciseOptions,
        exercisesLoading,
        unitSystem
      );
      if (message) return `Sub-step ${index + 1}: ${message}`;
    }
    return undefined;
  }

  const stepKind = row.kind;
  const targetValue = row.targetValue;
  if (row.targetType !== "open" && !(Number(targetValue) > 0)) {
    return `Enter a valid ${builderTargetLabel(row.targetType, sport, unitSystem).toLocaleLowerCase()}.`;
  }
  if (sport === "strength" && stepKind === "training") {
    if (exercisesLoading) return "Wait for the COROS exercise catalog to finish loading.";
    if (exerciseOptions.length === 0) return "Reconnect COROS to load the exercise catalog.";
    if (!row.exerciseName.trim()) return "Select a COROS exercise for this Strength step.";
    if (!row.exerciseId) return "Choose an exact exercise from the COROS library.";
    if (!Number.isInteger(Number(row.sets)) || Number(row.sets) < 1 || Number(row.sets) > 99) {
      return "Enter between 1 and 99 sets.";
    }
    if (!Number.isFinite(Number(row.restSeconds)) || Number(row.restSeconds) < 0 || Number(row.restSeconds) > 3600) {
      return "Enter rest between 0 and 3600 seconds.";
    }
  }
  // An empty added-weight field reads as 0 and would upload a 0 kg step, so
  // the load has to be stated once "added weight" is the chosen mode.
  if (row.intensityType === "weight"
    && row.intensityPreset === "weight"
    && !(Number(row.intensityLow) > 0)) {
    return `Enter the added weight in ${unitSystem === "imperial" ? "lb" : "kg"}.`;
  }
  if (sport === "hyrox" && row.exerciseName.trim() && !row.exerciseId) {
    return exerciseOptions.length === 0
      ? "Reconnect COROS to load the Hybrid Fitness exercise catalog."
      : "Choose an exact exercise from the COROS library.";
  }
  if (row.intensityType === "pace" || row.intensityType === "effortPace") {
    if (!isClockValue(row.paceFast) || !isClockValue(row.paceSlow)) {
      return `Enter both paces as mm:ss, for example ${unitSystem === "imperial" ? "7:15" : "4:30"}.`;
    }
    if (clockSeconds(row.paceFast) > clockSeconds(row.paceSlow)) {
      return "The first pace is the faster one, so it must be the smaller time.";
    }
  }
  const intensityError = validateWorkoutIntensity(
    sport,
    rowIntensity(row, unitSystem),
    stepKind,
    row.exerciseKind
  );
  return intensityError;
}

export function rowToStep(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem,
  insideRepeat = false
): WorkoutCreateStep {
  if (row.kind === "intervals") {
    throw new Error("Repeat groups cannot be nested inside another repeat group.");
  }
  const rawValue = Number(row.targetValue);
  const target = row.targetType === "distance"
    ? {
        target_type: "distance" as const,
        target_distance_meters: Math.round(
          sport === "swim"
            ? swimDistanceToMeters(rawValue, unitSystem)
            : displayDistanceToMeters(rawValue, unitSystem)
        )
      }
    : row.targetType === "time"
      ? { target_type: "time" as const, target_duration_seconds: Math.round(rawValue * (sport === "strength" ? 1 : 60)) }
      : row.targetType === "load" ? { target_type: "load" as const, target_load: Math.round(rawValue) }
        : row.targetType === "hrRecovery" ? { target_type: "hrRecovery" as const, target_hr_recovery_bpm: Math.round(rawValue) }
          : row.targetType === "reps" ? { target_type: "reps" as const, target_reps: Math.round(rawValue) }
            : row.targetType === "elevationGain" ? { target_type: "elevationGain" as const, target_elevation_gain_meters: elevationToMeters(rawValue, unitSystem) }
              : row.targetType === "routes" ? { target_type: "routes" as const, target_routes: Math.round(rawValue) }
                : { target_type: "open" as const };
  const intensity = { intensity: rowIntensity(row, unitSystem) };
  const exercise = row.exerciseName.trim()
    ? {
        exercise_name: row.exerciseName.trim(),
        ...(row.exerciseId ? { exercise_id: row.exerciseId } : {}),
        ...(row.exerciseKind !== undefined ? { exercise_kind: row.exerciseKind } : {})
      }
    : {};

  const strengthSetDetails = sport === "strength" && row.kind === "training"
    ? {
        sets: Math.max(1, Math.round(Number(row.sets) || 1)),
        rest_type: 1,
        rest_value: Math.max(0, Math.round(Number(row.restSeconds) || 0))
      }
    : {};
  return {
    kind: insideRepeat && row.kind === "training" ? "interval" : row.kind,
    ...target,
    ...intensity,
    ...exercise,
    ...strengthSetDetails
  };
}

export function rowToSteps(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): RunWorkoutStepInput[] {
  if (row.kind === "intervals") {
    return [
      {
        repeat: Math.max(1, Math.round(Number(row.repeats) || 1)),
        name: "Repeat",
        steps: (row.children ?? []).map((child) =>
          rowToStep(child, sport, unitSystem, true)
        )
      }
    ];
  }
  return [rowToStep(row, sport, unitSystem)];
}

export function rowIsValid(
  row: BuilderRow,
  sport: WorkoutSport,
  exerciseOptions: WorkoutExerciseOption[],
  exercisesLoading: boolean,
  unitSystem: UnitSystem
): boolean {
  return builderRowValidationMessage(
    row,
    sport,
    exerciseOptions,
    exercisesLoading,
    unitSystem
  ) === undefined;
}

export function builderTargetLabel(
  target: BuilderRow["targetType"],
  sport: WorkoutSport,
  unitSystem: UnitSystem
): string {
  const labels: Record<BuilderRow["targetType"], string> = {
    distance: sport === "swim"
      ? `Distance (${swimDistanceUnit(unitSystem)})`
      : `Distance (${distanceUnit(unitSystem)})`,
    time: sport === "strength" ? "Duration (sec)" : "Duration (min)",
    load: "Training Load",
    hrRecovery: "Return to heart rate (bpm)",
    open: "Manual end",
    reps: "Repetitions",
    elevationGain: `Elevation gain (${elevationUnit(unitSystem)})`,
    routes: "Routes"
  };
  return labels[target];
}

export function builderTargetTypeLabel(target: BuilderRow["targetType"]): string {
  const labels: Record<BuilderRow["targetType"], string> = {
    distance: "Distance",
    time: "Time",
    load: "Training Load",
    hrRecovery: "HR Recovery",
    open: "Open",
    reps: "Reps",
    elevationGain: "Elevation Gain",
    routes: "Routes"
  };
  return labels[target];
}

export interface BuilderRowSummaryItem {
  label: string;
  value: string;
}

export function builderSummaryRange(low: string, high: string, unit: string): string {
  const start = low.trim();
  const end = high.trim();
  if (!start) return "Not set";
  return `${end && end !== start ? `${start}-${end}` : start}${unit ? ` ${unit}` : ""}`;
}

export function builderIntensitySummary(row: BuilderRow): string {
  switch (row.intensityType) {
    case "none": return "Open";
    case "heartRate": return builderSummaryRange(row.intensityLow, row.intensityHigh, "bpm");
    case "heartRatePercent": {
      const preset = HEART_RATE_PRESETS[row.intensityBasis].find((zone) => zone.preset === row.intensityPreset);
      return preset?.label ?? builderSummaryRange(row.intensityLow, row.intensityHigh, "%");
    }
    case "pace":
    case "effortPace":
      return row.paceFast.trim() && row.paceSlow.trim()
        ? `${row.paceFast.trim()}-${row.paceSlow.trim()}`
        : "Not set";
    case "thresholdPacePercent":
    case "effortPacePercent": {
      const preset = PACE_PRESETS.find((zone) => zone.preset === row.intensityPreset);
      return preset?.label ?? builderSummaryRange(row.intensityLow, row.intensityHigh, "%");
    }
    case "ftpPercent": {
      const preset = FTP_PRESETS.find((zone) => zone.preset === row.intensityPreset);
      return preset?.label ?? builderSummaryRange(row.intensityLow, row.intensityHigh, "% FTP");
    }
    case "power":
      return builderSummaryRange(row.intensityLow, row.intensityHigh, "W");
    case "speed": return builderSummaryRange(row.intensityLow, row.intensityHigh, row.intensityUnit === "mph" ? "mph" : "km/h");
    case "cadence": return builderSummaryRange(row.intensityLow, row.intensityHigh, row.intensityUnit === "spm" ? "spm" : "rpm");
    case "swimStroke": return formatBuilderToken(row.intensityPreset || "freestyle");
    case "weight": return row.intensityPreset === "weight"
      ? builderSummaryRange(row.intensityLow, row.intensityLow, row.intensityUnit === "lb" ? "lb" : "kg")
      : "Bodyweight";
    case "rpe": return `RPE ${row.intensityLow || "5"}`;
    case "climbGrade": return row.intensityPreset.startsWith("relative:")
      ? `${row.intensityLow || "0"} from onsight`
      : row.intensityPreset.split(":")[1] || "Not set";
    default: return formatIntensityType(row.intensityType);
  }
}

export function builderRowSummary(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem,
  /** What to call the row's exercise, when the caller knows better than its
      stored name — a COROS workout names a bench press `T1041`. */
  exerciseLabel?: string
): BuilderRowSummaryItem[] {
  if (row.locked) {
    return [{ label: "Kept as is", value: row.locked }];
  }
  if (row.kind === "intervals") {
    const children = row.children ?? [];
    return [
      {
        label: "Sequence",
        value: children.length
          ? children.map((child) => BUILDER_KIND_LABELS[child.kind]).join(" + ")
          : "No steps"
      },
      {
        label: "Inside",
        value: `${children.length} ${children.length === 1 ? "step" : "steps"}`
      }
    ];
  }
  const rawTarget = row.targetValue.trim();
  const target = row.targetType === "open"
    ? "Manual"
    : row.targetType === "time"
      ? rawTarget ? `${rawTarget} ${sport === "strength" ? "sec" : "min"}` : "Not set"
      : row.targetType === "distance"
        ? rawTarget
          ? `${rawTarget} ${sport === "swim" ? swimDistanceUnit(unitSystem) : distanceUnit(unitSystem)}`
          : "Not set"
        : row.targetType === "load"
          ? rawTarget ? `${rawTarget} TL` : "Not set"
          : row.targetType === "hrRecovery"
            ? rawTarget ? `${rawTarget} bpm` : "Not set"
            : row.targetType === "reps"
              ? rawTarget ? `${rawTarget} reps` : "Not set"
              : row.targetType === "elevationGain"
                ? rawTarget ? `${rawTarget} ${elevationUnit(unitSystem)}` : "Not set"
                : rawTarget ? `${rawTarget} routes` : "Not set";
  const details: BuilderRowSummaryItem[] = [
    { label: builderTargetTypeLabel(row.targetType), value: target },
    { label: "Intensity", value: builderIntensitySummary(row) }
  ];
  const exercise = exerciseLabel?.trim() || row.exerciseName.trim();
  if (exercise) {
    details.splice(1, 0, { label: "Exercise", value: exercise });
  }
  if (sport === "strength" && row.kind === "training") {
    details.push({ label: "Sets", value: row.sets || "Not set" });
    details.push({ label: "Rest", value: `${row.restSeconds || "0"} sec` });
  }
  return details;
}

export interface BuilderWorkoutTotals {
  minutes: number;
  /** Distance in the unit the sport logs (km, or m for pool swims). */
  distance: number;
  distanceUnit: "land" | "swim";
}

/**
 * Best-effort estimate of the workout's moving time and distance. Targets
 * that can't be converted (load, HR recovery, reps, routes, open steps) are
 * skipped — the footer presents these as estimates, never promises.
 */
export function builderWorkoutTotals(rows: BuilderRow[], sport: WorkoutSport): BuilderWorkoutTotals {
  let minutes = 0;
  let distance = 0;
  const addRow = (row: BuilderRow, multiplier = 1) => {
    if (row.locked) return;
    if (row.kind === "intervals") {
      const repeats = Math.max(1, Number(row.repeats) || 1);
      for (const child of row.children ?? []) {
        addRow(child, multiplier * repeats);
      }
      return;
    }
    if (row.targetType === "time") {
      const value = Number(row.targetValue) || 0;
      if (sport === "strength") {
        // Strength time targets are per set, in seconds, with rest between.
        const sets = row.kind === "training" ? Math.max(1, Number(row.sets) || 1) : 1;
        const restSec = row.kind === "training" ? Number(row.restSeconds) || 0 : 0;
        minutes += multiplier * (sets * value + Math.max(0, sets - 1) * restSec) / 60;
      } else {
        minutes += multiplier * value;
      }
    }
    if (row.targetType === "distance") {
      distance += multiplier * (Number(row.targetValue) || 0);
    }
  };
  for (const row of rows) {
    addRow(row);
  }
  return { minutes, distance, distanceUnit: sport === "swim" ? "swim" : "land" };
}

export function builderStructureCounts(rows: BuilderRow[]): {
  steps: number;
  repeatGroups: number;
} {
  return rows.reduce(
    (totals, row) => {
      if (row.kind === "intervals") {
        totals.repeatGroups += 1;
        totals.steps += row.children?.length ?? 0;
      } else {
        totals.steps += 1;
      }
      return totals;
    },
    { steps: 0, repeatGroups: 0 }
  );
}

export function formatBuilderMinutes(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  if (rounded < 60) {
    return `${rounded} min`;
  }
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function formatBuilderDistance(
  distance: number,
  unit: "land" | "swim",
  unitSystem: UnitSystem
): string {
  if (unit === "swim") {
    return `${Math.round(distance).toLocaleString()} ${swimDistanceUnit(unitSystem)}`;
  }
  const rounded = Math.round(distance * 10) / 10;
  return `${rounded.toLocaleString()} ${distanceUnit(unitSystem)}`;
}

export function formatBuilderToken(value: string): string {
  const formatted = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase())
    .replace("Yds", "YDS")
    .replace("Uiaa", "UIAA");
  return formatted === "Warmup" ? "Warm-up" : formatted === "Cooldown" ? "Cool-down" : formatted;
}
/* ================================================= reading a workout in */

/**
 * The fields a row is changed through, as one string. An id, the node it was
 * read from and a repeat group's children are not among them: a child is a
 * row of its own and answers for itself.
 */
export function rowFingerprint(row: BuilderRow): string {
  return JSON.stringify([
    row.kind,
    row.targetType,
    row.targetValue,
    row.paceFast,
    row.paceSlow,
    row.repeats,
    row.sets,
    row.restSeconds,
    row.intensityType,
    row.intensityLow,
    row.intensityHigh,
    row.intensityPreset,
    row.intensityBasis,
    row.intensityUnit,
    row.exerciseName,
    row.exerciseId,
    row.exerciseKind ?? null
  ]);
}

/** A row read from a workout that nobody has changed since. */
export function rowIsUnchanged(row: BuilderRow): boolean {
  return row.origin !== undefined && row.origin.fingerprint === rowFingerprint(row);
}

/** `m:ss`, the form `ClockField` takes and `isClockValue` accepts. */
function paceClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function targetToRowFields(
  target: RunWorkoutEditorStep["target"],
  sport: WorkoutSport,
  unitSystem: UnitSystem
): Pick<BuilderRow, "targetType" | "targetValue"> {
  switch (target.type) {
    case "time":
      // Strength states a duration in seconds; every other sport in minutes.
      return {
        targetType: "time",
        targetValue: String(sport === "strength" ? target.seconds : round(target.seconds / 60, 2))
      };
    case "distance":
      // Three places: a kilometre to the metre, which is what COROS stores.
      return {
        targetType: "distance",
        targetValue: String(round(sport === "swim"
          ? metersToSwimDistance(target.meters, unitSystem)
          : metersToDisplayDistance(target.meters, unitSystem), 3))
      };
    case "load":
      return { targetType: "load", targetValue: String(target.load) };
    case "hrRecovery":
      return { targetType: "hrRecovery", targetValue: String(target.bpm) };
    case "reps":
      return { targetType: "reps", targetValue: String(target.count) };
    case "elevationGain":
      return {
        targetType: "elevationGain",
        targetValue: String(round(metersToElevation(target.meters, unitSystem), 1))
      };
    case "routes":
      return { targetType: "routes", targetValue: String(target.count) };
    case "open":
    default:
      return { targetType: "open", targetValue: "" };
  }
}

/**
 * The inverse of `rowIntensity`, for every shape a stored step can hold.
 *
 * `intensityToRowFields` is the same question for a default, which is only
 * ever a zone or nothing; a workout somebody wrote can hold a band of raw
 * numbers too, so this has an arm for each of those.
 */
function editorIntensityToRowFields(
  intensity: RunWorkoutEditorIntensity,
  unitSystem: UnitSystem
): Partial<BuilderRow> {
  const blank = {
    intensityLow: "",
    intensityHigh: "",
    intensityPreset: "",
    paceFast: "",
    paceSlow: ""
  } satisfies Partial<BuilderRow>;
  const range = (low: number, high: number) => ({
    intensityLow: String(low),
    intensityHigh: String(high)
  });
  switch (intensity.type) {
    case "heartRate":
      return { ...blank, intensityType: "heartRate", ...range(intensity.lowBpm, intensity.highBpm) };
    case "heartRatePercent":
      return {
        ...blank,
        intensityType: "heartRatePercent",
        intensityBasis: intensity.basis,
        keepBasis: true,
        ...(intensity.preset
          ? { intensityPreset: intensity.preset }
          : range(intensity.lowPercent, intensity.highPercent))
      };
    // Read-compatibility shape: a % of threshold heart rate, as a range.
    case "lthrPercent":
      return {
        ...blank,
        intensityType: "heartRatePercent",
        intensityBasis: "lthr",
        keepBasis: true,
        ...range(intensity.lowPercent, intensity.highPercent)
      };
    case "pace":
    case "effortPace": {
      const factor = distanceUnit(unitSystem) === "mi" ? 1.609344 : 1;
      return {
        ...blank,
        intensityType: intensity.type,
        paceFast: paceClock(intensity.lowSecondsPerKm * factor),
        paceSlow: paceClock(intensity.highSecondsPerKm * factor)
      };
    }
    case "thresholdPacePercent":
    case "effortPacePercent":
    case "ftpPercent":
      return {
        ...blank,
        intensityType: intensity.type,
        ...(intensity.preset
          ? { intensityPreset: intensity.preset }
          : range(intensity.lowPercent, intensity.highPercent))
      };
    case "power":
      return { ...blank, intensityType: "power", ...range(intensity.lowWatts, intensity.highWatts) };
    case "speed":
      return {
        ...blank,
        intensityType: "speed",
        ...range(intensity.low, intensity.high),
        intensityUnit: intensity.unit === "mph" ? "mph" : "km/h"
      };
    case "cadence":
      return {
        ...blank,
        intensityType: "cadence",
        ...range(intensity.low, intensity.high),
        intensityUnit: intensity.unit
      };
    case "swimStroke":
      return { ...blank, intensityType: "swimStroke", intensityPreset: intensity.stroke };
    case "weight":
      return intensity.mode === "weight"
        ? {
            ...blank,
            intensityType: "weight",
            intensityPreset: "weight",
            intensityLow: String(intensity.value),
            intensityUnit: intensity.unit
          }
        : {
            ...blank,
            intensityType: "weight",
            intensityPreset: "bodyweight",
            intensityUnit: unitSystem === "imperial" ? "lb" : "kg"
          };
    case "rpe":
      return { ...blank, intensityType: "rpe", intensityLow: String(intensity.value) };
    case "climbGrade":
      return intensity.relativeToOnsight === undefined
        ? { ...blank, intensityType: "climbGrade", intensityPreset: `${intensity.system}:${intensity.absoluteGrade}` }
        : {
            ...blank,
            intensityType: "climbGrade",
            intensityPreset: `relative:${intensity.system}`,
            intensityLow: String(intensity.relativeToOnsight)
          };
    case "none":
    default:
      return { ...blank, intensityType: "none" };
  }
}

function withOrigin(row: BuilderRow, node: RunWorkoutEditorNode): BuilderRow {
  const read: BuilderRow = {
    ...row,
    ...(node.editable ? {} : { locked: node.unsupportedReason ?? "This step is kept as COROS has it." })
  };
  return { ...read, origin: { node, fingerprint: rowFingerprint(read) } };
}

function stepToBuilderRow(
  step: RunWorkoutEditorStep,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): BuilderRow {
  builderRowId += 1;
  const strengthExercise = sport === "strength" && step.kind === "training";
  const row: BuilderRow = {
    id: builderRowId,
    kind: step.kind,
    ...targetToRowFields(step.target, sport, unitSystem),
    paceFast: "",
    paceSlow: "",
    repeats: "4",
    sets: strengthExercise ? String(step.sets ?? 1) : "1",
    restSeconds: strengthExercise ? String(step.restValue ?? 0) : "0",
    intensityType: "none",
    intensityLow: "",
    intensityHigh: "",
    intensityPreset: "",
    intensityBasis: "maxHr",
    intensityUnit: sport === "run" || sport === "trailRun" || sport === "hyrox" ? "spm" : "rpm",
    ...editorIntensityToRowFields(step.intensity, unitSystem),
    exerciseName: step.exerciseName ?? "",
    exerciseId: step.exerciseId ?? "",
    ...(step.exerciseKind !== undefined ? { exerciseKind: step.exerciseKind } : {})
  };
  return withOrigin(row, step);
}

function repeatToBuilderRow(
  group: RunWorkoutEditorRepeatGroup,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): BuilderRow {
  builderRowId += 1;
  const row: BuilderRow = {
    id: builderRowId,
    kind: "intervals",
    targetType: "time",
    targetValue: "",
    paceFast: "",
    paceSlow: "",
    repeats: String(group.repeat),
    sets: "1",
    restSeconds: "0",
    intensityType: "none",
    intensityLow: "",
    intensityHigh: "",
    intensityPreset: "",
    intensityBasis: "maxHr",
    intensityUnit: sport === "run" || sport === "trailRun" || sport === "hyrox" ? "spm" : "rpm",
    exerciseName: "",
    exerciseId: "",
    children: group.steps.map((step) => stepToBuilderRow(step, sport, unitSystem))
  };
  return withOrigin(row, group);
}

/** A workout, as the rows the builder draws. */
export function editorDraftToBuilderRows(
  draft: RunWorkoutEditorDraft,
  unitSystem: UnitSystem
): BuilderRow[] {
  return draft.nodes.map((node) =>
    node.nodeType === "repeat"
      ? repeatToBuilderRow(node, draft.sport, unitSystem)
      : stepToBuilderRow(node, draft.sport, unitSystem)
  );
}

/**
 * The rows a new workout opens with — the three steps of a session, or one
 * exercise for Strength, which is what choosing a sport in the builder resets
 * to.
 */
export function seedBuilderRows(sport: WorkoutSport, seed: RowSeed): BuilderRow[] {
  return sport === "strength"
    ? [emptyRow("training", sport, seed)]
    : [
        emptyRow("warmup", sport, seed),
        emptyRow("training", sport, seed),
        emptyRow("cooldown", sport, seed)
      ];
}

/* ================================================= writing a workout out */

/** What an unnamed step is called — the words the old editor gave a new one. */
function stepTitle(kind: RunWorkoutEditorStepKind): string {
  return kind === "warmup"
    ? "Warm Up"
    : kind === "cooldown"
      ? "Cool Down"
      : kind === "rest"
        ? "Rest"
        : kind === "sendOff"
          ? "Send-off"
          : "Training";
}

/**
 * A new node's id, from its row's. Stable across renders on purpose: the
 * dialog keys its validation and COROS's preview on the draft, and an id
 * minted per call made every render a different draft — and every preview
 * that landed a reason to ask for another.
 */
function draftNodeId(prefix: string, row: BuilderRow): string {
  return `${prefix}-builder-${row.id}`;
}

/**
 * One changed or new row, as an editor step.
 *
 * Encoded through `rowToStep` — the one encoder Create workout uses — and read
 * back through `planWorkoutInputToEditorDraft`, so a step written here means
 * what the same step written in Create workout means.
 *
 * What the builder has no field for is taken from the node the row was read
 * from, and only while that node is still the same step: the same kind, and
 * for an exercise the same exercise. A bench press's name and instructions do
 * not belong on the squat that replaced it.
 */
function rowToEditorStep(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem,
  insideRepeat: boolean
): RunWorkoutEditorStep {
  const origin = row.origin?.node;
  if (origin?.nodeType === "step" && (row.locked || rowIsUnchanged(row))) {
    return structuredClone(origin);
  }
  const encoded = planWorkoutInputToEditorDraft({
    key: "builder-row",
    name: "row",
    sport,
    steps: [rowToStep(row, sport, unitSystem, insideRepeat)]
  }).nodes[0] as RunWorkoutEditorStep;
  const same = origin?.nodeType === "step"
    && origin.kind === encoded.kind
    && (origin.exerciseId ?? "") === (encoded.exerciseId ?? "");
  const exerciseStep = encoded.kind === "training" && (sport === "strength" || sport === "hyrox");
  const {
    overview: _overview,
    sendOffSeconds: _sendOffSeconds,
    ...fields
  } = encoded;
  return {
    ...fields,
    id: origin?.id ?? draftNodeId("step", row),
    ...(origin?.sourceExerciseId ? { sourceExerciseId: origin.sourceExerciseId } : {}),
    name: same
      ? origin.name
      : exerciseStep && encoded.exerciseName?.trim()
        ? encoded.exerciseName.trim()
        : stepTitle(encoded.kind),
    ...(same && origin.overview !== undefined ? { overview: origin.overview } : {}),
    ...(same && origin.sendOffSeconds !== undefined ? { sendOffSeconds: origin.sendOffSeconds } : {}),
    editable: true
  };
}

function rowToEditorNode(
  row: BuilderRow,
  sport: WorkoutSport,
  unitSystem: UnitSystem
): RunWorkoutEditorNode {
  const origin = row.origin?.node;
  if (row.locked && origin) {
    return structuredClone(origin);
  }
  if (row.kind !== "intervals") {
    return rowToEditorStep(row, sport, unitSystem, false);
  }
  return {
    id: origin?.id ?? draftNodeId("group", row),
    ...(origin?.sourceExerciseId ? { sourceExerciseId: origin.sourceExerciseId } : {}),
    nodeType: "repeat",
    name: origin?.nodeType === "repeat" ? origin.name : "Repeat",
    repeat: Math.max(1, Math.round(Number(row.repeats) || 1)),
    steps: (row.children ?? []).map((child) => rowToEditorStep(child, sport, unitSystem, true)),
    editable: true
  };
}

export interface BuilderWorkoutFields {
  sport: WorkoutSport;
  name: string;
  description: string;
  /** Written only for a swim, as Create workout writes it. */
  poolLength?: { value: number; unit: "m" | "yd" };
  /** Written only for a climb, as Create workout writes it. */
  gradingSystem?: keyof typeof CLIMB_SYSTEM_IDS;
}

/**
 * The rows, as the workout an edit saves.
 *
 * `base` is the workout the rows were read from, when they were: its sport
 * options are kept where the builder did not change them, which is what
 * keeps a 25 yd pool a 25 yd pool on an account that reads metric.
 */
export function builderRowsToEditorDraft(
  rows: readonly BuilderRow[],
  fields: BuilderWorkoutFields,
  unitSystem: UnitSystem,
  base?: RunWorkoutEditorDraft
): RunWorkoutEditorDraft {
  const sportOptions: WorkoutSportOptions | undefined = fields.sport === "swim" && fields.poolLength
    ? { ...base?.sportOptions, poolLength: fields.poolLength }
    : (fields.sport === "indoorClimb" || fields.sport === "bouldering") && fields.gradingSystem
      ? { ...base?.sportOptions, gradingSystem: fields.gradingSystem }
      : base?.sport === fields.sport ? base.sportOptions : undefined;
  const { sportOptions: _baseOptions, ...rest } = base ?? {};
  return {
    ...rest,
    name: fields.name,
    overview: fields.description,
    sportType: base?.sport === fields.sport ? base.sportType : workoutSportType(fields.sport),
    sport: fields.sport,
    ...(sportOptions ? { sportOptions: structuredClone(sportOptions) } : {}),
    nodes: rows.map((row) => rowToEditorNode(row, fields.sport, unitSystem))
  };
}
