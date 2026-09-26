/**
 * Coach's change to a creation it already made, as a list of operations
 * rather than the whole plan again (docs/coach-plan-canvas.md, P1.2, D11).
 *
 * A version is turned back into the arguments `draft_training_plan` takes,
 * the operations are applied to those, and the result goes through exactly
 * the checks a new draft does — so a revision can be refused for the same
 * reasons, and in the same words, as the plan it revises. Pure: the store,
 * the checks and the card are the caller's.
 */
import type { CorosTrainingPlanDraft } from "./corosWorkoutBuilder";
import {
  COROS_WEEK_STAGES,
  formatPlanDay,
  mondayOf,
  parsePlanDay
} from "./trainingPlanDomain";

export const PLAN_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const PLAN_REVISION_OPS = [
  "move_session",
  "replace_session",
  "remove_session",
  "add_session",
  "set_week_stage",
  "rename",
  "set_description"
] as const;

export type PlanRevisionOp = (typeof PLAN_REVISION_OPS)[number];

/** Only these apply to a one-off workout: it has one session and no weeks. */
const WORKOUT_OPS: ReadonlySet<string> = new Set(["replace_session", "rename"]);

type DraftArgs = Record<string, unknown> & {
  name: string;
  description?: string;
  week_stages: { week: number; stage: string }[];
  workouts: Record<string, unknown>[];
};

