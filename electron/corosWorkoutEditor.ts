import crypto from "node:crypto";
import { corosDistanceTargetDisplayUnit } from "./corosWorkoutDistance";
import {
  HYROX_RUN_STEP_NAME,
  poolLengthPresetId,
  sourceThumbnailFor,
  stepBaseRow,
  type CorosExerciseCatalog
} from "./corosExerciseCatalog";
import type {
  RunWorkoutEditorDraft,
  RunWorkoutEditorIntensity,
  RunWorkoutEditorNode,
  RunWorkoutEditorRepeatGroup,
  RunWorkoutEditorStep,
  RunWorkoutEditorStepKind,
  RunWorkoutEditorTarget,
  UnitSystem,
  WorkoutEditRef,
  WorkoutHeartRateBasis,
  WorkoutEditorContext,
  WorkoutLthrZone,
  WorkoutSport,
  WorkoutZone
} from "./types";
import {
  CLIMB_SYSTEM_IDS,
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  WORKOUT_SPORT_CAPABILITIES,
  decodeCorosIntensity,
  encodeCorosIntensity,
  requiredWorkoutPbVersion,
  validateWorkoutIntensity,
  validateWorkoutDraftShared,
  validateWorkoutTarget,
  workoutSportFromType,
  workoutSportType
} from "./workoutCapabilities";
import {
  POUNDS_PER_KILOGRAM,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  normalizeUnitSystem,
  speedUnit,
  weightUnit
} from "./unitSystem.js";

const TOP_LEVEL_SORT_INTERVAL = 16_777_216;
const GROUP_CHILD_SORT_INTERVAL = 65_536;
const MILES_PER_KILOMETER = 0.621371192;

const EXERCISE_TYPE_TO_KIND: Record<number, RunWorkoutEditorStepKind> = {
  1: "warmup",
  2: "training",
  3: "cooldown",
  4: "rest",
  5: "sendOff"
};

const KIND_TO_EXERCISE_TYPE: Record<RunWorkoutEditorStepKind, number> = {
  warmup: 1,
  training: 2,
  cooldown: 3,
  rest: 4,
  sendOff: 2
};

export interface WorkoutEditSource {
  ref: WorkoutEditRef;
  program: Record<string, unknown>;
  entity?: Record<string, unknown>;
}

