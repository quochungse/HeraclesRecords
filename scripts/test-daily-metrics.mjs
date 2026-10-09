import assert from "node:assert/strict";
import { parseDailyMetrics } from "../dist-electron/trainingHubService.js";

const scaledDistance = parseDailyMetrics({
  dayList: [{ happenDay: 20260625, trainingLoad: 42, distance: 650000, duration: 240000 }]
});

assert.equal(scaledDistance.dayList[0]?.distance, 6500);
assert.equal(scaledDistance.dayList[0]?.duration, 2400);

const aliasFields = parseDailyMetrics({
  dayList: [
    {
      date: 20260626,
      trainingLoad: 68,
      totalDistance: 1120000,
      totalTime: 390000
    }
  ]
});

assert.equal(aliasFields.dayList[0]?.happenDay, "20260626");
assert.equal(aliasFields.dayList[0]?.distance, 11200);
assert.equal(aliasFields.dayList[0]?.duration, 3900);

const listScale = parseDailyMetrics({
  dayList: [{ happenDay: "20260627", distance: 8200, duration: 2700, trainingLoad: 51 }]
});

assert.equal(listScale.dayList[0]?.distance, 8200);
assert.equal(listScale.dayList[0]?.duration, 2700);

// COROS's cycling VO2max rides on every day with 0 for "none" (probed
// 2026-10-09), beside the running vo2max, which is absent on a day off.
const cycling = parseDailyMetrics({
  dayList: [
    { happenDay: 20261008, vo2max: 47, cycleVo2max: 0 },
    { happenDay: 20261009, cycleVo2max: 52 }
  ]
});
assert.equal(cycling.dayList[0]?.vo2max, 47);
assert.equal(cycling.dayList[0]?.cycleVo2max, undefined, "a 0 is no reading");
assert.equal(cycling.dayList[1]?.cycleVo2max, 52);
assert.equal(cycling.dayList[1]?.vo2max, undefined, "the two are not mixed");

console.log("daily metrics parser tests passed");
