import crypto from "node:crypto";
import {
  deleteCorosPlanCache,
  deleteTrainingPlanDraft,
  deleteTrainingPlanMetadata,
  findCachedRunningCorosPlan,
  getCorosPlanCache,
  getTrainingPlanDraft,
  getTrainingPlanMetadata,
  listCachedTrainingLibraryWorkouts,
  listCorosPlanCache,
  listTrainingActivityMatches,
  listTrainingPlanDrafts,
  listTrainingPlanMetadata,
  listTrainingWorkoutMetadata,
  replaceCorosPlanCache,
  saveCorosPlanCache,
  saveTrainingActivityMatch,
  saveTrainingPlanDraft,
  saveTrainingPlanMetadata,
  saveTrainingWorkoutMetadata
} from "./database";
import {
  copyNativeCorosPlan,
  createNativeCorosPlan,
  deleteNativeCorosPlan,
  executeNativeCorosPlan,
  isDeletedNativePlan,
  listNativeCorosPlans,
  nativePlanWriteInputFromRaw,
  parseNativeCorosProgram,
  quitNativeCorosPlan,
  readNativeCorosPlan,
  readNativeCorosPlanRaw,
  updateNativeCorosPlan,
  type NativePlanWriteInput
} from "./corosTrainingPlanAdapter";
import { corosText, loadCorosLocale } from "./corosLocale";
import { corosProgramToWorkoutDraft } from "./corosWorkoutEditor";
import { editorDraftToPlanWorkoutInput } from "./planWorkoutEditor";
import {
  buildCalculatedPlanProgram,
  deleteWorkoutProgram,
  getWorkoutEditorContext,
  getWorkoutProgramDetail,
  listLibraryWorkouts,
  listScheduledWorkoutEntries,
  listTrainingHubActivities
} from "./trainingHubService";
import {
  formatPlanDay,
  mondayOf,
  parsePlanDay,
  validateTrainingPlan,
  weekStageOf,
  workoutSportFromType
} from "./trainingPlanDomain";
import type {
  LibraryPlanSession,
  NativeCorosPlanDetail,
  NativeCorosPlanProgram,
  PlanWorkoutEntryInput,
  RunWorkoutEditorStep,
  TrainingActivityMatch,
  TrainingHubActivity,
  TrainingHubLibraryWorkout,
  TrainingHubScheduledWorkoutEntry,
  TrainingLibraryDeleteRequest,
  TrainingLibrarySnapshot,
  TrainingLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanDraftRecord,
  TrainingPlanEntry,
  TrainingPlanMetadata,
  TrainingPlanCalendarPreview,
  TrainingPlanMetadataPatch,
  TrainingPlanSaveRequest,
  TrainingPlanSaveResult,
  TrainingPlanWeekStage,
  UnitSystem,
  TrainingWorkoutMetadata,
  WorkoutEditorContext,
  WorkoutMetadataPatch,
  WorkoutSport
} from "./types";

function dateKey(date: Date): string {
  return formatPlanDay(date, false);
}

function relativeDateKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return dateKey(date);
}

type NativePlanEntity = NativeCorosPlanDetail["entities"][number];

/**
 * One entity per session. The list endpoint can repeat an entity, and a
 * deleted one (`status 3`) is not a session; what is left is keyed by the
 * session's `idInPlan`, which is also what an update names it by — so two
 * entities claiming one `idInPlan` are one session, the first as COROS sent it.
 */
function sessionEntities(plan: NativeCorosPlanDetail): NativePlanEntity[] {
  const seen = new Set<string>();
  return plan.entities.filter((entity) => {
    if (entity.status === 3 || seen.has(entity.idInPlan)) return false;
    seen.add(entity.idInPlan);
    return true;
  });
}

/**
 * A program's steps, as a plan session carries them.
 *
 * COROS sends each program's `exercises` with the plan — the list endpoint
 * included, measured on an official 12-week plan: 87 programs, every one with
 * its steps — and this conversion used to drop them, keeping the name and four
 * totals. So every COROS plan read as sessions with nothing inside, and a
 * save of one wrote back sessions with no steps.
 *
 * The conversion is the editor's own, program → draft → plan input, so a
 * session reads here exactly as the same program reads in the workout editor.
 * A step's name is resolved through COROS's string table; `exercise_name`
 * keeps the key, because that is what the strength catalogue looks up.
 * A program that does not convert keeps its name and totals, as before.
 */
function nativeProgramSteps(
  program: NativeCorosPlanProgram | undefined,
  base: PlanWorkoutEntryInput
): Pick<PlanWorkoutEntryInput, "steps" | "sport_options"> {
  if (!program?.exercises?.length) return {};
  try {
    const draft = corosProgramToWorkoutDraft({
      sportType: program.sportType,
      name: program.name,
      overview: program.overview ?? "",
      exercises: program.exercises
    });
    const nameStep = (step: RunWorkoutEditorStep) => {
      const exercise = step.exerciseName ? corosText(step.exerciseName) : undefined;
      step.name =
        exercise && exercise !== step.exerciseName ? exercise : corosText(step.name);
    };
    for (const node of draft.nodes) {
      if (node.nodeType === "repeat") {
        node.name = corosText(node.name);
        node.steps.forEach(nameStep);
      } else {
        nameStep(node);
      }
    }
    const input = editorDraftToPlanWorkoutInput(draft, base);
    return input.steps?.length
      ? { steps: input.steps, ...(input.sport_options ? { sport_options: input.sport_options } : {}) }
      : {};
  } catch {
    return {};
  }
}

const STAGES: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6]);

function calendarStateOf(plan: NativeCorosPlanDetail): TrainingPlanDocument["calendar"] {
  if (plan.executeStatus === 1) return "running";
  if (plan.executeStatus === 2) return endedEarly(plan) ? "stopped" : "finished";
  return "unscheduled";
}

