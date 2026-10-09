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
  addPlanWeeks,
  generatedPlanSpan,
  weekMinutesBand,
  weekSessionBand,
  type TrainingPlanGenerationField
} from "../../electron/trainingPlanGeneration";
import { parsePlanDay } from "../../electron/trainingPlanDomain";

import { workoutSportLabel } from "../training/workoutSport";
import { formatDecimal, getIntlLocale, messageRecord, plural, t, weekdayNames, type MessageKey } from "../i18n/core";
/** An option whose words are read in the language on screen each time. */
function worded<V extends string>(value: V, label: MessageKey, hint: MessageKey) {
  return {
    value,
    get label() {
      return t(label);
    },
    get hint() {
      return t(hint);
    }
  };
}

export const GOAL_KINDS: readonly { value: TrainingPlanGoalKind; readonly label: string; readonly hint: string }[] = [
  worded("race", "library.goal.race", "library.goal.race.hint"),
  worded("base", "library.goal.base", "library.goal.base.hint"),
  worded("return", "library.goal.return", "library.goal.return.hint"),
  worded("hybrid", "library.goal.hybrid", "library.goal.hybrid.hint"),
  worded("other", "library.goal.other", "library.goal.other.hint")
];

export const LEVELS: readonly { value: TrainingPlanDifficulty; readonly label: string; readonly hint: string }[] = [
  worded("beginner", "library.level.beginner", "library.level.beginner.hint"),
  worded("intermediate", "library.level.intermediate", "library.level.intermediate.hint"),
  worded("advanced", "library.level.advanced", "library.level.advanced.hint"),
  worded("custom", "library.level.custom", "library.level.custom.hint")
];

/** A race's distance, or none: the race's own name can say it instead. */
export const RACE_DISTANCES = ["5K", "10K", "Half", "Marathon", "Trail 50K", "Ultra 100K"] as const; // i18n-ignore: values Coach reads

const RACE_DISTANCE_KEYS: Readonly<Record<(typeof RACE_DISTANCES)[number], MessageKey>> = {
  "5K": "library.race.5k",
  "10K": "library.race.10k",
  Half: "library.race.half",
  Marathon: "library.race.marathon",
  "Trail 50K": "library.race.trail50", // i18n-ignore: a lookup key
  "Ultra 100K": "library.race.ultra100" // i18n-ignore: a lookup key
};

/** A race distance as the screen names it; the value Coach reads stays as it is. */
export function raceDistanceLabel(distance: string): string {
  const key = RACE_DISTANCE_KEYS[distance as (typeof RACE_DISTANCES)[number]];
  return key ? t(key) : distance;
}

/** Hours a week the athlete may be sure of; "any" is "Not sure". */
function hoursChoice(value: string, hours?: { min: number; max?: number }) {
  return {
    value,
    get label() {
      return !hours
        ? t("library.notSure")
        : hours.max === undefined
          ? t("library.hoursPlus", { n: hours.min })
          : t("library.hoursRange", { low: hours.min, high: hours.max });
    },
    ...(hours ? { hours } : {})
  };
}

export const HOURS_CHOICES: readonly { value: string; readonly label: string; hours?: { min: number; max?: number } }[] = [
  hoursChoice("any"),
  hoursChoice("3-5", { min: 3, max: 5 }),
  hoursChoice("5-8", { min: 5, max: 8 }),
  hoursChoice("8-12", { min: 8, max: 12 }),
  hoursChoice("12+", { min: 12 })
];

/** Sessions a week the athlete may be sure of; "any" is "Not sure". */
export const SESSION_CHOICES = ["any", "2", "3", "4", "5", "6", "7"] as const;

/** Monday first, in the language on screen. Read while drawing, never kept. */
export function dayShortNames(): string[] {
  return weekdayNames("short");
}

/** Monday first, the whole name, in the language on screen. */
export function dayLongNames(): string[] {
  return weekdayNames("long");
}

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
function source(value: keyof TrainingPlanDataSources, label: MessageKey, detail: MessageKey) {
  return {
    value,
    get label() {
      return t(label);
    },
    get detail() {
      return t(detail);
    }
  };
}

export const SOURCES: readonly { value: keyof TrainingPlanDataSources; readonly label: string; readonly detail: string }[] = [
  source("activities", "library.source.activities", "library.source.activities.detail"),
  source("sleep", "library.source.sleep", "library.source.sleep.detail"),
  source("zones", "library.source.zones", "library.source.zones.detail")
];

/**
 * Said under the switches once one is off: `toolReadsWithheldSource` then
 * takes every MCP server but COROS out of the turn, and a Strava connection
 * that vanished with no word would read as broken.
 */
export function otherServersWithheldNote(): string {
  return t("library.otherServers");
}

export function anySourceWithheld(sources: TrainingPlanDataSources): boolean {
  return SOURCES.some((source) => sources[source.value] === false);
}

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

export const DAY_KIND_LABEL: Readonly<Record<TrainingPlanDayKind, string>> = messageRecord({
  rest: "library.day.rest",
  train: "library.day.train",
  long: "library.day.long",
  flex: "library.day.flex"
});

/** The time a day starts with when it becomes this kind: an hour, two for the long day. */
export const DAY_PREFILL: Record<Exclude<TrainingPlanDayKind, "rest">, number> = { train: 60, long: 120, flex: 60 };

