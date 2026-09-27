/**
 * What a question points at, as the composer's header reads it (Coach
 * Workbench UAT, option A): the week, the session or the plan an Ask Coach
 * put there, previewed from the plan already in hand.
 *
 * Holds down that the preview names the right week and session (a week off
 * by one would have the athlete confirm the wrong thing before sending), that
 * it reads the plan the Library's reader reads, that a ref whose plan is not
 * in hand still says what it is, and the placeholder each kind asks for.
 *
 * Runs through Electron only so `--experimental-strip-types` is available on
 * a Node built without Amaro; it touches no SQLite and no window. The
 * resolver hook is needed because the reader model imports without
 * extensions.
 */
import assert from "node:assert/strict";
import {
  formatSessionTime,
  planRefPreview,
  refPlaceholder,
  scheduleRefPreview
} from "../src/chat/refPreview.ts";
import { activityCoachRequest, activityWorkoutSport } from "../src/training/askCoachAbout.ts";

let seq = 0;
function entry(weekIndex, dayIndex, title, extra = {}) {
  seq += 1;
  return {
    id: `entry-${seq}`,
    weekIndex,
    dayIndex,
    sortOrder: seq,
    title,
    workout: { key: `w-${seq}`, name: title, sport: "run", ...extra }
  };
}

const longRun = entry(1, 5, "Long run");
const document = {
  id: "draft:plan-1",
  name: "Base to 10k",
  description: "",
  sportMix: ["run"],
  weekCount: 3,
  weekStages: [],
  entries: [
    entry(0, 1, "Easy run"),
    entry(1, 1, "Easy run"),
    entry(1, 3, "Tempo"),
    longRun,
    entry(2, 1, "Easy run")
  ],
  calendar: "unscheduled",
  tags: [],
  favorite: false,
  archived: false,
  updatedAt: "2026-01-01T00:00:00.000Z"
};
const ref = (overrides) => ({
  artifactId: "plan-1",
  draftId: "plan-1",
  name: "Base to 10k",
  artifactType: "plan",
  scope: "plan",
  label: "the whole plan",
  ...overrides
});

// A week: its number, the plan it belongs to, its figures and where it sits.
{
  const week = planRefPreview(ref({ scope: "week", weekIndex: 1, label: "Week 2" }), document, "metric");
  assert.equal(week.kind, "week");
  assert.equal(week.title, "Week 2");
  assert.equal(week.context, "Base to 10k");
  assert.match(week.detail, /^3 sessions/);
  assert.match(week.detail, /Tue Thu Sat$/, "the days the week trains on, as the reader names them");
  assert.equal(week.bars.heights.length, 3, "a bar for every week of the plan");
  assert.equal(week.bars.current, 1, "and the week asked about marked");
  assert.equal(week.chip, "Week 2", "its chip when several share the header");
  assert.equal(week.sport, "run", "the bars take the plan's sport");
  assert.equal(Math.max(...week.bars.heights), 1);
}

// A session: found by the key the Workbench put on the ref, named by its day.
{
  const session = planRefPreview(
    ref({ scope: "session", weekIndex: 1, sessionKey: longRun.workout.key, label: "Week 2 · Sat · Long run" }),
    document,
    "metric"
  );
  assert.equal(session.kind, "session");
  assert.equal(session.title, "Sat · Long run");
  assert.equal(session.context, "Base to 10k · week 2");
  assert.equal(session.sport, "run");
}

// The whole plan.
{
  const whole = planRefPreview(ref({}), document, "metric");
  assert.equal(whole.title, "Base to 10k");
  assert.equal(whole.context, "Coach plan");
  assert.equal(whole.detail, "3 weeks · 5 sessions");
  assert.equal(whole.bars.current, undefined, "no week stands out");
}