/**
 * Whether a run over (`executeStatus 2`) ended before its last session day.
 * COROS writes one status for a run that ran out and one taken off the
 * calendar, and only `endDay` tells them apart: it is set past the last
 * session when the plan goes on, and moved to the day of removal when it comes
 * off. Measured 2026-09-25: a 17-day plan from Monday 4 January 2027 went on
 * with `endDay` 20270127 and came off with 20260925.
 */
function endedEarly(plan: NativeCorosPlanDetail): boolean {
  const start = parsePlanDay(plan.startDay);
  const end = parsePlanDay(plan.endDay);
  if (!start || !end || !plan.totalDay) return false;
  const lastDay = mondayOf(start);
  lastDay.setDate(lastDay.getDate() + plan.totalDay - 1);
  return end < lastDay;
}

/**
 * A COROS plan as the library draws and edits it.
 *
 * `dayNo` is COROS's own count of days from the plan's first Monday, so it is
 * the session's place in the plan for a plan and an instance alike. An
 * instance also carries `startDay`; its week 1 is the Monday of that day's
 * week, because that is where COROS dates its sessions from (a later start
 * only drops the sessions before it).
 *
 * The raw program of each session travels as `corosProgram`, so a save that
 * does not touch a session writes back exactly what COROS sent.
 */
export function nativePlanToDocument(
  plan: NativeCorosPlanDetail,
  metadata?: TrainingPlanMetadata
): TrainingPlanDocument {
  const rawPrograms = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(plan.rawPayload.programs) ? plan.rawPayload.programs : []) {
    if (raw && typeof raw === "object") {
      const idInPlan = (raw as Record<string, unknown>).idInPlan;
      if (idInPlan !== undefined && idInPlan !== null) rawPrograms.set(String(idInPlan), raw as Record<string, unknown>);
    }
  }
  const programByPlanId = new Map<string, NativeCorosPlanProgram>();
  for (const program of plan.programs) {
    for (const id of [program.idInPlan, program.planProgramId]) {
      if (id) programByPlanId.set(id, program);
    }
  }
  const calendar = calendarStateOf(plan);
  const start = calendar === "unscheduled" ? undefined : parsePlanDay(plan.startDay);
  const anchor = start ? mondayOf(start) : undefined;
  const entries = sessionEntities(plan).map((entity, index): TrainingPlanEntry => {
    const program = programByPlanId.get(entity.idInPlan) ??
      (entity.planProgramId ? programByPlanId.get(entity.planProgramId) : undefined);
    const happen = anchor ? parsePlanDay(entity.happenDay) : undefined;
    const dayNo = entity.dayNo ??
      (anchor && happen ? Math.max(0, Math.round((happen.valueOf() - anchor.valueOf()) / 86_400_000)) : index);
    const sport = workoutSportFromType(program?.sportType);
    /* An official plan names its sessions by key — `P10281` for
       "30 min z2 ride" — and describes them the same way. */
    const name = corosText(program?.name ?? "Workout");
    const base: PlanWorkoutEntryInput = {
      key: `coros:${plan.remoteId}:${entity.idInPlan}`,
      name,
      description: corosText(program?.overview),
      sport,
      save_to_library: false
    };
    return {
      id: `coros:${plan.remoteId}:${entity.idInPlan}`,
      weekIndex: Math.floor(dayNo / 7),
      dayIndex: dayNo % 7,
      sortOrder: entity.sortNoInSchedule ?? entity.sortNo ?? index,
      title: name,
      workout: { ...base, ...nativeProgramSteps(program, base) },
      corosProgram: rawPrograms.get(entity.idInPlan),
      idInPlan: entity.idInPlan,
      ...(anchor && entity.happenDay && /^\d{8}$/.test(entity.happenDay) ? { happenDay: entity.happenDay } : {}),
      plannedDurationSeconds: program?.planDuration || undefined,
      /*
       * Centimetres on the wire (`previewFromProgram` divides the same field
       * by 100). Read as metres, a 3.5 km run planned 356 km, and a sprint
       * triathlon plan came to 13,896 km.
       */
      plannedDistanceMeters: program?.planDistance ? program.planDistance / 100 : undefined,
      plannedTrainingLoad: program?.planTrainingLoad || undefined,
      /* `totalSets` counts steps on anything but a strength session, so a
         30-minute ride "planned 3 sets". */
      plannedStrengthSets:
        sport === "strength" || sport === "hyrox" ? program?.planSets || undefined : undefined
    };
  });
  const lastWeek = Math.max(0, ...entries.map((entry) => entry.weekIndex + 1));
  return {
    id: `coros:${plan.remoteId}`,
    remoteId: plan.remoteId,
    remoteVersion: plan.version,
    name: corosText(plan.name),
    description: corosText(plan.overview),
    weekCount: Math.max(1, Math.ceil(plan.totalDay / 7), lastWeek),
    /* Only a stage COROS set. Every week arrives as a stage, and an unset one
       is `stage: 0`. */
    weekStages: plan.weekStages.flatMap((stage) =>
      typeof stage.stage === "number" && STAGES.has(stage.stage)
        ? [{ weekIndex: stage.weekNo - 1, stage: stage.stage as TrainingPlanWeekStage }]
        : []
    ),
    entries,
    sportMix: [
      ...new Set(
        plan.sportTypes
          .map(workoutSportFromType)
          .filter((sport): sport is WorkoutSport => Boolean(sport))
      )
    ],
    calendar,
    ...(anchor ? { startDate: formatPlanDay(anchor, true) } : {}),
    ...(calendar !== "unscheduled" && plan.sourcePlanId ? { sourcePlanId: plan.sourcePlanId } : {}),
    tags: metadata?.tags ?? [],
    favorite: metadata?.favorite ?? false,
    archived: metadata?.archived ?? false,
    ...(metadata?.origin ? { origin: metadata.origin } : {}),
    ...(metadata?.coach ? { coach: metadata.coach } : {}),
    updatedAt: plan.updateTimestamp ? new Date(plan.updateTimestamp * 1000).toISOString() : plan.lastSyncedAt ?? new Date().toISOString()
  };
}

