// A run's or ride's training label: what `electron/sessionIntensity.ts` reads
// out of a detail (seconds by heart-rate and pace zone after the warm-up, and
// the reps of a repeat session — a structured workout's or laps pressed by
// hand), and how `src/training/trainingBenefit.ts` names it after Daniels' and
// Seiler's definitions. A list row and the page it opens both go through these
// two functions, so what they answer is the whole contract.
//
// Launched through Electron rather than plain node because the modules are
// TypeScript and a distro Node built without Amaro cannot strip them.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) => import(pathToFileURL(path.join(root, file)).href + bust);
const { summarizeSessionIntensity, sportHasTrainingBenefit, WARM_UP_SECONDS } = await load(
  "electron/sessionIntensity.ts"
);
const { trainingBenefit, benefitZoneFamily, MIN_BENEFIT_SECONDS } = await load(
  "src/training/trainingBenefit.ts"
);

const min = (m) => m * 60;
const RUN = 100;
const TREADMILL = 101;
const TRAIL = 102;
const RIDE = 200;

// A heart-rate-reserve account's ceilings (133/154/168/173/183) and the pace
// zones COROS scored one of its runs on, threshold pace 5:22/km.
const hrZones = [
  { index: 0, high: 133 },
  { index: 1, low: 134, high: 154 },
  { index: 2, low: 155, high: 168 },
  { index: 3, low: 169, high: 173 },
  { index: 4, low: 174, high: 183 },
  { index: 5, low: 184, high: 255 }
];
const paceZones = [
  { index: 0, low: 465 },
  { index: 1, low: 393, high: 465 },
  { index: 2, low: 352, high: 393 },
  { index: 3, low: 323, high: 352 },
  { index: 4, low: 317, high: 323 },
  { index: 5, low: 285, high: 317 },
  { index: 6, high: 285 }
];

/** One sample a second, each stretch `[seconds, hr, pace]`. */
function series(...stretches) {
  const points = [];
  let elapsed = 0;
  for (const [seconds, hr, pace] of stretches) {
    for (let at = 0; at < seconds; at += 1) {
      points.push({ elapsed, hr, pace, adjustedPace: pace });
      elapsed += 1;
    }
  }
  return points;
}

const lap = (phase, distance, duration, avgHr) => ({
  index: 0,
  ...(phase ? { phase } : {}),
  distance,
  duration,
  avgHr
});

const detail = (overrides) => ({
  hrZones,
  paceZones,
  laps: [],
  series: [],
  pauses: [],
  duration: 0,
  ...overrides
});

// --- Which sessions are labelled ------------------------------------------

for (const sport of [100, 101, 102, 103, 200, 201, 203, 204, 299]) {
  assert.equal(sportHasTrainingBenefit(sport), true, `sport ${sport} is labelled`);
}
// E-bike, hike, mountain climb, strength, swim, nothing.
for (const sport of [202, 205, 104, 105, 400, 402, 300, undefined]) {
  assert.equal(sportHasTrainingBenefit(sport), false, `sport ${sport} is not labelled`);
  assert.equal(summarizeSessionIntensity(detail({ sportType: sport }), sport), undefined);
}

// --- Seconds after the warm-up, by heart rate and by pace together -----------

