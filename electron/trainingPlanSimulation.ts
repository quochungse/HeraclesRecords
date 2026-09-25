/**
 * A scripted stand-in for the model in the plan generator's two turns, for
 * working on the generator without spending an AI quota. It is switched on by
 * `HERACLES_SIMULATE_PLAN_AI=1` (see `simulatePlanAi`), and nothing else ever
 * reaches it.
 *
 * It stands in for the model and for nothing after it: what it builds here are
 * the *arguments* a model would hand `propose_plan_outline` and
 * `draft_training_plan`, and `chatService` hands them to the real tools. So the
 * checks, the draft, the conversion to a plan, the library draft and the COROS
 * save all run as they do for a real turn — and a scripted plan the checks
 * refuse is a bug found in one of the two, not something to paper over.
 *
 * Every figure is worked out from the request: the days and minutes the
 * athlete gave (or, left to Coach, the days they did not block), the race day,
 * the length, the sports. The plan's words say it was simulated.
 */
import type {
  PlanWorkoutEntryInput,
  RunWorkoutCreateStep,
  RunWorkoutStepInput,
  TrainingPlanGenerationRequest,
  TrainingPlanOutline,
  TrainingPlanWeekStage,
  WorkoutSport
} from "./types";
import { COROS_WEEK_STAGES, parsePlanDay } from "./trainingPlanDomain";
import {
  PLAN_WEEKDAYS,
  TRAINING_PLAN_GENERATION_LIMITS,
  addPlanWeeks,
  requestedPlanWeeks,
  weekCountBand
} from "./trainingPlanGeneration";
import { WORKOUT_SPORT_CAPABILITIES, formatWorkoutSport } from "./workoutCapabilities";
import { resolveStepDefaults } from "./workoutDefaults";

/** Whether the generator's turns are scripted rather than sent to a provider. */
export function simulatePlanAi(env: Record<string, string | undefined> = process.env): boolean {
  return env.HERACLES_SIMULATE_PLAN_AI === "1";
}

/** How long a plan runs when the athlete left the length to Coach. */
const COACH_LENGTH = 8;

const RACE_MINUTES: Record<string, number> = {
  "5K": 30,
  "10K": 60,
  Half: 120,
  Marathon: 240,
  "Trail 50K": 360,
  "Ultra 100K": 600
};

const EXERCISES: Partial<Record<WorkoutSport, readonly string[]>> = {
  strength: ["Squat", "Push-up", "Plank"],
  hyrox: ["SkiErg", "Sled Push", "Wall Ball"]
};

type Role = "long" | "easy" | "quality" | "shakeout" | "race";

interface Slot {
  dayIndex: number;
  /** The most a session on this day may take, in minutes. */
  cap: number;
  long: boolean;
  flex: boolean;
}

interface Session {
  dayIndex: number;
  minutes: number;
  role: Role;
  sport: WorkoutSport;
}

const roundDown5 = (minutes: number) => Math.floor(minutes / 5) * 5;

function raceDate(request: TrainingPlanGenerationRequest): Date | undefined {
  return request.goalKind === "race" && request.race?.date ? parsePlanDay(request.race.date) : undefined;
}

/** Monday 0 … Sunday 6. */
function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * The days a session may go on, in the order they are filled: the athlete's
 * fixed days, then the days Coach may use; left to Coach, the long day first
 * and the rest spread through the week.
 */
