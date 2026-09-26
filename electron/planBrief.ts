/**
 * A plan brief (docs/coach-plan-canvas.md, P2.1): what the athlete wants a
 * plan to be, before Coach draws its shape. It is the plan generator's
 * request — the same fields, checked by the same `generationRequestProblems` —
 * without the parts the conversation owns (what Coach may read, which AI
 * answers) or that come later (the outline).
 *
 * Coach fills one in with `request_plan_brief` from what it already knows,
 * marking each field it filled as said in the conversation or read from the
 * athlete's data; everything else starts at the generator form's default, and
 * the athlete corrects it on the brief's own screen.
 *
 * Free of `node:` imports: the renderer reads the defaults and the lines.
 */
import type {
  CorosMcpTool,
  PlanBriefField,
  PlanBriefOrigin,
  PlanBriefRequest,
  TrainingPlanDayKind,
  TrainingPlanDifficulty,
  TrainingPlanGenerationDay,
  TrainingPlanGenerationWeek,
  TrainingPlanGoalKind,
  WorkoutSport
} from "./types";
import { TRAINING_PLAN_GOAL_KINDS } from "./trainingPlanGeneration";
import { formatPlanDay, parsePlanDay } from "./trainingPlanDomain";
import { WORKOUT_SPORTS, formatWorkoutSport } from "./workoutCapabilities";

export const PLAN_BRIEF_TOOL = "request_plan_brief";

export const PLAN_BRIEF_FIELDS: readonly PlanBriefField[] = ["goal", "dates", "sports", "level", "week", "constraints"];

const LEVELS: readonly TrainingPlanDifficulty[] = ["beginner", "intermediate", "advanced", "custom"];
const DAY_KINDS: readonly TrainingPlanDayKind[] = ["rest", "train", "long", "flex"];

/**
 * The usual week a brief starts with: the generator form's, day for day, so
 * a brief nobody has touched reads the same as the form nobody has touched.
 */
export const DEFAULT_BRIEF_DAYS: readonly TrainingPlanGenerationDay[] = [
  { kind: "rest" },
  { kind: "train", minutes: 60 },
  { kind: "train", minutes: 60 },
  { kind: "rest" },
  { kind: "train", minutes: 60 },
  { kind: "long", minutes: 120 },
  { kind: "train", minutes: 60 }
];

