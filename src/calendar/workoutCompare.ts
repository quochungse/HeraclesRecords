/**
 * Two workouts set against each other: what a proposed change would make of
 * the session it acts on, and what a later proposal makes of an earlier one.
 *
 * Compared as they are drawn, not as they are stored: both sides go through
 * `buildEditorDraftView`, the one reading of a step every workout view shares,
 * so a difference here is a difference the athlete would see between the two
 * views — and a field written two ways that reads the same is no difference.
 */
import type {
  PlanWorkoutEntryInput,
  RunWorkoutEditorDraft,
  UnitSystem,
  WorkoutEditorContext
} from "../../electron/types";
import { editorDraftToPlanWorkoutInput, planWorkoutInputToEditorDraft } from "../../electron/planWorkoutEditor";
import { markFigure, statedWorkoutFigures } from "../../electron/workoutFigures";
import { POUNDS_PER_KILOGRAM, formatWeightValue } from "../units/units";
import { isStrengthStyleWorkout, workoutSportLabel } from "../training/workoutSport";
import { messageRecord, t } from "../i18n/core";
import {
  buildEditorDraftView,
  formatStepDistanceLabel,
  formatStepTimeLabel,
  liftRestLabel,
  liftSchemeLabel,
  type ScheduledStepKind,
  type ScheduledStepView,
  type ScheduledStructureView
} from "./scheduledStructure";

export type CompareStatus = "same" | "changed" | "added" | "removed";

/** One step, or a repeat's head, as a comparison states it. */
export interface CompareCell {
  kind: ScheduledStepKind | "repeat";
  title: string;
  /** A movement step's own name, under the movement. */
  label?: string;
  /** What it asks for, slot by slot: the amount, the intensity or load, the rest after. */
  parts: [string | undefined, string | undefined, string | undefined];
}

export interface CompareRow {
  status: CompareStatus;
  /** A step of a repeat. */
  nested: boolean;
  before?: CompareCell;
  after?: CompareCell;
}

export type CompareField = "name" | "sport" | "description" | "distance" | "duration";

export interface WorkoutComparison {
  /** What differs about the workout as a whole. */
  fields: { field: CompareField; from?: string; to?: string }[];
  /** Every step of either side, in order, matched where it can be. */
  rows: CompareRow[];
  /** Whether anything differs at all. */
  differs: boolean;
}

/** A step's kind as the structure view's legend names it. */
const KIND_LABEL = messageRecord<ScheduledStepKind>({
  warmup: "workout.kind.warmup",
  training: "workout.view.main",
  rest: "workout.kind.rest",
  cooldown: "workout.kind.cooldown",
  sendOff: "workout.kind.sendOff"
});

function stepCell(step: ScheduledStepView, unitSystem: UnitSystem): CompareCell {
  const load =
    step.weight !== undefined
      ? formatWeightValue(step.weightUnit === "lb" ? step.weight / POUNDS_PER_KILOGRAM : step.weight, unitSystem, 1)
      : step.intensityLabel;
  return {
    kind: step.kind,
    // A plan step nobody named carries its bare kind ("warmup"): said as the kind is drawn.
    title: step.name.trim().toLowerCase() === step.kind.toLowerCase() ? KIND_LABEL[step.kind] : step.name,
    ...(step.label ? { label: step.label } : {}),
    parts: [liftSchemeLabel(step), load || undefined, liftRestLabel(step)]
  };
}

type FlatRow = { cell: CompareCell; nested: boolean; signature: string };

function flatten(view: ScheduledStructureView, unitSystem: UnitSystem): FlatRow[] {
  const rows: FlatRow[] = [];
  const push = (cell: CompareCell, nested: boolean) =>
    rows.push({ cell, nested, signature: JSON.stringify([nested, cell.kind, cell.title, cell.label ?? "", cell.parts]) });
  for (const node of view.nodes) {
    if (node.type === "step") {
      push(stepCell(node.step, unitSystem), false);
      continue;
    }
    push({ kind: "repeat", title: t("workout.view.repeat", { n: node.repeat }), parts: [undefined, undefined, undefined] }, false);
    for (const step of node.steps) push(stepCell(step, unitSystem), true);
  }
  return rows;
}

