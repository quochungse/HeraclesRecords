// The sample swims behind HERACLES_SAMPLE_SWIMS=1 (electron/sampleSwims.ts).
//
// The sample hikes' suite asked again of the water: what a screenshot would
// give away — a list row that disagrees with its own page, a swim that
// changes between two launches, figures no swimmer produces — and that, being
// fiction, they only ever reach the window, never the store or Coach.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = () =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sampleSwims.js")).href}?cacheBust=${Date.now()}-${Math.random()}`
  );
const { SWIM_SUMMARY_VERSION } = await import(
  `${pathToFileURL(path.join(repoRoot, "dist-electron", "swimDetail.js")).href}?cacheBust=${Date.now()}`
);

const samples = await load();

// --- Behind the flag, and behind the window's door only --------------------

assert.equal(samples.sampleSwimsEnabled({}), false);
assert.equal(samples.sampleSwimsEnabled({ HERACLES_SAMPLE_SWIMS: "0" }), false);
assert.equal(samples.sampleSwimsEnabled({ HERACLES_SAMPLE_SWIMS: "1" }), true);
assert.equal(samples.sampleSwimsEnabled({ HERACLES_SAMPLE_HIKES: "1" }), false, "the hikes' flag is not this one");

const importers = fs
  .readdirSync(path.join(repoRoot, "electron"))
  .filter((name) => name.endsWith(".ts") && name !== "sampleSwims.ts")
  .filter((name) => /from "\.\/sampleSwims"/.test(fs.readFileSync(path.join(repoRoot, "electron", name), "utf8")));
assert.deepEqual(importers, ["main.ts"], "only the IPC handlers reach the sample swims");

const main = fs.readFileSync(path.join(repoRoot, "electron", "main.ts"), "utf8");
for (const channel of [
  "trainingHub:listActivities",
  "trainingHub:getActivityDetail",
  "trainingHub:getActivityDetailRaw",
  "trainingHub:getActivityDetailSummaries"
]) {
  const handler = main.slice(main.indexOf(`"${channel}"`), main.indexOf(`"${channel}"`) + 1200);
  assert.match(handler, /sampleSwimsEnabled\(\)/, `${channel} asks the flag`);
}
assert.match(main, /"HERACLES_SAMPLE_SWIMS",\r?\n/, "a packaged build clears the flag");
assert.match(main, /swims: "HERACLES_SAMPLE_SWIMS"/, "the development bar can switch it");

// --- The list ---------------------------------------------------------------

const real = [{ activityId: "real-1", sportType: 100, startTime: Math.floor(Date.now() / 1000) - 3600 }];
const page1 = samples.withSampleSwims(real, { page: 1 });
const swims = page1.filter((activity) => samples.isSampleSwimId(activity.activityId));
assert.ok(swims.length >= 20, `twelve weeks of two sessions and the lake: ${swims.length}`);
assert.ok(page1.some((activity) => activity.activityId === "real-1"), "the real list is kept");
for (let index = 1; index < page1.length; index += 1) {
  assert.ok(page1[index - 1].startTime >= page1[index].startTime, "newest first, as COROS sends it");
}
assert.deepEqual(samples.withSampleSwims(real, { page: 2 }), real, "a later page does not meet them again");
assert.ok(swims.every((swim) => swim.startTime * 1000 <= Date.now()), "nothing in the future");
assert.ok(
  swims.every((swim) => swim.startTime * 1000 >= Date.now() - 12 * 7 * 86_400_000 - 7 * 86_400_000),
  "twelve weeks back"
);
assert.ok(swims.some((swim) => swim.sportType === 300), "pool swims");
assert.ok(swims.some((swim) => swim.sportType === 301), "and open water");

// --- The same swims on every launch -------------------------------------------

const again = (await load()).withSampleSwims([], { page: 1 });
const figures = (list) =>
  list.map((swim) => [swim.activityId, swim.distance, swim.duration, swim.avgHr, swim.trainingLoad]);
assert.deepEqual(figures(again), figures(swims), "seeded: the same figures on every launch");

// --- Each swim's page agrees with its row ---------------------------------------

const summaries = samples.withSampleSwimSummaries(
  swims.map((swim) => swim.activityId),
  []
);
assert.equal(summaries.length, swims.length, "every sample swim has its summary");

const pools = new Set();
let sawTest = false;
for (const swim of swims) {
  const detail = samples.sampleSwimDetail(swim.activityId);
  assert.equal(detail.distance, swim.distance, `${swim.activityId}: the page's distance is the row's`);
  assert.ok(detail.swim, `${swim.activityId}: carries its swim`);
  assert.ok(detail.series.length === swim.duration, `${swim.activityId}: a sample a second`);
  const summary = summaries.find((entry) => entry.activityId === swim.activityId);
  assert.equal(summary.swimVersion, SWIM_SUMMARY_VERSION, `${swim.activityId}: the current swim summary`);

  if (swim.sportType === 300) {
    const { swim: pool } = detail;
    pools.add(pool.poolLength);
    const meters = pool.lengths.reduce((sum, length) => sum + length.distance, 0);
    assert.equal(Math.round(meters), swim.distance, `${swim.activityId}: the lengths add up to the row`);
    assert.equal(pool.lengths.length * pool.poolLength, swim.distance, `${swim.activityId}: whole lengths`);
    assert.ok(pool.restSeconds > 60, `${swim.activityId}: rests at the wall`);
    assert.ok(
      Math.abs(pool.swimSeconds + pool.restSeconds - swim.duration) <= pool.lengths.length,
      `${swim.activityId}: swimming and resting make the session`
    );
    for (const length of pool.lengths) {
      if (length.style === "drill") {
        assert.equal(length.strokes, undefined, "a drill is not counted");
        continue;
      }
      const pacePer100 = (length.seconds / length.distance) * 100;
      assert.ok(pacePer100 > 75 && pacePer100 < 160, `${swim.activityId}: a club swimmer's pace (${pacePer100})`);
      const perLength = length.strokes * (25 / length.distance);
      assert.ok(perLength >= 8 && perLength <= 18, `${swim.activityId}: strokes a 25 m length (${perLength})`);
      assert.ok(length.strokeRate >= 20 && length.strokeRate <= 50, `${swim.activityId}: stroke rate (${length.strokeRate})`);
    }
    if (swim.name.startsWith("CSS test")) {
      sawTest = true;
      const t200 = summary.swim.best.find((effort) => effort.distance === 200).seconds;
      const t400 = summary.swim.best.find((effort) => effort.distance === 400).seconds;
      const css = 100 / (200 / (t400 - t200));
      assert.ok(css > 95 && css < 110, `a CSS test reads a club swimmer's CSS (${css})`);
    }
  } else {
    assert.equal(detail.swim.poolLength, undefined, "open water has no pool");
    const pacePer100 = (swim.duration / swim.distance) * 100;
    assert.ok(pacePer100 > 95 && pacePer100 < 140, `${swim.activityId}: an open-water pace (${pacePer100})`);
    assert.ok(swim.distance > 1200 && swim.distance < 3000, `${swim.activityId}: one or two loops (${swim.distance} m)`);
    assert.ok(detail.track?.points.length > 100, "open water has its route");
    assert.ok(detail.swim.intervals.length >= 2, "open water's laps");
  }
}
assert.deepEqual([...pools].sort((a, b) => a - b), [25, 50], "short course and now and then long course");
assert.ok(sawTest, "a CSS test among them");

console.log(`sample swims: ${swims.length} ok`);
