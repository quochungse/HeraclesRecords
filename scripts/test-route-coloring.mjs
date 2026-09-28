// The route replay and the full map's colouring: the arithmetic under the
// animation, Performance's zones, ramps and elevation stops, and the
// Heatmap's pass count, bands and averaged line. None of it
// type-checks into correctness — a replay at the wrong pace, a ramp flattened
// by one stop, a lap counted as one pass all draw a perfectly good map.
//
// Mode: renderer TypeScript whose imports carry explicit extensions or are
// type-only. Run through Electron because a distro Node built without Amaro
// cannot strip types.
//   cross-env ELECTRON_RUN_AS_NODE=1 electron --experimental-strip-types \
//     scripts/test-route-coloring.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) =>
  import(`${pathToFileURL(path.join(repoRoot, file)).href}?cacheBust=${Date.now()}`);

const replayModule = await load("src/training/components/routeReplay.ts");
const smoothing = await load("src/training/components/routeSmoothing.ts");
const coloring = await load("src/training/components/routeColoring.ts");
const { buildRouteReplay, replayDurationMs, replayHead, replayPath } = replayModule;

const METERS_PER_DEGREE_LAT = 111_195;

/** A straight run north: `legs` of [points, metres per point, seconds per point]. */
function northward(legs, { lat = 21, lon = 105 } = {}) {
  const points = [];
  let t = 0;
  for (const [count, meters, seconds] of legs) {
    for (let index = 0; index < count; index += 1) {
      points.push({ lat, lon, elapsed: t });
      lat += meters / METERS_PER_DEGREE_LAT;
      t += seconds;
    }
  }
  return points;
}

// --- Replay length ---------------------------------------------------------
assert.equal(replayDurationMs(500), 1000, "a short route has the floor");
assert.equal(replayDurationMs(2000), 1400, "2 km in 1.4 s");
assert.equal(replayDurationMs(5000), 2600, "5 km in 2.6 s");
assert.equal(replayDurationMs(42_195), 4000, "a marathon hits the 4 s ceiling");

// --- Replay pace -----------------------------------------------------------
// 1 km fast (10 m a second), then a 120 s pause, then 1 km slow (5 m a second).
{
  const fast = northward([[100, 10, 1]]);
  const last = fast[fast.length - 1];
  const slow = northward([[201, 5, 1]], { lat: last.lat + 10 / METERS_PER_DEGREE_LAT }).map(
    (point) => ({ ...point, elapsed: point.elapsed + last.elapsed + 121 })
  );
  const replay = buildRouteReplay([...fast, ...slow]);
  assert.ok(Math.abs(replay.meters - 2000) < 20, `about 2 km: ${replay.meters}`);
  assert.ok(
    Math.abs(replay.clock[99] - 99 / 300) < 0.01,
    `the fast kilometre takes its third of the moving time: ${replay.clock[99]}`
  );
  const step = replay.clock[2] - replay.clock[1];
  assert.ok(
    Math.abs(replay.clock[100] - replay.clock[99] - step) < 1e-9,
    "the pause is replayed as one ordinary step, not 120"
  );

  const untimed = buildRouteReplay([...fast, ...slow].map(({ elapsed, ...point }) => point));
  assert.ok(Math.abs(untimed.clock[99] - 0.5) < 0.01, "with no clock, half the distance is half the replay");

  assert.deepEqual(replayHead(replay, 0), { index: 0, fraction: 0, point: replay.latLngs[0] });
  assert.equal(replayPath(replay, 1), replay.latLngs, "the whole route at the end");
  const halfway = (replay.clock[50] + replay.clock[51]) / 2;
  const head = replayHead(replay, halfway);
  assert.equal(head.index, 50);
  assert.ok(head.point[0] > replay.latLngs[50][0] && head.point[0] < replay.latLngs[51][0], "the head is between its two points");
}

