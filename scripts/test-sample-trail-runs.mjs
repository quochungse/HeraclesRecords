// The sample trail runs behind HERACLES_SAMPLE_TRAIL_RUNS=1 (electron/sampleTrailRuns.ts).
//
// The sample hikes' suite asked again of a runner: what a screenshot would
// give away — a list row that disagrees with its own page, a run that changes
// between two launches, figures no trail runner produces — and that, being
// fiction, they only ever reach the window, never the store or Coach.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = () =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sampleTrailRuns.js")).href}?cacheBust=${Date.now()}-${Math.random()}`
  );

const samples = await load();

// --- Behind the flag, and behind the window's door only --------------------

assert.equal(samples.sampleTrailRunsEnabled({}), false);
assert.equal(samples.sampleTrailRunsEnabled({ HERACLES_SAMPLE_TRAIL_RUNS: "0" }), false);
assert.equal(samples.sampleTrailRunsEnabled({ HERACLES_SAMPLE_TRAIL_RUNS: "1" }), true);
assert.equal(samples.sampleTrailRunsEnabled({ HERACLES_SAMPLE_HIKES: "1" }), false, "the hikes' flag is not this one");

const importers = fs
  .readdirSync(path.join(repoRoot, "electron"))
  .filter((name) => name.endsWith(".ts") && name !== "sampleTrailRuns.ts")
  .filter((name) =>
    /from "\.\/sampleTrailRuns"/.test(fs.readFileSync(path.join(repoRoot, "electron", name), "utf8"))
  );
assert.deepEqual(importers, ["main.ts"], "only the IPC handlers reach the sample trail runs");

const main = fs.readFileSync(path.join(repoRoot, "electron", "main.ts"), "utf8");
for (const channel of [
  "trainingHub:listActivities",
  "trainingHub:getActivityDetail",
  "trainingHub:getActivityDetailRaw",
  "trainingHub:getActivityDetailSummaries"
]) {
  const handler = main.slice(main.indexOf(`"${channel}"`), main.indexOf(`"${channel}"`) + 1400);
  assert.match(handler, /sampleTrailRunsEnabled\(\)/, `${channel} asks the flag`);
}

// --- The list ---------------------------------------------------------------

const real = [{ activityId: "real-1", sportType: 100, startTime: Math.floor(Date.now() / 1000) - 3600 }];
const page1 = samples.withSampleTrailRuns(real, { page: 1 });
const runs = page1.filter((activity) => samples.isSampleTrailRunId(activity.activityId));
assert.ok(runs.length >= 12, `three months of trail running: ${runs.length}`);
assert.ok(page1.some((activity) => activity.activityId === "real-1"), "the real list is kept");
for (let index = 1; index < page1.length; index += 1) {
  assert.ok(page1[index - 1].startTime >= page1[index].startTime, "newest first, as COROS sends it");
}
assert.deepEqual(samples.withSampleTrailRuns(real, { page: 2 }), real, "a later page does not meet them again");
assert.ok(runs.every((run) => run.startTime * 1000 <= Date.now()), "nothing in the future");
assert.ok(runs.every((run) => run.sportType === 102 && run.sportName === "Trail Run"), "every one a trail run");
assert.equal(new Set(runs.map((run) => new Date(run.startTime * 1000).toDateString())).size, runs.length, "one run a day");

// The trail view's hero reads this week and a twelve-week climbing rate: the
// current week holds a run, and most runs climb enough to count towards it.
const weekStart = new Date();
weekStart.setHours(0, 0, 0, 0);
weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
if (new Date().getDay() !== 1) {
  assert.ok(runs.some((run) => run.startTime * 1000 >= weekStart.getTime()), "a run this week, before work");
}
assert.ok(runs.filter((run) => run.elevationGain >= 300).length >= 10, "hilly enough to read a climbing rate");

// A day filter reaches them too.
const dayKey = (seconds) => {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
};
const oldest = runs[runs.length - 1];
assert.deepEqual(
  samples
    .withSampleTrailRuns([], { page: 1, startDay: dayKey(oldest.startTime), endDay: dayKey(oldest.startTime) })
    .map((run) => run.activityId),
  [oldest.activityId],
  "a dated window holds only its own day"
);

// --- The same runs on every launch -------------------------------------------

const again = (await load()).withSampleTrailRuns([], { page: 1 });
const figures = (list) =>
  list.map(({ activityId, distance, duration, avgHr, trainingLoad, elevationGain }) => ({
    activityId, distance, duration, avgHr, trainingLoad, elevationGain
  }));
assert.deepEqual(figures(again), figures(runs), "seeded: a screenshot can be taken twice");

// --- Every row agrees with its own page, and reads like a trail run ----------

