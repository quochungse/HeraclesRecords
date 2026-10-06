// What the Where you've been screen says about its places: the list's rows,
// its two orders, and the line under the title. Four rules a typecheck cannot
// hold:
//
// - **A place is the activities still in the list.** A visit whose activity
//   the period has dropped does not count, and a bucket left empty is no place.
// - **Home is where most of the training is, and "farthest" is measured from
//   it** — and only from 100 km, where the Hall of Records starts counting a
//   trip too: Tam Đảo, 53 km out, is a day out from Hà Nội.
// - **No country count while any place is unnamed**: the named ones would read
//   as the answer and be short. "Việt Nam" and "Vietnam" are one country — the
//   two geocoders name it in two languages.
// - **Days are written "6 Aug 2024", never "Sept"**, the way the Hall of
//   Records writes the same days.
// - **A place's months run unbroken to now**: a month with no visit is a bar
//   of nothing, because the gaps are what the bars are for.
//
// Mode: renderer TypeScript with extensionless imports in the graph, so the
// resolver hook comes along. Run through Electron because a distro Node built
// without Amaro cannot strip types.
//   cross-env ELECTRON_RUN_AS_NODE=1 electron --experimental-strip-types \
//     --import ./scripts/register-ts-ext.mjs scripts/test-place-summaries.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (relative) =>
  import(`${pathToFileURL(path.join(repoRoot, relative)).href}?cacheBust=${Date.now()}`);

const {
  buildPlaceSummaries,
  countriesVisited,
  farthestFromHome,
  formatDayLong,
  formatDayNear,
  homePlace,
  formatMonthYear,
  placesSummaryLine,
  sortPlaces,
  sportMix,
  visitsByMonth,
} = await load("src/trainingMap/placeSummaries.ts");
const { bucketVisitsGeographically } = await load(
  "src/trainingMap/activityVisitHeatmap.ts",
);

const HANOI = { lat: 21.03, lon: 105.85 };
const TAM_DAO = { lat: 21.46, lon: 105.64 };
const DA_LAT = { lat: 11.94, lon: 108.44 };
const BANGKOK = { lat: 13.73, lon: 100.54 };

const day = (iso) => new Date(`${iso}T07:00:00`).getTime() / 1000;
let nextId = 1;
function activity(startIso, extra = {}) {
  return {
    activityId: String(nextId++),
    startTime: day(startIso),
    distance: 10_000,
    duration: 3_600,
    elevationGain: 100,
    sportType: 100,
    ...extra,
  };
}

function world(entries) {
  const activities = [];
  const visits = [];
  for (const [point, starts] of entries) {
    for (const start of starts) {
      const item = activity(start);
      activities.push(item);
      visits.push({ activityId: item.activityId, ...point });
    }
  }
  return { activities, visits, buckets: bucketVisitsGeographically(visits) };
}

// --- a place is the activities still in the list -------------------------
{
  const { activities, visits, buckets } = world([
    [HANOI, ["2026-10-01", "2026-09-20", "2025-03-02"]],
    [TAM_DAO, ["2026-10-04"]],
    [DA_LAT, ["2026-04-12"]],
  ]);
  const places = buildPlaceSummaries(activities, visits, buckets);
  assert.equal(places.length, 3);
  assert.deepEqual(
    places.map((place) => place.activities.length),
    [1, 3, 1],
    "newest visit first: Tam Đảo (4 Oct), Hà Nội (1 Oct), Đà Lạt (12 Apr)",
  );
  const hanoi = places[1];
  assert.equal(hanoi.distanceMeters, 30_000);
  assert.equal(hanoi.durationSeconds, 10_800);
  assert.equal(hanoi.elevationMeters, 300);
  assert.equal(hanoi.lastVisitedMs, day("2026-10-01") * 1000);
  assert.equal(hanoi.firstVisitedMs, day("2025-03-02") * 1000);
  assert.equal(
    hanoi.activities[0].startTime,
    day("2026-10-01"),
    "a place's own activities are newest first too",
  );

  // The period drops Đà Lạt's only activity and one of Hà Nội's.
  const kept = activities.filter(
    (item) => item.startTime !== day("2026-04-12") && item.startTime !== day("2025-03-02"),
  );
  const narrowed = buildPlaceSummaries(kept, visits, buckets);
  assert.equal(narrowed.length, 2, "a bucket whose activities all left is no place");
  assert.equal(narrowed.find((place) => place.activities.length === 2)?.firstVisitedMs, day("2026-09-20") * 1000);

  // Two orders.
  assert.deepEqual(
    sortPlaces(places, "visits").map((place) => place.activities.length),
    [3, 1, 1],
  );
  assert.equal(
    sortPlaces(places, "visits")[1].lastVisitedMs,
    day("2026-10-04") * 1000,
    "a tie in visits goes to the newer visit",
  );
  assert.equal(homePlace(places), hanoi, "home is where most of the training is");
}

