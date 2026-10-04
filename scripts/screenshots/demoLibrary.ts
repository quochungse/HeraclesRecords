// The demo Training Library: COROS workouts and plans.
import type {
  PlanWorkoutEntryInput,
  RunWorkoutCreateStep,
  RunWorkoutStepInput,
  TrainingActivityMatch,
  TrainingLibrarySnapshot,
  TrainingLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanEntry,
  TrainingPlanWeekStage,
  WorkoutEditorContext,
  WorkoutEditorDocument,
  WorkoutIntensityInput,
  WorkoutSport
} from "../../electron/types";
import { planWorkoutInputToEditorDraft } from "../../electron/planWorkoutEditor";
import { allActivities, dayKey } from "./demoData";
import { PLAN_NAME, PLAN_WEEKS, RUNNING_PLAN_ID, planSessions, planStart, sessionDay, type DemoSession } from "./demoPlan";

const easyHr: WorkoutIntensityInput = { type: "heartRate", lowBpm: 133, highBpm: 150 };
const tempoPace: WorkoutIntensityInput = { type: "pace", lowSecondsPerKm: 262, highSecondsPerKm: 272, displayUnit: "km" };
const intervalPace: WorkoutIntensityInput = { type: "pace", lowSecondsPerKm: 240, highSecondsPerKm: 255, displayUnit: "km" };
const mpPace: WorkoutIntensityInput = { type: "pace", lowSecondsPerKm: 280, highSecondsPerKm: 288, displayUnit: "km" };
const recoveryHr: WorkoutIntensityInput = { type: "heartRate", lowBpm: 110, highBpm: 133 };

const DEFAULT_NAMES: Record<string, string> = { warmup: "Warm up", cooldown: "Cool down", rest: "Recover", training: "Run" };
const dist = (kind: RunWorkoutCreateStep["kind"], meters: number, intensity: WorkoutIntensityInput, name?: string): RunWorkoutCreateStep => ({
  kind,
  name: name ?? DEFAULT_NAMES[kind] ?? kind,
  target_type: "distance",
  target_distance_meters: meters,
  intensity
});
const time = (kind: RunWorkoutCreateStep["kind"], seconds: number, intensity: WorkoutIntensityInput, name?: string): RunWorkoutCreateStep => ({
  kind,
  name: name ?? DEFAULT_NAMES[kind] ?? kind,
  target_type: "time",
  target_duration_seconds: seconds,
  intensity
});

export function sessionSteps(s: DemoSession): RunWorkoutStepInput[] {
  switch (s.kind) {
    case "tempo": {
      const tempoKm = Math.round(s.km - 3.5);
      return [dist("warmup", 2000, easyHr), dist("training", tempoKm * 1000, tempoPace, "Tempo"), dist("cooldown", 1500, recoveryHr)];
    }
    case "intervals": {
      const reps = Number(s.name.match(/^(\d+)/)?.[1] ?? 6);
      return [
        dist("warmup", 2400, easyHr),
        { repeat: reps, steps: [dist("training", 1000, intervalPace, "1 km hard"), dist("rest", 400, recoveryHr, "Jog")] },
        dist("cooldown", 2000, recoveryHr)
      ];
    }
    case "mp":
      return [dist("warmup", 2000, easyHr), { repeat: 2, steps: [dist("training", 5000, mpPace, "Marathon pace"), time("rest", 180, recoveryHr, "Float")] }, dist("cooldown", 2000, recoveryHr)];
    case "strides":
      return [dist("warmup", 3000, easyHr), { repeat: 3, steps: [dist("training", 1000, mpPace, "Marathon pace"), time("rest", 90, recoveryHr)] }, dist("cooldown", 2000, recoveryHr)];
    case "race":
      return [dist("training", 42195, mpPace, "Race")];
    case "long":
      return [dist("training", s.km * 1000, easyHr, "Long run")];
    default:
      return [dist("training", s.km * 1000, easyHr, "Easy")];
  }
}

