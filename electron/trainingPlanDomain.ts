import type {
  PlanDraftPreview,
  PlanWorkoutEntryInput,
  RunWorkoutCreateRepeatGroup,
  RunWorkoutCreateStep,
  RunWorkoutStepInput,
  TrainingPlanDocument,
  TrainingPlanEntry,
  TrainingPlanGenerationRequest,
  TrainingPlanWeekStage,
  WorkoutSport
} from "./types";

export interface TrainingPlanValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface TrainingPlanWeekSummary {
  weekIndex: number;
  workouts: number;
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
}

export interface TrainingPlanSummary {
  planId: string;
  name: string;
  weekCount: number;
  workouts: number;
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
  strengthSets: number;
  sportDistribution: Partial<Record<WorkoutSport, number>>;
  weekly: TrainingPlanWeekSummary[];
  peakWeek?: number;
}

/**
 * A week's stage is one of COROS's seven, not a name: `stage` is the index the
 * web app's picker hands back, and `key` is its string-table entry. There is
 * no Taper, and no way to name a stage. `slug` is what the stylesheet colours
 * a stage by (`[data-stage]`).
 */
export const COROS_WEEK_STAGES = [
  { value: 0, key: "R6014", label: "Not Set", slug: "none" },
  { value: 1, key: "C1026", label: "Preparation", slug: "preparation" },
  { value: 2, key: "C1027", label: "Base", slug: "base" },
  { value: 3, key: "C1028", label: "Build", slug: "build" },
  { value: 4, key: "C1029", label: "Peak", slug: "peak" },
  { value: 5, key: "C1030", label: "Race", slug: "race" },
  { value: 6, key: "C1031", label: "Transition", slug: "transition" }
] as const;

export type CorosWeekStageSlug = (typeof COROS_WEEK_STAGES)[number]["slug"];

/** A plan's length limit, and the web app's per-day one. */
export const TRAINING_PLAN_MAX_WEEKS = 52;
export const TRAINING_PLAN_SESSIONS_PER_DAY = 10;

const SPORT_BY_TYPE: Record<number, WorkoutSport> = {
  1: "run",
  2: "bike",
  3: "swim",
  4: "strength",
  5: "trailRun",
  6: "indoorClimb",
  7: "bouldering",
  8: "xcSki",
  9: "hyrox"
};

export function workoutSportFromType(value?: number): WorkoutSport | undefined {
  return value === undefined ? undefined : SPORT_BY_TYPE[value];
}

function uniqueId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}

/** `YYYY-MM-DD` or `yyyyMMdd`, at midday local — midnight parsed in one zone reads as the day before in another. */
export function parsePlanDay(value: string | undefined): Date | undefined {
  const digits = value?.replace(/-/g, "") ?? "";
  if (!/^\d{8}$/.test(digits)) return undefined;
  const date = new Date(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8)),
    12
  );
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

/** The Monday of a day's week — where COROS counts a plan's `dayNo` from. */
export function mondayOf(date: Date): Date {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export function formatPlanDay(date: Date, dashed: boolean): string {
  const value = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return dashed ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.valueOf() - from.valueOf()) / 86_400_000);
}

/** The sports a plan's sessions are, once each — what a library tile draws. */
export function sportMixOf(entries: readonly TrainingPlanEntry[]): WorkoutSport[] {
  return [...new Set(entries.map((entry) => entry.workout.sport ?? "run"))];
}

