// Personal screen: how `/account/query` becomes a CorosProfile, and which fields
// a profile edit is allowed to send to `/account/update`.
//
// Usage:
//   npm run test:coros-profile

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { normalizeCorosProfile, buildCorosProfileUpdateFields } = await import(
  `${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`
);

// Shaped after a live `/account/query` response, trimmed to what the screen reads.
const account = {
  userId: "478751691911479296",
  nickname: "Hung Nguyen",
  email: "runner@example.com",
  headPic: "https://s3.coros.com/avatar/202607/abc",
  countryCode: "VN",
  birthday: 19940626,
  sex: 0,
  stature: 170,
  weight: 67,
  unit: 0,
  temperatureUnit: 0,
  hrZoneType: 2,
  maxHr: 190,
  rhr: 52,
  maxHrUpdateTime: "2026-08-10 09:15:01",
  twoFactorRequired: false,
  sportDataSummary: { count: 46, modelValidState: true },
  userProfile: { language: "vi-VN", region: 2 },
  runScoreList: [
    { type: 1, avgPace: 379, duration: 15972 },
    { type: 5, avgPace: 315, duration: 1576 }
  ],
  zoneData: {
    maxHr: 190,
    maxHrRange: [120, 240],
    maxHrZone: [{ index: 0, hr: 95, ratio: 50 }],
    rhr: 52,
    rhrRange: [30, 120],
    rhrZone: [{ index: 0, hr: 133, ratio: 59 }],
    lthr: 168,
    lthrRange: [105, 215],
    lthrZone: [{ index: 0, hr: 134, ratio: 80 }],
    ltsp: 327,
    ltspRange: [159, 769],
    ltspZone: [{ index: 0, pace: 473, ratio: 69.2 }],
    ftp: 180,
    ftpRange: [60, 442],
    cyclePowerZone: [{ index: 0, power: 101, ratio: 56 }],
    weightMetricRange: [10, 300]
  }
};

const profile = normalizeCorosProfile(account);

assert.equal(profile.userId, "478751691911479296");
assert.equal(profile.nickname, "Hung Nguyen");
assert.equal(profile.avatarUrl, "https://s3.coros.com/avatar/202607/abc");
assert.equal(profile.birthday, 19940626);
assert.equal(profile.statureCm, 170);
assert.equal(profile.weightKg, 67);
assert.equal(profile.language, "vi-VN");
assert.equal(profile.activityCount, 46);
assert.equal(profile.maxHrUpdatedAt, "2026-08-10 09:15:01");
assert.equal(profile.twoFactorRequired, false);

assert.equal(profile.thresholds.maxHr, 190);
assert.equal(profile.thresholds.restingHr, 52);
assert.equal(profile.thresholds.lthr, 168);
assert.equal(profile.thresholds.thresholdPaceSecondsPerKm, 327);
assert.equal(profile.thresholds.ftp, 180);
assert.deepEqual(profile.thresholds.ranges.maxHr, { min: 120, max: 240 });
assert.deepEqual(profile.thresholds.ranges.weightKg, { min: 10, max: 300 });

assert.deepEqual(profile.thresholds.zones.maxHr, [
  { index: 0, ratio: 50, bpm: 95 }
]);
assert.deepEqual(profile.thresholds.zones.thresholdPace, [
  { index: 0, ratio: 69.2, paceSecondsPerKm: 473 }
]);
assert.deepEqual(profile.thresholds.zones.cyclePower, [
  { index: 0, ratio: 56, watts: 101 }
]);

// `zoneData` arrives as a JSON string on some accounts.
const stringZones = normalizeCorosProfile({
  ...account,
  zoneData: JSON.stringify(account.zoneData)
});
assert.equal(stringZones.thresholds.lthr, 168);
assert.equal(stringZones.thresholds.zones.lthr.length, 1);

// A non-https avatar would only render as a broken image.
assert.equal(
  normalizeCorosProfile({ ...account, headPic: "avatar/local.png" }).avatarUrl,
  undefined
);

// An account with nothing filled in must still produce a usable shape.
const empty = normalizeCorosProfile({});
assert.equal(empty.userId, "");
assert.deepEqual(empty.thresholds.zones.maxHr, []);
assert.deepEqual(empty.thresholds.ranges, {});

// --- writes ---------------------------------------------------------------

