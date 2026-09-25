/**
 * Everything the Plans tab decides before it draws anything: what the filter
 * chips are, which plans a filter leaves, which section each is listed under,
 * what a start date reads as, and what an empty list says. The order is
 * `libraryOrder.ts`'s, which the Workouts tab shares.
 *
 * It sits outside the view for the reason `activityFilters.ts` sits outside
 * `ActivitiesView` — it is the only part of a list screen a test can reach.
 * Nothing here imports React, `lucide-react` or a stylesheet, so the suite can
 * run it directly.
 *
 * One of these answers was wrong in the view and could not be seen: an
 * athlete who had archived everything they owned was told they had no plans
 * and offered a Create button.
 */
import type { TrainingPlanDocument, TrainingPlanDraftRecord } from "../../electron/types";

/**
 * Where a plan came from, when that is worth saying. Every plan is a COROS
 * plan now, so the one provenance left to name is the coach's.
 */
export function planOriginLabel(plan: Pick<TrainingPlanDocument, "origin">): string | undefined {
  return plan.origin === "coach" ? "Coach" : undefined;
}

/**
 * The plans the library lists: everything but a run taken off the calendar.
 *
 * Such a run is still in COROS's list, but there is nothing left to do with
 * it — COROS will not put it back on the calendar — and the plan it came from,
 * where there is one, is the row that stands for it. A run that ran out stays,
 * under Done, as the record of what was trained.
 */
export function listedPlans(plans: readonly TrainingPlanDocument[]): TrainingPlanDocument[] {
  return plans.filter((plan) => plan.calendar !== "stopped");
}

/**
 * Whether a running copy stands for a plan that is no longer in the athlete's
 * COROS plans — deleted there, or applied straight from COROS's catalogue.
 * Taking it off the calendar then leaves nothing to list, which the removal
 * says before it is made.
 */
export function runOutlivesItsPlan(
  plan: TrainingPlanDocument,
  plans: readonly TrainingPlanDocument[]
): boolean {
  if (plan.calendar !== "running") return false;
  return !plans.some((other) => other.calendar === "unscheduled" && other.remoteId === plan.sourcePlanId);
}

/**
 * What the Plans tab can narrow to: **where a plan came from, and nothing
 * else.** States — running, finished, archived — are sections `groupPlans`
 * builds, because a state is something the list can show; provenance is the
 * one thing a plan cannot be grouped into. With local plans gone, what is left
 * is the coach's.
 */
export const PLAN_SCOPES = ["all", "coach"] as const;

export type PlanScope = (typeof PLAN_SCOPES)[number];

/**
 * Where a plan stands against today, which is what decides the section it is
 * listed under.
 *
 * `undated` is the absence of a start date and is not a stage of anything: a
 * plan without one has not been placed on the calendar yet, and that is all it
 * means — it goes on the calendar like any other. The other three are one interval:
 * a plan runs for `weekCount` weeks from `startDate`, so today is before it,
 * inside it, or past it.
 *
 * **Judged by the calendar, not by what was trained.** Compliance is a
 * different question and most plans have no answer to it (`planCompliance`
 * returns `undefined` for a plan not on the calendar), so a plan that
 * ended a month ago with nothing recorded is still over.
 *
 * **A run taken off the calendar is not done.** COROS reports it with the same
 * status as one that ran out (`calendar: "stopped"` is how the two are told
 * apart). It is `undated` here: it is on no calendar, and its start date says
 * where it would have been rather than where it is.
 */
export type PlanLifecycle = "undated" | "upcoming" | "active" | "done";

/** Midnight local, so a plan starting today is active rather than upcoming. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * `YYYY-MM-DD` at midday local — the hour `planStartLabel` already reads it
 * at, so a plan's date means the same day on both. Midday, because midnight
 * parsed in one zone and printed in another can land on the day before.
 */