// --- Performance -----------------------------------------------------------
{
  // 400 points 10 s apart; the series is one sample a second, pace 360 s/km in
  // the first half and 300 in the second, with one 40-minute "pace" (a stop).
  const points = northward([[400, 30, 10]]).map((point, index) => ({
    ...point,
    elevation: index < 200 ? 10 : 10.5
  }));
  const series = Array.from({ length: 4000 }, (_, t) => ({
    elapsed: t,
    pace: t === 1000 ? 2400 : t < 2000 ? 360 : 300,
    hr: 140 + Math.floor(t / 400)
  }));
  const replay = buildRouteReplay(points);

  const pace = coloring.performanceColoring(replay, series, "pace");
  assert.equal(pace.low, 360, "the weak end is the slower pace");
  assert.equal(pace.high, 300, "the strong end is the faster pace");
  assert.equal(pace.steps[10], 0, "the slow half takes the weakest step");
  assert.equal(pace.steps[300], coloring.RAMP_STEPS - 1, "the fast half the strongest");
  assert.ok(
    pace.steps.every((step) => step !== null),
    "a stop's absurd pace is dropped, not a hole or a new end of the ramp"
  );

  const hr = coloring.performanceColoring(replay, series, "hr");
  assert.ok(hr.steps[0] < hr.steps[398], "heart rate climbs the ramp as it rises");

  const heights = coloring.elevationColoring(replay);
  assert.equal(heights[10], 10, "a stretch's height is its points' mean");
  assert.equal(heights[300], 10.5);

  assert.equal(coloring.performanceColoring(replay, [], "pace"), null, "no pace recorded, no colouring");
  const untimed = buildRouteReplay(points.map(({ elapsed, ...point }) => point));
  assert.equal(
    coloring.performanceColoring(untimed, series, "hr"),
    null,
    "a track with no clock cannot be joined to the series"
  );
  assert.notEqual(coloring.elevationColoring(untimed), null, "elevation needs no clock");
  assert.equal(
    coloring.elevationColoring(buildRouteReplay(northward([[10, 30, 10]]))),
    null,
    "a track with no heights has no elevation colouring"
  );
}

// --- Elevation's fixed stops ---------------------------------------------
for (const light of [true, false]) {
  const colors = coloring.elevationColors(light);
  const rgb = (hex) =>
    `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
  assert.equal(colors.length, coloring.ELEVATION_STOPS.length, "a colour per stop");
  coloring.ELEVATION_STOPS.forEach((meters, index) =>
    assert.equal(coloring.elevationColor(meters, light), rgb(colors[index]), `${meters} m is its stop's colour`)
  );
  assert.equal(coloring.elevationColor(-20, light), rgb(colors[0]), "below sea level is the lowest colour");
  assert.equal(coloring.elevationColor(3000, light), rgb(colors.at(-1)), "past the last stop stays red");
  assert.notEqual(coloring.elevationColor(125, light), coloring.elevationColor(0, light), "between stops blends");
}
// Fixed, not per activity: a height reads the same whatever else the run did.
assert.equal(coloring.elevationColor(400, false), coloring.elevationColor(400, false));


