/**
 * The AI plan generator's rules, in one place both halves read.
 *
 * The renderer asks these questions of the form before anything is sent, the
 * main process asks them again of the request it receives, and the
 * `draft_training_plan` tool asks `generatedPlanProblems` of every draft the
 * model writes during a generation — so a draft that breaks the request is
 * handed back to the model to fix in the same turn, rather than failing after
 * the whole plan has been paid for. Free of `node:` imports: the renderer
 * imports it directly.
 *
 * **A generated plan is counted in Monday-to-Sunday weeks, from a Monday.**
 * That is how COROS counts a plan (`dayNo` from the Monday of the start week),
 * how `week_stages` are numbered and how the plan editor draws weeks. A
 * mid-week start used to be offered and counted in seven-day blocks from that
 * day, so an 8-week request from a Wednesday became a 9-week plan whose stages
 * and weeks the model numbered differently from everything that read them.
 */
import type {
  AnthropicEffort,
  ChatProvider,
  CorosMcpTool,
  PlanWorkoutEntryInput,
  RunWorkoutCreateStep,
  RunWorkoutStepInput,
  TrainingPlanDayKind,
  TrainingPlanDifficulty,
  TrainingPlanGenerationDay,
  TrainingPlanGenerationRequest,
  TrainingPlanGoalKind,
  TrainingPlanOutline,
  TrainingPlanOutlineRevision,
  TrainingPlanOutlineSession,
  TrainingPlanOutlineWeek,
  TrainingPlanDataSources,
  TrainingPlanWeekStage,
  WorkoutSport
} from "./types";
import {
  COROS_WEEK_STAGES,
  formatPlanDay,
  parsePlanDay
} from "./trainingPlanDomain";
import { WORKOUT_SPORTS, formatWorkoutSport } from "./workoutCapabilities";

export const TRAINING_PLAN_GENERATION_LIMITS = {
  maxWeeks: 24,
  /** The shortest plan Coach may choose when the length is left to it. */
  minCoachWeeks: 4,
  /** The shortest race plan: race day at least one whole week after week 1. */
  minRaceWeeks: 2,
  maxSessionsPerWeek: 7,
  maxWeeklyHours: 40,
  goalLength: 400,
  constraintsLength: 600,
  minSessionMinutes: 10,
  maxSessionMinutes: 600,
  /** How far ahead the first week may be. */
  maxLeadWeeks: 52
} as const;

export const PLAN_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const TRAINING_PLAN_GOAL_KINDS: readonly TrainingPlanGoalKind[] = ["race", "base", "return", "hybrid", "other"];
const DIFFICULTIES: readonly TrainingPlanDifficulty[] = ["beginner", "intermediate", "advanced", "custom"];
const DAY_KINDS: readonly TrainingPlanDayKind[] = ["rest", "train", "long", "flex"];
const PROVIDERS: readonly ChatProvider[] = ["claude-code", "claude-api", "chatgpt", "openrouter", "local"];
const EFFORTS: readonly AnthropicEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** Which part of the form a problem belongs to, so the form can mark that field. */
export type TrainingPlanGenerationField =
  | "goal"
  | "race"
  | "sports"
  | "difficulty"
  | "weeks"
  | "start"
  | "days"
  | "week"
  | "constraints"
  | "runtime";

export interface TrainingPlanGenerationProblem {
  field: TrainingPlanGenerationField;
  message: string;
}

const DAY_MS = 86_400_000;

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysFrom(from: Date, to: Date): number {
  return Math.round((to.valueOf() - from.valueOf()) / DAY_MS);
}

function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The earliest week a generated plan may start: today when today is a Monday,
 * otherwise the next Monday — the same day the calendar dialog opens on. A
 * week already under way cannot be the first: its days before today would
 * have to hold sessions dated in the past, which the draft tool refuses.
 */
export function firstPlanMonday(today = new Date()): string {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return formatPlanDay(addDays(day, (8 - day.getDay()) % 7), true);
}

/** A Monday some whole weeks from another, as `YYYY-MM-DD`. */
export function addPlanWeeks(monday: string, weeks: number): string {
  const start = parsePlanDay(monday);
  return start ? formatPlanDay(addDays(start, weeks * 7), true) : monday;
}

/** The week a race falls in, counted from the plan's first Monday: its length. */
export function raceWeeks(startDate: string, raceDate: string): number | undefined {
  const start = parsePlanDay(startDate);
  const race = parsePlanDay(raceDate);
  if (!start || !race) return undefined;
  return Math.floor(daysFrom(start, race) / 7) + 1;
}

/**
 * How many weeks the plan runs, where the request decides it: the distance to
 * race day for a race, the athlete's count otherwise, and `undefined` when the
 * length is left to Coach.
 */
export function requestedPlanWeeks(
  request: Pick<TrainingPlanGenerationRequest, "goalKind" | "race" | "startDate" | "weeks" | "outline">
): number | undefined {
  if (request.goalKind === "race") return request.race?.date ? raceWeeks(request.startDate, request.race.date) : undefined;
  return request.weeks ?? (request.outline?.weeks.length || undefined);
}

/**
 * The first and last day of a generated plan, as `YYYY-MM-DD`. A race plan
 * ends on race day rather than on that week's Sunday; `last` is absent while
 * the length is Coach's to choose.
 */