function slots(request: TrainingPlanGenerationRequest): Slot[] {
  const week = request.week;
  if (week.mode === "days") {
    const all = week.days.flatMap((day, dayIndex) =>
      day.kind === "rest"
        ? []
        : [{ dayIndex, cap: day.minutes ?? (day.kind === "long" ? 150 : 75), long: day.kind === "long", flex: day.kind === "flex" }]
    );
    return [...all.filter((slot) => !slot.flex), ...all.filter((slot) => slot.flex)];
  }
  const open = [0, 1, 2, 3, 4, 5, 6].filter((day) => !week.blockedDayIndexes.includes(day));
  const longDay = open.includes(5) ? 5 : open.at(-1);
  const order = [longDay, 1, 3, 6, 2, 4, 0, 5].filter((day, at, list): day is number =>
    day !== undefined && open.includes(day) && list.indexOf(day) === at
  );
  const perSession = (count: number) =>
    week.hours?.max !== undefined ? Math.max(TRAINING_PLAN_GENERATION_LIMITS.minSessionMinutes, roundDown5((week.hours.max * 60) / count)) : undefined;
  const count = week.sessionsPerWeek ?? Math.min(4, order.length);
  const ceiling = perSession(Math.max(1, count));
  return order.map((dayIndex) => {
    const cap = dayIndex === longDay ? 120 : 75;
    return { dayIndex, cap: ceiling ? Math.min(cap, ceiling) : cap, long: dayIndex === longDay, flex: false };
  });
}

/** How many sessions a usual week holds: the athlete's fixed days, or their answer, or four. */
function usualCount(request: TrainingPlanGenerationRequest, available: number): number {
  const band = weekCountBand(request, false);
  const week = request.week;
  const wanted = week.mode === "coach" && week.sessionsPerWeek === undefined ? Math.min(4, available) : band.min;
  return Math.max(1, Math.min(wanted, band.max));
}

function stagesFor(request: TrainingPlanGenerationRequest, weekCount: number): TrainingPlanWeekStage[] {
  const race = raceDate(request) !== undefined;
  return Array.from({ length: weekCount }, (_, index) => {
    if (race && index === weekCount - 1) return 5;
    if (race && weekCount >= 3 && index === weekCount - 2) return 4;
    const building = race ? Math.ceil((weekCount - 1) * 0.45) : Math.ceil(weekCount * (request.goalKind === "return" ? 0.6 : 0.5));
    return (index < building ? 2 : 3) as TrainingPlanWeekStage;
  });
}

function isLighter(index: number, weekCount: number, stage: number): boolean {
  return index % 4 === 3 && index !== weekCount - 1 && stage !== 5;
}

/** The sports sessions are written in: endurance ones carry the week, a strength sport takes one day of it. */
function sportPicker(request: TrainingPlanGenerationRequest) {
  const endurance = request.sports.filter((sport) => !WORKOUT_SPORT_CAPABILITIES[sport].requiresExercise);
  const other = request.sports.filter((sport) => WORKOUT_SPORT_CAPABILITIES[sport].requiresExercise);
  const main = endurance[0] ?? request.sports[0] ?? "run";
  return (role: Role, position: number, weekIndex: number, lastEasy = false): WorkoutSport => {
    if (role === "race") return request.sports.includes("run") ? "run" : main;
    if (!endurance.length) return other[(position + weekIndex) % other.length] ?? main;
    if (role === "long" || role === "quality" || role === "shakeout") return main;
    if (other.length && lastEasy) return other[weekIndex % other.length];
    return endurance[(position + weekIndex) % endurance.length];
  };
}

/**
 * One week's sessions. `planned` is the accepted outline's count and hours for
 * the week, which the sessions are fitted to; without it the week is built
 * from the request alone, which is how the outline was.
 */
