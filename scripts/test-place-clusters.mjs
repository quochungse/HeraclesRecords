// What a place is, for "Where you've been" and the Hall of Records alike, and
// which region a point lies in. Rules a typecheck cannot hold:
//
// - **Two regions, two places**, however close the starts.
// - **A place is at most 25 km across**: no two of its starts further apart.
//   A centre that walks — 24 km, then 24 km from the new middle — is the bug
//   this rule replaced, so it is driven here as the athlete described it.
// - **Nothing is left unmerged that could merge**: two places in one region
//   would be wider than 25 km together.
// - **The order activities arrive in changes nothing**, and a place keeps the
//   key of its oldest activity when a new one lands elsewhere.
// - **The shipped outlines answer for real places**: Việt Nam's 34 provinces
//   from 1 July 2025 (Phan Thiết is Lâm Đồng now), a start just off a beach
//   goes to the nearest region, and the open ocean is in none.
//
// Mode: renderer TypeScript with extensionless imports in the graph, so the
// resolver hook comes along. Run through Electron because a distro Node built
// without Amaro cannot strip types.
//   cross-env ELECTRON_RUN_AS_NODE=1 electron --experimental-strip-types \
//     --import ./scripts/register-ts-ext.mjs scripts/test-place-clusters.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (relative) =>
  import(`${pathToFileURL(path.join(repoRoot, relative)).href}?cacheBust=${Date.now()}`);

const { clusterPlaces, haversineKm, placeLabelKey, PLACE_DIAMETER_KM } = await load(
  "src/trainingMap/placeClusters.ts"
);
const { buildRegionIndex } = await load("src/trainingMap/adminRegions.ts");

const KM_PER_DEG_LON_AT_21 = 111.32 * Math.cos((21 * Math.PI) / 180);
const east = (km) => Math.round((105.5 + km / KM_PER_DEG_LON_AT_21) * 100) / 100;

let nextTime = 1;
const point = (id, lat, lon, startTime = nextTime++) => ({ activityId: id, lat, lon, startTime });

function widest(place, points) {
  const members = points.filter((p) => place.activityIds.includes(p.activityId));
  let max = 0;
  for (const a of members) for (const b of members) max = Math.max(max, haversineKm(a, b));
  return max;
}

// --- the walking centre --------------------------------------------------------
{
  // Two starts 24 km apart; a third 24 km from their middle, 36 km from the first.
  const walk = [point("1", 21, east(0)), point("2", 21, east(24)), point("3", 21, east(36))];
  assert.ok(Math.abs(haversineKm(walk[0], walk[2]) - 36) < 0.6);
  const places = clusterPlaces(walk);
  assert.equal(places.length, 2, "36 km between the first and the third: two places");
  for (const place of places) {
    assert.ok(widest(place, walk) <= PLACE_DIAMETER_KM, `${place.key} is wider than ${PLACE_DIAMETER_KM} km`);
  }

  const near = [point("a", 21, east(0)), point("b", 21, east(12)), point("c", 21, east(24))];
  assert.equal(clusterPlaces(near).length, 1, "three starts within 24 km of each other are one place");
}

// --- every place as wide as allowed, and no wider ------------------------------
{
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cloud = Array.from({ length: 400 }, (_, index) =>
    point(`r${index}`, Math.round((21 + random() * 0.9) * 100) / 100, Math.round((105.2 + random() * 0.9) * 100) / 100)
  );
  const places = clusterPlaces(cloud);
  assert.equal(
    places.reduce((sum, place) => sum + place.count, 0),
    cloud.length,
    "every start is in exactly one place"
  );
  for (const place of places) {
    assert.ok(widest(place, cloud) <= PLACE_DIAMETER_KM + 1e-9);
  }
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const union = { activityIds: [...places[i].activityIds, ...places[j].activityIds] };
      assert.ok(
        widest(union, cloud) > PLACE_DIAMETER_KM,
        `${places[i].key} and ${places[j].key} would fit in one place and were left apart`
      );
    }
  }

  // The same starts in another order: the same places, under the same keys.
  const shuffled = cloud.slice().sort(() => random() - 0.5);
  const again = clusterPlaces(shuffled);
  const shape = (list) => list.map((place) => `${place.key}:${place.activityIds.slice().sort().join(",")}`).sort();
  assert.deepEqual(shape(again), shape(places), "the order activities arrive in changes nothing");
}

