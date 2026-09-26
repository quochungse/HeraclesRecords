/**
 * A brief's outline in the conversation (docs/coach-plan-canvas.md, P2.2):
 * the arithmetic its card and its Adjust screen share, outside the components
 * so a test can reach it.
 *
 * The checks are the outline tool's own (`planOutlineProblems`), so what the
 * Adjust screen refuses is exactly what Coach would have been handed back.
 */
import type {
  PlanBrief,
  TrainingPlanOutline,
  TrainingPlanOutlineWeek,
  TrainingPlanWeekStage
} from "../../electron/types";
import { COROS_WEEK_STAGES } from "../../electron/trainingPlanDomain";
import { addPlanWeeks, planOutlineProblems } from "../../electron/trainingPlanGeneration";

/** COROS's six stages a week of an outline may take; "Not set" is never one. */
export const OUTLINE_STAGES = COROS_WEEK_STAGES.filter((stage) => stage.value > 0).map((stage) => ({
  value: stage.value as TrainingPlanWeekStage,
  label: stage.label,
  slug: stage.slug
}));

export function outlineStageSlug(stage: number): string | undefined {
  return OUTLINE_STAGES.find((candidate) => candidate.value === stage)?.slug;
}

export function outlineStageLabel(stage: number): string {
  return OUTLINE_STAGES.find((candidate) => candidate.value === stage)?.label ?? "Not set";
}

function hoursText(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function rangeText(values: readonly number[], format: (value: number) => string): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? format(low) : `${format(low)}–${format(high)}`;
}

/** The outline in a line: its length, its weekly time and its weekly sessions. */
export function outlineSpan(outline: TrainingPlanOutline): string {
  const weeks = outline.weeks;
  if (!weeks.length) return "No weeks";
  return [
    `${weeks.length} week${weeks.length === 1 ? "" : "s"}`,
    `${rangeText(weeks.map((week) => week.hours), hoursText)} h a week`,
    `${rangeText(weeks.map((week) => week.sessions), String)} sessions`
  ].join(" · ");
}

/**
 * Consecutive weeks in one stage as one band segment, starting and spanning
 * in week columns, so an edge falls between two weeks as on the reader's ridge.
 */
export function outlineStageBands(
  outline: TrainingPlanOutline
): { stage: TrainingPlanWeekStage; start: number; span: number }[] {
  const bands: { stage: TrainingPlanWeekStage; start: number; span: number }[] = [];
  outline.weeks.forEach((week, index) => {
    const last = bands[bands.length - 1];
    if (last && last.stage === week.stage) last.span += 1;
    else bands.push({ stage: week.stage, start: index, span: 1 });
  });
  return bands;
}

/** The Monday a week of the outline starts on. */
export function outlineWeekMonday(brief: PlanBrief, weekIndex: number): string {
  return addPlanWeeks(brief.request.startDate, weekIndex);
}

/**
 * The anchor each artifact's outline card is drawn at: its latest. The
 * artifact keeps one outline, so an earlier anchor — an outline since
 * redrawn — has nothing of its own to draw and folds to a line; an
 * adjustment writes no anchor, and the latest card shows it.
 */
export function latestOutlineAnchors(
  entries: readonly { kind: string; artifactId?: string }[]
): Map<string, number> {
  const latest = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.kind === "planOutline" && entry.artifactId) latest.set(entry.artifactId, index);
  });
  return latest;
}

/** Where an outline breaks its brief, in the sentences the outline tool hands Coach. */
export function outlineProblems(outline: TrainingPlanOutline, brief: PlanBrief): string[] {
  return planOutlineProblems(outline, brief.request);
}

/** The editable parts of a week: what Adjust outline changes, and nothing else. */
export type OutlineWeekPatch = Partial<Pick<TrainingPlanOutlineWeek, "stage" | "lighter" | "hours" | "sessions">>;

/** The outline with one week changed; a figure that is not a figure leaves the week as it was. */
export function withOutlineWeek(
  outline: TrainingPlanOutline,
  weekIndex: number,
  patch: OutlineWeekPatch
): TrainingPlanOutline {
  const clean: OutlineWeekPatch = { ...patch };
  if (clean.hours !== undefined) {
    if (!Number.isFinite(clean.hours) || clean.hours < 0) delete clean.hours;
    else clean.hours = Math.round(clean.hours * 10) / 10;
  }
  if (clean.sessions !== undefined && (!Number.isInteger(clean.sessions) || clean.sessions < 0)) delete clean.sessions;
  return {
    ...outline,
    weeks: outline.weeks.map((week, index) => (index === weekIndex ? { ...week, ...clean } : week))
  };
}

/** Whether an adjustment changed anything worth saving as a new outline version. */
export function outlineChanged(before: TrainingPlanOutline, after: TrainingPlanOutline): boolean {
  return JSON.stringify(before.weeks) !== JSON.stringify(after.weeks);
}

/** What the athlete sees sent when they ask for an outline, and for a redraw. */
export function outlineStepText(note?: string): string {
  const said = note?.trim();
  return said ? `Redraw the outline: ${said}` : "Draw the outline";
}