export interface WorkoutDraftValidation {
  valid: boolean;
  errors: Record<string, string>;
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exerciseId(exercise: Record<string, unknown>): string | undefined {
  return exercise.id === null || exercise.id === undefined
    ? undefined
    : String(exercise.id);
}

function originExerciseId(exercise: Record<string, unknown>): string | undefined {
  const value = exercise.originId;
  return value === null || value === undefined || String(value) === "0"
    ? undefined
    : String(value);
}

function friendlyStepName(kind: RunWorkoutEditorStepKind): string {
  switch (kind) {
    case "warmup":
      return "Warm Up";
    case "cooldown":
      return "Cool Down";
    case "rest":
      return "Rest";
    case "sendOff":
      return "Send-off";
    default:
      return "Training";
  }
}

function editableStepOverview(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const overview = value.trim();
  return overview && !/^sid_[a-z0-9_]+$/i.test(overview) ? overview : undefined;
}

function parseTarget(
  exercise: Record<string, unknown>,
  kind: RunWorkoutEditorStepKind
): { target: RunWorkoutEditorTarget; reason?: string } {
  const targetType = numberValue(exercise.targetType) ?? 1;
  const targetValue = numberValue(exercise.targetValue) ?? 0;

  switch (targetType) {
    case 1:
      return { target: { type: "open" } };
    case 2:
      return { target: { type: "time", seconds: targetValue } };
    case 5:
      return { target: { type: "distance", meters: targetValue / 100 } };
    case 6:
      return { target: { type: "load", load: targetValue } };
    case 7:
      return kind === "rest"
        ? { target: { type: "hrRecovery", bpm: targetValue } }
        : {
            target: { type: "open" },
            reason: "HR Recovery is only editable on Rest steps."
          };
    case 3:
      return { target: { type: "reps", count: Math.round(targetValue) } };
    case 8:
      return { target: { type: "elevationGain", meters: targetValue / 100 } };
    case 9:
      return { target: { type: "routes", count: Math.round(targetValue) } };
    default:
      return {
        target: { type: "open" },
        reason: `COROS target type ${targetType} is preserved but not editable.`
      };
  }
}

function parseIntensity(
  exercise: Record<string, unknown>,
  context?: WorkoutEditorContext
): {
  intensity: RunWorkoutEditorIntensity;
  reason?: string;
} {
  const parsed = decodeCorosIntensity(exercise);
  const intensity = parsed.intensity;
  if (!context) return parsed;
  if (intensity.type === "pace" || intensity.type === "effortPace") {
    return {
      ...parsed,
      intensity: { ...intensity, displayUnit: context.paceUnit }
    };
  }
  if (intensity.type === "speed") {
    const lowKmh = intensity.unit === "mph" ? intensity.low * 1.609344 : intensity.low;
    const highKmh = intensity.unit === "mph" ? intensity.high * 1.609344 : intensity.high;
    return {
      ...parsed,
      intensity: {
        ...intensity,
        low: kmhToDisplaySpeed(lowKmh, context.distanceUnit),
        high: kmhToDisplaySpeed(highKmh, context.distanceUnit),
        unit: speedUnit(context.distanceUnit)
      }
    };
  }
  if (intensity.type === "weight" && intensity.mode === "weight") {
    const kilograms = intensity.unit === "lb"
      ? intensity.value / POUNDS_PER_KILOGRAM
      : intensity.value;
    return {
      ...parsed,
      intensity: {
        ...intensity,
        value: kilogramsToDisplayWeight(kilograms, context.distanceUnit),
        unit: weightUnit(context.distanceUnit)
      }
    };
  }
  return parsed;
}

function parseStep(
  exercise: Record<string, unknown>,
  index: number,
  sport: WorkoutSport,
  context?: WorkoutEditorContext
): RunWorkoutEditorStep {
  const exerciseType = numberValue(exercise.exerciseType) ?? 2;
  const kind = sport === "swim" &&
    (exerciseType === 5 || (exerciseType === 2 && numberValue(exercise.subType) === 1))
    ? "sendOff"
    : EXERCISE_TYPE_TO_KIND[exerciseType];
  const id = exerciseId(exercise);

  if (!kind) {
    return {
      id: `step-${id ?? index}`,
      ...(id ? { sourceExerciseId: id } : {}),
      nodeType: "step",
      kind: "training",
      name: String(exercise.name ?? "Unsupported step"),
      target: { type: "open" },
      intensity: { type: "none" },
      ...(originExerciseId(exercise) ? { exerciseId: originExerciseId(exercise) } : {}),
      ...(exercise.name ? { exerciseName: String(exercise.name) } : {}),
      ...(numberValue(exercise.exerciseKind) !== undefined
        ? { exerciseKind: numberValue(exercise.exerciseKind) }
        : {}),
      editable: false,
      unsupportedReason: `COROS exercise type ${exerciseType} is preserved but not editable.`
    };
  }

  const parsedTarget = parseTarget(exercise, kind);
  const parsedIntensity = parseIntensity(exercise, context);
  const reason = parsedTarget.reason ?? parsedIntensity.reason ??
    validateWorkoutTarget(sport, kind, parsedTarget.target, numberValue(exercise.exerciseKind)) ??
    validateWorkoutIntensity(sport, parsedIntensity.intensity, kind, numberValue(exercise.exerciseKind));
  const rawName = String(exercise.name ?? "").trim();
  const name = rawName && !/^T\d+$/i.test(rawName) ? rawName : friendlyStepName(kind);

  return {
    id: `step-${id ?? index}`,
    ...(id ? { sourceExerciseId: id } : {}),
    nodeType: "step",
    kind,
    name,
    target: parsedTarget.target,
    intensity: parsedIntensity.intensity,
    ...(originExerciseId(exercise) ? { exerciseId: originExerciseId(exercise) } : {}),
    ...(rawName ? { exerciseName: rawName } : {}),
    ...(numberValue(exercise.exerciseKind) !== undefined
      ? { exerciseKind: numberValue(exercise.exerciseKind) }
      : {}),
    ...(kind === "training" &&
      (sport === "strength" || (sport === "hyrox" && Boolean(numberValue(exercise.exerciseKind))))
      ? {
          sets: Math.max(1, Math.min(99, Math.round(numberValue(exercise.sets) ?? 1))),
          restType: Math.round(numberValue(exercise.restType) ?? 1),
          restValue: Math.max(0, Math.round(numberValue(exercise.restValue) ?? 60))
        }
      : {}),
    ...(editableStepOverview(exercise.overview)
      ? { overview: editableStepOverview(exercise.overview) }
      : {}),
    ...(numberValue(exercise.packageTime) !== undefined
      ? { sendOffSeconds: numberValue(exercise.packageTime) }
      : {}),
    editable: !reason,
    ...(reason ? { unsupportedReason: reason } : {})
  };
}

export function corosProgramToWorkoutDraft(
  program: Record<string, unknown>,
  context?: WorkoutEditorContext
): RunWorkoutEditorDraft {
  const sport = workoutSportFromType(program.sportType) ?? "run";
  const rawExercises = Array.isArray(program.exercises)
    ? (program.exercises.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      ))
    : [];
  const exercises = [...rawExercises].sort(
    (left, right) =>
      (numberValue(left.sortNo) ?? 0) - (numberValue(right.sortNo) ?? 0)
  );
  const groupedIds = new Set(
    exercises
      .filter((exercise) => Boolean(exercise.isGroup))
      .map((exercise) => exerciseId(exercise))
      .filter((id): id is string => Boolean(id))
  );
  const consumed = new Set<Record<string, unknown>>();
  const nodes: RunWorkoutEditorNode[] = [];

  exercises.forEach((exercise, index) => {
    if (consumed.has(exercise)) {
      return;
    }
    const id = exerciseId(exercise);
    if (Boolean(exercise.isGroup)) {
      const children = exercises.filter(
        (candidate) => !candidate.isGroup && String(candidate.groupId ?? "") === id
      );
      children.forEach((child) => consumed.add(child));
      const steps = children.map((child, childIndex) =>
        parseStep(child, childIndex, sport, context)
      );
      const reason = steps.length === 0 ? "Empty COROS repeat group." : undefined;
      nodes.push({
        id: `group-${id ?? index}`,
        ...(id ? { sourceExerciseId: id } : {}),
        nodeType: "repeat",
        name: String(exercise.name ?? "Repeat"),
        repeat: Math.max(1, Math.min(99, Math.round(numberValue(exercise.sets) ?? 1))),
        steps,
        editable: !reason,
        ...(reason ? { unsupportedReason: reason } : {})
      });
      consumed.add(exercise);
      return;
    }

    const groupId = String(exercise.groupId ?? "");
    if (groupId && groupId !== "0" && groupedIds.has(groupId)) {
      return;
    }
    nodes.push(parseStep(exercise, index, sport, context));
    consumed.add(exercise);
  });

