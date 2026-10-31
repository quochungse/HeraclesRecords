/**
 * Planned-vs-actual pairing on the calendar.
 *
 * A day's scheduled workouts are matched to the activities recorded on it, and
 * the match decides three visible things: which chip is drawn as completed,
 * what the completion badge says, and which activities are left over as
 * unplanned. Two rules hold it up, and both replaced something that was quietly
 * wrong:
 *
 *   1. **Sport codes decide compatibility, not the workout's name.** The old
 *      matcher bucketed both sides through an English run-vocabulary regex over
 *      free text. A plan's own naming -- "Week 3 Session 2" -- fell to `other`,
 *      which is compatible with everything, so a swim was shown as completing a
 *      prescribed strength session and its completion percentage was computed
 *      against the wrong plan. Names are the fallback now, for an entry COROS
 *      sent no sport code with, and nothing more.
 *
 *   2. **A time-based plan has a completion percentage.** COROS's `volume`
 *      string is only ever a distance in km or a set count -- a workout
 *      prescribed in minutes arrives with no volume at all -- so an entire
 *      class of plan showed no adherence signal anywhere. The planned duration
 *      is in the steps, and that is what is read.
 *
 * Run: npm run test:calendar-pairing
 *
 * Launched through Electron rather than plain `node` only so the suite survives
 * a Node built without Amaro; it touches no SQLite and needs no window.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = async (...segments) => {
  const url = pathToFileURL(path.join(repoRoot, ...segments));
  return import(`${url.href}?cacheBust=${Date.now()}`);
};

const { pairPlannedWithActual, computeWeeklyStats, plannedSessionSeconds } = await load(
  "src",
  "calendar",
  "pairing.ts"
);
const { scheduledSportCategory, scheduledWorkoutSport, workoutSportLabel } =
  await load("src", "training", "workoutSport.ts");

/* --- the resolver the whole thing rests on --------------------------------- */

// Program sport codes, not activity codes: 2 is Bike as a program and nothing
// at all as an activity, which is exactly the confusion this exists to stop.
assert.equal(scheduledWorkoutSport(1), "run");
assert.equal(scheduledSportCategory(1), "run");
assert.equal(scheduledSportCategory(2), "bike");
assert.equal(scheduledSportCategory(5), "run", "a trail run is a run");
assert.equal(
  scheduledSportCategory(undefined),
  undefined,
  "no code must answer undefined, so a caller can fall back rather than paint every unknown workout as other"
);
assert.equal(
  workoutSportLabel(scheduledWorkoutSport(2)),
  "Bike",
  "the library badge named every supported workout Run; it names the sport now"
);

/* --- fixtures -------------------------------------------------------------- */

const runProgram = (meters) => ({
  rawProgram: {
    sportType: 1,
    exercises: [
      {
        id: "1",
        exerciseType: 2,
        targetType: 5,
        targetValue: meters * 100,
        sets: 1,
        sortNo: 1
      }
    ]
  }
});

/** A workout prescribed in time, which carries no `volume` string at all. */
const timedProgram = (seconds, sportType = 1) => ({
  rawProgram: {
    sportType,
    exercises: [
      {
        id: "1",
        exerciseType: 2,
        targetType: 2,
        targetValue: seconds,
        sets: 1,
        sortNo: 1
      }
    ]
  }
});

const scheduled = (overrides) => ({
  planId: "p",
  idInPlan: "i",
  planProgramId: "pp",
  happenDay: "20260918",
  name: "Workout",
  ...overrides
});

const activity = (overrides) => ({
  activityId: "a",
  name: "Activity",
  ...overrides
});

/* --- 1. a plan-numbered workout must not swallow an unrelated session ------ */

{
  // The name tells you nothing -- this is how a generated plan names its days.
  const strength = scheduled({
    name: "Week 3 Session 2",
    sportType: 4, // strength, as a program code
    trainingLoad: 60
  });
  const swim = activity({
    activityId: "swim-1",
    name: "Morning swim",
    sportType: 301,
    trainingLoad: 58
  });

  const { pairs, unplanned } = pairPlannedWithActual(
    [strength],
    [swim],
    "metric"
  );
  assert.equal(pairs.length, 1);
  assert.equal(
    pairs[0].activity,
    undefined,
    "a strength plan and a swim are different sports; the name said nothing and must not be asked"
  );
  assert.deepEqual(
    unplanned.map((entry) => entry.activityId),
    ["swim-1"],
    "the swim is a session the athlete did off-plan, and the day has to say so"
  );
}

/* --- 2. the same sport still pairs, and the closest one wins --------------- */