/** The longest run of rows both sides hold in the same order, as index pairs. */
function commonRows(before: FlatRow[], after: FlatRow[]): [number, number][] {
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left][right] =
        before[left].signature === after[right].signature
          ? table[left + 1][right + 1] + 1
          : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left].signature === after[right].signature) {
      pairs.push([left, right]);
      left += 1;
      right += 1;
    } else if (table[left + 1][right] >= table[left][right + 1]) left += 1;
    else right += 1;
  }
  return pairs;
}

/** Two rows that can be one changed row: both steps or both repeat heads, at one depth. */
function pairable(before: FlatRow, after: FlatRow): boolean {
  return before.nested === after.nested && (before.cell.kind === "repeat") === (after.cell.kind === "repeat");
}

function alignRows(before: FlatRow[], after: FlatRow[]): CompareRow[] {
  const rows: CompareRow[] = [];
  const between = (lefts: FlatRow[], rights: FlatRow[]) => {
    let left = 0;
    let right = 0;
    while (left < lefts.length || right < rights.length) {
      const was = lefts[left];
      const now = rights[right];
      if (was && now && pairable(was, now)) {
        rows.push({ status: "changed", nested: now.nested, before: was.cell, after: now.cell });
        left += 1;
        right += 1;
      } else if (was && (!now || lefts.length - left >= rights.length - right)) {
        rows.push({ status: "removed", nested: was.nested, before: was.cell });
        left += 1;
      } else {
        rows.push({ status: "added", nested: now.nested, after: now.cell });
        right += 1;
      }
    }
  };
  let left = 0;
  let right = 0;
  for (const [nextLeft, nextRight] of [...commonRows(before, after), [before.length, after.length] as [number, number]]) {
    between(before.slice(left, nextLeft), after.slice(right, nextRight));
    if (nextLeft < before.length) {
      rows.push({ status: "same", nested: before[nextLeft].nested, before: before[nextLeft].cell, after: after[nextRight].cell });
    }
    left = nextLeft + 1;
    right = nextRight + 1;
  }
  return rows;
}

function sessionFigures(
  draft: RunWorkoutEditorDraft,
  unitSystem: UnitSystem,
  context: WorkoutEditorContext | undefined
): { distance?: string; duration?: string } {
  if (isStrengthStyleWorkout(draft.sport)) return {};
  try {
    const figures = statedWorkoutFigures(
      editorDraftToPlanWorkoutInput(draft, { key: "compare", name: draft.name, sport: draft.sport }),
      { context }
    );
    // A figure waiting for the account's thresholds is not yet a figure to set against another.
    const known = (awaits: boolean) => Boolean(context) || !awaits;
    return {
      ...(figures.distanceMeters && known(figures.distanceAwaits)
        ? { distance: markFigure(formatStepDistanceLabel(figures.distanceMeters, unitSystem, draft.sport === "swim"), figures.distanceMark, "number") }
        : {}),
      ...(figures.durationSeconds && known(figures.durationAwaits)
        ? { duration: markFigure(formatStepTimeLabel(figures.durationSeconds), figures.durationMark, "end") }
        : {})
    };
  } catch {
    return {};
  }
}

export interface CompareOptions {
  unitSystem: UnitSystem;
  /** The COROS exercise catalog, which names a strength step read from COROS. */
  exercises?: ReadonlyMap<string, { name: string }>;
  /** The account's context: without it a session's distance and time are stated only where its steps write them. */
  context?: WorkoutEditorContext;
}

