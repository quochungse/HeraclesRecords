/**
 * The Plans tab's arithmetic: chips, filter, sections, order, start label,
 * empty states.
 *
 * Two of these answers were wrong in the view, and neither could be seen from
 * the screen:
 *
 * 1. An athlete who archived every plan they owned was told they had no plans
 *    and offered a Create button. `all` hid archived plans, so an archived
 *    library and an empty one produced the same empty list, and the way out
 *    was a filter reset that resets nothing.
 * 2. A chip that would empty the list is a control that can only disappoint.
 *
 * Every plan is a COROS plan now (docs/training-plan-coros-first.md), so the
 * one origin left to narrow to is the coach's, and a date belongs only to a
 * plan on the calendar — the instance COROS makes, counted from a Monday.
 *
 * And one decision it holds down: **a chip says where a plan came from; a
 * section says where it stands.** The two used to share one control, so
 * "what am I training, and what else have I got" — a question about every
 * plan at once — took three presses, each of which hid the other two answers.
 * `planLifecycle` and `groupPlans` are what replaced the state chips, and
 * every plan has to land in exactly one section or one of them is drawn twice.
 *
 * Runs through Electron only so `--experimental-strip-types` is available on
 * a Node built without Amaro; it touches no SQLite and no window.
 */
import assert from "node:assert/strict";
import {
  PLAN_SCOPES,
  activePlan,
  attachPlanDrafts,
  filterPlans,
  groupPlans,
  listedPlans,
  runOutlivesItsPlan,
  planEmptyState,
  planLifecycle,
  planOriginLabel,
  planScopeOptions,
  planStartLabel,
  planWeekPosition
} from "../src/training-library/planFilters.ts";
import { compareFavoriteThenName } from "../src/training-library/libraryOrder.ts";

let planSeq = 0;

