/**
 * Coach reads the athlete's COROS plans (P3.1 of docs/coach-plan-canvas.md):
 * every plan in one line each, and one plan week by week.
 *
 * The list is the Library's cache (`coros_plan_cache`) and the stored
 * plan-versus-done matches, so it costs no request — except on a machine
 * whose Library has never loaded, where the cache is empty and the list is
 * read once the way the Library reads it. One plan is read from COROS
 * (`/training/plan/detail`, as the Library's reader does), falling back to the
 * cache offline.
 *
 * A plan on the calendar is read through its **running copy**: that is where
 * the dates are, and a calendar session carries the copy's id and its
 * `idInPlan` — the pair a change to the calendar names (P3.3) and the pair
 * every match is keyed by.
 *
 * Progress comes from the athlete's activities, so a conversation that has
 * not shared them gets the plan without it: the tool itself stays, because a
 * plan is not training history (`toolReadsWithheldSource` withholds whole
 * tools, which would take the plan away as well).
 */
import {
  findCachedRunningCorosPlan,
  findChatSessionMentioning,
  getChatPlanDraft,
  getCorosPlanCache,
  getTrainingPlanMetadata,
  listChatPlanDraftVersions,
  listCorosPlanCache,
  listTrainingActivityMatches,
  listTrainingPlanMetadata
} from "./database";
import { getNativeTrainingPlan, getTrainingLibrarySnapshot } from "./trainingLibraryService";
import { formatEntryStepsSummary, type PlanWorkoutEntry } from "./corosWorkoutBuilder";
import { planCompliance, type PlanCompliance } from "./planCompliance";
import {
  COROS_WEEK_STAGES,
  formatPlanDay,
  parsePlanDay,
  planEntryMetrics,
  sportMixOf,
  weekStageOf
} from "./trainingPlanDomain";
import { formatDistanceValue } from "./unitSystem.js";
import type {
  CorosMcpTool,
  TrainingActivityMatch,
  TrainingPlanDocument,
  TrainingPlanEntry,
  UnitSystem
} from "./types";

export const CHAT_PLAN_TOOL_NAMES = ["list_training_plans", "get_training_plan"] as const;
export type ChatPlanToolName = (typeof CHAT_PLAN_TOOL_NAMES)[number];

export function isChatPlanTool(name: string): name is ChatPlanToolName {
  return (CHAT_PLAN_TOOL_NAMES as readonly string[]).includes(name);
}

/** Weeks shown when the question names none: the whole of a short plan. */
const WHOLE_PLAN_WEEKS = 8;
/** Sessions whose whole workout one call may ask for. */
const MAX_WHOLE_SESSIONS = 5;

export function getChatPlanTools(): CorosMcpTool[] {
  return [
    {
      name: "list_training_plans",
      description:
        "List the athlete's training plans on COROS, one line each: name, weeks, sports, whether it is on the calendar " +
        "(and then the week it is in and how it is going), and a draft_id for a plan you made. " +
        "Read from what the app last loaded, so it costs nothing; pass refresh only when the athlete says a plan changed.",
      inputSchema: {
        type: "object",
        properties: {
          include_archived: { type: "boolean", description: "Also list plans the athlete archived. Default false." },
          refresh: { type: "boolean", description: "Read the list from COROS again first." }
        }
      }
    },
    {
      name: "get_training_plan",
      description:
        "Read one COROS plan week by week: each week's stage, and each session's id_in_plan, day, name, sport, volume " +
        "and — for a plan on the calendar — its date and whether it was done or missed. " +
        "A plan on the calendar is read as the calendar holds it, under its calendar_plan_id. " +
        "Pass weeks for the weeks the question is about, and sessions (id_in_plan) for those sessions' steps.",
      inputSchema: {
        type: "object",
        properties: {
          plan_id: { type: "string", description: "A plan_id or calendar_plan_id from list_training_plans." },
          weeks: {
            type: "array",
            items: { type: "integer", minimum: 1 },
            maxItems: 12,
            description: "Week numbers (1 is the first). Default: the whole plan when short, else the weeks around now."
          },
          sessions: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_WHOLE_SESSIONS,
            description: "id_in_plan of sessions to return with their steps."
          }
        },
        required: ["plan_id"]
      }
    }
  ];
}

export interface ChatPlanToolOptions {
  /** False when the conversation has not shared the athlete's activities: no progress. */
  progress?: boolean;
  /** The conversation asking, so a plan Coach made here can be named by its draft. */
  sessionId?: string;
  unitSystem?: UnitSystem;
  today?: Date;
}

export async function handleChatPlanTool(
  name: ChatPlanToolName,
  args: Record<string, unknown>,
  options: ChatPlanToolOptions = {}
): Promise<string> {
  return name === "list_training_plans" ? listTrainingPlans(args, options) : getTrainingPlan(args, options);
}

