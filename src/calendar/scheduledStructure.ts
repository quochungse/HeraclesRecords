import type {
  RunWorkoutEditorDraft,
  RunWorkoutEditorStep,
  RunWorkoutEditorTarget,
  TrainingHubScheduledExercise,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem,
  WorkoutIntensityInput
} from "../../electron/types";
import {
  POUNDS_PER_KILOGRAM,
  formatDistanceValue,
  formatElevationValue,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  speedUnit,
  weightUnit
} from "../units/units";
import {
  decodeCorosIntensity,
  formatWorkoutIntensity
} from "../../electron/workoutCapabilities";

/**
 * View-model builder for the scheduled-workout detail panel. Prefers the raw
 * COROS program payload (step kinds, repeat groups, pace/HR intensity) and
 * falls back to the pre-parsed exercise list when the payload is missing.
 */

export type ScheduledStepKind =
  | "warmup"
  | "training"
  | "rest"
  | "cooldown"
  | "sendOff";

export interface ScheduledStepView {
  id: string;
  kind: ScheduledStepKind;
  name: string;
  /** Compact target text — "800 m", "10:00", "12 reps", "Open". */
  targetLabel?: string;
  /** Intensity text decoded from the raw payload — "140–150 bpm", "5:00–5:10/km". */
  intensityLabel?: string;
  /** Bar-chart magnitude: meters for distance targets, seconds for time. */
  magnitude?: number;
  magnitudeType?: "distance" | "time";
  /**
   * The COROS catalog id this step's exercise came from, where there is one.
   * A surface that holds the exercise catalog uses it to reach the movement's
   * demonstration clip; one that does not simply has no media to draw.
   */
  exerciseId?: string;
  /** Strength metadata. */
  sets?: number;
  reps?: number;
  weight?: number;
  weightUnit?: "kg" | "lb";
}

export interface ScheduledRepeatView {
  type: "repeat";
  id: string;
  name: string;
  repeat: number;
  steps: ScheduledStepView[];
  /** Aggregate magnitude of ONE repetition (dominant unit across children). */
  magnitude?: number;
  magnitudeType?: "distance" | "time";
}

export type ScheduledNodeView =
  | { type: "step"; step: ScheduledStepView }
  | ScheduledRepeatView;

export interface ScheduledStructureTotals {
  distanceMeters?: number;
  durationSeconds?: number;
  /** Leaf steps (repeat children counted once each). */
  stepCount: number;
  repeatGroups: number;
}

export interface ScheduledStructureView {
  nodes: ScheduledNodeView[];
  totals: ScheduledStructureTotals;
  /** Where the structure came from — raw COROS payload or parsed exercises. */
  source: "raw" | "parsed";
}

const EXERCISE_TYPE_TO_KIND: Record<number, ScheduledStepKind> = {
  1: "warmup",
  2: "training",
  3: "cooldown",
  4: "rest",
  5: "sendOff"
};

const FRIENDLY_KIND_NAME: Record<ScheduledStepKind, string> = {
  warmup: "Warm Up",
  training: "Training",
  rest: "Rest",
  cooldown: "Cool Down",
  sendOff: "Send-off"
};

function finiteNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function formatStepTimeLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatStepDistanceLabel(
  meters: number,
  unitSystem: UnitSystem,
  swim = false
): string {
  if (unitSystem === "imperial" || swim) {
    return formatDistanceValue(meters, unitSystem, {
      swim,
      digits: swim ? 0 : meters >= 16_093.44 ? 1 : 2
    });
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(km >= 10 ? 1 : 2)} km`;
}

interface ParsedTarget {
  label?: string;
  magnitude?: number;
  magnitudeType?: "distance" | "time";
}

/** Mirror of the editor's parseTarget — COROS schedule distances are centimeters. */
function parseRawTarget(
  exercise: Record<string, unknown>,
  kind: ScheduledStepKind,
  unitSystem: UnitSystem,
  swim: boolean
): ParsedTarget {
  const targetType = finiteNumber(exercise.targetType);
  const targetValue = finiteNumber(exercise.targetValue) ?? 0;

  switch (targetType) {
    case 1:
      return { label: "Open" };
    case 2:
      return targetValue > 0
        ? {
            label: formatStepTimeLabel(targetValue),
            magnitude: targetValue,
            magnitudeType: "time"
          }
        : { label: "Open" };
    case 3:
      return { label: `${Math.round(targetValue)} reps` };
    case 5: {
      const meters = targetValue / 100;
      return meters > 0
        ? {
            label: formatStepDistanceLabel(meters, unitSystem, swim),
            magnitude: meters,
            magnitudeType: "distance"
          }
        : { label: "Open" };
    }
    case 6:
      return { label: `${Math.round(targetValue)} TL` };
    case 7:
      return kind === "rest"
        ? { label: `Until ${Math.round(targetValue)} bpm` }
        : { label: `${Math.round(targetValue)} bpm` };
    case 8:
      return {
        label: `${formatElevationValue(targetValue / 100, unitSystem, "0")} gain`
      };
    case 9:
      return { label: `${Math.round(targetValue)} routes` };
    default:
      return {};
  }
}

interface DecodedIntensity {
  label?: string;
  weightValue?: number;
  weightUnit?: "kg" | "lb";
}

function decodeIntensity(
  exercise: Record<string, unknown>,
  unitSystem: UnitSystem
): DecodedIntensity {
  try {
    const { intensity } = decodeCorosIntensity(exercise);
    return localizeIntensity(intensity, unitSystem);
  } catch {
    return {};
  }
}

/**
 * One intensity, in the reader's own units.
 *
 * Split out of `decodeIntensity` so the editor draft can spend it too: a draft
 * carries the same `WorkoutIntensityInput` the COROS payload decodes to, and a
 * second formatter beside this one is how the day drawer and the library view
 * would start disagreeing about what a pace means.
 */
function localizeIntensity(
  intensity: WorkoutIntensityInput,
  unitSystem: UnitSystem
): DecodedIntensity {
  if (intensity.type === "none") {
    return {};
  }
  if (intensity.type === "pace" || intensity.type === "effortPace") {
    const formatted = formatWorkoutIntensity({
      ...intensity,
      displayUnit: unitSystem === "imperial" ? "mi" : "km"
    });
    return { label: formatted === "Not set" ? undefined : formatted };
  }
  if (intensity.type === "speed") {
    const lowKmh = intensity.unit === "mph" ? intensity.low * 1.609344 : intensity.low;
    const highKmh = intensity.unit === "mph" ? intensity.high * 1.609344 : intensity.high;
    const formatted = formatWorkoutIntensity({
      ...intensity,
      low: kmhToDisplaySpeed(lowKmh, unitSystem),
      high: kmhToDisplaySpeed(highKmh, unitSystem),
      unit: speedUnit(unitSystem)
    });
    return { label: formatted === "Not set" ? undefined : formatted };
  }
  if (intensity.type === "weight" && intensity.mode === "weight") {
    // COROS writes a weight of 0 for an exercise with no load prescribed —
    // it has `bodyweight` for the other case — so "0.0 kg" on the row is not
    // a figure, it is the absence of one.
    if (!(intensity.value > 0)) {
      return {};
    }
    const weightValue = intensity.unit === "lb"
      ? intensity.value / POUNDS_PER_KILOGRAM
      : intensity.value;
    const displayWeight = kilogramsToDisplayWeight(weightValue, unitSystem);
    const formatted = formatWorkoutIntensity({
      ...intensity,
      value: Number(displayWeight.toFixed(1)),
      unit: weightUnit(unitSystem)
    });
    return {
      label: formatted === "Not set" ? undefined : formatted,
      weightValue,
      weightUnit: "kg"
    };
  }
  const formatted = formatWorkoutIntensity(intensity);
  const label = formatted === "Not set" ? undefined : formatted;
  return { label };
}

function friendlyStepName(rawName: string, kind: ScheduledStepKind): string {
  const trimmed = rawName.trim();
  // COROS template steps carry opaque names like "T3001" — swap in the kind.
  if (!trimmed || /^T\d+$/i.test(trimmed)) {
    return FRIENDLY_KIND_NAME[kind];
  }
  return trimmed;
}

function parseRawStep(
  exercise: Record<string, unknown>,
  index: number,
  unitSystem: UnitSystem,
  swim: boolean
): ScheduledStepView {
  const exerciseType = finiteNumber(exercise.exerciseType) ?? 2;
  const kind = EXERCISE_TYPE_TO_KIND[exerciseType] ?? "training";
  const target = parseRawTarget(exercise, kind, unitSystem, swim);
  const intensity = decodeIntensity(exercise, unitSystem);
  const id =
    exercise.id !== undefined ? String(exercise.id) : `step-${index}`;
  const targetType = finiteNumber(exercise.targetType);
  const targetValue = finiteNumber(exercise.targetValue) ?? 0;

  // COROS keeps the catalog id of the movement a step was built from on
  // `originId`; `id` is the step's own. "0" is its way of saying none.
  const originId = exercise.originId === undefined || exercise.originId === null
    ? undefined
    : String(exercise.originId);

  return {
    id,
    kind,
    name: friendlyStepName(String(exercise.name ?? ""), kind),
    targetLabel: target.label,
    intensityLabel: intensity.label,
    magnitude: target.magnitude,
    magnitudeType: target.magnitudeType,
    ...(originId && originId !== "0" ? { exerciseId: originId } : {}),
    sets: finiteNumber(exercise.sets),
    reps: targetType === 3 && targetValue > 0 ? Math.round(targetValue) : undefined,
    weight: intensity.weightValue,
    weightUnit: intensity.weightUnit
  };
}

function dominantMagnitude(
  steps: ScheduledStepView[]
): Pick<ScheduledRepeatView, "magnitude" | "magnitudeType"> {
  const distance = steps
    .filter((step) => step.magnitudeType === "distance")
    .reduce((sum, step) => sum + (step.magnitude ?? 0), 0);
  const time = steps
    .filter((step) => step.magnitudeType === "time")
    .reduce((sum, step) => sum + (step.magnitude ?? 0), 0);
  if (distance > 0) {
    return { magnitude: distance, magnitudeType: "distance" };
  }
  if (time > 0) {
    return { magnitude: time, magnitudeType: "time" };
  }
  return {};
}

function buildFromRawProgram(
  program: Record<string, unknown>,
  unitSystem: UnitSystem,
  swim: boolean
): ScheduledNodeView[] {
  const rawExercises = Array.isArray(program.exercises)
    ? program.exercises
        .map(objectRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const exercises = [...rawExercises].sort(
    (left, right) =>
      (finiteNumber(left.sortNo) ?? 0) - (finiteNumber(right.sortNo) ?? 0)
  );

  const groupedIds = new Set(
    exercises
      .filter((exercise) => Boolean(exercise.isGroup))
      .map((exercise) => (exercise.id !== undefined ? String(exercise.id) : ""))
      .filter(Boolean)
  );
  const consumed = new Set<Record<string, unknown>>();
  const nodes: ScheduledNodeView[] = [];

  exercises.forEach((exercise, index) => {
    if (consumed.has(exercise)) {
      return;
    }
    const id = exercise.id !== undefined ? String(exercise.id) : "";

    if (Boolean(exercise.isGroup)) {
      const children = exercises.filter(
        (candidate) =>
          !candidate.isGroup && String(candidate.groupId ?? "") === id
      );
      children.forEach((child) => consumed.add(child));
      const steps = children.map((child, childIndex) =>
        parseRawStep(child, childIndex, unitSystem, swim)
      );
      const repeat = Math.max(
        1,
        Math.min(99, Math.round(finiteNumber(exercise.sets) ?? 1))
      );
      nodes.push({
        type: "repeat",
        id: id || `group-${index}`,
        name: String(exercise.name ?? "Repeat"),
        repeat,
        steps,
        ...dominantMagnitude(steps)
      });
      consumed.add(exercise);
      return;
    }

    const groupId = String(exercise.groupId ?? "");
    if (groupId && groupId !== "0" && groupedIds.has(groupId)) {
      return; // child consumed by its group
    }
    nodes.push({
      type: "step",
      step: parseRawStep(exercise, index, unitSystem, swim)
    });
    consumed.add(exercise);
  });

  return nodes;
}

/** Name-based kind guess for the pre-parsed fallback path. */
function classifyParsedExercise(name: string): ScheduledStepKind {
  const normalized = name.trim().toLowerCase();
  if (/warm[\s-]?up/.test(normalized)) {
    return "warmup";
  }
  if (/cool[\s-]?down/.test(normalized)) {
    return "cooldown";
  }
  if (/\b(rest|recover|recovery)\b/.test(normalized)) {
    return "rest";
  }
  return "training";
}

function magnitudeFromLabel(
  label?: string
): Pick<ScheduledStepView, "magnitude" | "magnitudeType"> {
  if (!label) {
    return {};
  }
  const kmMatch = label.match(/([\d.]+)\s*km/i);
  if (kmMatch) {
    const km = Number(kmMatch[1]);
    if (Number.isFinite(km) && km > 0) {
      return { magnitude: km * 1000, magnitudeType: "distance" };
    }
  }
  const mMatch = label.match(/([\d.]+)\s*m\b/i);
  if (mMatch && !/min|gain/i.test(label)) {
    const meters = Number(mMatch[1]);
    if (Number.isFinite(meters) && meters > 0) {
      return { magnitude: meters, magnitudeType: "distance" };
    }
  }
  const timeMatch = label.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1] ?? 0);
    const minutes = Number(timeMatch[2]);
    const seconds = Number(timeMatch[3]);
    const total = hours * 3600 + minutes * 60 + seconds;
    if (total > 0) {
      return { magnitude: total, magnitudeType: "time" };
    }
  }
  return {};
}

function buildFromParsedExercises(
  exercises: TrainingHubScheduledExercise[],
  unitSystem: UnitSystem,
  swim: boolean
): ScheduledNodeView[] {
  return exercises.map((exercise, index) => {
    const magnitude = magnitudeFromLabel(exercise.targetLabel);
    return {
      type: "step" as const,
      step: {
      id: `parsed-${index}`,
      kind: classifyParsedExercise(exercise.name),
      name: exercise.name,
      targetLabel:
        magnitude.magnitudeType === "distance" && magnitude.magnitude
          ? formatStepDistanceLabel(magnitude.magnitude, unitSystem, swim)
          : exercise.targetLabel,
      ...magnitude,
      sets: exercise.sets,
      reps: exercise.reps,
      weight: exercise.weight,
      weightUnit: exercise.weight !== undefined ? "kg" : undefined
      }
    };
  });
}

function computeTotals(nodes: ScheduledNodeView[]): ScheduledStructureTotals {
  let distanceMeters = 0;
  let durationSeconds = 0;
  let stepCount = 0;
  let repeatGroups = 0;

  const accumulate = (step: ScheduledStepView, factor: number) => {
    stepCount += 1;
    if (step.magnitudeType === "distance" && step.magnitude) {
      distanceMeters += step.magnitude * factor;
    } else if (step.magnitudeType === "time" && step.magnitude) {
      durationSeconds += step.magnitude * factor;
    }
  };

  for (const node of nodes) {
    if (node.type === "step") {
      accumulate(node.step, 1);
    } else {
      repeatGroups += 1;
      for (const step of node.steps) {
        accumulate(step, node.repeat);
      }
    }
  }

  return {
    distanceMeters: distanceMeters > 0 ? distanceMeters : undefined,
    durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
    stepCount,
    repeatGroups
  };
}

export function buildScheduledWorkoutView(
  entry: Pick<
    TrainingHubScheduledWorkoutEntry,
    "exercises" | "rawProgram" | "sportType"
  >,
  unitSystem: UnitSystem
): ScheduledStructureView {
  const rawProgram = objectRecord(entry.rawProgram);
  const hasRawExercises =
    rawProgram !== undefined &&
    Array.isArray(rawProgram.exercises) &&
    rawProgram.exercises.length > 0;

  const swim = Number(entry.sportType) === 3;
  const nodes = hasRawExercises
    ? buildFromRawProgram(rawProgram, unitSystem, swim)
    : buildFromParsedExercises(entry.exercises ?? [], unitSystem, swim);

  return {
    nodes,
    totals: computeTotals(nodes),
    source: hasRawExercises ? "raw" : "parsed"
  };
}

/**
 * What one exercise asks for, in one line: the sets, and what each set holds.
 *
 * `targetLabel` already says what a set is — "12 reps", "0:45", "Open" — so
 * the set count multiplies that rather than the reps alone. Built from `reps`
 * only, the line was empty for every timed exercise and every open one, and
 * the set count appeared on neither.
 */
export function liftSchemeLabel(step: ScheduledStepView): string | undefined {
  const sets = Math.max(1, Math.round(step.sets ?? 1));
  const per = step.targetLabel ?? (step.reps ? `${step.reps} reps` : undefined);
  if (!per) {
    return sets > 1 ? `${sets} sets` : undefined;
  }
  return sets > 1 ? `${sets} × ${per}` : per;
}

/**
 * The same view, built from an editor draft instead of a COROS payload.
 *
 * A library workout is only ever read through the editor's document, which
 * hands back a draft rather than the raw program — so without this the
 * Calendar had no way to show one except as the edit form with its controls
 * switched off. The draft carries exactly what the raw path parses out, in
 * decoded form, so the mapping is a rename rather than a second reading of
 * COROS: `targetType: 5` has already become `{ type: "distance", meters }`,
 * and the intensity is already a `WorkoutIntensityInput`.
 *
 * Distances are metres here, not the centimetres the schedule payload uses.
 */
export function buildEditorDraftView(
  draft: Pick<RunWorkoutEditorDraft, "nodes" | "sport">,
  unitSystem: UnitSystem,
  /**
   * COROS exercise ids to their catalog names. A strength step's own
   * `exerciseName` is a localization key — the live library answers `T1041`
   * for a bench press — so without the catalog every exercise in a session
   * reads as the step kind, which is the same word nine times.
   */
  exerciseNames?: ReadonlyMap<string, string>
): ScheduledStructureView {
  const swim = draft.sport === "swim";
  const nodes: ScheduledNodeView[] = draft.nodes.map((node, index) => {
    if (node.nodeType === "step") {
      return {
        type: "step",
        step: draftStepView(node, index, unitSystem, swim, exerciseNames)
      };
    }
    const steps = node.steps.map((step, childIndex) =>
      draftStepView(step, childIndex, unitSystem, swim, exerciseNames)
    );
    return {
      type: "repeat",
      id: node.id,
      name: node.name,
      repeat: Math.max(1, Math.round(node.repeat)),
      steps,
      ...dominantMagnitude(steps)
    };
  });

  return { nodes, totals: computeTotals(nodes), source: "raw" };
}

function draftStepView(
  step: RunWorkoutEditorStep,
  index: number,
  unitSystem: UnitSystem,
  swim: boolean,
  exerciseNames?: ReadonlyMap<string, string>
): ScheduledStepView {
  const target = draftTargetView(step.target, step.kind, unitSystem, swim);
  const intensity = localizeIntensity(step.intensity, unitSystem);
  // A strength step's own name is the kind ("Training") and its `exerciseName`
  // is a COROS key, so the catalog is asked first and `friendlyStepName`
  // turns whatever is left into the kind rather than showing the key.
  const catalogName = step.exerciseId
    ? exerciseNames?.get(step.exerciseId)
    : undefined;

  return {
    id: step.id || `step-${index}`,
    kind: step.kind,
    name: friendlyStepName(catalogName ?? step.exerciseName ?? step.name, step.kind),
    targetLabel: target.label,
    intensityLabel: intensity.label,
    magnitude: target.magnitude,
    magnitudeType: target.magnitudeType,
    ...(step.exerciseId ? { exerciseId: step.exerciseId } : {}),
    sets: step.sets,
    reps: step.target.type === "reps" ? step.target.count : undefined,
    weight: intensity.weightValue,
    weightUnit: intensity.weightUnit
  };
}

function draftTargetView(
  target: RunWorkoutEditorTarget,
  kind: ScheduledStepKind,
  unitSystem: UnitSystem,
  swim: boolean
): ParsedTarget {
  switch (target.type) {
    case "time":
      return target.seconds > 0
        ? {
            label: formatStepTimeLabel(target.seconds),
            magnitude: target.seconds,
            magnitudeType: "time"
          }
        : { label: "Open" };
    case "distance":
      return target.meters > 0
        ? {
            label: formatStepDistanceLabel(target.meters, unitSystem, swim),
            magnitude: target.meters,
            magnitudeType: "distance"
          }
        : { label: "Open" };
    case "load":
      return { label: `${Math.round(target.load)} TL` };
    case "hrRecovery":
      return kind === "rest"
        ? { label: `Until ${Math.round(target.bpm)} bpm` }
        : { label: `${Math.round(target.bpm)} bpm` };
    case "reps":
      return { label: `${Math.round(target.count)} reps` };
    case "elevationGain":
      return { label: `${formatElevationValue(target.meters, unitSystem, "0")} gain` };
    case "routes":
      return { label: `${Math.round(target.count)} routes` };
    case "open":
    default:
      return { label: "Open" };
  }
}

/**
 * What a planned workout asks for, as one phrase.
 *
 * COROS's own `volume` string reports a **step count** whenever a program has
 * more than one step — `resolveWorkoutSetCount` wins over distance in
 * `formatUpcomingWorkoutVolume` — so a 13 km long run built as warm-up, main
 * and cool-down arrived as "3 set(s)". The scheduled detail drew that under
 * "Volume" and "13.0 km total" two lines below it, in the same panel.
 *
 * The steps know better, so they are asked first: their own distance, then
 * their own duration, and only then COROS's string, which is the right answer
 * for a strength workout — where sets are the volume and there is no distance
 * to total.
 */
export function formatPlannedVolume(
  totals: ScheduledStructureTotals,
  volume: string | undefined,
  unitSystem: UnitSystem,
  swim: boolean,
  fallback: string
): string {
  if (totals.distanceMeters) {
    return formatStepDistanceLabel(totals.distanceMeters, unitSystem, swim);
  }
  if (totals.durationSeconds) {
    return formatStepTimeLabel(totals.durationSeconds);
  }
  return volume ? fallback : "--";
}