export function generatedPlanSpan(
  request: Pick<TrainingPlanGenerationRequest, "goalKind" | "race" | "startDate" | "weeks" | "outline">
): { first: string; last?: string; weeks?: number } | undefined {
  const start = parsePlanDay(request.startDate);
  if (!start) return undefined;
  const weeks = requestedPlanWeeks(request);
  const first = formatPlanDay(start, true);
  if (request.goalKind === "race" && request.race?.date && parsePlanDay(request.race.date)) {
    return { first, last: formatPlanDay(parsePlanDay(request.race.date)!, true), weeks };
  }
  if (!weeks) return { first };
  return { first, last: formatPlanDay(addDays(start, Math.max(1, weeks) * 7 - 1), true), weeks };
}

const isTrainingDay = (day: TrainingPlanGenerationDay | undefined) => day?.kind === "train" || day?.kind === "long";

/**
 * A usual week's session count, as a band: every training day holds one, and
 * each flex day may. `through` (a weekday) counts only the days up to it, for
 * a race week that ends on race day.
 */
export function weekSessionBand(days: readonly TrainingPlanGenerationDay[], through = 6): { min: number; max: number } {
  const counted = days.slice(0, through + 1);
  const fixed = counted.filter(isTrainingDay).length;
  const flex = counted.filter((day) => day.kind === "flex").length;
  return { min: fixed, max: fixed + flex };
}

/**
 * The time a usual week offers, in minutes: the fixed days, then the flex days
 * on top. A day the athlete marked Free has no minutes and no ceiling, so a
 * week holding one has no most — `max` is `Infinity` — and `min` counts only
 * the days that state a time.
 */
export function weekMinutesBand(days: readonly TrainingPlanGenerationDay[]): { min: number; max: number } {
  const minutes = (day: TrainingPlanGenerationDay) => (day.kind === "rest" ? 0 : day.minutes ?? 0);
  const fixed = days.filter(isTrainingDay).reduce((sum, day) => sum + minutes(day), 0);
  const flex = days.filter((day) => day.kind === "flex").reduce((sum, day) => sum + minutes(day), 0);
  const free = days.some((day) => day.kind !== "rest" && day.minutes === undefined);
  return { min: fixed, max: free ? Number.POSITIVE_INFINITY : fixed + flex };
}

function validMinutes(minutes: unknown): boolean {
  const limits = TRAINING_PLAN_GENERATION_LIMITS;
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= limits.minSessionMinutes && minutes <= limits.maxSessionMinutes;
}

// ---------------------------------------------------------------------------
// What Coach may read. A source switched off is withheld twice: from the
// snapshot the turn starts from, and from every tool that would read it.
// ---------------------------------------------------------------------------

export type PlanDataSource = keyof TrainingPlanDataSources;

export const ALL_TRAINING_PLAN_SOURCES: TrainingPlanDataSources = { activities: true, sleep: true, zones: true };

/**
 * The local tools that read a source. A tool that reads two is withheld when
 * either is: the fitness trends carry the training load *and* overnight HRV.
 */
const LOCAL_TOOL_SOURCES: Readonly<Record<string, readonly PlanDataSource[]>> = {
  list_recent_activities: ["activities"],
  get_activity_detail: ["activities"],
  get_fitness_trends: ["activities", "sleep"],
  get_sleep_summary: ["sleep"],
  get_training_zones: ["zones"]
};

/**
 * The COROS MCP server's tools, by what their names say they read — the
 * server's own names (`querySleepData`, `querySportRecords`,
 * `queryRecoveryStatus`…), matched by pattern rather than listed, so a tool
 * it adds later is withheld by what it is about rather than slipping through.
 */
const REMOTE_TOOL_SOURCES: readonly [RegExp, PlanDataSource][] = [
  [/sleep|hrv|stress/i, "sleep"],
  [/zone|threshold/i, "zones"],
  [/activit|lap|record|load|fitness|metric|trend|vo2|recovery|workout/i, "activities"]
];

/** Whether a tool reads a source the athlete withheld from this plan. */
export function toolReadsWithheldSource(name: string, sources: TrainingPlanDataSources | undefined): boolean {
  if (!sources) return false;
  const withheld = (source: PlanDataSource) => sources[source] === false;
  const local = LOCAL_TOOL_SOURCES[name];
  if (local) return local.some(withheld);
  const remote = name.startsWith("coros__") ? name.slice("coros__".length) : undefined;
  if (!remote) return false;
  return REMOTE_TOOL_SOURCES.some(([pattern, source]) => pattern.test(remote) && withheld(source));
}

const SOURCE_WITHHELD_LINES: Record<PlanDataSource, string> = {
  activities: "I have not shared my training history with this plan: do not read my activities, fitness, records or predictions. Build from what I told you, and say in the description that you did.",
  sleep: "I have not shared my sleep or HRV with this plan: do not read or assume them.",
  zones: "I have not shared my COROS thresholds or zones with this plan: set intensities by effort (RPE) or a sensible generic target, and say so."
};

/** What the turn may read, as the prompt's first sentence names it. */
function sharedContext(request: TrainingPlanGenerationRequest, records: boolean): string {
  const sources = { ...ALL_TRAINING_PLAN_SOURCES, ...request.sources };
  const parts = [
    sources.activities ? "recent training" : undefined,
    sources.sleep ? "recovery and sleep" : undefined,
    sources.zones ? "training zones" : undefined,
    sources.activities && records ? "personal records" : undefined
  ].filter(Boolean);
  if (!parts.length) return "Use only what I tell you here: I have not shared my training data with this plan.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Use my Training Coach context — ${list} — and read what you need with the read tools first.`;
}

function sourceLines(request: TrainingPlanGenerationRequest): string[] {
  const sources = request.sources;
  if (!sources) return [];
  return (Object.keys(SOURCE_WITHHELD_LINES) as PlanDataSource[])
    .filter((source) => sources[source] === false)
    .map((source) => `- ${SOURCE_WITHHELD_LINES[source]}`);
}

