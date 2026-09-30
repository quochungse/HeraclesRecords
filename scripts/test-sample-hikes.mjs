// The sample hikes behind HERACLES_SAMPLE_HIKES=1 (electron/sampleHikes.ts).
//
// The sample rides' suite asked again of the trail: what a screenshot would
// give away — a list row that disagrees with its own page, a hike that
// changes between two launches, figures no walker produces — and that, being
// fiction, they only ever reach the window, never the store or Coach.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = () =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sampleHikes.js")).href}?cacheBust=${Date.now()}-${Math.random()}`
  );

const samples = await load();

// --- Behind the flag, and behind the window's door only --------------------

assert.equal(samples.sampleHikesEnabled({}), false);
assert.equal(samples.sampleHikesEnabled({ HERACLES_SAMPLE_HIKES: "0" }), false);
assert.equal(samples.sampleHikesEnabled({ HERACLES_SAMPLE_HIKES: "1" }), true);
assert.equal(samples.sampleHikesEnabled({ HERACLES_SAMPLE_RIDES: "1" }), false, "the rides' flag is not this one");

const importers = fs
  .readdirSync(path.join(repoRoot, "electron"))
  .filter((name) => name.endsWith(".ts") && name !== "sampleHikes.ts")
  .filter((name) =>
    /from "\.\/sampleHikes"/.test(fs.readFileSync(path.join(repoRoot, "electron", name), "utf8"))
  );
assert.deepEqual(importers, ["main.ts"], "only the IPC handlers reach the sample hikes");
const kitImporters = fs
  .readdirSync(path.join(repoRoot, "electron"))
  .filter((name) => name.endsWith(".ts"))
  .filter((name) =>
    /from "\.\/sampleActivityKit"/.test(fs.readFileSync(path.join(repoRoot, "electron", name), "utf8"))
  )
  .sort();
assert.deepEqual(kitImporters, ["sampleHikes.ts", "sampleRides.ts"], "the shared kit serves the two samples and nothing else");

const main = fs.readFileSync(path.join(repoRoot, "electron", "main.ts"), "utf8");
for (const channel of [
  "trainingHub:listActivities",
  "trainingHub:getActivityDetail",
  "trainingHub:getActivityDetailRaw",
  "trainingHub:getActivityDetailSummaries"
]) {
  const handler = main.slice(main.indexOf(`"${channel}"`), main.indexOf(`"${channel}"`) + 900);
  assert.match(handler, /sampleHikesEnabled\(\)/, `${channel} asks the flag`);
}

// --- The list ---------------------------------------------------------------

const real = [{ activityId: "real-1", sportType: 100, startTime: Math.floor(Date.now() / 1000) - 3600 }];
const page1 = samples.withSampleHikes(real, { page: 1 });
const hikes = page1.filter((activity) => samples.isSampleHikeId(activity.activityId));
assert.ok(hikes.length >= 12, `three months of weekends: ${hikes.length}`);
assert.ok(page1.some((activity) => activity.activityId === "real-1"), "the real list is kept");
for (let index = 1; index < page1.length; index += 1) {
  assert.ok(page1[index - 1].startTime >= page1[index].startTime, "newest first, as COROS sends it");
}
assert.deepEqual(samples.withSampleHikes(real, { page: 2 }), real, "a later page does not meet them again");
assert.ok(hikes.every((hike) => hike.startTime * 1000 <= Date.now()), "nothing in the future");
assert.ok(
  hikes.filter((hike) => [0, 6].includes(new Date(hike.startTime * 1000).getDay())).length >= hikes.length - 1,
  "a Hanoi office worker hikes at weekends, bar one sunrise before work"
);
assert.ok(hikes.some((hike) => hike.sportType === 105), "a mountain climb among them");
assert.ok(hikes.some((hike) => hike.sportType === 104), "and hikes");

// --- The same hikes on every launch ------------------------------------------