const known = new Set();
for (const row of runs) {
  const detail = samples.sampleTrailRunDetail(row.activityId);
  const series = detail.series;
  const last = series[series.length - 1];
  const label = `${row.name} (${row.activityId})`;

  assert.equal(row.distance, Math.round(last.distance), `${label}: distance`);
  assert.equal(row.duration, series.length, `${label}: activity time is the recorded samples`);
  const paused = detail.pauses.reduce((sum, pause) => sum + pause.duration, 0);
  assert.equal(row.elapsedDuration - row.duration, paused, `${label}: the gap is the pauses`);
  assert.equal(
    detail.laps.reduce((sum, lap) => sum + lap.duration, 0),
    row.duration,
    `${label}: laps add up to the run`
  );
  assert.equal(detail.elevationGain, row.elevationGain, `${label}: climb`);
  assert.ok(Math.abs(detail.elevationLoss - row.elevationGain) < 15, `${label}: a loop comes back down`);
  assert.ok(detail.track.points.length <= 401 && detail.track.route.length > 100, `${label}: a track`);

  // A runner on steep ground: slower than the road, far faster than a walk.
  const pace = row.duration / (row.distance / 1000);
  assert.ok(pace > 6 * 60 && pace < 11 * 60, `${label}: ${(pace / 60).toFixed(1)} min/km`);
  assert.ok(detail.adjustedPace < pace, `${label}: GAP ${detail.adjustedPace} is faster than the pace on a hilly run`);
  assert.ok(row.avgHr > 130 && row.avgHr < 165 && row.maxHr <= 186, `${label}: heart rate ${row.avgHr}/${row.maxHr}`);
  assert.ok(detail.dynamics.avgCadence > 135 && detail.dynamics.avgCadence < 175, `${label}: cadence ${detail.dynamics.avgCadence}`);
  assert.ok(detail.dynamics.avgPower > 150 && detail.dynamics.avgPower < 260, `${label}: power ${detail.dynamics.avgPower} W`);
  assert.ok(
    detail.dynamics.groundTime > 240 && detail.dynamics.groundTime < 320 &&
      detail.dynamics.verticalRatio > 7 && detail.dynamics.verticalRatio < 12,
    `${label}: running form ${detail.dynamics.groundTime} ms, ${detail.dynamics.verticalRatio}%`
  );
  const moving = series.filter((point) => point.pace !== undefined).length;
  const rate = row.elevationGain / (moving / 3600);
  assert.ok(rate > 300 && rate < 800, `${label}: ${Math.round(rate)} m/h`);
  // Every moving sample states a pace and a GAP; a power-hike states no ground contact.
  assert.ok(series.every((point) => (point.pace === undefined) === (point.adjustedPace === undefined)), `${label}: GAP beside every pace`);
  const hiked = series.filter((point) => point.pace !== undefined && point.groundTime === undefined).length;
  assert.ok(hiked > 0 && hiked < moving * 0.5, `${label}: some of it hiked, most of it run (${Math.round((100 * hiked) / moving)}%)`);

  assert.ok(detail.laps.every((lap) => lap.avgPower > 0 && lap.pace > 0), `${label}: laps carry power and pace`);
  assert.equal(detail.effect.vo2max, 54);

  const summary = samples.withSampleTrailRunSummaries([row.activityId], [])[0];
  assert.equal(
    summary.zoneSeconds.reduce((sum, value) => sum + value, 0),
    row.duration,
    `${label}: time in zone covers the run`
  );
  known.add(row.activityId);
}
assert.equal(known.size, runs.length, "every run has its own id");

// --- The sessions are what their names say ------------------------------------

const byName = (name) => runs.filter((run) => run.name === name);
const loop = byName("Hàm Lợn easy loop")[0];
const double = byName("Hàm Lợn double")[0];
const race = byName("Hàm Lợn 21K race")[0];
const repeats = byName("Hàm Lợn hill repeats")[0];
assert.ok(loop && double && race && repeats, "the four kinds of Hàm Lợn day");
assert.ok(Math.abs(double.distance - 2 * loop.distance) < 50, "a double is the loop twice");
assert.ok(race.duration < double.duration * 0.92, "the race is run, the double is a long day");
assert.ok(race.avgHr > loop.avgHr + 8, `the race runs hotter: ${race.avgHr} against ${loop.avgHr}`);
assert.ok(
  samples.sampleTrailRunDetail(race.activityId).effect.anaerobic >
    samples.sampleTrailRunDetail(loop.activityId).effect.anaerobic + 1,
  "and harder"
);
assert.equal(samples.sampleTrailRunDetail(race.activityId).pauses.length, 0, "a race runs with auto-pause off");

// Repeats climb and descend one stretch again and again: the altitude turns
// round at the same top more than four times.
{
  const series = samples.sampleTrailRunDetail(repeats.activityId).series;
  const top = Math.max(...series.map((point) => point.altitude));
  let tops = 0;
  let near = false;
  for (const point of series) {
    const at = point.altitude > top - 8;
    if (at && !near) tops += 1;
    near = at;
  }
  assert.ok(tops >= 4, `repeats reach the same top again and again: ${tops}`);
  assert.ok(samples.sampleTrailRunDetail(repeats.activityId).pauses.length > 0, "with auto-pause on, the stops are pauses");
}

assert.throws(() => samples.sampleTrailRunDetail("sample-trail-nope"));
assert.deepEqual(samples.withSampleTrailRunSummaries(["real-1"], []), [], "a real activity gets no invented summary");

console.log(`sample trail runs: OK (${runs.length} runs)`);
