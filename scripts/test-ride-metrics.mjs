// The Cycling screen's arithmetic, the speed reading of the shared channel
// chart that its ride page opens on, and what the ride page reads out of the
// samples: power (NP, IF, TSS, peaks, zones), top speed and the climbs.
//
// Runs under Electron for the reason test-run-metrics does: this repo's Node is
// built without Amaro and cannot strip types, and the module graph has
// extensionless imports, so the resolver hook comes along too.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const moduleUrl = (...parts) =>
  `${pathToFileURL(path.join(repoRoot, "src", ...parts)).href}${bust}`;

const {
  RIDE_TYPES,
  classifyRideType,
  isOutdoorRideType,
  isRideSportType,
  ridesOfType,
  ridesOnly
} = await import(moduleUrl("cycling", "rideType.ts"));

const {
  buildRideWeeks,
  rideLoadBalance,
  rideTypeBreakdown,
  rideTypesPresent,
  rideWindowStartMs,
  speedKmh,
  summariseRides,
  totalsSpeedKmh
} = await import(moduleUrl("cycling", "rideMetrics.ts"));

const { intensityMix, runIntensityMix, runWindowStartMs } = await import(
  moduleUrl("running", "runMetrics.ts")
);

const {
  availableActivityChannels,
  defaultSelectedChannels,
  withSpeed
} = await import(moduleUrl("training", "activityChannels.ts"));

const {
  climbCategory,
  powerZoneBounds,
  powerZoneTime,
  rideClimbs,
  rideLoadFromPower,
  rideMaxSpeedKmh,
  ridePower
} = await import(moduleUrl("cycling", "rideAnalysis.ts"));

// 14 Sep 2026 is a Monday; fixtures are local time because weeks are.
const NOW = new Date(2026, 8, 14, 12, 0, 0).getTime();
const MS_PER_DAY = 86_400_000;
const secondsAgo = (days) => Math.floor((NOW - days * MS_PER_DAY) / 1000);

let nextId = 0;
const ride = (overrides = {}) => ({
  activityId: `r-${(nextId += 1)}`,
  sportType: 200,
  startTime: secondsAgo(1),
  duration: 3600,
  distance: 30_000,
  avgHr: 140,
  trainingLoad: 80,
  elevationGain: 300,
  ...overrides
});

const run = (overrides = {}) => ride({ sportType: 100, distance: 10_000, ...overrides });

// ---------------------------------------------------------------------------
// Kinds of ride. Every bike code COROS has is a ride, e-bikes included, and
// nothing that is not a bike is.
// ---------------------------------------------------------------------------

assert.equal(classifyRideType(200), "road");
assert.equal(classifyRideType(201), "indoor");
assert.equal(classifyRideType(202), "ebike", "a road e-bike is an e-bike, not a road ride");
assert.equal(classifyRideType(203), "gravel");
assert.equal(classifyRideType(204), "mountain");
assert.equal(classifyRideType(205), "ebike", "a mountain e-bike is an e-bike too");
assert.equal(classifyRideType(299), "road", "a helmet-recorded ride is an ordinary outdoor ride");
assert.equal(classifyRideType(100), null, "a run is not a ride");
assert.equal(classifyRideType(undefined), null);
assert.equal(isRideSportType(203), true);
assert.equal(isRideSportType(104), false, "a hike is not a ride");
assert.deepEqual(RIDE_TYPES, ["road", "gravel", "mountain", "indoor", "ebike"]);
assert.equal(isOutdoorRideType("indoor"), false);
assert.equal(isOutdoorRideType("gravel"), true);

{
  const mixed = [ride(), run(), ride({ sportType: 204 }), ride({ sportType: 402 })];
  assert.equal(ridesOnly(mixed).length, 2, "runs and strength are left out");
  assert.equal(ridesOfType(mixed, "mountain").length, 1);
  assert.equal(ridesOfType(mixed, null).length, 2);
}

// ---------------------------------------------------------------------------
// Speed. A ride with no distance is not a 0 km/h ride.
// ---------------------------------------------------------------------------

assert.equal(speedKmh({ distance: 30_000, duration: 3600 }), 30);
assert.equal(speedKmh({ distance: 0, duration: 3600 }), undefined, "a trainer that measured nothing has no speed");
assert.equal(speedKmh({ distance: 30_000, duration: 0 }), undefined);
assert.equal(speedKmh({ distance: 30_000 }), undefined);

// ---------------------------------------------------------------------------
// Totals. The time a speed is taken over is only the time that recorded a
// distance; the hour on the trainer is still riding time.
// ---------------------------------------------------------------------------

