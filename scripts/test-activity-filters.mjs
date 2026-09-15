/**
 * The Activities screen's filtering and totals.
 *
 * Launched through Electron rather than plain node: the module graph is `.ts`
 * with extensionless imports, and this machine's `/usr/bin/node` is a distro
 * build without Amaro, so `--experimental-strip-types` throws ERR_NO_TYPESCRIPT
 * there. Electron ships a Node that has it. See CLAUDE.md.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;

const { activityRowFacts } = await import(
  pathToFileURL(path.join(repoRoot, "src/training/activityFacts.ts")).href + bust
);

const {
  ACTIVITY_PERIOD_OPTIONS,
  activityWeekHeading,
  groupActivitiesByWeek,
  DEFAULT_ACTIVITY_FILTERS,
  activityPeriodStartMs,
  filterActivities,
  sportsPresent,
  summariseActivities,
  weeksForPeriod
} = await import(
  pathToFileURL(path.join(repoRoot, "src/training/activityFilters.ts")).href +
    bust
);

const DAY = 24 * 60 * 60 * 1000;

/** A Wednesday, so a Monday cut is visible in both directions. */
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const MONDAY = new Date(2026, 8, 14, 0, 0, 0).getTime();

function activity(overrides) {
  return {
    activityId: overrides.activityId ?? "a1",
    sportType: overrides.sportType ?? 100,
    ...overrides
  };
}

/** COROS sends list start times as epoch seconds. */
function at(ms) {
  return Math.floor(ms / 1000);
}

// ---------------------------------------------------------------------------
// 1. Periods are cut at a Monday, not at "now minus N days"
// ---------------------------------------------------------------------------

assert.equal(
  activityPeriodStartMs(null, NOW),
  null,
  "the whole history has no start"
);
assert.equal(
  activityPeriodStartMs(7, NOW),
  MONDAY,
  "one week is this calendar week, however far into it we are"
);
assert.equal(
  activityPeriodStartMs(28, NOW),
  MONDAY - 21 * DAY,
  "four weeks is four calendar weeks, this one included"
);
assert.equal(weeksForPeriod(90), 13);
assert.equal(weeksForPeriod(1), 1, "a period shorter than a week is still a week");

// A session on Sunday evening of last week is outside "1 week" but a session
// at one minute past Monday midnight is inside it. This is the edge a
// rolling `now - 7 days` window gets wrong in both directions.
const weekEdge = [
  activity({ activityId: "sun", startTime: at(MONDAY - 60_000) }),
  activity({ activityId: "mon", startTime: at(MONDAY + 60_000) })
];
assert.deepEqual(
  filterActivities({
    activities: weekEdge,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, periodDays: 7 },
    nowMs: NOW
  }).map((row) => row.activityId),
  ["mon"]
);

// ---------------------------------------------------------------------------
// 2. An activity with no start time is never dropped by a period
// ---------------------------------------------------------------------------

const undated = [
  activity({ activityId: "undated" }),
  activity({ activityId: "old", startTime: at(NOW - 400 * DAY) })
];
assert.deepEqual(
  filterActivities({
    activities: undated,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, periodDays: 28 },
    nowMs: NOW
  }).map((row) => row.activityId),
  ["undated"],
  "a missing timestamp says nothing about when the session happened"
);

// ---------------------------------------------------------------------------
// 3. Sport filter reads the palette's categories, not raw sport codes
// ---------------------------------------------------------------------------

const mixed = [
  activity({ activityId: "road", sportType: 100, startTime: at(NOW - DAY) }),
  activity({ activityId: "indoor", sportType: 101, startTime: at(NOW - 2 * DAY) }),
  activity({ activityId: "trail", sportType: 102, startTime: at(NOW - 3 * DAY) }),
  activity({ activityId: "bike", sportType: 200, startTime: at(NOW - 4 * DAY) }),
  activity({ activityId: "gym", sportType: 402, startTime: at(NOW - 5 * DAY) }),
  activity({ activityId: "hybrid", sportType: 1200, startTime: at(NOW - 6 * DAY) })
];

