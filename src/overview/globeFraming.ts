/**
 * Camera framing maths for the training globe.
 *
 * Kept apart from `ActivityGlobeRenderer` so it can be exercised without WebGL
 * (`npm run test:globe-framing`) — the geometry is the part that is easy to get
 * silently wrong, and a wrong altitude reads as "the globe is broken".
 */
import type { GlobePoint } from "./activityVisitHeatmap";

export interface GlobeCameraView {
  lat: number;
  lng: number;
  altitude: number;
}

/** globe.gl renders through a three.js PerspectiveCamera at its 50° default. */
const GLOBE_FOV_DEGREES = 50;
/** Keeps the outermost place off the panel edge and clear of `globeOffset`. */
const FIT_PADDING = 0.78;
/**
 * Never frame closer than this. Below ~0.42 the card hands over to the street
 * map, so the framing has to leave room for a person to zoom in themselves —
 * and a closer view stops reading as a globe at all.
 */
export const FIT_MIN_ALTITUDE = 0.62;
/** Falls back to the full-panel globe when places are scattered worldwide. */
export const FIT_MAX_ALTITUDE = 2.2;
/** A lone place gets a regional view rather than a degenerate fit. */
export const SINGLE_PLACE_ALTITUDE = 0.7;
/**
 * Past this great-circle radius the outermost places sit on the horizon, where
 * they are squashed to nothing — that is when framing falls back to the latest
 * place instead of trying to hold everything at once.
 */
export const MAX_FIT_ANGLE_DEGREES = 58;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Matches the globe's own limit: the poles cannot be centred usefully. */
export function clampLatitude(lat: number): number {
  return Math.max(-78, Math.min(78, lat));
}

function unitVector(point: GlobePoint): [number, number, number] {
  const lat = point.lat * DEG_TO_RAD;
  const lon = point.lon * DEG_TO_RAD;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

/** Great-circle separation in degrees. */
export function angularDistanceDegrees(a: GlobePoint, b: GlobePoint): number {
  const [ax, ay, az] = unitVector(a);
  const [bx, by, bz] = unitVector(b);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot) * RAD_TO_DEG;
}

/**
 * Averages the points as vectors, so a cluster straddling the antimeridian
 * centres on the cluster instead of halfway around the world.
 */
export function sphericalCenter(points: GlobePoint[]): GlobePoint | null {
  if (points.length === 0) {
    return null;
  }
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const [px, py, pz] = unitVector(point);
    x += px;
    y += py;
    z += pz;
  }
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) {
    // Antipodal points cancel out; the average has no direction to report.
    return points[0] ?? null;
  }
  const clampedZ = Math.max(-1, Math.min(1, z / length));
  return {
    lat: Math.asin(clampedZ) * RAD_TO_DEG,
    lon: Math.atan2(y / length, x / length) * RAD_TO_DEG,
  };
}

function maxAngularDistance(center: GlobePoint, points: GlobePoint[]): number {
  let spread = 0;
  for (const point of points) {
    spread = Math.max(spread, angularDistanceDegrees(center, point));
  }
  return spread;
}

/**
 * Camera altitude (in globe radii above the surface) that keeps a surface point
 * `spreadDegrees` away from the sub-camera point inside the frustum.
 *
 * With the camera at distance `d` from the globe centre, a point θ away sits at
 * screen angle α where `tan α = R·sin θ / (d − R·cos θ)`. Solving for `d` at
 * α = the padded half-FOV and expressing it as an altitude gives the result.
 */
export function altitudeForSpread(
  spreadDegrees: number,
  aspect: number,
): number {
  const halfVertical = (GLOBE_FOV_DEGREES / 2) * DEG_TO_RAD;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // A panel taller than it is wide is bound by the horizontal FOV instead.
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * safeAspect);
  const halfAngle = Math.min(halfVertical, halfHorizontal) * FIT_PADDING;
  const spread =
    Math.max(0, Math.min(spreadDegrees, MAX_FIT_ANGLE_DEGREES)) * DEG_TO_RAD;
  return Math.cos(spread) + Math.sin(spread) / Math.tan(halfAngle) - 1;
}

function clampAltitude(altitude: number, maxAltitude: number): number {
  const ceiling = Math.max(maxAltitude, FIT_MIN_ALTITUDE);
  return Math.min(Math.max(altitude, FIT_MIN_ALTITUDE), ceiling);
}

/**
 * A view holding every place at once, centred on them.
 *
 * `points` must be ordered newest first: when they are too scattered to hold in
 * one frame, the newest place anchors the view and its neighbours decide the
 * zoom. Returns null for an empty list so the caller can keep its own default.
 */