/**
 * Everything wrong with a request, in the order the form lays its fields out.
 *
 * `today` decides whether the start is in the past, and is left out where the
 * request is only being read back — building the document from a finished
 * generation must not start failing because a day went by.
 */
export function generationRequestProblems(
  request: TrainingPlanGenerationRequest,
  today?: Date
): TrainingPlanGenerationProblem[] {
  const limits = TRAINING_PLAN_GENERATION_LIMITS;
  const problems: TrainingPlanGenerationProblem[] = [];
  const add = (field: TrainingPlanGenerationField, message: string) => problems.push({ field, message });

  const kind = request.goalKind;
  const goal = request.goal?.trim() ?? "";
  if (!TRAINING_PLAN_GOAL_KINDS.includes(kind)) add("goal", "Pick what kind of goal this is.");
  else if (kind === "other" && !goal) add("goal", "Describe what you are training for.");
  else if (goal.length > limits.goalLength) add("goal", `Keep the goal under ${limits.goalLength} characters.`);

  const start = parsePlanDay(request.startDate);
  if (kind === "race") {
    const race = request.race?.date ? parsePlanDay(request.race.date) : undefined;
    const weeks = request.race?.date ? raceWeeks(request.startDate, request.race.date) : undefined;
    if (!race) add("race", "Pick race day.");
    else if (!request.race?.distance?.trim() && !goal) add("race", "Name the race or pick its distance.");
    else if (start && weeks !== undefined && (race < start || weeks < limits.minRaceWeeks)) {
      add("race", "Race day has to fall after the plan's first week — start earlier.");
    } else if (weeks !== undefined && weeks > limits.maxWeeks) {
      add("race", `Race day is more than ${limits.maxWeeks} weeks after the first week — start later.`);
    }
  }

  const sports = request.sports ?? [];
  const unknownSport = sports.find((sport) => !WORKOUT_SPORTS.includes(sport));
  if (!sports.length) add("sports", "Pick at least one sport.");
  else if (unknownSport) add("sports", `"${unknownSport}" is not a sport a plan can hold.`);

  if (!DIFFICULTIES.includes(request.difficulty)) add("difficulty", "Pick a level.");
  else if (request.difficulty === "custom" && request.sources?.activities === false) {
    add("difficulty", "Coach can't judge your level without your recent activities — share them, or pick a level.");
  }

  if (kind !== "race" && request.weeks !== undefined) {
    if (!Number.isInteger(request.weeks) || request.weeks < 1 || request.weeks > limits.maxWeeks) {
      add("weeks", `A generated plan runs 1 to ${limits.maxWeeks} weeks.`);
    }
  }

  if (!start) {
    add("start", "Pick the week the plan starts.");
  } else if (start.getDay() !== 1) {
    add("start", "A plan starts on a Monday — COROS counts a plan's weeks from one.");
  } else if (today) {
    const earliest = firstPlanMonday(today);
    const lead = daysFrom(parsePlanDay(earliest)!, start) / 7;
    if (formatPlanDay(start, true) < earliest) add("start", "The first week can't be one that has already begun.");
    else if (lead > limits.maxLeadWeeks) add("start", "Start the plan within a year.");
  }

  const week = request.week;
  if (week?.mode === "days") {
    const days = week.days ?? [];
    if (days.length !== 7 || days.some((day) => !DAY_KINDS.includes(day?.kind))) {
      add("days", "A usual week is seven days, Monday to Sunday.");
    } else if (!days.some((day) => day.kind !== "rest")) {
      add("days", "Mark at least one day you can train.");
    } else if (days.some((day) => day.kind !== "rest" && day.minutes !== undefined && !validMinutes(day.minutes))) {
      add("days", `A day's time is a whole number of minutes, ${limits.minSessionMinutes} to ${limits.maxSessionMinutes}.`);
    }
  } else if (week?.mode === "coach") {
    const blocked = week.blockedDayIndexes ?? [];
    if (blocked.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || new Set(blocked).size !== blocked.length) {
      add("days", "Days you can't train are Monday to Sunday, each once.");
    } else if (blocked.length === 7) {
      add("days", "Leave at least one day you can train.");
    }
    const sessions = week.sessionsPerWeek;
    if (sessions !== undefined) {
      if (!Number.isInteger(sessions) || sessions < 1 || sessions > limits.maxSessionsPerWeek) {
        add("week", `Sessions a week run 1 to ${limits.maxSessionsPerWeek}.`);
      } else if (blocked.length < 7 && sessions > 7 - blocked.length) {
        add("week", `${plural(sessions, "session")} a week need at least ${sessions} days you can train.`);
      }
    }
    const hours = week.hours;
    if (hours && (!(hours.min >= 0) || (hours.max !== undefined && (hours.max < hours.min || hours.max > limits.maxWeeklyHours)))) {
      add("week", `Hours a week are a band from 0 to ${limits.maxWeeklyHours}.`);
    }
  } else {
    add("days", "Say how your week looks, or leave it to Coach.");
  }

  if ((request.constraints?.trim().length ?? 0) > limits.constraintsLength) {
    add("constraints", `Keep the constraints under ${limits.constraintsLength} characters.`);
  }

  const runtime = request.runtime;
  if (runtime) {
    if (runtime.provider !== undefined && !PROVIDERS.includes(runtime.provider)) add("runtime", "Pick a provider Coach knows.");
    else if (runtime.effort !== undefined && !EFFORTS.includes(runtime.effort)) add("runtime", "Pick a reasoning effort.");
    else if (runtime.model !== undefined && (typeof runtime.model !== "string" || runtime.model.length > 200)) add("runtime", "Pick a model.");
  }
  return problems;
}