{
  const easy = scheduled({
    name: "Week 3 Session 1",
    sportType: 1,
    trainingLoad: 50
  });
  const short = activity({
    activityId: "run-short",
    sportType: 100,
    trainingLoad: 20
  });
  const onPlan = activity({
    activityId: "run-on-plan",
    sportType: 100,
    trainingLoad: 48
  });

  const { pairs, unplanned } = pairPlannedWithActual(
    [easy],
    [short, onPlan],
    "metric"
  );
  assert.equal(pairs[0].activity.activityId, "run-on-plan");
  assert.equal(pairs[0].completionPct, 96);
  assert.deepEqual(unplanned.map((entry) => entry.activityId), ["run-short"]);
}

/* --- 3. a trail run completes a prescribed road run, and a hike does too --- */

{
  const run = scheduled({ sportType: 1, trainingLoad: 40 });
  const trail = activity({
    activityId: "trail",
    sportType: 102,
    trainingLoad: 42
  });
  const { pairs } = pairPlannedWithActual([run], [trail], "metric");
  assert.equal(
    pairs[0].activity.activityId,
    "trail",
    "the same session logged on different terrain"
  );
}

{
  // Hike is a `trail` activity, which is the same family as a prescribed run.
  const run = scheduled({ sportType: 1, trainingLoad: 40 });
  const hike = activity({ activityId: "hike", sportType: 104, trainingLoad: 25 });
  const { pairs } = pairPlannedWithActual([run], [hike], "metric");
  assert.equal(pairs[0].activity.activityId, "hike");
}

/* --- 4. sports the five-colour palette cannot tell apart still pair -------- */

{
  // Swim has no colour of its own: it shares the "other" category with yoga,
  // climbing, rowing and every unmapped code. That is exactly why this is
  // decided by sport family and not by what the chip is painted -- a
  // palette-based check would have read these two as the same sport.
  const swimPlan = scheduled({ sportType: 3, trainingLoad: 30 });
  const swim = activity({ activityId: "swim", sportType: 301, trainingLoad: 31 });
  const { pairs } = pairPlannedWithActual([swimPlan], [swim], "metric");
  assert.equal(pairs[0].activity.activityId, "swim");
}

/* --- 5. no sport code on either side falls back to the names --------------- */

{
  const namedRun = scheduled({ name: "Easy run" });
  const ride = activity({
    activityId: "ride",
    name: "Evening ride",
    sportName: "Bike"
  });
  const { pairs, unplanned } = pairPlannedWithActual(
    [namedRun],
    [ride],
    "metric"
  );
  assert.equal(
    pairs[0].activity,
    undefined,
    "with no codes anywhere the old heuristic is all there is, and it still refuses a ride for a run"
  );
  assert.equal(unplanned.length, 1);
}

/* --- 6. a time-based plan gets a completion percentage -------------------- */

{
  // 45 minutes prescribed, 40 recorded, and no training load on either side --
  // before the structure was read this pair showed no badge at all.
  const timed = scheduled({
    name: "Aerobic 45",
    sportType: 1,
    ...timedProgram(2700)
  });
  const done = activity({ activityId: "timed", sportType: 100, duration: 2400 });
  const { pairs } = pairPlannedWithActual([timed], [done], "metric");
  assert.equal(pairs[0].activity.activityId, "timed");
  assert.equal(pairs[0].completionPct, 89);
}

/* --- 7. load beats distance beats duration -------------------------------- */

{
  const withLoad = scheduled({
    sportType: 1,
    trainingLoad: 100,
    ...runProgram(10000)
  });
  const ran = activity({
    activityId: "r",
    sportType: 100,
    trainingLoad: 75,
    distance: 10000
  });
  const { pairs } = pairPlannedWithActual([withLoad], [ran], "metric");
  assert.equal(
    pairs[0].completionPct,
    75,
    "load is the honest measure and is asked first, even when the distance was met exactly"
  );
}

{
  const distanceOnly = scheduled({ sportType: 1, ...runProgram(10000) });
  const ran = activity({
    activityId: "r",
    sportType: 100,
    distance: 5000,
    duration: 1800
  });
  const { pairs } = pairPlannedWithActual([distanceOnly], [ran], "metric");
  assert.equal(pairs[0].completionPct, 50);
}

/* --- 8. each activity is consumed once ------------------------------------ */