/** The app's own facts laid over a plan read from COROS or the cache. */
function withMetadata(
  plan: TrainingPlanDocument,
  metadata: TrainingPlanMetadata | undefined
): TrainingPlanDocument {
  const { origin: _origin, coach: _coach, ...rest } = plan;
  return {
    ...rest,
    tags: metadata?.tags ?? [],
    favorite: metadata?.favorite ?? false,
    archived: metadata?.archived ?? false,
    ...(metadata?.origin ? { origin: metadata.origin } : {}),
    ...(metadata?.coach ? { coach: metadata.coach } : {})
  };
}

/**
 * A plan that is running on the calendar is linked from the plan it was made
 * from, so the template can say so and take it off again. Only a running
 * instance counts: a finished one is history.
 */
function linkRunningInstances(plans: TrainingPlanDocument[]): TrainingPlanDocument[] {
  const running = new Map<string, string>();
  for (const plan of plans) {
    if (plan.calendar === "running" && plan.sourcePlanId && plan.remoteId) {
      running.set(plan.sourcePlanId, plan.remoteId);
    }
  }
  return plans.map((plan) => {
    const { runningInstanceId: _stale, ...rest } = plan;
    const instanceId = plan.remoteId ? running.get(plan.remoteId) : undefined;
    return plan.calendar === "unscheduled" && instanceId ? { ...rest, runningInstanceId: instanceId } : rest;
  });
}

/** Whether a document carries the sessions' programs, i.e. came from a full read. */
function isDeep(plan: TrainingPlanDocument): boolean {
  return plan.entries.length > 0 && plan.entries.every((entry) => entry.corosProgram);
}

/** Whether `plan` is an earlier version of the plan `than` holds. COROS raises `version` by one per update. */
function isOlder(plan: TrainingPlanDocument, than: TrainingPlanDocument | undefined): boolean {
  return Boolean(than) && (plan.remoteVersion ?? -1) < (than!.remoteVersion ?? -1);
}

function metadataByProgram(): Map<string, TrainingWorkoutMetadata> {
  return new Map(
    listTrainingWorkoutMetadata().map((metadata) => [metadata.programId, metadata])
  );
}

function mergeWorkout(
  workout: TrainingHubLibraryWorkout,
  metadata: TrainingWorkoutMetadata | undefined
): TrainingLibraryWorkout {
  return {
    ...workout,
    /* A workout saved from COROS's official catalogue is named by key too. */
    name: corosText(workout.name),
    favorite: metadata?.favorite ?? false,
    tags: metadata?.tags ?? [],
    source: metadata?.source ?? "coros",
    syncState: metadata?.syncState ?? "synced",
    lastSyncedAt: metadata?.lastSyncedAt
  };
}

export async function getTrainingLibrarySnapshot(): Promise<TrainingLibrarySnapshot> {
  const cachedAt = new Date().toISOString();
  const partialFailures: string[] = [];
  /*
   * Activities ride along because a running plan's kept-or-missed figure is
   * read from the plan-versus-done matches, and those have to be fresh
   * whenever the library loads — the schedule half is already being fetched
   * here, so folding the rest in costs one parallel request.
   */
  /* In parallel with the list, and already settled on every load after the
     first: the words for an official plan's keys, read before it is converted. */
  const localeReady = loadCorosLocale();
  const [workoutsResult, nativeResult, scheduleResult, activityResult] =
    await Promise.allSettled([
      listLibraryWorkouts(),
      listNativeCorosPlans(),
      listScheduledWorkoutEntries(relativeDateKey(-180), relativeDateKey(365)),
      listTrainingHubActivities(1, 500, relativeDateKey(-180), relativeDateKey(1))
    ]);
  await localeReady;

  let baseWorkouts: TrainingHubLibraryWorkout[];
  if (workoutsResult.status === "fulfilled") {
    baseWorkouts = workoutsResult.value;
    const previous = metadataByProgram();
    const cached = new Map(
      listCachedTrainingLibraryWorkouts().map((workout) => [workout.id, JSON.stringify(workout)])
    );
    for (const workout of baseWorkouts) {
      const metadata = previous.get(workout.id);
      /* Only a row that is new or whose workout changed is written. The table
         syncs, so a row rewritten on every load — a fresh `lastSyncedAt` and
         nothing else — is a sync entry per workout every time the library
         opens. */
      if (metadata?.syncState === "synced" && cached.get(workout.id) === JSON.stringify(workout)) continue;
      saveTrainingWorkoutMetadata(
        {
          programId: workout.id,
          favorite: metadata?.favorite ?? false,
          tags: metadata?.tags ?? [],
          source: metadata?.source ?? "coros",
          syncState: "synced",
          lastUsedAt: metadata?.lastUsedAt,
          lastSyncedAt: cachedAt,
          cachedVersion: metadata?.cachedVersion
        },
        workout as unknown as Record<string, unknown>
      );
    }
  } else {
    partialFailures.push(`Workouts: ${String(workoutsResult.reason?.message ?? workoutsResult.reason)}`);
    baseWorkouts = listCachedTrainingLibraryWorkouts();
  }

  const metadata = new Map(listTrainingPlanMetadata().map((item) => [item.planId, item]));
  let plans: TrainingPlanDocument[];
  if (nativeResult.status === "fulfilled") {
    /*
     * The list row is shallow — a plan written here arrives with its entities
     * and no programs — so a deep copy already in the cache is kept while
     * COROS still reports the same version: reopening the plan is then
     * instant and has its steps. So is one COROS has already answered a later
     * version of: the list is read at the start of a snapshot, and a plan read
     * in full while it was on its way is newer than the row that arrives.
     */
    const fresh = nativeResult.value.map((native) => {
      const listed = nativePlanToDocument(native, metadata.get(`coros:${native.remoteId}`));
      const cached = getCorosPlanCache(native.remoteId);
      /* A copy COROS has answered a later version of is kept whole. */
      if (cached && isOlder(listed, cached)) return withMetadata(cached, metadata.get(listed.id));
      const keep = cached && isDeep(cached) && !isDeep(listed) && cached.remoteVersion === listed.remoteVersion;
      /* An equal version keeps only the sessions. Where the plan stands on
         the calendar is the list's to say, because taking a run off moves no
         version: `quitSubPlan` leaves it where it was (measured), so a kept
         copy went on reading as running — or, before `stopped`, as done. */
      return keep
        ? withMetadata(
            { ...cached, calendar: listed.calendar, startDate: listed.startDate, sourcePlanId: listed.sourcePlanId },
            metadata.get(listed.id)
          )
        : listed;
    });
    replaceCorosPlanCache(fresh);
    plans = fresh;
  } else {
    partialFailures.push(`Training plans: ${String(nativeResult.reason?.message ?? nativeResult.reason)}`);
    plans = listCorosPlanCache().map((plan) => withMetadata(plan, metadata.get(plan.id)));
  }

  if (scheduleResult.status === "rejected") {
    partialFailures.push(`Schedule: ${String(scheduleResult.reason?.message ?? scheduleResult.reason)}`);
  }
  /*
   * Only when both halves arrived. Rebuilding from a partial schedule would
   * mark every session it could not see as missed, and a match is persisted —
   * so one failed request would write a wrong answer that outlives it.
   */
  if (scheduleResult.status === "fulfilled" && activityResult.status === "fulfilled") {
    for (const match of buildTrainingActivityMatches(
      scheduleResult.value,
      activityResult.value,
      listTrainingActivityMatches()
    )) {
      saveTrainingActivityMatch(match);
    }
  }

  const workoutMetadata = metadataByProgram();
  return {
    workouts: baseWorkouts.map((workout) =>
      mergeWorkout(workout, workoutMetadata.get(workout.id))
    ),
    plans: linkRunningInstances(plans),
    drafts: listTrainingPlanDrafts(),
    matches: listTrainingActivityMatches(),
    cachedAt,
    stale: partialFailures.length > 0,
    offline:
      workoutsResult.status === "rejected" &&
      nativeResult.status === "rejected" &&
      scheduleResult.status === "rejected",
    partialFailures
  };
}