{
  // 30 minutes at 150 bpm and 6:40/km: Aerobic Endurance on both.
  const intensity = summarizeSessionIntensity(
    detail({ series: series([min(30), 150, 400]), duration: min(30) }),
    RUN
  );
  assert.equal(intensity.seconds, min(30));
  assert.equal(WARM_UP_SECONDS, min(10));
  assert.deepEqual(intensity.hr, [0, min(20), 0, 0, 0, 0], "the first ten minutes are not counted");
  assert.equal(intensity.joint[1][1], min(20));
  assert.equal(intensity.reps, undefined);
}
{
  // A pause is not activity time: the warm-up ends ten minutes of running in.
  const points = series([min(15), 150, 400]).map((point) =>
    point.elapsed >= min(5) ? { ...point, elapsed: point.elapsed + min(5) } : point
  );
  const intensity = summarizeSessionIntensity(
    detail({ series: points, pauses: [{ start: min(5), duration: min(5) }], duration: min(15) }),
    RUN
  );
  assert.equal(intensity.hr[1], min(5));
}
{
  // A standing second has no pace to band, so a paced run does not count it.
  const intensity = summarizeSessionIntensity(
    detail({ series: series([min(10), 150, 400], [min(5), 150, 1500], [min(5), 150, 400]) }),
    RUN
  );
  assert.equal(intensity.joint[1][1], min(5));
}
{
  // A treadmill and a ride are read on heart rate alone.
  for (const sport of [TREADMILL, RIDE]) {
    const intensity = summarizeSessionIntensity(detail({ series: series([min(20), 160, 400]) }), sport);
    assert.equal(intensity.joint, undefined, `sport ${sport}: no pace`);
    assert.equal(intensity.hr[2], min(10));
  }
}
{
  // A trail run is banded on grade-adjusted pace, against those zones.
  const points = series([min(20), 160, 400]).map((point) => ({ ...point, pace: 700 }));
  const intensity = summarizeSessionIntensity(
    detail({ series: points, adjustedPaceZones: paceZones }),
    TRAIL
  );
  assert.equal(intensity.joint[2][1], min(10), "adjusted pace 6:40 is Aerobic Endurance");
}

// --- Reps: a structured workout's steps --------------------------------------

{
  // 3 × 8 minutes, each step split by a 1 km auto-lap, a lone work lap after the cool-down.
  const laps = [
    lap("warmup", 1000, 434, 137),
    lap("warmup", 1000, 429, 150),
    lap("work", 1000, 352, 161),
    lap("work", 373, 128, 166),
    lap("recovery", 401, 180, 161),
    lap("work", 1000, 350, 166),
    lap("work", 379, 130, 167),
    lap("recovery", 409, 180, 163),
    lap("work", 1000, 351, 166),
    lap("work", 372, 129, 169),
    lap("recovery", 416, 180, 164),
    lap("cooldown", 1000, 398, 165),
    lap("work", 94, 34, 172)
  ];
  const intensity = summarizeSessionIntensity(detail({ laps, duration: min(64) }), RUN);
  assert.equal(intensity.repSource, "workout");
  assert.deepEqual(
    intensity.reps.map((rep) => rep.seconds),
    [480, 480, 480],
    "a step is its laps added up; the work lap after the cool-down is no rep"
  );
  assert.equal(intensity.reps[0].paceBucket, 3, "5:48/km is in the Threshold pace zone");
  assert.equal(intensity.reps[0].hrBucket, 2);
}
{
  // A long run's one work block has no recovery beside it: no reps.
  const laps = [lap("warmup", 1000, 480, 140), ...Array.from({ length: 12 }, () => lap("work", 1000, 480, 152))];
  assert.equal(summarizeSessionIntensity(detail({ laps }), RUN).reps, undefined);
}
{
  // Strides after an easy run: the 7 km before the first recovery is the run, not a rep.
  const laps = [
    lap("work", 7000, 3300, 154),
    ...Array.from({ length: 5 }, () => [lap("recovery", 110, 90, 142), lap("work", 100, 30, 140)]).flat(),
    lap("cooldown", 500, 354, 131)
  ];
  const intensity = summarizeSessionIntensity(detail({ laps }), RUN);
  assert.deepEqual(intensity.reps.map((rep) => rep.seconds), [30, 30, 30, 30, 30]);
}

// --- Reps: laps pressed by hand ------------------------------------------------

