import assert from "node:assert/strict";
import {
  overviewActivities,
  overviewStatusTrend,
} from "../src/training/overview/overviewModel.ts";
import { buildRunWeeks } from "../src/running/runMetrics.ts";
import { mergeTrainingDayLists } from "../electron/trainingTrendUtils.ts";
import {
  overviewEnduranceActivities,
  overviewEnduranceZones,
} from "../src/training/overview/overviewEnduranceZones.ts";

const now = new Date(2026, 9, 26, 12);
// A partial daily payload must not erase the fitness history from analytics.
const merged = mergeTrainingDayLists({dayList:[{happenDay:"20261026",cti:undefined,ati:undefined,trainingLoadRatio:0,rhr:49}]},{dayList:[{happenDay:"20261026",cti:72,ati:91,trainingLoadRatio:1.2}]});
assert.equal(merged[0].cti,72);
assert.equal(merged[0].ati,91);
assert.equal(merged[0].trainingLoadRatio,0);
assert.equal(merged[0].rhr,49);
assert.equal(overviewStatusTrend(merged,"20261026").at(-1).baseFitness,72);
const day = (back) => {
  const d = new Date(Date.UTC(2026, 9, 26 - back));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
};
const activity = (id, date) => ({
  activityId: id,
  startTime: date.getTime() / 1000,
});
const rows = [
  activity("first", new Date(2026, 8, 27)),
  activity("old", new Date(2026, 8, 26, 23, 59)),
  activity("now", now),
  activity("future", new Date(2026, 9, 26, 13)),
  { activityId: "missing" },
];
assert.deepEqual(
  overviewActivities(rows, now).map((a) => a.activityId),
  ["first", "now"],
);

// Values are COROS's readings, with no warm-up, smoothing or inferred days.
const metrics = [
  { happenDay: day(2), cti: 42, ati: 65 },
  { happenDay: day(0), cti: 0, ati: 12 },
];
const full = overviewStatusTrend(metrics, day(0));
assert.equal(full.length, 28);
assert.deepEqual(full.at(-1), { day: day(0), baseFitness: 0, loadImpact: 12 });
assert.deepEqual(full.at(-3), { day: day(2), baseFitness: 42, loadImpact: 65 });
assert.equal(full.at(-2).baseFitness, undefined);
assert.equal(full.at(-2).loadImpact, undefined);
assert.deepEqual(
  overviewStatusTrend(
    [{ happenDay: day(0), cti: NaN, ati: 3 }],
    day(0),
  ).at(-1),
  { day: day(0), baseFitness: undefined, loadImpact: 3 },
);
assert.deepEqual(
  overviewStatusTrend(
    [...metrics, { happenDay: day(-1), cti: 900 }],
    day(0),
  ),
  full,
);
assert.deepEqual(overviewStatusTrend(metrics, "invalid"), []);

// Keep the reported COROS date and its exact readings, despite distinct fields
// for Running Fitness and fatigue in the same payload.
const corosStatus = overviewStatusTrend([
  { happenDay: "20261025", cti: 109, ati: 123, staminaLevel: 75, tiredRateNew: 47 },
  { happenDay: "20261026", staminaLevel: 76, tiredRateNew: 48 },
], "20261026");
assert.deepEqual(corosStatus.at(-2), {
  day: "20261025", baseFitness: 109, loadImpact: 123,
});
assert.deepEqual(corosStatus.at(-1), {
  day: "20261026", baseFitness: undefined, loadImpact: undefined,
});

// Five calendar weeks, including the current partial week, across a year edge.
const weeks = buildRunWeeks([], {
  weeks: 5,
  nowMs: new Date(2027, 0, 1, 12).getTime(),
});
assert.equal(weeks.length, 5);
assert(weeks.every((w) => new Date(w.weekStartMs).getDay() === 1));
assert.equal(new Date(weeks.at(-1).weekStartMs).getDate(), 28);

