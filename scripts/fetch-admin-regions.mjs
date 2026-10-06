/**
 * Regenerates `src/trainingMap/adminRegions.json`: every first-level
 * administrative region in the world (a province, a state, a French
 * département), as outlines small enough to ship and accurate enough to say
 * which region an activity started in.
 *
 * "Where you've been" and the Hall of Records count places with it: two
 * activities in different regions are two places, however close. The lookup
 * runs on the machine, so naming a region asks no geocoder anything.
 *
 * **The output is committed, and a build never runs this.** Same rule as
 * `fonts:fetch`: the app builds and runs with no network. mapshaper (MPL-2.0)
 * is installed into a temporary folder, used, and thrown away; it is not a
 * dependency of this project, and nothing of it is in the output.
 *
 * Two sources:
 *
 * - **Natural Earth admin-1, 1:10m** (public domain) for the world. Its
 *   outlines are simplified here to about a kilometre: measured against the
 *   unsimplified set, 0.02% of points on land change region (0.25% in Việt
 *   Nam, whose provinces are small). The whole file is 2.6 MB, 1.7 MB
 *   compressed in an installer.
 * - **OpenStreetMap** (ODbL) for Việt Nam, because Natural Earth 5.1 still has
 *   the 63 provinces from before 1 July 2025, when they were merged into 34.
 *   Overpass names the 34; Nominatim returns their outlines, simplified on its
 *   side to about 200 m.
 *
 * The format is the app's own, built to be small and quick to read: a region is
 * `[id, name, country, rings]`, each ring a Google encoded polyline at
 * `precision` (1e4, about 11 m), and a country's name is written once in
 * `countries`. Rings are read even-odd, so holes and islands need no flag.
 *
 * Run: npm run admin-regions:fetch
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "src", "trainingMap", "adminRegions.json");
const MAPSHAPER = "mapshaper@0.7.78";
const NATURAL_EARTH_URL =
  "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];
/** Việt Nam's country relation, as an Overpass area. */
const VIETNAM_AREA = 3600049915;
const NOMINATIM_LOOKUP = "https://nominatim.openstreetmap.org/lookup";
const USER_AGENT = "HeraclesRecords-admin-regions/1.0 (+https://heraclesrecords.com)";
/** Encoded-polyline precision: 1e4 is about 11 m, far under the simplification. */
const PRECISION = 1e4;

const workDir = mkdtempSync(join(tmpdir(), "admin-regions-"));

function cleanup() {
  rmSync(workDir, { recursive: true, force: true });
}

async function download(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(240_000)
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response;
}

function mapshaper(args) {
  execFileSync(join(workDir, "node_modules", ".bin", "mapshaper"), args, {
    cwd: workDir,
    stdio: ["ignore", "ignore", "inherit"]
  });
}

async function naturalEarth() {
  const zip = join(workDir, "ne.zip");
  writeFileSync(zip, Buffer.from(await (await download(NATURAL_EARTH_URL)).arrayBuffer()));
  const out = join(workDir, "ne.json");
  mapshaper([
    "-i",
    zip,
    // The archive also holds a VERSION file, which mapshaper reads as an
    // empty table of its own; the outlines are the one polygon layer.
    "-target",
    "type=polygon",
    "-filter",
    'adm0_a3 != "VNM"',
    "-filter-fields",
    "adm1_code,name,name_en,admin,iso_a2,adm0_a3",
    "-simplify",
    "interval=1000",
    "keep-shapes",
    "-o",
    out,
    "format=geojson",
    "precision=0.0001"
  ]);
  const features = JSON.parse(readFileSync(out, "utf8")).features;
  return features.flatMap((feature) => {
    const p = feature.properties;
    if (!feature.geometry) return [];
    // A handful of territories carry no ISO code ("-1"); their three-letter
    // code is still one country per code, which is all a count needs.
    const country = /^[A-Z]{2}$/.test(p.iso_a2 ?? "") ? p.iso_a2 : p.adm0_a3;
    return [
      {
        id: p.adm1_code,
        name: p.name || p.name_en || p.admin,
        country,
        countryName: p.admin,
        geometry: feature.geometry
      }
    ];
  });
}

