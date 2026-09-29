// The route replay and the full map's colouring: the arithmetic under the
// animation, Performance's zones, ramps and elevation stops, the Heatmap's
// pass count, bands and averaged line, the bounded curve the line is drawn
// along and the route the main process simplifies for it. None of it
// type-checks into correctness — a replay at the wrong pace, a ramp flattened
// by one stop, a lap counted as one pass, a corner cut by 20 m all draw a
// perfectly good map.
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
const simplification = await load("electron/routeSimplification.ts");
const { COVER_REPLAY_MAX_MS, buildRouteReplay, replayDurationMs, replayHead, replayPath } = replayModule;

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
assert.equal(replayDurationMs(42_195, COVER_REPLAY_MAX_MS), 2000, "a cover draws it in 2 s");
assert.equal(replayDurationMs(2000, COVER_REPLAY_MAX_MS), 1400, "and a short route in its own time");

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
  const valuesOf = (metric, from = replay, samples = series) => {
    const result = coloring.stretchValues(from, samples, metric);
    assert.ok("values" in result, `${metric} has values: ${JSON.stringify(result)}`);
    return result.values;
  };

  const pace = coloring.performanceColoring(valuesOf("pace"), "pace");
  assert.equal(pace.low, 360, "the weak end is the slower pace");
  assert.equal(pace.high, 300, "the strong end is the faster pace");
  assert.equal(pace.steps[10], 0, "the slow half takes the weakest step");
  assert.equal(pace.steps[300], coloring.RAMP_STEPS - 1, "the fast half the strongest");
  assert.ok(
    pace.steps.every((step) => step !== null),
    "a stop's absurd pace is dropped, not a hole or a new end of the ramp"
  );

  const hr = coloring.performanceColoring(valuesOf("hr"), "hr");
  assert.ok(hr.steps[0] < hr.steps[398], "heart rate climbs the ramp as it rises");
  // A steady run is not painted as intervals: a spread under the least span
  // lands in the middle steps.
  const steady = coloring.performanceColoring(
    valuesOf("hr", replay, series.map((sample) => ({ ...sample, hr: 150 + (sample.elapsed % 3) }))),
    "hr"
  );
  assert.ok(
    steady.steps.every((step) => step >= 1 && step <= 3),
    `a 3 bpm wobble stays mid-ramp: ${[...new Set(steady.steps)]}`
  );

  const heights = coloring.elevationColoring(replay);
  assert.equal(heights[10], 10, "a stretch's height is its points' mean");
  assert.equal(heights[300], 10.5);

  // Why there is nothing is said, because the map says it: a metric never
  // recorded is not the same as one recorded with no clock to place it by.
  assert.deepEqual(coloring.stretchValues(replay, [], "pace"), { missing: "unrecorded" });
  assert.deepEqual(
    coloring.stretchValues(replay, series.map(({ hr, ...sample }) => sample), "hr"),
    { missing: "unrecorded" },
    "no heart rate on any sample"
  );
  const untimed = buildRouteReplay(points.map(({ elapsed, ...point }) => point));
  assert.deepEqual(
    coloring.stretchValues(untimed, series, "hr"),
    { missing: "untimed" },
    "a track with no clock cannot be joined to the series"
  );
  assert.deepEqual(
    coloring.stretchValues(replay, series.map(({ elapsed, ...sample }) => sample), "pace"),
    { missing: "untimed" },
    "nor can a series with none"
  );
  assert.deepEqual(
    coloring.stretchValues(
      replay,
      series.map((sample) => ({ ...sample, elapsed: sample.elapsed + 100_000 })),
      "hr"
    ),
    { missing: "untimed" },
    "two clocks that never overlap place nothing"
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
  const valuesOf = (metric) => coloring.stretchValues(replay, series, metric).values;

  // Bucket for bucket, the zone bar's numbering: bucket 0 is "Below Z1",
  // bucket n is "Zn", heart rate and pace alike, so the map and the bar
  // beside it call a stretch the same thing.
  assert.deepEqual([0, 1, 5].map(coloring.zoneLabel), ["Below Z1", "Z1", "Z5"]);
  const hr = coloring.zoneColoring(valuesOf("hr"), "hr", [...hrZones].reverse());
  assert.equal(hr.steps[10], 1, "150 bpm is bucket 1");
  assert.equal(hr.steps[90], 4, "178 bpm is bucket 4");
  assert.deepEqual(hr.buckets.map((bucket) => bucket.index), [0, 1, 2, 3, 4, 5], "in order, whatever COROS sent");
  const pace = coloring.zoneColoring(valuesOf("pace"), "pace", paceZones);
  assert.equal(pace.steps[10], 1, "7:00/km is bucket 1");
  assert.equal(pace.steps[90], 5, "5:00/km is bucket 5");
  assert.equal(pace.buckets.length, 7, "every pace bucket keeps its own colour");
  assert.equal(coloring.zoneColoring(valuesOf("pace"), "pace", []), null, "no zones, no zone colouring");
  assert.equal(
    coloring.zoneColoring(valuesOf("hr"), "hr", hrZones.slice(0, 2)),
    null,
    "one bucket with a floor is not a scale"
  );

  // The map's copy of the zone colours is the zone bar's, bucket 0's grey
  // included, and a bucket past the last takes the last colour as the bar's
  // clamped `data-zone` does.
  const css = fs.readFileSync(path.join(repoRoot, "src/training/activities.css"), "utf8");
  const barColors = [...css.matchAll(/\[data-zone="([0-9])"\] \{ --zone-color: (#[0-9a-f]{6}); \}/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => match[2]);
  assert.deepEqual([...coloring.ZONE_COLORS], barColors, "ZONE_COLORS mirrors activities.css [data-zone]");
  assert.equal(coloring.zoneColor(9), coloring.ZONE_COLORS.at(-1));
  assert.equal(coloring.zoneColor(0), coloring.ZONE_COLORS[0]);
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
  const { ROUTE_NEON } = coloring;
  // One neon for every line: the heatmap's is a route line's, wider, and its
  // glow reaches further.
  assert.deepEqual(coloring.ROUTE_LINE_WIDTHS, { body: 4, core: 1.6, halo: 8 }, "a route line");
  assert.ok(
    coloring.neonWidths(coloring.heatWeight(0)).halo > coloring.ROUTE_LINE_WIDTHS.halo,
    "a stretch passed once glows further than a route line"
  );
  assert.equal(coloring.heatWeight(0), ROUTE_NEON.weight, "a stretch passed once is a route line's width");
  const shares = [0, 0.25, 0.5, 0.75, 1];
  const weights = shares.map((share) => coloring.heatWeight(share));
  weights.slice(1).forEach((weight, index) => {
    assert.ok(weight > weights[index], "the line widens with the passes");
  });
  assert.equal(coloring.heatWeight(3), coloring.heatWeight(1), "and stops at the top band");
  assert.ok(
    coloring.neonWidths(coloring.heatWeight(1)).halo > coloring.neonWidths(coloring.heatWeight(0)).halo * 2,
    "a hot stretch glows wider than a stretch passed once"
  );
  for (const weight of weights) {
    const { body, core, halo } = coloring.neonWidths(weight);
    assert.ok(
      Math.abs((body - core) / 2 - ROUTE_NEON.edge) < 1e-9,
      "the edges keep a route line's width however wide the line: it widens in its core"
    );
    assert.ok(
      Math.abs((halo - body) / 2 / body - ROUTE_NEON.haloShare) < 1e-9,
      "and the halo reaches past it by its share of the width"
    );
  }
  const dark = coloring.routeNeon(false);
  const light = coloring.routeNeon(true);
  assert.ok(light.coreWhiten < dark.coreWhiten && light.haloOpacity < dark.haloOpacity, "a daylight map takes less");

  // The halo pane's CSS blur is the canvas's.
  const css = fs.readFileSync(path.join(repoRoot, "src/styles.css"), "utf8");
  const paneBlur = /\.leaflet-heraclesRouteHalo-pane \{[^}]*filter: blur\((\d+(?:\.\d+)?)px\)/.exec(css);
  assert.equal(Number(paneBlur?.[1]), ROUTE_NEON.haloBlur, "the halo pane blurs by ROUTE_NEON.haloBlur");

  const ramp = coloring.heatColors(false);
  assert.equal(coloring.rampColorAt(ramp, 0, 1), "rgb(255, 255, 255)", "whitened in full, a core is white");
  assert.equal(coloring.rampColorAt(ramp, 0, 0), coloring.rampColorAt(ramp, 0), "the edge is the heat's own colour");
  // The reds' core leans warm, not pink: whitened, blue stays below green.
  const channels = (color) => color.match(/\d+/g).map(Number);
  for (const share of [0.75, 1]) {
    const [, g, b] = channels(coloring.rampColorAt(ramp, share, dark.coreWhiten, coloring.heatCores()));
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
  const M_LAT = 110_540;
  const M_LON = 111_320 * Math.cos((21 * Math.PI) / 180);
  const toXY = ([lat, lon]) => [lon * M_LON, lat * M_LAT];
  const segmentGap = (p, a, b) => {
    const [px, py] = toXY(p);
    const [ax, ay] = toXY(a);
    const [bx, by] = toXY(b);
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  };
  const gapToLine = (p, line) =>
    Math.min(...line.slice(0, -1).map((a, index) => segmentGap(p, a, line[index + 1])));
  const at = (east, north) => [21 + north / M_LAT, 105 + east / M_LON];

  // A junction reached down a long chord: what a simplified route looks like.
  // An unbounded B-spline cut this corner by a sixth of 100 m either side.
  const corner = [at(0, 0), at(0, 100), at(100, 100)];
  const curve = smoothing.smoothPath(corner);
  assert.deepEqual(curve.points[0], corner[0], "the curve starts on the first point");
  assert.deepEqual(curve.points.at(-1), corner.at(-1), "and ends on the last");
  const worst = Math.max(...curve.points.map((point) => gapToLine(point, corner)));
  assert.ok(
    worst <= smoothing.CORNER_METERS / 3 + 0.01,
    `the corner is rounded within ${smoothing.CORNER_METERS / 3} m of the recorded line: ${worst.toFixed(2)} m`
  );
  assert.ok(worst > 0.5, "and it is rounded, not left as a kink");
  // Round at any zoom: where two samples meet, the chord times the turn —
  // about eight times how far the samples stray from the true curve — stays
  // under 40 cm, so no facet is ever five centimetres deep. A hairpin too.
  const heading = (a, b) => {
    const [ax, ay] = toXY(a);
    const [bx, by] = toXY(b);
    return Math.atan2(by - ay, bx - ax);
  };
  const chord = (a, b) => Math.hypot(toXY(b)[0] - toXY(a)[0], toXY(b)[1] - toXY(a)[1]);
  for (const shape of [corner, [at(0, 0), at(0, 100), at(10, 0)], [at(0, 0), at(0, 100), at(30, 160)]]) {
    const { points: samples } = smoothing.smoothPath(shape);
    for (let k = 1; k < samples.length - 1; k += 1) {
      let turn = Math.abs(heading(samples[k], samples[k + 1]) - heading(samples[k - 1], samples[k]));
      turn = Math.min(turn, 2 * Math.PI - turn);
      const facet = turn * Math.max(chord(samples[k - 1], samples[k]), chord(samples[k], samples[k + 1]));
      assert.ok(facet < 0.4, `sample ${k} of ${samples.length}: ${facet.toFixed(3)}`);
    }
  }
  assert.ok(curve.points.length < 40, `the straight legs cost no samples: ${curve.points.length}`);

  // A straight chord is its ends and the two controls in from them.
  assert.equal(smoothing.smoothPath([at(0, 0), at(0, 200)]).points.length, 4);

  // The position a replay reads: rising, and a whole number is its point.
  assert.ok(curve.along.every((value, index) => index === 0 || value > curve.along[index - 1]), "along rises");
  assert.equal(curve.along[0], 0);
  assert.equal(curve.along.at(-1), corner.length - 1);
  assert.ok(curve.along.includes(1), "the corner has a sample of its own");
  // Half way through the second stretch is half way along its curve: the
  // head keeps the replay's pace through a corner rather than speeding up.
  const east = (point) => toXY(point)[0] - toXY(corner[0])[0];
  const head = smoothing.curveHead(curve, 1.5);
  assert.ok(gapToLine(head, corner) < 0.01 && Math.abs(east(head) - 50) < 1.5, `half way along the second leg: ${east(head).toFixed(2)} m`);
  const quarters = [1.25, 1.5, 1.75].map((position) => east(smoothing.curveHead(curve, position)));
  assert.ok(
    Math.abs(quarters[1] - quarters[0] - (quarters[2] - quarters[1])) < 0.5,
    `even going: ${quarters.map((value) => value.toFixed(1))}`
  );
  const between = smoothing.curveBetween(curve, 1, 1.5);
  assert.deepEqual(between.at(-1), head, "a run ends at the head");
  assert.deepEqual(between[0], curve.points[curve.along.indexOf(1)], "and starts on its first point's sample");
  assert.deepEqual(smoothing.curveBetween(curve, 0, 2), curve.points, "the whole curve at the end");

  // A GPS wobble between close readings is eased, not traced: readings 3 m
  // apart swinging 1 m either way leave the curve within a third of that.
  const wobble = Array.from({ length: 20 }, (_, index) => at(index % 2 === 0 ? -1 : 1, index * 3));
  const eased = smoothing.smoothPath(wobble);
  const inner = eased.points.filter((_, k) => eased.along[k] >= 2 && eased.along[k] <= 17);
  assert.ok(
    inner.every((point) => Math.abs(toXY(point)[0] - 105 * M_LON) < 0.4),
    "the wobble is a third of what was recorded"
  );
}

// --- Route simplification -----------------------------------------------------
{
  const { simplifyRoute, MAX_ROUTE_POINTS, TOLERANCE_METERS } = simplification;
  const M_LAT = 110_540;
  const M_LON = 111_320 * Math.cos((21 * Math.PI) / 180);
  const at = (east, north, extra = {}) => ({ lat: 21 + north / M_LAT, lon: 105 + east / M_LON, ...extra });
  const meters = (a, b) => Math.hypot((b.lon - a.lon) * M_LON, (b.lat - a.lat) * M_LAT);
  const gapToLine = (p, line) => {
    let best = Infinity;
    for (let index = 0; index < line.length - 1; index += 1) {
      const a = line[index];
      const b = line[index + 1];
      const [ax, ay] = [a.lon * M_LON, a.lat * M_LAT];
      const [bx, by] = [b.lon * M_LON, b.lat * M_LAT];
      const [px, py] = [p.lon * M_LON, p.lat * M_LAT];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)));
    }
    return best;
  };

  assert.equal(simplifyRoute([{ elevation: 3 }, at(0, 0)]), undefined, "one located point is no route");

  // 10 km straight north, a reading every 3 m wobbling 1 m either side: the
  // wobble goes, and what is left is the spacing the side panel had.
  const straight = Array.from({ length: 3334 }, (_, index) =>
    at(index % 2 === 0 ? -1 : 1, index * 3, { elapsed: index, elevation: 10 })
  );
  const kept = simplifyRoute(straight);
  assert.equal(kept[0], straight[0], "the start is kept, as it was");
  assert.equal(kept.at(-1), straight.at(-1), "and the finish");
  assert.ok(kept.length > 350 && kept.length < 450, `a point every 25 m or so: ${kept.length}`);
  const gaps = kept.slice(1).map((point, index) => meters(kept[index], point));
  assert.ok(Math.max(...gaps) < 25 + 4, `no gap past the spacing: ${Math.max(...gaps).toFixed(1)} m`);
  assert.ok(kept.every((point) => point.elapsed !== undefined && point.elevation === 10), "every field travels");

  // Shape: a 50 m circle read every metre keeps what it needs to stay within
  // the tolerance of every reading.
  const circle = Array.from({ length: 315 }, (_, index) => {
    const angle = index / 50;
    return at(50 * Math.cos(angle), 50 * Math.sin(angle));
  });
  const round = simplifyRoute(circle);
  const stray = Math.max(...circle.map((point) => gapToLine(point, round)));
  assert.ok(stray <= TOLERANCE_METERS + 1e-6, `within ${TOLERANCE_METERS} m of every reading: ${stray.toFixed(2)} m`);
  assert.ok(round.length < circle.length / 3, `and drops the rest: ${round.length} of ${circle.length}`);

  // Budget: 200 km of a winding road read every 3 m fits, both limits
  // loosened together rather than the line thrown away.
  const winding = Array.from({ length: 66_667 }, (_, index) =>
    at(20 * Math.sin((index * 3 * 2 * Math.PI) / 200), index * 3)
  );
  const long = simplifyRoute(winding);
  assert.ok(long.length <= MAX_ROUTE_POINTS && long.length > MAX_ROUTE_POINTS / 3, `fits the budget: ${long.length}`);
  assert.equal(long.at(-1), winding.at(-1));
}

// --- A line's neon core ------------------------------------------------------
{
  assert.equal(coloring.whitenColor("#000000", 0.5), "rgb(128, 128, 128)", "half way to white");
  assert.equal(coloring.whitenColor("#74c08f", 0), "rgb(116, 192, 143)", "nothing whitened is the colour itself");
  assert.equal(
    coloring.whitenColor(coloring.elevationColor(400, false), 1),
    "rgb(255, 255, 255)",
    "an elevation colour, written rgb(), whitens too"
  );
  assert.equal(coloring.whitenColor("currentColor", 0.4), "currentColor", "anything else is left alone");
}

// --- Ramps -----------------------------------------------------------------
for (const light of [true, false]) {
  const ramp = coloring.routeRamp(light);
  assert.equal(ramp.length, coloring.RAMP_STEPS, `${light ? "light" : "dark"} has a colour per step`);
  assert.equal(new Set(ramp).size, ramp.length, "and no step repeats");
}

console.log("route coloring OK — replay pace and length, stretch values, zones, ramps, elevation stops, heat bands, passes, averaged positions, neon widths, bounded smoothing, route simplification");