/**
 * A session's length in minutes, when every step states one — a distance step
 * has no length to check, so a session holding one is not held to a time
 * limit it cannot state.
 */
function timedMinutes(workout: PlanWorkoutEntryInput): number | undefined {
  let seconds = 0;
  const timed = (step: RunWorkoutCreateStep, repeat: number): boolean => {
    const duration = step.target_duration_seconds ?? 0;
    seconds += duration * repeat;
    return duration > 0;
  };
  const steps: RunWorkoutStepInput[] = workout.steps ?? [];
  const complete = steps.length > 0 && steps.every((node) =>
    "steps" in node
      ? node.steps.every((step) => timed(step, Math.max(1, node.repeat)))
      : timed(node, 1)
  );
  return complete ? Math.round(seconds / 60) : undefined;
}

function bandText(band: { min: number; max: number }): string {
  return band.min === band.max ? `exactly ${band.min}` : `${band.min} to ${band.max}`;
}

function hoursText(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/**
 * How many sessions a week of the plan may hold, as the request states it.
 * A race week ends on race day, so it may hold fewer — down to the race.
 */
export function weekCountBand(request: TrainingPlanGenerationRequest, raceWeek: boolean): { min: number; max: number } {
  const week = request.week;
  if (week.mode === "days") {
    const race = raceWeek && request.race?.date ? parsePlanDay(request.race.date) : undefined;
    const through = race ? weekdayOf(race) : 6;
    const usual = weekSessionBand(week.days, through);
    if (!race) return usual;
    const raceExtra = !isTrainingDay(week.days[through]) && week.days[through]?.kind !== "flex" ? 1 : 0;
    return { min: 1, max: usual.max + raceExtra };
  }
  if (week.sessionsPerWeek !== undefined) {
    return raceWeek ? { min: 1, max: week.sessionsPerWeek } : { min: week.sessionsPerWeek, max: week.sessionsPerWeek };
  }
  return { min: 1, max: TRAINING_PLAN_GENERATION_LIMITS.maxSessionsPerWeek * 2 };
}

/**
 * Where a draft departs from the request, one sentence per problem, written
 * for the model to act on — the draft tool hands these back when it refuses a
 * draft, and the model fixes them and calls it again.
 *
 * Race day is exempt from the week's pattern: the race goes on the day it is,
 * whatever that day usually holds, and the race week ends there.
 */
export function generatedPlanProblems(
  workouts: readonly PlanWorkoutEntryInput[],
  request: TrainingPlanGenerationRequest
): string[] {
  const limits = TRAINING_PLAN_GENERATION_LIMITS;
  const start = parsePlanDay(request.startDate);
  const span = generatedPlanSpan(request);
  if (!start || !span) return ["The plan has no start week."];
  const race = request.goalKind === "race" && request.race?.date ? parsePlanDay(request.race.date) : undefined;
  const raceDay = race ? formatPlanDay(race, true) : undefined;
  const fixedWeeks = requestedPlanWeeks(request);
  const horizon = fixedWeeks ?? limits.maxWeeks;
  const end = race ? addDays(race, 1) : addDays(start, horizon * 7);
  const rangeText = span.last
    ? `${span.first} to ${span.last}`
    : `${span.first} to ${formatPlanDay(addDays(end, -1), true)}, at most ${limits.maxWeeks} weeks`;
  const week = request.week;
  const problems: string[] = [];
  const perWeek: { count: number; minutes: number; timed: boolean }[] = Array.from({ length: horizon }, () => ({ count: 0, minutes: 0, timed: true }));
  const perDay = new Map<string, { minutes: number; timed: boolean }>();
  let lastWeek = -1;

  for (const workout of workouts) {
    const label = `"${workout.name?.trim() || "A session"}"`;
    const date = parsePlanDay(workout.schedule_date);
    if (!date) {
      problems.push(`${label} has no schedule_date; every session needs one inside the plan's weeks.`);
      continue;
    }
    if (date < start || date >= end) {
      problems.push(
        race && date >= end
          ? `${label} is dated ${formatPlanDay(date, true)}, after race day (${raceDay}); the plan ends on race day.`
          : `${label} is dated ${formatPlanDay(date, true)}, outside the plan (${rangeText}).`
      );
      continue;
    }
    const iso = formatPlanDay(date, true);
    const weekday = weekdayOf(date);
    const onRaceDay = iso === raceDay;
    if (!onRaceDay) {
      if (week.mode === "days" && week.days[weekday]?.kind === "rest") {
        problems.push(`${label} is on a ${PLAN_WEEKDAYS[weekday]}, which is a rest day.`);
      } else if (week.mode === "coach" && week.blockedDayIndexes.includes(weekday)) {
        problems.push(`${label} is on a ${PLAN_WEEKDAYS[weekday]}, a day the athlete can't train.`);
      }
    }
    const sport: WorkoutSport = workout.sport ?? "run";
    if (!request.sports.includes(sport)) {
      problems.push(`${label} is ${formatWorkoutSport(sport)}, which was not asked for.`);
    }
    const minutes = timedMinutes(workout);
    const index = Math.floor(daysFrom(start, date) / 7);
    lastWeek = Math.max(lastWeek, index);
    const tally = perWeek[index];
    tally.count += 1;
    if (minutes === undefined) tally.timed = false;
    else tally.minutes += minutes;
    if (!onRaceDay) {
      const day = perDay.get(iso) ?? { minutes: 0, timed: true };
      if (minutes === undefined) day.timed = false;
      else day.minutes += minutes;
      perDay.set(iso, day);
    }
  }

  if (week.mode === "days") {
    for (const [iso, day] of perDay) {
      const weekday = weekdayOf(parsePlanDay(iso)!);
      const allowed = week.days[weekday]?.minutes;
      if (day.timed && allowed && day.minutes > allowed) {
        problems.push(`${PLAN_WEEKDAYS[weekday]} ${iso} holds ${day.minutes} minutes; the athlete has ${allowed} that day.`);
      }
    }
  }

  const weekCount = fixedWeeks ?? lastWeek + 1;
  if (weekCount === 0) problems.push("The plan has no sessions.");
  if (fixedWeeks === undefined && weekCount > 0 && weekCount < limits.minCoachWeeks) {
    problems.push(
      `The plan runs ${plural(weekCount, "week")}; when you choose the length, make it ${limits.minCoachWeeks} to ${limits.maxWeeks} weeks.`
    );
  }
  for (let index = 0; index < weekCount; index += 1) {
    const tally = perWeek[index];
    const monday = formatPlanDay(addDays(start, index * 7), true);
    const where = `Week ${index + 1} (from ${monday})`;
    const raceWeek = race !== undefined && index === weekCount - 1;
    const planned = request.outline?.weeks[index];
    if (planned) {
      /* The outline the athlete accepted is the week's count, exactly. */
      if (tally.count !== planned.sessions) {
        problems.push(`${where} has ${plural(tally.count, "session")}; the outline gives it ${planned.sessions}.`);
      }
      const target = planned.hours * 60;
      if (tally.timed && tally.count > 0 && Math.abs(tally.minutes - target) > target * 0.2 + 15) {
        problems.push(`${where} comes to ${hoursText(tally.minutes)}; the outline gives it ${hoursText(target)}.`);
      }
    } else {
      const band = weekCountBand(request, raceWeek);
      if (tally.count < band.min || tally.count > band.max) {
        problems.push(
          tally.count === 0 && band.min <= 1
            ? `${where} has no sessions; every week of the plan needs at least one.`
            : raceWeek && band.min === 1
              ? `${where}, the race week, has ${plural(tally.count, "session")}; it takes at most ${band.max}, the race included.`
              : `${where} has ${plural(tally.count, "session")}; it needs ${bandText(band)}.`
        );
      }
    }
    if (week.mode === "coach" && week.hours?.max !== undefined && tally.timed && tally.count > 0) {
      const ceiling = week.hours.max * 60 * 1.1;
      if (tally.minutes > ceiling) {
        problems.push(`${where} comes to ${hoursText(tally.minutes)}; the athlete has at most ${week.hours.max} h a week.`);
      }
    }
  }
  return problems;
}

const GOAL_BRIEF: Record<Exclude<TrainingPlanGoalKind, "race" | "other">, string> = {
  base: "Build an aerobic base: steady, durable volume, mostly easy, with a little quality to keep it honest.",
  return: "Come back after a break or an injury: rebuild gradually from where my training is now, with the load rising slowly and no hard sessions early.",
  hybrid: "Strength and hybrid fitness (HYROX, gym and engine): strength sessions and conditioning together, balanced so neither buries the other."
};

const LEVEL_BRIEF: Record<TrainingPlanDifficulty, string> = {
  beginner: "Beginner — new to structured training: conservative volume, simple sessions, plenty of easy work.",
  intermediate: "Intermediate — trains consistently: a normal progression.",
  advanced: "Advanced — a strong, high-volume base: harder sessions and more volume are fine.",
  custom: "Judge my level from my recent training and recovery, and say what you concluded in the description."
};

function sportList(request: TrainingPlanGenerationRequest): string {
  return request.sports.map(formatWorkoutSport).join(", ");
}

function weekdayName(iso: string): string {
  const date = parsePlanDay(iso);
  return date ? PLAN_WEEKDAYS[weekdayOf(date)] : "";
}

function goalLines(request: TrainingPlanGenerationRequest): string[] {
  const goal = request.goal.trim();
  switch (request.goalKind) {
    case "race": {
      const what = [request.race?.distance?.trim(), goal].filter(Boolean).join(" — ");
      return [
        `- Goal: a race${what ? `: ${what}` : ""}.`,
        `- Race day: ${weekdayName(request.race!.date)} ${request.race!.date}. Taper into it, and put the race itself on race day as the plan's last session.`
      ];
    }
    case "other":
      return [`- Goal, in my words: ${goal}`];
    default:
      return [`- Goal: ${GOAL_BRIEF[request.goalKind]}`, ...(goal ? [`- In my words: ${goal}`] : [])];
  }
}

function dayLine(day: TrainingPlanGenerationDay, index: number): string {
  const name = PLAN_WEEKDAYS[index];
  /* The athlete's time is a ceiling, not a target; a day with none is Free. */
  const time = day.minutes === undefined ? "no time limit" : `up to ${day.minutes} min`;
  switch (day.kind) {
    case "rest":
      return `  - ${name}: rest — no session.`;
    case "train":
      return `  - ${name}: a session, ${time}.`;
    case "long":
      return `  - ${name}: the long day, ${time} — the week's longest session goes here.`;
    case "flex":
      return `  - ${name}: optional — use it or leave it empty, ${time}.`;
  }
}

function lengthLine(request: TrainingPlanGenerationRequest): string {
  const span = generatedPlanSpan(request);
  const limits = TRAINING_PLAN_GENERATION_LIMITS;
  if (request.goalKind === "race" && span?.last) {
    return `- Week 1 starts on Monday ${span.first}; the plan runs ${plural(span.weeks ?? 0, "week")} and ends on race day, ${weekdayName(span.last)} ${span.last}. No session after it.`;
  }
  if (span?.last && span.weeks) {
    return `- Exactly ${plural(span.weeks, "week")}, Monday to Sunday. Week 1 starts on Monday ${span.first}; the last week ends on Sunday ${span.last}.`;
  }
  return `- Choose the length yourself: ${limits.minCoachWeeks} to ${limits.maxWeeks} whole weeks from Monday ${span?.first}, Monday to Sunday — whatever the goal needs — and say why in the description.`;
}

function weekLines(request: TrainingPlanGenerationRequest): string[] {
  const week = request.week;
  if (week.mode === "days") {
    const band = weekSessionBand(week.days);
    return [
      "- My usual week, which every week follows:",
      ...week.days.map(dayLine),
      `- So every week holds ${bandText(band)} session${band.max === 1 ? "" : "s"}: one on each training day and the long day, and the optional days as you see fit.${request.goalKind === "race" ? " The race week ends on race day and may hold fewer." : ""}`,
      "- A day's minutes are the most I have that day, not a time to fill: its sessions together fit inside them, and may be shorter. A day with no time limit is yours to size."
    ];
  }
  const lines = ["- How my week looks is yours to decide: choose the days, how many sessions and how long each one is."];
  if (week.blockedDayIndexes.length) {
    lines.push(`- Never on: ${[...week.blockedDayIndexes].sort((a, b) => a - b).map((day) => PLAN_WEEKDAYS[day]).join(", ")}.`);
  }
  if (week.sessionsPerWeek !== undefined) {
    lines.push(`- Exactly ${plural(week.sessionsPerWeek, "session")} in every week${request.goalKind === "race" ? " (the race week may hold fewer, the race included)" : ""}.`);
  } else {
    lines.push("- Choose how many sessions a week suits my training; every week needs at least one.");
  }
  if (week.hours) {
    lines.push(
      week.hours.max !== undefined
        ? `- I have about ${week.hours.min}–${week.hours.max} hours a week; no week over ${week.hours.max} hours.`
        : `- I have ${week.hours.min} hours a week or more.`
    );
  } else {
    lines.push("- Judge how much time a week suits me from my training.");
  }
  return lines;
}

/**
 * The one message a generation sends. It states the request as rules the
 * draft tool will check, and says so — the model then knows a refusal is
 * something to fix rather than a failure to report.
 */
export function trainingPlanGenerationPrompt(request: TrainingPlanGenerationRequest): string {
  const outline = request.outline
    ? [
        "",
        "The outline I accepted — write the sessions to it, week by week. Each week holds exactly its number of sessions, comes within a fifth of its hours, and takes its stage in week_stages:",
        `  Summary: ${request.outline.summary}`,
        ...outlineLines(request.outline, request.startDate),
        `What you read of my training when you drew it: ${request.outline.basis} Read more only where a session needs it.`
      ]
    : [];
  return [
    `Write a complete structured training plan for me and hand it over with draft_training_plan. ${sharedContext(request, true)}`,
    "Do not ask me anything: where something is unclear, make a sensible assumption and name it in the plan's description.",
    "",
    "What the plan is for",
    ...goalLines(request),
    `- Level: ${LEVEL_BRIEF[request.difficulty]}`,
    `- Sports (use only these): ${sportList(request)}`,
    `- Constraints: ${request.constraints?.trim() || "none"}`,
    ...sourceLines(request),
    "",
    "Its shape — draft_training_plan checks every one of these and refuses a draft that breaks one",
    lengthLine(request),
    ...weekLines(request),
    "- Every session has a schedule_date (YYYYMMDD) inside those weeks, its sport, and complete typed steps with targets and intensities. Set save_to_library to false.",
    "- Give steps as time targets where you can, so the length can be checked.",
    ...outline,
    "",
    "How to build it",
    "- Periodise it: give every week a week_stages entry (preparation, base, build, peak, race, transition). Progress the load gradually, with a lighter week every three or four weeks where the plan is long enough.",
    request.sources?.zones === false
      ? "- Set intensities by effort, since my zones are not shared."
      : "- Set intensities from my own zones (get_training_zones), not generic figures.",
    "- description: two to four sentences on what the plan is for, how it is built, and any assumption you made. It becomes the plan's overview on COROS.",
    "- Name the plan after the goal, and each session after what it is (\"Threshold 3 × 10 min\", \"Long run\").",
    "",
    "Call draft_training_plan once with the whole plan. If it is refused, fix every problem it lists and call it again with the whole plan. When it is accepted, reply with a two-sentence summary and nothing else. Nothing is saved or scheduled from here: the app shows me the plan week by week, and I save, schedule or edit it."
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The outline: the plan's shape, proposed and read before any session is
// written. It is its own turn with its own tool, offered to that turn alone.
// ---------------------------------------------------------------------------

export const PLAN_OUTLINE_TOOL = "propose_plan_outline";

const STAGE_SLUGS = COROS_WEEK_STAGES.filter((stage) => stage.value > 0).map((stage) => stage.slug);

/** The outline tool, as every provider is handed it. */
export const PLAN_OUTLINE_TOOL_DEFINITION: CorosMcpTool = {
  name: PLAN_OUTLINE_TOOL,
  description:
    "Propose the training plan's shape, week by week, before any session is written. The athlete reads it, may ask for changes, and the sessions are then written to it. It is checked against the athlete's request and refused with the reasons when it breaks one.",
  inputSchema: {
    type: "object",
    required: ["summary", "basis", "weeks"],
    properties: {
      summary: { type: "string", description: "One or two sentences: how the plan is built and why." },
      basis: {
        type: "string",
        description: "One or two sentences on what you read of the athlete's current training (weekly volume, recent long session, thresholds) that the plan starts from. Shown to the athlete."
      },
      weeks: {
        type: "array",
        description: "Every week of the plan, in order, week 1 first.",
        items: {
          type: "object",
          required: ["week", "stage", "hours", "sessions", "focus", "key_sessions"],
          properties: {
            week: { type: "integer", minimum: 1 },
            stage: { type: "string", enum: STAGE_SLUGS },
            lighter: { type: "boolean", description: "A lighter week inside its block, to absorb the ones before it." },
            hours: { type: "number", minimum: 0, description: "Planned training time that week, in hours." },
            sessions: { type: "integer", minimum: 0, description: "How many sessions the week holds." },
            focus: { type: "string", description: "One sentence: what the week is for." },
            key_sessions: {
              type: "array",
              description: "The one to three sessions the week is built around.",
              items: {
                type: "object",
                required: ["day", "name", "sport"],
                properties: {
                  day: { type: "string", enum: [...PLAN_WEEKDAYS] },
                  name: { type: "string" },
                  sport: { type: "string", enum: [...WORKOUT_SPORTS] },
                  minutes: { type: "integer", minimum: 1 }
                }
              }
            }
          }
        }
      }
    }
  }
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * The tool's arguments as an outline, or the reasons they are not one — in
 * the words the model is handed back.
 */
export function parsePlanOutline(args: Record<string, unknown>): { outline?: TrainingPlanOutline; errors: string[] } {
  const errors: string[] = [];
  const summary = text(args.summary);
  const basis = text(args.basis);
  if (!summary) errors.push("summary is missing.");
  if (!basis) errors.push("basis is missing: say what you read of the athlete's training.");
  const rawWeeks = Array.isArray(args.weeks) ? args.weeks : [];
  if (!rawWeeks.length) errors.push("weeks is empty: give every week of the plan.");
  const weeks: TrainingPlanOutlineWeek[] = [];
  rawWeeks.forEach((raw, index) => {
    const week = (raw ?? {}) as Record<string, unknown>;
    const where = `Week ${index + 1}`;
    if (week.week !== index + 1) errors.push(`${where} is numbered ${String(week.week)}; number the weeks 1, 2, 3… in order.`);
    const stage = COROS_WEEK_STAGES.find((candidate) => candidate.slug === week.stage && candidate.value > 0);
    if (!stage) errors.push(`${where} has no stage; use one of ${STAGE_SLUGS.join(", ")}.`);
    const hours = typeof week.hours === "number" && Number.isFinite(week.hours) && week.hours >= 0 ? Math.round(week.hours * 10) / 10 : undefined;
    if (hours === undefined) errors.push(`${where} has no hours.`);
    const sessions = Number.isInteger(week.sessions) && (week.sessions as number) >= 0 ? (week.sessions as number) : undefined;
    if (sessions === undefined) errors.push(`${where} has no session count.`);
    const keySessions: TrainingPlanOutlineSession[] = [];
    for (const item of Array.isArray(week.key_sessions) ? week.key_sessions : []) {
      const key = (item ?? {}) as Record<string, unknown>;
      const dayIndex = PLAN_WEEKDAYS.indexOf(key.day as (typeof PLAN_WEEKDAYS)[number]);
      const sport = WORKOUT_SPORTS.includes(key.sport as WorkoutSport) ? (key.sport as WorkoutSport) : undefined;
      if (dayIndex < 0 || !sport || !text(key.name)) {
        errors.push(`${where} has a key session without a day, a name or a sport.`);
        continue;
      }
      const minutes = Number.isInteger(key.minutes) && (key.minutes as number) > 0 ? (key.minutes as number) : undefined;
      keySessions.push({ dayIndex, name: text(key.name), sport, ...(minutes ? { minutes } : {}) });
    }
    weeks.push({
      stage: (stage?.value ?? 0) as TrainingPlanWeekStage,
      lighter: week.lighter === true,
      hours: hours ?? 0,
      sessions: sessions ?? 0,
      focus: text(week.focus),
      keySessions
    });
  });
  return errors.length ? { errors } : { outline: { summary, basis, weeks }, errors };
}

/**
 * Where an outline departs from the request, one sentence per problem, for
 * the model to fix: its length, the race week, each week's count and time
 * against the athlete's week, and each key session's day and sport.
 */
export function planOutlineProblems(outline: TrainingPlanOutline, request: TrainingPlanGenerationRequest): string[] {
  const limits = TRAINING_PLAN_GENERATION_LIMITS;
  const problems: string[] = [];
  const fixed = request.goalKind === "race" ? requestedPlanWeeks(request) : request.weeks;
  const count = outline.weeks.length;
  if (fixed !== undefined && count !== fixed) {
    problems.push(`The outline has ${plural(count, "week")}; the plan runs ${plural(fixed, "week")}${request.goalKind === "race" ? ", to race day" : ""}.`);
  } else if (fixed === undefined && (count < limits.minCoachWeeks || count > limits.maxWeeks)) {
    problems.push(`The outline has ${plural(count, "week")}; when you choose the length, make it ${limits.minCoachWeeks} to ${limits.maxWeeks} weeks.`);
  }
  const race = request.goalKind === "race" && request.race?.date ? parsePlanDay(request.race.date) : undefined;
  const week = request.week;
  const minutesBand = week.mode === "days" ? weekMinutesBand(week.days) : undefined;
  outline.weeks.forEach((planned, index) => {
    const where = `Week ${index + 1}`;
    const raceWeek = race !== undefined && index === count - 1;
    if (raceWeek && planned.stage !== 5) problems.push(`${where} is the race week; give it the race stage.`);
    const band = weekCountBand(request, raceWeek);
    if (planned.sessions < band.min || planned.sessions > band.max) {
      problems.push(`${where} has ${plural(planned.sessions, "session")}; the athlete's week holds ${bandText(band)}.`);
    }
    if (planned.keySessions.length > Math.max(planned.sessions, 1)) {
      problems.push(`${where} names more key sessions than it has sessions.`);
    }
    const ceiling = week.mode === "coach" && week.hours?.max !== undefined
      ? week.hours.max * 1.1
      : minutesBand && minutesBand.max > 0
        ? (minutesBand.max / 60) * 1.05
        : undefined;
    if (ceiling !== undefined && planned.hours > ceiling && !raceWeek) {
      problems.push(`${where} plans ${planned.hours} h; the athlete has at most ${Math.round(ceiling * 10) / 10} h a week.`);
    }
    for (const session of planned.keySessions) {
      const label = `${where}'s "${session.name}"`;
      const onRaceDay = raceWeek && race !== undefined && weekdayOf(race) === session.dayIndex;
      if (!request.sports.includes(session.sport)) problems.push(`${label} is ${formatWorkoutSport(session.sport)}, which was not asked for.`);
      if (onRaceDay) continue;
      if (week.mode === "days") {
        const day = week.days[session.dayIndex];
        if (day?.kind === "rest") problems.push(`${label} is on ${PLAN_WEEKDAYS[session.dayIndex]}, a rest day.`);
        else if (session.minutes && day?.minutes && session.minutes > day.minutes) {
          problems.push(`${label} runs ${session.minutes} minutes; ${PLAN_WEEKDAYS[session.dayIndex]} has ${day.minutes}.`);
        }
      } else if (week.blockedDayIndexes.includes(session.dayIndex)) {
        problems.push(`${label} is on ${PLAN_WEEKDAYS[session.dayIndex]}, a day the athlete can't train.`);
      }
    }
  });
  return problems;
}

function stageName(stage: number): string {
  return COROS_WEEK_STAGES.find((candidate) => candidate.value === stage)?.label ?? "Not set";
}

/** An outline as lines a prompt can carry, one per week, dated from the plan's first Monday. */
export function outlineLines(outline: TrainingPlanOutline, startDate: string): string[] {
  return outline.weeks.map((week, index) => {
    const monday = addPlanWeeks(startDate, index);
    const keys = week.keySessions
      .map((session) => `${PLAN_WEEKDAYS[session.dayIndex]} ${session.name} (${formatWorkoutSport(session.sport)}${session.minutes ? `, ${session.minutes} min` : ""})`)
      .join("; ");
    return `  - Week ${index + 1} (from ${monday}): ${stageName(week.stage)}${week.lighter ? ", lighter" : ""}, ${week.hours} h, ${plural(week.sessions, "session")} — ${week.focus}${keys ? ` Key: ${keys}.` : ""}`;
  });
}

function requestLines(request: TrainingPlanGenerationRequest): string[] {
  return [
    "What the plan is for",
    ...goalLines(request),
    `- Level: ${LEVEL_BRIEF[request.difficulty]}`,
    `- Sports (use only these): ${sportList(request)}`,
    `- Constraints: ${request.constraints?.trim() || "none"}`,
    ...sourceLines(request),
    "",
    "Its shape — the tool checks every one of these and refuses what breaks one",
    lengthLine(request),
    ...weekLines(request)
  ];
}

/**
 * The outline turn's one message: the request, and the shape to propose —
 * or, for a redraw, the outline already proposed and what to change in it.
 */
export function trainingPlanOutlinePrompt(request: TrainingPlanGenerationRequest, revision?: TrainingPlanOutlineRevision): string {
  const lines = [
    `Propose the shape of a training plan for me with ${PLAN_OUTLINE_TOOL}. Do not write any sessions yet: I read the outline first, and the sessions are written to it afterwards. ${sharedContext(request, false)}`,
    "Do not ask me anything: where something is unclear, make a sensible assumption and name it in the summary.",
    "",
    ...requestLines(request),
    "",
    "What to propose",
    "- Every week, in order: its stage (preparation, base, build, peak, race, transition), whether it is a lighter week, its hours, its number of sessions, one sentence on what it is for, and the one to three key sessions it is built around (day, name, sport, minutes).",
    "- Progress the load gradually, with a lighter week every three or four weeks where the plan is long enough.",
    "- basis: one or two sentences on what you read of my current training that the plan starts from — it is shown to me.",
    "- summary: one or two sentences on how the plan is built."
  ];
  if (revision) {
    lines.push(
      "",
      "You proposed this outline before:",
      `  Summary: ${revision.outline.summary}`,
      ...outlineLines(revision.outline, request.startDate),
      `Change it as I ask, and keep what my request does not touch: ${revision.note.trim()}`
    );
  }
  lines.push(
    "",
    `Call ${PLAN_OUTLINE_TOOL} once with the whole outline. If it is refused, fix every problem it lists and call it again. When it is accepted, reply with one sentence and nothing else.`
  );
  return lines.join("\n");
}
