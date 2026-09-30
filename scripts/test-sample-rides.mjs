// The sample rides behind HERACLES_SAMPLE_RIDES=1 (electron/sampleRides.ts).
//
// They exist to be screenshotted, so what is held here is what a screenshot
// would give away: a list row that disagrees with its own page, a ride that
// changes between two launches, figures no rider produces — and, because they
// are fiction, that they only ever reach the window, never the store or Coach.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = () =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sampleRides.js")).href}?cacheBust=${Date.now()}-${Math.random()}`
  );

const samples = await load();

// --- Behind the flag, and behind the window's door only --------------------

assert.equal(samples.sampleRidesEnabled({}), false);
assert.equal(samples.sampleRidesEnabled({ HERACLES_SAMPLE_RIDES: "0" }), false);
assert.equal(samples.sampleRidesEnabled({ HERACLES_SAMPLE_RIDES: "1" }), true);

const importers = fs
  .readdirSync(path.join(repoRoot, "electron"))
  .filter((name) => name.endsWith(".ts") && name !== "sampleRides.ts")
  .filter((name) =>
    /from "\.\/sampleRides"/.test(fs.readFileSync(path.join(repoRoot, "electron", name), "utf8"))
  );
assert.deepEqual(
  importers,
  ["main.ts"],
  "only the IPC handlers reach the sample rides — not the mirror, the sweeps or Coach"
);
const main = fs.readFileSync(path.join(repoRoot, "electron", "main.ts"), "utf8");
for (const channel of [
  "trainingHub:listActivities",
  "trainingHub:getActivityDetail",
  "trainingHub:getActivityDetailRaw",
  "trainingHub:getActivityDetailSummaries"
]) {
  const handler = main.slice(main.indexOf(`"${channel}"`), main.indexOf(`"${channel}"`) + 500);
  assert.match(handler, /sampleRidesEnabled\(\)/, `${channel} asks the flag`);
}

// --- The list ---------------------------------------------------------------

const real = [{ activityId: "real-1", sportType: 100, startTime: Math.floor(Date.now() / 1000) - 3600 }];
const page1 = samples.withSampleRides(real, { page: 1 });
const rides = page1.filter((activity) => samples.isSampleRideId(activity.activityId));
assert.ok(rides.length >= 20, `a few months of riding, not a handful: ${rides.length}`);
assert.ok(page1.some((activity) => activity.activityId === "real-1"), "the real list is kept");
for (let index = 1; index < page1.length; index += 1) {
  assert.ok(page1[index - 1].startTime >= page1[index].startTime, "newest first, as COROS sends it");
}
assert.deepEqual(samples.withSampleRides(real, { page: 2 }), real, "a later page does not meet them again");

const day = (daysAgo) => {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
};
const windowed = samples
  .withSampleRides([], { page: 1, startDay: day(10), endDay: day(0) })
  .map((activity) => activity.activityId);
assert.ok(windowed.length > 0 && windowed.length < rides.length, "a dated window gets the rides inside it");

// --- The same rides on every launch -----------------------------------------

const again = (await load()).withSampleRides([], { page: 1 });
const figures = (list) =>
  list.map(({ activityId, distance, duration, avgHr, trainingLoad, elevationGain }) => ({
    activityId, distance, duration, avgHr, trainingLoad, elevationGain
  }));
assert.deepEqual(figures(again), figures(rides), "seeded: a screenshot can be taken twice");

// --- Every row agrees with its own page, and reads like a ride ---------------

const known = new Set();
for (const row of rides) {
  const detail = samples.sampleRideDetail(row.activityId);
  const series = detail.series;
  const last = series[series.length - 1];
  const label = row.name;

  assert.equal(row.distance, Math.round(last.distance), `${label}: distance`);
  assert.equal(row.duration, series.length, `${label}: activity time is the moving samples`);
  const paused = detail.pauses.reduce((sum, pause) => sum + pause.duration, 0);
  assert.equal(row.elapsedDuration - row.duration, paused, `${label}: the gap is the pauses`);
  assert.equal(
    detail.laps.reduce((sum, lap) => sum + lap.duration, 0),
    row.duration,
    `${label}: laps add up to the ride`
  );
  assert.equal(detail.elevationGain, row.elevationGain, `${label}: climb`);
  assert.ok(detail.track.points.length <= 401 && detail.track.route.length > 100, `${label}: a track`);
  assert.ok(
    detail.track.route.every((point) => typeof point.elapsed === "number"),
    `${label}: the route map's copy carries its clock`
  );

  const kmh = row.distance / 1000 / (row.duration / 3600);
  assert.ok(kmh > 15 && kmh < 34, `${label}: ${kmh.toFixed(1)} km/h is a ride`);
  assert.ok(row.avgHr > 110 && row.avgHr < row.maxHr && row.maxHr <= 188, `${label}: heart rate`);
  if (row.sportType === 203) {
    assert.equal(detail.dynamics.avgPower, undefined, `${label}: the gravel bike has no meter`);
    assert.ok(series.every((point) => point.power === undefined));
  } else {
    assert.ok(detail.dynamics.avgPower > 100 && detail.dynamics.maxPower < 800, `${label}: power`);
  }
  if (label.startsWith("Tam Đảo")) {
    assert.ok(row.elevationGain > 800, `${label}: Tam Đảo is a mountain (${row.elevationGain} m)`);
  }
  if (label.startsWith("West Lake")) {
    assert.ok(row.elevationGain / (row.distance / 1000) < 4, `${label}: the lake is flat`);
  }

  const summary = samples.withSampleRideSummaries([row.activityId], [])[0];
  assert.equal(
    summary.zoneSeconds.reduce((sum, value) => sum + value, 0),
    row.duration,
    `${label}: time in zone covers the ride`
  );
  known.add(row.activityId);
}
assert.equal(known.size, rides.length, "every ride has its own id");
assert.throws(() => samples.sampleRideDetail("sample-ride-nope"));
assert.deepEqual(
  samples.withSampleRideSummaries(["real-1"], []),
  [],
  "a real activity gets no invented summary"
);

// --- Ridden at the account's FTP ----------------------------------------------
//
// The ride page scores power against the profile's FTP, so the rider has to
// have it: a tempo ride written for 262 W and read against 180 would be IF 1.2
// for an hour and a half. Every watt scales; the effort — heart rate — does not.

const tempoId = "sample-ride-westlake-tempo";
const atPlan = samples.sampleRideDetail(tempoId);
samples.setSampleRiderFtp(180);
const atAccount = samples.sampleRideDetail(tempoId);
const powerRatio = atAccount.dynamics.avgPower / atPlan.dynamics.avgPower;
assert.ok(Math.abs(powerRatio - 180 / 262) < 0.04, `watts scale with the FTP (${powerRatio.toFixed(3)})`);
assert.ok(atAccount.duration > atPlan.duration, "a lower FTP is a slower rider over the same road");
assert.ok(Math.abs(atAccount.avgHr - atPlan.avgHr) <= 6, "at the same effort");
const listed = samples.withSampleRides([], { page: 1 }).find((row) => row.activityId === tempoId);
assert.equal(listed.duration, atAccount.duration, "the list is ridden by the same rider as the page");
samples.setSampleRiderFtp(undefined);
assert.equal(samples.sampleRideDetail(tempoId).duration, atPlan.duration, "no FTP rides the plans' own");

console.log(`sample rides: OK (${rides.length} rides)`);