  const gradingSystem = Object.entries(CLIMB_SYSTEM_IDS).find(
    ([, value]) => value === numberValue((objectValue(program.referExercise) ?? {}).gradeSystem)
  )?.[0] as WorkoutEditorContext["climbSystems"]["indoorClimb"] | undefined;
  const poolRaw = numberValue(program.poolLength);
  const poolUnit = context
    ? context.defaultPoolLength.unit
    : [3, 4].includes(numberValue(program.poolLengthUnit) ?? 0) ? "yd" : "m";
  return {
    name: String(program.name ?? "Workout"),
    overview: String(program.overview ?? ""),
    sportType: workoutSportType(sport),
    sport,
    ...((sport === "swim" || sport === "indoorClimb" || sport === "bouldering")
      ? {
          sportOptions: {
            ...(sport === "swim" && poolRaw
              ? {
                  poolLength: {
                    value: poolRaw / 100 / (poolUnit === "yd" ? 0.9144 : 1),
                    unit: poolUnit
                  }
                }
              : {}),
            ...(gradingSystem ? { gradingSystem } : {})
          }
        }
      : {}),
    nodes
  };
}

function nextExerciseIdFactory(exercises: Record<string, unknown>[]): () => string {
  let maximum = 0n;
  for (const exercise of exercises) {
    const id = exerciseId(exercise);
    if (id && /^\d+$/.test(id)) {
      const parsed = BigInt(id);
      if (parsed > maximum) {
        maximum = parsed;
      }
    }
  }
  return () => String(++maximum);
}

/** The fields of a movement COROS reads to draw a session's muscle map. */
const CATALOG_MUSCLE_FIELDS = ["muscle", "muscleRelevance", "part", "equipment"] as const;

/** The web app's repeat group, for one the workout did not have. */
function newRepeatGroup(): Record<string, unknown> {
  return {
    access: 0,
    defaultOrder: 0,
    exerciseType: 0,
    hrType: 0,
    intensityCustom: 0,
    intensityDisplayUnit: 0,
    intensityMultiplier: 0,
    intensityPercent: 0,
    intensityPercentExtend: 0,
    intensityType: 0,
    intensityValue: 0,
    intensityValueExtend: 0,
    isDefaultAdd: 0,
    isGroup: true,
    isIntensityPercent: false,
    name: "",
    originId: "0",
    overview: "",
    restType: 0,
    restValue: 30,
    sourceId: "0",
    sourceUrl: "",
    sportType: 0,
    subType: 0,
    targetDisplayUnit: 0,
    videoUrl: ""
  };
}

function isLocalizationKey(value: unknown): boolean {
  return typeof value === "string" && /^[TS]\d+$/i.test(value.trim());
}

/**
 * The name a step was given, when it was given one. The builder labels a
 * step it was not told the name of — "Warm Up", "Training", a movement's
 * English name — and `parseStep` reads COROS's key (`T1120`) back as the same
 * words; none of those is a name of the athlete's, and writing one over the
 * key loses the watch's own language.
 */
function ownStepName(
  step: RunWorkoutEditorStep,
  base: Record<string, unknown>,
  catalogRow: Record<string, unknown> | undefined,
  functional: boolean
): string | undefined {
  const name = step.name.trim();
  if (!name) return undefined;
  const implied = [
    friendlyStepName(step.kind),
    typeof base.name === "string" && !isLocalizationKey(base.name) && functional ? base.name : undefined,
    typeof catalogRow?.displayName === "string" ? catalogRow.displayName : undefined,
    typeof catalogRow?.name === "string" ? catalogRow.name : undefined,
    functional ? step.exerciseName : undefined
  ];
  const lower = name.toLocaleLowerCase();
  if (implied.some((value) => typeof value === "string" && value.trim().toLocaleLowerCase() === lower)) {
    return undefined;
  }
  if (isLocalizationKey(name)) return undefined;
  return name;
}

/**
 * The name a step is written with. A HYROX run is always `T1398`; a name
 * unchanged since it was read is the source's own, a key included; a name
 * the athlete gave it is theirs; anything else is COROS's key for the step —
 * or, for a movement the catalog was not read for, the name it was picked by.
 */
function stepName(
  step: RunWorkoutEditorStep,
  {
    source,
    exercise,
    row,
    catalogRow,
    functional,
    sport
  }: {
    /** The node the step was read from, when the step still fits it. */
    source: Record<string, unknown> | undefined;
    exercise: Record<string, unknown>;
    row: Record<string, unknown>;
    catalogRow: Record<string, unknown> | undefined;
    functional: boolean;
    sport: WorkoutSport;
  }
): unknown {
  if (sport === "hyrox" && step.kind === "training" && !functional) return HYROX_RUN_STEP_NAME;
  if (source) {
    const readName = isLocalizationKey(source.name)
      ? friendlyStepName(step.kind)
      : String(source.name ?? "").trim();
    if (step.name.trim() === readName) return source.name;
  }
  const own = ownStepName(step, exercise, catalogRow, functional);
  if (own) return own;
  if (isLocalizationKey(exercise.name)) return exercise.name;
  if (functional && !catalogRow && step.exerciseName) return step.exerciseName;
  return row.name;
}