/**
 * The workout library alone, for a picker that needs nothing else — the plan
 * editor opened from Coach. The snapshot would also read every plan, eighteen
 * months of calendar and 500 activities, and rebuild the matches, to fill one
 * list. Offline it answers what the last snapshot cached.
 */
export async function listTrainingLibraryWorkouts(): Promise<TrainingLibraryWorkout[]> {
  let workouts: TrainingHubLibraryWorkout[];
  try {
    [workouts] = await Promise.all([listLibraryWorkouts(), loadCorosLocale()]);
  } catch {
    workouts = listCachedTrainingLibraryWorkouts();
  }
  const metadata = metadataByProgram();
  return workouts.map((workout) => mergeWorkout(workout, metadata.get(workout.id)));
}

/**
 * A plan read in full — `/training/plan/detail`, with every program's steps —
 * and cached, so the next snapshot keeps it deep while its version holds.
 *
 * Two reads of one plan can be in flight at once — the reader opening it, a
 * save reading it back — and the one answered last is not necessarily the
 * newer. COROS raises `version` by one per update, so the cache takes this
 * copy only when it is no older than the one it holds.
 *
 * The document is linked to its running copy the way the snapshot links every
 * plan. Read on its own it has no list to join against, and a template that is
 * on the calendar came back looking as though it were not: the reader lost its
 * mark and its ⋯ offered "Add to calendar" for a plan already there.
 */
export async function getNativeTrainingPlan(remoteId: string): Promise<TrainingPlanDocument> {
  const [native] = await Promise.all([readNativeCorosPlan(remoteId), loadCorosLocale()]);
  const document = nativePlanToDocument(native, getTrainingPlanMetadata(`coros:${remoteId}`));
  if (!isOlder(document, getCorosPlanCache(remoteId))) saveCorosPlanCache(document);
  return withRunningInstance(document);
}

/** `linkRunningInstances` for one plan, against the running copies the last snapshot cached. */
function withRunningInstance(plan: TrainingPlanDocument): TrainingPlanDocument {
  const { runningInstanceId: _stale, ...rest } = plan;
  const instanceId =
    plan.calendar === "unscheduled" && plan.remoteId ? findCachedRunningCorosPlan(plan.remoteId) : undefined;
  return instanceId ? { ...rest, runningInstanceId: instanceId } : rest;
}

/** Favourite, tags and archived: the app's to keep, since COROS has no field for them. */
export function updateTrainingPlanMetadata(
  planId: string,
  patch: TrainingPlanMetadataPatch
): TrainingPlanMetadata {
  if (!planId.startsWith("coros:")) throw new Error("Only a plan saved to COROS has library settings.");
  const previous = getTrainingPlanMetadata(planId);
  const next: TrainingPlanMetadata = {
    planId,
    favorite: patch.favorite ?? previous?.favorite ?? false,
    tags: patch.tags ?? previous?.tags ?? [],
    archived: patch.archived ?? previous?.archived ?? false,
    ...(previous?.origin ? { origin: previous.origin } : {}),
    ...(previous?.coach ? { coach: previous.coach } : {}),
    updatedAt: new Date().toISOString()
  };
  saveTrainingPlanMetadata(next);
  return next;
}

/**
 * Keeps an edit in progress. The draft records which COROS plan it edits and
 * at what version, so a save can tell whether that plan moved underneath it.
 */
export function savePlanDraft(
  input: Omit<TrainingPlanDraftRecord, "savedAt" | "id"> & { id?: string }
): TrainingPlanDraftRecord {
  const record: TrainingPlanDraftRecord = {
    id: input.id ?? `draft:${crypto.randomUUID()}`,
    ...(input.baseRemoteId ? { baseRemoteId: input.baseRemoteId } : {}),
    ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    plan: structuredClone(input.plan),
    savedAt: new Date().toISOString()
  };
  saveTrainingPlanDraft(record);
  return record;
}