// --- Heatmap ---------------------------------------------------------------
{
  // An out-and-back: 1 km north, then back down the same path 4 m to the side.
  const out = northward([[101, 10, 3]]);
  const back = out
    .slice(0, -1)
    .reverse()
    .map((point, index) => ({ lat: point.lat, lon: point.lon + 4 / 103_900, elapsed: 303 + index * 3 }));
  const replay = buildRouteReplay([...out, ...back]);
  const heat = coloring.routeHeat(replay);
  assert.equal(heat.most, 2, "an out-and-back passes each spot twice");

  // The turnaround, which the old rule (two readings 100 m apart along the
  // route) counted as one pass for 50 m either side of the tip.
  const tip = 100;
  for (const metresBefore of [20, 30, 50]) {
    const stretch = tip - metresBefore / 10 - 1;
    assert.equal(
      heat.passes[stretch],
      2,
      `${metresBefore} m before the turn is passed on the way out and on the way back`
    );
  }
  // And the heat counts only the passes a replay has reached.
  const outbound = 50;
  assert.equal(coloring.passesBy(heat, outbound, 60), 1, "before the turn, the way out is one pass");
  assert.equal(coloring.passesBy(heat, outbound, 160), 2, "once the way back reaches it, two");

  // The way out is redrawn where the two passes ran on average: 2 m east of
  // itself once the way back has reached it, and where it was before that.
  const eastOf = (latLngs, index) => (latLngs[index][1] - replay.latLngs[index][1]) * 103_900;
  const before = coloring.heatPositions(heat, replay.latLngs, 60);
  assert.ok(Math.abs(eastOf(before, 50)) < 0.01, "one pass so far: the line is where it was run");
  const after = coloring.heatPositions(heat, replay.latLngs, replay.latLngs.length - 2);
  assert.ok(Math.abs(eastOf(after, 50) - 2) < 0.2, `two passes 4 m apart meet in the middle: ${eastOf(after, 50)}`);
  // Ground is drawn once because both passes are laid on the same line: the
  // way back lands on the way out rather than 4 m beside it.
  const wayBack = 200 - 50;
  assert.ok(
    Math.abs(after[wayBack][1] - after[50][1]) * 103_900 < 0.2 &&
      Math.abs(after[wayBack][0] - after[50][0]) * METERS_PER_DEGREE_LAT < 1,
    `the way back lands on the way out: ${((after[wayBack][1] - after[50][1]) * 103_900).toFixed(2)} m apart`
  );
  // Every point is placed, the turnaround and the start included: nothing is
  // left for another pass to draw, so nothing can be left undrawn.
  assert.ok(after.every(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)));

  // A 400 m loop run five times, finishing where it started.
  const loop = [];
  for (let lap = 0; lap < 5; lap += 1) {
    for (let index = 0; index < 40; index += 1) {
      const angle = (index / 40) * Math.PI * 2;
      loop.push({ lat: 21 + (63.7 * Math.sin(angle)) / METERS_PER_DEGREE_LAT, lon: 105 + (63.7 * Math.cos(angle)) / 103_900 });
    }
  }
  const laps = coloring.routeHeat(buildRouteReplay(loop));
  assert.equal(laps.most, 5, "five laps are five passes, the start line included");
  assert.equal(coloring.passesBy(laps, 20, 20), 1, "a lap-one stretch starts at one pass");
  assert.equal(coloring.passesBy(laps, 20, 199), 5, "and ends at five");
  const settled = coloring.heatPositions(laps, buildRouteReplay(loop).latLngs, 198);
  assert.ok(settled.every(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)), "every point has a place");

  // Two paths 15 m apart are two roads, not one passed twice.
  const road = northward([[101, 10, 3]]);
  const otherRoad = road.map((point) => ({ ...point, lon: point.lon + 15 / 103_900 }));
  const twoRoads = coloring.routeHeat(buildRouteReplay([...road, ...otherRoad.reverse()]));
  assert.equal(twoRoads.passes[50], 1, "10 m is the reach of a spot");

  // A straight road run once: every reading of a spot is the same pass.
  const once = coloring.routeHeat(buildRouteReplay(northward([[200, 10, 3]])));
  assert.equal(once.most, 1, "a road run once is passed once");

  // A road leaving a lapped line eases away from it rather than jumping when
  // it is out of reach: no step along it is more than about twice its own 2 m
  // — unweighted, the last point inside the spot was pulled 7 m onto the loop
  // and the next one was not.
  const spur = northward([[60, 2, 1]], { lon: 105 });
  const lap = spur.map((point) => ({ ...point }));
  const branch = Array.from({ length: 20 }, (_, index) => ({
    lat: spur.at(-1).lat,
    lon: 105 + ((index + 1) * 2) / 103_900
  }));
  const shaped = buildRouteReplay([...lap, ...lap.slice().reverse(), ...lap, ...branch]);
  const shapedHeat = coloring.routeHeat(shaped);
  const laid = coloring.heatPositions(shapedHeat, shaped.latLngs, shaped.latLngs.length - 2);
  const start = shaped.latLngs.length - branch.length;
  for (let index = start; index < laid.length - 1; index += 1) {
    const step = (laid[index + 1][1] - laid[index][1]) * 103_900;
    assert.ok(step > 0 && step < 5, `the branch moves on steadily: ${step.toFixed(2)} m at point ${index}`);
  }
}