function planStartDate(plan: TrainingPlanDocument): Date | undefined {
  if (!plan.startDate) return undefined;
  const date = new Date(`${plan.startDate}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? undefined : startOfDay(date);
}

/**
 * `today` is a parameter rather than a call to `new Date()`, for the reason
 * `getLocalHappenDayKey` takes one: a test cannot move the clock, and a
 * function that reads it cannot be asked about a plan that ends tomorrow.
 */
export function planLifecycle(
  plan: TrainingPlanDocument,
  today: Date = new Date()
): PlanLifecycle {
  if (plan.calendar === "finished") return "done";
  if (plan.calendar === "stopped") return "undated";
  const start = planStartDate(plan);
  if (!start) return "undated";
  const midnight = startOfDay(today);
  if (midnight < start) return "upcoming";
  const end = new Date(start);
  /* The day after the last one, so a plan is still active through the whole
     of its final day rather than ending on that morning. */
  end.setDate(end.getDate() + Math.max(1, plan.weekCount) * 7);
  return midnight < end ? "active" : "done";
}

/**
 * The plan on the screen's shoulders: the one being trained right now.
 *
 * At most one, because a hero that can be two is a list. Where several are
 * running, the one that started most recently is the one being trained
 * *into* — an older plan still inside its interval is usually one that was
 * left behind rather than one being followed.
 *
 * Archived plans are out of it whatever their dates say: archiving is the
 * athlete saying they are done with it.
 */
export function activePlan(
  plans: readonly TrainingPlanDocument[],
  today: Date = new Date()
): TrainingPlanDocument | undefined {
  const running = plans.filter(
    (plan) => !plan.archived && planLifecycle(plan, today) === "active"
  );
  if (!running.length) return undefined;
  return running.reduce((latest, plan) =>
    (plan.startDate ?? "") > (latest.startDate ?? "") ? plan : latest
  );
}

/**
 * Which week of the plan today falls in, 1-based, and how many there are.
 *
 * `undefined` for anything not running: a plan with no start date has no
 * position on a date axis at all, and one that has not begun or has finished
 * has a position nobody needs read out.
 */
export function planWeekPosition(
  plan: TrainingPlanDocument,
  today: Date = new Date()
): { week: number; of: number } | undefined {
  if (planLifecycle(plan, today) !== "active") return undefined;
  const start = planStartDate(plan);
  if (!start) return undefined;
  const days = Math.floor(
    (startOfDay(today).getTime() - start.getTime()) / 86_400_000
  );
  return {
    week: Math.min(plan.weekCount, Math.floor(days / 7) + 1),
    of: plan.weekCount
  };
}

/** The three lists the Plans tab draws, in the order it draws them. */
export interface PlanSections {
  /** Running right now, drawn as the hero above everything. */
  hero?: TrainingPlanDocument;
  /** Everything still ahead or still usable, the hero excluded. */
  current: TrainingPlanDocument[];
  /** Past their last week. */
  done: TrainingPlanDocument[];
  /** Put away by hand, whatever their dates say. */
  archived: TrainingPlanDocument[];
}

/**
 * Split the visible plans into the sections the screen shows at once.
 *
 * This is what replaced the `scheduled` / `reusable` / `archived` chips: a
 * filter chip answers one state at a time and hides the rest, which is the
 * wrong shape for a question — "what am I training, and what have I got" — the
 * athlete asks about all of them together. `archived` stays a section rather
 * than becoming nothing, because dropping it with its chip would leave a plan
 * put away with no way back to it at all.
 *
 * The order inside each section is the caller's: it has already sorted.
 */
export function groupPlans(
  plans: readonly TrainingPlanDocument[],
  today: Date = new Date()
): PlanSections {
  const hero = activePlan(plans, today);
  const sections: PlanSections = { hero, current: [], done: [], archived: [] };
  /* A plan running from a template in the library is that template's
     calendar copy, and the template stands for it — with a mark saying it is
     on the calendar. Listing both drew every scheduled plan twice. */
  const templates = new Set(
    plans.filter((plan) => plan.calendar === "unscheduled").map((plan) => plan.remoteId)
  );
  for (const plan of plans) {
    if (plan.id === hero?.id) continue;
    if (plan.calendar === "running" && plan.sourcePlanId && templates.has(plan.sourcePlanId)) continue;
    if (plan.archived) sections.archived.push(plan);
    else if (planLifecycle(plan, today) === "done") sections.done.push(plan);
    else sections.current.push(plan);
  }
  return sections;
}

/** Where each draft is drawn on the Plans tab. */
export interface PlanDrafts {
  /** Edits to a listed plan, by that plan's id: the plan's tile says "Editing". */
  byPlan: Map<string, TrainingPlanDraftRecord>;
  /** Drafts with no plan to sit on, drawn as tiles of their own, newest first. */
  loose: TrainingPlanDraftRecord[];
}

/**
 * Puts each draft where the athlete will look for it.
 *
 * An edit to a plan is not a second plan, so it marks the plan it edits
 * rather than standing beside it. A new plan has nothing to mark, so it is a
 * tile of its own — and so is an edit whose plan is no longer listed (deleted
 * on COROS meanwhile), which saves as a new plan and would otherwise be kept
 * somewhere nothing draws.
 *
 * A running copy folded into its template's tile hands its draft to that
 * template, for the reason `groupPlans` folds the copy: the template is the
 * row that stands for both. One plan shows one draft, the newest; an older
 * one for the same plan is loose rather than hidden.
 */
export function attachPlanDrafts(
  plans: readonly TrainingPlanDocument[],
  drafts: readonly TrainingPlanDraftRecord[]
): PlanDrafts {
  const byRemoteId = new Map(
    plans.filter((plan) => plan.remoteId).map((plan) => [plan.remoteId!, plan])
  );
  const byPlan = new Map<string, TrainingPlanDraftRecord>();
  const loose: TrainingPlanDraftRecord[] = [];
  const newestFirst = [...drafts].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  for (const draft of newestFirst) {
    let owner = draft.baseRemoteId ? byRemoteId.get(draft.baseRemoteId) : undefined;
    const template = owner?.calendar === "running" && owner.sourcePlanId
      ? byRemoteId.get(owner.sourcePlanId)
      : undefined;
    if (template?.calendar === "unscheduled") owner = template;
    if (owner && !byPlan.has(owner.id)) byPlan.set(owner.id, draft);
    else loose.push(draft);
  }
  return { byPlan, loose };
}

export interface PlanScopeOption {
  id: PlanScope;
  label: string;
}

/**
 * Only the chips that would leave something. A filter that empties the list
 * whatever the library holds is a control that can only disappoint.
 */
export function planScopeOptions(
  plans: readonly TrainingPlanDocument[]
): PlanScopeOption[] {
  const options: PlanScopeOption[] = [{ id: "all", label: "All" }];
  if (plans.some((plan) => plan.origin === "coach")) options.push({ id: "coach", label: "Coach" });
  return options;
}

/**
 * Search is a filter, and it narrows within the chosen chip rather than across
 * the whole library: a reader who has picked Coach and then types is asking
 * about the coach's plans.
 *
 * **Archived plans come through here.** They used to be held back unless the
 * Archived chip was pressed, which is a filter the caller never asked for;
 * `groupPlans` puts them in a section of their own instead, so the archive is
 * a place further down the same screen rather than a state you have to know to
 * look for.
 *
 * **What it reads is what the plan says about itself** — its name, the
 * description written on it, and the sports it is made of. Tags were in
 * here too, and nothing on the Plans screen could write one: the only way to
 * set a plan's tags was a bulk dialog behind a row of checkboxes, which went
 * with the checkboxes. A field that searches an attribute the screen offers no
 * way to fill in matches nothing and says nothing about why.
 */
export function filterPlans(
  plans: readonly TrainingPlanDocument[],
  query: string,
  scope: PlanScope
): TrainingPlanDocument[] {
  const needle = query.trim().toLowerCase();
  return plans.filter((plan) => {
    if (needle) {
      const haystack = `${plan.name} ${plan.description} ${plan.sportMix.join(" ")}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }
    if (scope === "all") return true;
    return plan.origin === scope;
  });
}