// --- keys and centres -------------------------------------------------------------
{
  const home = [point("old", 21.03, 105.85, 100), point("new", 21.04, 105.84, 300), point("mid", 21.02, 105.86, 200)];
  const [place] = clusterPlaces(home);
  assert.equal(place.key, "place:old", "a place is named after its oldest activity");
  assert.deepEqual(place.activityIds, ["old", "mid", "new"], "oldest first");
  assert.ok(Math.abs(place.lat - 21.03) < 1e-9 && Math.abs(place.lon - 105.85) < 1e-9, "drawn at the mean of its starts");
  assert.equal(placeLabelKey(place), "21.03,105.85");

  const withTrip = clusterPlaces([...home, point("trip", 11.94, 108.44, 400)]);
  assert.equal(withTrip[0].key, "place:old", "a trip elsewhere leaves home's key alone");
  assert.equal(withTrip[1].key, "place:trip");
}

// --- two regions, two places --------------------------------------------------------
{
  const north = { id: "N", name: "North", country: "XX", countryName: "Example" };
  const south = { id: "S", name: "South", country: "XX", countryName: "Example" };
  const regionOf = (p) => (p.lat >= 21 ? north : south);
  const border = [point("n", 21.0, 105.5), point("s", 20.99, 105.5)];
  const places = clusterPlaces(border, regionOf);
  assert.equal(places.length, 2, "a kilometre apart, across a border: two places");
  assert.deepEqual(places.map((place) => place.region.id).sort(), ["N", "S"]);
}

// --- the shipped outlines -------------------------------------------------------------
{
  const data = JSON.parse(readFileSync(path.join(repoRoot, "src/trainingMap/adminRegions.json"), "utf8"));
  const index = buildRegionIndex(data);
  const vietnam = data.regions.filter((region) => region[2] === "VN");
  assert.equal(vietnam.length, 34, "Việt Nam has 34 provinces since 1 July 2025");

  const at = (lat, lon) => index.regionOf({ lat, lon });
  const cases = [
    [21.03, 105.85, "Hà Nội", "VN"], // Hoàn Kiếm
    [21.07, 105.4, "Hà Nội", "VN"], // Ba Vì
    [11.94, 108.44, "Lâm Đồng", "VN"], // Đà Lạt
    [10.93, 108.1, "Lâm Đồng", "VN"], // Phan Thiết, Bình Thuận until 2025
    [22.82, 104.98, "Tuyên Quang", "VN"], // Hà Giang town
    [10.78, 106.7, "Hồ Chí Minh", "VN"],
    [18.79, 98.98, "Chiang Mai", "TH"],
    [48.86, 2.35, "Paris", "FR"],
    [37.77, -122.42, "California", "US"]
  ];
  for (const [lat, lon, name, country] of cases) {
    const region = at(lat, lon);
    assert.equal(region?.name, name, `${lat}, ${lon} should be in ${name}, got ${region?.name}`);
    assert.equal(region?.country, country);
  }
  assert.equal(at(21.03, 105.85).countryName, "Vietnam");

  // A start on the water just off Nha Trang is Khánh Hòa's; mid-Pacific is nobody's.
  assert.equal(at(12.24, 109.25)?.name, "Khánh Hòa", "a start off the beach goes to the nearest region");
  assert.equal(at(0, -140), undefined, "the open ocean is in no region");

  // Hồ Tây and Hoài Đức, 12 km apart either side of 105.75°: the old grid made
  // them two places, one province and one place now.
  const westOfHanoi = clusterPlaces([point("hotay", 21.06, 105.82), point("hoaiduc", 21.03, 105.7)], (p) =>
    index.regionOf(p)
  );
  assert.equal(westOfHanoi.length, 1);
  assert.equal(westOfHanoi[0].region.name, "Hà Nội");

  // Đà Lạt and Phan Thiết share a province and are 120 km apart: two places.
  const lamDong = clusterPlaces([point("dalat", 11.94, 108.44), point("phanthiet", 10.93, 108.1)], (p) =>
    index.regionOf(p)
  );
  assert.equal(lamDong.length, 2);
  assert.ok(lamDong.every((place) => place.region.name === "Lâm Đồng"));
}

console.log("place clusters: all assertions passed");
