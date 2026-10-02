// The Hall of Records' memory (`athlete_milestones`).
//
// Nearly every milestone is worked out again on every launch from the activity
// list, which COROS keeps for good. What lands here is the rest — a milestone
// whose source forgets it:
//
//   * **VO2max.** The snapshot carries a year of readings. Without a memory the
//     first reading would walk forward with the window, and "five above your
//     first" would be measured from a different first every month.
//   * **Sleep.** COROS keeps about nine weeks of nights; this machine keeps 400
//     days and another machine only what it has fetched itself.
//   * **Plans.** A finished run of a plan is in COROS's list today and in the
//     plan cache here, and neither promises to hold it for ever.
//
// The renderer works out the first two and hands them over (`rememberMilestones`);
// plan runs are worked out here, from the cache and the stored matches, the
// two things the Library's compliance figure is read from already. Every row
// is `personal`, so the other machine shows the same labours.

import {
  listAthleteMilestones,
  listCorosPlanCache,
  listTrainingActivityMatches,
  rememberAthleteMilestones,
  type AthleteMilestoneRow
} from "./database";
import { planCompliance } from "./planCompliance";
import type { RememberedMilestone, TrainingPlanDocument } from "./types";

/** The kinds the renderer may write. Plan runs are this module's alone. */
const RENDERER_KINDS = new Set(["vo2max", "sleep"]);

/** A plan run shorter than this is a block, not a plan, and earns nothing. */
export const PLAN_MILESTONE_MIN_WEEKS = 4;
/** And one kept less than this was started, not completed. */
export const PLAN_MILESTONE_MIN_RATIO = 0.8;

const MILESTONE_ID = /^[a-z0-9]+(?::[A-Za-z0-9._-]+)+$/;
const HAPPEN_DAY = /^\d{8}$/;
const MAX_PAYLOAD_BYTES = 2048;

function toRemembered(row: AthleteMilestoneRow): RememberedMilestone {
  return {
    id: row.id,
    kind: row.kind as RememberedMilestone["kind"],
    day: row.happenDay,
    data: row.payload,
    recordedAt: row.recordedAt
  };
}

function happenDayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

/**
 * The day a plan run's last session fell on: its week 1 Monday plus the
 * furthest session's week and day. Nothing when the run has no start or no
 * sessions to count from.
 */
export function planRunLastDay(plan: TrainingPlanDocument): string | undefined {
  if (!plan.startDate || plan.entries.length === 0) return undefined;
  const [year, month, day] = plan.startDate.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const last = plan.entries.reduce(
    (furthest, entry) => Math.max(furthest, entry.weekIndex * 7 + entry.dayIndex),
    0
  );
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + last);
  return happenDayOf(date);
}

/**
 * Every finished plan run that earns a milestone: on the calendar to its last
 * day (COROS's `finished`, never a run taken off early, which reads `stopped`),
 * four weeks or more, and kept at 80% or better of the sessions that settled.
 */
export function finishedPlanMilestones(
  plans: readonly TrainingPlanDocument[],
  matches: Parameters<typeof planCompliance>[1]
): Array<Omit<AthleteMilestoneRow, "recordedAt">> {
  const rows: Array<Omit<AthleteMilestoneRow, "recordedAt">> = [];
  for (const plan of plans) {
    if (plan.calendar !== "finished" || !plan.remoteId) continue;
    if (plan.weekCount < PLAN_MILESTONE_MIN_WEEKS) continue;
    const compliance = planCompliance(plan, matches);
    if (!compliance || compliance.ratio === undefined) continue;
    if (compliance.ratio < PLAN_MILESTONE_MIN_RATIO) continue;
    const happenDay = planRunLastDay(plan);
    if (!happenDay) continue;
    rows.push({
      id: `plan:${plan.remoteId}`,
      kind: "plan",
      happenDay,
      payload: {
        name: plan.name,
        weeks: plan.weekCount,
        ratio: Math.round(compliance.ratio * 1000) / 1000,
        done: compliance.done,
        settled: compliance.settled
      }
    });
  }
  return rows;
}

/**
 * Everything remembered, with the plan runs the cache can vouch for written
 * first. A plan run is only ever added: one the cache no longer holds stays.
 */
export function listRememberedMilestones(): RememberedMilestone[] {
  try {
    rememberAthleteMilestones(
      finishedPlanMilestones(listCorosPlanCache(), listTrainingActivityMatches())
    );
  } catch {
    // The cache or the matches could not be read; what is already remembered
    // is still the answer.
  }
  return listAthleteMilestones().map(toRemembered);
}

/**
 * Keep what the renderer worked out from a source that forgets. Only its own
 * kinds, only well-formed rows; anything else is dropped rather than refused,
 * so one odd row does not cost the rest. Answers how many rows moved.
 */
export function rememberMilestones(entries: unknown): number {
  if (!Array.isArray(entries)) return 0;
  const rows: Array<Omit<AthleteMilestoneRow, "recordedAt">> = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { id, kind, day, data } = entry as Partial<RememberedMilestone>;
    if (typeof kind !== "string" || !RENDERER_KINDS.has(kind)) continue;
    if (typeof id !== "string" || !MILESTONE_ID.test(id) || !id.startsWith(`${kind}:`)) continue;
    if (typeof day !== "string" || !HAPPEN_DAY.test(day)) continue;
    const payload =
      data && typeof data === "object" && !Array.isArray(data) ? data : {};
    if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) continue;
    rows.push({ id, kind, happenDay: day, payload });
  }
  return rows.length > 0 ? rememberAthleteMilestones(rows) : 0;
}
