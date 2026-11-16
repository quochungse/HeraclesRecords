import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const formattersUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "formatters.ts")
);

const {
  buildRunningFitnessPaceLabels,
  formatRunningFitnessPaceRange
} = await import(`${formattersUrl.href}?cacheBust=${Date.now()}`);

// A live `ltspZoneDefault` (2026-11-16), and what the COROS app printed for it.
const fixture = [
  { index: 0, pace: 461, ratio: 69.6 },
  { index: 1, pace: 386, ratio: 83.1 },
  { index: 2, pace: 350, ratio: 91.7 },
  { index: 3, pace: 321, ratio: 100 },
  { index: 4, pace: 314, ratio: 102.2 },
  { index: 5, pace: 285, ratio: 112.6 },
  { index: 6, pace: 161, ratio: 200 }
];

const labels = buildRunningFitnessPaceLabels(fixture);

assert.equal(labels.Endurance, `06'26" - 07'41"/km`);
assert.equal(labels.Threshold, `05'14" - 05'49"/km`);
assert.equal(labels.Speed, `04'45" - 05'13"/km`);
assert.equal(labels.Sprint, `< 04'45"/km`);
assert.equal(formatRunningFitnessPaceRange(undefined, 273), `< 04'33"/km`);

// Order comes from `index`, not from the array.
assert.deepEqual(buildRunningFitnessPaceLabels([...fixture].reverse()), labels);

// Any other layout says nothing rather than a range from the wrong zones.
assert.deepEqual(buildRunningFitnessPaceLabels(fixture.slice(0, 6)), {});
assert.deepEqual(
  buildRunningFitnessPaceLabels(fixture.map((zone) => (zone.index === 2 ? { ...zone, pace: 0 } : zone))),
  {}
);

console.log("running fitness pace tests passed");
