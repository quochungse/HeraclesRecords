// Believable GPS lines for the history rows that have no simulated detail.
import type { TrainingHubActivity } from "../../electron/types";
import { decimate, decodePolyline, haversine, seededRandom } from "../../electron/sampleActivityKit";
import { SAMPLE_RIDE_ROUTES } from "../../electron/sampleRideRoutes";
import { SAMPLE_HIKE_ROUTES } from "../../electron/sampleHikeRoutes";

interface Line {
  points: [number, number][];
  elevations: readonly number[];
  step: number;
}

const lines: Record<string, Line> = {};
for (const [key, route] of Object.entries(SAMPLE_RIDE_ROUTES)) {
  lines[`ride:${key}`] = { points: decodePolyline(route.polyline), elevations: route.elevations, step: route.elevationStep };
}
for (const [key, route] of Object.entries(SAMPLE_HIKE_ROUTES)) {
  lines[`hike:${key}`] = { points: decodePolyline(route.polyline), elevations: route.elevations, step: route.elevationStep };
}

function nearest(lat: number, lon: number, foot: boolean): Line | undefined {
  let best: Line | undefined;
  let bestKm = 25;
  for (const [key, line] of Object.entries(lines)) {
    if (foot && key === "ride:baVi") continue;
    const km = haversine([lat, lon], line.points[0]!) / 1000;
    if (km < bestKm) {
      bestKm = km;
      best = line;
    }
  }
  return best;
}

/** A wandering loop of about `meters`, for a place no stored line covers. */
function wanderingLoop(lat: number, lon: number, meters: number, seed: string): [number, number][] {
  const r = seededRandom(seed);
  const n = 160;
  const radius = Math.max(400, meters / (2 * Math.PI)) / 111_320;
  const out: [number, number][] = [];
  let wobble = 0;
  for (let i = 0; i <= n; i += 1) {
    wobble = wobble * 0.9 + (r() - 0.5) * 0.35;
    const angle = (i / n) * Math.PI * 2;
    const rad = radius * (1 + wobble);
    out.push([lat + Math.sin(angle) * rad, lon + (Math.cos(angle) * rad) / Math.cos((lat * Math.PI) / 180)]);
  }
  return out;
}

export function historyTrack(a: TrainingHubActivity, start: { lat: number; lon: number }) {
  const foot = a.sportType < 200;
  const line = nearest(start.lat, start.lon, foot);
  const meters = a.distance ?? 8000;
  let pts: [number, number][];
  let elev: number[] = [];
  if (line) {
    // Walk the stored line from its start for the activity's distance, back and forth.
    pts = [];
    let walked = 0;
    let i = 0;
    let dir = 1;
    pts.push(line.points[0]!);
    while (walked < meters && pts.length < 4000) {
      const next = i + dir;
      if (next < 0 || next >= line.points.length) {
        dir = -dir;
        continue;
      }
      walked += haversine(line.points[i]!, line.points[next]!);
      i = next;
      pts.push(line.points[i]!);
    }
    elev = pts.map((_, k) => line.elevations[Math.min(line.elevations.length - 1, Math.round((k / pts.length) * (line.elevations.length - 1)))] ?? 20);
  } else {
    pts = wanderingLoop(start.lat, start.lon, meters, `loop-${a.activityId}`);
    elev = pts.map(() => 15);
  }
  const r = seededRandom(`jitter-${a.activityId}`);
  const points = decimate(
    pts.map(([lat, lon], k) => ({
      lat: lat + (r() - 0.5) * 0.00008,
      lon: lon + (r() - 0.5) * 0.00008,
      elevation: elev[k] ?? 15,
      distance: (meters * k) / Math.max(1, pts.length - 1)
    })),
    220
  );
  return points;
}