function workoutInput(key: string, name: string, sport: WorkoutSport, steps: RunWorkoutStepInput[], description?: string): PlanWorkoutEntryInput {
  return { key, name, sport, steps, ...(description ? { description } : {}) };
}

const STAGES: TrainingPlanWeekStage[] = [2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5];

function marathonPlan(): TrainingPlanDocument {
  const sessions = planSessions();
  const entries: TrainingPlanEntry[] = sessions.map((s, index) => ({
    id: `marathon-${index + 1}`,
    weekIndex: s.week,
    dayIndex: s.day,
    sortOrder: 0,
    title: s.name,
    workout: workoutInput(`marathon-${index + 1}`, s.name, "run", sessionSteps(s)),
    idInPlan: String(index + 1),
    happenDay: sessionDay(s),
    plannedDurationSeconds: s.minutes * 60,
    plannedDistanceMeters: Math.round(s.km * 1000),
    plannedTrainingLoad: s.load
  }));
  return {
    id: `coros:${RUNNING_PLAN_ID}`,
    remoteId: RUNNING_PLAN_ID,
    remoteVersion: 4,
    name: PLAN_NAME,
    description:
      "Twelve weeks to the Hanoi Marathon: two base weeks, a long build with a quality session on Tuesday and marathon-pace work on Saturdays, a peak at 30 km, and a two-week taper.",
    weekCount: PLAN_WEEKS,
    weekStages: STAGES.map((stage, weekIndex) => ({ weekIndex, stage })),
    entries,
    sportMix: ["run"],
    calendar: "running",
    startDate: dayKey(planStart()),
    tags: ["Marathon"],
    favorite: true,
    archived: false,
    origin: "coach",
    updatedAt: new Date(Date.now() - 12 * 86_400_000).toISOString()
  };
}

function simplePlan(id: string, name: string, description: string, weeks: number, sport: WorkoutSport, perWeek: Array<{ day: number; name: string; km?: number; minutes: number; load: number; steps: RunWorkoutStepInput[] }>, stages: TrainingPlanWeekStage[], extra: Partial<TrainingPlanDocument> = {}): TrainingPlanDocument {
  const entries: TrainingPlanEntry[] = [];
  for (let w = 0; w < weeks; w += 1) {
    for (const [i, s] of perWeek.entries()) {
      const scale = 1 + Math.min(w, weeks - 2) * 0.06 - (w === weeks - 1 ? 0.25 : 0);
      entries.push({
        id: `${id}-${w}-${i}`,
        weekIndex: w,
        dayIndex: s.day,
        sortOrder: 0,
        title: s.name,
        workout: workoutInput(`${id}-${w}-${i}`, s.name, sport, s.steps),
        idInPlan: String(w * 10 + i + 1),
        plannedDurationSeconds: Math.round(s.minutes * 60 * scale),
        ...(s.km ? { plannedDistanceMeters: Math.round(s.km * 1000 * scale) } : {}),
        plannedTrainingLoad: Math.round(s.load * scale)
      });
    }
  }
  return {
    id: `coros:${id}`,
    remoteId: id,
    remoteVersion: 2,
    name,
    description,
    weekCount: weeks,
    weekStages: stages.map((stage, weekIndex) => ({ weekIndex, stage })),
    entries,
    sportMix: [sport],
    calendar: "unscheduled",
    tags: [],
    favorite: false,
    archived: false,
    origin: "user",
    updatedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    ...extra
  };
}