assert.deepEqual(
  filterActivities({
    activities: mixed,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, sports: ["run"] },
    nowMs: NOW
  }).map((row) => row.activityId),
  ["road", "indoor"],
  "Run and Indoor Run are one category; Trail Run is its own"
);

assert.equal(
  filterActivities({
    activities: mixed,
    filters: DEFAULT_ACTIVITY_FILTERS,
    nowMs: NOW
  }).length,
  mixed.length,
  "no sports selected means every sport, not none"
);

assert.deepEqual(sportsPresent(mixed), ["run", "trail", "bike", "strength", "other"]);
assert.deepEqual(
  sportsPresent([activity({ sportType: 402 })]),
  ["strength"],
  "a chip is only offered for a sport the athlete has actually done"
);

// ---------------------------------------------------------------------------
// 4. Search matches every term, in any order, across name and sport
// ---------------------------------------------------------------------------

const named = [
  activity({ activityId: "long", name: "Long slow run", startTime: at(NOW - DAY) }),
  activity({ activityId: "easy", name: "Easy 9 km", startTime: at(NOW - 2 * DAY) }),
  activity({ activityId: "gym", name: "", sportType: 402, startTime: at(NOW - 3 * DAY) })
];
const sportName = (row) => (row.sportType === 402 ? "Strength" : "Run");

assert.deepEqual(
  filterActivities({
    activities: named,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, query: "run long" },
    nowMs: NOW,
    sportName
  }).map((row) => row.activityId),
  ["long"],
  "terms match in any order"
);

assert.deepEqual(
  filterActivities({
    activities: named,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, query: "strength" },
    nowMs: NOW,
    sportName
  }).map((row) => row.activityId),
  ["gym"],
  "an unnamed session is still findable by its sport"
);

assert.equal(
  filterActivities({
    activities: named,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, query: "   " },
    nowMs: NOW,
    sportName
  }).length,
  named.length,
  "whitespace is not a search"
);

// ---------------------------------------------------------------------------
// 5. Newest first, whatever order COROS sent
// ---------------------------------------------------------------------------

assert.deepEqual(
  filterActivities({
    activities: [
      activity({ activityId: "mid", startTime: at(NOW - 2 * DAY) }),
      activity({ activityId: "new", startTime: at(NOW - DAY) }),
      activity({ activityId: "old", startTime: at(NOW - 3 * DAY) })
    ],
    filters: DEFAULT_ACTIVITY_FILTERS,
    nowMs: NOW
  }).map((row) => row.activityId),
  ["new", "mid", "old"]
);

// ---------------------------------------------------------------------------
// 6. Totals
// ---------------------------------------------------------------------------

const empty = summariseActivities([]);
assert.equal(empty.count, 0);
assert.equal(empty.weeks, 0, "no activities span no weeks — nothing divides by zero");
assert.deepEqual(empty.sports, []);

const week = summariseActivities([
  activity({
    activityId: "r1",
    sportType: 100,
    startTime: at(MONDAY + DAY),
    duration: 3600,
    distance: 12_000,
    elevationGain: 40,
    trainingLoad: 280
  }),
  activity({
    activityId: "r2",
    sportType: 100,
    startTime: at(MONDAY + DAY),
    duration: 1800,
    distance: 6000,
    trainingLoad: 120
  }),
  activity({
    activityId: "s1",
    sportType: 402,
    startTime: at(MONDAY + 2 * DAY),
    duration: 4500,
    trainingLoad: 60
  })
]);

assert.equal(week.count, 3);
assert.equal(week.duration, 3600 + 1800 + 4500);
assert.equal(week.distance, 18_000);
assert.equal(week.elevationGain, 40);
assert.equal(week.trainingLoad, 460);
assert.equal(week.activeDays, 2, "two sessions on one day are one active day");
assert.equal(week.weeks, 1);
assert.deepEqual(
  week.sports.map((sport) => [sport.category, sport.count, sport.duration]),
  [
    ["run", 2, 5400],
    ["strength", 1, 4500]
  ],
  "busiest sport first, by time rather than by count"
);

