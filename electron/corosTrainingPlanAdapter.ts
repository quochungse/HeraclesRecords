import {
  currentTrainingHubRegionId,
  getWorkoutProgramDetail,
  readNativeTrainingPlanEndpoint,
  writeNativeTrainingPlanEndpoint
} from "./trainingHubService";
import { COROS_WEEK_STAGES, TRAINING_PLAN_SESSIONS_PER_DAY } from "./trainingPlanDomain";
import type {
  NativeCorosPlanDetail,
  NativeCorosPlanEntity,
  NativeCorosPlanProgram,
  NativeCorosPlanSummary,
  TrainingHubScheduledExercise
} from "./types";

type RawPlan = Record<string, unknown>;

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = String(value).trim();
  return parsed || undefined;
}

function objectArray(value: unknown): RawPlan[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is RawPlan => typeof item === "object" && item !== null
      )
    : [];
}

function mapEntity(raw: RawPlan): NativeCorosPlanEntity {
  const id = stringValue(raw.id);
  return {
    id,
    idInPlan: stringValue(raw.idInPlan) ?? id ?? "",
    planProgramId: stringValue(raw.planProgramId),
    happenDay: stringValue(raw.happenDay),
    dayNo: numberValue(raw.dayNo),
    sortNo: numberValue(raw.sortNo),
    sortNoInPlan: numberValue(raw.sortNoInPlan),
    sortNoInSchedule: numberValue(raw.sortNoInSchedule),
    status: numberValue(raw.status) ?? numberValue(raw.executeStatus)
  };
}

function mapProgram(raw: RawPlan): NativeCorosPlanProgram {
  return {
    id: stringValue(raw.id),
    idInPlan: stringValue(raw.idInPlan),
    planProgramId: stringValue(raw.planProgramId),
    name: stringValue(raw.name) ?? "Workout",
    overview: stringValue(raw.overview),
    sportType: numberValue(raw.sportType),
    planDistance: numberValue(raw.planDistance) ?? numberValue(raw.distance),
    planDuration: numberValue(raw.planDuration) ?? numberValue(raw.duration),
    planTrainingLoad:
      numberValue(raw.planTrainingLoad) ?? numberValue(raw.trainingLoad),
    planSets: numberValue(raw.planSets) ?? numberValue(raw.totalSets),
    exercises: objectArray(raw.exercises) as unknown as TrainingHubScheduledExercise[]
  };
}

/** One COROS program — a plan's own, or a library workout's detail — as the adapter types it. */
export function parseNativeCorosProgram(raw: RawPlan): NativeCorosPlanProgram {
  return mapProgram(raw);
}

function mapSummary(
  raw: RawPlan,
  syncedAt: string,
  programs: NativeCorosPlanProgram[]
): NativeCorosPlanSummary {
  const sportTypes = [
    ...new Set(
      programs
        .map((program) => program.sportType)
        .filter((value): value is number => value !== undefined)
    )
  ];
  const sum = (pick: (program: NativeCorosPlanProgram) => number | undefined) =>
    programs.reduce((total, program) => total + (pick(program) ?? 0), 0);
  return {
    remoteId: stringValue(raw.id) ?? "",
    name: stringValue(raw.name) ?? "Training Plan",
    overview: stringValue(raw.overview) ?? "",
    totalDay: numberValue(raw.totalDay) ?? 0,
    minWeeks: numberValue(raw.minWeeks),
    maxWeeks: numberValue(raw.maxWeeks),
    startDay: stringValue(raw.startDay),
    endDay: stringValue(raw.endDay),
    executeStatus: numberValue(raw.executeStatus),
    sourcePlanId: stringValue(raw.sourcePlanId),
    inSchedule: numberValue(raw.inSchedule) === 1,
    workoutCount: programs.length,
    sportTypes,
    trainingLoad: sum((program) => program.planTrainingLoad) || undefined,
    durationSeconds: sum((program) => program.planDuration) || undefined,
    /* A program's distance is centimetres, like every COROS program figure
       of it — `planDistance` stays as COROS sent it and is converted here. */
    distanceMeters: sum((program) => program.planDistance) / 100 || undefined,
    version: numberValue(raw.version),
    updateTimestamp: numberValue(raw.updateTimestamp),
    syncState: "synced",
    lastSyncedAt: syncedAt
  };
}