{
  const totals = summariseRides([
    ride({ distance: 30_000, duration: 3600, elevationGain: 400 }),
    ride({ sportType: 201, distance: 0, duration: 3600, elevationGain: 0 }),
    run()
  ]);
  assert.equal(totals.count, 2, "the run is not counted");
  assert.equal(totals.duration, 7200, "the trainer hour is riding time");
  assert.equal(totals.distanceDuration, 3600, "but not time a speed can be taken over");
  assert.equal(totals.elevationGain, 400);
  assert.equal(totalsSpeedKmh(totals), 30, "the trainer does not halve the average speed");
  assert.equal(totalsSpeedKmh(summariseRides([])), undefined);
}

// ---------------------------------------------------------------------------
// Weeks: no gaps, Monday starts, per-kind volumes in all three measures, and
// the week's biggest ride by each.
// ---------------------------------------------------------------------------

{
  const weeks = buildRideWeeks(
    [
      ride({ startTime: secondsAgo(1), distance: 40_000, duration: 5400, elevationGain: 900 }),
      ride({ startTime: secondsAgo(2), sportType: 204, distance: 20_000, duration: 7200, elevationGain: 600 }),
      ride({ startTime: secondsAgo(9), sportType: 201, distance: 25_000, duration: 3600, elevationGain: 0 }),
      ride({ startTime: secondsAgo(60) }),
      run({ startTime: secondsAgo(1) })
    ],
    { weeks: 3, nowMs: NOW }
  );

  assert.equal(weeks.length, 3, "one bucket per week, empty ones included");
  assert.ok(weeks[0].weekStartMs < weeks[1].weekStartMs, "oldest first");
  for (const week of weeks) {
    assert.equal(new Date(week.weekStartMs).getDay(), 1, "every week starts on a Monday");
  }
  // NOW is a Monday, so this week holds nothing yet.
  assert.equal(weeks[2].count, 0, "a week with no ride is a zero bar, not a missing one");

  // Sunday 13 Sep and Saturday 12 Sep are the week before NOW's Monday.
  const lastWeek = weeks[1];
  assert.equal(lastWeek.count, 2);
  assert.equal(lastWeek.distance, 60_000);
  assert.equal(lastWeek.duration, 12_600);
  assert.equal(lastWeek.byType.road.distance, 40_000);
  assert.equal(lastWeek.byType.mountain.duration, 7200);
  assert.equal(lastWeek.byType.mountain.elevationGain, 600);
  assert.equal(lastWeek.longestRideMeters, 40_000, "longest by distance is the road ride");
  assert.equal(lastWeek.longestRideSeconds, 7200, "longest by time is the mountain ride");
  assert.equal(lastWeek.biggestClimbMeters, 900);

  // Saturday 5 Sep is in the week of Monday 31 Aug, the oldest bucket; the ride
  // sixty days back is outside all three and counted nowhere.
  const earliest = weeks[0];
  assert.equal(earliest.count, 1, "a ride before the window is not counted");
  assert.equal(earliest.byType.indoor.duration, 3600, "the indoor ride lands in its own week");
  assert.equal(earliest.byType.road.duration, 0);
}

assert.equal(
  rideWindowStartMs(4, NOW),
  runWindowStartMs(4, NOW),
  "the two sport screens cut a period at the same Monday"
);

// ---------------------------------------------------------------------------
// Load ratio: riding load only, the thin-history flag from the whole list.
// ---------------------------------------------------------------------------

{
  const balance = rideLoadBalance(
    [
      ride({ startTime: secondsAgo(2), trainingLoad: 200 }),
      ride({ startTime: secondsAgo(10), trainingLoad: 100 }),
      ride({ startTime: secondsAgo(20), trainingLoad: 100 }),
      run({ startTime: secondsAgo(1), trainingLoad: 500 }),
      ride({ startTime: secondsAgo(40), trainingLoad: 999 })
    ],
    NOW
  );
  assert.equal(balance.acute, 200, "the run's load is not riding load");
  assert.equal(balance.chronic, 100, "four weeks of ride load, per week");
  assert.equal(balance.ratio, 2);
  assert.ok(Math.abs(balance.oldestRideDaysAgo - 40) < 0.01, "measured over the whole list");
  assert.equal(rideLoadBalance([run()], NOW).ratio, undefined);
}

// ---------------------------------------------------------------------------
// Kinds present and the per-kind table.
// ---------------------------------------------------------------------------

