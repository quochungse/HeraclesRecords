/**
 * What the plan editor does to a plan, without the editor.
 *
 * Each section is a way the old inline code got a plan wrong, or a rule the
 * rebuilt editor leans on that nothing on screen would reveal until a plan
 * had been saved wrong:
 *
 * 1. A session lands at the bottom of the day it is put in. It used to take
 *    `sortOrder` 0 wherever it went, so a moved session jumped to the top.
 * 2. Deleting a week closes the gap in the stages too. A stage is set on a
 *    week, so a Build on week 6 belongs on the week that is now 5.
 * 3. A keyboard move runs off the end of a week into the next one, and stops
 *    at the plan's edges rather than wrapping or throwing.
 * 4. A week's stage is one of COROS's, and Not Set clears it rather than
 *    storing a zero.
 * 5. A session from the library is a copy of the whole workout — its steps,
 *    its COROS program and the figures COROS stored — because a COROS plan
 *    holds its own copy of every program rather than a link to the library.
 * 6. A copy is a new session to COROS: it claims neither the original's
 *    identity in the plan nor its day on the calendar.
 *
 * Runs through Electron only so `--experimental-strip-types` is available on
 * a Node built without Amaro; the resolver hook is needed because the model
 * imports `trainingPlanDomain` without an extension. It touches no SQLite.
 */
import assert from "node:assert/strict";
import {
  addEntry,
  copyEntry,
  defaultPlanName,
  libraryEntry,
  moveEntry,
  nextSortOrder,
  removeWeek,
  setWeekStage,
  stepSlot,
  withDerivedSportMix,
  writtenEntry
} from "../src/training-library/planEditorModel.ts";