/** `YYYY-MM-DD` as `Mar 14`, or nothing when it is not a date. */
function shortDate(iso: string): string | undefined {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? undefined
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * When a plan is on the calendar, or nothing at all. A plan has no start date
 * of its own — it is given one each time it goes on the calendar — so only an
 * instance has one to state, and it is the Monday COROS counts its days from.
 */
export function planStartLabel(plan: TrainingPlanDocument, today: Date = new Date()): string | undefined {
  if (!plan.startDate) return undefined;
  const label = shortDate(plan.startDate);
  if (!label) return undefined;
  if (plan.calendar === "finished") return `Ran from ${label}`;
  if (plan.calendar === "stopped") return "Taken off the calendar";
  const start = planStartDate(plan);
  return start && start > startOfDay(today) ? `Starts ${label}` : `On calendar since ${label}`;
}

/** What the reader is offered when nothing is on screen. */
export type PlanEmptyAction = "create" | "clear";

export interface PlanEmptyState {
  title: string;
  body: string;
  action: PlanEmptyAction;
}

/**
 * Two empty lists, two screens: a filter that matched nothing, and a library
 * with nothing in it.
 *
 * There was a third — "every plan is archived", whose way out was the Archived
 * chip, because an archived plan was held out of every other chip and so read
 * exactly like an empty library. Nothing is held back now: an archived plan is
 * listed under its own heading on the same screen, so a library that holds
 * only archived plans is not empty and never reaches here.
 */
export function planEmptyState(
  query: string,
  scope: PlanScope
): PlanEmptyState {
  if (query.trim() || scope !== "all") {
    return {
      title: "No plans match",
      body: "Clear the search or choose another filter.",
      action: "clear"
    };
  }
  return {
    title: "No plans yet",
    body: "Build a plan here, generate one with the coach, or refresh to pull plans from COROS.",
    action: "create"
  };
}
