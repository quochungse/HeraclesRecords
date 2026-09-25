/**
 * The AI plan generator's form, as data: what the athlete has said, the
 * request it becomes, and the lines the screen reads back to them.
 *
 * Outside the component for the reason `planEditorModel.ts` is — it is the
 * part a test can reach — and built on `trainingPlanGeneration.ts`, so the
 * summary on screen and the rules the draft tool checks count a week the
 * same way (`weekSessionBand`, `weekMinutesBand`).
 */
import type {
  TrainingPlanDayKind,
  TrainingPlanDifficulty,
  TrainingPlanGenerationDay,
  TrainingPlanGenerationRequest,
  TrainingPlanGoalKind,
  TrainingPlanDataSources,
  WorkoutSport
} from "../../electron/types";
import {
  PLAN_WEEKDAYS,
  addPlanWeeks,
  generatedPlanSpan,
  weekMinutesBand,
  weekSessionBand,
  type TrainingPlanGenerationField
} from "../../electron/trainingPlanGeneration";
import { parsePlanDay } from "../../electron/trainingPlanDomain";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";

export type GeneratorStep = "goal" | "week" | "outline" | "writing" | "done";

export const GOAL_KINDS: readonly { value: TrainingPlanGoalKind; label: string; hint: string }[] = [
  { value: "race", label: "A race or event", hint: "Plan ends on race day" },
  { value: "base", label: "Build a base", hint: "Steady, durable volume" },
  { value: "return", label: "Come back", hint: "After a break or injury" },
  { value: "hybrid", label: "Strength & hybrid", hint: "HYROX, gym and engine" },
  { value: "other", label: "Something else", hint: "Describe it yourself" }
];

export const LEVELS: readonly { value: TrainingPlanDifficulty; label: string; hint: string }[] = [
  { value: "beginner", label: "Beginner", hint: "New to structure" },
  { value: "intermediate", label: "Intermediate", hint: "Training consistently" },
  { value: "advanced", label: "Advanced", hint: "High-volume base" },
  { value: "custom", label: "From my data", hint: "Coach judges it" }
];

/** A race's distance, or none: the race's own name can say it instead. */
export const RACE_DISTANCES = ["5K", "10K", "Half", "Marathon", "Trail 50K", "Ultra 100K"] as const;

/** Hours a week the athlete may be sure of; "any" is "Not sure". */
export const HOURS_CHOICES: readonly { value: string; label: string; hours?: { min: number; max?: number } }[] = [
  { value: "any", label: "Not sure" },
  { value: "3-5", label: "3–5 h", hours: { min: 3, max: 5 } },
  { value: "5-8", label: "5–8 h", hours: { min: 5, max: 8 } },
  { value: "8-12", label: "8–12 h", hours: { min: 8, max: 12 } },
  { value: "12+", label: "12 h+", hours: { min: 12 } }
];

/** Sessions a week the athlete may be sure of; "any" is "Not sure". */
export const SESSION_CHOICES = ["any", "2", "3", "4", "5", "6", "7"] as const;

export const DAY_SHORT = PLAN_WEEKDAYS.map((day) => day.slice(0, 3));

/**
 * A day of the usual week in the form. `minutes` is the most the athlete has
 * that day — a ceiling, not a time to fill — and `null` is Free: no limit.
 */
export interface GeneratorDay {
  kind: TrainingPlanDayKind;
  minutes: number | null;
}

export interface GeneratorForm {
  goalKind: TrainingPlanGoalKind;
  goal: string;
  /** One of `RACE_DISTANCES`, or `""` when the race's name says it. */
  raceDistance: string;
  /** `YYYY-MM-DD`, or `""` until the athlete picks it. */
  raceDate: string;
  /** Whether a plan that is not a race has a length the athlete set. */
  lengthMode: "coach" | "set";
  weeks: number;
  /** Weeks after the earliest Monday allowed: the first week is always a Monday. */
  startOffset: number;
  difficulty: TrainingPlanDifficulty;
  sports: WorkoutSport[];
  weekMode: "days" | "coach";
  days: GeneratorDay[];
  hoursChoice: string;
  sessionsChoice: string;
  blockedDays: number[];
  constraints: string;
  /** What Coach may read for this plan. */
  sources: TrainingPlanDataSources;
}

/** The athlete's data, as the switches beside the form name it. */
export const SOURCES: readonly { value: keyof TrainingPlanDataSources; label: string; detail: string }[] = [
  { value: "activities", label: "Recent activities", detail: "Your training history, fitness, records and race predictions" },
  { value: "sleep", label: "Sleep & HRV", detail: "Your nights and overnight HRV" },
  { value: "zones", label: "Training zones", detail: "Your COROS thresholds and zones" }
];

