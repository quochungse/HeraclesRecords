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

const { pairPlannedWithActual, computeWeeklyStats } = await load(
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
assert.equal(scheduledSportCategory(5), "trail");
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
  const day = (overrides) => ({
    dateKey: "20260918",
    inMonth: true,
    isToday: false,
    isPast: true,
    scheduled: [],
    activities: [],
    pairs: [],
    unplannedActivities: [],
    ...overrides
  });

  const stats = computeWeeklyStats(
    [
      day({
        // No `volume` string anywhere: the structure is the only source.
        scheduled: [
          scheduled({ sportType: 1, trainingLoad: 80, ...runProgram(12000) })
        ],
        activities: [
          activity({
            sportType: 100,
            trainingLoad: 74,
            distance: 11500,
            duration: 3600
          })
        ]
      })
    ],
    "metric"
  );
  assert.equal(stats.plannedLoad, 80);
  assert.equal(stats.actualLoad, 74);
  assert.equal(
    stats.plannedDistanceKm,
    12,
    "a plan whose distance lives only in its steps still fills the week planned column"
  );
  assert.equal(stats.distanceMeters, 11500);
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

console.log("calendar pairing tests passed");