// HR distribution must be invariant to adding lifting, climbing or ball sports.
const sports = [
  100,
  104,
  200,
  300,
  502,
  701,
  900,
  903,
  402,
  400,
  106,
  800,
  1000,
  1200,
  9999,
  undefined,
].map((sportType, i) => ({
  ...activity(String(i), now),
  sportType,
  duration: 600,
  trainingLoad: 100,
  avgHr: 160,
}));
const eligible = overviewEnduranceActivities(sports, now);
assert.deepEqual(
  eligible.map((a) => a.sportType),
  [100, 104, 200, 300, 502, 701, 900, 903],
);
assert.equal(
  overviewEnduranceActivities(
    [
      { ...sports[0], startTime: +new Date(2026, 8, 28) / 1000 },
      { ...sports[0], startTime: +new Date(2026, 9, 27) / 1000 },
    ],
    now,
  ).length,
  0,
);
const zones = [{ index: 0, hr: 140 }, { index: 1, hr: 170 }, { index: 2 }];
const run = { ...sports[0], activityId: "run", trainingLoad: 60 };
const lift = {
  ...run,
  activityId: "lift",
  sportType: 402,
  trainingLoad: 9999,
  duration: 99999,
};
const split = new Map([["run", { zoneSeconds: [300, 200, 100] }]]);
const time = overviewEnduranceZones([run], split, zones, "time");
assert.deepEqual(
  time.entries.map((z) => z.value),
  [300, 200, 100],
);
assert.equal(time.measured, 1);
assert.equal(time.estimated, 0);
assert.deepEqual(
  overviewEnduranceZones([run, lift], split, zones, "time"),
  time,
);
const load = overviewEnduranceZones([run, lift], split, zones, "trainingLoad");
assert.deepEqual(
  load.entries.map((z) => z.value),
  [30, 20, 10],
);
assert.equal(load.total, 60);
const fallback = overviewEnduranceZones([run], new Map(), zones, "time");
assert.deepEqual(
  fallback.entries.map((z) => z.value),
  [0, 600, 0],
);
assert.equal(fallback.estimated, 1);
const missing = overviewEnduranceZones(
  [{ ...run, avgHr: undefined }],
  new Map(),
  zones,
  "time",
);
assert.equal(missing.total, 0);
assert.equal(missing.unplaced, 1);
assert.equal(
  overviewEnduranceZones(
    [{ ...run, trainingLoad: undefined }],
    split,
    zones,
    "trainingLoad",
  ).total,
  0,
);
// Recorded zone time remains useful when the activity row omitted duration.
const durationless = overviewEnduranceZones(
  [{ ...run, duration: undefined }], split, zones, "time",
);
assert.equal(durationless.total, 600);
assert.equal(durationless.measured, 1);
assert.equal(durationless.unplaced, 0);

// Unknown ceilings cannot turn an unplaced session into 100% in the top zone.
for (const invalidZones of [
  [{ index: 0 }, { index: 1 }, { index: 2 }],
  [{ index: 0, hr: NaN }, { index: 1, hr: 170 }, { index: 2 }],
  [{ index: 0, hr: 170 }, { index: 1, hr: 140 }, { index: 2 }],
]) {
  const result = overviewEnduranceZones([run], new Map(), invalidZones, "time");
  assert.equal(result.total, 0);
  assert.equal(result.estimated, 0);
  assert.equal(result.unplaced, 1);
}
// No ceilings are needed to read an actual split, and an open top zone is valid.
assert.equal(overviewEnduranceZones([run], split, zones.map(({index}) => ({index})), "time").measured, 1);
assert.equal(overviewEnduranceZones([{ ...run, avgHr: 190 }], new Map(), zones, "time").entries[2].value, 600);
assert.equal(overviewEnduranceZones([{ ...run, trainingLoad: 0 }], split, zones, "trainingLoad").estimated, 0);
assert.equal(overviewEnduranceZones([{ ...run, trainingLoad: NaN }], split, zones, "trainingLoad").unplaced, 1);
// A corrupt or tiny split falls back to the recorded average, never negative time.
for (const zoneSeconds of [[-1, 601, 0], [NaN, 200, 100], [10, 10, 10]]) {
  const result = overviewEnduranceZones([run], new Map([["run", { zoneSeconds }]]), zones, "time");
  assert.equal(result.measured, 0);
  assert.equal(result.estimated, 1);
  assert.equal(result.total, 600);
}

console.log(
  "overview model OK — 30-day boundaries, direct COROS readings, missing days, future data and five calendar weeks",
);