function weekSessions(
  request: TrainingPlanGenerationRequest,
  index: number,
  weekCount: number,
  stage: number,
  planned?: { sessions: number; hours: number }
): Session[] {
  const all = slots(request);
  const pick = sportPicker(request);
  const race = raceDate(request);
  const limits = TRAINING_PLAN_GENERATION_LIMITS;

  if (race && index === weekCount - 1) {
    const raceDay = weekdayOf(race);
    const band = weekCountBand(request, true);
    const before = all.filter((slot) => slot.dayIndex < raceDay).sort((a, b) => a.dayIndex - b.dayIndex);
    const extra = Math.max(0, Math.min(before.length, planned ? planned.sessions - 1 : Math.min(2, band.max - 1)));
    const shakeouts = before.slice(0, extra).map((slot, position) => ({
      dayIndex: slot.dayIndex,
      minutes: Math.max(limits.minSessionMinutes, Math.min(slot.cap, 25)),
      role: "shakeout" as const,
      sport: pick("shakeout", position, index)
    }));
    const minutes = RACE_MINUTES[request.race?.distance ?? ""] ?? 90;
    return [...shakeouts, { dayIndex: raceDay, minutes, role: "race", sport: pick("race", extra, index) }];
  }

  const count = planned?.sessions ?? usualCount(request, all.length);
  const chosen = Array.from({ length: count }, (_, at) => all[at % Math.max(1, all.length)]).filter(Boolean);
  const factor = (0.7 + 0.25 * (index / Math.max(1, weekCount - 1))) * (isLighter(index, weekCount, stage) ? 0.75 : 1);
  const ordered = chosen.sort((a, b) => a.dayIndex - b.dayIndex);
  const roles = ordered.map((slot, position): Role => (slot.long ? "long" : stage >= 3 && position === 1 ? "quality" : "easy"));
  /* A strength sport beside an endurance one takes the week's last easy day. */
  const lastEasy = roles.lastIndexOf("easy");
  let sessions = ordered.map((slot, position): Session => {
    const role = roles[position];
    const floor = Math.min(slot.cap, 20);
    const minutes = Math.min(slot.cap, Math.max(floor, roundDown5(slot.cap * factor * (slot.long ? 1 : 0.85))));
    return { dayIndex: slot.dayIndex, minutes: Math.max(limits.minSessionMinutes, minutes), role, sport: pick(role, position, index, position === lastEasy) };
  });
  if (planned && sessions.length) {
    /* Fitted to the outline's hours, as far as each day's time allows. */
    const total = sessions.reduce((sum, session) => sum + session.minutes, 0);
    const scale = (planned.hours * 60) / Math.max(1, total);
    sessions = sessions.map((session, at) => {
      const cap = chosen.find((slot) => slot.dayIndex === session.dayIndex)?.cap ?? session.minutes;
      const minutes = Math.round((session.minutes * scale) / 5) * 5;
      return { ...session, minutes: Math.max(limits.minSessionMinutes, Math.min(cap, minutes)), role: sessions[at].role };
    });
  }
  return sessions;
}

function weekCountFor(request: TrainingPlanGenerationRequest): number {
  return requestedPlanWeeks(request) ?? COACH_LENGTH;
}

const STAGE_SLUG = (stage: number) => COROS_WEEK_STAGES.find((candidate) => candidate.value === stage)?.slug ?? "base";

const SESSION_NAMES: Record<Role, string> = {
  long: "Long",
  easy: "Easy",
  quality: "Tempo intervals",
  shakeout: "Shakeout",
  race: "Race"
};

function sessionName(session: Session, request: TrainingPlanGenerationRequest): string {
  if (session.role === "race") return `Race: ${request.race?.distance || request.goal.trim() || "race day"}`;
  if (WORKOUT_SPORT_CAPABILITIES[session.sport].requiresExercise) return `${formatWorkoutSport(session.sport)} circuit`;
  const sport = formatWorkoutSport(session.sport).toLowerCase();
  return session.role === "quality" ? `Tempo intervals (${sport})` : `${SESSION_NAMES[session.role]} ${sport}`;
}

const FOCUS: Record<number, string> = {
  2: "Easy volume that the weeks after can stand on.",
  3: "More time, and one session with some quality in it.",
  4: "The hardest week, then it eases off.",
  5: "Freshen up: short and easy, then the race."
};

/**
 * What a model would hand `propose_plan_outline`. A revision's note is read
 * only to say it was, since nothing here can act on words.
 */
