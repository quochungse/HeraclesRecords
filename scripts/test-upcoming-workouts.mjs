import assert from "node:assert/strict";
import { parseScheduledWorkoutEntries, parseUpcomingWorkouts } from "../dist-electron/trainingHubService.js";

const fixture = {
  entities: [
    {
      happenDay: 20260627,
      planProgramId: "101",
      sortNo: 1,
      status: 1,
      // The activity that did it: COROS's link, and never the plan's figures.
      labelId: "478804000000000001",
      sportData: { name: "Morning Run", trainingLoad: 222, distance: 1001000, labelId: "478804000000000001" }
    },
    {
      happenDay: 20260628,
      planProgramId: "102",
      sortNo: 1,
      status: 1
    },
    {
      happenDay: 20260629,
      planProgramId: "103",
      sortNo: 1,
      status: 1
    },
    {
      happenDay: 20260630,
      planProgramId: "104",
      sortNo: 1,
      status: 1
    },
    {
      happenDay: 20260704,
      planProgramId: "105",
      sortNo: 1,
      status: 1
    }
  ],
  programs: [
    {
      id: "p101",
      idInPlan: 101,
      name: "Rolling 400s",
      overview: "  Jog the recoveries; hold 5k pace.  ",
      exerciseNum: 13,
      trainingLoad: 94,
      distance: 0
    },
    {
      id: "p102",
      idInPlan: 102,
      name: "Canada Day road race",
      exerciseNum: 1,
      trainingLoad: 167,
      distance: 500000
    },
    {
      id: "p103",
      idInPlan: 103,
      name: "Taper 400s",
      overview: "   ",
      exerciseNum: 15,
      trainingLoad: 83,
      distance: 0
    },
    {
      id: "p104",
      idInPlan: 104,
      name: "7km Easy Run",
      essence: 55,
      estimatedType: 2,
      estimatedValue: 3000,
      exerciseNum: 1,
      distance: 700000
    },
    {
      id: "p105",
      idInPlan: 105,
      name: "7.5km Long Run",
      trainingLoad: 0,
      estimatedType: 6,
      estimatedValue: 81,
      exerciseNum: 1,
      distance: 750000
    }
  ]
};

const workoutsToday = parseUpcomingWorkouts(fixture, "20260627");

assert.equal(workoutsToday.length, 5);
assert.equal(workoutsToday[0]?.name, "Rolling 400s");

const workoutsTomorrow = parseUpcomingWorkouts(fixture, "20260628");

assert.equal(workoutsTomorrow.length, 4);
assert.equal(workoutsTomorrow[0]?.name, "Canada Day road race");
assert.equal(
  workoutsTomorrow.some((workout) => workout.name === "Rolling 400s"),
  false
);

const workouts = workoutsToday;
assert.equal(workouts[0]?.name, "Rolling 400s");
assert.equal(workouts[0]?.volume, "13 set(s)");
assert.equal(workouts[0]?.trainingLoad, 94);
assert.equal(workouts[1]?.volume, "5.00km");
assert.equal(workouts[1]?.trainingLoad, 167);
assert.equal(workouts[2]?.volume, "15 set(s)");
assert.equal(workouts[3]?.volume, "7.00km");
assert.equal(workouts[3]?.trainingLoad, undefined);
assert.equal(workouts[4]?.volume, "7.50km");

// A done session's planned figures are its program's, not its activity's.
assert.equal(workouts[0]?.name, "Rolling 400s", "the plan's name, not the activity's");
assert.equal(workouts[0]?.trainingLoad, 94, "the plan's load, not the 222 the activity scored");
assert.equal(workouts[0]?.completedActivityId, "478804000000000001");
assert.equal("completedActivityId" in workouts[1], false, "a session not done carries no link");
assert.equal(workouts[3]?.trainingLoad, undefined, "`essence` is no load, nor an `estimatedValue` of another type");
assert.equal(workouts[4]?.trainingLoad, 81, "`estimatedValue` stands in when it is a load");

// The program's `overview` is the session's description: trimmed, and no key
// at all for a session with none (blank counts as none).
assert.equal(workouts[0]?.description, "Jog the recoveries; hold 5k pace.");
assert.equal("description" in workouts[1], false);
assert.equal("description" in workouts[2], false);
const scheduled = parseScheduledWorkoutEntries(fixture);
assert.equal(scheduled[0]?.description, "Jog the recoveries; hold 5k pace.");
assert.equal("description" in scheduled[2], false);

console.log("upcoming workout parsing tests passed");