/**
 * A library workout as a session to add to a plan.
 *
 * A COROS plan holds a copy of every program in it — it does not point at the
 * library — so the workout is read in full here, once, and the session carries
 * its steps and its program from then on. A session that only named its
 * library workout (as the local plans did) would have nothing to write.
 */
export async function libraryWorkoutAsPlanSession(
  programId: string
): Promise<LibraryPlanSession> {
  const [raw] = await Promise.all([getWorkoutProgramDetail(programId), loadCorosLocale()]);
  if (!raw) throw new Error("COROS did not return that workout.");
  const program = parseNativeCorosProgram(raw);
  const sport = workoutSportFromType(program.sportType);
  const name = corosText(program.name);
  const base: PlanWorkoutEntryInput = {
    key: `library:${programId}:${crypto.randomUUID()}`,
    name,
    description: corosText(program.overview),
    sport,
    save_to_library: false
  };
  const { happenDay: _happenDay, idInPlan: _idInPlan, ...corosProgram } = raw;
  return {
    title: name,
    workout: { ...base, ...nativeProgramSteps(program, base) },
    corosProgram,
    plannedDurationSeconds: program.planDuration || undefined,
    plannedDistanceMeters: program.planDistance ? program.planDistance / 100 : undefined,
    plannedTrainingLoad: program.planTrainingLoad || undefined,
    plannedStrengthSets:
      sport === "strength" || sport === "hyrox" ? program.planSets || undefined : undefined
  };
}

function remoteIdOf(planId: string): string {
  if (!planId.startsWith("coros:")) throw new Error("That plan is not on COROS.");
  return planId.slice("coros:".length);
}

/**
 * The plan as COROS's write takes it.
 *
 * A session nobody edited carries the program COROS sent (`corosProgram`) and
 * goes back exactly as it came. One that was edited — or written here — has
 * only its `workout`, and is built and calculated the way a calendar write
 * builds it, one at a time: they go to the account COROS keeps a single live
 * token for, and a plan is saved once. A session that has an id in the plan
 * but neither — a shallow copy the list served — keeps the program COROS
 * holds for it.
 *
 * Every week's stage is sent, Not Set included, or clearing a stage in the
 * editor would leave COROS's in place.
 */
async function planWriteInput(
  plan: TrainingPlanDocument,
  unitSystem: UnitSystem,
  current: Record<string, unknown> | undefined
): Promise<NativePlanWriteInput> {
  const held = new Map<string, Record<string, unknown>>();
  for (const program of Array.isArray(current?.programs) ? current.programs : []) {
    if (program && typeof program === "object") {
      const record = program as Record<string, unknown>;
      held.set(String(record.idInPlan), record);
    }
  }
  const ordered = [...plan.entries].sort(
    (left, right) =>
      left.weekIndex - right.weekIndex || left.dayIndex - right.dayIndex || left.sortOrder - right.sortOrder
  );
  const sessions: NativePlanWriteInput["sessions"] = [];
  /* Read once, on the first session that has to be built. */
  let context: WorkoutEditorContext | undefined;
  for (const entry of ordered) {
    const kept = current && entry.idInPlan && held.has(entry.idInPlan) ? entry.idInPlan : undefined;
    const program =
      entry.corosProgram ??
      (kept && !entry.workout.steps?.length ? held.get(kept) : undefined) ??
      (await buildCalculatedPlanProgram(
        entry.workout,
        unitSystem,
        (context ??= await getWorkoutEditorContext(unitSystem))
      ));
    sessions.push({ idInPlan: kept, dayNo: entry.weekIndex * 7 + entry.dayIndex, program });
  }
  return {
    name: plan.name,
    overview: plan.description,
    sessions,
    weekStages: Array.from({ length: plan.weekCount }, (_, weekIndex) => ({
      weekNo: weekIndex + 1,
      stage: weekStageOf(plan, weekIndex)
    }))
  };
}

/**
 * Writes a plan to COROS and reads it back.
 *
 * An edit of a COROS plan is an update over a fresh read, refused as a
 * conflict when that plan moved on COROS since the edit began — unless the
 * athlete chose to overwrite. A plan COROS has since deleted (it still answers
 * `detail`, soft-deleted) is written as a new one, as is anything with no
 * `remoteId` or saved `asNew`.
 *
 * **Written, read back, and only then is the draft let go.** A plan that reads
 * back with a different number of sessions than was sent is an error, and the
 * draft that holds the edit survives it.
 */
export async function savePlanToCoros(request: TrainingPlanSaveRequest): Promise<TrainingPlanSaveResult> {
  const { plan } = request;
  const errors = validateTrainingPlan(plan).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join(" "));

  let remoteId = request.asNew ? undefined : plan.remoteId;
  let current = remoteId ? await readNativeCorosPlanRaw(remoteId) : undefined;
  if (current && isDeletedNativePlan(current)) {
    remoteId = undefined;
    current = undefined;
  }
  if (current && request.expectedVersion !== undefined && !request.overwrite) {
    const currentVersion = Number(current.version);
    if (currentVersion !== request.expectedVersion) {
      return {
        ok: false,
        conflict: {
          currentVersion: Number.isFinite(currentVersion) ? currentVersion : undefined,
          expectedVersion: request.expectedVersion
        }
      };
    }
  }

  const input = await planWriteInput(plan, request.unitSystem, current);
  if (remoteId && current) {
    await updateNativeCorosPlan(remoteId, input, { current });
  } else {
    remoteId = await createNativeCorosPlan(input);
    const origin = request.origin ?? plan.origin;
    const coach = request.coach ?? plan.coach;
    if (origin || coach || plan.favorite || plan.tags.length || plan.archived) {
      saveTrainingPlanMetadata({
        planId: `coros:${remoteId}`,
        favorite: plan.favorite,
        tags: plan.tags,
        archived: plan.archived,
        ...(origin ? { origin } : {}),
        ...(coach ? { coach } : {}),
        updatedAt: new Date().toISOString()
      });
    }
  }

  const saved = await getNativeTrainingPlan(remoteId);
  if (saved.entries.length !== plan.entries.length) {
    throw new Error(
      `COROS saved "${saved.name}", but it reads back with ${saved.entries.length} of ${plan.entries.length} sessions. ` +
        "Your edit is kept; open the plan to check it and save again."
    );
  }
  if (request.draftId) deleteTrainingPlanDraft(request.draftId);
  return { ok: true, plan: saved };
}