export function simulatedOutlineArgs(request: TrainingPlanGenerationRequest, note?: string): Record<string, unknown> {
  const weekCount = weekCountFor(request);
  const stages = stagesFor(request, weekCount);
  const weeks = stages.map((stage, index) => {
    const sessions = weekSessions(request, index, weekCount, stage);
    const minutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
    const key = sessions.filter((session) => session.role !== "easy" && session.role !== "shakeout").slice(0, 2);
    return {
      week: index + 1,
      stage: STAGE_SLUG(stage),
      lighter: isLighter(index, weekCount, stage),
      hours: Math.round((minutes / 60) * 10) / 10,
      sessions: sessions.length,
      focus: isLighter(index, weekCount, stage) ? "A lighter week to absorb the ones before it." : FOCUS[stage] ?? "",
      key_sessions: key.map((session) => ({
        day: PLAN_WEEKDAYS[session.dayIndex],
        name: sessionName(session, request),
        sport: session.sport,
        minutes: session.minutes
      }))
    };
  });
  const noted = note?.trim() ? ` It was asked to change "${note.trim()}", which a script cannot read, so it is drawn the same way.` : "";
  return {
    summary: `Simulated outline — no AI was asked. ${weekCount} weeks built from the week you set, rising gently with a lighter week every fourth.${noted}`,
    basis: "Nothing: this run is simulated (HERACLES_SIMULATE_PLAN_AI), so none of your training was read.",
    weeks
  };
}

function timedStep(
  sport: WorkoutSport,
  kind: "warmup" | "training" | "cooldown" | "rest",
  minutes: number,
  options: { exerciseName?: string; insideRepeat?: boolean } = {}
): RunWorkoutCreateStep {
  const { exerciseName, insideRepeat } = options;
  const defaults = resolveStepDefaults({ sport, stepKind: kind, insideRepeat, ...(exerciseName ? { exerciseName } : {}) });
  return {
    kind,
    target_type: "time",
    target_duration_seconds: Math.round(minutes * 60),
    intensity: defaults.intensity,
    ...(exerciseName ? { exercise_name: exerciseName } : {})
  };
}

function sessionSteps(session: Session): RunWorkoutStepInput[] {
  const { sport, minutes, role } = session;
  const exercises = EXERCISES[sport];
  if (WORKOUT_SPORT_CAPABILITIES[sport].requiresExercise && exercises) {
    const warm = Math.min(10, Math.max(5, roundDown5(minutes / 4)));
    const each = Math.max(1, (minutes - warm) / exercises.length);
    return [timedStep(sport, "warmup", warm), ...exercises.map((name) => timedStep(sport, "training", each, { exerciseName: name }))];
  }
  if (role === "race" || minutes < 30) return [timedStep(sport, "training", minutes)];
  if (role === "quality" && minutes >= 37) {
    const reps = Math.max(2, Math.floor((minutes - 25) / 6));
    const warm = minutes - 10 - reps * 6;
    return [
      timedStep(sport, "warmup", warm),
      { repeat: reps, steps: [timedStep(sport, "training", 4, { insideRepeat: true }), timedStep(sport, "rest", 2, { insideRepeat: true })] },
      timedStep(sport, "cooldown", 10)
    ];
  }
  return [timedStep(sport, "warmup", 10), timedStep(sport, "training", minutes - 15), timedStep(sport, "cooldown", 5)];
}

/**
 * What a model would hand `draft_training_plan`: every session dated and
 * timed, fitted to the accepted outline when there is one. `flawed` leaves
 * the first week one session short of it — what a model's first draft often
 * is — so the check's hand-back and the fix after it can be watched.
 */