export const LIBRARY_WORKOUTS: Array<{ w: TrainingLibraryWorkout; input: PlanWorkoutEntryInput }> = [
  ["lib-10", "Runner's leg strength", 4, 45, 6, 18, 0, ["Strength"], true, { name: "Runner's leg strength", sport: "strength", description: "Single-leg and posterior-chain work for the marathon block.", steps: [{"kind":"training","name":"Goblet Squat","target_type":"reps","target_reps":10,"intensity":{"type":"weight","mode":"weight","value":20,"unit":"kg"},"exercise_id":"469656067215900672","exercise_name":"T1301","sets":3,"rest_type":1,"rest_value":60},{"kind":"training","name":"Romanian Deadlift","target_type":"reps","target_reps":8,"intensity":{"type":"weight","mode":"weight","value":40,"unit":"kg"},"exercise_id":"469655210101489664","exercise_name":"T1287","sets":3,"rest_type":1,"rest_value":60},{"kind":"training","name":"Walking Lunges","target_type":"reps","target_reps":12,"intensity":{"type":"weight","mode":"weight","value":10,"unit":"kg"},"exercise_id":"469646772906672129","exercise_name":"T1225","sets":3,"rest_type":1,"rest_value":60},{"kind":"training","name":"Hip Thrust","target_type":"reps","target_reps":10,"intensity":{"type":"weight","mode":"weight","value":50,"unit":"kg"},"exercise_id":"469655241508438016","exercise_name":"T1289","sets":3,"rest_type":1,"rest_value":60},{"kind":"training","name":"Single Leg Calf Raise","target_type":"reps","target_reps":15,"intensity":{"type":"weight","mode":"bodyweight"},"exercise_id":"469654960724951040","exercise_name":"T1275","sets":3,"rest_type":1,"rest_value":60},{"kind":"training","name":"Planks","target_type":"time","target_duration_seconds":45,"intensity":{"type":"weight","mode":"bodyweight"},"exercise_id":"425827856334110721","exercise_name":"T1010","sets":3,"rest_type":1,"rest_value":60}] } as PlanWorkoutEntryInput],
  ["lib-1", "6 × 1 km intervals", 1, 66, 4, 6, 0, ["Speed"], true, workoutInput("lib-1", "6 × 1 km intervals", "run", sessionSteps({ week: 0, day: 1, name: "6 × 1 km intervals", km: 12.8, load: 174, minutes: 63, kind: "intervals", steps: [] }))],
  ["lib-2", "Tempo 8 km", 1, 60, 3, 1, 0, ["Threshold"], true, workoutInput("lib-2", "Tempo 8 km", "run", [dist("warmup", 2000, easyHr), dist("training", 8000, tempoPace, "Tempo"), dist("cooldown", 1500, recoveryHr)])],
  ["lib-3", "Long run with fast finish", 1, 125, 2, 1, 0, ["Long run"], false, workoutInput("lib-3", "Long run with fast finish", "run", [dist("training", 18000, easyHr, "Steady"), dist("training", 4000, mpPace, "Fast finish")])],
  ["lib-4", "Hill repeats 8 × 90 s", 1, 55, 4, 8, 0, ["Strength", "Hills"], false, workoutInput("lib-4", "Hill repeats 8 × 90 s", "run", [time("warmup", 900, easyHr), { repeat: 8, steps: [time("training", 90, intervalPace, "Uphill"), time("rest", 120, recoveryHr, "Jog down")] }, time("cooldown", 600, recoveryHr)])],
  ["lib-5", "Easy run 45 min", 1, 45, 1, 1, 0, ["Easy"], false, workoutInput("lib-5", "Easy run 45 min", "run", [time("training", 2700, easyHr, "Easy")])],
  ["lib-6", "Threshold 3 × 10 min", 1, 58, 4, 3, 0, ["Threshold"], true, workoutInput("lib-6", "Threshold 3 × 10 min", "run", [time("warmup", 900, easyHr), { repeat: 3, steps: [time("training", 600, tempoPace, "Threshold"), time("rest", 120, recoveryHr)] }, time("cooldown", 600, recoveryHr)])],
  ["lib-7", "Fartlek 10 × 1 min", 1, 50, 4, 10, 0, ["Speed"], false, workoutInput("lib-7", "Fartlek 10 × 1 min", "run", [time("warmup", 900, easyHr), { repeat: 10, steps: [time("training", 60, intervalPace, "On"), time("rest", 60, easyHr, "Off")] }, time("cooldown", 600, recoveryHr)])],
  ["lib-8", "Sweet spot 3 × 12 min", 2, 75, 4, 3, 0, ["Bike"], false, workoutInput("lib-8", "Sweet spot 3 × 12 min", "bike", [time("warmup", 900, { type: "ftpPercent", preset: "aerobicEndurance" }), { repeat: 3, steps: [time("training", 720, { type: "ftpPercent", preset: "threshold" }, "Sweet spot"), time("rest", 300, { type: "ftpPercent", preset: "recovery" })] }, time("cooldown", 600, { type: "ftpPercent", preset: "recovery" })])],
  ["lib-9", "Pool 10 × 100 m", 3, 40, 4, 10, 0, ["Swim"], false, workoutInput("lib-9", "Pool 10 × 100 m", "swim", [dist("warmup", 300, { type: "none" }), { repeat: 10, steps: [dist("training", 100, { type: "none" }, "Freestyle"), time("rest", 20, { type: "none" })] }, dist("cooldown", 200, { type: "none" })])]
].map(([id, name, sportType, minutes, exerciseCount, setCount, _k, tags, favorite, input]) => ({
  w: {
    id: id as string,
    name: name as string,
    sportType: sportType as number,
    durationSeconds: (minutes as number) * 60,
    exerciseCount: exerciseCount as number,
    setCount: setCount as number,
    favorite: favorite as boolean,
    tags: tags as string[],
    source: "coros" as const,
    syncState: "synced" as const,
    createTimestamp: Math.floor(Date.now() / 1000) - 86400 * 60
  },
  input: input as PlanWorkoutEntryInput
}));