// ---------------------------------------------------------------------------
// list_training_plans
// ---------------------------------------------------------------------------

async function listTrainingPlans(args: Record<string, unknown>, options: ChatPlanToolOptions): Promise<string> {
  let plans = listCorosPlanCache();
  let note: string | undefined;
  if (args.refresh === true || plans.length === 0) {
    try {
      /* The snapshot settles every read on its own: a list COROS did not
         answer is reported in `partialFailures`, not thrown. */
      const snapshot = await getTrainingLibrarySnapshot();
      const failure = snapshot.partialFailures.find((line) => line.startsWith("Training plans:"));
      if (failure) note = `COROS did not answer (${failure.slice("Training plans:".length).trim()}); this is the list as the app last loaded it.`;
      plans = listCorosPlanCache();
    } catch (error) {
      note = `COROS did not answer (${message(error)}); this is the list as the app last loaded it.`;
    }
  }
  const metadata = new Map(listTrainingPlanMetadata().map((item) => [item.planId, item]));
  const includeArchived = args.include_archived === true;
  const matches = options.progress === false ? undefined : listTrainingActivityMatches();
  const today = options.today ?? new Date();
  const templates = new Set(plans.filter((plan) => plan.calendar === "unscheduled").map((plan) => plan.remoteId));
  const runningOf = new Map(
    plans
      .filter((plan) => plan.calendar === "running" && plan.sourcePlanId)
      .map((plan) => [plan.sourcePlanId!, plan])
  );

  const lines = plans.flatMap((plan) => {
    const meta = metadata.get(plan.id);
    /* A run taken off, or one that ran out while its plan is still listed, is history. */
    if (plan.calendar === "stopped") return [];
    if (plan.calendar !== "unscheduled" && plan.sourcePlanId && templates.has(plan.sourcePlanId)) return [];
    const running = plan.calendar === "running" ? plan : plan.remoteId ? runningOf.get(plan.remoteId) : undefined;
    /* Archived is out of the way, not off the calendar: a plan still running is listed. */
    if (meta?.archived && !includeArchived && !running) return [];
    const coach = coachDraft(meta?.coach?.draftId, options);
    return [
      {
        plan_id: plan.remoteId,
        name: plan.name,
        weeks: plan.weekCount,
        sports: sportMixOf(plan.entries),
        ...(running
          ? {
              calendar_plan_id: running.remoteId,
              on_calendar: runningLine(running, today),
              ...progressLine(running, matches)
            }
          : plan.calendar === "finished"
            ? { on_calendar: "finished" }
            : { on_calendar: "no" }),
        ...(plan.calendar !== "unscheduled" && !plan.sourcePlanId
          ? { note: "A calendar run whose plan is not in the list (applied from COROS's catalogue, or its plan was deleted)." }
          : {}),
        ...(meta?.archived ? { archived: true } : {}),
        ...coach
      }
    ];
  });

  return JSON.stringify({
    ok: true,
    plans: lines,
    ...(lines.length === 0 ? { empty: "The athlete has no training plans on COROS." } : {}),
    ...(options.progress === false
      ? { progress_withheld: "The athlete has not shared their training history in this conversation." }
      : {}),
    ...(note ? { note } : {})
  });
}

function runningLine(running: TrainingPlanDocument, today: Date): string {
  const start = parsePlanDay(running.startDate);
  if (!start) return "yes";
  const week = Math.floor((dayNumber(today) - dayNumber(start)) / 7) + 1;
  const since = `since ${formatPlanDay(start, true)}`;
  if (week < 1) return `yes, starting ${formatPlanDay(start, true)}`;
  if (week > running.weekCount) return `yes, ${since}; its last week has passed`;
  return `yes, ${since}; week ${week} of ${running.weekCount} this week`;
}

function progressLine(
  running: TrainingPlanDocument,
  matches: readonly TrainingActivityMatch[] | undefined
): { progress?: string } {
  if (!matches) return {};
  const compliance = planCompliance(running, matches);
  return compliance ? { progress: describeProgress(compliance) } : {};
}

function describeProgress(compliance: PlanCompliance): string {
  const parts = [`${compliance.done} done`];
  if (compliance.missed) parts.push(`${compliance.missed} missed`);
  if (compliance.skipped) parts.push(`${compliance.skipped} skipped`);
  if (compliance.upcoming) parts.push(`${compliance.upcoming} ahead`);
  const kept = compliance.ratio === undefined ? "" : ` (${Math.round(compliance.ratio * 100)}% of the sessions due were done)`;
  return `${parts.join(", ")}${kept}`;
}