// A ref whose plan is not in hand still says what it points at.
{
  const bare = planRefPreview(ref({ scope: "week", weekIndex: 1, label: "Week 2" }), undefined, "metric");
  assert.deepEqual(bare, { kind: "week", context: "Base to 10k", title: "Week 2", chip: "Week 2" });
  const gone = planRefPreview(ref({ scope: "session", sessionKey: "nowhere", label: "Week 2 · Sat" }), document, "metric");
  assert.equal(gone.title, "Week 2 · Sat", "a session no longer in the plan keeps its label");
}

// The calendar: the day is the title, what is on it the brief, and the
// figures a screen sent along after it.
{
  assert.deepEqual(scheduleRefPreview({ scope: "session", day: "20260927", label: "Sat 27 Sep · Long run", sport: "run" }), {
    kind: "calendar",
    context: "your calendar",
    title: "Sat 27 Sep",
    chip: "Sat 27 Sep",
    detail: "Long run",
    sport: "run"
  });
  assert.equal(scheduleRefPreview({ scope: "session", planId: "P1", label: "Long run" }).context, "your COROS plan");
  assert.equal(scheduleRefPreview({ scope: "week", day: "20260921", label: "Week of 21–27 Sep" }).kind, "calendarWeek");
  const activity = scheduleRefPreview({
    scope: "session",
    day: "20260927",
    activityId: "A1",
    label: "Sat 27 Sep · Morning run",
    detail: "10.2 km · 52:10"
  });
  assert.equal(activity.kind, "activity");
  assert.equal(activity.context, "your activity");
  assert.equal(activity.detail, "Morning run · 10.2 km · 52:10");
}

// Ask Coach from a session's own screen: the calendar's ref, with the id
// Coach's tools take, the day it was, and its figures for the header only.
{
  const request = activityCoachRequest(
    { activityId: "A1", name: "Morning run", sportName: "Run", sportType: 100, startTime: new Date(2026, 8, 27, 7).valueOf() / 1000, duration: 3130, distance: 10200 },
    "metric"
  );
  assert.equal(request.scheduleRefs[0].sport, "run", "the header draws the run's own icon");
  assert.equal(activityWorkoutSport(102), "trailRun");
  assert.equal(activityWorkoutSport(201), "bike");
  assert.equal(activityWorkoutSport(402), "strength");
  assert.equal(activityWorkoutSport(1003), undefined, "an unknown sport takes the default icon");
  assert.equal(request.prompt, "Can you review it?");
  const [ref] = request.scheduleRefs;
  assert.equal(ref.scope, "session");
  assert.equal(ref.day, "20260927");
  assert.equal(ref.activityId, "A1");
  assert.match(ref.label, /Morning run$/);
  assert.match(ref.detail, /^Run · 10\.2 km · 52:10$/);
  const hevyOnly = activityCoachRequest({ name: "Push day", sportName: "Strength", startTime: 1790000000 }, "metric");
  assert.equal(hevyOnly.scheduleRefs[0].activityId, undefined, "a session COROS never saw carries no id");
}

// The placeholder asks about what is there.
{
  const week = planRefPreview(ref({ scope: "week", weekIndex: 0, label: "Week 1" }), document, "metric");
  const whole = planRefPreview(ref({}), document, "metric");
  assert.equal(refPlaceholder([]), undefined);
  assert.equal(refPlaceholder([week]), "Ask about this week…");
  assert.equal(refPlaceholder([whole]), "Ask about this plan…");
  assert.equal(refPlaceholder([week, whole]), "Ask about these…");
  // A calendar week and an activity are named too, not left at "this".
  assert.equal(refPlaceholder([scheduleRefPreview({ scope: "week", day: "20260921", label: "Week of Sep 21 – Sep 27" })]), "Ask about this week…");
  assert.equal(
    refPlaceholder([scheduleRefPreview({ scope: "session", day: "20260926", activityId: "a1", label: "Sat 26 Sep · Morning run" })]),
    "Ask about this activity…"
  );
}

assert.equal(formatSessionTime(25 * 60), "25m");
assert.equal(formatSessionTime(70 * 60), "1:10");

console.log("ref preview tests passed");