function applyTarget(
  exercise: Record<string, unknown>,
  step: RunWorkoutEditorStep,
  context: WorkoutEditorContext,
  sport: WorkoutSport
): void {
  exercise.targetDisplayUnit = 0;
  switch (step.target.type) {
    case "time":
      exercise.targetType = 2;
      exercise.targetValue = Math.round(step.target.seconds);
      break;
    case "distance":
      exercise.targetType = 5;
      exercise.targetValue = Math.round(step.target.meters * 100);
      exercise.targetDisplayUnit = corosDistanceTargetDisplayUnit(
        step.target.meters,
        sport,
        context.distanceUnit
      );
      break;
    case "load":
      exercise.targetType = 6;
      exercise.targetValue = Math.round(step.target.load);
      break;
    case "hrRecovery":
      exercise.targetType = 7;
      exercise.targetValue = Math.round(step.target.bpm);
      break;
    case "reps":
      exercise.targetType = 3;
      exercise.targetValue = Math.round(step.target.count);
      break;
    case "elevationGain":
      exercise.targetType = 8;
      exercise.targetValue = Math.round(step.target.meters * 100);
      exercise.targetDisplayUnit = context.distanceUnit === "imperial" ? 5 : 2;
      break;
    case "routes":
      exercise.targetType = 9;
      exercise.targetValue = Math.round(step.target.count);
      break;
    case "open":
      exercise.targetType = 1;
      exercise.targetValue = 0;
      break;
  }
}

function applyIntensity(
  exercise: Record<string, unknown>,
  intensity: RunWorkoutEditorIntensity,
  context: WorkoutEditorContext
): void {
  Object.assign(exercise, encodeCorosIntensity(intensity, context));
}

function aggregateGroup(
  group: RunWorkoutEditorRepeatGroup,
  context: WorkoutEditorContext,
  sport: WorkoutSport
): {
  targetType: number;
  targetValue: number;
  targetDisplayUnit: number;
} {
  const distance = group.steps.reduce(
    (sum, step) => sum + (step.target.type === "distance" ? step.target.meters * 100 : 0),
    0
  );
  const time = group.steps.reduce(
    (sum, step) => sum + (step.target.type === "time" ? step.target.seconds : 0),
    0
  );
  return distance > 0
    ? {
        targetType: 5,
        targetValue: Math.round(distance),
        targetDisplayUnit: corosDistanceTargetDisplayUnit(distance / 100, sport, context.distanceUnit)
      }
    : { targetType: 2, targetValue: Math.round(time), targetDisplayUnit: 0 };
}