function matches(plan: TrainingPlanDocument): TrainingActivityMatch[] {
  const today = dayKey(new Date());
  const runs = allActivities().filter((a) => a.sportType === 100 || a.sportType === 102);
  return plan.entries
    .filter((e) => e.happenDay && e.happenDay < today)
    .map((e) => {
      const run = runs.find((a) => dayKey(new Date((a.startTime ?? 0) * 1000)) === e.happenDay);
      return {
        id: `m-${e.idInPlan}`,
        planId: plan.id,
        planEntryId: e.id,
        schedulePlanId: RUNNING_PLAN_ID,
        scheduleIdInPlan: e.idInPlan!,
        ...(run ? { activityId: run.activityId } : {}),
        happenDay: e.happenDay!,
        status: run ? "completed" : "missed",
        confidence: 0.9,
        manual: false,
        plannedDurationSeconds: e.plannedDurationSeconds,
        completedDurationSeconds: run?.duration,
        plannedDistanceMeters: e.plannedDistanceMeters,
        completedDistanceMeters: run?.distance,
        plannedTrainingLoad: e.plannedTrainingLoad,
        completedTrainingLoad: run?.trainingLoad,
        updatedAt: new Date().toISOString()
      } satisfies TrainingActivityMatch;
    });
}

let snapshotCache: TrainingLibrarySnapshot | null = null;