export const DEFAULT_GENERATOR_FORM: GeneratorForm = {
  goalKind: "race",
  goal: "",
  raceDistance: "",
  raceDate: "",
  lengthMode: "coach",
  weeks: 8,
  startOffset: 0,
  difficulty: "custom",
  sports: ["run"],
  weekMode: "days",
  days: [
    { kind: "rest", minutes: 60 },
    { kind: "train", minutes: 60 },
    { kind: "train", minutes: 60 },
    { kind: "rest", minutes: 60 },
    { kind: "train", minutes: 60 },
    { kind: "long", minutes: 120 },
    { kind: "train", minutes: 60 }
  ],
  hoursChoice: "any",
  sessionsChoice: "any",
  blockedDays: [],
  constraints: "",
  sources: { activities: true, sleep: true, zones: true }
};

const NEXT_KIND: Record<TrainingPlanDayKind, TrainingPlanDayKind> = { rest: "train", train: "long", long: "flex", flex: "rest" };

export const DAY_KIND_LABEL: Record<TrainingPlanDayKind, string> = {
  rest: "Rest",
  train: "Train",
  long: "Long day",
  flex: "Coach picks"
};

/** The time a day starts with when it becomes this kind: an hour, two for the long day. */
export const DAY_PREFILL: Record<Exclude<TrainingPlanDayKind, "rest">, number> = { train: 60, long: 120, flex: 60 };

/** Rest → Train → Long day → Coach picks → Rest, each kind starting at its own time. */
export function cycleDay(day: GeneratorDay): GeneratorDay {
  const kind = NEXT_KIND[day.kind];
  return { kind, minutes: kind === "rest" ? day.minutes : DAY_PREFILL[kind] };
}

