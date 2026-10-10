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
import { formatDecimal, plural, t } from "../i18n/core";
import { planStageLabel } from "../i18n/workoutWords";

/** COROS's six stages a week of an outline may take; "Not set" is never one. */
export const OUTLINE_STAGES = COROS_WEEK_STAGES.filter((stage) => stage.value > 0).map((stage) => ({
  value: stage.value as TrainingPlanWeekStage,
  get label() {
    return planStageLabel(stage.slug);
  },
  slug: stage.slug
}));

export function outlineStageSlug(stage: number): string | undefined {
  return OUTLINE_STAGES.find((candidate) => candidate.value === stage)?.slug;
}

export function outlineStageLabel(stage: number): string {
  return OUTLINE_STAGES.find((candidate) => candidate.value === stage)?.label ?? planStageLabel("none");
}

function hoursText(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : formatDecimal(rounded, 1);
}

function rangeText(values: readonly number[], format: (value: number) => string): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? format(low) : `${format(low)}–${format(high)}`;
}

/** The outline in a line: its length, its weekly time and its weekly sessions. */
export function outlineSpan(outline: TrainingPlanOutline): string {
  const weeks = outline.weeks;
  if (!weeks.length) return t("chat.outline.noWeeks");
  return [
    plural("chat.outline.weeks", weeks.length),
    t("chat.outline.hoursAWeek", { range: rangeText(weeks.map((week) => week.hours), hoursText) }),
    t("chat.outline.sessions", { range: rangeText(weeks.map((week) => week.sessions), String) })
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

/**
 * What is sent when the athlete asks for an outline, and for a redraw. Stored
 * in English whatever the language — `isAutomaticOutlineStep` recognises the
 * outline AI Plan sends on its own by these words — and drawn through
 * `displayStepText`.
 */
export function outlineStepText(note?: string): string {
  const said = note?.trim();
  return said ? `${REDRAW_PREFIX}${said}` : DRAW_OUTLINE_TEXT;
}

const DRAW_OUTLINE_TEXT = "Draw the outline"; // i18n-ignore
const REDRAW_PREFIX = "Redraw the outline: "; // i18n-ignore

/** What is sent when the sessions are written to an outline (P2.3), stored the same way. */
export const WRITE_SESSIONS_TEXT = "Write the sessions"; // i18n-ignore

/** A pipeline step's words in the language on screen; anything else as written. */
export function displayStepText(content: string): string {
  if (content === DRAW_OUTLINE_TEXT) return t("chat.step.drawOutline");
  if (content === WRITE_SESSIONS_TEXT) return t("chat.step.writeSessions");
  if (content.startsWith(REDRAW_PREFIX)) {
    return t("chat.step.redraw", { note: content.slice(REDRAW_PREFIX.length) });
  }
  return content;
}
