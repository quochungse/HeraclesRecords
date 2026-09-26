import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Which way of saving a coach's creation leads (docs/coach-plan-canvas.md,
 * P0.5). Launched through Electron with `--experimental-strip-types`, because a
 * Node built without Amaro cannot run it (CLAUDE.md).
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const { planSaveChoices, isOneShotPlan, ONE_SHOT_DAYS, artifactActions } = await import(
  pathToFileURL(path.join(repoRoot, "src", "chat", "creationChoices.ts")).href
);

const today = "2026-09-26";

const entry = (key, scheduleDate) => ({
  key,
  name: key,
  saveToLibrary: false,
  workoutType: "easy",
  ...(scheduleDate ? { scheduleDate } : {})
});
const plan = (...entries) => ({
  draftId: "d",
  artifactType: "plan",
  name: "Plan",
  summary: "",
  entries,
  conflicts: [],
  warnings: []
});
const workout = (scheduleDate) => ({ ...plan(entry("w", scheduleDate)), artifactType: "workout" });
const ids = (choices) => ({
  primary: choices.primary.id,
  secondary: choices.secondary.map((action) => action.id),
  more: choices.more.map((action) => action.id)
});

// A week of dated sessions from today on is one-shot: the calendar leads, a
// COROS plan is the second choice, and the library is behind the ⋯.
{
  const week = plan(entry("a", "2026-09-28"), entry("b", "2026-09-30"), entry("c", "2026-10-02"));
  assert.equal(isOneShotPlan(week, today), true);
  const choices = planSaveChoices(week, today);
  assert.deepEqual(ids(choices), {
    primary: "putOnCalendar",
    secondary: ["saveAsPlan"],
    more: ["saveToLibrary"]
  });
  assert.equal(choices.primary.label, "Put sessions on calendar");
  assert.equal(choices.primary.destination, "calendar");
  assert.equal(choices.secondary[0].label, "Save to COROS as a plan");
  assert.equal(choices.secondary[0].destination, "nativePlan");
}

// The boundary: fourteen days first to last inclusive is one-shot, fifteen is
// a programme.
{
  assert.equal(ONE_SHOT_DAYS, 14);
  assert.equal(isOneShotPlan(plan(entry("a", "2026-09-28"), entry("b", "2026-10-11")), today), true);
  assert.equal(isOneShotPlan(plan(entry("a", "2026-09-28"), entry("b", "2026-10-12")), today), false);
  // Today counts as from today on.
  assert.equal(isOneShotPlan(plan(entry("a", today)), today), true);
}

// A programme — longer, undated, partly dated or begun in the past — saves as
// one COROS plan first. Putting its sessions on the calendar one by one stays
// reachable only while every session has a date that has not gone by.
{
  const long = plan(entry("a", "2026-09-28"), entry("b", "2026-11-30"));
  assert.deepEqual(ids(planSaveChoices(long, today)), {
    primary: "saveAsPlan",
    secondary: [],
    more: ["putOnCalendar", "saveToLibrary"]
  });
  assert.equal(planSaveChoices(long, today).primary.label, "Save to COROS");

  const undated = plan(entry("a"), entry("b"));
  assert.equal(isOneShotPlan(undated, today), false);
  assert.deepEqual(ids(planSaveChoices(undated, today)).more, ["saveToLibrary"]);

  const partly = plan(entry("a", "2026-09-28"), entry("b"));
  assert.equal(isOneShotPlan(partly, today), false);
  assert.deepEqual(ids(planSaveChoices(partly, today)).more, ["saveToLibrary"]);

  const begunEarlier = plan(entry("a", "2026-09-20"), entry("b", "2026-09-28"));
  assert.equal(isOneShotPlan(begunEarlier, today), false);
  assert.deepEqual(ids(planSaveChoices(begunEarlier, today)).more, ["saveToLibrary"]);

  assert.equal(isOneShotPlan(plan(), today), false);
}

