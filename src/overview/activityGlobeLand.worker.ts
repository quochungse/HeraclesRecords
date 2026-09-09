import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo";
import type { GeometryCollection, Topology } from "topojson-specification";
import { feature } from "topojson-client";
import landAtlas from "world-atlas/land-110m.json";

interface LandGeometryMessage {
  positions: ArrayBuffer;
  strengths: ArrayBuffer;
  tiers: ArrayBuffer;
}

type LandTopology = Topology<{ land: GeometryCollection }>;

/** Spacing of the coarse lattice — what the globe shows at full-planet zoom. */
const LAND_DOT_STEP_DEGREES = 1;
/**
 * Each further tier halves that spacing, and the renderer fades one in as the
 * camera closes and the tier below it spreads too thin. Tier 0 is generated at
 * exactly the coordinates the single-tier version used, so the far view is
 * unchanged; 3 tiers reach 0.25°, the resolution of the land mask below.
 */
/*
 * What the tiers cost, so nobody has to re-derive it: three tiers put the fine
 * lattice at 0.25°, which is sixteen times the points of the single 1° lattice
 * this replaced — roughly 190k instead of 12k, about 3.8 MB across the three
 * buffers. The build loop runs once per process and is cached in the renderer's
 * module scope, so the price is a few hundred ms of worker time on first paint;
 * the draw stays cheap because a tier that has faded out is given a point size
 * of zero and never rasterises.
 */
const LAND_DOT_TIERS = 3;
const LAND_DOT_TIER_SPAN = 2 ** (LAND_DOT_TIERS - 1);
const LAND_DOT_FINE_STEP_DEGREES = LAND_DOT_STEP_DEGREES / LAND_DOT_TIER_SPAN;
const GLOBE_RADIUS = 100;
const SURFACE_ALTITUDE = 0.0025;
const MASK_WIDTH = 1440;
const MASK_HEIGHT = 720;

function coordinateToVector(
  lat: number,
  lng: number,
  radius: number,
): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

/**
 * Which tier a point of the fine lattice belongs to — the coarsest lattice that
 * already contains it.
 *
 * A tier `k` lattice takes every `2^(TIERS-1-k)`-th row and column, and shifts
 * alternate rows by half its own spacing, which is what gives the dots their
 * staggered look. Reproducing that shift in fine-lattice columns is why the
 * column offset is compared against the row index of the tier's own lattice.
 */
function latticeTier(row: number, column: number): number {
  for (let tier = 0; tier < LAND_DOT_TIERS - 1; tier += 1) {
    const span = LAND_DOT_TIER_SPAN >> tier;
    if (row % span !== 0) {
      continue;
    }
    const tierRow = row / span;
    if (column % span === ((tierRow % 2) * span) / 2) {
      return tier;
    }
  }
  return LAND_DOT_TIERS - 1;
}

function buildLandGeometry(): LandGeometryMessage {
  const topology = landAtlas as unknown as LandTopology;
  const land = feature(topology, topology.objects.land);
  const raster = new OffscreenCanvas(MASK_WIDTH, MASK_HEIGHT);
  const context = raster.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to create the geography mask.");
  }

  const projection = geoEquirectangular().fitExtent(
    [
      [0, 0],
      [MASK_WIDTH, MASK_HEIGHT],
    ],
    { type: "Sphere" },
  );
  context.fillStyle = "#fff";
  context.beginPath();
  geoPath(
    projection,
    context as unknown as CanvasRenderingContext2D,
  )(land as GeoPermissibleObjects);
  context.fill();

  const pixels = context.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT).data;
  const coordinates: number[] = [];
  const pointTiers: number[] = [];
  for (let row = 0; ; row += 1) {
    const lat = -84 + row * LAND_DOT_FINE_STEP_DEGREES;
    if (lat > 84) {
      break;
    }

    const lonStep =
      LAND_DOT_FINE_STEP_DEGREES /
      Math.max(Math.cos((lat * Math.PI) / 180), 0.08);
    let column = 0;
    for (
      let lon = -180 + (row % 2) * lonStep * 0.5;
      lon < 180;
      lon += lonStep, column += 1
    ) {
      const projected = projection([lon, lat]);
      if (!projected) {
        continue;
      }
      const x = Math.min(
        MASK_WIDTH - 1,
        Math.max(0, Math.round(projected[0])),
      );
      const y = Math.min(
        MASK_HEIGHT - 1,
        Math.max(0, Math.round(projected[1])),
      );
      if (pixels[(y * MASK_WIDTH + x) * 4 + 3]! > 128) {
        coordinates.push(lon, lat);
        pointTiers.push(latticeTier(row, column));
      }
    }
  }

  const pointCount = coordinates.length / 2;
  const positions = new Float32Array(pointCount * 3);
  const strengths = new Float32Array(pointCount);
  const tiers = Float32Array.from(pointTiers);
  const radius = GLOBE_RADIUS * (1 + SURFACE_ALTITUDE);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const [x, y, z] = coordinateToVector(
      coordinates[pointIndex * 2 + 1]!,
      coordinates[pointIndex * 2]!,
      radius,
    );
    positions[pointIndex * 3] = x;
    positions[pointIndex * 3 + 1] = y;
    positions[pointIndex * 3 + 2] = z;
    strengths[pointIndex] =
      0.72 + (((pointIndex * 2_654_435_761) >>> 0) % 997) / 3_560;
  }

  return {
    positions: positions.buffer,
    strengths: strengths.buffer,
    tiers: tiers.buffer,
  };
}

const message = buildLandGeometry();
const workerScope = self as unknown as {
  postMessage: (message: LandGeometryMessage, transfer: Transferable[]) => void;
};
workerScope.postMessage(message, [
  message.positions,
  message.strengths,
  message.tiers,
]);