export function simulatedDraftArgs(request: TrainingPlanGenerationRequest, options: { flawed?: boolean } = {}): Record<string, unknown> {
  const outline: TrainingPlanOutline | undefined = request.outline;
  const weekCount = outline?.weeks.length ?? weekCountFor(request);
  const stages = outline ? outline.weeks.map((week) => week.stage) : stagesFor(request, weekCount);
  const workouts: PlanWorkoutEntryInput[] = [];
  stages.forEach((stage, index) => {
    const planned = outline?.weeks[index];
    let sessions = weekSessions(request, index, weekCount, stage, planned && { sessions: planned.sessions, hours: planned.hours });
    if (options.flawed && index === 0 && outline) sessions = sessions.slice(0, -1);
    const monday = addPlanWeeks(request.startDate, index);
    for (const session of sessions) {
      const date = parsePlanDay(monday)!;
      date.setDate(date.getDate() + session.dayIndex);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      workouts.push({
        key: `w${index + 1}-${session.dayIndex}`,
        name: sessionName(session, request),
        description: "Simulated session — no AI wrote this.",
        sport: session.sport,
        steps: sessionSteps(session),
        schedule_date: iso,
        save_to_library: false
      });
    }
  });
  const title = request.goalKind === "race"
    ? `${request.race?.distance || "Race"} plan`
    : request.goalKind === "other"
      ? "My goal plan"
      : { base: "Base build", return: "Comeback", hybrid: "Strength & hybrid" }[request.goalKind];
  return {
    name: `${title} (simulated)`,
    description: `Simulated plan — no AI wrote this, and none of your training was read. ${weekCount} weeks from the week you set, to check the generator end to end.`,
    week_stages: stages.map((stage, index) => ({ week: index + 1, stage: STAGE_SLUG(stage) })),
    workouts
  };
}

/**
 * A draft whose exercise names COROS could not match, with each one swapped
 * for the first candidate COROS offered — what a model does with the same
 * answer. A name with no candidate at all takes its step out.
 */
export function withExerciseCandidates(
  args: Record<string, unknown>,
  issues: readonly { workout_key: string; exercise_name: string; candidates: readonly string[] }[]
): Record<string, unknown> {
  const workouts = (args.workouts as PlanWorkoutEntryInput[]).map((workout) => {
    const mine = issues.filter((issue) => issue.workout_key === workout.key);
    if (!mine.length || !workout.steps) return workout;
    const steps = workout.steps.flatMap((step): RunWorkoutStepInput[] => {
      if ("steps" in step) return [step];
      const issue = mine.find((candidate) => candidate.exercise_name === step.exercise_name);
      if (!issue) return [step];
      return issue.candidates[0] ? [{ ...step, exercise_name: issue.candidates[0] }] : [];
    });
    return { ...workout, steps };
  });
  return { ...args, workouts };
}

/**
 * The thinking a turn shows, as a model's summary would read: a heading per
 * thing it turns to, and a line about it. The first says the run is simulated,
 * so the screen never passes a script off as Coach.
 */
export function simulatedThinking(kind: "outline" | "plan", request: TrainingPlanGenerationRequest): string[] {
  const weekCount = request.outline?.weeks.length ?? weekCountFor(request);
  const week = request.week;
  const weekLine = week.mode === "days"
    ? `${week.days.filter((day) => day.kind === "train" || day.kind === "long").length} fixed days, ${week.days.filter((day) => day.kind === "flex").length} Coach may use.`
    : `Left to Coach, with ${week.blockedDayIndexes.length ? `${week.blockedDayIndexes.map((day) => PLAN_WEEKDAYS[day]).join(", ")} blocked` : "no day blocked"}.`;
  const opening = "**Simulated run — no AI is called**\n\nHERACLES_SIMULATE_PLAN_AI is set, so this turn is scripted: nothing of your training is read and no provider is asked.\n\n";
  if (kind === "outline") {
    return [
      opening,
      `**Weighing the week you set**\n\n${weekLine}\n\n`,
      `**Choosing the length**\n\n${request.goalKind === "race" ? `Race day decides it: ${weekCount} weeks.` : request.weeks ? `You set ${weekCount} weeks.` : `Left to Coach: ${weekCount} weeks.`}\n\n`,
      "**Shaping the weeks**\n\nBase first, then build, with every fourth week lighter so the load can settle.\n\n"
    ];
  }
  return [
    opening,
    `**Reading the outline**\n\n${weekCount} weeks, each with its count and its hours to write to.\n\n`,
    "**Placing the sessions**\n\nThe long session on the long day, one with some quality once the build starts, the rest easy.\n\n"
  ];
}
