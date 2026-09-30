// The Hiking screen's arithmetic, what the hike page reads out of the
// samples — moving time and rests, the terrain split, the ascents and
// descents, Naismith's book time — and the hike reading of the shared channel
// chart, the route map and the Activities row.
//
// Runs under Electron for the reason test-ride-metrics does: this repo's Node
// is built without Amaro and cannot strip types, and the module graph has
// extensionless imports, so the resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const moduleUrl = (...parts) =>
  `${pathToFileURL(path.join(repoRoot, "src", ...parts)).href}${bust}`;

const { HIKE_TYPES, classifyHikeType, hikesOfType, hikesOnly, isHikeSportType } = await import(
  moduleUrl("hiking", "hikeType.ts")
);
const {
  CLIMBING_RATE_MIN_GAIN_M,
  biggestHike,
  buildHikeWeeks,
  climbingRate,
  hikeAscentRate,
  hikeSpeedKmh,
  hikeTypeBreakdown,
  hikeTypesPresent,
  hikeWindowStartMs,
  summariseHikes,
  totalsAscentRate,
  totalsSpeedKmh
} = await import(moduleUrl("hiking", "hikeMetrics.ts"));
const {
  LEG_MIN_HEIGHT,
  REST_MIN_SECONDS,
  altitudeRange,
  hikeLegs,
  hikeMovement,
  hikeRests,
  hikeTerrain,
  naismithSeconds
} = await import(moduleUrl("hiking", "hikeAnalysis.ts"));
const { isRunSportType } = await import(moduleUrl("running", "runSurface.ts"));
const { runWindowStartMs } = await import(moduleUrl("running", "runMetrics.ts"));
const { isSpeedSport } = await import(moduleUrl("training", "sportTypes.ts"));
const { activityRowFacts } = await import(moduleUrl("training", "activityFacts.ts"));
const { availableActivityChannels, defaultSelectedChannels, withSpeed, withVerticalSpeed } =
  await import(moduleUrl("training", "activityChannels.ts"));

// 14 Sep 2026 is a Monday; fixtures are local time because weeks are.
const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const MS_PER_DAY = 86_400_000;
const secondsAgo = (days) => Math.floor((NOW - days * MS_PER_DAY) / 1000);
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);

// --- What a hike is ----------------------------------------------------------

assert.deepEqual(HIKE_TYPES, ["hike", "mountain"]);
assert.equal(classifyHikeType(104), "hike");
assert.equal(classifyHikeType(105), "mountain");
for (const code of [100, 102, 106, 200, 802, 900, undefined]) {
  assert.equal(isHikeSportType(code), false, `${code} is not a hike`);
}
for (const code of [104, 105]) {
  assert.equal(isRunSportType(code), false, `${code} stays off Running`);
  assert.equal(isHikeSportType(code), true, `${code} has Hiking instead`);
}
assert.equal(isHikeSportType(102), false, "a trail run is a run");

const hike = (days, overrides = {}) => ({
  activityId: `hike-${days}`,
  sportType: 104,
  startTime: secondsAgo(days),
  duration: 4 * 3600,
  distance: 12_000,
  elevationGain: 800,
  trainingLoad: 300,
  avgHr: 125,
  ...overrides
});
const RUN = { activityId: "run", sportType: 100, startTime: secondsAgo(1), duration: 3000, distance: 10_000 };
const list = [
  RUN,
  hike(1),
  hike(6, { sportType: 105, duration: 6 * 3600, distance: 9000, elevationGain: 1300, activityId: "climb" }),
  hike(9, { elevationGain: 150, activityId: "flat" }),
  hike(40)
];

assert.equal(hikesOnly(list).length, 4, "the run is left out");
assert.equal(hikesOfType(list, "mountain").length, 1);
assert.deepEqual(hikeTypesPresent(list), ["hike", "mountain"]);

// --- Figures of one hike -------------------------------------------------------

assert.equal(hikeSpeedKmh({ distance: 12_000, duration: 4 * 3600 }), 3);
assert.equal(hikeAscentRate({ elevationGain: 800, duration: 4 * 3600 }), 200);
assert.equal(hikeAscentRate({ elevationGain: 0, duration: 3600 }), undefined, "no climb is no rate, not 0");
assert.equal(hikeSpeedKmh({ distance: 0, duration: 3600 }), undefined);

const totals = summariseHikes(list);
assert.equal(totals.count, 4);
assert.equal(totals.elevationGain, 800 + 1300 + 150 + 800);
assert.equal(totalsSpeedKmh(totals), (45_000 / 1000) / ((4 + 6 + 4 + 4)));
assert.equal(totalsAscentRate(totals), 3050 / 18);