// `weeks` spans the activities, not the filter: three weeks of history read
// under the "1 year" period must not divide every per-week figure by 52.
const sparse = summariseActivities([
  activity({ activityId: "a", startTime: at(MONDAY) }),
  activity({ activityId: "b", startTime: at(MONDAY - 14 * DAY) })
]);
assert.equal(sparse.weeks, 3);

// ---------------------------------------------------------------------------
// 7. The period options themselves
// ---------------------------------------------------------------------------

assert.deepEqual(
  ACTIVITY_PERIOD_OPTIONS.map((option) => option.days),
  [28, 90, 365, null],
  "shortest first, the whole history last"
);
assert.equal(
  ACTIVITY_PERIOD_OPTIONS.filter((option) => option.days === null).length,
  1,
  "exactly one option means the whole history"
);

// ---------------------------------------------------------------------------
// 8. Weeks
// ---------------------------------------------------------------------------

const across = filterActivities({
  activities: [
    activity({ activityId: "thisWeek", startTime: at(MONDAY + DAY), duration: 1800 }),
    activity({ activityId: "lastWeekA", startTime: at(MONDAY - 2 * DAY), duration: 3600 }),
    activity({
      activityId: "lastWeekB",
      sportType: 402,
      startTime: at(MONDAY - 3 * DAY),
      duration: 3600
    }),
    activity({ activityId: "older", startTime: at(MONDAY - 20 * DAY), duration: 600 }),
    activity({ activityId: "undated" })
  ],
  filters: { ...DEFAULT_ACTIVITY_FILTERS, periodDays: null },
  nowMs: NOW
});

const weeks = groupActivitiesByWeek(across);

assert.deepEqual(
  weeks.map((group) => group.activities.map((row) => row.activityId)),
  [["thisWeek"], ["lastWeekA", "lastWeekB"], ["older"], ["undated"]],
  "newest week first, undated last"
);
assert.equal(weeks[1].count, 2);
assert.equal(weeks[1].duration, 7200);
assert.deepEqual(
  weeks[1].sports.map((sport) => sport.category).sort(),
  ["run", "strength"],
  "a week carries its own mix"
);
assert.equal(
  weeks[3].weekStartMs,
  undefined,
  "activities with no start time get a group of their own, not week zero"
);

assert.equal(activityWeekHeading(MONDAY, NOW), "This week");
assert.equal(activityWeekHeading(MONDAY - 7 * DAY, NOW), "Last week");
assert.equal(activityWeekHeading(undefined, NOW), "Undated");
assert.match(
  activityWeekHeading(MONDAY - 21 * DAY, NOW),
  /^Week of /,
  "anything older is dated rather than counted backwards"
);

// An unsorted input would cut a group per activity rather than per week, which
// is why grouping states that it expects `filterActivities` to have sorted.
assert.equal(
  groupActivitiesByWeek([
    activity({ activityId: "a", startTime: at(MONDAY + DAY) }),
    activity({ activityId: "b", startTime: at(MONDAY - 2 * DAY) }),
    activity({ activityId: "c", startTime: at(MONDAY + 2 * DAY) })
  ]).length,
  3
);

// ---------------------------------------------------------------------------
// 9. Row facts are chosen per sport
// ---------------------------------------------------------------------------

const factValues = (row) => activityRowFacts(row, "metric").map((fact) => fact.value);

assert.deepEqual(
  factValues(
    activity({
      sportType: 100,
      duration: 3600,
      distance: 10_000,
      avgHr: 148,
      trainingLoad: 210
    })
  ),
  ["1h", "10.0 km", "6:00 /km", "148 bpm", "210 TL"],
  "a run is read by pace"
);

assert.deepEqual(
  factValues(
    activity({
      sportType: 200,
      duration: 3600,
      distance: 30_000,
      avgHr: 132,
      trainingLoad: 150
    })
  ),
  ["1h", "30.0 km", "30.0 km/h", "132 bpm", "150 TL"],
  "a ride is read by speed, not by pace"
);

// The case the old table answered with a column of "0 km".
assert.deepEqual(
  factValues(
    activity({ sportType: 402, duration: 4500, avgHr: 118, trainingLoad: 40 })
  ),
  ["1h 15m", "118 bpm", "40 TL"],
  "a strength session carries no distance and no pace"
);