// A date read off the canonical source when the preview has none of its own.
{
  const fromSource = plan({
    ...entry("a"),
    source: { key: "a", name: "a", schedule_date: "20260929" }
  });
  assert.equal(isOneShotPlan(fromSource, today), true);
}

// A one-off workout: the suggested day leads while it is still ahead;
// otherwise the library does, and a day can still be picked.
{
  const dated = planSaveChoices(workout("2026-09-29"), today);
  assert.deepEqual(ids(dated), {
    primary: "scheduleWorkout",
    secondary: ["saveToLibrary", "pickWorkoutDate"],
    more: []
  });
  assert.equal(dated.primary.date, "2026-09-29");
  assert.match(dated.primary.label, /^Schedule for /);

  assert.deepEqual(ids(planSaveChoices(workout(), today)), {
    primary: "saveToLibrary",
    secondary: ["pickWorkoutDate"],
    more: []
  });
  assert.equal(
    planSaveChoices(workout("2026-09-20"), today).primary.id,
    "saveToLibrary",
    "a suggested day that has gone by is not offered"
  );
}

// No label ever means the other thing.
{
  const everyAction = [
    planSaveChoices(plan(entry("a", "2026-09-28")), today),
    planSaveChoices(plan(entry("a", "2026-09-28"), entry("b", "2026-12-28")), today),
    planSaveChoices(workout("2026-09-29"), today),
    planSaveChoices(workout(), today)
  ].flatMap((choices) => [choices.primary, ...choices.secondary, ...choices.more]);
  for (const action of everyAction) {
    if (action.id === "putOnCalendar") assert.equal(action.destination, "calendar");
    if (action.id === "saveAsPlan") assert.equal(action.destination, "nativePlan");
    if (/COROS/.test(action.label)) assert.equal(action.destination, "nativePlan");
  }
}

// What the creations list says of each: where it went, not "Workout Library"
// for every workout whatever became of it.
{
  const { creationStatus } = await import(
    pathToFileURL(path.join(repoRoot, "src", "chat", "creationChoices.ts")).href
  );
  const saved = (draft, destination) => ({
    ...draft,
    uploadedAt: 1,
    uploadResult: { workoutsScheduled: 0, workoutsCreated: 0, destination }
  });
  assert.deepEqual(creationStatus(plan(entry("a"))), { label: "Proposal", saved: false });
  assert.deepEqual(creationStatus({ ...plan(entry("a")), editedAt: 2 }), {
    label: "Edited by you",
    saved: false
  });
  assert.equal(creationStatus(saved(plan(entry("a")), "nativePlan")).label, "On COROS");
  assert.equal(creationStatus(saved(workout(), "workoutLibrary")).label, "In library");
  assert.match(creationStatus(saved(workout("2026-10-02"), "calendar")).label, /^On calendar \S/);
  assert.equal(creationStatus(saved(plan(entry("a", "2026-10-02")), "calendar")).label, "On calendar");
}

// artifactActions (P1.4): the card and the canvas ask one function, and a
// version something replaced, or one being edited, is never offered a save.
{
  const draft = plan(entry("a"), entry("b"));
  const newest = artifactActions(draft, { latest: true }, today);
  assert.equal(newest.kind, "save");
  const base = planSaveChoices(draft, today);
  assert.deepEqual(
    { ...newest.choices, secondary: newest.choices.secondary.filter((action) => action.id !== "addToCalendar") },
    base,
    "the same ways to save the card has always had, and the calendar beside them"
  );
  assert.deepEqual(artifactActions(draft, { latest: false }, today), { kind: "older", restore: true });
  assert.deepEqual(
    artifactActions(draft, { latest: false, saved: true }, today),
    { kind: "older", restore: false },
    "a saved creation's older version cannot be restored from here yet"
  );
  assert.deepEqual(
    artifactActions({ ...draft, uploadedAt: 1 }, { latest: false }, today),
    { kind: "older", restore: false },
    "saved is read off the card when the caller does not say"
  );
  assert.deepEqual(artifactActions(draft, { latest: true, editing: true }, today), { kind: "editing" });

  // A plan on COROS (P1.6): its next version updates that plan, its older
  // versions can be restored, and once saved it can still be edited.
  const change = artifactActions(draft, { latest: true, onCoros: true }, today);
  assert.equal(change.kind, "save");
  assert.equal(change.choices.primary.id, "updatePlan");
  assert.deepEqual(change.choices.more.map((action) => [action.id, action.asNew]), [["saveAsNewPlan", true]]);
  assert.deepEqual(artifactActions(draft, { latest: false, saved: true, onCoros: true }, today), { kind: "older", restore: true });
  assert.deepEqual(
    artifactActions({ ...draft, uploadedAt: 1 }, { latest: true, onCoros: true }, today),
    { kind: "saved", addToCalendar: true }
  );
  const oneOff = { ...draft, artifactType: "workout" };
  assert.deepEqual(
    artifactActions(oneOff, { latest: false, saved: true, onCoros: true }, today),
    { kind: "older", restore: false },
    "a saved workout has nothing to update"
  );
}

