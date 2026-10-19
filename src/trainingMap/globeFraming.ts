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
 * Never frame closer than this. Below ~0.24 the card hands over to the street
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

/** A place as a label sees it: where it is, and which first-level region holds it. */
export interface LabelPlace extends GlobePoint {
  key: string;
  region?: { id: string };
}

/** One label on the globe: the place it stands on, and the places it speaks for. */
export interface PlaceLabelGroup<T extends LabelPlace> {
  lead: T;
  /** The lead first. */
  members: T[];
  /**
   * Pixels this name is raised over its pin — just enough to clear a name in
   * another region that would cover it, and 0 when it has room.
   */
  lift: number;
}

/**
 * A label's box as `.training-map-globe-label.is-secondary` draws it: 10px
 * type, 8px padding a side, 132px at most, 21px tall, its foot `LABEL_FOOT_PX`
 * over the pin. Measuring the DOM would need the labels drawn first; an
 * estimate a little generous is what keeps two names from touching.
 */
export const LABEL_HEIGHT_PX = 21;
export const LABEL_FOOT_PX = 10;
const LABEL_MAX_WIDTH_PX = 132;
const LABEL_CHAR_PX = 6;
const LABEL_PADDING_PX = 16;
const LABEL_GAP_PX = 4;

export function estimateLabelWidth(text: string): number {
  return Math.min(
    LABEL_MAX_WIDTH_PX,
    LABEL_PADDING_PX + text.length * LABEL_CHAR_PX,
  );
}

/** "Hà Nội +1": the lead's name, and how many more places it speaks for. */
export function mergedLabelText(leadText: string, others: number): string {
  return others > 0 ? `${leadText} +${others}` : leadText;
}

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function labelBox(
  x: number,
  y: number,
  width: number,
  lift: number,
): LabelBox {
  const bottom = y - LABEL_FOOT_PX - lift;
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: bottom - LABEL_HEIGHT_PX,
    bottom,
  };
}

function boxesTouch(a: LabelBox, b: LabelBox): boolean {
  return (
    a.left < b.right + LABEL_GAP_PX &&
    b.left < a.right + LABEL_GAP_PX &&
    a.top < b.bottom + LABEL_GAP_PX &&
    b.top < a.bottom + LABEL_GAP_PX
  );
}

/**
 * Every place gets a label, and the labels' boxes on screen decide how they
 * share the globe. A name that would touch another's in the same first-level
 * region joins it ("Hà Nội +1"); in a different region — or in none — names
 * are never merged, and one that would touch is lifted just over the name in
 * its way, and again over the next, until it is clear. A name with room keeps its place at the pin. Nothing in
 * globe.gl does label collision, so it is decided here, on a flat projection
 * around the frame's centre at `pixelsPerDegree` (`surfacePixelsPerDegree`).
 * `places` is newest first, which is the order a group takes its lead from.
 */
export function groupPlaceLabels<T extends LabelPlace>(
  places: T[],
  textOf: (place: T) => string,
  pixelsPerDegree: number,
): PlaceLabelGroup<T>[] {
  const centre = sphericalCenter(places);
  const cosLat = Math.cos((centre?.lat ?? 0) * DEG_TO_RAD);
  const screen = (place: T) => {
    let dLon = place.lon - (centre?.lon ?? 0);
    dLon = ((((dLon + 180) % 360) + 360) % 360) - 180;
    return {
      x: dLon * cosLat * pixelsPerDegree,
      y: -(place.lat - (centre?.lat ?? 0)) * pixelsPerDegree,
    };
  };
  const placed: Array<{
    group: PlaceLabelGroup<T>;
    x: number;
    y: number;
    /** Where the lead's name would sit unlifted: what a neighbour merges against. */
    home: LabelBox;
    box: LabelBox;
  }> = [];
  for (const place of places) {
    const { x, y } = screen(place);
    const width = estimateLabelWidth(textOf(place));
    const home = labelBox(x, y, width, 0);
    const regionId = place.region?.id;
    const joined = regionId
      ? placed.find(
          (entry) =>
            entry.group.lead.region?.id === regionId &&
            boxesTouch(entry.home, home),
        )
      : undefined;
    if (joined) {
      const { group } = joined;
      group.members.push(place);
      // "+N" widens the name; later names are kept clear of the wider box.
      const wider = estimateLabelWidth(
        mergedLabelText(textOf(group.lead), group.members.length - 1),
      );
      joined.home = labelBox(joined.x, joined.y, wider, 0);
      joined.box = labelBox(joined.x, joined.y, wider, group.lift);
      continue;
    }
    let lift = 0;
    let box = home;
    for (;;) {
      const inTheWay = placed.filter((entry) => boxesTouch(entry.box, box));
      if (inTheWay.length === 0) {
        break;
      }
      // Its foot just over the highest top in the way; each step only rises,
      // so this ends.
      lift = Math.max(
        lift + 1,
        ...inTheWay.map(
          (entry) => y - LABEL_FOOT_PX - entry.box.top + LABEL_GAP_PX,
        ),
      );
      box = labelBox(x, y, width, lift);
    }
    placed.push({
      group: { lead: place, members: [place], lift },
      x,
      y,
      home,
      box,
    });
  }
  return placed.map((entry) => entry.group);
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

/**
 * How near the pointer, on screen, a place has to be to take the street map to
 * itself when zooming in hands over. Near enough that the athlete was plainly
 * zooming at it; further than that they were zooming at the map, and the
 * street map opens where they pointed. At the hand-off a pixel is about 2 km,
 * so this is some 120 km on the ground; at 96 px a pointer over empty hills
 * 150 km from every place still opened on one.
 */
export const STREET_SNAP_PX = 64;

/**
 * The place nearest `anchor` on screen, if one is within `maxPx`. Candidates
 * are what the camera can see: a place behind the globe projects onto the
 * screen too, and must be left out before it gets here.
 */
export function nearestOnScreen<T>(
  anchor: { x: number; y: number },
  candidates: ReadonlyArray<{ item: T; x: number; y: number }>,
  maxPx: number = STREET_SNAP_PX,
): T | undefined {
  let best: T | undefined;
  let bestDistance = maxPx;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
    if (distance <= bestDistance) {
      best = candidate.item;
      bestDistance = distance;
    }
  }
  return best;
}
