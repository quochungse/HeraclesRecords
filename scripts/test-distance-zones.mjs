// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types; the module graph has extensionless imports, so the
// resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "distanceZones.ts")
);
const {
  DISTANCE_ZONE_BUCKETS,
  distanceZoneIndex,
  buildDistanceZoneTotals
} = await import(`${modUrl.href}?cacheBust=${Date.now()}`);

const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

// COROS sends epoch *seconds* on the activity list endpoint.
const secondsAgo = (days) => Math.floor((NOW - days * DAY_MS) / 1000);

const run = (distanceMeters, overrides = {}) => ({
  activityId: `a${distanceMeters}-${overrides.sportType ?? 100}`,
  sportType: 100,
  startTime: secondsAgo(3),
  duration: 3600,
  trainingLoad: 100,
  distance: distanceMeters,
  ...overrides
});

// ---------------------------------------------------------------------------
// The buckets mirror the 5 km steps COROS itself uses, so a session lands in
// the same slice here and in the COROS app.
// ---------------------------------------------------------------------------

assert.deepEqual(
  DISTANCE_ZONE_BUCKETS.map((bucket) => bucket.minMeters),
  [0, 5_000, 10_000, 15_000, 20_000, 25_000],
  "COROS buckets distance in 5 km steps (probed 2026-09-09)"
);

// ---------------------------------------------------------------------------
// Bucket boundaries are half-open: lower inclusive, upper exclusive.
// ---------------------------------------------------------------------------

assert.equal(distanceZoneIndex(1), 0, "1 m is in the first bucket");
assert.equal(distanceZoneIndex(4_999.9), 0, "just under 5 km stays in 0–5");
assert.equal(
  distanceZoneIndex(5_000),
  1,
  "exactly 5 km leaves 0–5 — the upper bound is excluded"
);
assert.equal(
  distanceZoneIndex(10_000),
  2,
  "exactly 10 km is 10–15, not 5–10"
);
assert.equal(distanceZoneIndex(10_100), 2, "10.1 km is a 10–15 km session");
assert.equal(distanceZoneIndex(20_000), 4, "exactly 20 km is 20–25, not 15–20");
assert.equal(distanceZoneIndex(24_999), 4);
assert.equal(distanceZoneIndex(25_000), 5, "the top bucket is open-ended");
assert.equal(distanceZoneIndex(180_000), 5);

// A session that recorded no distance is not a 0 km session: no bucket claims
// it, which is what keeps strength work out of the first slice.
assert.equal(distanceZoneIndex(0), -1);
assert.equal(distanceZoneIndex(undefined), -1);
assert.equal(distanceZoneIndex(Number.NaN), -1);
assert.equal(distanceZoneIndex(-5), -1);

// The table itself must stay half-open and contiguous, or the assertions above
// only describe the buckets that happen to be listed today.
DISTANCE_ZONE_BUCKETS.forEach((bucket, index) => {
  const previous = DISTANCE_ZONE_BUCKETS[index - 1];
  if (previous) {
    assert.equal(
      bucket.minMeters,
      previous.maxMeters,
      `bucket ${index} must start where bucket ${index - 1} ends`
    );
  }
  if (bucket.maxMeters !== undefined) {
    assert.ok(bucket.maxMeters > bucket.minMeters);
  }
});
assert.equal(
  DISTANCE_ZONE_BUCKETS.at(-1).maxMeters,
  undefined,
  "the last bucket must be open-ended or long runs fall out of the chart"
);

// ---------------------------------------------------------------------------
// The regression this file exists for: the real four weeks that reported runs
// above 20 km to an athlete whose longest was 16.34 km. COROS answered
// [8, 1, 8, 3, 0, 0] on 5 km buckets it never states, and the panel drew
// index 2 as "20–30 km" and index 3 as "30–40 km". The eight and the three
// belong in 10–15 km and 15–20 km — and the first bucket is 1, not 8, because
// the seven distance-less strength sessions COROS counted do not belong here.
// ---------------------------------------------------------------------------

const realFourWeeks = [
  run(1_620),
  run(6_190),
  run(10_020),
  run(10_020),
  run(10_040),
  run(10_200),
  run(10_210),
  run(10_320),
  run(10_410),
  run(10_530),
  run(15_070),
  run(16_030),
  run(16_340),
  // Seven strength sessions, no distance — COROS counted these in its first
  // bucket, which is why "0–10 km" read 8 instead of 2.
  ...Array.from({ length: 7 }, (_, index) =>
    run(0, { sportType: 402, activityId: `s${index}`, distance: undefined })
  )
];

const totals = buildDistanceZoneTotals(realFourWeeks, { now: NOW });
assert.deepEqual(
  totals.map((bucket) => bucket.count),
  [1, 1, 8, 3, 0, 0],
  "nothing above 20 km when nothing was run above 20 km"
);
assert.equal(
  totals.reduce((sum, bucket) => sum + bucket.count, 0),
  13,
  "only the sessions with a distance are counted"
);