function plan(overrides = {}) {
  return {
    id: "draft:plan-1",
    name: "Base",
    description: "",
    sportMix: [],
    weekCount: 4,
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

const session = (id, weekIndex, dayIndex, sortOrder = 0, sport = "run") => ({
  id,
  weekIndex,
  dayIndex,
  sortOrder,
  title: id,
  workout: { key: id, name: id, sport, save_to_library: false }
});

const at = (doc, id) => doc.entries.find((entry) => entry.id === id);

// ---------------------------------------------------------------------------
// 1. Arrivals land at the bottom of their day
// ---------------------------------------------------------------------------
{
  let doc = plan({
    entries: [session("a", 0, 1, 0), session("b", 0, 1, 1), session("c", 0, 3, 0)]
  });
  assert.equal(nextSortOrder(doc, { weekIndex: 0, dayIndex: 1 }), 2);
  assert.equal(nextSortOrder(doc, { weekIndex: 0, dayIndex: 5 }), 0, "an empty day starts at 0");

  doc = moveEntry(doc, "c", { weekIndex: 0, dayIndex: 1 });
  assert.equal(at(doc, "c").dayIndex, 1);
  assert.equal(
    at(doc, "c").sortOrder,
    2,
    "a moved session goes under the two already there — at 0 it jumped to the top"
  );

  const unchanged = moveEntry(doc, "a", { weekIndex: 0, dayIndex: 1 });
  assert.equal(unchanged, doc, "dropping a session on its own day changes nothing");

  doc = addEntry(doc, writtenEntry({ key: "new", name: "New", sport: "bike" }), { weekIndex: 9, dayIndex: 12 });
  const added = doc.entries.at(-1);
  assert.deepEqual([added.weekIndex, added.dayIndex, added.sortOrder], [3, 6, 0], "a slot past the plan is clamped into it");
}

// ---------------------------------------------------------------------------
// 2. Deleting a week closes the gap in the stages
// ---------------------------------------------------------------------------
{
  const doc = plan({
    weekCount: 8,
    entries: [session("w2", 1, 0), session("w3", 2, 0), session("w6", 5, 0)],
    weekStages: [
      { weekIndex: 0, stage: 2 },
      { weekIndex: 2, stage: 1 },
      { weekIndex: 5, stage: 3 }
    ]
  });
  const next = removeWeek(doc, 2);
  assert.equal(next.weekCount, 7);
  assert.equal(at(next, "w3"), undefined, "the week's sessions go with it");
  assert.equal(at(next, "w6").weekIndex, 4, "and later weeks move up");
  assert.deepEqual(
    next.weekStages,
    [
      { weekIndex: 0, stage: 2 },
      { weekIndex: 4, stage: 3 }
    ],
    "the deleted week's stage goes, and Build moves up with its week"
  );

  const only = plan({ weekCount: 1 });
  assert.equal(removeWeek(only, 0), only, "the last week of a plan cannot be deleted");
}

// ---------------------------------------------------------------------------
// 3. A keyboard move steps through days and weeks, and stops at the edges
// ---------------------------------------------------------------------------
{
  assert.deepEqual(stepSlot({ weekIndex: 0, dayIndex: 2 }, "next-day", 4), { weekIndex: 0, dayIndex: 3 });
  assert.deepEqual(
    stepSlot({ weekIndex: 0, dayIndex: 6 }, "next-day", 4),
    { weekIndex: 1, dayIndex: 0 },
    "the day after Sunday is Monday of the next week"
  );
  assert.deepEqual(stepSlot({ weekIndex: 2, dayIndex: 0 }, "previous-day", 4), { weekIndex: 1, dayIndex: 6 });
  assert.equal(stepSlot({ weekIndex: 0, dayIndex: 0 }, "previous-day", 4), undefined, "the plan's first day is an edge");
  assert.equal(stepSlot({ weekIndex: 3, dayIndex: 6 }, "next-day", 4), undefined, "and so is its last");
  assert.deepEqual(stepSlot({ weekIndex: 1, dayIndex: 4 }, "next-week", 4), { weekIndex: 2, dayIndex: 4 });
  assert.equal(stepSlot({ weekIndex: 3, dayIndex: 4 }, "next-week", 4), undefined);
  assert.equal(stepSlot({ weekIndex: 0, dayIndex: 4 }, "previous-week", 4), undefined);
}

// ---------------------------------------------------------------------------
// 4. A week's stage is set, replaced and cleared
// ---------------------------------------------------------------------------
{
  let doc = setWeekStage(plan(), 2, 3);
  doc = setWeekStage(doc, 0, 2);
  assert.deepEqual(doc.weekStages, [{ weekIndex: 0, stage: 2 }, { weekIndex: 2, stage: 3 }], "kept in week order");
  doc = setWeekStage(doc, 2, 4);
  assert.deepEqual(doc.weekStages, [{ weekIndex: 0, stage: 2 }, { weekIndex: 2, stage: 4 }], "one stage a week");
  doc = setWeekStage(doc, 0, 0);
  assert.deepEqual(doc.weekStages, [{ weekIndex: 2, stage: 4 }], "Not Set is the absence of a stage, not a stored zero");
}

// ---------------------------------------------------------------------------
// 5. A library session is a copy of the whole workout
// ---------------------------------------------------------------------------
{
  const program = { id: "w-77", name: "Tempo 5 x 1k", sportType: 1, exercises: [{ id: "1" }] };
  const entry = libraryEntry({
    title: "Tempo 5 x 1k",
    workout: { key: "library:w-77:x", name: "Tempo 5 x 1k", sport: "run", save_to_library: false, steps: [] },
    corosProgram: program,
    plannedDurationSeconds: 3120,
    plannedStrengthSets: undefined
  });
  assert.equal(entry.corosProgram, program, "the program travels with the session, to be written into the plan");
  assert.equal(entry.title, "Tempo 5 x 1k");
  assert.equal(entry.plannedDurationSeconds, 3120, "with the figures COROS stored for it");
  assert.equal(entry.idInPlan, undefined, "and no identity in a plan until the plan is saved");
  assert.equal("programId" in entry, false, "nothing links a plan session to the library");
}

// ---------------------------------------------------------------------------
// 6. A copy is new, and claims nothing of the original's on COROS
// ---------------------------------------------------------------------------
{
  const original = { ...session("a", 0, 0), idInPlan: "4", happenDay: "20260302", corosProgram: { id: "p" } };
  const doc = copyEntry(plan({ entries: [original] }), "a", { weekIndex: 1, dayIndex: 0 });
  assert.equal(doc.entries.length, 2);
  const copy = doc.entries[1];
  assert.notEqual(copy.id, "a");
  assert.equal(copy.idInPlan, undefined, "two sessions claiming one idInPlan would be one session to COROS");
  assert.equal(copy.happenDay, undefined);
  assert.equal(copy.corosProgram.id, "p", "the steps are the same, so the program is kept");
  assert.deepEqual([copy.weekIndex, copy.dayIndex], [1, 0]);
  copy.workout.name = "changed";
  assert.equal(doc.entries[0].workout.name, "a", "deeply, so editing the copy leaves the original");

  const mixed = withDerivedSportMix(
    plan({ entries: [session("r", 0, 0), session("b", 0, 1, 0, "bike"), session("r2", 0, 2)] })
  );
  assert.deepEqual(mixed.sportMix, ["run", "bike"]);
}

// ---------------------------------------------------------------------------
// 7. A new plan opens named, and not after one already in the library
// ---------------------------------------------------------------------------
{
  assert.equal(defaultPlanName([]), "New plan");
  assert.equal(defaultPlanName(["Autumn 10k"]), "New plan");
  assert.equal(defaultPlanName(["new plan "]), "New plan 2", "compared trimmed and case-blind");
  assert.equal(defaultPlanName(["New plan", "New plan 2", "New plan 4"]), "New plan 3");
}

console.log(
  "plan editor model OK — arrivals land at the bottom, a deleted week closes " +
    "the stages' gap, keyboard moves stop at the edges, a stage is one of COROS's, " +
    "library sessions are whole copies, a copy claims nothing, a new plan opens named"
);