async function overpassProvinces() {
  const query = `[out:json][timeout:120];rel(area:${VIETNAM_AREA})["boundary"="administrative"]["admin_level"="4"];out tags;`;
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await download(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query })
      });
      const elements = (await response.json()).elements ?? [];
      if (elements.length > 0) return elements;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`no Overpass server answered: ${lastError}`);
}

/** "Thành phố Hà Nội" → "Hà Nội", "Tỉnh Lâm Đồng" → "Lâm Đồng". */
function vietnameseProvinceName(name) {
  return name.replace(/^(Tỉnh|Thành phố)\s+/u, "");
}

async function vietnam() {
  const relations = await overpassProvinces();
  if (relations.length < 30) {
    throw new Error(`Overpass listed ${relations.length} provinces of Việt Nam; expected 34`);
  }
  const url = new URL(NOMINATIM_LOOKUP);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("polygon_threshold", "0.002");
  url.searchParams.set("osm_ids", relations.map((relation) => `R${relation.id}`).join(","));
  const features = (await (await download(url)).json()).features;
  const tagsById = new Map(relations.map((relation) => [relation.id, relation.tags]));
  return features.map((feature) => {
    const tags = tagsById.get(feature.properties.osm_id) ?? {};
    return {
      id: tags["ISO3166-2"] ?? `VN-R${feature.properties.osm_id}`,
      name: vietnameseProvinceName(tags.name ?? feature.properties.name),
      country: "VN",
      countryName: "Vietnam",
      geometry: feature.geometry
    };
  });
}

function encodeSigned(value) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** One ring as a polyline: latitude then longitude, each a delta on the last. */
function encodeRing(ring) {
  let lastLat = 0;
  let lastLon = 0;
  let out = "";
  for (const [lon, lat] of ring) {
    const qLat = Math.round(lat * PRECISION);
    const qLon = Math.round(lon * PRECISION);
    out += encodeSigned(qLat - lastLat) + encodeSigned(qLon - lastLon);
    lastLat = qLat;
    lastLon = qLon;
  }
  return out;
}

function ringsOf(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat().filter((ring) => ring.length >= 4);
}

try {
  console.log(`installing ${MAPSHAPER} into a temporary folder…`);
  execFileSync("npm", ["install", "--prefix", workDir, "--no-save", "--silent", MAPSHAPER], {
    stdio: "inherit"
  });
  console.log("reading Natural Earth admin-1…");
  const world = await naturalEarth();
  console.log("reading Việt Nam's provinces from OpenStreetMap…");
  const vn = await vietnam();

  const countries = {};
  const regions = [];
  for (const region of [...vn, ...world]) {
    const rings = ringsOf(region.geometry).map(encodeRing);
    if (rings.length === 0) continue;
    countries[region.country] ??= region.countryName;
    regions.push([region.id, region.name, region.country, rings]);
  }
  const ids = new Set(regions.map((region) => region[0]));
  if (ids.size !== regions.length) {
    throw new Error("two regions share an id");
  }
  const output = {
    version: 1,
    precision: PRECISION,
    sources: [
      "Natural Earth admin-1 states and provinces 1:10m (public domain), simplified to ~1 km",
      "Việt Nam: OpenStreetMap contributors (ODbL 1.0), provinces from 1 July 2025"
    ],
    countries,
    regions
  };
  writeFileSync(OUT, `${JSON.stringify(output)}\n`);
  console.log(
    `wrote ${regions.length} regions in ${Object.keys(countries).length} countries to ${OUT} (${Math.round(
      JSON.stringify(output).length / 1024
    )} KB)`
  );
} finally {
  cleanup();
}
