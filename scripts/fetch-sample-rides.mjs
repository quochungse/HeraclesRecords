// Fetches the roads the sample rides follow and writes electron/sampleRideRoutes.ts.
//
// `npm run sample-rides:fetch`. Like fonts:fetch and body-shapes:fetch, the
// output is committed and nothing at build or run time calls this: the sample
// rides (HERACLES_SAMPLE_RIDES=1, see electron/sampleRides.ts) must draw offline.
//
// Two keyless public services, asked a handful of times per run:
//  - the FOSSGIS OSRM bicycle profile (routing.openstreetmap.de), for a line
//    that follows real roads between the waypoints below — a line drawn
//    straight between them crosses lakes and rooftops on the map;
//  - OpenTopoData's SRTM 30 m set, for the ground under it every 100 m, so a
//    climb on the chart is the climb on the map.
import { writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(repoRoot, "electron", "sampleRideRoutes.ts");
const ROUTER = "https://routing.openstreetmap.de/routed-bike/route/v1/driving";
const ELEVATION = "https://api.opentopodata.org/v1/srtm30m";
const ELEVATION_STEP_METERS = 100;
const ELEVATION_BATCH = 100;

/** Waypoints as [lat, lon], in riding order; the router joins them by road. */
const ROUTES = [
  {
    key: "westLake",
    place: "Hồ Tây, Hà Nội",
    waypoints: [
      [21.047, 105.837],
      [21.0438, 105.8245],
      [21.047, 105.8105],
      [21.062, 105.8085],
      [21.071, 105.817],
      [21.066, 105.829],
      [21.056, 105.835],
      [21.047, 105.837]
    ]
  },
  {
    key: "tamDao",
    place: "Tam Đảo, Vĩnh Phúc",
    waypoints: [
      [21.4, 105.625],
      [21.4575, 105.645],
      [21.4, 105.625]
    ]
  },
  {
    key: "baVi",
    place: "Sơn Tây – Ba Vì",
    waypoints: [
      [21.139, 105.505],
      [21.0806, 105.3942],
      [21.069, 105.377],
      [21.0806, 105.3942],
      [21.139, 105.505]
    ]
  },
  {
    key: "socSon",
    place: "Sóc Sơn, Hà Nội",
    waypoints: [
      [21.2603, 105.826],
      [21.287, 105.848],
      [21.278, 105.79],
      [21.2603, 105.826]
    ]
  }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "HeraclesRecords sample-rides fetch" } });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
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
  const coordinates = route.waypoints.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const routed = await getJson(
    `${ROUTER}/${coordinates}?overview=full&geometries=geojson&steps=false`
  );
  if (routed.code !== "Ok") throw new Error(`${route.key}: router said ${routed.code}`);
  const line = routed.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  // Consecutive duplicates come back where one leg ends and the next begins.
  const points = line.filter(
    (point, index) =>
      index === 0 || point[0] !== line[index - 1][0] || point[1] !== line[index - 1][1]
  );
  await sleep(1100);

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

  let climb = 0;
  for (let index = 1; index < elevations.length; index += 1) {
    climb += Math.max(0, elevations[index] - elevations[index - 1]);
  }
  const length = points.reduce(
    (sum, point, index) => (index === 0 ? 0 : sum + haversine(points[index - 1], point)),
    0
  );
  console.log(
    `${route.key}: ${(length / 1000).toFixed(1)} km, ${points.length} points, ` +
      `elevation ${Math.min(...elevations)}–${Math.max(...elevations)} m, ~${climb} m up (raw SRTM)`
  );
  output.push({
    key: route.key,
    place: route.place,
    polyline: encodePolyline(points),
    elevationStep: ELEVATION_STEP_METERS,
    elevations
  });
}

const body = output
  .map(
    (route) => `  ${route.key}: {
    place: ${JSON.stringify(route.place)},
    polyline: ${JSON.stringify(route.polyline)},
    elevationStep: ${route.elevationStep},
    elevations: [${route.elevations.join(", ")}]
  }`
  )
  .join(",\n");

writeFileSync(
  OUTPUT,
  `// Generated by scripts/fetch-sample-rides.mjs — do not edit by hand.
//
// Roads from OpenStreetMap (© OpenStreetMap contributors, ODbL) through the
// FOSSGIS OSRM bicycle profile; ground height from SRTM 30 m via OpenTopoData,
// one reading every \`elevationStep\` metres along the line. Read only by
// electron/sampleRides.ts, and only under HERACLES_SAMPLE_RIDES=1.

export interface SampleRideRoute {
  /** Where it is, for the reader of this file. */
  place: string;
  /** Google polyline encoding, five decimals. */
  polyline: string;
  elevationStep: number;
  /** Metres above sea level, every \`elevationStep\` metres from the start. */
  elevations: readonly number[];
}

export const SAMPLE_RIDE_ROUTES = {
${body}
} satisfies Record<string, SampleRideRoute>;

export type SampleRideRouteKey = keyof typeof SAMPLE_RIDE_ROUTES;
`,
  "utf8"
);
console.log(`wrote ${path.relative(repoRoot, OUTPUT)}`);