/** Rest → Train → Long day → Coach picks → Rest, each kind starting at its own time. */
export function cycleDay(day: GeneratorDay): GeneratorDay {
  const kind = NEXT_KIND[day.kind];
  return { kind, minutes: kind === "rest" ? day.minutes : DAY_PREFILL[kind] };
}

/** "45 min", "1 h", "1 h 30", or "Free" for a day with no limit. */
export function dayTimeLabel(minutes: number | null): string {
  if (minutes === null) return t("library.free");
  if (minutes < 60) return t("units.min", { m: minutes });
  const rest = minutes % 60;
  return rest
    ? t("library.hm", { h: Math.floor(minutes / 60), m: String(rest).padStart(2, "0") })
    : t("library.h", { h: minutes / 60 });
}

const DAY_TIMES = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];

/** The times a day offers, Free last; a time outside the list that the day already holds is kept in it. */
export function dayTimeOptions(current: number | null): { value: string; label: string }[] {
  const times = current === null || DAY_TIMES.includes(current) ? DAY_TIMES : [...DAY_TIMES, current].sort((a, b) => a - b);
  return [...times.map((minutes) => ({ value: String(minutes), label: dayTimeLabel(minutes) })), { value: "free", label: t("library.free") }];
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
  return t("library.h", { h: Number.isInteger(hours) ? hours : formatDecimal(hours, 1) });
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
      sessions: form.sessionsChoice === "any" ? t("library.coachDecides") : form.sessionsChoice,
      time: hours?.hours ? hours.label : t("library.coachDecides"),
      longDay: t("library.coachDecides")
    };
  }
  const days = requestDays(form.days);
  const band = weekSessionBand(days);
  const minutes = weekMinutesBand(days);
  const names = dayLongNames();
  const longDays = form.days.flatMap((day, index) => (day.kind === "long" ? [names[index]] : []));
  return {
    sessions: band.min === band.max ? String(band.min) : `${band.min}–${band.max}`,
    time: minutes.max === Number.POSITIVE_INFINITY
      ? t("library.noLimit")
      : minutes.max === 0 ? "—" : minutes.min === minutes.max ? formatHours(minutes.max) : t("library.upTo", { time: formatHours(minutes.max) }),
    longDay: longDays.length ? longDays.join(", ") : "—"
  };
}

/** A plan day for the screen: "Mon, Aug 3", with the year where it helps. */
export function formatPlanDate(iso: string | undefined, withYear = false): string {
  const date = iso ? parsePlanDay(iso) : undefined;
  if (!date) return "—";
  return new Intl.DateTimeFormat(getIntlLocale(), {
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
      ? t("library.span.race", { weeks: span.weeks, first, last: formatPlanDate(span.last, true) })
      : t("library.span.raceOpen", { first });
  }
  return span.last && span.weeks
    ? plural("library.span.weeks", span.weeks, { first, last: formatPlanDate(span.last, true) })
    : t("library.span.open", { first });
}

/** The aside's summary of the plan, row by row. */
export type PlanSnapshotKey = "goal" | "length" | "dates" | "week" | "sports" | "level";

/** The plan in six rows; `key` names a row whatever the language its label is in. */
export function planSnapshot(form: GeneratorForm, request: TrainingPlanGenerationRequest): { key: PlanSnapshotKey; label: string; value: string }[] {
  const span = generatedPlanSpan(request);
  const kind = GOAL_KINDS.find((option) => option.value === form.goalKind);
  const week = weekSummary(form);
  const goal = form.goalKind === "race"
    ? (form.raceDistance ? raceDistanceLabel(form.raceDistance) : "") || form.goal.trim() || kind?.label || "—"
    : form.goalKind === "other"
      ? form.goal.trim() || t("library.snap.yourOwn")
      : kind?.label ?? "—";
  return [
    { key: "goal", label: t("library.snap.goal"), value: goal },
    { key: "length", label: t("library.snap.length"), value: span?.weeks ? plural("library.weeks", span.weeks) : form.goalKind === "race" ? t("library.snap.toRace") : t("library.coachDecides") },
    { key: "dates", label: t("library.snap.dates"), value: span?.last ? `${formatPlanDate(span.first)} – ${formatPlanDate(span.last, true)}` : t("library.snap.from", { date: formatPlanDate(span?.first) }) },
    { key: "week", label: t("library.snap.week"), value: form.weekMode === "coach" ? t("library.coachDecides") : t("library.snap.weekValue", { sessions: week.sessions, time: week.time }) },
    { key: "sports", label: t("library.snap.sports"), value: form.sports.length ? form.sports.map(workoutSportLabel).join(", ") : "—" },
    { key: "level", label: t("library.snap.level"), value: LEVELS.find((level) => level.value === form.difficulty)?.label ?? "—" }
  ];
}

/** A plan day some days from another, as `YYYY-MM-DD`. */
export function addPlanDays(iso: string, days: number): string {
  const date = parsePlanDay(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Race day as the picker holds it (`yyyyMMdd`) and as the request states it (`YYYY-MM-DD`). */
export function raceDayKey(iso: string): string {
  return iso.replaceAll("-", "");
}

export function raceDayIso(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}