export function workoutDraftToCorosProgram(
  sourceProgram: Record<string, unknown>,
  draft: RunWorkoutEditorDraft,
  context: WorkoutEditorContext,
  /** The strength catalog, for a movement new to the workout. */
  catalog?: CorosExerciseCatalog
): Record<string, unknown> {
  const validation = validateWorkoutDraft(draft);
  if (!validation.valid) {
    throw new Error(Object.values(validation.errors)[0] ?? "Workout is invalid.");
  }

  const program = structuredClone(sourceProgram);
  const sourceExercises = Array.isArray(sourceProgram.exercises)
    ? (sourceProgram.exercises.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      ))
    : [];
  const byId = new Map(
    sourceExercises
      .map((exercise) => [exerciseId(exercise), exercise] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0]))
  );
  const allocateId = nextExerciseIdFactory(sourceExercises);
  const flattened: Record<string, unknown>[] = [];

  const sportType = draft.sportType;
  const climbing = draft.sport === "indoorClimb" || draft.sport === "bouldering";

  const buildStep = (
    step: RunWorkoutEditorStep,
    sortNo: number,
    groupId: string
  ): Record<string, unknown> => {
    const id = step.sourceExerciseId ?? allocateId();
    const source = step.sourceExerciseId ? byId.get(step.sourceExerciseId) : undefined;

    if (!step.editable && source) {
      const kept = structuredClone(source);
      Object.assign(kept, { id, sortNo, groupId, isGroup: false });
      return kept;
    }

    const exerciseType = KIND_TO_EXERCISE_TYPE[step.kind];
    const functional = step.kind === "training" &&
      (draft.sport === "strength" || (draft.sport === "hyrox" && Boolean(step.exerciseKind)));
    const catalogRow = functional && step.exerciseId ? catalog?.get(step.exerciseId) : undefined;
    // The row this step would start from on the web app (corosExerciseCatalog.ts).
    const row = stepBaseRow(functional ? 4 : sportType, exerciseType, catalogRow);
    // A step that is still the movement and the kind it was read as keeps its
    // node: whatever COROS stored on it, muscles included, goes back as it
    // came. One whose movement or kind changed starts again from the row —
    // keeping the old node would carry the old movement's muscles onto the
    // new one, which is how "Straight Arm Pulldown" came to be filed under
    // the chest.
    const fits = Boolean(source) &&
      numberValue(source!.exerciseType) === exerciseType &&
      (!functional || (step.exerciseId ?? "") === (originExerciseId(source!) ?? ""));
    let exercise: Record<string, unknown>;
    if (fits) {
      exercise = structuredClone(source!);
      // What COROS draws the muscle map from is the catalog's, always: a
      // workout an earlier build saved carries the muscles of the movement it
      // swapped out, and this is where it heals.
      if (catalogRow) {
        for (const key of CATALOG_MUSCLE_FIELDS) {
          if (catalogRow[key] !== undefined) exercise[key] = structuredClone(catalogRow[key]);
        }
      }
    } else {
      exercise = row;
      if (functional && step.exerciseId && !catalogRow) {
        // The catalog was not read: the movement is known by id only, and
        // a muscle map from the template's [0] parts is no map at all.
        exercise.originId = step.exerciseId;
        delete exercise.muscle;
        delete exercise.muscleRelevance;
      }
    }
    exercise.id = id;
    exercise.sortNo = sortNo;
    exercise.groupId = groupId;
    exercise.isGroup = false;

    exercise.name = stepName(step, { source: fits ? source : undefined, exercise, row, catalogRow, functional, sport: draft.sport });
    exercise.exerciseType = exerciseType;
    exercise.subType = step.kind === "sendOff" ? 1 : functional && draft.sport === "hyrox" ? 2 : 0;
    exercise.sportType = sportType;
    if (draft.sport === "hyrox") {
      exercise.exerciseKind = functional ? step.exerciseKind ?? 0 : 0;
      if (functional) exercise.hyroxTrainingMode = "strength";
      else delete exercise.hyroxTrainingMode;
    } else if (step.exerciseKind !== undefined) {
      exercise.exerciseKind = step.exerciseKind;
    }
    if (step.sendOffSeconds !== undefined) exercise.packageTime = Math.round(step.sendOffSeconds);
    exercise.sets = functional ? step.sets ?? 1 : 1;
    // The web app: a movement's rest is the athlete's; climbing has none;
    // every other step ends without one.
    exercise.restType = functional ? step.restType ?? 1 : climbing ? 0 : 3;
    exercise.restValue = functional ? step.restValue ?? 60 : 0;
    // A description the athlete wrote, else COROS's key for one — the
    // source's while it has one, the row's when its own text was cleared.
    exercise.overview = step.overview?.trim() ||
      (/^sid_/i.test(String(exercise.overview ?? "")) ? exercise.overview : row.overview) ||
      "";
    if (climbing) {
      exercise.gradeSystem = 0;
      exercise.onsightGradeOffset = 0;
    }
    applyTarget(exercise, step, context, draft.sport);
    applyIntensity(exercise, step.intensity, context);
    return exercise;
  };

  draft.nodes.forEach((node, topIndex) => {
    const topSort = TOP_LEVEL_SORT_INTERVAL * (topIndex + 1);
    if (node.nodeType === "step") {
      flattened.push(buildStep(node, topSort, "0"));
      return;
    }

    const id = node.sourceExerciseId ?? allocateId();
    const source = node.sourceExerciseId ? byId.get(node.sourceExerciseId) : undefined;
    const group = source ? structuredClone(source) : newRepeatGroup();
    const aggregate = aggregateGroup(node, context, draft.sport);
    // "Repeat" is the builder's label for a group with no name of its own.
    const name = node.name.trim();
    Object.assign(group, aggregate, {
      id,
      name: name && name !== "Repeat" ? name : String(source?.name ?? ""),
      exerciseType: 0,
      intensityType: 0,
      intensityValue: 0,
      intensityValueExtend: 0,
      intensityMultiplier: 0,
      groupId: "0",
      isGroup: true,
      sets: node.repeat,
      sortNo: topSort
    });
    flattened.push(group);
    node.steps.forEach((step, childIndex) => {
      flattened.push(
        buildStep(step, topSort + GROUP_CHILD_SORT_INTERVAL * (childIndex + 1), id)
      );
    });
  });

  program.name = draft.name.trim();
  program.overview = draft.overview.trim();
  program.sportType = draft.sportType;
  program.pbVersion = requiredWorkoutPbVersion(
    draft.sport,
    flattened,
    numberValue(program.pbVersion) ?? 0
  );
  const gradingSystem = draft.sport === "indoorClimb" || draft.sport === "bouldering"
    ? draft.sportOptions?.gradingSystem ?? context.climbSystems[draft.sport] ?? (draft.sport === "bouldering" ? "vScale" : "yds")
    : undefined;
  program.referExercise = {
    ...WORKOUT_SPORT_CAPABILITIES[draft.sport].referExercise,
    ...(objectValue(program.referExercise) ?? {}),
    ...(gradingSystem
      ? { gradeSystem: CLIMB_SYSTEM_IDS[gradingSystem] }
      : {})
  };
  const poolLength = draft.sport === "swim"
    ? draft.sportOptions?.poolLength ?? context.defaultPoolLength
    : undefined;
  if (poolLength) {
    program.poolLength = Math.round(poolLength.value * (poolLength.unit === "yd" ? 0.9144 : 1) * 100);
    program.poolLengthUnit = poolLength.unit === "yd" ? 4 : 2;
    program.poolLengthId = poolLengthPresetId(
      program.poolLength as number,
      program.poolLengthUnit as number
    );
  }
  // What the web app gives every program it writes, filled in only where the
  // source has none: a cover, and the three blank media fields.
  if (!program.sourceId || String(program.sourceId) === "0") {
    Object.assign(program, sourceThumbnailFor(String(program.name ?? "")));
  }
  for (const key of ["profile", "videoUrl", "videoCoverUrl"]) {
    if (typeof program[key] !== "string") program[key] = "";
  }
  if (gradingSystem) program.gradeSystemVersion = numberValue(program.gradeSystemVersion) ?? 1;
  program.simple = false;
  program.exercises = flattened;
  program.exerciseNum = flattened.length;
  program.totalSets = flattened.reduce(
    (total, exercise) => {
      const sets = Math.max(1, Number(exercise.sets ?? 1));
      if (exercise.isGroup) return total + sets;
      return String(exercise.groupId ?? "0") === "0" ? total + sets : total + 1;
    },
    0
  );
  program.sets = program.totalSets;
  program.distanceDisplayUnit = draft.sport === "swim"
    ? context.distanceUnit === "imperial" ? 4 : 2
    : context.distanceUnit === "imperial" ? 3 : 1;
  return program;
}

export function validateWorkoutDraft(draft: RunWorkoutEditorDraft): WorkoutDraftValidation {
  return validateWorkoutDraftShared(draft);
}