// --- Zones -----------------------------------------------------------------
{
  // The buckets COROS scored a real run against (hrZones, and zoneList type
  // 130 through parseActivityPaceZones), seconds per km for pace.
  const hrZones = [
    { index: 0, high: 134 },
    { index: 1, low: 134, high: 155 },
    { index: 2, low: 156, high: 168 },
    { index: 3, low: 169, high: 174 },
    { index: 4, low: 175, high: 183 },
    { index: 5, low: 183, high: 401 }
  ];
  const paceZones = [
    { index: 0, low: 468 },
    { index: 1, low: 397, high: 468 },
    { index: 2, low: 354, high: 397 },
    { index: 3, low: 324, high: 354 },
    { index: 4, low: 318, high: 324 },
    { index: 5, low: 286, high: 318 },
    { index: 6, low: 162, high: 286 }
  ];
  const cases = [
    ["hr", hrZones, 120, 0],
    ["hr", hrZones, 150, 1],
    ["hr", hrZones, 155.5, 1],
    ["hr", hrZones, 170, 3],
    ["hr", hrZones, 190, 5],
    ["pace", paceZones, 500, 0],
    ["pace", paceZones, 420, 1],
    ["pace", paceZones, 360, 2],
    ["pace", paceZones, 320, 4],
    ["pace", paceZones, 250, 6]
  ];
  for (const [metric, zones, value, zone] of cases) {
    assert.equal(coloring.zoneOf(metric, zones, value), zone, `${metric} ${value} is zone ${zone}`);
  }

  const points = northward([[101, 30, 10]]);
  const series = Array.from({ length: 1001 }, (_, t) => ({ elapsed: t, hr: t < 500 ? 150 : 178, pace: t < 500 ? 420 : 300 }));
  const replay = buildRouteReplay(points);
  // COROS's numbering: heart-rate bucket n is zone n + 1; pace's seven buckets
  // are six zones, the two halves of Threshold being zone 4.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((bucket) => coloring.zoneNumber("hr", bucket, 6)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((bucket) => coloring.zoneNumber("pace", bucket, 7)), [1, 2, 3, 4, 4, 5, 6]);

  const hr = coloring.zoneColoring(replay, series, "hr", hrZones);
  assert.equal(hr.steps[10], 2, "150 bpm is zone 2");
  assert.equal(hr.steps[90], 5, "178 bpm is zone 5");
  assert.deepEqual(hr.ranges[0], { high: 134 }, "zone 1 has only a ceiling");
  assert.deepEqual(hr.ranges[1], { low: 134, high: 155 });
  const pace = coloring.zoneColoring(replay, series, "pace", paceZones);
  assert.equal(pace.steps[10], 2, "7:00/km is zone 2");
  assert.equal(pace.steps[90], 5, "5:00/km is zone 5");
  assert.deepEqual(pace.ranges[3], { low: 318, high: 354 }, "pace zone 4 spans both Threshold buckets");
  assert.deepEqual(pace.ranges[0], { low: 468 }, "pace zone 1 is everything slower than 7:48");
  assert.equal(coloring.zoneColoring(replay, series, "pace", []), null, "no zones, no zone colouring");

  // The map's copy of the zone colours is the zone bar's.
  const css = fs.readFileSync(path.join(repoRoot, "src/training/activities.css"), "utf8");
  const barColors = [...css.matchAll(/\[data-zone="([1-6])"\] \{ --zone-color: (#[0-9a-f]{6}); \}/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => match[2]);
  assert.deepEqual([...coloring.ZONE_COLORS], barColors, "ZONE_COLORS mirrors activities.css [data-zone]");
}

// --- Heat bands ------------------------------------------------------------
{
  const cases = [[1, 0], [2, 1], [4, 1], [5, 2], [8, 2], [9, 3], [12, 3], [13, 4], [40, 4]];
  for (const [count, band] of cases) {
    assert.equal(coloring.heatBand(count), band, `${count} passes are band ${band}`);
  }
  for (const light of [true, false]) {
    const colors = coloring.heatColors(light);
    assert.equal(colors.length, coloring.HEAT_BANDS.length, "a colour per band");
    assert.equal(new Set(colors).size, colors.length, "and no band repeats");
  }
}

// --- Neon ------------------------------------------------------------------
{
  const shares = [0, 0.25, 0.5, 0.75, 1];
  const widths = shares.map((share) => coloring.neonWidths(share));
  widths.slice(1).forEach((width, index) => {
    assert.ok(width.body > widths[index].body, "the tube widens with the passes");
    assert.ok(width.core > widths[index].core, "and so does its white core");
    assert.ok(width.core / width.body > widths[index].core / widths[index].body, "faster: more of it is white");
  });
  assert.ok(widths.every(({ body, core }) => core < body), "the core stays inside the tube");
  const ramp = coloring.heatColors(false);
  assert.equal(coloring.rampColorAt(ramp, 0, 1), "rgb(255, 255, 255)", "the core is white");
  assert.equal(coloring.rampColorAt(ramp, 0, 0), coloring.rampColorAt(ramp, 0), "the edge is the heat's own colour");
  // The reds' core leans warm, not pink: whitened, blue stays below green.
  const channels = (color) => color.match(/\d+/g).map(Number);
  for (const share of [0.75, 1]) {
    const [, g, b] = channels(coloring.rampColorAt(ramp, share, 0.65, coloring.heatCores()));
    assert.ok(b < g, `the red core at ${share} glows orange, not pink: g ${g}, b ${b}`);
  }
  assert.equal(
    coloring.rampColorAt(ramp, 0, 1, coloring.heatCores()),
    "rgb(255, 255, 255)",
    "the cooler bands still whiten to white"
  );
}

// --- Smoothing -------------------------------------------------------------
{
  const zigzag = Array.from({ length: 12 }, (_, index) => [index, index % 2 === 0 ? 0 : 1]);
  const curve = smoothing.smoothPath(zigzag);
  assert.equal(curve.points.length, (zigzag.length - 1) * smoothing.SMOOTH_STEPS + 1);
  assert.deepEqual(curve.points[0], zigzag[0], "the curve starts on the first point");
  assert.deepEqual(curve.points.at(-1), zigzag.at(-1), "and ends on the last");
  assert.ok(
    curve.points.every(([, y]) => y >= 0 && y <= 1),
    "no overshoot: the curve stays inside its points"
  );
  const peak = curve.points[5 * smoothing.SMOOTH_STEPS];
  assert.ok(Math.abs(peak[1] - 2 / 3) < 1e-9, "a wobble is eased by a sixth of the bend either side");
  // Smooth at the joins: across a recorded point the heading turns by about as
  // much as it does one sample either side, rather than all at once there.
  const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = (k) =>
    Math.abs(heading(curve.points[k], curve.points[k + 1]) - heading(curve.points[k - 1], curve.points[k]));
  for (let knot = 2; knot < zigzag.length - 2; knot += 1) {
    const at = knot * smoothing.SMOOTH_STEPS;
    assert.ok(
      turn(at) <= 1.5 * Math.min(turn(at - 1), turn(at + 1)),
      `no kink where two stretches meet, at point ${knot}: ${turn(at - 1).toFixed(3)} ${turn(at).toFixed(3)} ${turn(at + 1).toFixed(3)}`
    );
  }
  const halfway = smoothing.smoothPathTo(curve, 2.5);
  assert.equal(halfway.points.at(-1), halfway.head);
  assert.equal(halfway.points.length, 2.5 * smoothing.SMOOTH_STEPS + 2);
  assert.deepEqual(smoothing.smoothPath([[0, 0], [1, 1]]).points.length, smoothing.SMOOTH_STEPS + 1, "two points still map by multiplication");
}

// --- Ramps -----------------------------------------------------------------
for (const light of [true, false]) {
  const ramp = coloring.routeRamp(light);
  assert.equal(ramp.length, coloring.RAMP_STEPS, `${light ? "light" : "dark"} has a colour per step`);
  assert.equal(new Set(ramp).size, ramp.length, "and no step repeats");
}

console.log("route coloring OK — replay pace and length, zones, ramps, elevation stops, heat bands, passes, averaged positions, neon widths, smoothing");