export function parseNativeCorosPlan(
  raw: RawPlan,
  syncedAt = new Date().toISOString()
): NativeCorosPlanDetail {
  const programs = objectArray(raw.programs).map(mapProgram);
  return {
    ...mapSummary(raw, syncedAt, programs),
    entities: objectArray(raw.entities)
      .map(mapEntity)
      .filter((entity) => entity.idInPlan),
    programs,
    weekStages: objectArray(raw.weekStages).map((stage) => ({
      weekNo: numberValue(stage.weekNo) ?? 1,
      stage:
        typeof stage.stage === "string" || typeof stage.stage === "number"
          ? stage.stage
          : undefined,
      planDistance: numberValue(stage.planDistance),
      planDuration: numberValue(stage.planDuration),
      planTrainingLoad: numberValue(stage.planTrainingLoad)
    })),
    rawPayload: raw
  };
}

export async function listNativeCorosPlans(): Promise<NativeCorosPlanDetail[]> {
  const data = await readNativeTrainingPlanEndpoint<unknown>(
    "/training/plan/query",
    { method: "POST", body: {} }
  );
  const syncedAt = new Date().toISOString();
  return objectArray(data)
    .map((raw) => parseNativeCorosPlan(raw, syncedAt))
    .filter((plan) => plan.remoteId);
}

export async function readNativeCorosPlan(
  remoteId: string
): Promise<NativeCorosPlanDetail> {
  const rawDetail = await readNativeCorosPlanRaw(remoteId);
  const detail = parseNativeCorosPlan(rawDetail);
  /* The list is only a fallback for a detail that came without its programs.
     It is every plan on the account, each with every program and its steps,
     so asking for it on every open was most of what opening a plan cost. */
  const listPlan = detail.programs.length > 0
    ? undefined
    : (await listNativeCorosPlans()).find((plan) => plan.remoteId === remoteId);
  const groupedRaw = !listPlan
    ? rawDetail
    : {
        ...listPlan.rawPayload,
        ...rawDetail,
        programs: listPlan.rawPayload.programs,
        entities: listPlan.rawPayload.entities,
        weekStages: listPlan.rawPayload.weekStages
      };

  // Plan query/detail can contain intentionally lightweight program records.
  // Resolve their already-verified read-only workout details only when a user
  // opens a plan, keeping library refreshes inexpensive while surfacing richer
  // metrics and step structures whenever COROS exposes them for that program.
  const programs = objectArray(groupedRaw.programs);
  const enrichedPrograms = await Promise.all(
    programs.map(async (program) => {
      const id = stringValue(program.id);
      if (!id) return program;
      /* A program that arrived with its steps has nothing left to resolve.
         An official 12-week plan carries all 87 of its programs complete, and
         asking for each again was 87 requests to open it. */
      if (objectArray(program.exercises).length > 0) return program;
      const programDetail = await getWorkoutProgramDetail(id);
      if (!programDetail) return program;
      return {
        ...program,
        ...programDetail,
        idInPlan: program.idInPlan ?? programDetail.idInPlan,
        planProgramId: program.planProgramId ?? programDetail.planProgramId
      };
    })
  );

  return parseNativeCorosPlan(
    { ...groupedRaw, programs: enrichedPrograms },
    detail.lastSyncedAt
  );
}

// ---------------------------------------------------------------------------
// Writes
//
// Every shape below is the Training Hub web app's own (its `savePlan`,
// `updatePlan`, `api4DeletePlan`, `api4copyPlan`, `usePlan` and `handleQuit`),
// and each was probed live on 2026-09-24 through a whole lifecycle — see
// docs/coros-plan-write-api.md. The builders are pure so a suite can hold them
// against the captured requests in scripts/fixtures/coros-plan-write/.
// ---------------------------------------------------------------------------