// --- The weeks ---------------------------------------------------------------------

assert.equal(hikeWindowStartMs(4, NOW), runWindowStartMs(4, NOW), "one definition of 'the last N weeks'");
const weeks = buildHikeWeeks(list, { weeks: 2, nowMs: NOW });
assert.equal(weeks.length, 2);
// The 14th is a Monday: day 1 is last week's Sunday, day 6 its Tuesday, day 9 the week before.
assert.equal(weeks[1].count, 0, "this week has nothing yet");
assert.equal(weeks[0].count, 2);
assert.equal(weeks[0].byType.mountain.elevationGain, 1300);
assert.equal(weeks[0].biggestAscentMeters, 1300);
assert.equal(weeks[0].longestHikeSeconds, 6 * 3600);

const breakdown = hikeTypeBreakdown(list);
assert.deepEqual(breakdown.map((entry) => entry.type), ["hike", "mountain"]);
near(breakdown[1].share, 6 / 18, 1e-9, "a kind's share is of time on the trail");
near(breakdown[1].elevationPerKm, 1300 / 9, 1e-9, "ascent per km");

// --- The hero's twelve weeks -----------------------------------------------------

assert.equal(biggestHike(list, { days: 84, nowMs: NOW })?.activityId, "climb", "the longest day");
assert.equal(biggestHike(list, { days: 3, nowMs: NOW })?.activityId, "hike-1");
assert.equal(biggestHike([RUN], { days: 84, nowMs: NOW }), undefined);

const rate = climbingRate(list, { days: 84, nowMs: NOW });
// The flat one is under the floor; the other three: 200, 216.7, 200 m/h.
assert.equal(rate.count, 3, `hikes under ${CLIMBING_RATE_MIN_GAIN_M} m say nothing about climbing`);
assert.equal(rate.rate, 200, "the median");
assert.equal(rate.previousRate, undefined, "nothing in the window before");
const later = climbingRate([...list, hike(100, { elevationGain: 600 })], { days: 84, nowMs: NOW });
assert.equal(later.previousRate, 150, "the window before, for the trend");

// --- The samples: moving time and the rests ---------------------------------------

/**
 * A hike a second at a time: 1.2 km flat, a 2 km climb at 15%, a 10-minute
 * rest on top with the watch recording (GPS drifting a couple of metres), a
 * 40-second breather that is too short to list, then 2 km down at 15%, and a
 * 20-minute pause (auto-pause) half-way down.
 */
function hikeSeries() {
  const points = [];
  let t = 0;
  let d = 0;
  let alt = 100;
  const walk = (meters, grade, speed) => {
    const seconds = Math.round(meters / speed);
    for (let s = 0; s < seconds; s += 1) {
      points.push({ elapsed: t, distance: d, altitude: alt, hr: grade > 0 ? 150 : 115, pace: 1000 / speed, cadence: 100 });
      t += 1;
      d += speed;
      alt += speed * grade;
    }
  };
  const stand = (seconds) => {
    for (let s = 0; s < seconds; s += 1) {
      points.push({ elapsed: t, distance: d + (s % 7) * 0.2, altitude: alt, hr: 90, cadence: 0 });
      t += 1;
    }
  };
  walk(1200, 0, 1.4);
  walk(2000, 0.15, 0.6);
  stand(600);
  walk(200, 0, 1.3);
  stand(40);
  walk(1000, -0.15, 0.9);
  const pauseAt = t;
  t += 1200; // paused: no samples
  walk(1000, -0.15, 0.9);
  return { points, pauses: [{ start: pauseAt, duration: 1200 }] };
}

const { points, pauses } = hikeSeries();
const movement = hikeMovement(points, pauses);
const walked = Math.round(1200 / 1.4) + Math.round(2000 / 0.6) + Math.round(200 / 1.3) + 2 * Math.round(1000 / 0.9);
near(movement.movingSeconds, walked, 15, "moving time is the walking");
near(movement.recordedSeconds, points.length, 2, "a pause is not recorded time");
assert.ok(movement.movingSeconds <= movement.recordedSeconds, "moving never exceeds what was recorded");

// Smart recording: a sample every five seconds on the move, and a real
// COROS watch's pause the same. The moving time must not shrink to one second
// a sample, nor the pause be read as walking.
const sparse5 = points.filter((point, index) => index % 5 === 0 || point.pace === undefined);
const sparseMovement = hikeMovement(sparse5, pauses);
near(sparseMovement.movingSeconds, walked, 40, "sparse samples still add up to the walking");
assert.ok(sparseMovement.stops.some((stop) => stop.paused && stop.seconds === 1200), "and the pause is still a pause");

