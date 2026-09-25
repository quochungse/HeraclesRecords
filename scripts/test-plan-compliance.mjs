// How a plan on the calendar is going — the figure that replaced the Adherence tab.
//
// Adherence was never an entity. It is a fact about a *plan*, and only a plan
// schedules sessions to keep or miss.
//
// The join is the part worth holding down, because it is not obvious and it is
// not checkable by types. A plan put on the calendar is an instance COROS makes,
// and every calendar entry it puts there carries the instance's id as `planId`
// and the session's `idInPlan` — the pair a `TrainingActivityMatch` records as
// `schedulePlanId` / `scheduleIdInPlan`. Everything below is a way that join
// can be got wrong:
//
// - claiming anything for a plan that is not on the calendar (its running copy
//   is a plan of its own, with its own sessions),
// - claiming another plan's day, or another session of a plan with the same
//   `idInPlan`,
// - reporting **0%** for a plan nothing has been judged against, which is the
//   one number an athlete would read as failure, and
// - reporting 0% for a plan whose every session is still ahead.
//
// Runs under Electron so `--experimental-strip-types` can reach the `.ts`
// source; it imports nothing that needs a window or a database.
import assert from "node:assert/strict";

const {
  describeCompliance,
  formatCompliance,
  planCompliance,
  planScheduleKeys
} = await import("../src/training-library/planCompliance.ts");

let nextId = 0;

/** A plan with sessions `idInPlan` 1..n, on the calendar unless said otherwise. */
function plan(sessions, calendar = "running") {
  nextId += 1;
  return {
    id: `coros:plan-${nextId}`,
    remoteId: `plan-${nextId}`,
    name: `Plan ${nextId}`,
    description: "",
    sportMix: ["run"],
    weekCount: 4,
    weekStages: [],
    entries: Array.from({ length: sessions }, (_, index) => ({
      id: `e${index + 1}`,
      weekIndex: 0,
      dayIndex: index % 7,
      sortOrder: index,
      title: `Session ${index + 1}`,
      workout: { key: `e${index + 1}`, name: `Session ${index + 1}`, sport: "run" },
      idInPlan: String(index + 1),
      happenDay: `2026091${index}`
    })),
    calendar,
    ...(calendar === "unscheduled" ? {} : { startDate: "2026-09-07" }),
    tags: [],
    favorite: false,
    archived: false,
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

function match(schedulePlanId, scheduleIdInPlan, status) {
  return {
    id: `${schedulePlanId}:${scheduleIdInPlan}`,
    schedulePlanId,
    scheduleIdInPlan,
    happenDay: "20260910",
    status,
    manual: false,
    updatedAt: "2026-09-11T00:00:00.000Z"
  };
}

// ---------------------------------------------------------------------------
// 1. A plan with nothing on the calendar has no claim to make
// ---------------------------------------------------------------------------
{
  const template = plan(3, "unscheduled");
  assert.deepEqual([...planScheduleKeys(template)], [], "a plan not on the calendar owns no calendar day");
  assert.equal(
    planCompliance(template, [match(template.remoteId, "1", "completed")]),
    undefined,
    "even a match that happens to name it — 0% or 100% would both be claims it cannot make"
  );

  const unsaved = { ...plan(2), remoteId: undefined };
  assert.equal(planCompliance(unsaved, []), undefined, "a draft has no identity on the calendar at all");

  const running = plan(2);
  assert.equal(
    planCompliance(running, []),
    undefined,
    "sessions the matcher has not reached yet say nothing about adherence"
  );
}

// ---------------------------------------------------------------------------
// 2. The join claims this plan's days and nobody else's
// ---------------------------------------------------------------------------
{
  const running = plan(5);
  running.entries.push({ ...running.entries[0], id: "unsaved", idInPlan: undefined });
  const id = running.remoteId;

  assert.deepEqual(
    [...planScheduleKeys(running)].sort(),
    [`${id}:1`, `${id}:2`, `${id}:3`, `${id}:4`, `${id}:5`],
    "keyed as COROS keys a calendar entry; a session with no idInPlan is not on the calendar"
  );

  const compliance = planCompliance(running, [
    match(id, "1", "completed"),
    match(id, "2", "partial"),
    match(id, "3", "missed"),
    match(id, "4", "skipped"),
    match(id, "5", "upcoming"),
    // Another plan's session with the same idInPlan: every plan numbers its
    // sessions from 1, so matching on `scheduleIdInPlan` alone would take it.
    match("another-plan", "1", "completed"),
    // A session this plan does not have.
    match(id, "9", "completed")
  ]);

  assert.equal(compliance.planned, 5, "only this plan's sessions");
  assert.equal(compliance.upcoming, 1);
  assert.equal(compliance.settled, 4, "an upcoming session is settled neither way");
  assert.equal(compliance.done, 2, "partial counts as done — it was trained, not missed");
  assert.equal(compliance.missed, 1);
  assert.equal(compliance.skipped, 1);
  assert.equal(compliance.ratio, 0.5);
}

// ---------------------------------------------------------------------------
// 3. Nothing settled yet is not nought per cent
// ---------------------------------------------------------------------------
{
  const running = plan(2);
  const ahead = planCompliance(running, [
    match(running.remoteId, "1", "upcoming"),
    match(running.remoteId, "2", "upcoming")
  ]);
  assert.equal(ahead.planned, 2);
  assert.equal(ahead.settled, 0);
  assert.equal(ahead.done, 0);
  assert.equal(ahead.ratio, undefined, "a plan that starts next week has not been failed at");
  assert.equal(formatCompliance(ahead), null, "and nothing is drawn for it");
  assert.equal(describeCompliance(ahead), "2 sessions ahead");
}

// ---------------------------------------------------------------------------
// 4. A finished run still reports how it went
// ---------------------------------------------------------------------------
{
  const finished = plan(2, "finished");
  const compliance = planCompliance(finished, [
    match(finished.remoteId, "1", "completed"),
    match(finished.remoteId, "2", "missed")
  ]);
  assert.equal(compliance.planned, 2, "taking a plan off the calendar does not unmake what was trained");
  assert.equal(formatCompliance(compliance), "50%");
}

// ---------------------------------------------------------------------------
// 5. The copy the row draws
// ---------------------------------------------------------------------------
{
  assert.equal(formatCompliance(undefined), null, "never on the calendar draws nothing");
  assert.equal(describeCompliance(undefined), null);

  const mixedPlan = plan(3);
  const mixed = planCompliance(mixedPlan, [
    match(mixedPlan.remoteId, "1", "completed"),
    match(mixedPlan.remoteId, "2", "missed"),
    match(mixedPlan.remoteId, "3", "upcoming")
  ]);
  assert.equal(formatCompliance(mixed), "50%");
  assert.equal(
    describeCompliance(mixed),
    "1 done · 1 missed · 1 ahead",
    "the sentence names only what happened — a zero count is left out"
  );

  const cleanPlan = plan(2);
  const clean = planCompliance(cleanPlan, [
    match(cleanPlan.remoteId, "1", "completed"),
    match(cleanPlan.remoteId, "2", "partial")
  ]);
  assert.equal(formatCompliance(clean), "100%");
  assert.equal(describeCompliance(clean), "2 done");

  const onePlan = plan(1);
  const one = planCompliance(onePlan, [match(onePlan.remoteId, "1", "upcoming")]);
  assert.equal(describeCompliance(one), "1 session ahead", "singular, not '1 sessions'");
}

console.log("plan compliance tests passed");