/**
 * The thumbnail a plan is filed under. The web app picks one at random from
 * COROS's default set; a plan needs one, and this is one of that set.
 */
const DEFAULT_PLAN_THUMBNAIL = {
  sourceId: "425846071290413056",
  sourceUrl:
    "https://s3.coros.com/source/source_default/0/0508c8b8638d47bead5cc384ea561ec7.jpg"
};

export interface NativePlanSessionInput {
  /** The session's `idInPlan` when it is already in the plan; absent for a new one. */
  idInPlan?: string;
  /** Zero-based day across the whole plan — week × 7 + day, Monday first. */
  dayNo: number;
  /**
   * A complete COROS program: `/training/program/detail`, the plan's own copy
   * of it, or `buildCalculatedPlanProgram`. COROS stores it as a copy with an
   * id of its own, so nothing here links back to a library workout.
   */
  program: RawPlan;
}

export interface NativePlanWriteInput {
  name: string;
  overview: string;
  sessions: NativePlanSessionInput[];
  /** One-based week numbers. A week not listed keeps what it has (Not Set on a new plan). */
  weekStages: Array<{ weekNo: number; stage: number }>;
  /** COROS's `unit`: 0 metric, 1 imperial. */
  unit?: number;
}

function validateWriteInput(input: NativePlanWriteInput): void {
  if (!input.name.trim()) throw new Error("A COROS plan needs a name.");
  if (input.sessions.length === 0) {
    throw new Error("A COROS plan needs at least one session.");
  }
  const perDay = new Map<number, number>();
  for (const session of input.sessions) {
    if (!Number.isInteger(session.dayNo) || session.dayNo < 0) {
      throw new Error("Every session needs a day in the plan.");
    }
    const count = (perDay.get(session.dayNo) ?? 0) + 1;
    if (count > TRAINING_PLAN_SESSIONS_PER_DAY) {
      throw new Error(
        `COROS takes at most ${TRAINING_PLAN_SESSIONS_PER_DAY} sessions on one day.`
      );
    }
    perDay.set(session.dayNo, count);
  }
  for (const { weekNo, stage } of input.weekStages) {
    if (!Number.isInteger(weekNo) || weekNo < 1) {
      throw new Error("Week stages are numbered from week 1.");
    }
    if (!COROS_WEEK_STAGES.some((known) => known.value === stage)) {
      throw new Error(`Unknown COROS week stage ${stage}.`);
    }
  }
}

interface OrderedSession extends NativePlanSessionInput {
  sortNo: number;
  sortNoInSchedule: number;
}

/**
 * Day order, then the order the caller gave within a day. `sortNo` and
 * `sortNoInPlan` count across the plan, `sortNoInSchedule` within a day —
 * all one-based, as the web app writes them.
 */
function orderSessions(sessions: NativePlanSessionInput[]): OrderedSession[] {
  const inDay = new Map<number, number>();
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => left.session.dayNo - right.session.dayNo || left.index - right.index)
    .map(({ session }, position) => {
      const withinDay = (inDay.get(session.dayNo) ?? 0) + 1;
      inDay.set(session.dayNo, withinDay);
      return { ...session, sortNo: position + 1, sortNoInSchedule: withinDay };
    });
}

/**
 * `totalDay` is the last session's day plus one — which is why a plan cannot
 * end in an empty week — and `minWeeks`/`maxWeeks`, despite their names, are
 * the fewest and most sessions in a week that has any.
 */