const fields = buildCorosProfileUpdateFields(
  {
    nickname: "  Hung  ",
    birthday: 19940626,
    sex: 1,
    statureCm: 171,
    weightKg: 67.4,
    maxHr: 189,
    restingHr: 51,
    unit: 1,
    temperatureUnit: 1
  },
  profile
);

assert.deepEqual(
  Object.fromEntries(fields),
  {
    nickname: "Hung",
    birthday: "19940626",
    // COROS ignores a field named `sex`; the write is named `gender`.
    gender: "1",
    stature: "171",
    weight: "67.4",
    maxHr: "189",
    rhr: "51",
    unit: "1",
    temperatureUnit: "1"
  }
);

// Switching zone models carries the model's anchor and zone table, the way the
// COROS web client sends them: 1 = max HR, 2 = HR reserve, 3 = lactate threshold.
assert.deepEqual(
  Object.fromEntries(
    buildCorosProfileUpdateFields({ hrZoneType: 1 }, profile)
  ),
  {
    hrZoneType: "1",
    maxHr: "190",
    maxHrZone: JSON.stringify([{ index: 0, ratio: 50 }]),
    hasHrCalibrated: "1"
  }
);
assert.deepEqual(
  Object.fromEntries(
    buildCorosProfileUpdateFields({ hrZoneType: 2 }, profile)
  ),
  {
    hrZoneType: "2",
    maxHr: "190",
    rhr: "52",
    rhrZone: JSON.stringify([{ index: 0, ratio: 59 }])
  }
);
assert.deepEqual(
  Object.fromEntries(
    buildCorosProfileUpdateFields({ hrZoneType: 3 }, profile)
  ),
  {
    hrZoneType: "3",
    lthr: "168",
    lthrZone: JSON.stringify([{ index: 0, ratio: 80 }]),
    hasHrCalibrated: "1"
  }
);

// A max-HR edit in the same patch becomes the anchor the zones are rebuilt on.
assert.deepEqual(
  Object.fromEntries(
    buildCorosProfileUpdateFields({ hrZoneType: 2, maxHr: 188, restingHr: 50 }, profile)
  ),
  {
    hrZoneType: "2",
    maxHr: "188",
    rhr: "50",
    rhrZone: JSON.stringify([{ index: 0, ratio: 59 }])
  }
);

assert.throws(
  () => buildCorosProfileUpdateFields({ hrZoneType: 0 }, profile),
  /HR zone model must be 1 \(max heart rate\), 2 \(heart-rate reserve\) or 3 \(lactate threshold\)/
);
// An account with no zones on file cannot be switched into that model.
assert.throws(
  () => buildCorosProfileUpdateFields({ hrZoneType: 3 }, empty),
  /COROS needs a lactate threshold heart rate/
);

// Only the keys present in the patch are sent, so untouched values stay put.
assert.deepEqual(
  Object.fromEntries(buildCorosProfileUpdateFields({ weightKg: 68 }, profile)),
  { weight: "68" }
);
assert.equal(buildCorosProfileUpdateFields({}, profile).size, 0);

// Bounds come from the account's own zoneData ranges.
assert.throws(
  () => buildCorosProfileUpdateFields({ weightKg: 400 }, profile),
  /Weight must be between 10 and 300/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ maxHr: 300 }, profile),
  /Max heart rate must be between 120 and 240/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ restingHr: 10 }, profile),
  /Resting heart rate must be between 30 and 120/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ statureCm: 400 }, profile),
  /Height must be between 50 and 280/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ birthday: 19940230 }, profile),
  /real date in YYYYMMDD form/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ birthday: 21000101 }, profile),
  /real date in YYYYMMDD form/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ nickname: "   " }, profile),
  /Nickname must be 1-64 characters/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ nickname: "n".repeat(65) }, profile),
  /Nickname must be 1-64 characters/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ unit: 2 }, profile),
  /Unit must be 0 or 1/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ sex: 3 }, profile),
  /Sex must be 0 or 1/
);
assert.throws(
  () => buildCorosProfileUpdateFields({ weightKg: Number.NaN }, profile),
  /Enter a number for Weight/
);

// With no server ranges (a stripped account), the built-in bounds apply.
assert.throws(
  () => buildCorosProfileUpdateFields({ maxHr: 300 }, empty),
  /Max heart rate must be between 120 and 240/
);
assert.equal(
  buildCorosProfileUpdateFields({ maxHr: 185 }, empty).get("maxHr"),
  "185"
);

console.log("coros profile tests passed");