export function workoutEditRevision(source: WorkoutEditSource): string {
  const programVersion = {
    id: source.program.id,
    idInPlan: source.program.idInPlan,
    version: source.program.version,
    pbVersion: source.program.pbVersion,
    updateTimestamp: source.program.updateTimestamp,
    modifyTimestamp: source.program.modifyTimestamp
  };
  const entityVersion = source.entity
    ? {
        planId: source.entity.planId,
        idInPlan: source.entity.idInPlan,
        planProgramId: source.entity.planProgramId,
        happenDay: source.entity.happenDay,
        version: source.entity.version,
        pbVersion: source.entity.pbVersion,
        updateTimestamp: source.entity.updateTimestamp,
        modifyTimestamp: source.entity.modifyTimestamp
      }
    : undefined;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ ref: source.ref, programVersion, entityVersion }))
    .digest("hex");
}

function normalizedDraft(draft: RunWorkoutEditorDraft): unknown {
  const normalizeIntensity = (intensity: RunWorkoutEditorIntensity): unknown =>
    intensity.type === "lthrPercent"
      ? {
          type: intensity.type,
          lowPercent: intensity.lowPercent,
          highPercent: intensity.highPercent
        }
      : intensity;
  return {
    name: draft.name.trim(),
    overview: draft.overview.trim(),
    sport: draft.sport,
    sportType: draft.sportType,
    sportOptions: draft.sportOptions,
    nodes: draft.nodes.map((node) =>
      node.nodeType === "step"
        ? {
            nodeType: node.nodeType,
            kind: node.kind,
            name: node.name.trim(),
            target: node.target,
            intensity: normalizeIntensity(node.intensity),
            exerciseId: node.exerciseId,
            exerciseKind: node.exerciseKind,
            ...(draft.sport === "strength" && node.kind === "training"
              ? {
                  sets: node.sets ?? 1,
                  restType: node.restType ?? 1,
                  restValue: node.restValue ?? 60
                }
              : {}),
            overview: node.overview,
            sendOffSeconds: node.sendOffSeconds,
            editable: node.editable
          }
        : {
            nodeType: node.nodeType,
            name: node.name.trim(),
            repeat: node.repeat,
            steps: node.steps.map((step) => ({
              kind: step.kind,
              name: step.name.trim(),
              target: step.target,
              intensity: normalizeIntensity(step.intensity),
              exerciseId: step.exerciseId,
              exerciseKind: step.exerciseKind,
              ...(draft.sport === "strength" && step.kind === "training"
                ? {
                    sets: step.sets ?? 1,
                    restType: step.restType ?? 1,
                    restValue: step.restValue ?? 60
                  }
                : {}),
              overview: step.overview,
              sendOffSeconds: step.sendOffSeconds,
              editable: step.editable
            }))
          }
    )
  };
}

export function workoutDraftsMatch(
  expected: RunWorkoutEditorDraft,
  actualProgram: Record<string, unknown>
): boolean {
  return JSON.stringify(normalizedDraft(expected)) ===
    JSON.stringify(normalizedDraft(corosProgramToWorkoutDraft(actualProgram)));
}

function parseZoneData(account: Record<string, unknown>): Record<string, unknown> {
  const raw = account.zoneData;
  if (typeof raw === "string") {
    try {
      return objectValue(JSON.parse(raw)) ?? {};
    } catch {
      return {};
    }
  }
  return objectValue(raw) ?? {};
}