export function compareWorkoutDrafts(
  before: RunWorkoutEditorDraft,
  after: RunWorkoutEditorDraft,
  { unitSystem, exercises, context }: CompareOptions
): WorkoutComparison {
  const fields: WorkoutComparison["fields"] = [];
  const field = (name: CompareField, from: string | undefined, to: string | undefined) => {
    if ((from ?? "") !== (to ?? "")) fields.push({ field: name, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  };
  field("name", before.name.trim(), after.name.trim());
  if (before.sport !== after.sport) field("sport", workoutSportLabel(before.sport), workoutSportLabel(after.sport));
  const was = sessionFigures(before, unitSystem, context);
  const now = sessionFigures(after, unitSystem, context);
  field("distance", was.distance, now.distance);
  field("duration", was.duration, now.duration);
  field("description", before.overview.trim(), after.overview.trim());
  const rows = alignRows(
    flatten(buildEditorDraftView(before, unitSystem, exercises), unitSystem),
    flatten(buildEditorDraftView(after, unitSystem, exercises), unitSystem)
  );
  return { fields, rows, differs: fields.length > 0 || rows.some((row) => row.status !== "same") };
}

/** The same, for two workouts held as plan inputs; nothing when either will not read. */
export function compareWorkoutInputs(
  before: PlanWorkoutEntryInput,
  after: PlanWorkoutEntryInput,
  options: CompareOptions
): WorkoutComparison | undefined {
  try {
    return compareWorkoutDrafts(planWorkoutInputToEditorDraft(before), planWorkoutInputToEditorDraft(after), options);
  } catch {
    return undefined;
  }
}

/** A difference in one line: what it is about, what it was, what it becomes. */
export interface CompareLine {
  status: Exclude<CompareStatus, "same">;
  /** The field, or the step; absent where the step itself is what changed. */
  name?: string;
  from?: string;
  to?: string;
}

const FIELD_LABEL = messageRecord<CompareField>({
  name: "workout.b.w.name",
  sport: "workout.b.w.sport",
  description: "workout.b.w.description",
  distance: "workout.v.distance",
  duration: "workout.v.duration"
});

export function compareFieldLabel(field: CompareField): string {
  return FIELD_LABEL[field];
}

/** A cell in words: its title and what it asks for. */
function cellText(cell: CompareCell, withTitle = true): string {
  return [withTitle ? cell.title : undefined, ...cell.parts].filter(Boolean).join(" · ");
}

/**
 * Every difference as a line, the workout's own fields first, then its steps
 * in order. A step that kept its title states only the slots that changed.
 */
export function comparisonLines(comparison: WorkoutComparison): CompareLine[] {
  const lines: CompareLine[] = comparison.fields.map(({ field, from, to }) => ({
    status: !from ? "added" : !to ? "removed" : "changed",
    name: compareFieldLabel(field),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  }));
  for (const row of comparison.rows) {
    if (row.status === "same") continue;
    if (row.status === "added" && row.after) {
      lines.push({ status: "added", name: row.after.title, to: cellText(row.after, false) || undefined });
    } else if (row.status === "removed" && row.before) {
      lines.push({ status: "removed", name: row.before.title, from: cellText(row.before, false) || undefined });
    } else if (row.before && row.after) {
      const sameTitle = row.before.title === row.after.title && row.before.kind !== "repeat";
      if (!sameTitle) {
        lines.push({ status: "changed", from: cellText(row.before), to: cellText(row.after) });
        continue;
      }
      const { before, after } = row;
      const slots = before.parts.map((part, index) => part !== after.parts[index]);
      // What it asks for, where that changed; else the name it was given; else only its kind did.
      const said = (cell: CompareCell) =>
        slots.some(Boolean)
          ? cell.parts.filter((part, index) => slots[index] && part).join(" · ")
          : before.label !== after.label
            ? cell.label
            : cell.kind === "repeat" ? undefined : KIND_LABEL[cell.kind];
      lines.push({ status: "changed", name: after.title, from: said(before) || "—", to: said(after) || "—" });
    }
  }
  return lines;
}