{
  const list = [
    ride({ sportType: 201, distance: 0, duration: 3600, elevationGain: 0 }),
    ride({ sportType: 200, distance: 60_000, duration: 7200, elevationGain: 600 }),
    ride({ sportType: 204, distance: 15_000, duration: 3600, elevationGain: 450 })
  ];
  assert.deepEqual(rideTypesPresent(list), ["road", "mountain", "indoor"], "render order, not list order");

  const breakdown = rideTypeBreakdown(list);
  assert.deepEqual(breakdown.map((entry) => entry.type), ["road", "mountain", "indoor"]);
  const [road, mountain, indoor] = breakdown;
  assert.equal(road.share, 0.5, "share is of riding time: two hours of four");
  assert.equal(mountain.share, 0.25, "an hour off-road is a quarter of the week, not a sliver of its distance");
  assert.equal(indoor.share, 0.25);
  assert.equal(road.speed, 30);
  assert.equal(mountain.speed, 15);
  assert.equal(indoor.speed, undefined, "a trainer that measured nothing has no speed");
  assert.equal(road.elevationPerKm, 10);
  assert.equal(mountain.elevationPerKm, 30);
  assert.equal(indoor.elevationPerKm, undefined, "no terrain indoors, so no climb figure rather than zero");
}

// ---------------------------------------------------------------------------
// Intensity: one banding for every sport. A ride's time in zone is read the way
// a run's is; the run-only entry point still leaves rides out.
// ---------------------------------------------------------------------------

{
  const scale = {
    family: "lthr",
    zones: [
      { index: 1, hr: 133 },
      { index: 2, hr: 154 },
      { index: 3, hr: 168 },
      { index: 4, hr: 173 },
      { index: 5, hr: 183 },
      { index: 6, hr: 404 }
    ]
  };
  const timed = ride({ activityId: "timed", duration: 3600, avgHr: 160 });
  const summaries = new Map([
    ["timed", { activityId: "timed", zoneSeconds: [0, 1800, 0, 1800, 0, 0] }]
  ]);
  const mix = intensityMix([timed], scale, summaries);
  assert.equal(mix.zoneTimed, 1, "the ride is split by its own time in zone");
  assert.equal(mix.easy.duration, 1800);
  assert.equal(mix.hard.duration, 1800);
  assert.equal(runIntensityMix([timed], scale, summaries).zoneTimed, 0, "Running's mix still counts runs only");

  const byAverage = intensityMix([ride({ avgHr: 120 }), ride({ avgHr: undefined })], scale);
  assert.equal(byAverage.easy.count, 1);
  assert.equal(byAverage.unrated.count, 1, "a ride with no heart rate is left out, not guessed");
}

// ---------------------------------------------------------------------------
// The channel chart, read as a ride: speed from pace, never beside it.
// ---------------------------------------------------------------------------

{
  const series = [
    { elapsed: 0, pace: 120, hr: 120, power: 200, altitude: 10 },
    { elapsed: 1, pace: 0, hr: 121, power: 210, altitude: 12 },
    { elapsed: 2, hr: 122, power: 205, altitude: 40 },
    { elapsed: 3, pace: 144, hr: 123, power: 190, altitude: 30 }
  ];
  const withIt = withSpeed(series);
  assert.equal(withIt[0].speed, 30, "120 s/km is 30 km/h");
  assert.equal(withIt[1].speed, undefined, "a stopped sample gets no speed rather than a zero");
  assert.equal(withIt[2].speed, undefined);
  assert.equal(withIt[3].speed, 25);
  assert.equal(series[0].speed, undefined, "the series handed in is not written to");

  const asRide = availableActivityChannels(withIt, "speed").map((channel) => channel.key);
  assert.ok(asRide.includes("speed"), "a ride offers speed");
  assert.ok(!asRide.includes("pace"), "and not pace beside it");
  assert.ok(!asRide.includes("adjustedPace"));

  const asRun = availableActivityChannels(withIt).map((channel) => channel.key);
  assert.ok(asRun.includes("pace"), "a run still offers pace");
  assert.ok(!asRun.includes("speed"), "and never speed");

  const rideChannels = availableActivityChannels(withIt, "speed");
  assert.deepEqual(
    defaultSelectedChannels(rideChannels, "speed"),
    ["power", "hr"],
    "a ride with a power meter opens on power against heart rate"
  );
  const noMeter = availableActivityChannels(
    withIt.map(({ power, ...rest }) => rest),
    "speed"
  );
  assert.deepEqual(
    defaultSelectedChannels(noMeter, "speed"),
    ["hr", "speed"],
    "and one without on heart rate and speed"
  );
  assert.deepEqual(
    defaultSelectedChannels(availableActivityChannels(series)),
    ["pace", "hr"],
    "a run opens as it always has"
  );
}