/**
 * The creation a plan Coach saved came from, named by its newest version so
 * `revise_training_plan` takes it — but only in the conversation that holds
 * it: revising from anywhere else would put the next version's card in a
 * conversation the athlete is not reading.
 */
function coachDraft(
  draftId: string | undefined,
  options: ChatPlanToolOptions
): { made_by?: string; draft_id?: string } {
  if (!draftId) return {};
  const row = getChatPlanDraft(draftId);
  if (!row) return { made_by: "you, in a conversation since deleted" };
  const versions = listChatPlanDraftVersions(row.artifactId ?? row.draftId);
  const newest = versions[versions.length - 1] ?? row;
  /* A card names its draft id in the transcript; any version's will do. */
  const where = findChatSessionMentioning(versions.map((version) => version.draftId).reverse());
  if (options.sessionId && where === options.sessionId) {
    return { made_by: "you, in this conversation", draft_id: newest.draftId };
  }
  return { made_by: "you, in another conversation" };
}

// ---------------------------------------------------------------------------
// get_training_plan
// ---------------------------------------------------------------------------

async function getTrainingPlan(args: Record<string, unknown>, options: ChatPlanToolOptions): Promise<string> {
  const asked = String(args.plan_id ?? "").trim().replace(/^coros:/, "");
  if (!asked) return JSON.stringify({ ok: false, errors: ["plan_id is required."] });
  /* A template on the calendar is read as its running copy, where the dates are. */
  const copyId = getCorosPlanCache(asked)?.calendar === "unscheduled" ? findCachedRunningCorosPlan(asked) : undefined;
  const target = copyId ?? asked;
  let plan: TrainingPlanDocument | undefined;
  let note: string | undefined;
  try {
    plan = await getNativeTrainingPlan(target);
  } catch (error) {
    plan = getCorosPlanCache(target);
    if (!plan) {
      return JSON.stringify({
        ok: false,
        error_code: "plan_not_found",
        errors: [`No plan ${asked} could be read (${message(error)}). Take plan_id from list_training_plans.`]
      });
    }
    note = `COROS did not answer (${message(error)}); this is the plan as the app last read it.`;
  }

  const unitSystem = options.unitSystem ?? "metric";
  const today = options.today ?? new Date();
  const onCalendar = plan.calendar !== "unscheduled";
  const matches = onCalendar && options.progress !== false ? listTrainingActivityMatches() : undefined;
  const statusOf = new Map(
    (matches ?? [])
      .filter((match) => match.schedulePlanId === plan!.remoteId)
      .map((match) => [match.scheduleIdInPlan, match.status])
  );
  const start = onCalendar ? parsePlanDay(plan.startDate) : undefined;
  const currentWeek = start ? Math.floor((dayNumber(today) - dayNumber(start)) / 7) + 1 : undefined;
  const weeks = chosenWeeks(args.weeks, plan.weekCount, currentWeek);
  const wanted = new Set(
    (Array.isArray(args.sessions) ? args.sessions : []).slice(0, MAX_WHOLE_SESSIONS).map((id) => String(id ?? "").trim())
  );
  const templateId = plan.sourcePlanId ?? (copyId ? asked : undefined);
  const meta = getTrainingPlanMetadata(`coros:${onCalendar && templateId ? templateId : plan.remoteId}`);
  const compliance = matches ? planCompliance(plan, matches) : undefined;

  const byWeek = new Map<number, TrainingPlanEntry[]>();
  for (const entry of plan.entries) {
    const list = byWeek.get(entry.weekIndex) ?? [];
    list.push(entry);
    byWeek.set(entry.weekIndex, list);
  }
  const shownWeeks = weeks.shown.map((week) => {
    const stage = COROS_WEEK_STAGES.find((item) => item.value === weekStageOf(plan!, week - 1));
    const sessions = (byWeek.get(week - 1) ?? [])
      .sort((a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder)
      .map((entry) => sessionLine(entry, unitSystem, statusOf));
    return {
      week,
      ...(stage && stage.value !== 0 ? { stage: stage.label } : {}),
      ...(currentWeek === week ? { now: true } : {}),
      sessions: sessions.length ? sessions : ["rest week"]
    };
  });
  const whole = plan.entries
    .filter((entry) => entry.idInPlan && wanted.has(entry.idInPlan))
    .map((entry) => wholeSession(entry, unitSystem));

  return JSON.stringify({
    ok: true,
    plan_id: onCalendar && templateId ? templateId : plan.remoteId,
    ...(onCalendar ? { calendar_plan_id: plan.remoteId } : {}),
    name: plan.name,
    ...(plan.description ? { description: plan.description } : {}),
    weeks: plan.weekCount,
    ...(onCalendar
      ? {
          on_calendar:
            plan.calendar === "running"
              ? runningLine(plan, today)
              : plan.calendar === "finished"
                ? "finished"
                : "taken off the calendar"
        }
      : { on_calendar: "no — sessions are named by week and day only" }),
    ...(compliance ? { progress: describeProgress(compliance) } : {}),
    ...(onCalendar && options.progress === false
      ? { progress_withheld: "The athlete has not shared their training history in this conversation." }
      : {}),
    ...coachDraft(meta?.coach?.draftId, options),
    week_list: shownWeeks,
    ...(weeks.omitted ? { other_weeks: weeks.omitted } : {}),
    ...(whole.length ? { workouts: whole } : {}),
    ...(wanted.size > whole.length ? { not_found: [...wanted].filter((id) => !whole.some((w) => w.id_in_plan === id)) } : {}),
    ...(note ? { note } : {})
  });
}

function chosenWeeks(
  value: unknown,
  weekCount: number,
  currentWeek: number | undefined
): { shown: number[]; omitted?: string } {
  const all = Array.from({ length: weekCount }, (_, index) => index + 1);
  const asked = (Array.isArray(value) ? value : [])
    .map((week) => Number(week))
    .filter((week) => Number.isInteger(week) && week >= 1 && week <= weekCount);
  let shown: number[];
  if (asked.length) {
    shown = [...new Set(asked)].sort((a, b) => a - b);
  } else if (weekCount <= WHOLE_PLAN_WEEKS) {
    shown = all;
  } else {
    /* The weeks around now for a plan under way, else its first weeks. */
    const from = currentWeek && currentWeek >= 1 && currentWeek <= weekCount ? Math.max(1, currentWeek - 1) : 1;
    shown = all.slice(from - 1, from - 1 + 4);
  }
  const rest = all.filter((week) => !shown.includes(week));
  return rest.length ? { shown, omitted: `weeks ${ranges(rest)} not shown; ask with weeks` } : { shown };
}

function ranges(weeks: number[]): string {
  const parts: string[] = [];
  let first = weeks[0];
  for (let index = 1; index <= weeks.length; index += 1) {
    if (weeks[index] !== weeks[index - 1] + 1) {
      const last = weeks[index - 1];
      parts.push(first === last ? `${first}` : `${first}–${last}`);
      first = weeks[index];
    }
  }
  return parts.join(", ");
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const STATUS_WORDS: Record<TrainingActivityMatch["status"], string> = {
  completed: "done",
  partial: "partly done",
  missed: "missed",
  skipped: "skipped",
  rescheduled: "moved",
  upcoming: "ahead"
};

function sessionLine(
  entry: TrainingPlanEntry,
  unitSystem: UnitSystem,
  statusOf: ReadonlyMap<string, TrainingActivityMatch["status"]>
): string {
  const date = dashedDay(entry.happenDay);
  const day = date ? `${DAY_NAMES[entry.dayIndex]} ${date}` : DAY_NAMES[entry.dayIndex];
  const status = entry.idInPlan ? statusOf.get(entry.idInPlan) : undefined;
  return [
    entry.idInPlan ? `#${entry.idInPlan}` : "unsaved",
    day,
    entry.title || entry.workout.name,
    entry.workout.sport ?? "run",
    volume(entry, unitSystem),
    status ? STATUS_WORDS[status] : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function volume(entry: TrainingPlanEntry, unitSystem: UnitSystem): string | undefined {
  const metrics = planEntryMetrics(entry);
  const parts: string[] = [];
  if (metrics.durationSeconds) parts.push(`${Math.round(metrics.durationSeconds / 60)} min`);
  if (metrics.distanceMeters) {
    parts.push(formatDistanceValue(metrics.distanceMeters, unitSystem, { swim: entry.workout.sport === "swim" }));
  }
  if (!parts.length && metrics.strengthSets) parts.push(`${metrics.strengthSets} sets`);
  return parts.length ? parts.join(" / ") : undefined;
}

function wholeSession(entry: TrainingPlanEntry, unitSystem: UnitSystem) {
  const workout = entry.workout;
  const steps = formatEntryStepsSummary(workout as PlanWorkoutEntry, unitSystem);
  return {
    id_in_plan: entry.idInPlan!,
    name: entry.title || workout.name,
    sport: workout.sport ?? "run",
    ...(dashedDay(entry.happenDay) ? { date: dashedDay(entry.happenDay) } : {}),
    ...(workout.description ? { description: workout.description } : {}),
    ...(steps ? { steps } : {}),
    ...(workout.steps ? { workout_steps: workout.steps } : {})
  };
}

function dashedDay(value: string | undefined): string | undefined {
  const date = parsePlanDay(value);
  return date ? formatPlanDay(date, true) : undefined;
}

function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