{
  const first = scheduled({ idInPlan: "1", sportType: 1, trainingLoad: 50 });
  const second = scheduled({ idInPlan: "2", sportType: 1, trainingLoad: 50 });
  const only = activity({ activityId: "one", sportType: 100, trainingLoad: 50 });
  const { pairs, unplanned } = pairPlannedWithActual(
    [first, second],
    [only],
    "metric"
  );
  assert.equal(pairs[0].activity.activityId, "one");
  assert.equal(
    pairs[1].activity,
    undefined,
    "the second plan has nothing left to claim"
  );
  assert.equal(unplanned.length, 0);
}

/* --- 9. the week's planned distance comes from the steps too -------------- */

{
  // Built the way the calendar builds a day, through the pairing — the week's
  // figures are read off the pairs, so a hand-made day with an empty `pairs`
  // would be testing a shape the screen never produces.
  const day = (scheduledEntries, activities) => ({
    dateKey: "20260918",
    inMonth: true,
    isToday: false,
    isPast: true,
    scheduled: scheduledEntries,
    activities,
    unplannedActivities: [],
    ...pairPlannedWithActual(scheduledEntries, activities, "metric")
  });

  const stats = computeWeeklyStats([
    day(
      // No `volume` string anywhere: the structure is the only source.
      [scheduled({ sportType: 1, trainingLoad: 80, ...runProgram(12000) })],
      [
        activity({
          sportType: 100,
          trainingLoad: 74,
          distance: 11500,
          duration: 3600
        })
      ]
    )
  ]);
  assert.equal(stats.plannedLoad, 80);
  assert.equal(stats.actualLoad, 74);
  assert.equal(
    stats.plannedDistanceKm,
    12,
    "a plan whose distance lives only in its steps still fills the week planned column"
  );
  assert.equal(stats.distanceMeters, 11500);
  assert.equal(stats.plannedSessions, 1);
  assert.equal(stats.plannedSessionsDone, 1);
  assert.equal(stats.plannedDoneSeconds, 3600, "the time the activity that answered the plan took");
  assert.equal(stats.remainingLoad, 0, "a session done leaves nothing still to come");
  assert.equal(stats.plannedSeconds, undefined, "a plan COROS gave no time for has no planned time");
}

/* --- 9a. Load Impact and Base Fitness are COROS's `ati` and `cti` ---------- */

{
  // Probed on a real account (2026-10-28): both come on every day and their
  // ratio is the day's. `tiredRateNew` is `ati − cti`, and `staminaLevel` comes
  // only on a day with a run, so the week's last day has none.
  const day = (dateKey, metric) => ({
    dateKey,
    inMonth: true,
    isToday: false,
    isPast: true,
    scheduled: [],
    activities: [],
    unplannedActivities: [],
    metric,
    ...pairPlannedWithActual([], [], "metric")
  });
  const stats = computeWeeklyStats([
    day("20261027", { happenDay: "20261027", ati: 118, cti: 108, tiredRateNew: 10, trainingLoadRatio: 1.09, staminaLevel: 71.8 }),
    day("20261028", { happenDay: "20261028", ati: 101, cti: 106, tiredRateNew: -5, trainingLoadRatio: 0.95 })
  ]);
  assert.equal(stats.loadImpact, 101, "the week's newest `ati`");
  assert.equal(stats.baseFitness, 106, "the week's newest `cti`, not the last run's `staminaLevel`");
  assert.equal(stats.loadRatio, 0.95);
}

/* --- 9b. the plan apart from the week as it was --------------------------- */

{
  // The week column counts the plan's sessions and their time apart from
  // everything done, so a session nobody planned never reads as part of it.
  const day = (dateKey, isPast, scheduledEntries, activities) => {
    const { pairs, unplanned } = pairPlannedWithActual(scheduledEntries, activities, "metric");
    return { dateKey, inMonth: true, isToday: false, isPast, scheduled: scheduledEntries, activities, pairs, unplannedActivities: unplanned };
  };
  const easy = scheduled({ idInPlan: "easy", sportType: 1, trainingLoad: 60, rawProgram: { estimatedTime: 3277, duration: 3277 } });
  const gym = scheduled({ idInPlan: "gym", sportType: 4, rawProgram: { estimatedTime: 2616 } });
  const tempo = scheduled({ idInPlan: "tempo", sportType: 1, trainingLoad: 90, rawProgram: { estimatedTime: 3540 } });
  const longRun = scheduled({ idInPlan: "long", sportType: 1, trainingLoad: 200, rawProgram: { estimatedTime: 0, duration: 7320 } });

  const { pairs } = pairPlannedWithActual([gym], [], "metric");
  assert.equal(pairs[0].targets.expectedSeconds, 2616, "a strength session has COROS's own time, where its steps have none");
  assert.equal(pairs[0].targets.plannedSeconds, 2616);

  const stats = computeWeeklyStats([
    day("20261005", true, [easy], [activity({ sportType: 100, trainingLoad: 58, duration: 3300 }), activity({ activityId: "extra", sportType: 400, trainingLoad: 30, duration: 2400 })]),
    day("20261006", true, [gym], []),
    day("20261008", false, [tempo], []),
    day("20261010", false, [longRun], [])
  ]);
  assert.equal(stats.plannedSessions, 4, "the sessions on the calendar, and only those");
  assert.equal(stats.plannedSessionsDone, 1);
  assert.equal(stats.plannedDoneSeconds, 3300, "the session nobody planned is not the plan's time");
  assert.equal(stats.activityTimeSeconds, 5700, "but it is the week's");
  assert.equal(stats.remainingLoad, 290, "what is still to come: days not gone, sessions not done — the missed gym day is neither");
  assert.equal(stats.plannedSeconds, 3277 + 2616 + 3540 + 7320, "a 0 is no estimate, so the duration stands in");

  const untimed = computeWeeklyStats([day("20261005", true, [easy, scheduled({ idInPlan: "x", sportType: 4 })], [])]);
  assert.equal(untimed.plannedSeconds, undefined, "a total over some of the plan would read as all of it");
}