function planShape(sessions: OrderedSession[]): {
  totalDay: number;
  minWeeks: number;
  maxWeeks: number;
} {
  const perWeek = new Map<number, number>();
  for (const session of sessions) {
    const week = Math.floor(session.dayNo / 7);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  const counts = [...perWeek.values()];
  return {
    totalDay: Math.max(...sessions.map((session) => session.dayNo)) + 1,
    minWeeks: Math.min(...counts),
    maxWeeks: Math.max(...counts)
  };
}

function planProgram(program: RawPlan, idInPlan: string | number): RawPlan {
  const copy = structuredClone(program);
  delete copy.happenDay;
  copy.idInPlan = idInPlan;
  return copy;
}

/**
 * A session new to the plan, as the web app sends one: without the fields a
 * program holds as a session of some plan (`planId`, `star`). A session copied
 * in the editor, or out of another plan, would otherwise name the session it
 * was copied from. COROS gives a new session ids of its own.
 */
function newPlanProgram(program: RawPlan, idInPlan: number): RawPlan {
  const copy = planProgram(program, idInPlan);
  delete copy.planId;
  delete copy.star;
  return copy;
}

/** A plan's `pbVersion` has to cover its most demanding program. */
function planPbVersion(programs: RawPlan[], floor = 0): number {
  return Math.max(floor, ...programs.map((program) => numberValue(program.pbVersion) ?? 0), 2);
}

/**
 * The stages to send. A stage the plan already holds keeps its own fields
 * (`id`, `planId`, its totals) and changes only its `stage`; `firstDayInWeek`
 * is a calendar field and goes, as the web app strips it. Weeks past the
 * plan's end are dropped.
 */
function mergeWeekStages(
  existing: RawPlan[],
  requested: NativePlanWriteInput["weekStages"],
  totalDay: number
): RawPlan[] {
  const weeks = Math.ceil(totalDay / 7);
  const byWeek = new Map<number, RawPlan>();
  for (const stage of existing) {
    const weekNo = numberValue(stage.weekNo);
    if (weekNo === undefined) continue;
    const copy = structuredClone(stage);
    delete copy.firstDayInWeek;
    byWeek.set(weekNo, copy);
  }
  for (const { weekNo, stage } of requested) {
    const current = byWeek.get(weekNo);
    byWeek.set(
      weekNo,
      current
        ? { ...current, stage }
        : {
            weekNo,
            stage,
            trainSum: { planDistance: 0, planDuration: 0, planTrainingLoad: 0 },
            sumByType: []
          }
    );
  }
  return [...byWeek.entries()]
    .filter(([weekNo]) => weekNo <= weeks)
    .sort(([left], [right]) => left - right)
    .map(([, stage]) => stage);
}

export function buildNativePlanCreateBody(
  input: NativePlanWriteInput,
  options: { region: string | number }
): RawPlan {
  validateWriteInput(input);
  const ordered = orderSessions(input.sessions);
  const programs = ordered.map((session, index) => newPlanProgram(session.program, index + 1));
  const shape = planShape(ordered);
  return {
    name: input.name.trim(),
    overview: input.overview,
    entities: ordered.map((session, index) => ({
      happenDay: "",
      idInPlan: index + 1,
      sortNo: session.sortNo,
      dayNo: session.dayNo,
      sortNoInPlan: session.sortNo,
      sortNoInSchedule: session.sortNoInSchedule
    })),
    programs,
    weekStages: mergeWeekStages([], input.weekStages, shape.totalDay),
    maxIdInPlan: ordered.length,
    totalDay: shape.totalDay,
    unit: input.unit ?? 0,
    ...DEFAULT_PLAN_THUMBNAIL,
    minWeeks: shape.minWeeks,
    maxWeeks: shape.maxWeeks,
    region: Number(options.region),
    pbVersion: planPbVersion(programs),
    versionObjects: ordered.map((_, index) => ({ id: index + 1, status: 1 }))
  };
}

function dayKeyAfter(anchor: Date, days: number): number {
  const date = new Date(anchor);
  date.setDate(date.getDate() + days);
  return Number(
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
  );
}

/**
 * Where `dayNo 0` sits on the calendar for a plan that is on it. COROS anchors
 * the plan on the Monday of the week holding `startDay` — and drops whatever
 * falls before `startDay` — so a session added to a running plan is dated from
 * that Monday, not from the start day.
 */
function runningPlanAnchor(current: RawPlan): Date | undefined {
  if (numberValue(current.executeStatus) !== 1) return undefined;
  const start = stringValue(current.startDay);
  if (!start || !/^\d{8}$/.test(start)) return undefined;
  const date = new Date(
    Number(start.slice(0, 4)),
    Number(start.slice(4, 6)) - 1,
    Number(start.slice(6, 8)),
    12
  );
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

const comparableProgram = (program: RawPlan | undefined, idInPlan: string) =>
  program ? JSON.stringify(planProgram(program, idInPlan)) : "";

/**
 * The whole plan as it should read, sent over the detail it was read from.
 *
 * `update` takes the full plan every time, and `versionObjects` names what
 * changed: `status 1` a session added, `2` one edited or moved, `3` one
 * removed. An id is never reused — a new session takes the next one past
 * `maxIdInPlan`, which COROS keeps even after the session holding it is gone.
 * On a plan that is on the calendar (an instance) each session also carries its
 * real `happenDay`, and changing one changes the calendar at once.
 */
export function buildNativePlanUpdateBody(
  current: RawPlan,
  input: NativePlanWriteInput
): RawPlan {
  validateWriteInput(input);
  const planId = stringValue(current.id);
  const anchor = runningPlanAnchor(current);
  const currentEntities = objectArray(current.entities);
  const currentPrograms = objectArray(current.programs);
  const entityById = new Map(currentEntities.map((entity) => [String(entity.idInPlan), entity]));
  const programById = new Map(currentPrograms.map((program) => [String(program.idInPlan), program]));

  for (const session of input.sessions) {
    if (session.idInPlan !== undefined && !entityById.has(String(session.idInPlan))) {
      throw new Error(`Session ${session.idInPlan} is not in this plan any more. Reload it before saving.`);
    }
  }

  let maxId = Math.max(
    numberValue(current.maxIdInPlan) ?? 0,
    ...currentEntities.map((entity) => numberValue(entity.idInPlan) ?? 0)
  );
  const versionObjects: RawPlan[] = [];
  const kept = new Set(
    input.sessions.flatMap((session) => (session.idInPlan === undefined ? [] : [String(session.idInPlan)]))
  );
  for (const entity of currentEntities) {
    const id = String(entity.idInPlan);
    if (kept.has(id)) continue;
    versionObjects.push({
      id,
      ...(entity.labelId !== undefined ? { labelId: entity.labelId } : {}),
      planProgramId: entity.planProgramId,
      planId,
      status: 3
    });
  }

  const ordered = orderSessions(input.sessions);
  const entities: RawPlan[] = [];
  const programs: RawPlan[] = [];
  for (const session of ordered) {
    const happenDay = anchor ? dayKeyAfter(anchor, session.dayNo) : undefined;
    const placement = {
      dayNo: session.dayNo,
      sortNo: session.sortNo,
      sortNoInPlan: session.sortNo,
      sortNoInSchedule: session.sortNoInSchedule
    };
    const existing = session.idInPlan === undefined ? undefined : entityById.get(String(session.idInPlan));
    if (existing) {
      const id = String(existing.idInPlan);
      /* Only a plan on the calendar has dates to move. A plan that is not keeps
         whatever COROS sent for `happenDay` — absent, `0` or `""` — untouched,
         or every session would read as moved on every save. */
      const entity: RawPlan = {
        ...structuredClone(existing),
        ...placement,
        ...(happenDay !== undefined ? { happenDay } : {})
      };
      const moved = ["dayNo", "sortNoInSchedule", "happenDay"].some(
        (field) => String(entity[field]) !== String(existing[field])
      );
      const edited =
        comparableProgram(session.program, id) !== comparableProgram(programById.get(id), id);
      entities.push(entity);
      programs.push(planProgram(session.program, existing.idInPlan as string | number));
      if (moved || edited) {
        versionObjects.push({
          id,
          ...(existing.labelId !== undefined ? { labelId: existing.labelId } : {}),
          planProgramId: existing.planProgramId,
          planId,
          status: 2
        });
      }
    } else {
      maxId += 1;
      entities.push({ happenDay: happenDay ?? "", idInPlan: maxId, ...placement });
      programs.push(newPlanProgram(session.program, maxId));
      versionObjects.push({ id: maxId, status: 1 });
    }
  }

  const shape = planShape(ordered);
  return {
    ...structuredClone(current),
    name: input.name.trim(),
    overview: input.overview,
    entities,
    programs,
    weekStages: mergeWeekStages(objectArray(current.weekStages), input.weekStages, shape.totalDay),
    maxIdInPlan: maxId,
    totalDay: shape.totalDay,
    minWeeks: shape.minWeeks,
    maxWeeks: shape.maxWeeks,
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    pbVersion: planPbVersion(programs, numberValue(current.pbVersion) ?? 0),
    versionObjects
  };
}

function requireRegion(): string {
  const region = currentTrainingHubRegionId();
  if (!region) throw new Error("Log in to COROS Training Hub first.");
  return region;
}

/** The detail exactly as COROS sent it — what `update` and `copy` are built on. */
export async function readNativeCorosPlanRaw(remoteId: string): Promise<RawPlan> {
  const raw = await readNativeTrainingPlanEndpoint<RawPlan>("/training/plan/detail", {
    method: "GET",
    params: { id: remoteId, supportRestExercise: 1 }
  });
  if (!raw || typeof raw !== "object") throw new Error("COROS did not return that plan.");
  return raw;
}

/**
 * A plan's write input read straight off its raw detail — every session as
 * COROS holds it, in place. What a rename or a copy writes back when nothing
 * else about the plan changes.
 */
export function nativePlanWriteInputFromRaw(
  raw: RawPlan,
  overrides: Partial<Pick<NativePlanWriteInput, "name" | "overview">> = {}
): NativePlanWriteInput {
  const programs = new Map(objectArray(raw.programs).map((program) => [String(program.idInPlan), program]));
  return {
    name: overrides.name ?? stringValue(raw.name) ?? "Training Plan",
    overview: overrides.overview ?? stringValue(raw.overview) ?? "",
    sessions: objectArray(raw.entities).flatMap((entity) => {
      const idInPlan = stringValue(entity.idInPlan);
      const program = idInPlan ? programs.get(idInPlan) : undefined;
      const dayNo = numberValue(entity.dayNo);
      return idInPlan && program && dayNo !== undefined && numberValue(entity.status) !== 3
        ? [{ idInPlan, dayNo, program }]
        : [];
    }),
    weekStages: objectArray(raw.weekStages).flatMap((stage) => {
      const weekNo = numberValue(stage.weekNo);
      const value = numberValue(stage.stage);
      return weekNo !== undefined && value !== undefined ? [{ weekNo, stage: value }] : [];
    })
  };
}

/** A plan COROS has soft-deleted still answers `detail`, with `status: 0`. */
export function isDeletedNativePlan(raw: RawPlan): boolean {
  return numberValue(raw.status) === 0;
}

/** `plan/add`, answering the new plan's id. */
export async function createNativeCorosPlan(input: NativePlanWriteInput): Promise<string> {
  const body = buildNativePlanCreateBody(input, { region: requireRegion() });
  const remoteId = stringValue(
    await writeNativeTrainingPlanEndpoint<unknown>("/training/plan/add", { body })
  );
  if (!remoteId) throw new Error("COROS accepted the plan but returned no id for it.");
  return remoteId;
}

/**
 * `plan/update` over a fresh read — or over `current`, when the caller has just
 * made it. `update` replaces the whole plan, so whether the plan moved on COROS
 * since an edit began is the caller's to ask first (`savePlanToCoros` compares
 * versions before it prices anything). A plan COROS deleted is refused: it
 * still answers `detail`, and an update would write into it.
 */
export async function updateNativeCorosPlan(
  remoteId: string,
  input: NativePlanWriteInput,
  options: { current?: RawPlan } = {}
): Promise<void> {
  const current = options.current ?? (await readNativeCorosPlanRaw(remoteId));
  if (isDeletedNativePlan(current)) {
    throw new Error("This plan was deleted on COROS.");
  }
  await writeNativeTrainingPlanEndpoint("/training/plan/update", {
    body: buildNativePlanUpdateBody(current, input)
  });
}

/**
 * `plan/copy`. The copy keeps the original's name — the web app's own
 * Duplicate does too — and carries `originId`. Copying a plan that is on the
 * calendar gives a plan that is not (`executeStatus 0`).
 */
export async function copyNativeCorosPlan(remoteId: string): Promise<NativeCorosPlanDetail> {
  const current = await readNativeCorosPlanRaw(remoteId);
  const body = {
    ...structuredClone(current),
    weekStages: objectArray(current.weekStages).map((stage) => {
      const copy = structuredClone(stage);
      delete copy.firstDayInWeek;
      return copy;
    })
  };
  const copied = await writeNativeTrainingPlanEndpoint<RawPlan>("/training/plan/copy", {
    params: { id: remoteId, region: requireRegion() },
    body
  });
  if (!copied || typeof copied !== "object" || !stringValue(copied.id)) {
    throw new Error("COROS accepted the copy but did not return it.");
  }
  return parseNativeCorosPlan(copied);
}

/**
 * `plan/delete`. A soft delete: the plan leaves `plan/query`, while `detail`
 * still answers for it with `status: 0` — so absence from the list is the
 * only test of a deleted plan.
 */
export async function deleteNativeCorosPlan(remoteId: string): Promise<void> {
  await writeNativeTrainingPlanEndpoint("/training/plan/delete", { body: [remoteId] });
}

/**
 * `executeSubPlan`: put a plan on the calendar from `startDay` (yyyyMMdd).
 *
 * COROS makes an instance — a copy with `executeStatus 1` and `sourcePlanId`
 * naming the plan — and dates its sessions from the Monday of `startDay`'s
 * week, dropping those before `startDay`. It checks nothing against the
 * calendar: a day that already holds a workout gets the plan's as well — nor
 * against itself, so a plan already running would go on twice; the list read
 * before the write is where that is refused. The answer carries no id, so the
 * instance is found in the list afterwards.
 */
export async function executeNativeCorosPlan(
  templateId: string,
  startDay: string
): Promise<NativeCorosPlanSummary> {
  if (!/^\d{8}$/.test(startDay)) throw new Error("startDay must be yyyyMMdd.");
  const listed = await listNativeCorosPlans();
  if (listed.some((plan) => plan.executeStatus === 1 && plan.sourcePlanId === templateId)) {
    throw new Error("This plan is already on the calendar. Take it off before adding it again.");
  }
  const before = new Set(listed.map((plan) => plan.remoteId));
  await writeNativeTrainingPlanEndpoint("/training/schedule/executeSubPlan", {
    params: { subPlanId: templateId, startDay },
    body: {}
  });
  const instance = (await listNativeCorosPlans()).find(
    (plan) =>
      plan.sourcePlanId === templateId &&
      plan.executeStatus === 1 &&
      !before.has(plan.remoteId)
  );
  if (!instance) {
    throw new Error(
      "COROS accepted the plan for the calendar, but its scheduled copy has not appeared yet. Refresh before trying again."
    );
  }
  return instance;
}

/**
 * `quitSubPlan`: take a running instance off the calendar. Every session of
 * the plan goes, and nothing else; the instance stays listed with
 * `executeStatus 2`, and the calendar's stage for its weeks drops to Not Set.
 */
export async function quitNativeCorosPlan(instanceId: string): Promise<void> {
  await writeNativeTrainingPlanEndpoint("/training/schedule/quitSubPlan", {
    params: { subPlanId: instanceId },
    body: {}
  });
}