{
  // Fast 230 m, walked back: the laps alternate and the fast set is far quicker.
  const laps = [
    lap(undefined, 213, 65, 140),
    lap(undefined, 258, 200, 139),
    lap(undefined, 238, 69, 126),
    lap(undefined, 265, 198, 125),
    lap(undefined, 235, 64, 135),
    lap(undefined, 285, 212, 123),
    lap(undefined, 230, 53, 137),
    lap(undefined, 204, 157, 142),
    lap(undefined, 668, 523, 133)
  ];
  const intensity = summarizeSessionIntensity(detail({ laps }), RUN);
  assert.equal(intensity.repSource, "manual");
  assert.equal(intensity.reps.length, 4);
  assert.ok(intensity.reps.every((rep) => rep.paceBucket >= 5), "every rep at I pace or faster");
  // On a treadmill or a ride, pressed laps are not read.
  assert.equal(summarizeSessionIntensity(detail({ laps }), TREADMILL).reps, undefined);
  assert.equal(summarizeSessionIntensity(detail({ laps }), RIDE).reps, undefined);
}
{
  // Auto-laps of 1 km, however the pace moves, are the watch's.
  const laps = Array.from({ length: 10 }, (_, at) => lap(undefined, 1000, at % 2 ? 300 : 420, 150));
  assert.equal(summarizeSessionIntensity(detail({ laps }), RUN).reps, undefined);
}
{
  // Laps pressed by hand at one steady pace are not reps.
  const laps = Array.from({ length: 8 }, () => lap(undefined, 1500, 600, 150));
  assert.equal(summarizeSessionIntensity(detail({ laps }), RUN).reps, undefined);
}

// --- Naming it --------------------------------------------------------------------

/** An intensity by hand: `joint` cells as `[hrBucket, paceBucket, seconds]`. */
function steady(seconds, cells, extra = {}) {
  const joint = Array.from({ length: 6 }, () => new Array(7).fill(0));
  const hr = new Array(6).fill(0);
  for (const [h, p, s] of cells) {
    joint[h][p] += s;
    hr[h] += s;
  }
  return { version: 1, seconds, hr, joint, ...extra };
}
const label = (intensity, sport = RUN, family = "restingHr") => trainingBenefit(sport, intensity, family);

assert.equal(
  trainingBenefit(RUN, steady(min(60), [[1, 1, min(50)]]), undefined),
  undefined,
  "the model not known yet"
);
assert.equal(label(steady(MIN_BENEFIT_SECONDS - 1, [[1, 1, 60]])), undefined, "under ten minutes");
assert.equal(label(undefined), undefined, "no intensity read yet");
assert.equal(label(steady(min(60), [[1, 1, min(50)]]), 104), undefined, "a hike");

{
  // A hot easy run: heart rate in Aerobic Power at an easy pace is easy running.
  const reading = label(steady(min(78), [[2, 1, min(40)], [1, 1, min(28)]]));
  assert.equal(reading.primary, "aerobic");
  assert.equal(reading.basis.measure, "both");
  assert.equal(Math.round(reading.basis.share * 100), 100);
}
{
  // Tempo only when it is the session: half of it at least.
  assert.equal(label(steady(min(70), [[2, 2, min(34)], [1, 1, min(26)]])).primary, "tempo");
  assert.equal(label(steady(min(80), [[2, 2, min(30)], [1, 1, min(40)]])).primary, "aerobic");
}
{
  const reading = label(steady(min(60), [[3, 3, min(25)], [1, 1, min(25)]]));
  assert.equal(reading.primary, "threshold", "Daniels' twenty minutes at T");
  assert.equal(reading.basis.seconds, min(25));
  assert.equal(label(steady(min(60), [[3, 3, min(15)], [1, 1, min(35)]])).primary, "aerobic");
}
{
  assert.equal(label(steady(min(25), [[4, 5, min(12)], [3, 3, min(3)]])).primary, "vo2max", "a 5K race");
  assert.notEqual(
    label(steady(min(120), [[4, 5, min(9)], [1, 1, min(100)]])).primary,
    "vo2max",
    "a hard finish to a long run is not a VO2 Max session"
  );
}
assert.equal(label(steady(min(30), [[5, 6, min(5)], [1, 1, min(15)]])).primary, "anaerobic");
{
  assert.equal(label(steady(min(28), [[0, 0, min(15)], [1, 1, min(3)]])).primary, "recovery");
  assert.equal(
    label(steady(min(60), [[0, 0, min(45)], [1, 1, min(5)]])).primary,
    "aerobic",
    "a recovery run is short"
  );
}
{
  // Off a paced run, heart rate alone; Max HR's buckets sit a step easier.
  const hrOnly = { version: 1, seconds: min(40), hr: [0, 0, min(30), 0, 0, 0] };
  assert.equal(label(hrOnly, RIDE).primary, "tempo");
  assert.equal(label(hrOnly, RIDE, "maxHr").primary, "aerobic");
  assert.equal(label(hrOnly, RIDE, null).primary, "tempo", "no model named reads as reserve");
  assert.equal(label(hrOnly, RIDE).basis.measure, "hr");
}