export function parseWorkoutEditorContext(
  account: Record<string, unknown>,
  unitSystem?: UnitSystem
): WorkoutEditorContext {
  const zoneData = parseZoneData(account);
  const firstNumber = (...values: unknown[]): number | undefined => {
    for (const value of values) {
      const parsed = numberValue(value);
      if (parsed !== undefined && parsed > 0) return parsed;
    }
    return undefined;
  };
  const maxHr = firstNumber(zoneData.maxHr, zoneData.maxHeartRate, account.maxHr, account.maxHeartRate);
  const restingHr = firstNumber(zoneData.rhr, account.rhr, zoneData.restingHr, zoneData.restHr, account.restingHr, account.restHr);
  const lthrBpm = firstNumber(zoneData.lthr, zoneData.thresholdHr, account.lthr, account.thresholdHr);
  const rawThresholdPace = firstNumber(
    zoneData.ltsp,
    zoneData.thresholdPace,
    zoneData.thresholdPaceSeconds,
    account.thresholdPace,
    account.thresholdPaceSeconds
  );
  const thresholdPaceSecondsPerKm = rawThresholdPace && rawThresholdPace > 10_000
    ? rawThresholdPace / 1_000
    : rawThresholdPace;
  const ftp = firstNumber(zoneData.ftp, zoneData.cycleFtp, account.ftp, account.cycleFtp);
  /*
   * `hrZoneType` is on the account itself, not inside `zoneData` — probed, and
   * `normalizeCorosProfile` reads it the same way. 1 is Max HR, 2 is Heart
   * Rate Reserve, 3 is Lactate Threshold, and COROS scores every activity
   * against whichever one is chosen.
   */
  const heartRateBasis: WorkoutHeartRateBasis =
    numberValue(account.hrZoneType) === 2
      ? "reserve"
      : numberValue(account.hrZoneType) === 3 ? "lthr" : "maxHr";
  const criticalPower = firstNumber(
    zoneData.criticalPower,
    zoneData.runCriticalPower,
    account.criticalPower,
    account.runCriticalPower
  );

  type ZoneDefinition = { id: number; label: string; low: number; high: number; preset?: string };
  const zoneArray = (...keys: string[]): unknown[] => {
    for (const key of keys) {
      if (Array.isArray(zoneData[key])) return zoneData[key] as unknown[];
      if (Array.isArray(account[key])) return account[key] as unknown[];
    }
    return [];
  };
  const configuredZones = (
    raw: unknown[],
    defaults: readonly ZoneDefinition[],
    reference?: number,
    reserveRest?: number
  ): WorkoutZone[] => {
    if (!raw.length) {
      return defaults.map((zone, index) => {
        const absolute = reference
          ? reserveRest !== undefined
            ? {
                lowBpm: Math.round(reserveRest + (reference - reserveRest) * zone.low / 100),
                highBpm: Math.round(reserveRest + (reference - reserveRest) * zone.high / 100)
              }
            : {
                lowBpm: Math.round(reference * zone.low / 100),
                highBpm: Math.round(reference * zone.high / 100)
              }
          : {};
        return {
          index: index + 1,
          id: zone.id,
          key: zone.preset ?? String(zone.id),
          label: zone.label,
          lowPercent: zone.low,
          highPercent: zone.high,
          ...absolute,
          // COROS writes the ends of every family open, and so does the table
          // these defaults come from.
          ...(index === 0 ? { openEnd: "low" as const } : {}),
          ...(index === defaults.length - 1 ? { openEnd: "high" as const } : {})
        };
      });
    }
    /*
     * A COROS zone entry states the zone's **ceiling**, not its floor.
     *
     * Verified against the account screens on 2026-09-22 for all five
     * families. HR reserve arrives as ceilings 133 / 154 / 168 / 173 / 183 and
     * COROS draws "<133", "133-154", "155-168", "169-173", "174-183", ">183".
     * So zone 1 runs up to the first entry, zone 2 spans the first two, and
     * every zone after that starts one above the entry below it.
     *
     * Reading `ratio` as the floor — which is what this did — shifted every
     * zone down one and put the wrong percentages on every preset in the
     * workout builder. The heart-rate tables happened to look close because
     * their ceilings are evenly spaced; the pace table did not.
     *
     * The top entry is a sentinel (404 bpm, 900 W, a 2:44/km pace), so the
     * last zone is open-ended and must never print it.
     */
    const parsed = raw.map((item, arrayIndex) => {
      const zone = objectValue(item) ?? {};
      const ratio = numberValue(zone.ratio ?? zone.percent);
      const absolute = numberValue(zone.hr ?? zone.power ?? zone.value);
      return {
        index: Math.round(numberValue(zone.index) ?? arrayIndex),
        ceilingPercent: ratio !== undefined
          ? Math.round(ratio <= 2 ? ratio * 100 : ratio)
          : reference && absolute !== undefined
            ? Math.round(
                reserveRest !== undefined
                  ? ((absolute - reserveRest) / (reference - reserveRest)) * 100
                  : (absolute / reference) * 100
              )
            : undefined,
        ceilingAbsolute: absolute
      };
    }).sort((left, right) => left.index - right.index);

    const percentAt = (position: number): number | undefined => {
      const entry = parsed[position];
      if (!entry) return undefined;
      if (entry.ceilingPercent !== undefined) return entry.ceilingPercent;
      return defaults[position]?.high;
    };
    const bpmAt = (position: number): number | undefined => {
      const entry = parsed[position];
      if (entry?.ceilingAbsolute !== undefined) return entry.ceilingAbsolute;
      const percent = percentAt(position);
      if (percent === undefined || !reference) return undefined;
      return Math.round(reserveRest !== undefined
        ? reserveRest + (reference - reserveRest) * percent / 100
        : reference * percent / 100);
    };

    return parsed.map((_entry, position) => {
      const fallback = defaults[position] ?? defaults[defaults.length - 1]!;
      const isFirst = position === 0;
      const isLast = position === parsed.length - 1;
      // Zone 2 starts exactly at zone 1's ceiling, because zone 1 is written
      // "under X" and so stops below it. Every zone after that starts one
      // above the zone below.
      const floorPercent = isFirst
        ? 0
        : position === 1
          ? percentAt(0) ?? fallback.low
          : (percentAt(position - 1) ?? fallback.low - 1) + 1;
      const ceilingPercent = percentAt(position) ?? fallback.high;
      const floorBpm = isFirst
        ? undefined
        : position === 1
          ? bpmAt(0)
          : (() => {
            const below = bpmAt(position - 1);
            return below === undefined ? undefined : below + 1;
          })();
      const ceilingBpm = isLast ? undefined : bpmAt(position);
      return {
        index: position + 1,
        id: fallback.id,
        key: fallback.preset ?? String(fallback.id),
        label: fallback.label,
        lowPercent: floorPercent,
        highPercent: isLast ? Math.max(floorPercent, fallback.high) : ceilingPercent,
        ...(floorBpm !== undefined ? { lowBpm: floorBpm } : {}),
        ...(ceilingBpm !== undefined ? { highBpm: ceilingBpm } : {}),
        ...(isFirst ? { openEnd: "low" as const } : {}),
        ...(isLast ? { openEnd: "high" as const } : {})
      };
    });
  };

  const hrDefinitions = (basis: "maxHr" | "reserve" | "lthr"): ZoneDefinition[] =>
    HEART_RATE_PRESETS[basis].map((zone) => ({ ...zone, preset: zone.preset }));
  const paceDefinitions = PACE_PRESETS.map((zone) => ({ ...zone, preset: zone.preset }));
  const ftpDefinitions = FTP_PRESETS.map((zone) => ({ ...zone, preset: zone.preset }));
  /*
   * COROS's own names come first in each list.
   *
   * `ltspZone` and `cyclePowerZone` are what `/account/query` sends — the same
   * names `normalizeCorosProfileThresholds` reads them under. This asked for
   * `thresholdPaceZone` and `paceZone`, which COROS has never sent, so the
   * pace family was empty on every account and the builder drew its fallback
   * table instead of the athlete's zones. The remaining spellings are kept in
   * case an older account shape still answers to them; they cost one lookup.
   *
   * There is no running-power family. COROS publishes five, and its Settings
   * offers Heart Rate, Pace and Cycling Power.
   */
  const zones: WorkoutEditorContext["zones"] = {
    maxHr: configuredZones(zoneArray("maxHrZone", "maxHrZones", "heartRateZone"), hrDefinitions("maxHr"), maxHr),
    reserve: configuredZones(zoneArray("rhrZone", "hrrZone", "reserveZone"), hrDefinitions("reserve"), maxHr, restingHr),
    lthr: configuredZones(zoneArray("lthrZone", "lthrZones", "thresholdHrZone"), hrDefinitions("lthr"), lthrBpm),
    thresholdPace: configuredZones(zoneArray("ltspZone", "thresholdPaceZone", "paceZone"), paceDefinitions),
    ftp: configuredZones(zoneArray("cyclePowerZone", "ftpZone"), ftpDefinitions)
  };
  const lthrZones: WorkoutLthrZone[] = zones.lthr ?? [];
  const selectedUnitSystem = normalizeUnitSystem(unitSystem);
  const imperial = selectedUnitSystem === "imperial";
  const poolLengthUnit = imperial ? "yd" : "m";
  const poolLengthRaw = firstNumber(account.poolLength, zoneData.poolLength);
  const poolLengthMeters = poolLengthRaw
    ? (poolLengthRaw > 200 ? poolLengthRaw / 100 : poolLengthRaw)
    : 25;
  const poolLength = poolLengthMeters / (poolLengthUnit === "yd" ? 0.9144 : 1);
  const climbConfigs = Array.isArray(account.climbConfig)
    ? account.climbConfig
    : Array.isArray(zoneData.climbConfig) ? zoneData.climbConfig : [];
  const climbSystems: WorkoutEditorContext["climbSystems"] = {};
  for (const item of climbConfigs) {
    const config = objectValue(item);
    if (!config) continue;
    const sport = workoutSportFromType(config.sportType);
    const systemId = numberValue(config.gradingSystem ?? config.gradeSystem);
    const system = (Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>)
      .find((key) => CLIMB_SYSTEM_IDS[key] === systemId);
    if ((sport === "indoorClimb" || sport === "bouldering") && system) {
      climbSystems[sport] = system;
    }
  }
  return {
    distanceUnit: imperial ? "imperial" : "metric",
    paceUnit: imperial ? "mi" : "km",
    heartRateBasis,
    ...(lthrBpm ? { lthrBpm: Math.round(lthrBpm) } : {}),
    ...(maxHr ? { maxHr: Math.round(maxHr) } : {}),
    ...(restingHr ? { restingHr: Math.round(restingHr) } : {}),
    ...(thresholdPaceSecondsPerKm ? { thresholdPaceSecondsPerKm } : {}),
    ...(ftp ? { ftp: Math.round(ftp) } : {}),
    ...(criticalPower ? { criticalPower: Math.round(criticalPower) } : {}),
    zones,
    lthrZones,
    defaultPoolLength: { value: poolLength, unit: poolLengthUnit },
    climbSystems
  };
}