const again = (await load()).withSampleHikes([], { page: 1 });
const figures = (list) =>
  list.map(({ activityId, distance, duration, avgHr, trainingLoad, elevationGain }) => ({
    activityId, distance, duration, avgHr, trainingLoad, elevationGain
  }));
assert.deepEqual(figures(again), figures(hikes), "seeded: a screenshot can be taken twice");

// --- Every row agrees with its own page, and reads like a hike ----------------

const known = new Set();
for (const row of hikes) {
  const detail = samples.sampleHikeDetail(row.activityId);
  const series = detail.series;
  const last = series[series.length - 1];
  const label = row.name;

  assert.equal(row.distance, Math.round(last.distance), `${label}: distance`);
  assert.equal(row.duration, series.length, `${label}: activity time is the recorded samples`);
  const paused = detail.pauses.reduce((sum, pause) => sum + pause.duration, 0);
  assert.equal(row.elapsedDuration - row.duration, paused, `${label}: the gap is the pauses`);
  assert.equal(
    detail.laps.reduce((sum, lap) => sum + lap.duration, 0),
    row.duration,
    `${label}: splits add up to the hike`
  );
  assert.equal(detail.elevationGain, row.elevationGain, `${label}: ascent`);
  assert.ok(detail.track.points.length <= 401 && detail.track.route.length > 100, `${label}: a track`);

  // A walker, not a runner: 1.5–5 km/h over the day — a mountain above 2,500 m
  // is slow going — steps not strides.
  const moving = series.filter((point) => point.pace !== undefined).length;
  const kmh = row.distance / 1000 / (moving / 3600);
  assert.ok(kmh > 1.5 && kmh < 5, `${label}: ${kmh.toFixed(1)} km/h moving is a walk`);
  assert.ok(row.avgHr > 100 && row.avgHr < 150 && row.maxHr < 180, `${label}: heart rate ${row.avgHr}/${row.maxHr}`);
  assert.ok(detail.dynamics.avgCadence > 80 && detail.dynamics.avgCadence < 120, `${label}: cadence ${detail.dynamics.avgCadence}`);
  assert.ok(series.every((point) => point.power === undefined), `${label}: no power on a hike`);
  const rate = row.elevationGain / (moving / 3600);
  assert.ok(rate > 150 && rate < 600, `${label}: ${Math.round(rate)} m/h is a walker's climbing rate`);

  if (label.startsWith("Fansipan")) {
    const top = Math.max(...series.map((point) => point.altitude));
    assert.equal(Math.round(top), 3143, `${label}: the summit on its surveyed height, not SRTM's`);
    assert.ok(row.elevationGain > 1100, `${label}: the Trạm Tôn trail climbs ${row.elevationGain} m`);
    assert.ok(series[series.length - 1].altitude > 3100, `${label}: the watch stops on top — the cable car takes them down`);
  }
  if (row.sportType === 104 && detail.pauses.length === 0) {
    const standing = series.filter((point) => point.pace === undefined).length;
    assert.ok(standing > 5 * 60, `${label}: auto-pause off, so the watch recorded the rests (${standing} s)`);
  }

  const summary = samples.withSampleHikeSummaries([row.activityId], [])[0];
  assert.equal(
    summary.zoneSeconds.reduce((sum, value) => sum + value, 0),
    row.duration,
    `${label}: time in zone covers the hike`
  );
  known.add(row.activityId);
}
assert.equal(known.size, hikes.length, "every hike has its own id");
assert.ok(
  hikes.some((row) => samples.sampleHikeDetail(row.activityId).pauses.length > 0),
  "one walker has auto-pause on"
);
assert.throws(() => samples.sampleHikeDetail("sample-hike-nope"));
assert.deepEqual(samples.withSampleHikeSummaries(["real-1"], []), [], "a real activity gets no invented summary");

console.log(`sample hikes: OK (${hikes.length} hikes)`);
