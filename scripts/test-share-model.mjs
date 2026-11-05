/**
 * The share image's arithmetic (`src/share/shareModel.ts`): how a page's
 * figure splits into number and unit, how remembered choices are laid over a
 * session that may lack some of them and how a change is remembered, which
 * ink the words take on which ground, how the route is coloured when the
 * session lacks the chosen measure, how the route, the muscle map and a photo
 * are placed and moved, how much of a route's ends is hidden, and the saved
 * file's name.
 *
 * Run: npm run test:share-model
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(path.join(repoRoot, "src", "share", "shareModel.ts"));
const {
  defaultShareOptions,
  distanceToPolyline,
  fitRoute,
  groundTone,
  photoCover,
  placeBox,
  privateRoute,
  rememberShareOptions,
  resolveShareOptions,
  routeInk,
  routeOutline,
  shareFileName,
  shownRouteStyle,
  splitStatValue,
  statColumns,
  statText,
  thin
} = await import(`${moduleUrl.href}?cacheBust=${Date.now()}`);

// A figure splits at its last word when that word is a unit; anything else stays whole.
assert.deepEqual(splitStatValue("12.4 km"), { value: "12.4", unit: "km" });
assert.deepEqual(splitStatValue("5:38 /km"), { value: "5:38", unit: "/km" });
assert.deepEqual(splitStatValue("2:04 /100m"), { value: "2:04", unit: "/100m" });
assert.deepEqual(splitStatValue("12,4 km"), { value: "12,4", unit: "km" });
assert.deepEqual(splitStatValue("21 tonnes"), { value: "21", unit: "tonnes" });
assert.deepEqual(splitStatValue("1:09:53"), { value: "1:09:53" });
assert.deepEqual(splitStatValue("24°C"), { value: "24°C" });
assert.deepEqual(splitStatValue("Bodyweight"), { value: "Bodyweight" });
assert.deepEqual(splitStatValue("—"), { value: "—" });
assert.equal(statText({ id: "d", label: "Distance", value: "12.4", unit: "km" }), "12.4 km");
assert.equal(statText({ id: "t", label: "Time", value: "1:09:53" }), "1:09:53");

assert.deepEqual([1, 2, 3, 4, 5, 6].map(statColumns), [1, 2, 3, 2, 3, 3]);
assert.deepEqual(thin([1, 2, 3], 5), [1, 2, 3]);
assert.deepEqual(thin([0, 1, 2, 3, 4, 5, 6, 7, 8], 3), [0, 4, 8]);

const route = { latLngs: [[21, 105], [21.01, 105.01]], distances: [0, 1500], performance: {}, speed: false };
const run = {
  sport: "run",
  activityId: "1",
  color: "#2fbe91",
  kind: "Road run",
  date: "Oct 27",
  name: "Run",
  stats: [
    { id: "distance", label: "Distance", value: "12.4", unit: "km" },
    { id: "time", label: "Time", value: "1:09:53" }
  ],
  defaultStats: ["time"],
  defaultHero: "distance",
  route,
  charts: [{ kind: "splits", title: "Splits", note: "", values: [1, 2], bars: true }],
  fileName: "run"
};
const swim = { ...run, sport: "swim", route: undefined, charts: [] };

// Nothing remembered: the session's own defaults, a map only where there is a route.
assert.equal(resolveShareOptions(run, undefined).background, "map");
assert.equal(resolveShareOptions(swim, undefined).background, "plain");
assert.deepEqual(resolveShareOptions(run, undefined), defaultShareOptions(run));

// Remembered choices are read one by one; what this session cannot honour falls back.
const resolved = resolveShareOptions(run, {
  format: "square",
  layout: "nonsense",
  statIds: ["time", "gone"],
  heroId: "gone",
  chartKind: "power",
  plainColor: "#ABCDEF",
  brandPosition: "br",
  showRecord: "yes"
});
assert.equal(resolved.format, "square");
assert.equal(resolved.layout, "classic");
assert.deepEqual(resolved.statIds, ["time"]);
assert.equal(resolved.heroId, "distance");
assert.equal(resolved.chartKind, "splits", "a chart the session lacks falls back");
assert.equal(resolved.plainColor, "#ABCDEF");
assert.equal(resolved.brandPosition, "br");
assert.equal(resolved.showRecord, true);
assert.equal(resolved.showKind, true, "a choice never made keeps its default");
assert.equal(resolveShareOptions(run, { showKind: false }).showKind, false);
assert.equal(resolveShareOptions(run, { heroId: "" }).heroId, "", "no big figure is a choice");
assert.equal(resolveShareOptions(swim, { background: "map" }).background, "plain", "no route, no map");
assert.equal(resolveShareOptions(swim, { chartShown: true }).chartShown, false, "no charts, none shown");
assert.equal(resolveShareOptions(run, { background: "photo" }).background, "map", "a photo ground waits for a photo");
assert.equal(resolveShareOptions(swim, { background: "photo" }).background, "plain");
assert.equal(resolveShareOptions(run, { background: "photo" }, true).background, "photo");
assert.deepEqual(
  resolveShareOptions(run, { heroId: "time", statIds: ["distance", "time"] }).statIds,
  ["distance"],
  "the large figure is never also under it"
);

// A change is laid over what is remembered, not over what this session made of it:
// the map a treadmill run could not show stays remembered for the next run outside.
const remembered = rememberShareOptions({ run: { background: "map", layout: "bold" }, ride: { format: "square" } }, "run", { showDate: false });
assert.deepEqual(remembered, { run: { background: "map", layout: "bold", showDate: false }, ride: { format: "square" } });
assert.deepEqual(rememberShareOptions({}, "swim", { layout: "poster" }), { swim: { layout: "poster" } });

// The words' ink follows the ground under them.
const base = defaultShareOptions(run);
assert.equal(groundTone({ ...base, mapStyle: "dark" }, run), "dark");
assert.equal(groundTone({ ...base, mapStyle: "topo" }, run), "light");
assert.equal(groundTone({ ...base, background: "photo" }, run), "dark");
assert.equal(groundTone({ ...base, background: "plain", plainColor: "sport", plainGradient: true }, run), "dark");
assert.equal(groundTone({ ...base, background: "plain", plainColor: "#e9e4d6", plainGradient: false }, run), "light");
assert.equal(groundTone({ ...base, background: "plain", plainColor: "#0b2545", plainGradient: false }, run), "dark");

// A route on a flat ground of its own colour would vanish: it takes the words' ink,
// which on this bright green is the dark one.
assert.equal(routeInk({ ...base, background: "plain", plainColor: "sport", plainGradient: false }, run), "#151a26");
assert.equal(routeInk({ ...base, background: "plain", plainColor: "sport", plainGradient: false }, { ...run, color: "#0b2545" }), "#ffffff");
assert.equal(routeInk({ ...base, background: "plain", plainColor: "#0b2545", plainGradient: false }, run), "#2fbe91");
assert.equal(routeInk({ ...base, background: "map" }, run), "#2fbe91");

// The route is coloured by what the session has: the chosen measure, else the
// first it has, else the plain line.
const measured = (kinds) => ({ ...route, performance: Object.fromEntries(Object.entries(kinds).map(([metric, kind]) => [metric, { kind }])) });
const performance = { ...base, routeMode: "performance", metric: "hr" };
assert.deepEqual(shownRouteStyle(performance, measured({ pace: "values", hr: "values", elevation: "none" })), { mode: "performance", metric: "hr" });
assert.deepEqual(shownRouteStyle(performance, measured({ pace: "none", hr: "none", elevation: "values" })), { mode: "performance", metric: "elevation" });
assert.deepEqual(shownRouteStyle(performance, measured({ pace: "none", hr: "none", elevation: "none" })), { mode: "neon", metric: undefined });
assert.equal(shownRouteStyle({ ...base, routeMode: "solid" }, measured({ pace: "none", hr: "none", elevation: "none" })).mode, "solid");

// Placing: fitted and centred in the zone, scaled, moved, its centre kept on the card.
const zone = { x: 100, y: 100, w: 400, h: 200 };
const bounds = { x: 0, y: 0, w: 1000, h: 1000 };
const centred = placeBox(100, 100, zone, bounds, { scale: 100, dx: 0, dy: 0 });
assert.deepEqual([centred.x, centred.y, centred.w, centred.h], [200, 100, 200, 200]);
const half = placeBox(100, 100, zone, bounds, { scale: 50, dx: 0, dy: 0 });
assert.deepEqual([half.x, half.y, half.w, half.h], [250, 150, 100, 100]);
const pushed = placeBox(100, 100, zone, bounds, { scale: 100, dx: 5000, dy: -40 });
assert.equal(pushed.dx, 700, "a move past the edge stops with the centre on the edge");
assert.equal(pushed.dy, -40);
assert.equal(pushed.x + pushed.w / 2, 1000);

// A route is placed the same way, by its projected outline.
const placed = fitRoute(routeOutline([[0, 0], [0, 1]]), zone, bounds, { scale: 100, dx: 0, dy: 0 });
assert.equal(placed.points.length, 2);
assert.ok(Math.abs(placed.points[0][1] - placed.points[1][1]) < 1e-9, "an east-west route lies flat");
assert.ok(Math.abs((placed.points[0][0] + placed.points[1][0]) / 2 - 300) < 1e-9, "and is centred in the zone");
assert.ok(Math.abs(placed.points[1][0] - placed.points[0][0] - 400) < 1e-9, "and fills its width");
for (const degenerate of [[], [[21, 105]], [[21, 105], [21, 105]]]) {
  const lone = fitRoute(routeOutline(degenerate), zone, bounds, { scale: 100, dx: 0, dy: 0 });
  assert.ok(lone.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), "a route with no extent still lands somewhere");
}

// A photo is moved no further than its edge, at any zoom.
const photo = { width: 2000, height: 1000, zoom: 1, panX: 9999, panY: -9999 };
const covered = (cover) => ({ ...cover, panX: cover.panX + 0, panY: cover.panY + 0 }); // -0 and 0 draw the same
assert.deepEqual(covered(photoCover(photo, 1000, 1000)), { width: 2000, height: 1000, panX: 500, panY: 0 });
assert.deepEqual(covered(photoCover({ ...photo, zoom: 2 }, 1000, 1000)), { width: 4000, height: 2000, panX: 1500, panY: -500 });

// Hiding the ends cuts 300 m off each, or 15% of a short route, where that
// distance falls — between two points if need be.
const straight = privateRoute([[0, 0], [0, 0.05], [0, 0.1]], [0, 5000, 10000]);
assert.equal(straight.first, 0);
assert.equal(straight.latLngs.length, 3, "a sparse out-and-back is cut inside its first and last stretch");
assert.ok(Math.abs(straight.latLngs[0][1] - 0.003) < 1e-12, "300 m into the first stretch");
assert.deepEqual(straight.latLngs[1], [0, 0.05], "the points between are kept");
assert.ok(Math.abs(straight.latLngs[2][1] - 0.097) < 1e-12, "300 m short of the end");
const short = privateRoute([[0, 0], [0, 0.001], [0, 0.002]], [0, 100, 200]);
assert.ok(Math.abs(short.latLngs[0][1] - 0.0003) < 1e-12, "15% of a 200 m route");
assert.ok(Math.abs(short.latLngs[2][1] - 0.0017) < 1e-12);
const dense = privateRoute(
  Array.from({ length: 11 }, (_, index) => [0, index]),
  Array.from({ length: 11 }, (_, index) => index * 1000)
);
assert.equal(dense.first, 0, "stretch k of what is left lies on stretch first + k");
assert.equal(dense.latLngs.length, 11, "nine points kept, two cut ends");
assert.equal(privateRoute([[0, 0], [0, 0]], [0, 0]), null, "a route with no length shows nothing");
assert.equal(privateRoute([[0, 0]], [0]), null);

assert.equal(distanceToPolyline([5, 3], [[0, 0], [10, 0]]), 3);
assert.equal(distanceToPolyline([-4, 3], [[0, 0], [10, 0]]), 5);

assert.equal(shareFileName("6 × 1 km intervals", "x"), "6-1-km-intervals");
assert.equal(shareFileName("Hồ Tây loop", "x"), "hồ-tây-loop");
assert.equal(shareFileName("  ", "activity-1"), "activity-1");

console.log("share model tests passed");