// --- Power off the samples -------------------------------------------------

{
  // An hour at exactly 200 W: every figure has one right answer.
  const steady = Array.from({ length: 3600 }, (_, t) => ({ elapsed: t, power: 200 }));
  const power = ridePower(steady);
  assert.equal(power.seconds, 3600);
  assert.equal(power.average, 200);
  assert.ok(Math.abs(power.normalized - 200) < 1e-9, "a steady effort normalises to itself");
  assert.equal(power.workKj, 720, "200 W for an hour is 720 kJ");
  assert.deepEqual(
    power.peaks.map((peak) => [peak.label, peak.watts]),
    [["5 s", 200], ["1 min", 200], ["5 min", 200], ["20 min", 200], ["60 min", 200]]
  );

  // At FTP for an hour is IF 1.00 and TSS 100, by definition.
  const atFtp = rideLoadFromPower(power, 200);
  assert.ok(Math.abs(atFtp.intensity - 1) < 1e-9);
  assert.ok(Math.abs(atFtp.stressScore - 100) < 1e-9);
  const easy = rideLoadFromPower(power, 250);
  assert.ok(Math.abs(easy.intensity - 0.8) < 1e-9);
  assert.ok(Math.abs(easy.stressScore - 64) < 1e-9, "IF squared times hours");
  assert.equal(rideLoadFromPower(power, undefined), undefined, "no FTP, no IF");

  // Surges and freewheeling: the same average costs more. Thirty seconds at
  // 400 W and thirty coasting, over and over, averages 200 W — normalised it
  // is well above, which is the whole point of the figure.
  const surging = Array.from({ length: 3600 }, (_, t) => ({
    elapsed: t,
    power: Math.floor(t / 30) % 2 === 0 ? 400 : 0
  }));
  const surged = ridePower(surging);
  assert.equal(surged.average, 200);
  assert.ok(surged.normalized > 240, `surges normalise high (${surged.normalized.toFixed(0)} W)`);
  assert.equal(surged.coastingSeconds, 1800);
  assert.equal(surged.peaks[0].watts, 400, "the best 5 s is a surge");

  // Smart recording: one sample every 3 s is still an hour of 200 W.
  const sparse = ridePower(
    Array.from({ length: 1200 }, (_, index) => ({ elapsed: index * 3, power: 200 }))
  );
  assert.ok(sparse.seconds >= 3598 && sparse.seconds <= 3600, `held between samples (${sparse.seconds})`);
  // A dropout longer than a few seconds is a gap, not the last reading held.
  const dropout = ridePower([
    { elapsed: 0, power: 300 },
    { elapsed: 60, power: 300 },
    { elapsed: 61, power: 300 }
  ]);
  assert.ok(dropout.seconds < 10, "a minute's dropout is not a minute at 300 W");

  assert.equal(ridePower(steady.map(({ elapsed }) => ({ elapsed }))), undefined, "no meter, no power");
  assert.equal(
    ridePower(steady.map(({ elapsed }) => ({ elapsed, power: 0 }))),
    undefined,
    "a meter that read zero throughout never spoke"
  );
}

// --- Power zones: COROS's ceilings, or its default seven off the FTP ---------

{
  // As /account/query sends cyclePowerZone for FTP 180: ceilings, the last a
  // sentinel.
  const own = [100, 135, 162, 189, 216, 270, 900].map((watts, index) => ({ index, watts }));
  const bounds = powerZoneBounds(own, 180);
  assert.equal(bounds.length, 7, "seven zones, Sprint the seventh");
  assert.deepEqual(
    bounds.map((bound) => bound.name),
    ["Recovery", "Aerobic Endurance", "Aerobic Power", "Threshold", "Anaerobic Endurance", "Anaerobic Power", "Sprint"],
    "COROS's names for the power family"
  );
  assert.equal(bounds[0].floor, undefined);
  assert.equal(bounds[0].ceiling, 100);
  assert.equal(bounds[3].floor, 163, "one above the zone below's ceiling");
  assert.equal(bounds[3].ceiling, 189);
  assert.equal(bounds[6].floor, 271);
  assert.equal(bounds[6].ceiling, undefined, "the sentinel is never a bound");

  const fromFtp = powerZoneBounds([], 200);
  assert.deepEqual(
    fromFtp.slice(0, -1).map((bound) => bound.ceiling),
    [112, 150, 180, 210, 240, 300],
    "no zones of its own: COROS's defaults off the FTP"
  );
  assert.equal(powerZoneBounds([], undefined), undefined, "neither: no zones");

  const series = [
    ...Array.from({ length: 60 }, (_, t) => ({ elapsed: t, power: 0 })),
    ...Array.from({ length: 120 }, (_, t) => ({ elapsed: 60 + t, power: 150 })),
    ...Array.from({ length: 60 }, (_, t) => ({ elapsed: 180 + t, power: 189 })),
    ...Array.from({ length: 30 }, (_, t) => ({ elapsed: 240 + t, power: 500 }))
  ];
  const time = powerZoneTime(series, bounds);
  assert.deepEqual(
    time.map((zone) => zone.seconds),
    [0, 0, 120, 60, 0, 0, 30],
    "150 W is Z3 (136–162), a ceiling is inside its zone, and coasting is in none"
  );
}