const rests = hikeRests(movement);
assert.equal(rests.length, 2, `the summit and the pause, not the breather: ${JSON.stringify(rests)}`);
assert.equal(rests[0].paused, false);
near(rests[0].seconds, 600, 25, "the summit rest");
near(rests[0].altitude, 400, 2, "taken on top");
assert.equal(rests[1].paused, true);
assert.equal(rests[1].seconds, 1200);
assert.ok(movement.stops.some((stop) => !stop.paused && stop.seconds < REST_MIN_SECONDS), "the breather is a stop");

// --- The terrain, on the moving clock ------------------------------------------------

const terrain = hikeTerrain(points, movement);
const by = Object.fromEntries(terrain.map((share) => [share.kind, share]));
near(by.up.height, 300, 15, "300 m gained");
near(by.down.height, 300, 15, "and lost");
near(by.up.verticalRate, 0.6 * 0.15 * 3600, 40, "climbing rate on the moving clock — the summit rest is not in it");
near(by.down.verticalRate, 0.9 * 0.15 * 3600, 60, "descending rate — the pause is not in it");
near(by.flat.speed, 1.35 * 3.6, 0.6, "the flat at a walk");

// --- The legs ---------------------------------------------------------------------------

const legs = hikeLegs(points, movement);
assert.deepEqual(legs.map((leg) => leg.direction), ["up", "down"], "one climb, one descent");
near(legs[0].height, 300, 20, "the climb's height");
near(legs[0].grade, 0.15, 0.02, "and grade");
near(legs[0].verticalRate, 324, 40, "and rate");
assert.ok(legs.every((leg) => leg.height >= LEG_MIN_HEIGHT));
assert.deepEqual(hikeLegs(points.map((point) => ({ ...point, altitude: 100 + (point.distance % 40) / 2 })), movement), [], "rolling ground is no leg");

// --- The book -----------------------------------------------------------------------------

assert.equal(naismithSeconds(10_000, 600), 3 * 3600, "an hour per 5 km and an hour per 600 m");
assert.deepEqual(altitudeRange(points), { highest: points.reduce((max, p) => Math.max(max, p.altitude), 0), lowest: 100 });

// --- The chart reads a hike in km/h and metres an hour ----------------------------------

const withRates = withVerticalSpeed(withSpeed(points));
const climbing = withRates.find((point) => point.elapsed === 2000);
near(climbing.verticalSpeed, 324, 20, "a minute either side of a climbing sample");
const resting = withRates.find((point) => point.elapsed === Math.round(1200 / 1.4) + Math.round(2000 / 0.6) + 300);
near(resting.verticalSpeed, 0, 1, "standing is not climbing");
const channels = availableActivityChannels(withRates, "hike").map((channel) => channel.key);
assert.ok(channels.includes("speed") && channels.includes("verticalSpeed"), `speed and climbing rate: ${channels}`);
assert.ok(!channels.includes("pace") && !channels.includes("adjustedPace"), `never a pace: ${channels}`);
assert.ok(!availableActivityChannels(withRates, "pace").some((channel) => channel.key === "verticalSpeed"), "a run is not offered the climbing rate");
assert.ok(!availableActivityChannels(withRates, "speed").some((channel) => channel.key === "verticalSpeed"), "nor a ride");
assert.deepEqual(defaultSelectedChannels(availableActivityChannels(withRates, "hike"), "hike"), ["verticalSpeed", "hr"]);
// Downsampled rows fifty seconds apart are still read against their neighbours.
const sparse = withVerticalSpeed(points.filter((_, index) => index % 50 === 0));
assert.ok(sparse.filter((point) => point.verticalSpeed !== undefined).length > sparse.length * 0.9, "rows a minute apart get a rate");

// --- Read in km/h elsewhere too ------------------------------------------------------------

assert.equal(isSpeedSport(104), true, "the route map reads a hike's pace as speed, off the running pace zones");
assert.equal(isSpeedSport(105), true);
assert.equal(isSpeedSport(102), false, "a trail run keeps its pace");
const facts = activityRowFacts(hike(1), "metric").map((fact) => fact.key);
assert.ok(facts.includes("speed") && !facts.includes("pace"), `an Activities row reads a hike's speed: ${facts}`);

console.log("hike metrics: OK");