/** The brief before anybody has said anything: the generator form's defaults. */
export function defaultPlanBriefRequest(firstMonday: string): PlanBriefRequest {
  return {
    goalKind: "race",
    goal: "",
    race: { date: "" },
    sports: ["run"],
    difficulty: "custom",
    startDate: firstMonday,
    week: { mode: "days", days: DEFAULT_BRIEF_DAYS.map((day) => ({ ...day })) }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const day = parsePlanDay(value.trim());
  return day ? formatPlanDay(day, true) : undefined;
}

/** The Monday of the week a day falls in. */
function mondayOf(iso: string): string {
  const day = parsePlanDay(iso)!;
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return formatPlanDay(day, true);
}

function wholeNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function parseDays(value: unknown): TrainingPlanGenerationDay[] | undefined {
  if (!Array.isArray(value) || value.length !== 7) return undefined;
  const days = value.map((day): TrainingPlanGenerationDay | undefined => {
    if (!isRecord(day) || !DAY_KINDS.includes(day.kind as TrainingPlanDayKind)) return undefined;
    const kind = day.kind as TrainingPlanDayKind;
    const minutes = wholeNumber(day.minutes, 1, 24 * 60);
    return kind === "rest" || minutes === undefined ? { kind } : { kind, minutes };
  });
  return days.every(Boolean) ? (days as TrainingPlanGenerationDay[]) : undefined;
}

export interface ParsedPlanBrief {
  request: PlanBriefRequest;
  origins: Partial<Record<PlanBriefField, PlanBriefOrigin>>;
  /** Fields handed over in a shape the brief cannot hold, said back to Coach. */
  dropped: string[];
}

/**
 * What Coach handed `request_plan_brief`, laid over a brief — the defaults for
 * a new one, the brief itself when Coach fills in one it already set out. A
 * field in a shape the brief cannot hold is left as it was and named in
 * `dropped`, rather than failing the whole brief over one date.
 */
export function briefFromPrefill(
  args: Record<string, unknown>,
  base: PlanBriefRequest,
  baseOrigins: Partial<Record<PlanBriefField, PlanBriefOrigin>> = {}
): ParsedPlanBrief {
  const request: PlanBriefRequest = structuredClone(base);
  const origins = { ...baseOrigins };
  const dropped: string[] = [];
  const fromData = new Set(
    Array.isArray(args.from_data) ? args.from_data.filter((field): field is string => typeof field === "string") : []
  );
  const filled = (field: PlanBriefField) => {
    origins[field] = fromData.has(field) ? "data" : "chat";
  };

  if (args.goal_kind !== undefined || args.goal !== undefined || args.race_date !== undefined || args.race_distance !== undefined) {
    let ok = true;
    if (args.goal_kind !== undefined) {
      if (TRAINING_PLAN_GOAL_KINDS.includes(args.goal_kind as TrainingPlanGoalKind)) {
        request.goalKind = args.goal_kind as TrainingPlanGoalKind;
      } else {
        dropped.push(`goal_kind "${String(args.goal_kind)}"`);
        ok = false;
      }
    }
    if (typeof args.goal === "string") request.goal = args.goal.trim().slice(0, 300);
    if (request.goalKind === "race") {
      const date = args.race_date === undefined ? request.race?.date ?? "" : isoDay(args.race_date);
      if (date === undefined) {
        dropped.push(`race_date "${String(args.race_date)}" (use YYYY-MM-DD)`);
        ok = false;
      }
      const distance = typeof args.race_distance === "string" ? args.race_distance.trim() : request.race?.distance;
      request.race = { date: date ?? request.race?.date ?? "", ...(distance ? { distance } : {}) };
    } else {
      delete request.race;
    }
    if (ok) filled("goal");
  }

  if (args.start_date !== undefined || args.weeks !== undefined) {
    let ok = true;
    if (args.start_date !== undefined) {
      const start = isoDay(args.start_date);
      if (start) request.startDate = mondayOf(start);
      else {
        dropped.push(`start_date "${String(args.start_date)}" (use YYYY-MM-DD)`);
        ok = false;
      }
    }
    if (args.weeks !== undefined) {
      const weeks = wholeNumber(args.weeks, 1, 52);
      if (weeks !== undefined && request.goalKind !== "race") request.weeks = weeks;
      else if (weeks === undefined) {
        dropped.push(`weeks ${String(args.weeks)} (a whole number, 1 to 52)`);
        ok = false;
      }
    }
    if (ok) filled("dates");
  }

  if (args.sports !== undefined) {
    const sports = Array.isArray(args.sports)
      ? args.sports.filter((sport): sport is WorkoutSport => WORKOUT_SPORTS.includes(sport as WorkoutSport))
      : [];
    if (sports.length) {
      request.sports = [...new Set(sports)];
      filled("sports");
    } else dropped.push("sports (none this app can plan)");
  }

  if (args.level !== undefined) {
    if (LEVELS.includes(args.level as TrainingPlanDifficulty)) {
      request.difficulty = args.level as TrainingPlanDifficulty;
      filled("level");
    } else dropped.push(`level "${String(args.level)}"`);
  }

  if (args.days !== undefined) {
    const days = parseDays(args.days);
    if (days) {
      request.week = { mode: "days", days };
      filled("week");
    } else dropped.push("days (seven of them, Monday first, each rest/train/long/flex)");
  } else if (args.hours_per_week !== undefined || args.sessions_per_week !== undefined || args.blocked_days !== undefined) {
    const week: Extract<TrainingPlanGenerationWeek, { mode: "coach" }> = { mode: "coach", blockedDayIndexes: [] };
    let ok = true;
    if (args.hours_per_week !== undefined) {
      const band = isRecord(args.hours_per_week) ? args.hours_per_week : undefined;
      const min = typeof band?.min === "number" && band.min >= 0 ? band.min : undefined;
      const max = typeof band?.max === "number" && min !== undefined && band.max >= min ? band.max : undefined;
      if (min !== undefined) week.hours = { min, ...(max !== undefined ? { max } : {}) };
      else {
        dropped.push("hours_per_week ({ min, max? } in hours)");
        ok = false;
      }
    }
    if (args.sessions_per_week !== undefined) {
      const sessions = wholeNumber(args.sessions_per_week, 1, 14);
      if (sessions !== undefined) week.sessionsPerWeek = sessions;
      else {
        dropped.push(`sessions_per_week ${String(args.sessions_per_week)}`);
        ok = false;
      }
    }
    if (Array.isArray(args.blocked_days)) {
      week.blockedDayIndexes = [
        ...new Set(args.blocked_days.filter((day): day is number => wholeNumber(day, 0, 6) !== undefined))
      ].sort((a, b) => a - b);
    }
    if (ok) {
      request.week = week;
      filled("week");
    }
  }

  if (typeof args.constraints === "string") {
    const constraints = args.constraints.trim().slice(0, 600);
    if (constraints) request.constraints = constraints;
    else delete request.constraints;
    filled("constraints");
  }

  return { request, origins, dropped };
}

/**
 * A brief read back off its row. Only the shape is checked — whether it is a
 * brief an outline can be drawn from is `generationRequestProblems`' question
 * — and a row this build cannot read is no brief at all.
 */
export function parseStoredBrief(json: string | undefined): {
  request: PlanBriefRequest;
  origins: Partial<Record<PlanBriefField, PlanBriefOrigin>>;
} | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.request)) return undefined;
    const request = parsed.request as unknown as PlanBriefRequest;
    if (
      !TRAINING_PLAN_GOAL_KINDS.includes(request.goalKind) ||
      typeof request.startDate !== "string" ||
      !Array.isArray(request.sports) ||
      !isRecord(request.week)
    ) {
      return undefined;
    }
    const origins: Partial<Record<PlanBriefField, PlanBriefOrigin>> = {};
    if (isRecord(parsed.origins)) {
      for (const field of PLAN_BRIEF_FIELDS) {
        const origin = parsed.origins[field];
        if (origin === "chat" || origin === "data") origins[field] = origin;
      }
    }
    return { request, origins };
  } catch {
    return undefined;
  }
}