/**
 * A COROS copy of a plan, named "… Copy". COROS's own copy keeps the name,
 * so the copy is renamed straight after — through its raw detail, so nothing
 * about its sessions is rebuilt. A copy of a plan on the calendar is not on
 * the calendar. Where the original came from travels with it.
 */
export async function duplicatePlanOnCoros(planId: string): Promise<TrainingPlanDocument> {
  const remoteId = remoteIdOf(planId);
  const copy = await copyNativeCorosPlan(remoteId);
  const name = `${corosText(copy.name) ?? copy.name} Copy`;
  await updateNativeCorosPlan(copy.remoteId, nativePlanWriteInputFromRaw(copy.rawPayload, { name, overview: corosText(copy.overview) ?? "" }), {
    current: copy.rawPayload
  });
  const source = getTrainingPlanMetadata(planId);
  if (source?.origin || source?.coach) {
    saveTrainingPlanMetadata({
      planId: `coros:${copy.remoteId}`,
      favorite: false,
      tags: [],
      archived: false,
      ...(source.origin ? { origin: source.origin } : {}),
      ...(source.coach ? { coach: source.coach } : {}),
      updatedAt: new Date().toISOString()
    });
  }
  return getNativeTrainingPlan(copy.remoteId);
}

/**
 * Deletes a plan on COROS, with the app's own record of it.
 *
 * A plan on the calendar — a running copy, or the plan one runs from — is
 * taken off it first, and only when the caller says so: what deleting either
 * while it runs would do to the calendar has not been established, so it is
 * never tried. The running copy is `quitSubPlan`ped, which leaves it as a run
 * taken off (not listed, and one COROS will not put back), and is deleted
 * with the plan rather than left behind it. A failed removal deletes nothing.
 */
export async function deletePlanFromCoros(
  planId: string,
  confirmed: boolean,
  options: { takeOffCalendar?: boolean } = {}
): Promise<void> {
  if (!confirmed) throw new Error("Deleting a training plan requires confirmation.");
  const remoteId = remoteIdOf(planId);
  const plans = await listNativeCorosPlans();
  const target = plans.find((plan) => plan.remoteId === remoteId);
  if (target) {
    const running =
      target.executeStatus === 1
        ? target
        : plans.find((plan) => plan.executeStatus === 1 && plan.sourcePlanId === remoteId);
    if (running && !options.takeOffCalendar) {
      throw new Error("This plan is on the calendar. Take it off the calendar to delete it.");
    }
    if (running) await quitNativeCorosPlan(running.remoteId);
    await deleteNativeCorosPlan(remoteId);
    if (running && running.remoteId !== remoteId) {
      await deleteNativeCorosPlan(running.remoteId);
      deleteCorosPlanCache(running.remoteId);
    }
  }
  deleteCorosPlanCache(remoteId);
  deleteTrainingPlanMetadata(planId);
}

/**
 * What putting a plan on the calendar from `startDay` (yyyyMMdd) would do.
 *
 * COROS counts a plan's days from the Monday of the week holding the start
 * day and leaves off every session before it — so a Wednesday start loses the
 * Monday and Tuesday of week 1, and a Sunday start the whole week. Nothing on
 * COROS checks the calendar either: a day that already holds a workout gets
 * the plan's as well. Both are said here, before anything is written.
 *
 * `planId` may also name a library draft (`draft:<uuid>`, the record's id),
 * read from this machine: a generated plan is asked for its day before it is
 * saved, so the day is picked first and the save and the calendar follow as
 * one answer. Nothing about a draft's own calendar can block it.
 */
export async function previewPlanOnCalendar(
  planId: string,
  startDay: string
): Promise<TrainingPlanCalendarPreview> {
  if (!/^\d{8}$/.test(startDay)) throw new Error("Choose a start day.");
  const plan = planId.startsWith("draft:")
    ? draftPlan(planId)
    : planId.startsWith("chat:")
      ? chatPlan(planId)
      : await getNativeTrainingPlan(remoteIdOf(planId));
  const start = parsePlanDay(startDay)!;
  const anchor = mondayOf(start);
  const lastDay = new Date(anchor);
  lastDay.setDate(lastDay.getDate() + Math.max(1, plan.weekCount) * 7 - 1);
  const scheduled = await listScheduledWorkoutEntries(dateKey(anchor), dateKey(lastDay));

  const entries = [...plan.entries]
    .sort((left, right) => left.weekIndex - right.weekIndex || left.dayIndex - right.dayIndex || left.sortOrder - right.sortOrder)
    .map((entry) => {
      const day = new Date(anchor);
      day.setDate(day.getDate() + entry.weekIndex * 7 + entry.dayIndex);
      const happenDay = dateKey(day);
      return {
        entryId: entry.id,
        name: entry.title,
        sport: entry.workout.sport,
        happenDay,
        dropped: happenDay < startDay,
        existing: scheduled.filter((item) => item.happenDay === happenDay).map((item) => item.name)
      };
    });

  const blockers: string[] = [];
  if (startDay < dateKey(new Date())) blockers.push("A plan cannot start in the past.");
  if (plan.calendar === "stopped") {
    blockers.push("This run was taken off the calendar, and COROS will not put it back. Duplicate it to use it again.");
  } else if (plan.calendar !== "unscheduled") {
    blockers.push("This is a run of a plan on the calendar. Add the plan itself, or a copy of it.");
  }
  /* From the cache the last snapshot wrote — the list is the heaviest thing
     COROS serves, and this is read on every day picked. The write itself
     asks COROS afresh (`executeNativeCorosPlan`). */
  if (plan.runningInstanceId) {
    blockers.push("This plan is already on the calendar. Take it off before adding it again.");
  }
  if (!entries.length) blockers.push("This plan has no sessions to put on the calendar.");
  else if (entries.every((entry) => entry.dropped)) {
    blockers.push("Starting on that day leaves none of the plan's sessions on the calendar.");
  }
  return { planId, startDay, anchorDay: dateKey(anchor), entries, blockers };
}