export function displayPaceToSecondsPerKm(seconds: number, unit: "km" | "mi"): number {
  return unit === "mi" ? seconds * MILES_PER_KILOMETER : seconds;
}

export function buildScheduledWorkoutEditRequest(
  ref: Extract<WorkoutEditRef, { kind: "scheduled" }>,
  entity: Record<string, unknown>,
  program: Record<string, unknown>
): Record<string, unknown> {
  return {
    entities: [structuredClone(entity)],
    programs: [structuredClone(program)],
    versionObjects: [
      {
        id: ref.idInPlan,
        status: 2,
        planProgramId: ref.planProgramId,
        planId: ref.planId
      }
    ],
    pbVersion: numberValue(program.pbVersion) ?? 2
  };
}

export interface WorkoutEditEndpointAdapter<TCalculation, TEstimate = unknown> {
  calculate: (program: Record<string, unknown>) => Promise<TCalculation>;
  updateLibrary: (program: TCalculation) => Promise<void>;
  updateScheduled: (request: Record<string, unknown>) => Promise<void>;
  estimateScheduled: (request: {
    entity: Record<string, unknown>;
    program: Record<string, unknown>;
  }) => Promise<TEstimate>;
}

export async function runWorkoutEditPreview<TCalculation, TEstimate>(
  ref: WorkoutEditRef,
  entity: Record<string, unknown> | undefined,
  program: Record<string, unknown>,
  adapter: WorkoutEditEndpointAdapter<TCalculation, TEstimate>
): Promise<TCalculation | TEstimate> {
  if (ref.kind === "library") {
    return adapter.calculate(program);
  }
  if (!entity) {
    throw new Error("Scheduled workout entity is missing.");
  }
  return adapter.estimateScheduled({ entity, program });
}

export async function runWorkoutEditWrite<TCalculation extends Record<string, unknown>>(
  ref: WorkoutEditRef,
  entity: Record<string, unknown> | undefined,
  program: Record<string, unknown>,
  adapter: WorkoutEditEndpointAdapter<TCalculation>
): Promise<TCalculation> {
  const calculated = await adapter.calculate(program);
  if (ref.kind === "library") {
    await adapter.updateLibrary(calculated);
    return calculated;
  }
  if (!entity) {
    throw new Error("Scheduled workout entity is missing.");
  }
  await adapter.updateScheduled(
    buildScheduledWorkoutEditRequest(ref, entity, calculated)
  );
  return calculated;
}
