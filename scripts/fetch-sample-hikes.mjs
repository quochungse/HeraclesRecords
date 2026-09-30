// Fetches the trails the sample hikes follow and writes electron/sampleHikeRoutes.ts.
//
// `npm run sample-hikes:fetch`. The sibling of sample-rides:fetch, and like it
// the output is committed and nothing at build or run time calls this: the
// sample hikes (HERACLES_SAMPLE_HIKES=1, see electron/sampleHikes.ts) must draw
// offline.
//
// Two keyless public services, asked a handful of times per run:
//  - BRouter's hiking-mountain profile (brouter.de), for a line that follows
//    the footpaths mapped in OpenStreetMap — the bicycle router the rides use
//    keeps to roads, and a hike drawn along the road to the summit is not the
//    hike anyone walked. Every route below was checked to run on
//    `highway=path` / `steps` for its climbing: where OSM has no trail (Lảo
//    Thẩn, Tà Xùa, Bạch Mộc Lương Tử, when this was written) the router falls
//    back to the road network and the place was left out rather than faked;
//  - OpenTopoData's SRTM 30 m set, for the ground under it every 50 m — twice
//    as often as a ride's, because a trail climbs in a few hundred metres what
//    a road takes kilometres over.
import { writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(repoRoot, "electron", "sampleHikeRoutes.ts");
const ROUTER = "https://brouter.de/brouter";
const ELEVATION = "https://api.opentopodata.org/v1/srtm30m";
const ELEVATION_STEP_METERS = 50;
const ELEVATION_BATCH = 100;

/**
 * Waypoints as [lat, lon], in walking order; the router joins them by trail.
 * `summit` is the peak's surveyed height where the route tops out on one — SRTM
 * reads a summit low (a 30 m cell averages the top with its slopes), and a
 * watch calibrated at the trailhead reads it close to true.
 */
const ROUTES = [
  {
    key: "fansipan",
    place: "Fansipan via Trạm Tôn, Lào Cai",
    summit: 3143,
    // Up the Trạm Tôn trail from the ranger post on Ô Quy Hồ; down by cable car.
    waypoints: [
      [22.3485, 103.776],
      [22.3033, 103.775]
    ]
  },
  {
    key: "puTaLeng",
    place: "Pu Ta Leng, Lai Châu",
    summit: 3049,
    // Summit day of the two-day hike: from the high camp to the top and back.
    waypoints: [
      [22.3963, 103.6246],
      [22.4236, 103.6],
      [22.3963, 103.6246]
    ]
  },
  {
    key: "hamLon",
    place: "Hàm Lợn, Sóc Sơn, Hà Nội",
    summit: 462,
    // Up the forest trail from the lake side, over the top, down the ridge.
    waypoints: [
      [21.296, 105.805],
      [21.3136, 105.7882],
      [21.305, 105.78],
      [21.296, 105.805]
    ]
  },
  {
    key: "tamDao",
    place: "Rùng Rình peak from Tam Đảo town, Vĩnh Phúc",
    summit: 1375,
    waypoints: [
      [21.4575, 105.645],
      [21.4927, 105.6364],
      [21.4575, 105.645]
    ]
  },
  {
    key: "baVi",
    place: "Ba Vì, Đền Thượng from the park road, Hà Nội",
    summit: 1296,
    waypoints: [
      [21.0802, 105.3673],
      [21.0582, 105.3675],
      [21.0802, 105.3673]
    ]
  }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "HeraclesRecords sample-hikes fetch" } });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`${response.status} ${response.statusText} for ${url}: ${(await response.text()).slice(0, 200)}`);
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`gave up on ${url}`);
}

function haversine([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Google's polyline encoding at five decimals: a metre or so, a few bytes a point. */
function encodePolyline(points) {
  let out = "";
  let lastLat = 0;
  let lastLon = 0;
  const encode = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lon * 1e5);
    out += encode(la - lastLat) + encode(lo - lastLon);
    lastLat = la;
    lastLon = lo;
  }
  return out;
}