// --- Top speed ---------------------------------------------------------------

{
  // 30 km/h throughout, with one sample a GPS jump put at 90.
  const series = Array.from({ length: 600 }, (_, t) => ({ elapsed: t, pace: t === 300 ? 40 : 120 }));
  const top = rideMaxSpeedKmh(series);
  assert.ok(top > 30 && top < 45, `one jumped sample is not the top speed (${top.toFixed(1)})`);
  assert.equal(rideMaxSpeedKmh([{ elapsed: 0 }, { elapsed: 1 }]), undefined, "no speed, no top speed");
}

// --- Climbs ------------------------------------------------------------------

{
  assert.equal(climbCategory(1000, 0.08), "4", "a kilometre at 8% is the least that is Cat 4");
  assert.equal(climbCategory(1000, 0.07), undefined, "and a bit less is not a climb");
  assert.equal(climbCategory(13_000, 0.07), "HC", "Tam Đảo is hors catégorie");
  assert.equal(climbCategory(5000, 0.07), "2");

  // Flat, a 4 km climb at 6% with a dip in the middle, a plateau, a descent,
  // then a 600 m ramp at 5% that is too short to earn a category.
  const profile = [];
  let distance = 0;
  let altitude = 20;
  let elapsed = 0;
  const leg = (meters, grade, secondsPerMeter) => {
    for (let step = 0; step < meters; step += 10) {
      profile.push({ elapsed, distance, altitude, hr: 150, power: grade > 0 ? 250 : 120 });
      distance += 10;
      altitude += grade * 10;
      elapsed += 10 * secondsPerMeter;
    }
  };
  leg(2000, 0, 0.12);
  leg(2000, 0.06, 0.4);
  leg(200, -0.02, 0.2);
  leg(2000, 0.06, 0.4);
  leg(1500, 0, 0.12);
  leg(4000, -0.05, 0.08);
  leg(1000, 0, 0.12);
  leg(600, 0.05, 0.4);
  leg(1000, 0, 0.12);
  profile.push({ elapsed, distance, altitude });

  const climbs = rideClimbs(profile);
  assert.equal(
    climbs.length,
    1,
    `one climb, carried through its dip: ${JSON.stringify(climbs.map((climb) => climb.lengthMeters))}`
  );
  const [climb] = climbs;
  assert.ok(Math.abs(climb.startMeters - 2000) <= 150, `starts at the foot (${climb.startMeters})`);
  assert.ok(Math.abs(climb.endMeters - 6200) <= 150, `tops out at the top (${climb.endMeters})`);
  assert.ok(Math.abs(climb.gainMeters - 236) <= 15, `gain (${climb.gainMeters.toFixed(0)})`);
  assert.ok(climb.grade > 0.05 && climb.grade < 0.062, `average grade (${(climb.grade * 100).toFixed(1)}%)`);
  assert.ok(
    climb.maxGrade >= 0.055 && climb.maxGrade <= 0.065,
    `steepest 200 m (${(climb.maxGrade * 100).toFixed(1)}%)`
  );
  assert.equal(climb.category, "3", "4 km at 5.7% is Cat 3");
  assert.ok(Math.abs(climb.seconds - 1640) <= 90, `time on it (${climb.seconds})`);
  assert.ok(Math.abs(climb.vam - (climb.gainMeters / climb.seconds) * 3600) < 1e-9, "VAM is metres an hour");
  assert.ok(climb.avgPower > 200, "power on the climb is the climb's");
  assert.equal(climb.avgHr, 150);

  assert.deepEqual(rideClimbs(profile.map(({ altitude: _altitude, ...rest }) => rest)), [], "no altitude, no climbs");
  assert.deepEqual(
    rideClimbs(profile.map((point) => ({ ...point, altitude: 12 }))),
    [],
    "a flat ride has none"
  );
}

console.log("ride metrics: OK");