export function computeFitView(
  points: GlobePoint[],
  aspect: number,
  maxAltitude = FIT_MAX_ALTITUDE,
): GlobeCameraView | null {
  const anchor = points[0];
  if (!anchor) {
    return null;
  }
  if (points.length === 1) {
    return {
      lat: clampLatitude(anchor.lat),
      lng: anchor.lon,
      altitude: clampAltitude(SINGLE_PLACE_ALTITUDE, maxAltitude),
    };
  }

  const center = sphericalCenter(points) ?? anchor;
  const spread = maxAngularDistance(center, points);
  if (spread <= MAX_FIT_ANGLE_DEGREES) {
    return {
      lat: clampLatitude(center.lat),
      lng: center.lon,
      altitude: clampAltitude(altitudeForSpread(spread, aspect), maxAltitude),
    };
  }

  const nearby = points.filter(
    (point) => angularDistanceDegrees(anchor, point) <= MAX_FIT_ANGLE_DEGREES,
  );
  return {
    lat: clampLatitude(anchor.lat),
    lng: anchor.lon,
    altitude: clampAltitude(
      altitudeForSpread(maxAngularDistance(anchor, nearby), aspect),
      maxAltitude,
    ),
  };
}

/**
 * Thins a recency-ordered list down to labels that will not sit on top of each
 * other. Nothing in globe.gl does label collision, so separation is decided
 * here in globe degrees.
 */
export function pickSpacedPlaces<T extends GlobePoint>(
  places: T[],
  maxCount: number,
  minSeparationDegrees: number,
): T[] {
  const picked: T[] = [];
  for (const place of places) {
    if (picked.length >= maxCount) {
      break;
    }
    const clear = picked.every(
      (other) =>
        angularDistanceDegrees(other, place) >= minSeparationDegrees,
    );
    if (clear) {
      picked.push(place);
    }
  }
  return picked;
}

/**
 * Selecting a place sits it a little below centre, leaving room for its label.
 * Scaled by altitude so the offset stays the same fraction of the frame at
 * every zoom (≈6.5°, the hand-tuned value, at the full-globe view).
 */
export function focusLatitudeOffset(altitude: number): number {
  return altitude * 3;
}

/**
 * Rough on-screen radius of the framed area, used to space labels relative to
 * how much of the globe is visible rather than by a fixed number of degrees.
 */
export function labelSeparationDegrees(altitude: number): number {
  return Math.max(0.5, altitude * 3.5);
}

/**
 * Screen pixels one degree of globe surface covers under the camera.
 *
 * Half the panel height spans `tan(halfFOV)·R·altitude` world units at that
 * distance, and a degree of surface is `R·π/180` of them — the globe radius
 * cancels, so only the panel and the altitude matter.
 */
export function surfacePixelsPerDegree(
  panelHeight: number,
  altitude: number,
): number {
  const halfVertical = (GLOBE_FOV_DEGREES / 2) * DEG_TO_RAD;
  return (
    (panelHeight * Math.PI) /
    (360 * Math.tan(halfVertical) * Math.max(altitude, 1e-3))
  );
}

/** Below this the dots are dense enough; a finer tier would only crowd them. */
const LAND_DETAIL_MIN_SPACING_PX = 7;
/** Past this the lattice reads as scattered dots, so the next tier is needed. */
const LAND_DETAIL_MAX_SPACING_PX = 12;

/** Smoothstep: how far a tier has faded in at this on-screen dot spacing. */
export function landDetailOpacity(spacingPx: number): number {
  const t =
    (spacingPx - LAND_DETAIL_MIN_SPACING_PX) /
    (LAND_DETAIL_MAX_SPACING_PX - LAND_DETAIL_MIN_SPACING_PX);
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export interface LandDetailLevels {
  /** Opacity of the half-spacing tier. */
  tier1: number;
  /** Opacity of the quarter-spacing tier. */
  tier2: number;
  /**
   * How many times more dots are visible than the coarse lattice alone. The
   * tiers hold 1 : 3 : 12 of the points, and dot size divides by its square
   * root so the pattern keeps the same ink-to-gap ratio as it gets finer.
   */
  density: number;
}

/**
 * How much land detail to show at this framing. Each tier fades in once the one
 * below it has spread past `LAND_DETAIL_MAX_SPACING_PX` on screen, so the dot
 * texture stays put while the coastline it traces gets finer.
 */
export function landDetailLevels(
  panelHeight: number,
  altitude: number,
  coarseStepDegrees = 1,
): LandDetailLevels {
  const perDegree = surfacePixelsPerDegree(panelHeight, altitude);
  const tier1 = landDetailOpacity(perDegree * coarseStepDegrees);
  const tier2 =
    tier1 >= 1 ? landDetailOpacity(perDegree * coarseStepDegrees * 0.5) : 0;
  return { tier1, tier2, density: 1 + 3 * tier1 + 12 * tier2 };
}