/** Points every `step` metres along a polyline, the ends included. */
function sampleAlong(points, step) {
  const samples = [points[0]];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = haversine(from, to);
    let at = step - carried;
    while (at <= length) {
      const t = at / length;
      samples.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
      at += step;
    }
    carried = (carried + length) % step;
  }
  samples.push(points[points.length - 1]);
  return samples;
}

const output = [];
for (const route of ROUTES) {
  const lonlats = route.waypoints.map(([lat, lon]) => `${lon},${lat}`).join("|");
  const routed = await getJson(
    `${ROUTER}?lonlats=${lonlats}&profile=hiking-mountain&alternativeidx=0&format=geojson`
  );
  const feature = routed.features?.[0];
  if (!feature) throw new Error(`${route.key}: the router found no trail`);
  const line = feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const points = line.filter(
    (point, index) =>
      index === 0 || point[0] !== line[index - 1][0] || point[1] !== line[index - 1][1]
  );

  // What the line runs on, so a route that slid off the trail onto a road is
  // seen here rather than on the map.
  const messages = feature.properties.messages;
  const head = messages[0];
  const onWay = {};
  for (const row of messages.slice(1)) {
    const highway = /highway=(\w+)/.exec(row[head.indexOf("WayTags")])?.[1] ?? "?";
    onWay[highway] = (onWay[highway] ?? 0) + Number(row[head.indexOf("Distance")]);
  }
  await sleep(1500);

  const samples = sampleAlong(points, ELEVATION_STEP_METERS);
  const elevations = [];
  for (let start = 0; start < samples.length; start += ELEVATION_BATCH) {
    const batch = samples.slice(start, start + ELEVATION_BATCH);
    const answer = await getJson(
      `${ELEVATION}?locations=${batch.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join("|")}`
    );
    for (const result of answer.results) {
      elevations.push(Math.round(result.elevation ?? 0));
    }
    await sleep(1100);
  }

  const length = points.reduce(
    (sum, point, index) => (index === 0 ? 0 : sum + haversine(points[index - 1], point)),
    0
  );
  console.log(
    `${route.key}: ${(length / 1000).toFixed(1)} km, ${points.length} points, ` +
      `elevation ${Math.min(...elevations)}–${Math.max(...elevations)} m (raw SRTM), on ` +
      Object.entries(onWay)
        .sort((a, b) => b[1] - a[1])
        .map(([way, metres]) => `${way} ${(metres / 1000).toFixed(1)} km`)
        .join(", ")
  );
  output.push({
    key: route.key,
    place: route.place,
    summit: route.summit,
    polyline: encodePolyline(points),
    elevationStep: ELEVATION_STEP_METERS,
    elevations
  });
}

const body = output
  .map(
    (route) => `  ${route.key}: {
    place: ${JSON.stringify(route.place)},
    summit: ${route.summit},
    polyline: ${JSON.stringify(route.polyline)},
    elevationStep: ${route.elevationStep},
    elevations: [${route.elevations.join(", ")}]
  }`
  )
  .join(",\n");

writeFileSync(
  OUTPUT,
  `// Generated by scripts/fetch-sample-hikes.mjs — do not edit by hand.
//
// Trails from OpenStreetMap (© OpenStreetMap contributors, ODbL) through
// BRouter's hiking-mountain profile; ground height from SRTM 30 m via
// OpenTopoData, one reading every \`elevationStep\` metres along the line. Read
// only by electron/sampleHikes.ts, and only under HERACLES_SAMPLE_HIKES=1.

export interface SampleHikeRoute {
  /** Where it is, for the reader of this file. */
  place: string;
  /** The top's surveyed height, metres — SRTM reads a summit low. */
  summit: number;
  /** Google polyline encoding, five decimals. */
  polyline: string;
  elevationStep: number;
  /** Metres above sea level, every \`elevationStep\` metres from the start. */
  elevations: readonly number[];
}

export const SAMPLE_HIKE_ROUTES = {
${body}
} satisfies Record<string, SampleHikeRoute>;

export type SampleHikeRouteKey = keyof typeof SAMPLE_HIKE_ROUTES;
`,
  "utf8"
);
console.log(`wrote ${path.relative(repoRoot, OUTPUT)}`);