// --- Naming a repeat session -------------------------------------------------------

const reps = (count, rep) => Array.from({ length: count }, () => ({ ...rep }));
const easyBody = [[1, 1, min(30)]];
{
  const reading = label(steady(min(64), easyBody, { reps: reps(3, { seconds: 480, meters: 1380, hrBucket: 2, paceBucket: 3 }) }));
  assert.equal(reading.primary, "threshold", "3 × 8′ at Threshold pace, 24 minutes of T");
  assert.deepEqual(reading.basis, { kind: "reps", count: 3, measure: "pace" });
  assert.deepEqual(reading.format, { kind: "intervals", count: 3, size: { unit: "seconds", value: 480 } });
}
assert.equal(
  label(steady(min(64), easyBody, { reps: reps(3, { seconds: 480, meters: 1300, hrBucket: 2, paceBucket: 2 }) })).primary,
  "tempo"
);
{
  // 6 × 1 km at I pace: the distance is what the reps hold to.
  const intensity = steady(min(60), easyBody, {
    reps: [235, 228, 240, 232, 238, 226].map((seconds) => ({ seconds, meters: 1000, paceBucket: 5 }))
  });
  const reading = label(intensity);
  assert.equal(reading.primary, "vo2max");
  assert.deepEqual(reading.format.size, { unit: "meters", value: 1000 });
}
{
  // Short reps at I pace or faster are R reps: Anaerobic.
  const reading = label(steady(min(28), [[0, 0, min(15)]], { reps: reps(5, { seconds: 64, meters: 230, paceBucket: 5 }) }));
  assert.equal(reading.primary, "anaerobic");
}
{
  // Off pace, a rep is read on heart rate.
  const reading = label(steady(min(60), easyBody, { reps: reps(4, { seconds: 600, meters: 0, hrBucket: 3 }) }), RIDE);
  assert.equal(reading.primary, "threshold");
  assert.equal(reading.basis.measure, "hr");
}
{
  // Strides: an easy run's label, and the strides said in seconds.
  const reading = label(steady(min(70), easyBody, { reps: reps(5, { seconds: 22, meters: 61, paceBucket: 6 }) }));
  assert.equal(reading.primary, "aerobic");
  assert.deepEqual(reading.format, { kind: "strides", count: 5, size: { unit: "seconds", value: 22 } });
}
{
  // Pick-ups too short to decide anything: a long run stays a long run.
  const pickUps = reps(3, { seconds: 48, meters: 216, paceBucket: 6 });
  const longRun = label(steady(min(107), easyBody, { reps: pickUps }));
  assert.equal(longRun.primary, "aerobic");
  assert.deepEqual(longRun.format, { kind: "long", ride: false });
  // On a shorter run they are what there is to say.
  assert.equal(label(steady(min(50), easyBody, { reps: pickUps })).format.kind, "intervals");
}
{
  assert.deepEqual(label(steady(min(95), easyBody)).format, { kind: "long", ride: false });
  assert.equal(label(steady(min(95), easyBody), RIDE).format, undefined, "a ride is long at three hours");
  assert.deepEqual(label(steady(min(185), easyBody), RIDE).format, { kind: "long", ride: true });
}

// --- Waiting for the account's model -----------------------------------------

assert.equal(benefitZoneFamily({ settled: false, model: null }), undefined);
assert.equal(benefitZoneFamily({ settled: true, model: null }), null);
assert.equal(benefitZoneFamily({ settled: true, model: { family: "maxHr" } }), "maxHr");

console.log("test:training-benefit passed");