function draftPlan(draftId: string): TrainingPlanDocument {
  const draft = getTrainingPlanDraft(draftId);
  if (!draft) throw new Error("That draft is no longer in your library.");
  return draft.plan;
}

/**
 * How a Coach creation, `chat:<draftId>`, is read for a calendar preview
 * before it is saved (P1.6). Registered by the chat's tools rather than
 * imported, since those import this module to save.
 */
let chatPlanReader: ((draftId: string) => TrainingPlanDocument) | undefined;
export function setChatPlanReader(reader: (draftId: string) => TrainingPlanDocument): void {
  chatPlanReader = reader;
}

function chatPlan(planId: string): TrainingPlanDocument {
  if (!chatPlanReader) throw new Error("That Coach plan is not available here.");
  return chatPlanReader(planId.slice("chat:".length));
}

/** `executeSubPlan`: the plan goes on the calendar as COROS's running copy of it, answered read in full. */
export async function putPlanOnCalendar(planId: string, startDay: string): Promise<TrainingPlanDocument> {
  const preview = await previewPlanOnCalendar(planId, startDay);
  if (preview.blockers.length) throw new Error(preview.blockers.join(" "));
  const instance = await executeNativeCorosPlan(remoteIdOf(planId), startDay);
  return getNativeTrainingPlan(instance.remoteId);
}

/**
 * `quitSubPlan`: every session of the running copy comes off the calendar,
 * and nothing else — a workout added by hand on the same day stays. Asked of
 * the plan or of its running copy, it takes off the copy.
 */
export async function takePlanOffCalendar(planId: string): Promise<void> {
  const remoteId = remoteIdOf(planId);
  const plans = await listNativeCorosPlans();
  const running =
    plans.find((plan) => plan.remoteId === remoteId && plan.executeStatus === 1) ??
    plans.find((plan) => plan.executeStatus === 1 && plan.sourcePlanId === remoteId);
  if (!running) throw new Error("This plan is not on the calendar.");
  await quitNativeCorosPlan(running.remoteId);
}

/**
 * The plan's sessions carried onto its running copy, as a write to the copy.
 *
 * Not `plan/sync`, which COROS offers for this and which does not do it:
 * measured on 2026-09-25, a session moved in the plan and then synced stayed
 * on its old day, both on the calendar and in the copy. Editing a running
 * copy through `plan/update` moves its calendar sessions with it — verified
 * the same day, a move landing on its new day and leaving nothing behind — so
 * the copy is rewritten to read as the plan does.
 *
 * Only what is still ahead follows. A session on a day already gone keeps
 * whatever the copy holds, so history is not rewritten by an edit; one before
 * the run's start day is left off, as COROS leaves it off when the plan goes
 * on. A session the copy has under the same `idInPlan` is moved or edited in
 * place; one it does not is added, and one only the copy has is removed.
 */
export function planOntoRunningCopy(
  templateRaw: Record<string, unknown>,
  copyRaw: Record<string, unknown>,
  today: string
): NativePlanWriteInput {
  const plan = nativePlanWriteInputFromRaw(templateRaw);
  const copy = nativePlanWriteInputFromRaw(copyRaw);
  const start = parsePlanDay(String(copyRaw.startDay ?? ""));
  if (!start) throw new Error("The calendar copy of this plan has no start day.");
  const anchor = mondayOf(start);
  const dayOf = (dayNo: number) => {
    const date = new Date(anchor);
    date.setDate(date.getDate() + dayNo);
    return dateKey(date);
  };
  const startKey = dateKey(start);
  const from = today > startKey ? today : startKey;
  const past = copy.sessions.filter((session) => dayOf(session.dayNo) < from);
  const pastIds = new Set(past.map((session) => session.idInPlan));
  const onCopy = new Set(copy.sessions.map((session) => session.idInPlan));
  const ahead = plan.sessions
    .filter((session) => dayOf(session.dayNo) >= from && !pastIds.has(session.idInPlan))
    .map((session) =>
      onCopy.has(session.idInPlan) ? session : { dayNo: session.dayNo, program: session.program }
    );
  return {
    name: plan.name,
    overview: plan.overview,
    sessions: [...past, ...ahead],
    weekStages: plan.weekStages
  };
}

export async function syncPlanToCalendar(planId: string): Promise<TrainingPlanDocument> {
  const remoteId = remoteIdOf(planId);
  const running = (await listNativeCorosPlans()).find(
    (plan) => plan.executeStatus === 1 && plan.sourcePlanId === remoteId
  );
  if (!running) throw new Error("This plan has no copy on the calendar to update.");
  const [templateRaw, copyRaw] = await Promise.all([
    readNativeCorosPlanRaw(remoteId),
    readNativeCorosPlanRaw(running.remoteId)
  ]);
  await updateNativeCorosPlan(
    running.remoteId,
    planOntoRunningCopy(templateRaw, copyRaw, dateKey(new Date())),
    { current: copyRaw }
  );
  return getNativeTrainingPlan(running.remoteId);
}

export function discardPlanDraft(id: string): void {
  deleteTrainingPlanDraft(id);
}

export function updateWorkoutMetadata(
  programIds: string[],
  patch: WorkoutMetadataPatch
): TrainingWorkoutMetadata[] {
  const current = metadataByProgram();
  const updated: TrainingWorkoutMetadata[] = [];
  for (const programId of [...new Set(programIds)]) {
    const previous = current.get(programId);
    const metadata: TrainingWorkoutMetadata = {
      programId,
      favorite: patch.favorite ?? previous?.favorite ?? false,
      tags: patch.tags ?? previous?.tags ?? [],
      source: patch.source ?? previous?.source ?? "coros",
      syncState: previous?.syncState ?? "synced",
      lastUsedAt: patch.lastUsedAt ?? previous?.lastUsedAt,
      lastSyncedAt: previous?.lastSyncedAt,
      cachedVersion: previous?.cachedVersion
    };
    saveTrainingWorkoutMetadata(metadata);
    updated.push(metadata);
  }
  return updated;
}