// creationCalendar (P1.6): the week of the running copy today falls in, and
// what was done against it — the Library's own compliance, so no 0% for a plan
// with nothing settled yet.
{
  const { creationCalendar, localDayKey } = await import(
    pathToFileURL(path.join(repoRoot, "src", "chat", "creationCalendar.ts")).href
  );
  assert.match(localDayKey(new Date(2026, 8, 5, 23, 30)), /^2026-09-05$/, "the local day, not UTC's");
  assert.deepEqual(creationCalendar(undefined, "2026-09-30"), { running: false });
  const running = {
    remoteId: "R1",
    calendar: "running",
    startDate: "2026-09-21",
    weekCount: 4,
    entries: [{ idInPlan: "1" }, { idInPlan: "2" }, { idInPlan: "3" }]
  };
  const match = (id, status) => ({ schedulePlanId: "R1", scheduleIdInPlan: id, status });
  const state = (matches) => ({ artifactId: "a", remotePlanId: "coros:900", running, matches });
  assert.deepEqual(
    creationCalendar(state([match("1", "completed"), match("2", "missed"), match("3", "upcoming")]), "2026-09-30"),
    { running: true, line: "Week 2 of 4 · 1 done · 1 missed · 1 ahead" }
  );
  assert.deepEqual(
    creationCalendar(state([match("1", "upcoming")]), "2026-09-21"),
    { running: true, line: "Week 1 of 4 · 1 session ahead" },
    "nothing settled: sessions ahead, never 0%"
  );
  assert.match(creationCalendar(state([]), "2026-09-14").line, /^Starts /, "before it starts");
  assert.equal(creationCalendar(state([]), "2026-12-30").line, "Week 4 of 4", "not past its last week");
}

// A proposal that is a programme can also go on the calendar, saved first;
// a one-shot plan leads with its sessions and is not offered it twice.
{
  const programme = plan(entry("a"), entry("b"));
  const offered = artifactActions(programme, { latest: true }, today);
  assert.deepEqual(offered.choices.secondary.map((action) => action.id), ["addToCalendar"]);
  const oneShot = plan(entry("a", "2026-09-28"), entry("b", "2026-09-30"));
  assert.equal(
    artifactActions(oneShot, { latest: true }, today).choices.secondary.some((action) => action.id === "addToCalendar"),
    false
  );
  const saved = { ...programme, uploadedAt: 1, uploadResult: { workoutsScheduled: 0, workoutsCreated: 2, destination: "nativePlan" } };
  assert.deepEqual(artifactActions(saved, { latest: true }, today), { kind: "saved", addToCalendar: true });
  assert.deepEqual(artifactActions(saved, { latest: true, onCalendar: true }, today), { kind: "saved", addToCalendar: false });
  const asSessions = { ...programme, uploadedAt: 1, uploadResult: { workoutsScheduled: 2, workoutsCreated: 2, destination: "calendar" } };
  assert.deepEqual(artifactActions(asSessions, { latest: true }, today), { kind: "saved", addToCalendar: false }, "sessions already on the calendar are not a plan");
}

console.log("test-creation-choices: ok");