/* --- 9b2. COROS's own link -------------------------------------------------- */

{
  // COROS records which activity did a session (`completedActivityId`). That
  // activity is the pair, though another run sits closer to the plan's load;
  // a link the athlete made still outranks it, and a link to an activity not
  // in the day falls back to the guess.
  const key = (entry) => JSON.stringify([entry.planId, entry.idInPlan]);
  const plan = scheduled({ idInPlan: "lr", sportType: 1, trainingLoad: 144, completedActivityId: "long" });
  const long = activity({ activityId: "long", sportType: 100, trainingLoad: 230 });
  const short = activity({ activityId: "short", sportType: 100, trainingLoad: 62 });

  const linked = pairPlannedWithActual([plan], [short, long], "metric");
  assert.equal(linked.pairs[0].activity.activityId, "long", "COROS's link, not the closer load");
  assert.equal(linked.pairs[0].completionPct, 160);
  assert.deepEqual(linked.unplanned.map((entry) => entry.activityId), ["short"]);

  const handLinked = pairPlannedWithActual([plan], [short, long], "metric", new Map([[key(plan), { kind: "activity", activityId: "short" }]]));
  assert.equal(handLinked.pairs[0].activity.activityId, "short", "the athlete's link outranks COROS's");

  const gone = pairPlannedWithActual([{ ...plan, completedActivityId: "elsewhere" }], [short, long], "metric");
  assert.equal(gone.pairs[0].activity.activityId, "short", "a link to nothing here leaves the guess");
}

/* --- 9c. the time a card and the session panel state ---------------------- */

{
  // A run in kilometres with one timed float: its steps sum to the float, and
  // that sum is no figure for the session. COROS's estimate is; without one,
  // only a session timed in every step adds up to its own length.
  const step = (id, targetType, targetValue) => ({ id, exerciseType: 2, targetType, targetValue, sets: 1, sortNo: Number(id) });
  const mixed = (rawExtra = {}) => scheduled({
    sportType: 1,
    rawProgram: { sportType: 1, ...rawExtra, exercises: [step("1", 5, 500000), step("2", 2, 180), step("3", 5, 500000)] }
  });
  const target = (entry) => pairPlannedWithActual([entry], [], "metric").pairs[0].targets;

  assert.equal(target(mixed()).durationSeconds, 180, "the timed steps alone, as completion reads them");
  assert.equal(target(mixed()).plannedSeconds, undefined, "a float is not the session's length");
  assert.equal(target(mixed({ estimatedTime: 4320 })).plannedSeconds, 4320, "COROS's estimate first");
  assert.equal(target(scheduled({ sportType: 1, ...timedProgram(2700) })).plannedSeconds, 2700, "every step timed adds up to the session");
  assert.equal(
    plannedSessionSeconds(undefined, { durationSeconds: undefined, stepCount: 0, timedSteps: 0 }),
    undefined,
    "no steps, no time"
  );
}

/* --- 10. the plan's own volume, not COROS's set count -------------------- */

{
  // COROS reports a step count as the volume whenever a program has more than
  // one step, so a 13 km long run built as warm-up / main / cool-down arrives
  // as "3 set(s)". The pair carries the structure's own figures so a chip and
  // the detail panel beside it cannot disagree about what was prescribed.
  const longRun = scheduled({
    name: "Long run",
    sportType: 1,
    volume: "3 set(s)",
    ...runProgram(13000)
  });
  const { pairs } = pairPlannedWithActual([longRun], [], "metric");
  assert.equal(pairs[0].targets.distanceMeters, 13000);
  assert.equal(pairs[0].targets.durationSeconds, undefined);
}

