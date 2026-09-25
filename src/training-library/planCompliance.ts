/**
 * How a plan on the calendar is going, as one figure on its row.
 *
 * This replaces the Adherence tab. Adherence was never an entity — it is a
 * fact *about a plan*, and only a plan schedules sessions to keep or miss.
 *
 * **The join is COROS's own identity.** A plan put on the calendar becomes an
 * instance, and every session COROS puts on the calendar for it carries the
 * instance's id as `planId` and the session's `idInPlan` — the same pair a
 * `TrainingActivityMatch` records as `schedulePlanId` / `scheduleIdInPlan`.
 *
 * Renderer-side and pure, for the reason `activityFilters.ts` sits outside
 * `ActivitiesView`: it is the only part of this a test can reach.
 */
import type {
  TrainingActivityMatch,
  TrainingPlanDocument
} from "../../electron/types";

export interface PlanCompliance {
  /** Live occurrences of this plan the matcher has an opinion about. */
  planned: number;
  /** Of those, the ones whose day has passed. */
  settled: number;
  /** Completed or partial — it was trained, not missed. */
  done: number;
  missed: number;
  skipped: number;
  upcoming: number;
  /**
   * done / settled, 0–1. `undefined` while nothing has settled, because a plan
   * whose every session is still ahead has not been kept *or* missed, and 0%
   * is the one number an athlete would read as failure.
   */
  ratio?: number;
}

/** `schedulePlanId:scheduleIdInPlan` — what a calendar session and a match share. */
function scheduleKey(
  entry: Pick<TrainingActivityMatch, "schedulePlanId" | "scheduleIdInPlan">
): string {
  return `${entry.schedulePlanId}:${entry.scheduleIdInPlan}`;
}

/**
 * The calendar entries a plan owns: an instance's sessions, keyed as COROS
 * keys them. A plan that is not on the calendar owns none — its running copy,
 * if it has one, is a plan of its own with its own sessions.
 */
export function planScheduleKeys(plan: TrainingPlanDocument): Set<string> {
  if (plan.calendar === "unscheduled" || !plan.remoteId) return new Set();
  return new Set(
    plan.entries.flatMap((entry) => (entry.idInPlan ? [`${plan.remoteId}:${entry.idInPlan}`] : []))
  );
}

/**
 * `undefined` for a plan with nothing on the calendar — which is a different
 * statement from 0%, and the one the row has to make.
 */
export function planCompliance(
  plan: TrainingPlanDocument,
  matches: readonly TrainingActivityMatch[]
): PlanCompliance | undefined {
  const owned = planScheduleKeys(plan);
  if (!owned.size) return undefined;

  const ours = matches.filter((match) => owned.has(scheduleKey(match)));
  if (!ours.length) return undefined;

  const count = (status: TrainingActivityMatch["status"]) =>
    ours.filter((match) => match.status === status).length;

  const upcoming = count("upcoming");
  /* A rescheduled session moved; it is settled, and it was not trained here. */
  const done = count("completed") + count("partial");

  return {
    planned: ours.length,
    settled: ours.length - upcoming,
    done,
    missed: count("missed"),
    skipped: count("skipped"),
    upcoming,
    ratio: ours.length - upcoming > 0 ? done / (ours.length - upcoming) : undefined
  };
}

/** `86%`, or nothing at all — never a zero standing in for "not yet asked". */
export function formatCompliance(compliance: PlanCompliance | undefined): string | null {
  if (compliance?.ratio === undefined) return null;
  return `${Math.round(compliance.ratio * 100)}%`;
}

/** The sentence under the figure: what the percentage is made of. */
export function describeCompliance(compliance: PlanCompliance | undefined): string | null {
  if (!compliance) return null;
  if (compliance.ratio === undefined) {
    return compliance.upcoming === 1
      ? "1 session ahead"
      : `${compliance.upcoming} sessions ahead`;
  }
  const parts = [`${compliance.done} done`];
  if (compliance.missed) parts.push(`${compliance.missed} missed`);
  if (compliance.skipped) parts.push(`${compliance.skipped} skipped`);
  if (compliance.upcoming) parts.push(`${compliance.upcoming} ahead`);
  return parts.join(" · ");
}
