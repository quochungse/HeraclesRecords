/**
 * A plan brief as the screen reads it (docs/coach-plan-canvas.md, P2.1): the
 * brief's request turned into the generator's form, so the brief is edited by
 * the generator's own Goal and Your week steps, and back; and the card's rows,
 * which are the generator's snapshot rows marked with where Coach took each.
 *
 * Outside the components for the reason `planGeneratorModel.ts` is: it is the
 * part a test can reach.
 */
import type {
  PlanBrief,
  PlanBriefField,
  PlanBriefOrigin,
  PlanBriefRequest,
  TrainingPlanDataSources,
  TrainingPlanGenerationRequest
} from "../../electron/types";
import { generationRequestProblems } from "../../electron/trainingPlanGeneration";
import { parsePlanDay } from "../../electron/trainingPlanDomain";
import {
  DEFAULT_GENERATOR_FORM,
  GOAL_KINDS,
  HOURS_CHOICES,
  SESSION_CHOICES,
  planSnapshot,
  requestFromForm,
  spanSentence,
  type GeneratorDay,
  type GeneratorForm
} from "../training-library/planGeneratorModel";

const EVERYTHING: TrainingPlanDataSources = { activities: true, sleep: true, zones: true };

function weeksBetween(fromMonday: string, toMonday: string): number {
  const from = parsePlanDay(fromMonday);
  const to = parsePlanDay(toMonday);
  if (!from || !to) return 0;
  return Math.round((to.valueOf() - from.valueOf()) / (7 * 86_400_000));
}

/**
 * The hours choice a band reads as. The form offers four bands; one Coach
 * stated that is none of them reads as the band it starts in, which is the
 * nearest thing the form can say — the brief keeps Coach's own band until the
 * athlete saves the form.
 */
function hoursChoiceOf(hours: { min: number; max?: number } | undefined): string {
  if (!hours) return "any";
  const exact = HOURS_CHOICES.find(
    (choice) => choice.hours && choice.hours.min === hours.min && choice.hours.max === hours.max
  );
  if (exact) return exact.value;
  const within = [...HOURS_CHOICES].reverse().find((choice) => choice.hours && choice.hours.min <= hours.min);
  return within?.value ?? "any";
}

/**
 * A brief as the generator's form. `firstMonday` is the earliest week the plan
 * may start on today; a brief set out for a week since begun starts there.
 */
export function formFromBrief(
  request: PlanBriefRequest,
  firstMonday: string,
  sources: TrainingPlanDataSources = EVERYTHING
): GeneratorForm {
  const week = request.week;
  const days: GeneratorDay[] =
    week.mode === "days" && week.days.length === 7
      ? week.days.map((day) =>
          day.kind === "rest" ? { kind: "rest", minutes: 60 } : { kind: day.kind, minutes: day.minutes ?? null }
        )
      : DEFAULT_GENERATOR_FORM.days.map((day) => ({ ...day }));
  const sessions = week.mode === "coach" ? week.sessionsPerWeek : undefined;
  return {
    goalKind: request.goalKind,
    goal: request.goal ?? "",
    raceDistance: request.race?.distance ?? "",
    raceDate: request.race?.date ?? "",
    lengthMode: request.goalKind !== "race" && request.weeks !== undefined ? "set" : "coach",
    weeks: request.weeks ?? DEFAULT_GENERATOR_FORM.weeks,
    startOffset: Math.max(0, weeksBetween(firstMonday, request.startDate)),
    difficulty: request.difficulty,
    sports: [...request.sports],
    weekMode: week.mode,
    days,
    hoursChoice: week.mode === "coach" ? hoursChoiceOf(week.hours) : "any",
    sessionsChoice:
      sessions === undefined
        ? "any"
        : (SESSION_CHOICES as readonly string[]).includes(String(sessions))
          ? String(sessions)
          : SESSION_CHOICES[SESSION_CHOICES.length - 1],
    blockedDays: week.mode === "coach" ? [...week.blockedDayIndexes] : [],
    constraints: request.constraints ?? "",
    sources
  };
}

/** The form back as a brief: the generator's request without what the conversation owns. */
export function briefFromForm(form: GeneratorForm, firstMonday: string): PlanBriefRequest {
  const { sources: _sources, runtime: _runtime, outline: _outline, ...brief } = requestFromForm(form, firstMonday);
  return brief;
}

/** The brief as the generator's rules read it, with the conversation's sources. */
export function briefAsRequest(
  request: PlanBriefRequest,
  sources: TrainingPlanDataSources | undefined
): TrainingPlanGenerationRequest {
  return sources && !Object.values(sources).every(Boolean) ? { ...request, sources } : request;
}

/** What still stands between the brief and an outline, today. */
export function briefOpenProblems(
  request: PlanBriefRequest,
  sources: TrainingPlanDataSources | undefined,
  today = new Date()
): string[] {
  return generationRequestProblems(briefAsRequest(request, sources), today).map((problem) => problem.message);
}

/** The card's title: the race or goal in the athlete's words where there are some. */
export function briefTitle(request: PlanBriefRequest): string {
  const kind = GOAL_KINDS.find((option) => option.value === request.goalKind);
  if (request.goalKind === "race") {
    return request.goal.trim() || (request.race?.distance ? `${request.race.distance} race` : "A race");
  }
  if (request.goalKind === "other") return request.goal.trim() || "Your own goal";
  return request.goal.trim() ? `${kind?.label ?? "Plan"} · ${request.goal.trim()}` : kind?.label ?? "Plan";
}

/** Which of the brief's fields a snapshot row shows. */
const ROW_FIELDS: Record<string, PlanBriefField> = {
  Goal: "goal",
  Length: "dates",
  Dates: "dates",
  Week: "week",
  Sports: "sports",
  Level: "level"
};

export interface BriefRow {
  label: string;
  value: string;
  origin?: PlanBriefOrigin;
}

/**
 * The card's rows: the generator's own snapshot of the plan, each marked with
 * where Coach took it from — a row with no mark is the form's default, which
 * nobody has said anything about yet.
 */
export function briefRows(brief: Pick<PlanBrief, "request" | "origins">, firstMonday: string): BriefRow[] {
  const form = formFromBrief(brief.request, firstMonday);
  const rows = planSnapshot(form, brief.request).map((row) => {
    const origin = brief.origins[ROW_FIELDS[row.label]!];
    return origin ? { ...row, origin } : row;
  });
  const constraints = brief.request.constraints?.trim();
  return constraints
    ? [...rows, { label: "Notes", value: constraints, ...(brief.origins.constraints ? { origin: brief.origins.constraints } : {}) }]
    : rows;
}

/** The dates in a sentence, as the generator says them under the goal. */
export function briefSpan(request: PlanBriefRequest): string {
  return spanSentence(request);
}

export const BRIEF_ORIGIN_LABEL: Record<PlanBriefOrigin, string> = {
  chat: "from chat",
  data: "from your data"
};