/** A stored plan as the arguments `draft_training_plan` would have been given. */
export function planAsDraftArgs(plan: CorosTrainingPlanDraft): DraftArgs {
  return {
    name: plan.name,
    ...(plan.description ? { description: plan.description } : {}),
    week_stages: (plan.weekStages ?? []).flatMap((item) => {
      const stage = COROS_WEEK_STAGES.find((candidate) => candidate.value === item.stage);
      return stage && stage.value > 0 ? [{ week: item.weekIndex + 1, stage: stage.slug }] : [];
    }),
    workouts: plan.workouts.map((workout) => {
      const placed = plan.layout?.[workout.key];
      return {
        ...structuredClone(workout),
        ...(placed && !workout.schedule_date
          ? { week: placed.weekIndex + 1, day: PLAN_DAYS[placed.dayIndex] }
          : {})
      };
    })
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Applies `ops` in order to `args`, returning the revised arguments, or every
 * operation that could not be applied — then nothing is applied, since half a
 * revision is a version nobody asked for.
 */
export function applyPlanRevision(
  base: DraftArgs,
  ops: unknown,
  artifactType: "plan" | "workout"
): { ok: true; args: DraftArgs } | { ok: false; errors: string[] } {
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, errors: ["ops must list at least one change."] };
  }
  const args: DraftArgs = structuredClone(base);
  const errors: string[] = [];
  const dated = args.workouts.length > 0 && args.workouts.every((workout) => Boolean(workout.schedule_date));
  // A dated plan is counted from the Monday of its first session, the rule
  // an edit in the plan editor keeps too.
  const firstDay = args.workouts
    .map((workout) => parsePlanDay(String(workout.schedule_date ?? "")))
    .filter((day): day is Date => Boolean(day))
    .sort((left, right) => left.valueOf() - right.valueOf())[0];
  const anchor = firstDay ? mondayOf(firstDay) : undefined;

  const find = (key: string) => args.workouts.findIndex((workout) => workout.key === key);
  const nameOf = (index: number) => String(args.workouts[index]?.name ?? args.workouts[index]?.key);

  /** Where a session goes: a week and a day, or — on a dated plan — a date. */
  const placement = (
    op: Record<string, unknown>,
    label: string
  ): Record<string, unknown> | undefined => {
    const week = Number(op.week);
    const day = PLAN_DAYS.indexOf(String(op.day ?? "").toLowerCase() as (typeof PLAN_DAYS)[number]);
    const date = String(op.schedule_date ?? "").replace(/-/g, "");
    if (date) {
      if (!dated) {
        errors.push(`${label}: this plan is placed by week and day, not by date; give week and day.`);
        return undefined;
      }
      if (!parsePlanDay(date)) {
        errors.push(`${label}: schedule_date must be YYYYMMDD.`);
        return undefined;
      }
      return { schedule_date: date };
    }
    if (!Number.isInteger(week) || week < 1 || week > 52 || day < 0) {
      errors.push(`${label}: needs week (1–52) and day (mon…sun).`);
      return undefined;
    }
    if (dated && anchor) {
      const target = new Date(anchor);
      target.setDate(target.getDate() + (week - 1) * 7 + day);
      return { schedule_date: formatPlanDay(target, false) };
    }
    return { week, day: PLAN_DAYS[day] };
  };

  /** A workout as the model wrote it, without anything that places it. */
  const workoutOf = (value: unknown, label: string): Record<string, unknown> | undefined => {
    if (!isRecord(value) || !text(value.name)) {
      errors.push(`${label}: workout needs at least a name, and its steps.`);
      return undefined;
    }
    const {
      schedule_date: _date,
      week: _week,
      day: _day,
      sort_no: _sortNo,
      save_to_library: _library,
      ...workout
    } = value;
    return workout;
  };

  ops.forEach((raw, index) => {
    const label = `ops[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${label}: each change is an object with an op.`);
      return;
    }
    const op = String(raw.op ?? "");
    if (!(PLAN_REVISION_OPS as readonly string[]).includes(op)) {
      errors.push(`${label}: unknown op "${op}". Use one of ${PLAN_REVISION_OPS.join(", ")}.`);
      return;
    }
    if (artifactType === "workout" && !WORKOUT_OPS.has(op)) {
      errors.push(`${label}: a single workout takes only replace_session and rename.`);
      return;
    }
    const key = text(raw.key);
    switch (op as PlanRevisionOp) {
      case "move_session": {
        const at = find(key);
        if (at < 0) {
          errors.push(`${label}: no session with key "${key}".`);
          return;
        }
        const where = placement(raw, `${label} (${nameOf(at)})`);
        if (!where) return;
        const { schedule_date: _date, week: _week, day: _day, ...rest } = args.workouts[at];
        args.workouts[at] = { ...rest, ...where };
        return;
      }
      case "replace_session": {
        // A workout has one session, so its key may be left out.
        const at = artifactType === "workout" && !key ? 0 : find(key);
        if (at < 0) {
          errors.push(`${label}: no session with key "${key}".`);
          return;
        }
        const workout = workoutOf(raw.workout, `${label} (${nameOf(at)})`);
        if (!workout) return;
        const current = args.workouts[at];
        args.workouts[at] = {
          ...workout,
          // The session keeps its identity and its place; only the workout changes.
          key: current.key,
          ...(current.schedule_date ? { schedule_date: current.schedule_date } : {}),
          ...(current.week !== undefined ? { week: current.week, day: current.day } : {}),
          ...(current.sort_no !== undefined ? { sort_no: current.sort_no } : {}),
          ...(current.save_to_library !== undefined ? { save_to_library: current.save_to_library } : {})
        };
        return;
      }
      case "remove_session": {
        const at = find(key);
        if (at < 0) {
          errors.push(`${label}: no session with key "${key}".`);
          return;
        }
        if (args.workouts.length === 1) {
          errors.push(`${label}: that is the plan's only session; a plan needs at least one.`);
          return;
        }
        args.workouts.splice(at, 1);
        return;
      }
      case "add_session": {
        const workout = workoutOf(raw.workout, label);
        if (!workout) return;
        const where = placement(raw, `${label} (${String(workout.name)})`);
        if (!where) return;
        let newKey = text(workout.key);
        if (!newKey || find(newKey) >= 0) {
          let counter = args.workouts.length + 1;
          while (find(`session-${counter}`) >= 0) counter += 1;
          newKey = `session-${counter}`;
        }
        args.workouts.push({ ...workout, key: newKey, ...where });
        return;
      }
      case "set_week_stage": {
        const week = Number(raw.week);
        const stage = COROS_WEEK_STAGES.find((candidate) => candidate.slug === raw.stage);
        if (!Number.isInteger(week) || week < 1 || !stage) {
          errors.push(
            `${label}: needs week (from 1) and stage (${COROS_WEEK_STAGES.map((item) => item.slug).join(", ")}).`
          );
          return;
        }
        args.week_stages = args.week_stages.filter((item) => item.week !== week);
        if (stage.value > 0) args.week_stages.push({ week, stage: stage.slug });
        args.week_stages.sort((left, right) => left.week - right.week);
        return;
      }
      case "rename": {
        const name = text(raw.name);
        if (!name) {
          errors.push(`${label}: rename needs a name.`);
          return;
        }
        args.name = name;
        // A workout's card is named after its one session.
        if (artifactType === "workout" && args.workouts[0]) args.workouts[0].name = name;
        return;
      }
      case "set_description": {
        const description = text(raw.description);
        if (description) args.description = description;
        else delete args.description;
        return;
      }
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, args };
}