{
  // A strength workout has no distance and no time, so the set count stands.
  const strength = scheduled({ sportType: 4, volume: "9 set(s)" });
  const { pairs } = pairPlannedWithActual([strength], [], "metric");
  assert.equal(pairs[0].targets.distanceMeters, undefined);
  assert.equal(pairs[0].targets.durationSeconds, undefined);
}

/* --- 6. what the athlete said outranks the greedy pass --------------------- */

{
  const key = (entry) => JSON.stringify([entry.planId, entry.idInPlan]);
  const easy = scheduled({ idInPlan: "easy", sportType: 1, trainingLoad: 50 });
  const onPlan = activity({ activityId: "on-plan", sportType: 100, trainingLoad: 49 });
  const other = activity({ activityId: "other", sportType: 100, trainingLoad: 20 });

  const linked = pairPlannedWithActual(
    [easy],
    [onPlan, other],
    "metric",
    new Map([[key(easy), { kind: "activity", activityId: "other" }]])
  );
  assert.equal(linked.pairs[0].activity.activityId, "other", "the activity linked by hand, not the closer guess");
  assert.deepEqual(linked.unplanned.map((entry) => entry.activityId), ["on-plan"]);

  for (const kind of ["skipped", "none"]) {
    const { pairs, unplanned } = pairPlannedWithActual(
      [easy],
      [onPlan],
      "metric",
      new Map([[key(easy), { kind }]])
    );
    assert.equal(pairs[0].activity, undefined, `${kind}: nothing is paired to the session`);
    assert.deepEqual(
      unplanned.map((entry) => entry.activityId),
      ["on-plan"],
      `${kind}: what was done that day stays unplanned rather than being claimed`
    );
  }
}

/* --- 11. strength read in Heracles Training Load -------------------------- */

{
  // The week's figure is the chosen load; COROS's band is set against COROS's
  // own sum, which is kept apart (docs/heracles-training-load.md).
  const heracles = (value) => ({ value, muscular: value, quality: "sets" });
  const gym = scheduled({ idInPlan: "gym", sportType: 4, trainingLoad: 20, heraclesLoad: heracles(150) });
  const next = scheduled({ idInPlan: "next", sportType: 4, heraclesLoad: heracles(140) });
  const lift = activity({ activityId: "lift", sportType: 402, trainingLoad: 25, heraclesLoad: heracles(160) });
  const run = activity({ activityId: "run", sportType: 100, trainingLoad: 80 });
  const day = (dateKey, isPast, scheduledEntries, activities, source) => {
    const { pairs, unplanned } = pairPlannedWithActual(scheduledEntries, activities, "metric", undefined, source);
    return { dateKey, inMonth: true, isToday: false, isPast, scheduled: scheduledEntries, activities, pairs, unplannedActivities: unplanned };
  };
  const week = (source) => [day("20261005", true, [gym], [lift, run], source), day("20261008", false, [next], [], source)];

  const coros = computeWeeklyStats(week("coros"));
  assert.equal(coros.actualLoad, 105);
  assert.equal(coros.actualCorosLoad, 105, "with COROS chosen both sums are COROS's");
  assert.equal(coros.remainingLoad, 0, "COROS priced the strength plan at nothing");
  assert.equal(week("coros")[0].pairs[0].completionPct, 125, "25 of a planned 20");

  const chosen = computeWeeklyStats(week("heracles"), "heracles");
  assert.equal(chosen.actualLoad, 240, "the lift in Heracles's load, the run in COROS's");
  assert.equal(chosen.actualCorosLoad, 105, "the band is still read against COROS's load");
  assert.equal(chosen.plannedLoad, 290);
  assert.equal(chosen.remainingLoad, 140);
  assert.equal(chosen.remainingCorosLoad, 0);
  assert.equal(week("heracles")[0].pairs[0].completionPct, 107, "160 of a planned 150, one scale on both sides");

  // A plan only COROS priced is never set against a figure of the other scale.
  const priced = scheduled({ idInPlan: "priced", sportType: 4, trainingLoad: 20 });
  const { pairs } = pairPlannedWithActual([priced], [lift], "metric", undefined, "heracles");
  assert.equal(pairs[0].completionPct, 125, "COROS against COROS where the plan has no estimate");
}

console.log("calendar pairing tests passed");