assert.deepEqual(
  factValues(activity({ sportType: 100, duration: 1800, distance: 5000 })),
  ["30m", "5.00 km", "6:00 /km"],
  "a figure COROS did not send is left out, not shown as a dash"
);

const factKeys = (row) => activityRowFacts(row, "metric").map((fact) => fact.key);

// Every flat road run carries a few metres of GPS noise; a "4 m" on every row
// is four characters of nothing.
assert.deepEqual(
  factKeys(activity({ sportType: 100, duration: 1800, elevationGain: 4 })),
  ["duration"],
  "a handful of metres of climb is not a fact"
);
assert.deepEqual(
  factKeys(activity({ sportType: 100, duration: 1800, elevationGain: 420 })),
  ["duration", "climb"],
  "a real climb is"
);

assert.deepEqual(
  activityRowFacts(
    activity({
      sportType: 100,
      duration: 3600,
      distance: 10_000,
      avgHr: 148,
      elevationGain: 600,
      trainingLoad: 210
    }),
    "metric"
  ).map((fact) => fact.key),
  ["duration", "distance", "pace", "avgHr", "climb"],
  "five figures at most — a sixth is what wraps the line, and load is the " +
    "one dropped because COROS scores it on every row"
);

// ---------------------------------------------------------------------------
// 10. The unrated filter keeps "not rated" apart from "not looked at yet"
// ---------------------------------------------------------------------------

const rateable = [
  activity({ activityId: "rated", startTime: at(NOW - DAY) }),
  activity({ activityId: "unrated", startTime: at(NOW - 2 * DAY) }),
  activity({ activityId: "unchecked", startTime: at(NOW - 3 * DAY) })
];
const isRated = (row) =>
  row.activityId === "rated"
    ? true
    : row.activityId === "unrated"
      ? false
      : undefined;

assert.deepEqual(
  filterActivities({
    activities: rateable,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, unratedOnly: true },
    nowMs: NOW,
    isRated
  }).map((row) => row.activityId),
  ["unrated"],
  "a session the backfill has not reached is unknown, not unrated"
);

assert.deepEqual(
  filterActivities({
    activities: rateable,
    filters: DEFAULT_ACTIVITY_FILTERS,
    nowMs: NOW,
    isRated
  }).map((row) => row.activityId),
  ["rated", "unrated", "unchecked"],
  "the filter off means every session"
);

// Without the ratings read, the filter matches nothing rather than everything:
// a filter that silently turns into "show all" while its data loads is worse
// than one that visibly waits.
assert.equal(
  filterActivities({
    activities: rateable,
    filters: { ...DEFAULT_ACTIVITY_FILTERS, unratedOnly: true },
    nowMs: NOW
  }).length,
  0
);

// ---------------------------------------------------------------------------
// 11. Drift comes off the stored summary, when there is one
// ---------------------------------------------------------------------------

const longRun = activity({
  sportType: 100,
  duration: 5400,
  distance: 15_000,
  trainingLoad: 300
});

assert.ok(
  !factKeys(longRun).includes("drift"),
  "no summary, no drift — the list is not held back for one"
);

assert.deepEqual(
  activityRowFacts(longRun, "metric", {
    activityId: "a1",
    fingerprint: "f",
    summaryVersion: 1,
    decouplingPercent: 4.2,
    computedAt: 0
  }).map((fact) => fact.key),
  ["duration", "distance", "pace", "drift", "load"],
  "drift comes before climb and load"
);

// The row a real run produces: the four figures off the list payload plus the
// one off the stored summary. This is what the cap is sized for.
assert.deepEqual(
  activityRowFacts(
    activity({
      sportType: 100,
      duration: 5149,
      distance: 12_200,
      avgHr: 162,
      trainingLoad: 280
    }),
    "metric",
    {
      activityId: "a1",
      fingerprint: "f",
      summaryVersion: 1,
      decouplingPercent: 4.2,
      computedAt: 0
    }
  ).map((fact) => fact.key),
  ["duration", "distance", "pace", "avgHr", "drift"]
);

console.log("activity filter tests passed");