// ---------------------------------------------------------------------------
// Scope: every sport that records a distance — the absence of a distance is
// the only thing that excludes a session, never its sport code.
// ---------------------------------------------------------------------------

const scoped = buildDistanceZoneTotals(
  [
    run(22_000, { sportType: 200, activityId: "ride" }), // a 22 km bike ride
    run(2_000, { sportType: 300, activityId: "swim" }), // a 2 km pool swim
    run(6_000, { sportType: 900, activityId: "walk" }), // a 6 km walk
    run(12_000, { sportType: 104, activityId: "hike" }), // a 12 km hike
    run(12_000, { sportType: undefined, activityId: "no-sport-code" }),
    run(3_000, { sportType: 101, activityId: "treadmill" }),
    // Distance-less sports stay out however they arrive.
    run(undefined, { sportType: 402, activityId: "strength" }),
    run(0, { sportType: 402, activityId: "strength-zero" }),
    run(undefined, { sportType: 800, activityId: "indoor-climb" })
  ],
  { now: NOW }
);
assert.deepEqual(
  scoped.map((bucket) => bucket.count),
  [2, 1, 2, 0, 1, 0],
  "cycling, swimming, walking and hiking all count; strength and climbing do not"
);

const windowed = buildDistanceZoneTotals(
  [
    run(3_000, { startTime: secondsAgo(0) }),
    run(3_000, { startTime: secondsAgo(27.9) }),
    run(30_000, { startTime: secondsAgo(28.1), activityId: "old" }),
    run(30_000, { startTime: secondsAgo(400), activityId: "ancient" })
  ],
  { now: NOW }
);
assert.deepEqual(
  windowed.map((bucket) => bucket.count),
  [2, 0, 0, 0, 0, 0],
  "only the last four weeks count"
);

// A run whose timestamp is unusable still counts — dropping it would shrink
// the sample, and a missing timestamp says nothing about when it happened.
const undated = buildDistanceZoneTotals(
  [run(3_000, { startTime: undefined, activityId: "undated" })],
  { now: NOW }
);
assert.equal(undated[0].count, 1);

// Millisecond timestamps are accepted too — some COROS payloads use them.
const millis = buildDistanceZoneTotals(
  [run(3_000, { startTime: NOW - 2 * DAY_MS, activityId: "ms" })],
  { now: NOW }
);
assert.equal(millis[0].count, 1, "ms timestamps must not read as 1970");

// ---------------------------------------------------------------------------
// The other two metrics tally the same buckets.
// ---------------------------------------------------------------------------

const metrics = buildDistanceZoneTotals(
  [
    run(3_000, { trainingLoad: 40, duration: 1_800 }),
    run(12_000, { trainingLoad: 90, duration: 3_600, activityId: "b" }),
    run(13_000, { trainingLoad: 110, duration: 4_200, activityId: "c" }),
    // Missing metrics must not poison the sums with NaN.
    run(14_000, {
      trainingLoad: undefined,
      duration: undefined,
      activityId: "d"
    })
  ],
  { now: NOW }
);
assert.deepEqual(
  metrics.map((bucket) => bucket.trainingLoad),
  [40, 0, 200, 0, 0, 0]
);
assert.deepEqual(
  metrics.map((bucket) => bucket.duration),
  [1_800, 0, 7_800, 0, 0, 0]
);
assert.deepEqual(
  metrics.map((bucket) => bucket.count),
  [1, 0, 3, 0, 0, 0]
);

// An empty history yields zeroed buckets, not an empty list — the panel needs
// every bucket to render a row.
const empty = buildDistanceZoneTotals([], { now: NOW });
assert.equal(empty.length, DISTANCE_ZONE_BUCKETS.length);
assert.ok(empty.every((bucket) => bucket.count === 0));

// The bucket table is shared, so a tally must not mutate it.
assert.ok(
  DISTANCE_ZONE_BUCKETS.every((bucket) => !("count" in bucket)),
  "buildDistanceZoneTotals must copy the bucket table, not decorate it"
);

// ---------------------------------------------------------------------------
// The regression guard. Nothing may render COROS's own distance area lists
// again: they arrive with no boundaries, on 5 km steps, counting every sport,
// and the only way to draw them is to guess labels for them.
// ---------------------------------------------------------------------------

const { readFile, readdir } = await import("node:fs/promises");

async function* sourceFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

const FORBIDDEN = [
  "distanceCountAreaList",
  "distanceTlAreaList",
  "distanceTimeAreaList",
  "zoneDistributions.distance"
];
const offenders = [];

for (const dir of ["src", "electron"]) {
  for await (const file of sourceFiles(path.join(repoRoot, dir))) {
    const text = await readFile(file, "utf8");
    // The service documents the 5 km boundaries in a comment on purpose;
    // only executable references are the problem.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const needle of FORBIDDEN) {
      if (code.includes(needle)) {
        offenders.push(`${path.relative(repoRoot, file)} → ${needle}`);
      }
    }
  }
}

assert.deepEqual(
  offenders,
  [],
  `COROS distance area lists are back in the code:\n  ${offenders.join("\n  ")}`
);

console.log("distance zone distribution tests passed");