export function librarySnapshot(): TrainingLibrarySnapshot {
  if (snapshotCache) return snapshotCache;
  const marathon = marathonPlan();
  const tenK = simplePlan(
    "plan-10k", "Sub-45 10K · 8 weeks",
    "Eight weeks of VO₂max and threshold work for a 10K under 45 minutes, three runs a week plus one easy.",
    8, "run",
    [
      { day: 1, name: "Intervals", km: 10, minutes: 55, load: 150, steps: [dist("warmup", 2000, easyHr), { repeat: 5, steps: [dist("training", 1000, intervalPace), dist("rest", 400, recoveryHr)] }, dist("cooldown", 1500, recoveryHr)] },
      { day: 3, name: "Easy run", km: 8, minutes: 48, load: 75, steps: [dist("training", 8000, easyHr)] },
      { day: 4, name: "Threshold", km: 10, minutes: 52, load: 140, steps: [dist("warmup", 2000, easyHr), dist("training", 6000, tempoPace), dist("cooldown", 2000, recoveryHr)] },
      { day: 6, name: "Long run", km: 15, minutes: 88, load: 150, steps: [dist("training", 15000, easyHr)] }
    ],
    [2, 2, 3, 3, 3, 4, 4, 5]
  );
  const base = simplePlan(
    "plan-base", "Aerobic base · 6 weeks",
    "Easy volume with strides and one steady run, to build the aerobic engine before a block.",
    6, "run",
    [
      { day: 1, name: "Easy + strides", km: 8, minutes: 50, load: 80, steps: [dist("training", 7000, easyHr), { repeat: 6, steps: [time("training", 20, intervalPace, "Stride"), time("rest", 60, recoveryHr)] }] },
      { day: 3, name: "Steady run", km: 10, minutes: 56, load: 105, steps: [dist("training", 10000, mpPace)] },
      { day: 6, name: "Long run", km: 16, minutes: 95, load: 140, steps: [dist("training", 16000, easyHr)] }
    ],
    [1, 2, 2, 2, 2, 6],
    { origin: "coach" }
  );
  const strength = simplePlan(
    "plan-strength", "Strength for runners · 4 weeks",
    "Two gym sessions a week: single-leg strength, posterior chain and core, to keep the legs durable through a marathon block.",
    4, "strength",
    [
      { day: 0, name: "Lower body", minutes: 50, load: 55, steps: [time("training", 3000, { type: "none" }, "Circuit")] },
      { day: 3, name: "Core & mobility", minutes: 35, load: 35, steps: [time("training", 2100, { type: "none" }, "Circuit")] }
    ],
    [2, 3, 3, 6]
  );
  const ride = simplePlan(
    "plan-ftp", "FTP builder · 6 weeks",
    "Sweet-spot and threshold intervals twice a week, with a long Saturday ride.",
    6, "bike",
    [
      { day: 1, name: "Sweet spot 3 × 12 min", minutes: 75, load: 110, steps: [time("training", 4500, { type: "ftpPercent", preset: "threshold" })] },
      { day: 3, name: "Threshold 2 × 20 min", minutes: 80, load: 130, steps: [time("training", 4800, { type: "ftpPercent", preset: "threshold" })] },
      { day: 5, name: "Long ride", km: 80, minutes: 180, load: 200, steps: [time("training", 10800, { type: "ftpPercent", preset: "aerobicEndurance" })] }
    ],
    [2, 3, 3, 4, 4, 6]
  );
  snapshotCache = {
    workouts: LIBRARY_WORKOUTS.map((x) => x.w),
    plans: [marathon, tenK, base, strength, ride],
    drafts: [],
    matches: matches(marathon),
    cachedAt: new Date().toISOString(),
    stale: false,
    offline: false,
    partialFailures: []
  };
  return snapshotCache;
}

export const EDITOR_CONTEXT: WorkoutEditorContext = {
  distanceUnit: "metric",
  paceUnit: "km",
  heartRateBasis: "reserve",
  lthrBpm: 171,
  maxHr: 188,
  restingHr: 50,
  thresholdPaceSecondsPerKm: 262,
  ftp: 245,
  zones: {},
  lthrZones: [],
  defaultPoolLength: { value: 25, unit: "m" },
  climbSystems: {}
};

export function workoutForEdit(ref: { kind: string; programId?: string }): WorkoutEditorDocument {
  const found = LIBRARY_WORKOUTS.find((x) => x.w.id === ref.programId) ?? LIBRARY_WORKOUTS[0]!;
  return {
    ref: { kind: "library", programId: found.w.id },
    revision: "1",
    draft: planWorkoutInputToEditorDraft(found.input),
    context: EDITOR_CONTEXT,
    canEdit: true
  };
}

export function planById(remoteId: string): TrainingPlanDocument | undefined {
  return librarySnapshot().plans.find((p) => p.remoteId === remoteId || p.id === remoteId);
}