/** A plan with every field the filters read, and nothing they do not. */
function plan(overrides = {}) {
  planSeq += 1;
  return {
    id: `coros:${planSeq}`,
    remoteId: String(planSeq),
    name: `Plan ${planSeq}`,
    description: "",
    sportMix: [],
    weekCount: 8,
    weekStages: [],
    entries: [],
    calendar: "unscheduled",
    tags: [],
    favorite: false,
    archived: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

/** A plan on the calendar: COROS's instance, dated from `startDate` (a Monday). */
const onCalendar = (startDate, overrides = {}) =>
  plan({ calendar: "running", startDate, ...overrides });

const names = (plans) => plans.map((item) => item.name);

// ---------------------------------------------------------------------------
// 1. The chips answer one question: where a plan came from
// ---------------------------------------------------------------------------
{
  assert.deepEqual(
    planScopeOptions([]).map((option) => option.id),
    ["all"],
    "an empty library offers nothing to narrow to"
  );
  assert.deepEqual(
    planScopeOptions([plan(), plan({ archived: true })]).map((option) => option.id),
    ["all"],
    "no coach plan, no coach chip"
  );
  assert.deepEqual(
    planScopeOptions([plan(), plan({ origin: "coach" })]).map((option) => option.id),
    ["all", "coach"],
    "the one origin left to name is the coach's"
  );

  /*
   * The states these chips used to mix in are sections now, and the sources
   * are gone with the local plans: every plan is a COROS plan.
   */
  for (const gone of ["favorite", "scheduled", "reusable", "unsettled", "archived", "coros", "local"]) {
    assert.ok(!PLAN_SCOPES.includes(gone), `${gone} is not a chip`);
  }
}

// ---------------------------------------------------------------------------
// 2. Filtering is by origin, and holds nothing back
// ---------------------------------------------------------------------------
{
  const running = onCalendar("2026-03-02", { name: "Marathon block" });
  const base = plan({ name: "Base builder" });
  const archived = plan({ name: "Last winter", archived: true });
  const coach = plan({ name: "Coach 10K", origin: "coach" });
  const library = [running, base, archived, coach];

  assert.deepEqual(
    names(filterPlans(library, "", "all")),
    ["Marathon block", "Base builder", "Last winter", "Coach 10K"],
    "`all` means all of them, the archive included"
  );
  assert.deepEqual(names(filterPlans(library, "", "coach")), ["Coach 10K"]);

  // Search narrows within the chosen chip rather than across the library.
  assert.deepEqual(
    names(filterPlans(library, "marathon", "coach")),
    [],
    "a search must not reach past the chip into plans the chip excludes"
  );
  assert.deepEqual(names(filterPlans(library, "10k", "coach")), ["Coach 10K"]);

  const described = plan({ name: "Untitled", tags: ["Hill Repeats"], description: "Sub 40 by spring", sportMix: ["bike"] });
  assert.deepEqual(names(filterPlans([described], "sub 40", "all")), ["Untitled"], "the description is searched");
  assert.deepEqual(names(filterPlans([described], "bike", "all")), ["Untitled"], "and the sports");
  /*
   * And the tags are not. Nothing on the Plans screen can write one, and a
   * field that searches an attribute the screen offers no way to fill in
   * matches nothing and says nothing about why.
   */
  assert.deepEqual(names(filterPlans([described], "hill", "all")), [], "tags are not searched");
  assert.deepEqual(names(filterPlans([described], "  ", "all")), ["Untitled"], "whitespace is not a search");
}

// ---------------------------------------------------------------------------
// 2b. Where a plan stands against today, and the sections that follow from it
// ---------------------------------------------------------------------------
{
  /* A Wednesday. */
  const today = new Date(2026, 8, 23, 10, 30);

  assert.equal(planLifecycle(plan(), today), "undated", "a plan not on the calendar has no date to stand against");
  assert.equal(planLifecycle(onCalendar("2026-10-05", { weekCount: 4 }), today), "upcoming");
  assert.equal(
    planLifecycle(onCalendar("2026-09-21", { weekCount: 4 }), today),
    "active",
    "a plan whose week 1 began on Monday is running"
  );
  /*
   * Two weeks from 2026-09-07 run through the 20th, so the 23rd is past it.
   * Three weeks would run through the 27th and still be active — the boundary
   * is the day after the last one, not the morning of it.
   */
  assert.equal(planLifecycle(onCalendar("2026-09-07", { weekCount: 2 }), today), "done");
  assert.equal(planLifecycle(onCalendar("2026-09-07", { weekCount: 3 }), today), "active");
  assert.equal(
    planLifecycle(onCalendar("2026-09-21", { calendar: "finished", weekCount: 6 }), today),
    "done",
    "a run COROS reports finished is over, whatever its dates would say"
  );
  /*
   * "Remove from calendar" is COROS's executeStatus 2 as well — the status of
   * a run that ran out — and was filed under Done with it. A run taken off is
   * on no calendar and was not completed.
   */
  const takenOff = onCalendar("2026-10-05", { calendar: "stopped", weekCount: 6 });
  assert.equal(planLifecycle(takenOff, today), "undated", "a run taken off the calendar is not done");
  assert.equal(
    planLifecycle(onCalendar("2026-09-07", { calendar: "stopped", weekCount: 6 }), today),
    "undated",
    "nor active, though today is inside the dates it would have run"
  );

  assert.deepEqual(
    planWeekPosition(onCalendar("2026-09-07", { weekCount: 6 }), today),
    { week: 3, of: 6 },
    "sixteen days in is week three"
  );
  assert.equal(planWeekPosition(onCalendar("2026-10-05", { weekCount: 6 }), today), undefined);
  assert.equal(planWeekPosition(plan(), today), undefined);

  const template = plan({ name: "Template", remoteId: "tpl" });
  const running = onCalendar("2026-09-07", { name: "Now", weekCount: 6, sourcePlanId: "tpl" });
  const newer = onCalendar("2026-09-21", { name: "Newer", weekCount: 6 });
  const finished = onCalendar("2026-06-01", { name: "Over", weekCount: 4, calendar: "finished" });
  const ahead = onCalendar("2026-11-02", { name: "Ahead", weekCount: 4, sourcePlanId: "tpl" });
  const anytime = plan({ name: "Anytime" });
  const putAway = onCalendar("2026-09-07", { name: "Put away", archived: true, weekCount: 6 });

  assert.equal(
    activePlan([running, newer, finished], today)?.name,
    "Newer",
    "two running at once: the one started most recently is the one being trained into"
  );
  assert.equal(activePlan([putAway], today), undefined, "archiving is the athlete saying they are done with it");
  assert.equal(activePlan([finished, ahead, anytime], today), undefined);

  const sections = groupPlans([template, running, newer, finished, ahead, anytime, putAway], today);
  assert.equal(sections.hero?.name, "Newer");
  const withTakenOff = groupPlans([finished, { ...takenOff, name: "Taken off" }], today);
  assert.deepEqual(withTakenOff.done.map((item) => item.name), ["Over"], "never under Done, where a removal used to land");
  assert.deepEqual(
    listedPlans([finished, { ...takenOff, name: "Taken off" }, template]).map((item) => item.name),
    ["Over", "Template"],
    "and not listed at all: COROS will not put it back, and its plan, if any, is the row"
  );

  /* A run on the calendar is listed however its plan fares; taking it off is the last of it only when that plan is gone. */
  assert.equal(runOutlivesItsPlan(running, [template, running]), false, "its plan is listed");
  assert.equal(runOutlivesItsPlan(running, [running]), true, "its plan was deleted on COROS");
  assert.equal(runOutlivesItsPlan({ ...running, sourcePlanId: undefined }, [template]), true, "applied from COROS's catalogue");
  assert.equal(runOutlivesItsPlan(template, [template, running]), false, "asked of the plan, the plan stays");
  assert.deepEqual(
    names(sections.current),
    ["Template", "Anytime"],
    "a calendar copy of a plan in the library is that plan's, not a second tile — " +
      "`Now` and `Ahead` run from `Template`, which stands for them"
  );
  assert.deepEqual(names(sections.done), ["Over"]);
  assert.deepEqual(names(sections.archived), ["Put away"], "archived wins over done, so a plan is listed once");

  const orphan = onCalendar("2026-09-07", { name: "Official", weekCount: 12, sourcePlanId: "catalogue" });
  assert.deepEqual(
    names(groupPlans([orphan, newer], today).current),
    ["Official"],
    "a copy whose plan is not in the library — COROS's own catalogue — is listed as itself"
  );
}

// ---------------------------------------------------------------------------
// 4. Start label — where the plan is on the calendar, or nothing to say
// ---------------------------------------------------------------------------
{
  const today = new Date(2026, 2, 10, 12);
  assert.equal(planStartLabel(onCalendar("2026-03-23"), today), "Starts Mar 23");
  assert.equal(planStartLabel(onCalendar("2026-03-02"), today), "On calendar since Mar 2");
  assert.equal(planStartLabel(onCalendar("2026-01-05", { calendar: "finished" }), today), "Ran from Jan 5");
  assert.equal(
    planStartLabel(onCalendar("2026-03-23", { calendar: "stopped" }), today),
    "Taken off the calendar",
    "not \"Starts Mar 23\": it will not"
  );
  assert.equal(
    planStartLabel(plan(), today),
    undefined,
    "a plan has no start date of its own; it is given one each time it goes on the calendar"
  );
  assert.equal(
    planStartLabel(onCalendar("not-a-date"), today),
    undefined,
    "a start date that is not a date is no start date"
  );
  // Midday, not midnight: parsed as UTC midnight, a date west of Greenwich
  // renders as the day before.
  assert.equal(planStartLabel(onCalendar("2027-01-04"), today), "Starts Jan 4");
}

// ---------------------------------------------------------------------------
// 5. An origin is named the same way on a chip and on a badge
// ---------------------------------------------------------------------------
{
  assert.equal(planOriginLabel({ origin: "coach" }), "Coach");
  assert.equal(planOriginLabel({ origin: "user" }), undefined, "a plan written here is not worth a badge");
  assert.equal(planOriginLabel({}), undefined);
}

// ---------------------------------------------------------------------------
// 6. Two empty lists, two screens
// ---------------------------------------------------------------------------
{
  const empty = planEmptyState("", "all");
  assert.equal(empty.title, "No plans yet");
  assert.equal(empty.action, "create");

  const narrowed = planEmptyState("marathon", "all");
  assert.equal(narrowed.title, "No plans match");
  assert.equal(narrowed.action, "clear");
  assert.equal(
    planEmptyState("", "coach").action,
    "clear",
    "a chip that matched nothing is narrowed too, with or without a search"
  );

  /*
   * There used to be a third — "every plan is archived" — because an archived
   * plan was held out of every chip but its own, so an archived library and an
   * empty one produced the same empty list. Nothing is held back now, so a
   * library that holds only archived plans is not empty and never reaches
   * here: `groupPlans` puts them under a heading of their own.
   */
  assert.notEqual(empty.title, narrowed.title, "two states, two things to say");
  assert.deepEqual(
    [empty.action, narrowed.action].sort(),
    ["clear", "create"],
    "and the way out of each is the one that changes it"
  );
}

// ---------------------------------------------------------------------------
// 3c. The order both tabs open in: favourites first, then by name
// ---------------------------------------------------------------------------
{
  const week10 = plan({ name: "Week 10" });
  const week2 = plan({ name: "week 2" });
  const favZ = plan({ name: "Zone 2 base", favorite: true });
  const favA = plan({ name: "Aerobic block", favorite: true });
  const library = [week10, favZ, week2, favA];

  assert.deepEqual(
    names([...library].sort(compareFavoriteThenName)),
    ["Aerobic block", "Zone 2 base", "week 2", "Week 10"],
    "favourites lead, each half by name — numeric, and blind to case"
  );

  const workouts = [
    { id: "w1", name: "Tempo", favorite: false },
    { id: "w2", name: "Intervals", favorite: false },
    { id: "w3", name: "Long run", favorite: true }
  ];
  assert.deepEqual(
    [...workouts].sort(compareFavoriteThenName).map((item) => item.name),
    ["Long run", "Intervals", "Tempo"],
    "the workouts tab reads the same comparator"
  );
}

// ---------------------------------------------------------------------------
// Drafts: an edit marks its plan, a new plan is a tile of its own
// ---------------------------------------------------------------------------
{
  const edited = plan({ name: "Edited" });
  const template = plan({ name: "Template", runningInstanceId: "run-9" });
  const running = plan({ id: "coros:run-9", remoteId: "run-9", calendar: "running", sourcePlanId: template.remoteId });
  const draft = (id, overrides = {}) => ({
    id,
    plan: plan({ id: `draft:${id}`, remoteId: undefined, name: id }),
    savedAt: "2026-02-01T00:00:00.000Z",
    ...overrides
  });
  const onEdited = draft("on-edited", { baseRemoteId: edited.remoteId, savedAt: "2026-02-03T00:00:00.000Z" });
  const olderOnEdited = draft("older-on-edited", { baseRemoteId: edited.remoteId });
  const onRunning = draft("on-running", { baseRemoteId: "run-9" });
  const brandNew = draft("brand-new", { savedAt: "2026-02-02T00:00:00.000Z" });
  const planGone = draft("plan-gone", { baseRemoteId: "deleted-on-coros", savedAt: "2026-02-04T00:00:00.000Z" });

  const { byPlan, loose } = attachPlanDrafts(
    [edited, template, running],
    [olderOnEdited, onRunning, brandNew, onEdited, planGone]
  );
  assert.equal(byPlan.get(edited.id)?.id, "on-edited", "an edit marks its plan, and the newest edit is the one held");
  assert.equal(
    byPlan.get(template.id)?.id,
    "on-running",
    "a calendar copy folded into its template hands its draft to the template's tile"
  );
  assert.equal(byPlan.has(running.id), false, "and not to the copy, which has no tile");
  assert.deepEqual(
    loose.map((item) => item.id),
    ["plan-gone", "brand-new", "older-on-edited"],
    "a new plan, an edit whose plan is gone and a second edit of one plan stand on their own, newest first"
  );
}

console.log(
  "plan filters OK — the one chip is the coach's, every plan lands in exactly " +
    "one section, a calendar copy is not listed twice, search narrows within " +
    "the chip, undated plans sort off the date axis, two empty states, drafts land on their plan or stand alone"
);
