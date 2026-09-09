// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types. Nothing here touches SQLite.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "heartRateZoneModel.ts")
);
const {
  HR_ZONE_MODELS,
  hrZoneModelDefinition,
  heartRateZoneModelFromProfile,
  formatHeartRateZoneRange
} = await import(`${modUrl.href}?c=${Date.now()}`);

// Every zone list below is the live `/account/query` payload, read on
// 2026-09-09. Two things it settles, and both decide whether the chart labels
// land on the right bucket:
//
//   * COROS numbers heart-rate zones from 0, six of them per family — the same
//     numbering `hrTlAreaList` uses, so bucket n is zone n.
//   * a zone states its *ceiling* in `hr`, and the top zone's is a sentinel:
//     `rhrZone` puts 404 bpm at 255% of heart-rate reserve.
const MAX_HR_ZONES = [
  { index: 0, bpm: 95, ratio: 50 },
  { index: 1, bpm: 114, ratio: 60 },
  { index: 2, bpm: 133, ratio: 70 },
  { index: 3, bpm: 152, ratio: 80 },
  { index: 4, bpm: 171, ratio: 90 },
  { index: 5, bpm: 190, ratio: 100 }
];
const RESTING_HR_ZONES = [
  { index: 0, bpm: 133, ratio: 59 },
  { index: 1, bpm: 154, ratio: 74 },
  { index: 2, bpm: 168, ratio: 84 },
  { index: 3, bpm: 173, ratio: 88 },
  { index: 4, bpm: 183, ratio: 95 },
  { index: 5, bpm: 404, ratio: 255 }
];
const LTHR_ZONES = [
  { index: 0, bpm: 134, ratio: 80 },
  { index: 1, bpm: 151, ratio: 90 },
  { index: 2, bpm: 160, ratio: 95 },
  { index: 3, bpm: 171, ratio: 102 },
  { index: 4, bpm: 178, ratio: 106 },
  { index: 5, bpm: 218, ratio: 130 }
];

function profile(hrZoneType, overrides = {}) {
  return {
    userId: "478751691911479296",
    hrZoneType,
    thresholds: {
      maxHr: 190,
      restingHr: 52,
      lthr: 168,
      zones: {
        maxHr: MAX_HR_ZONES,
        restingHr: RESTING_HR_ZONES,
        lthr: LTHR_ZONES,
        thresholdPace: [],
        cyclePower: []
      },
      ranges: {},
      ...overrides
    }
  };
}

// The three codes COROS's own picker offers, and the family each is built on.
assert.deepEqual(
  HR_ZONE_MODELS.map((model) => [model.value, model.family]),
  [
    [1, "maxHr"],
    [2, "restingHr"],
    [3, "lthr"]
  ]
);
assert.equal(hrZoneModelDefinition(2)?.label, "Heart rate reserve");
assert.equal(hrZoneModelDefinition(4), undefined);

// hrZoneType picks the family. Reading LTHR regardless — what the Overview
// chart did before — puts a 134–151 bpm label on a bucket COROS scored at
// 134–154 bpm of heart-rate reserve.
const reserve = heartRateZoneModelFromProfile(profile(2));
assert.equal(reserve.family, "restingHr");
assert.equal(reserve.title, "Heart Rate Reserve");
assert.equal(reserve.anchorNote, "Max HR 190 bpm · resting 52 bpm");
assert.deepEqual(
  reserve.zones.map((zone) => zone.hr),
  [133, 154, 168, 173, 183, 404]
);

assert.equal(heartRateZoneModelFromProfile(profile(1)).family, "maxHr");
assert.equal(
  heartRateZoneModelFromProfile(profile(1)).anchorNote,
  "Max HR 190 bpm"
);
assert.equal(heartRateZoneModelFromProfile(profile(3)).family, "lthr");
assert.equal(
  heartRateZoneModelFromProfile(profile(3)).anchorNote,
  "LTHR 168 bpm"
);

// No model, no zones for the model it names, no profile at all: all three are
// the caller's cue to keep the labels it already had.
assert.equal(heartRateZoneModelFromProfile(profile(undefined)), null);
assert.equal(heartRateZoneModelFromProfile(null), null);
assert.equal(
  heartRateZoneModelFromProfile({
    ...profile(1),
    thresholds: { ...profile(1).thresholds, zones: { ...profile(1).thresholds.zones, maxHr: [] } }
  }),
  null
);

// An anchor COROS has not calculated leaves the note off rather than printing
// "undefined bpm" beside the chart.
assert.equal(
  heartRateZoneModelFromProfile(
    profile(3, { maxHr: 190, restingHr: 52, lthr: undefined })
  ).anchorNote,
  undefined
);

// Zones arrive in whatever order; a range is read off the neighbour below.
const shuffled = heartRateZoneModelFromProfile({
  ...profile(2),
  thresholds: {
    ...profile(2).thresholds,
    zones: {
      ...profile(2).thresholds.zones,
      restingHr: [...RESTING_HR_ZONES].reverse()
    }
  }
});
assert.deepEqual(
  shuffled.zones.map((zone) => zone.index),
  [0, 1, 2, 3, 4, 5]
);

// Zone 1 has no floor, the top zone no ceiling worth printing — 404 bpm is a
// sentinel, and 218 bpm of LTHR is not a real ceiling either.
assert.equal(formatHeartRateZoneRange(reserve.zones, 0), "≤ 133 bpm");
assert.equal(formatHeartRateZoneRange(reserve.zones, 1), "134–154 bpm");
assert.equal(formatHeartRateZoneRange(reserve.zones, 4), "174–183 bpm");
assert.equal(formatHeartRateZoneRange(reserve.zones, 5), "≥ 184 bpm");
assert.equal(
  formatHeartRateZoneRange(
    heartRateZoneModelFromProfile(profile(3)).zones,
    5
  ),
  "≥ 179 bpm"
);

// Out of range and empty inputs, since the bucket list can outrun the zones.
assert.equal(formatHeartRateZoneRange(reserve.zones, 9), "≥ 184 bpm");
assert.equal(formatHeartRateZoneRange([], 0), "—");
assert.equal(formatHeartRateZoneRange([{ index: 0, ratio: 50 }], 0), "—");

console.log("hr zone model ok");