// --- farthest from home ----------------------------------------------------
{
  const { activities, visits, buckets } = world([
    [HANOI, ["2026-10-01", "2026-09-20"]],
    [TAM_DAO, ["2026-10-04"]],
    [DA_LAT, ["2026-04-12"]],
    [BANGKOK, ["2025-12-14"]],
  ]);
  const places = buildPlaceSummaries(activities, visits, buckets);
  const farthest = farthestFromHome(places);
  assert.ok(farthest);
  assert.equal(farthest.home.activities.length, 2);
  assert.equal(farthest.place.bucket.lat, DA_LAT.lat, "Đà Lạt is further from Hà Nội than Bangkok");
  assert.ok(Math.abs(farthest.km - 1048) < 1, `Hà Nội to Đà Lạt is ~1,048 km, got ${farthest.km}`);

  const near = world([
    [HANOI, ["2026-10-01", "2026-09-20"]],
    [TAM_DAO, ["2026-10-04"]],
  ]);
  assert.equal(
    farthestFromHome(buildPlaceSummaries(near.activities, near.visits, near.buckets)),
    undefined,
    "Tam Đảo is 53 km out: a day out from home, not a trip",
  );
}

// --- countries --------------------------------------------------------------
{
  const { activities, visits, buckets } = world([
    [HANOI, ["2026-10-01"]],
    [DA_LAT, ["2026-04-12"]],
    [BANGKOK, ["2025-12-14"]],
  ]);
  const places = buildPlaceSummaries(activities, visits, buckets);
  const key = (point) => places.find((place) => place.bucket.lat === point.lat).key;
  const labels = {
    [key(HANOI)]: { city: "Hà Nội", country: "Việt Nam", full: "Hà Nội, Việt Nam" },
    [key(DA_LAT)]: { city: "Đà Lạt", country: "Vietnam", full: "Đà Lạt, Vietnam", countryCode: "vn" },
  };
  assert.equal(countriesVisited(places, labels), undefined, "Bangkok is unnamed yet: no count");
  labels[key(BANGKOK)] = { city: "Bangkok", country: "Thailand", full: "Bangkok, Thailand", countryCode: "TH" };
  assert.equal(countriesVisited(places, labels), 2, "Việt Nam and Vietnam are one country");

  assert.equal(
    placesSummaryLine({ places, labels, allTime: true }),
    "3 activities in 3 places and 2 countries since 14 Dec 2025 · Farthest: Đà Lạt, 1,048 km from Hà Nội",
  );
  assert.equal(
    placesSummaryLine({ places, labels, allTime: false }),
    "3 activities in 3 places and 2 countries · Farthest: Đà Lạt, 1,048 km from Hà Nội",
    "a shorter period is named by its picker, not by a date",
  );
  delete labels[key(DA_LAT)];
  assert.equal(
    placesSummaryLine({ places, labels, allTime: false }),
    "3 activities in 3 places · Farthest: 1,048 km from Hà Nội",
    "an unnamed place leaves the country count out, and the farthest unnamed",
  );
}

{
  const { activities, visits, buckets } = world([[HANOI, ["2026-10-01"]]]);
  const places = buildPlaceSummaries(activities, visits, buckets);
  const labels = {
    [places[0].key]: { city: "Hà Nội", country: "Vietnam", full: "Hà Nội, Vietnam" },
  };
  assert.equal(
    placesSummaryLine({ places, labels, allTime: true }),
    "1 activity in 1 place since 1 Oct 2026",
    "one country is not worth saying, and one place has no farthest",
  );
  assert.equal(placesSummaryLine({ places: [], labels, allTime: true }), "");
}

// --- days -------------------------------------------------------------------
{
  const now = new Date("2026-10-06T12:00:00").getTime();
  assert.equal(formatDayLong(new Date("2024-08-06T08:00:00").getTime()), "6 Aug 2024");
  assert.equal(formatDayNear(new Date("2026-09-28T08:00:00").getTime(), now), "28 Sep");
  assert.equal(formatDayNear(new Date("2025-12-14T08:00:00").getTime(), now), "14 Dec 2025");
  assert.equal(formatDayNear(0, now), "");
}

// --- a place's sports and months -------------------------------------------
{
  const mixed = [
    activity("2026-09-01", { sportType: 104 }),
    activity("2026-08-01", { sportType: 200 }),
    activity("2026-07-01", { sportType: 104 }),
    activity("2026-06-01", { sportType: 102 }),
    activity("2026-05-01", { sportType: 104 }),
  ];
  assert.deepEqual(sportMix(mixed), [
    { category: "hiking", count: 3 },
    { category: "bike", count: 1 },
    { category: "run", count: 1 },
  ], "most sessions first; a trail run is a run");

  const now = new Date("2026-10-06T12:00:00").getTime();
  const months = visitsByMonth(
    [activity("2026-07-02"), activity("2026-07-20"), activity("2026-09-03")],
    now,
  );
  assert.deepEqual(
    months.map((month) => `${formatMonthYear(month.monthMs)}:${month.count}`),
    ["Jul 2026:2", "Aug 2026:0", "Sep 2026:1", "Oct 2026:0"],
    "from the first visit to this month, empty months kept",
  );
  const long = visitsByMonth([activity("2020-01-05"), activity("2026-10-01")], now, 12);
  assert.equal(long.length, 12, "the most recent twelve months, no more");
  assert.equal(formatMonthYear(long[0].monthMs), "Nov 2025");
  assert.deepEqual(visitsByMonth([], now), []);
}

console.log("place summaries: all assertions passed");