/** What each field of a brief is made of, for telling which ones an edit changed. */
const FIELD_PARTS: Record<PlanBriefField, (request: PlanBriefRequest) => unknown> = {
  goal: (request) => [request.goalKind, request.goal, request.race ?? null],
  dates: (request) => [request.startDate, request.weeks ?? null],
  sports: (request) => [...request.sports].sort(),
  level: (request) => request.difficulty,
  week: (request) => request.week,
  constraints: (request) => request.constraints ?? ""
};

/**
 * The fields an edit changed. A field the athlete changed is theirs now, so
 * its "from chat" or "from data" no longer says where it came from.
 */
export function briefChangedFields(before: PlanBriefRequest, after: PlanBriefRequest): PlanBriefField[] {
  return PLAN_BRIEF_FIELDS.filter(
    (field) => JSON.stringify(FIELD_PARTS[field](before)) !== JSON.stringify(FIELD_PARTS[field](after))
  );
}

/** The brief as a line for Coach: what it asks for, in words. */
export function briefLine(request: PlanBriefRequest): string {
  const goal =
    request.goalKind === "race"
      ? `race${request.race?.distance ? ` (${request.race.distance})` : ""}${request.goal ? ` "${request.goal}"` : ""} on ${request.race?.date || "a day not yet picked"}`
      : request.goalKind === "other"
        ? `"${request.goal}"`
        : `${request.goalKind}${request.goal ? ` — ${request.goal}` : ""}`;
  const length =
    request.goalKind === "race" ? "" : request.weeks ? `, ${request.weeks} weeks` : ", length yours to choose";
  const week =
    request.week.mode === "days"
      ? request.week.days.map((day) => day.kind[0]!.toUpperCase()).join("")
      : "week left to you";
  return `${goal}, from ${request.startDate}${length} · ${request.sports.map(formatWorkoutSport).join(", ")} · ${request.difficulty} · ${week}`;
}

const DAY_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["rest", "train", "long", "flex"] },
    minutes: { type: "integer", description: "The most time the athlete has that day. Leave out for no limit." }
  },
  required: ["kind"]
};

export const PLAN_BRIEF_TOOL_DEFINITION: CorosMcpTool = {
  name: PLAN_BRIEF_TOOL,
  description:
    "Set out a training plan brief for the athlete to check: what the plan is for, when it runs, the sports, the level " +
    "and their usual week. Call this when the athlete asks for a training plan of more than two weeks, instead of " +
    "asking question after question: fill in what you already know from the conversation or their data and leave " +
    "the rest out — the athlete corrects the brief on its own screen, then asks you to draw the outline. " +
    "Do not draft the plan in the same turn. To fill in more of a brief you already set out, pass its brief_id.",
  inputSchema: {
    type: "object",
    properties: {
      brief_id: { type: "string", description: "A brief you set out earlier in this conversation, to fill in further." },
      goal_kind: { type: "string", enum: ["race", "base", "return", "hybrid", "other"] },
      goal: { type: "string", description: "The goal in the athlete's words: the race's name, or what they are training for." },
      race_date: { type: "string", description: "Race day, YYYY-MM-DD. The plan ends on it." },
      race_distance: { type: "string", description: "5K, 10K, Half, Marathon, Trail 50K, Ultra 100K, or the race's own." },
      start_date: { type: "string", description: "The first week, YYYY-MM-DD; moved to that week's Monday." },
      weeks: { type: "integer", description: "Length in weeks, when not a race. Leave out to choose it with the outline." },
      sports: { type: "array", items: { type: "string", enum: [...WORKOUT_SPORTS] } },
      level: { type: "string", enum: ["beginner", "intermediate", "advanced", "custom"], description: "custom: judged from their training." },
      days: {
        type: "array",
        items: DAY_SCHEMA,
        minItems: 7,
        maxItems: 7,
        description: "Their usual week, Monday first. flex: a day you may use or leave free."
      },
      hours_per_week: {
        type: "object",
        properties: { min: { type: "number" }, max: { type: "number" } },
        required: ["min"],
        description: "Instead of days, when they only know their hours."
      },
      sessions_per_week: { type: "integer" },
      blocked_days: { type: "array", items: { type: "integer" }, description: "Days they cannot train, Monday = 0." },
      constraints: { type: "string", description: "Injuries, travel, equipment — anything the plan must respect." },
      from_data: {
        type: "array",
        items: { type: "string", enum: [...PLAN_BRIEF_FIELDS] },
        description: "The fields you read from their data rather than from the conversation."
      }
    }
  }
};
