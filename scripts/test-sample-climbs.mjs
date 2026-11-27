// The sample climbs behind HERACLES_SAMPLE_CLIMBS=1 (electron/sampleClimbs.ts).
//
// The sample swims' suite asked again of the wall: that, being fiction, they
// only ever reach the window, never the store or Coach; that they read back
// through the real parser as a climber's sessions would — every kind, a trip
// in YDS, multi-pitch routes, unmarked warm-ups; and that two launches give
// the same climbs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = () =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", "sampleClimbs.js")).href}?cacheBust=${Date.now()}-${Math.random()}`
  );
const { CLIMB_SUMMARY_VERSION } = await import(
  `${pathToFileURL(path.join(repoRoot, "dist-electron", "climbDetail.js")).href}?cacheBust=${Date.now()}`
);

const samples = await load();

// --- Behind the flag, and behind the window's door only --------------------

assert.equal(samples.sampleClimbsEnabled({}), false);
assert.equal(samples.sampleClimbsEnabled({ HERACLES_SAMPLE_CLIMBS: "0" }), false);
assert.equal(samples.sampleClimbsEnabled({ HERACLES_SAMPLE_CLIMBS: "1" }), true);
assert.equal(samples.sampleClimbsEnabled({ HERACLES_SAMPLE_SWIMS: "1" }), false, "the swims' flag is not this one");

const importers = fs
  .readdirSync(path.join(repoRoot, "electron"))
  .filter((name) => name.endsWith(".ts") && name !== "sampleClimbs.ts")
  .filter((name) => /from "\.\/sampleClimbs"/.test(fs.readFileSync(path.join(repoRoot, "electron", name), "utf8")));
assert.deepEqual(importers, ["main.ts"], "only the IPC handlers reach the sample climbs");

const main = fs.readFileSync(path.join(repoRoot, "electron", "main.ts"), "utf8");
assert.ok(main.includes('"HERACLES_SAMPLE_CLIMBS",'), "a packaged build clears the flag");
for (const call of ["withSampleClimbs(", "sampleClimbDetail(", "withSampleClimbSummaries("]) {
  assert.ok(main.includes(call), `main.ts answers the window with ${call}`);
}

// --- What the sessions are ----------------------------------------------------

const list = samples.withSampleClimbs([], { page: 1 });
assert.ok(list.length >= 30, `twelve weeks of climbing, ${list.length} sessions`);
assert.deepEqual(samples.withSampleClimbs([], { page: 2 }), [], "the first page only");
assert.deepEqual(new Set(list.map((activity) => activity.sportType)), new Set([800, 801, 802, 10003]), "every kind of climbing");
for (let index = 1; index < list.length; index += 1) {
  assert.ok((list[index - 1].startTime ?? 0) >= (list[index].startTime ?? 0), "newest first");
}
assert.ok(list.every((activity) => (activity.startTime ?? 0) * 1000 <= Date.now()), "nothing climbed later this week");

let grades = 0;
let unmarked = 0;
const outdoorSystems = new Set();
for (const activity of list) {
  assert.ok(samples.isSampleClimbId(activity.activityId));
  const detail = samples.sampleClimbDetail(activity.activityId);
  assert.ok(detail.climb, `${activity.activityId} reads back as a climbing session`);
  const { climbs } = detail.climb;
  assert.ok(climbs.length >= (activity.sportType === 10003 ? 2 : 5), "a session holds its climbs");
  assert.ok(climbs.every((climb) => climb.seconds > 0 && climb.startSeconds !== undefined));
  assert.ok(detail.climb.climbingSeconds < activity.duration, "a session is more than its climbs");
  if (activity.sportType === 800 || activity.sportType === 801) {
    assert.ok(climbs.some((climb) => climb.style === "attempt"), "every gym session tries something it does not send");
  }
  grades += climbs.filter((climb) => climb.system !== undefined).length;
  unmarked += climbs.filter((climb) => climb.style === "unrecorded" && climb.system === undefined).length;
  if (activity.sportType === 802 || activity.sportType === 10003) {
    for (const climb of climbs) outdoorSystems.add(climb.system);
  }
  if (activity.sportType === 10003) {
    assert.ok(climbs.every((climb) => (climb.pitches ?? 1) >= 3), "a multi-pitch route is three pitches or more");
    assert.ok(climbs.every((climb) => climb.style !== "unrecorded"), "a route goes as its last marked pitch went");
  }
  assert.equal(detail.series.length, activity.duration, "a heart rate a second");
  assert.equal(activity.avgHr > 90 && activity.maxHr < 200, true);
}
assert.ok(grades > 300, "the climbs are graded");
assert.ok(unmarked > 0, "a warm-up now and then is neither marked nor graded");
assert.deepEqual([...outdoorSystems].sort(), [1, 2], "outdoors in French, and a trip in YDS");

const [summary] = samples.withSampleClimbSummaries([list[0].activityId], []);
assert.equal(summary.climbVersion, CLIMB_SUMMARY_VERSION);
assert.equal(summary.climb.climbs.length, samples.sampleClimbDetail(list[0].activityId).climb.climbs.length);
assert.deepEqual(samples.withSampleClimbSummaries(["someone-else"], []), []);

// --- The same on every launch ------------------------------------------------

const again = await load();
const first = samples.sampleClimbDetail(list[0].activityId).climb;
const second = again.sampleClimbDetail(list[0].activityId).climb;
assert.deepEqual(second.climbs.map((climb) => [climb.gradeIndex, climb.style]), first.climbs.map((climb) => [climb.gradeIndex, climb.style]));

console.log("sample climbs: ok");