/** A plan that exists only here until it is saved: a draft. */
export function createTrainingPlan(name = "New plan"): TrainingPlanDocument {
  return {
    id: uniqueId("draft"),
    name,
    description: "",
    weekCount: 4,
    weekStages: [],
    entries: [],
    sportMix: [],
    calendar: "unscheduled",
    tags: [],
    favorite: false,
    archived: false,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Dated sessions as plan days, counted from the Monday of the earliest one —
 * the anchor COROS itself uses when a plan goes on the calendar, so a coach
 * session dated Wednesday is a Wednesday session in the plan.
 */
function placeDatedWorkouts(
  workouts: ReadonlyArray<{ key: string; name: string; source: PlanWorkoutEntryInput; date?: string }>,
  idPrefix: string,
  anchor?: Date,
  layout?: Record<string, { weekIndex: number; dayIndex: number }>
): TrainingPlanEntry[] {
  const dates = workouts
    .map((workout) => parsePlanDay(workout.date))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.valueOf() - right.valueOf());
  const monday = anchor ?? (dates[0] ? mondayOf(dates[0]) : undefined);
  /* An undated session is placed one a day from the first free Monday slot —
     a plan has no day-less sessions any more. */
  let undated = 0;
  return workouts.map((workout, index) => {
    const date = parsePlanDay(workout.date);
    const placed = layout?.[workout.key];
    const offset =
      monday && date
        ? Math.max(0, daysBetween(monday, date))
        : placed
          ? placed.weekIndex * 7 + placed.dayIndex
          : undated++;
    return {
      id: `entry:${idPrefix}:${workout.key || index}`,
      weekIndex: Math.floor(offset / 7),
      dayIndex: offset % 7,
      sortOrder: workout.source.sort_no ?? index,
      title: workout.name,
      workout: {
        ...structuredClone(workout.source),
        name: workout.name,
        save_to_library: false
      }
    };
  });
}

export function trainingPlanFromDraftPreview(
  preview: PlanDraftPreview,
  request: TrainingPlanGenerationRequest
): TrainingPlanDocument {
  if (!request.goal.trim()) throw new Error("Add a training goal before generating a plan.");
  if (request.weeks < 1 || request.weeks > 24) throw new Error("Generated plans must contain 1 to 24 weeks.");
  if (request.sessionsPerWeek < 1 || request.sessionsPerWeek > 7) throw new Error("Sessions per week must be between 1 and 7.");
  if (request.sports.length === 0) throw new Error("Choose at least one sport.");
  if (request.availableDayIndexes.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Available days must be Monday through Sunday.");
  if (request.availableDayIndexes.length < request.sessionsPerWeek) throw new Error("Choose at least as many available days as weekly sessions.");
  if (request.maxSessionMinutes !== undefined && request.maxSessionMinutes <= 0) throw new Error("The session-duration limit must be greater than zero.");
  const start = parsePlanDay(request.startDate);
  if (!start) throw new Error("Choose a valid plan start date.");
  if (!preview.name.trim()) throw new Error("Training Coach returned a plan without a name.");

  const lastDay = new Date(start);
  lastDay.setDate(lastDay.getDate() + request.weeks * 7);
  /* Counted in the weeks the athlete asked for, from their start day — not in
     calendar weeks, which a mid-week start splits in two. */
  const perRequestedWeek = new Map<number, number>();
  for (const entry of preview.entries) {
    if (!entry.source) throw new Error(`Generated workout "${entry.name}" is missing its structured definition.`);
    const date = parsePlanDay(entry.source.schedule_date ?? entry.scheduleDate);
    if (!date) throw new Error(`Generated workout "${entry.name}" is missing a schedule date.`);
    if (date < start || date >= lastDay) {
      throw new Error(`Generated workout "${entry.name}" falls outside the requested plan dates.`);
    }
    if (!request.availableDayIndexes.includes((date.getDay() + 6) % 7)) {
      throw new Error(`Generated workout "${entry.name}" was placed on an unavailable day.`);
    }
    if (!request.sports.includes(entry.source.sport ?? "run")) {
      throw new Error(`Generated workout "${entry.name}" uses a sport that was not requested.`);
    }
    const week = Math.floor(daysBetween(start, date) / 7);
    perRequestedWeek.set(week, (perRequestedWeek.get(week) ?? 0) + 1);
  }
  for (let week = 0; week < request.weeks; week += 1) {
    const count = perRequestedWeek.get(week) ?? 0;
    if (count !== request.sessionsPerWeek) {
      throw new Error(`Generated week ${week + 1} has ${count} workouts instead of ${request.sessionsPerWeek}.`);
    }
  }

  const document = createTrainingPlan(preview.name);
  document.description = [
    request.goal.trim(),
    preview.summary.trim() || "Generated with Training Coach from your current training context.",
    request.constraints?.trim(),
    ...preview.warnings
  ].filter(Boolean).join("\n\n");
  document.origin = "coach";
  document.coach = { draftId: preview.draftId };
  document.entries = placeDatedWorkouts(
    preview.entries.map((entry) => ({
      key: entry.key,
      name: entry.name,
      source: entry.source!,
      date: entry.source!.schedule_date ?? entry.scheduleDate
    })),
    preview.draftId,
    mondayOf(start)
  );
  document.weekCount = Math.max(1, ...document.entries.map((entry) => entry.weekIndex + 1));
  if (request.maxSessionMinutes) {
    const overLimit = document.entries.find((entry) => workoutMetrics(entry.workout).durationSeconds > request.maxSessionMinutes! * 60);
    if (overLimit) {
      throw new Error(`Generated workout "${overLimit.title}" exceeds the session-duration limit.`);
    }
  }
  document.sportMix = sportMixOf(document.entries);
  return document;
}

/** A Coach plan card as a plan document, for the editor and for a save to COROS. */
export function trainingPlanFromCoachDraftPreview(
  preview: PlanDraftPreview,
  extras: {
    description?: string;
    weekStages?: TrainingPlanDocument["weekStages"];
    layout?: Record<string, { weekIndex: number; dayIndex: number }>;
  } = {}
): TrainingPlanDocument {
  if (!preview.name.trim()) throw new Error("Training Coach returned a plan without a name.");
  const document = createTrainingPlan(preview.name);
  /* Not the card's summary or its warnings: this becomes the plan's overview
     on COROS, and "3 workouts · none scheduled" describes the card. */
  document.description = extras.description?.trim() || "Created in Training Coach.";
  document.origin = "coach";
  document.coach = { draftId: preview.draftId };
  document.entries = placeDatedWorkouts(
    preview.entries.map((entry, index) => ({
      key: entry.key,
      name: entry.name,
      source: entry.source
        ? structuredClone(entry.source)
        : { key: entry.key || `coach-${index + 1}`, name: entry.name, sport: entry.sport ?? "run", save_to_library: false },
      date: entry.source?.schedule_date ?? entry.scheduleDate
    })),
    preview.draftId,
    undefined,
    extras.layout
  );
  document.weekCount = Math.max(1, ...document.entries.map((entry) => entry.weekIndex + 1));
  document.weekStages = (extras.weekStages ?? []).filter((stage) => stage.weekIndex < document.weekCount);
  document.sportMix = sportMixOf(document.entries);
  return document;
}

/** Inserts a copy of a week after it; later weeks and their stages move down one. */
export function duplicateTrainingPlanWeek(
  plan: TrainingPlanDocument,
  weekIndex: number
): TrainingPlanDocument {
  if (weekIndex < 0 || weekIndex >= plan.weekCount) {
    throw new Error("Week index is outside the plan.");
  }
  const shifted = plan.entries.map((entry) =>
    entry.weekIndex > weekIndex ? { ...entry, weekIndex: entry.weekIndex + 1 } : entry
  );
  const copies = plan.entries
    .filter((entry) => entry.weekIndex === weekIndex)
    .map((entry) => copiedEntry(entry, { weekIndex: weekIndex + 1 }));
  const stage = plan.weekStages.find((item) => item.weekIndex === weekIndex);
  return {
    ...plan,
    weekCount: plan.weekCount + 1,
    entries: [...shifted, ...copies],
    weekStages: [
      ...plan.weekStages.map((item) =>
        item.weekIndex > weekIndex ? { ...item, weekIndex: item.weekIndex + 1 } : item
      ),
      ...(stage ? [{ weekIndex: weekIndex + 1, stage: stage.stage }] : [])
    ]
  };
}

export function reorderTrainingPlanWeek(
  plan: TrainingPlanDocument,
  fromWeekIndex: number,
  toWeekIndex: number
): TrainingPlanDocument {
  if (
    fromWeekIndex < 0 ||
    toWeekIndex < 0 ||
    fromWeekIndex >= plan.weekCount ||
    toWeekIndex >= plan.weekCount
  ) {
    throw new Error("Week index is outside the plan.");
  }
  const remap = (week: number) => {
    if (week === fromWeekIndex) return toWeekIndex;
    if (fromWeekIndex < toWeekIndex && week > fromWeekIndex && week <= toWeekIndex) return week - 1;
    if (fromWeekIndex > toWeekIndex && week >= toWeekIndex && week < fromWeekIndex) return week + 1;
    return week;
  };
  return {
    ...plan,
    entries: plan.entries.map((entry) => ({ ...entry, weekIndex: remap(entry.weekIndex) })),
    weekStages: plan.weekStages.map((item) => ({ ...item, weekIndex: remap(item.weekIndex) }))
  };
}

/**
 * A second copy of a session. It is a new session to COROS, so it drops the
 * plan-internal id and the calendar day of the one it was copied from; the
 * program itself is kept, since the steps are the same.
 */
export function copiedEntry(
  entry: TrainingPlanEntry,
  place: Partial<Pick<TrainingPlanEntry, "weekIndex" | "dayIndex" | "sortOrder">> = {}
): TrainingPlanEntry {
  const { idInPlan: _idInPlan, happenDay: _happenDay, ...rest } = structuredClone(entry);
  return { ...rest, ...place, id: uniqueId("entry") };
}

function isRepeatGroup(step: RunWorkoutStepInput): step is RunWorkoutCreateRepeatGroup {
  return typeof step === "object" && step !== null && "repeat" in step && "steps" in step;
}

function workoutMetrics(workout?: PlanWorkoutEntryInput): {
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
  strengthSets: number;
} {
  let durationSeconds = 0;
  let distanceMeters = (workout?.distance_km ?? 0) * 1000;
  let trainingLoad = 0;
  let strengthSets = 0;
  const count = (step: RunWorkoutCreateStep, multiplier: number) => {
    durationSeconds += (step.target_duration_seconds ?? 0) * multiplier;
    if (!workout?.distance_km) {
      distanceMeters += (step.target_distance_meters ?? 0) * multiplier;
    }
    trainingLoad += (step.target_load ?? 0) * multiplier;
    strengthSets += (step.sets ?? (step.target_reps ? 1 : 0)) * multiplier;
  };
  for (const node of workout?.steps ?? []) {
    if (isRepeatGroup(node)) {
      for (const step of node.steps) count(step, Math.max(1, node.repeat));
    } else {
      count(node, 1);
    }
  }
  return { durationSeconds, distanceMeters, trainingLoad, strengthSets };
}

/**
 * What one planned session amounts to.
 *
 * The steps' own figures where there are steps, falling back per figure to
 * the entry's `planned*` fields — a COROS program often carries a planned
 * load and no step structure, and a hand-built session the reverse. Per
 * figure rather than per entry, because a plan can state a distance and
 * leave the load to the steps.
 *
 * Exported because the reader draws these numbers for one session and the
 * library row draws their total, and two implementations of that arithmetic
 * would disagree in front of the athlete — the same reason `activityMetrics`
 * is shared rather than copied into the view.
 */
export function planEntryMetrics(entry: TrainingPlanEntry): {
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
  strengthSets: number;
} {
  const calculated = workoutMetrics(entry.workout);
  return {
    durationSeconds: calculated.durationSeconds || entry.plannedDurationSeconds || 0,
    distanceMeters: calculated.distanceMeters || entry.plannedDistanceMeters || 0,
    trainingLoad: calculated.trainingLoad || entry.plannedTrainingLoad || 0,
    strengthSets: calculated.strengthSets || entry.plannedStrengthSets || 0
  };
}

/**
 * What stops a plan being saved to COROS. A draft is saved whatever this says
 * — it exists to hold work that is not finished — so every issue here is
 * about the write, and the editor shows them where Save is.
 */
export function validateTrainingPlan(
  plan: TrainingPlanDocument
): TrainingPlanValidationIssue[] {
  const issues: TrainingPlanValidationIssue[] = [];
  if (!plan.name.trim()) {
    issues.push({ path: "name", message: "Add a plan name.", severity: "error" });
  }
  if (plan.weekCount < 1 || plan.weekCount > TRAINING_PLAN_MAX_WEEKS) {
    issues.push({ path: "weekCount", message: `Plans must contain 1 to ${TRAINING_PLAN_MAX_WEEKS} weeks.`, severity: "error" });
  }
  if (plan.entries.length === 0) {
    issues.push({ path: "entries", message: "Add a session — COROS does not keep an empty plan.", severity: "error" });
  }
  const perDay = new Map<string, number>();
  for (const entry of plan.entries) {
    if (entry.weekIndex < 0 || entry.weekIndex >= plan.weekCount) {
      issues.push({ path: `entries.${entry.id}`, message: "A session is outside the plan's weeks.", severity: "error" });
    }
    if (entry.dayIndex < 0 || entry.dayIndex > 6) {
      issues.push({ path: `entries.${entry.id}.dayIndex`, message: "A session is on a day outside the week.", severity: "error" });
    }
    const day = `${entry.weekIndex}:${entry.dayIndex}`;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  if ([...perDay.values()].some((count) => count > TRAINING_PLAN_SESSIONS_PER_DAY)) {
    issues.push({ path: "entries", message: `COROS takes at most ${TRAINING_PLAN_SESSIONS_PER_DAY} sessions on one day.`, severity: "error" });
  }
  const lastUsedWeek = Math.max(-1, ...plan.entries.map((entry) => entry.weekIndex));
  if (plan.entries.length && lastUsedWeek < plan.weekCount - 1) {
    const empty = plan.weekCount - 1 - lastUsedWeek;
    issues.push({
      path: "weekCount",
      message: `COROS ends a plan at its last session, so the ${empty === 1 ? "empty last week is" : `${empty} empty weeks at the end are`} not kept.`,
      severity: "warning"
    });
  }
  return issues;
}

/** The stage of a week, Not Set when none is recorded. */
export function weekStageOf(plan: Pick<TrainingPlanDocument, "weekStages">, weekIndex: number): TrainingPlanWeekStage {
  return plan.weekStages.find((item) => item.weekIndex === weekIndex)?.stage ?? 0;
}

export function summarizeTrainingPlan(plan: TrainingPlanDocument): TrainingPlanSummary {
  const weekly: TrainingPlanWeekSummary[] = Array.from({ length: plan.weekCount }, (_, weekIndex) => ({
    weekIndex,
    workouts: 0,
    durationSeconds: 0,
    distanceMeters: 0,
    trainingLoad: 0
  }));
  const sportDistribution: Partial<Record<WorkoutSport, number>> = {};
  let durationSeconds = 0;
  let distanceMeters = 0;
  let trainingLoad = 0;
  let strengthSets = 0;

  for (const entry of plan.entries) {
    const metrics = planEntryMetrics(entry);
    durationSeconds += metrics.durationSeconds;
    distanceMeters += metrics.distanceMeters;
    trainingLoad += metrics.trainingLoad;
    strengthSets += metrics.strengthSets;
    const week = weekly[entry.weekIndex];
    if (week) {
      week.workouts += 1;
      week.durationSeconds += metrics.durationSeconds;
      week.distanceMeters += metrics.distanceMeters;
      week.trainingLoad += metrics.trainingLoad;
    }
    const sport = entry.workout.sport ?? "run";
    sportDistribution[sport] = (sportDistribution[sport] ?? 0) + 1;
  }
  const peak = weekly.reduce<TrainingPlanWeekSummary | undefined>(
    (best, week) => (!best || week.trainingLoad > best.trainingLoad ? week : best),
    undefined
  );
  return {
    planId: plan.id,
    name: plan.name,
    weekCount: plan.weekCount,
    workouts: plan.entries.length,
    durationSeconds,
    distanceMeters,
    trainingLoad,
    strengthSets,
    sportDistribution,
    weekly,
    peakWeek: peak ? peak.weekIndex + 1 : undefined
  };
}

export function planEntryFromWorkout(
  workout: PlanWorkoutEntryInput,
  weekIndex: number,
  dayIndex: number
): TrainingPlanEntry {
  return {
    id: uniqueId("entry"),
    weekIndex,
    dayIndex,
    sortOrder: 0,
    title: workout.name,
    workout: structuredClone(workout)
  };
}