export async function deleteTrainingLibraryWorkouts(
  request: TrainingLibraryDeleteRequest
): Promise<string[]> {
  const ids = [...new Set(request.programIds.map((id) => id.trim()).filter(Boolean))];
  if (!request.confirmed) throw new Error("Deleting workouts requires confirmation.");
  if (ids.length === 0) throw new Error("Select at least one workout to delete.");
  for (const id of ids) await deleteWorkoutProgram(id);
  return ids;
}

export function activityDay(activity: TrainingHubActivity): string | undefined {
  if (!activity.startTime) return undefined;
  const raw = activity.startTime > 10_000_000_000 ? activity.startTime : activity.startTime * 1000;
  return dateKey(new Date(raw));
}

export function scheduledActivityScore(
  scheduled: TrainingHubScheduledWorkoutEntry,
  activity: TrainingHubActivity
): number {
  let score = 0.35;
  if (scheduled.sportType && scheduled.sportType === activity.sportType) score += 0.35;
  const plannedLoad = scheduled.trainingLoad;
  if (plannedLoad && activity.trainingLoad !== undefined) {
    score += 0.2 * Math.max(0, 1 - Math.abs(activity.trainingLoad - plannedLoad) / plannedLoad);
  }
  const normalizedName = scheduled.name.trim().toLowerCase();
  if (normalizedName && activity.name?.trim().toLowerCase() === normalizedName) score += 0.1;
  return Math.min(1, score);
}

export function buildTrainingActivityMatches(
  scheduled: TrainingHubScheduledWorkoutEntry[],
  activities: TrainingHubActivity[],
  previous: TrainingActivityMatch[],
  today = dateKey(new Date())
): TrainingActivityMatch[] {
  const existing = new Map(
    previous.map((match) => [
      `${match.schedulePlanId}:${match.scheduleIdInPlan}`,
      match
    ])
  );
  const usedActivities = new Set<string>();
  const results: TrainingActivityMatch[] = [];
  for (const entry of scheduled) {
    const key = `${entry.planId}:${entry.idInPlan}`;
    const manual = existing.get(key);
    let activity = manual?.manual
      ? activities.find((candidate) => candidate.activityId === manual.activityId)
      : undefined;
    let confidence = manual?.manual ? manual.confidence : undefined;
    if (!manual?.manual) {
      const candidates = activities
        .filter((candidate) => activityDay(candidate) === entry.happenDay)
        .filter((candidate) => !usedActivities.has(candidate.activityId))
        .map((candidate) => ({ candidate, score: scheduledActivityScore(entry, candidate) }))
        .sort((left, right) => right.score - left.score);
      if (candidates[0]?.score >= 0.5) {
        activity = candidates[0].candidate;
        confidence = candidates[0].score;
      }
    }
    if (activity) usedActivities.add(activity.activityId);
    const ratio = entry.trainingLoad && activity?.trainingLoad !== undefined
      ? activity.trainingLoad / entry.trainingLoad
      : undefined;
    const status: TrainingActivityMatch["status"] = manual?.status === "skipped"
      ? "skipped"
      : activity
        ? ratio !== undefined && ratio < 0.75 ? "partial" : "completed"
        : entry.happenDay < today ? "missed" : "upcoming";
    results.push({
      id: manual?.id ?? crypto.randomUUID(),
      planId: manual?.planId,
      planEntryId: manual?.planEntryId,
      schedulePlanId: entry.planId,
      scheduleIdInPlan: entry.idInPlan,
      activityId: activity?.activityId,
      happenDay: entry.happenDay,
      status,
      confidence,
      manual: manual?.manual ?? false,
      completedDurationSeconds: activity?.duration,
      completedDistanceMeters: activity?.distance,
      plannedTrainingLoad: entry.trainingLoad,
      completedTrainingLoad: activity?.trainingLoad,
      updatedAt: new Date().toISOString()
    });
  }
  return results;
}

export async function refreshTrainingActivityMatches(
  startDay: string,
  endDay: string
): Promise<TrainingActivityMatch[]> {
  const [scheduled, activities] = await Promise.all([
    listScheduledWorkoutEntries(startDay, endDay),
    listTrainingHubActivities(1, 500, startDay, endDay)
  ]);
  const results = buildTrainingActivityMatches(
    scheduled,
    activities,
    listTrainingActivityMatches()
  );
  for (const match of results) {
    saveTrainingActivityMatch(match);
  }
  return results;
}

/**
 * Every stored plan-versus-done match, straight out of SQLite.
 *
 * The Calendar needs these to honour a manual override — its own pairing in
 * `pairing.ts` is a fresh greedy pass that knows nothing about a session the
 * athlete linked by hand or marked skipped. Read-only and local: no COROS
 * request, which is what makes it safe to call on every calendar range change
 * alongside the three that are already there.
 */
export function listActivityMatches(): TrainingActivityMatch[] {
  return listTrainingActivityMatches();
}

/**
 * What the athlete said about one calendar session: this activity was it, none
 * was, it was skipped — or, with `manual: false`, "match it again", which the
 * next rebuild does.
 *
 * Keyed by the session, not by the caller's id. The matcher already holds a row
 * for the session under an id of its own, and the table takes one row per
 * session, so a statement carrying a fresh id would collide with it rather than
 * replace it.
 */
export function saveManualActivityMatch(match: TrainingActivityMatch): TrainingActivityMatch {
  const held = listTrainingActivityMatches().find(
    (item) =>
      item.schedulePlanId === match.schedulePlanId && item.scheduleIdInPlan === match.scheduleIdInPlan
  );
  const next = {
    ...match,
    id: held?.id ?? match.id,
    manual: match.manual !== false,
    updatedAt: new Date().toISOString()
  };
  saveTrainingActivityMatch(next);
  return next;
}
