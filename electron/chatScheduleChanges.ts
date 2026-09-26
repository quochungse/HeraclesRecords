/**
 * Coach's proposals to the calendar and the workout library, applied by the
 * athlete a line at a time or all at once (P3.2–P3.3 of
 * docs/coach-plan-canvas.md).
 *
 * A change set is a row of `chat_schedule_changes` (`personal`), not a card
 * held in memory: the delete card it replaces lived in a map, so a restart
 * left a button that could only answer "expired". The transcript holds a
 * `scheduleChange` anchor; the card reads the set through
 * `chat:scheduleChanges`.
 *
 * Three rules hold it up.
 * - **Every line reads COROS again before it writes.** What Coach saw may
 *   have moved since — on the calendar, or from the other machine applying the
 *   same set — and a line whose session is gone or changed goes `stale`
 *   rather than acting on something else.
 * - **One line, one write, recorded as soon as it lands.** One
 *   `schedule/update` is all or nothing (P3.0 E), so lines written together
 *   would share one fate and lose their own; and a set applied part-way keeps
 *   the part that was applied.
 * - **A line already applied is never written again**, and a set is applied
 *   by one caller at a time.
 */
import crypto from "node:crypto";
import {
  getChatScheduleChanges,
  saveChatScheduleChange,
  type StoredChatScheduleChange
} from "./database";
import {
  deleteWorkoutProgram,
  invalidateLibraryWorkoutPrograms,
  listLibraryWorkouts,
  listScheduledWorkoutEntries,
  removeScheduledWorkout
} from "./trainingHubService";
import { formatScheduleDay } from "./corosWorkoutBuilder";
import {
  defaultScheduleMoveDeps,
  moveCalendarSession,
  PartialReplaceError,
  replaceCalendarSession,
  type ScheduleMoveDeps
} from "./scheduleMoves";
import type {
  PlanWorkoutEntryInput,
  ScheduleChangeLine,
  ScheduleChangeOp,
  ScheduleChangeSession,
  ScheduleChangeSet,
  ScheduleChangeStatus,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "./types";

const OPS: readonly ScheduleChangeOp[] = ["move", "replace", "remove", "add", "deleteWorkout"];
const STATUSES: readonly ScheduleChangeStatus[] = ["proposed", "applied", "failed", "dismissed", "stale"];

// ---------------------------------------------------------------------------
// Reading and writing the row
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function parseSession(value: unknown): ScheduleChangeSession | undefined {
  if (!isRecord(value)) return undefined;
  const planId = text(value.planId);
  const idInPlan = text(value.idInPlan);
  const happenDay = text(value.happenDay);
  if (!planId || !idInPlan || !happenDay) return undefined;
  return {
    planId,
    idInPlan,
    happenDay,
    name: text(value.name) ?? "",
    ...(text(value.planProgramId) ? { planProgramId: text(value.planProgramId) } : {}),
    ...(text(value.programId) ? { programId: text(value.programId) } : {}),
    ...(typeof value.sportType === "number" ? { sportType: value.sportType } : {})
  };
}

/**
 * A line as stored. One this build cannot read — an op a newer build added —
 * is kept as it is, so a save here does not take it out of the set, and is
 * not applied here.
 */
function parseLine(value: unknown): ScheduleChangeLine | undefined {
  if (!isRecord(value)) return undefined;
  const lineId = text(value.lineId);
  if (!lineId) return undefined;
  const op = OPS.includes(value.op as ScheduleChangeOp) ? (value.op as ScheduleChangeOp) : undefined;
  const status = STATUSES.includes(value.status as ScheduleChangeStatus)
    ? (value.status as ScheduleChangeStatus)
    : "proposed";
  if (!op) return { ...(value as unknown as ScheduleChangeLine), lineId, status };
  const session = parseSession(value.session);
  return {
    ...(value as Record<string, unknown>),
    lineId,
    op,
    label: text(value.label) ?? "",
    ...(session ? { session } : {}),
    ...(text(value.toDay) ? { toDay: text(value.toDay) } : {}),
    ...(isRecord(value.workout) ? { workout: value.workout as unknown as PlanWorkoutEntryInput } : {}),
    ...(isRecord(value.program) && text(value.program.id)
      ? { program: { id: text(value.program.id)!, name: text(value.program.name) ?? "" } }
      : {}),
    status,
    ...(text(value.reason) ? { reason: text(value.reason) } : {}),
    ...(value.retry === false ? { retry: false } : {}),
    ...(text(value.settledAt) ? { settledAt: text(value.settledAt) } : {})
  } as ScheduleChangeLine;
}

function fromRecord(record: StoredChatScheduleChange): ScheduleChangeSet {
  let lines: unknown;
  try {
    lines = JSON.parse(record.linesJson);
  } catch {
    lines = [];
  }
  return {
    changeSetId: record.changeSetId,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    summary: record.summary,
    ...(record.unitSystem === "imperial" ? { unitSystem: "imperial" as const } : {}),
    lines: (Array.isArray(lines) ? lines : []).flatMap((line) => {
      const parsed = parseLine(line);
      return parsed ? [parsed] : [];
    }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function save(set: ScheduleChangeSet): ScheduleChangeSet {
  const next = { ...set, updatedAt: new Date().toISOString() };
  saveChatScheduleChange({
    changeSetId: next.changeSetId,
    ...(next.sessionId ? { sessionId: next.sessionId } : {}),
    summary: next.summary,
    ...(next.unitSystem === "imperial" ? { unitSystem: "imperial" } : {}),
    linesJson: JSON.stringify(next.lines),
    createdAt: next.createdAt,
    updatedAt: next.updatedAt
  });
  return next;
}

export function readScheduleChanges(changeSetIds: readonly string[]): ScheduleChangeSet[] {
  const ids = [...new Set(changeSetIds.filter((id) => typeof id === "string" && id))];
  return getChatScheduleChanges(ids).map(fromRecord);
}

function requireSet(changeSetId: string): ScheduleChangeSet {
  const [set] = readScheduleChanges([changeSetId]);
  if (!set) throw new Error("This proposal is gone — its conversation may have been deleted on another device.");
  return set;
}

export type NewScheduleChangeLine = Omit<ScheduleChangeLine, "lineId" | "status" | "reason" | "settledAt">;

/** A new set, every line proposed. */
export function createScheduleChangeSet(input: {
  sessionId?: string;
  summary: string;
  lines: NewScheduleChangeLine[];
  unitSystem?: UnitSystem;
}): ScheduleChangeSet {
  const now = new Date().toISOString();
  return save({
    changeSetId: `sc-${crypto.randomUUID()}`,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    summary: input.summary,
    ...(input.unitSystem === "imperial" ? { unitSystem: "imperial" } : {}),
    lines: input.lines.map((line, index) => ({ ...line, lineId: `l${index + 1}`, status: "proposed" })),
    createdAt: now,
    updatedAt: now
  });
}

// ---------------------------------------------------------------------------
// Applying and dismissing
// ---------------------------------------------------------------------------

/** Change sets being applied now. A second press, or the card on another screen, waits its turn by refusing. */
const applying = new Set<string>();

export interface ScheduleChangeDeps {
  /** How a session is moved or replaced, so that a plan's stays in its plan. */
  moves: ScheduleMoveDeps;
  /** yyyyMMdd, local. */
  today: () => string;
  listScheduledWorkoutEntries: typeof listScheduledWorkoutEntries;
  removeScheduledWorkout: typeof removeScheduledWorkout;
  listLibraryWorkouts: typeof listLibraryWorkouts;
  /** The library list is cached for minutes; a check before a delete reads it afresh. */
  invalidateLibraryWorkoutPrograms: typeof invalidateLibraryWorkoutPrograms;
  deleteWorkoutProgram: typeof deleteWorkoutProgram;
}

const defaultDeps: ScheduleChangeDeps = {
  moves: defaultScheduleMoveDeps,
  today: () => formatScheduleDay(new Date()),
  listScheduledWorkoutEntries,
  removeScheduledWorkout,
  listLibraryWorkouts,
  invalidateLibraryWorkoutPrograms,
  deleteWorkoutProgram
};

type LineOutcome = Pick<ScheduleChangeLine, "status" | "reason" | "retry">;

/**
 * Applies one line, or every proposed line when `lineId` is absent, in order.
 * A failed line is tried again only when it is named, and only when nothing
 * of it landed (`retry`): COROS going away for a moment should not cost the
 * athlete the proposal.
 * Each outcome is written as soon as it is known, so a set stopped part-way
 * (a crash, COROS going away) keeps what it did.
 */
export async function applyScheduleChange(
  changeSetId: string,
  lineId?: string,
  deps: ScheduleChangeDeps = defaultDeps
): Promise<ScheduleChangeSet> {
  if (applying.has(changeSetId)) throw new Error("These changes are already being applied.");
  applying.add(changeSetId);
  try {
    let set = requireSet(changeSetId);
    const targets = set.lines.filter((line) => (lineId ? line.lineId === lineId : true));
    if (lineId && !targets.length) throw new Error("That change is not in this proposal any more.");
    for (const target of targets) {
      // Read again per line: another line, or another machine, may have settled it.
      set = requireSet(changeSetId);
      const line = set.lines.find((candidate) => candidate.lineId === target.lineId);
      const retrying = Boolean(lineId) && line?.status === "failed" && line.retry !== false;
      if (!line || (line.status !== "proposed" && !retrying) || !OPS.includes(line.op)) continue;
      const outcome = await applyLine(line, deps, set.unitSystem ?? "metric");
      set = save({
        ...set,
        lines: set.lines.map((candidate) =>
          candidate.lineId === line.lineId
            ? {
                ...candidate,
                status: outcome.status,
                ...(outcome.reason ? { reason: outcome.reason } : { reason: undefined }),
                ...(outcome.retry === false ? { retry: false as const } : { retry: undefined }),
                settledAt: new Date().toISOString()
              }
            : candidate
        )
      });
    }
    return set;
  } finally {
    applying.delete(changeSetId);
  }
}

/** Dismisses one proposed line, or every proposed line. A settled line keeps what it settled as. */
export function dismissScheduleChange(changeSetId: string, lineId?: string): ScheduleChangeSet {
  if (applying.has(changeSetId)) throw new Error("These changes are being applied; wait for them to finish.");
  const set = requireSet(changeSetId);
  const now = new Date().toISOString();
  return save({
    ...set,
    lines: set.lines.map((line) =>
      line.status === "proposed" && (!lineId || line.lineId === lineId)
        ? { ...line, status: "dismissed", settledAt: now }
        : line
    )
  });
}

async function applyLine(
  line: ScheduleChangeLine,
  deps: ScheduleChangeDeps,
  unitSystem: UnitSystem
): Promise<LineOutcome> {
  try {
    switch (line.op) {
      case "remove":
        return await applyRemove(line, deps);
      case "deleteWorkout":
        return await applyDeleteWorkout(line, deps);
      case "move":
        return await applyMove(line, deps);
      case "replace":
        return await applyReplace(line, deps, unitSystem);
      case "add":
        return await applyAdd(line, deps, unitSystem);
      default:
        return { status: "failed", reason: "This build cannot apply that change." };
    }
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      ...(error instanceof PartialReplaceError ? { retry: false as const } : {})
    };
  }
}

/**
 * The session as the calendar holds it now, or why the line is stale: gone
 * from its day, or not the session Coach saw (renamed, replaced).
 */
async function currentSession(
  session: ScheduleChangeSession,
  deps: ScheduleChangeDeps
): Promise<{ entry: TrainingHubScheduledWorkoutEntry } | { stale: string }> {
  const entries = await deps.listScheduledWorkoutEntries(session.happenDay, session.happenDay);
  const entry = entries.find((candidate) => candidate.planId === session.planId && candidate.idInPlan === session.idInPlan);
  if (!entry) return { stale: `"${session.name}" is no longer on the calendar on ${dashed(session.happenDay)}.` };
  if (session.name && entry.name !== session.name) {
    return { stale: `The session on ${dashed(session.happenDay)} is now "${entry.name}", not "${session.name}".` };
  }
  return { entry };
}

/**
 * `schedule/update` status 3, for a session of the athlete's own and for one
 * of a running plan alike: COROS takes it out of the running copy too, so the
 * plan and the calendar stay in step (P3.0 A).
 */
async function applyRemove(line: ScheduleChangeLine, deps: ScheduleChangeDeps): Promise<LineOutcome> {
  if (!line.session) return { status: "failed", reason: "The proposal does not say which session." };
  const found = await currentSession(line.session, deps);
  if ("stale" in found) return { status: "stale", reason: found.stale };
  const pbVersion = Number(found.entry.rawProgram?.pbVersion);
  await deps.removeScheduledWorkout({
    planId: found.entry.planId,
    idInPlan: found.entry.idInPlan,
    planProgramId: found.entry.planProgramId,
    ...(Number.isFinite(pbVersion) && pbVersion > 0 ? { pbVersion } : {})
  });
  return { status: "applied" };
}

/** A day gone by the time the line is applied: COROS refuses one, and the proposal was about the days ahead. */
function pastDay(day: string, deps: ScheduleChangeDeps): string | undefined {
  return day < deps.today() ? `${dashed(day)} has passed.` : undefined;
}

async function applyMove(line: ScheduleChangeLine, deps: ScheduleChangeDeps): Promise<LineOutcome> {
  if (!line.session || !line.toDay) return { status: "failed", reason: "The proposal does not say which session or where to." };
  const passed = pastDay(line.session.happenDay, deps) ?? pastDay(line.toDay, deps);
  if (passed) return { status: "stale", reason: passed };
  const found = await currentSession(line.session, deps);
  if ("stale" in found) return { status: "stale", reason: found.stale };
  await moveCalendarSession(
    { planId: found.entry.planId, idInPlan: found.entry.idInPlan, planProgramId: found.entry.planProgramId, happenDay: found.entry.happenDay },
    line.toDay,
    deps.moves
  );
  return { status: "applied" };
}

async function applyReplace(line: ScheduleChangeLine, deps: ScheduleChangeDeps, unitSystem: UnitSystem): Promise<LineOutcome> {
  if (!line.session || !line.workout) return { status: "failed", reason: "The proposal does not say which session or what with." };
  const passed = pastDay(line.session.happenDay, deps);
  if (passed) return { status: "stale", reason: passed };
  const found = await currentSession(line.session, deps);
  if ("stale" in found) return { status: "stale", reason: found.stale };
  const pbVersion = Number(found.entry.rawProgram?.pbVersion);
  await replaceCalendarSession(
    {
      planId: found.entry.planId,
      idInPlan: found.entry.idInPlan,
      planProgramId: found.entry.planProgramId,
      happenDay: found.entry.happenDay,
      ...(Number.isFinite(pbVersion) && pbVersion > 0 ? { pbVersion } : {})
    },
    line.workout,
    unitSystem,
    deps.moves
  );
  return { status: "applied" };
}

/**
 * A new session of the athlete's own. Nothing identifies it before it exists,
 * so a line applied on the other machine meanwhile is recognised by its name
 * already being on that day.
 */
async function applyAdd(line: ScheduleChangeLine, deps: ScheduleChangeDeps, unitSystem: UnitSystem): Promise<LineOutcome> {
  if (!line.toDay || !line.workout) return { status: "failed", reason: "The proposal does not say what or where." };
  const passed = pastDay(line.toDay, deps);
  if (passed) return { status: "stale", reason: passed };
  const onDay = await deps.listScheduledWorkoutEntries(line.toDay, line.toDay);
  if (onDay.some((entry) => entry.name === line.workout!.name)) {
    return { status: "stale", reason: `"${line.workout.name}" is already on the calendar on ${dashed(line.toDay)}.` };
  }
  await deps.moves.createAndScheduleWorkout({ ...line.workout, save_to_library: false }, line.toDay, unitSystem, false);
  return { status: "applied" };
}

async function applyDeleteWorkout(line: ScheduleChangeLine, deps: ScheduleChangeDeps): Promise<LineOutcome> {
  if (!line.program) return { status: "failed", reason: "The proposal does not say which workout." };
  deps.invalidateLibraryWorkoutPrograms();
  const held = (await deps.listLibraryWorkouts()).find((workout) => workout.id === line.program!.id);
  if (!held) return { status: "stale", reason: `"${line.program.name}" is no longer in the workout library.` };
  await deps.deleteWorkoutProgram(line.program.id);
  return { status: "applied" };
}

export function dashed(day: string): string {
  return /^\d{8}$/.test(day) ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}` : day;
}

/** What a set comes to, for the model's tool result and the card's head. */
export function scheduleChangeCounts(set: ScheduleChangeSet): Record<ScheduleChangeStatus, number> {
  const counts: Record<ScheduleChangeStatus, number> = { proposed: 0, applied: 0, failed: 0, dismissed: 0, stale: 0 };
  for (const line of set.lines) counts[line.status] += 1;
  return counts;
}
