/**
 * What changed between two versions of a plan, as lines a person or the
 * coach can read (docs/coach-plan-canvas.md, P1.4). One module for the
 * canvas's Versions tab, the folded line of an older version, a `planEvent`
 * and a tool's answer, so the four never describe one change two ways.
 *
 * Sessions are matched by the key the coach gave them — the key a revision
 * keeps — and only then by the entry's own id. Pure, and free of `node:`
 * imports: the renderer imports it directly, like `activityMetrics.ts`.
 */
import { COROS_WEEK_STAGES } from "./trainingPlanDomain";
import type { PlanWorkoutEntryInput, TrainingPlanDocument, TrainingPlanEntry } from "./types";

export type PlanChangeKind =
  | "renamed"
  | "description"
  | "added"
  | "removed"
  | "moved"
  | "changed"
  | "stage";

export interface PlanChange {
  kind: PlanChangeKind;
  /** The session's key, for a change to one session. */
  key?: string;
  text: string;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function where(entry: TrainingPlanEntry): string {
  return `week ${entry.weekIndex + 1} ${DAY_NAMES[entry.dayIndex] ?? ""}`.trim();
}

function nameOf(entry: TrainingPlanEntry): string {
  return entry.workout.name || entry.title || "a session";
}

function identity(entry: TrainingPlanEntry): string {
  return entry.workout.key || entry.id;
}

/** JSON with its keys sorted, so two copies of one workout compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A workout, without what only places it. */
function workoutContent(workout: PlanWorkoutEntryInput): string {
  const {
    key: _key,
    schedule_date: _date,
    sort_no: _sortNo,
    save_to_library: _library,
    ...rest
  } = workout;
  return canonical(rest);
}

function content(entry: TrainingPlanEntry): string {
  return workoutContent(entry.workout);
}

/**
 * Whether two workouts are the same, wherever each is placed. Both must be
 * in one form: a workout read back from a COROS program is rebuilt from it,
 * and never equals the one it was written from.
 */
export function sameWorkoutInput(left: PlanWorkoutEntryInput, right: PlanWorkoutEntryInput): boolean {
  return workoutContent(left) === workoutContent(right);
}

function stageLabel(value: number | undefined): string {
  return COROS_WEEK_STAGES.find((stage) => stage.value === (value ?? 0))?.label ?? "Not Set";
}

/**
 * Every difference from `before` to `after`, in the order a reader takes a
 * plan in: its name and overview, then session by session in `after`'s
 * order, the removed ones after, then the week stages.
 */
export function planDiff(before: TrainingPlanDocument, after: TrainingPlanDocument): PlanChange[] {
  const changes: PlanChange[] = [];
  if (before.name.trim() !== after.name.trim()) {
    changes.push({ kind: "renamed", text: `Renamed to "${after.name.trim()}"` });
  }
  if ((before.description ?? "").trim() !== (after.description ?? "").trim()) {
    changes.push({ kind: "description", text: "Overview rewritten" });
  }

  const earlier = new Map(before.entries.map((entry) => [identity(entry), entry]));
  const later = new Set(after.entries.map(identity));
  const ordered = [...after.entries].sort(
    (left, right) =>
      left.weekIndex - right.weekIndex || left.dayIndex - right.dayIndex || left.sortOrder - right.sortOrder
  );
  for (const entry of ordered) {
    const key = identity(entry);
    const previous = earlier.get(key);
    if (!previous) {
      changes.push({ kind: "added", key, text: `Added ${nameOf(entry)} (${where(entry)})` });
      continue;
    }
    const moved = previous.weekIndex !== entry.weekIndex || previous.dayIndex !== entry.dayIndex;
    const changed = content(previous) !== content(entry);
    if (moved) {
      changes.push({
        kind: "moved",
        key,
        text: `Moved ${nameOf(entry)}: ${where(previous)} → ${where(entry)}`
      });
    }
    if (changed) {
      const renamed = nameOf(previous) !== nameOf(entry);
      changes.push({
        kind: "changed",
        key,
        text: renamed ? `${nameOf(previous)} is now ${nameOf(entry)}` : `Changed ${nameOf(entry)}`
      });
    }
  }
  for (const entry of before.entries) {
    if (!later.has(identity(entry))) {
      changes.push({ kind: "removed", key: identity(entry), text: `Removed ${nameOf(entry)} (${where(entry)})` });
    }
  }

  const stageOf = (document: TrainingPlanDocument) =>
    new Map(document.weekStages.map((item) => [item.weekIndex, item.stage as number]));
  const stagesBefore = stageOf(before);
  const stagesAfter = stageOf(after);
  const weeks = [...new Set([...stagesBefore.keys(), ...stagesAfter.keys()])].sort((a, b) => a - b);
  for (const week of weeks) {
    const from = stagesBefore.get(week) ?? 0;
    const to = stagesAfter.get(week) ?? 0;
    if (from !== to) {
      changes.push({ kind: "stage", text: `Week ${week + 1}: ${stageLabel(from)} → ${stageLabel(to)}` });
    }
  }
  return changes;
}

/** "3 changes", for a line that has no room for them. */
export function changeCount(changes: readonly PlanChange[]): string {
  return changes.length === 1 ? "1 change" : `${changes.length} changes`;
}