/** "45 min", "1 h", "1 h 30", or "Free" for a day with no limit. */
export function dayTimeLabel(minutes: number | null): string {
  if (minutes === null) return "Free";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${String(rest).padStart(2, "0")}` : `${minutes / 60} h`;
}

const DAY_TIMES = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];

/** The times a day offers, Free last; a time outside the list that the day already holds is kept in it. */
export function dayTimeOptions(current: number | null): { value: string; label: string }[] {
  const times = current === null || DAY_TIMES.includes(current) ? DAY_TIMES : [...DAY_TIMES, current].sort((a, b) => a - b);
  return [...times.map((minutes) => ({ value: String(minutes), label: dayTimeLabel(minutes) })), { value: "free", label: "Free" }];
}

export function requestDays(days: readonly GeneratorDay[]): TrainingPlanGenerationDay[] {
  return days.map((day) =>
    day.kind === "rest" ? { kind: "rest" } : day.minutes === null ? { kind: day.kind } : { kind: day.kind, minutes: day.minutes }
  );
}

/** The form as the request main receives. `firstMonday` is the earliest week the plan may start. */
export function requestFromForm(form: GeneratorForm, firstMonday: string): TrainingPlanGenerationRequest {
  const hours = HOURS_CHOICES.find((choice) => choice.value === form.hoursChoice)?.hours;
  const sessions = form.sessionsChoice === "any" ? undefined : Number(form.sessionsChoice);
  return {
    goalKind: form.goalKind,
    goal: form.goal.trim(),
    ...(form.goalKind === "race"
      ? { race: { date: form.raceDate, ...(form.raceDistance ? { distance: form.raceDistance } : {}) } }
      : {}),
    sports: form.sports,
    difficulty: form.difficulty,
    startDate: addPlanWeeks(firstMonday, form.startOffset),
    ...(form.goalKind !== "race" && form.lengthMode === "set" ? { weeks: form.weeks } : {}),
    week: form.weekMode === "days"
      ? { mode: "days", days: requestDays(form.days) }
      : {
          mode: "coach",
          ...(hours ? { hours } : {}),
          ...(sessions !== undefined ? { sessionsPerWeek: sessions } : {}),
          blockedDayIndexes: [...form.blockedDays].sort((a, b) => a - b)
        },
    ...(form.constraints.trim() ? { constraints: form.constraints.trim() } : {}),
    /* Absent means everything: only a source switched off travels. */
    ...(Object.values(form.sources).every(Boolean) ? {} : { sources: { ...form.sources } })
  };
}

/** Which step of the form a problem is fixed on. */
export const STEP_FIELDS: Record<"goal" | "week", readonly TrainingPlanGenerationField[]> = {
  goal: ["goal", "race", "sports", "difficulty", "weeks", "start"],
  week: ["days", "week", "constraints", "runtime"]
};

export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

export interface WeekSummary {
  sessions: string;
  time: string;
  longDay: string;
}

/** The usual week read back: "4–5" sessions, "up to 6.5 h", "Saturday". */
export function weekSummary(form: GeneratorForm): WeekSummary {
  if (form.weekMode === "coach") {
    const hours = HOURS_CHOICES.find((choice) => choice.value === form.hoursChoice);
    return {
      sessions: form.sessionsChoice === "any" ? "Coach decides" : form.sessionsChoice,
      time: hours?.hours ? hours.label : "Coach decides",
      longDay: "Coach decides"
    };
  }
  const days = requestDays(form.days);
  const band = weekSessionBand(days);
  const minutes = weekMinutesBand(days);
  const longDays = form.days.flatMap((day, index) => (day.kind === "long" ? [PLAN_WEEKDAYS[index]] : []));
  return {
    sessions: band.min === band.max ? String(band.min) : `${band.min}–${band.max}`,
    time: minutes.max === Number.POSITIVE_INFINITY
      ? "No limit"
      : minutes.max === 0 ? "—" : minutes.min === minutes.max ? formatHours(minutes.max) : `up to ${formatHours(minutes.max)}`,
    longDay: longDays.length ? longDays.join(", ") : "—"
  };
}

/** A plan day for the screen: "Mon, Aug 3", with the year where it helps. */
export function formatPlanDate(iso: string | undefined, withYear = false): string {
  const date = iso ? parsePlanDay(iso) : undefined;
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {})
  }).format(date);
}

/** How the plan's dates read under the goal: one sentence, whatever decides the length. */
export function spanSentence(request: TrainingPlanGenerationRequest): string {
  const span = generatedPlanSpan(request);
  if (!span) return "";
  const first = formatPlanDate(span.first);
  if (request.goalKind === "race") {
    return span.last && span.weeks
      ? `${span.weeks} weeks from ${first}, ending on race day, ${formatPlanDate(span.last, true)}.`
      : `Starts ${first}. Pick race day and the plan runs to it.`;
  }
  return span.last && span.weeks
    ? `${span.weeks} week${span.weeks === 1 ? "" : "s"}, ${first} – ${formatPlanDate(span.last, true)}.`
    : `Starts ${first}. Coach chooses how many weeks the goal needs.`;
}

/** The aside's summary of the plan, row by row. */
export function planSnapshot(form: GeneratorForm, request: TrainingPlanGenerationRequest): { label: string; value: string }[] {
  const span = generatedPlanSpan(request);
  const kind = GOAL_KINDS.find((option) => option.value === form.goalKind);
  const week = weekSummary(form);
  const goal = form.goalKind === "race"
    ? form.raceDistance || form.goal.trim() || kind?.label || "—"
    : form.goalKind === "other"
      ? form.goal.trim() || "Your own"
      : kind?.label ?? "—";
  return [
    { label: "Goal", value: goal },
    { label: "Length", value: span?.weeks ? `${span.weeks} week${span.weeks === 1 ? "" : "s"}` : form.goalKind === "race" ? "To race day" : "Coach decides" },
    { label: "Dates", value: span?.last ? `${formatPlanDate(span.first)} – ${formatPlanDate(span.last, true)}` : `From ${formatPlanDate(span?.first)}` },
    { label: "Week", value: form.weekMode === "coach" ? "Coach decides" : `${week.sessions} sessions · ${week.time}` },
    { label: "Sports", value: form.sports.length ? form.sports.map(formatWorkoutSport).join(", ") : "—" },
    { label: "Level", value: LEVELS.find((level) => level.value === form.difficulty)?.label ?? "—" }
  ];
}

/** A plan day some days from another, as `YYYY-MM-DD`. */
export function addPlanDays(iso: string, days: number): string {
  const date = parsePlanDay(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * What an outline was drawn for: the request as the athlete stated it, without
 * the AI that read it. An outline whose request has since changed is stale —
 * it answers a question nobody is asking any more.
 */
export function outlineKey(request: TrainingPlanGenerationRequest): string {
  const { runtime: _runtime, outline: _outline, ...asked } = request;
  return JSON.stringify(asked);
}

/** Race day as the picker holds it (`yyyyMMdd`) and as the request states it (`YYYY-MM-DD`). */
export function raceDayKey(iso: string): string {
  return iso.replaceAll("-", "");
}

export function raceDayIso(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}
