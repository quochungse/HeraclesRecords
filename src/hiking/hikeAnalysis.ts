import type {
  TrainingHubActivityPause,
  TrainingHubActivitySeriesPoint
} from "../../electron/types";

/**
 * What a hike's samples say that its summary does not.
 *
 * A run's summary is most of its story; a hike's is not. COROS's hike mode
 * leaves auto-pause off, so its activity time holds the lunch at the camp and
 * the half hour at the top, and its average speed is an average over them.
 * What a walker reads a day by — how long they were actually moving, where
 * they stopped, how fast they gained height on the climbs and lost it on the
 * way down, how the day compares with the book time — is all in the samples,
 * and worked out here from them. A test holds the arithmetic.
 *
 * Every function takes the series **as COROS sends it**, on the wall clock:
 * a sample's `elapsed` runs straight through a pause, which is how a pause is
 * told from a stop the watch kept recording through.
 */

/**
 * A gap between two samples longer than this, with no pause in it, is a
 * dropout: the sample before it stands for its own second. Anything shorter is
 * held — COROS samples a second at a time, but smart recording spaces samples
 * out on a steady stretch, and every one of those seconds is walking.
 */
const MAX_GAP_SECONDS = 30;
/**
 * Either side of a sample that its speed is taken over — and never less than
 * one sample either side, so a sparsely recorded stretch still has a speed.
 * Short, so a stop's edges are not smeared into the walking either side of it:
 * a watch holds its distance while the walker stands, so a stop reads as one.
 */
const SPEED_WINDOW_SECONDS = 5;
/** Slower than this, a walker is standing still — a steep pitch is walked at three times it. */
const STATIONARY_SPEED = 0.25;
/** Standing still this long is a stop, and comes out of the moving time. */
const STOP_MIN_SECONDS = 20;
/** And this long is a rest, and is listed. */
export const REST_MIN_SECONDS = 120;

interface TimedPoint extends TrainingHubActivitySeriesPoint {
  elapsed: number;
  distance: number;
}

function timedPoints(series: readonly TrainingHubActivitySeriesPoint[]): TimedPoint[] {
  return series.filter(
    (point): point is TimedPoint =>
      typeof point.elapsed === "number" &&
      Number.isFinite(point.elapsed) &&
      typeof point.distance === "number" &&
      Number.isFinite(point.distance)
  );
}

/** Seconds of the wall-clock span [from, to) the watch spent paused. */
function pausedWithin(
  pauses: readonly TrainingHubActivityPause[],
  from: number,
  to: number
): number {
  let paused = 0;
  for (const pause of pauses) {
    paused += Math.max(0, Math.min(to, pause.start + pause.duration) - Math.max(from, pause.start));
  }
  return paused;
}

interface Timeline {
  /** Seconds each sample stands for: up to the next, pauses taken out. */
  held: number[];
  /** Whether the stretch from the sample before is broken — a pause or a dropout lies across it. */
  brokenBefore: boolean[];
}

/**
 * How long each sample stands for, and where the recording breaks. A pause is
 * taken out of the gap it lies in — held across it, every pause would add
 * seconds to the moving time that the watch never recorded — and a gap too
 * long to be anything but a dropout stands for one second.
 */
function timeline(
  points: readonly TimedPoint[],
  pauses: readonly TrainingHubActivityPause[]
): Timeline {
  const held: number[] = [];
  const brokenBefore: boolean[] = points.map(() => false);
  for (let index = 0; index < points.length; index += 1) {
    const next = points[index + 1];
    if (!next) {
      held.push(1);
      continue;
    }
    const from = points[index]!.elapsed;
    const paused = pausedWithin(pauses, from, next.elapsed);
    const gap = Math.max(next.elapsed - from - paused, 0);
    held.push(gap <= MAX_GAP_SECONDS ? gap : 1);
    brokenBefore[index + 1] = paused > 0 || gap > MAX_GAP_SECONDS;
  }
  return { held, brokenBefore };
}

export interface HikeStop {
  /** Index of the first sample of the stop. */
  from: number;
  /** Index of the last. */
  to: number;
  /** Seconds from the start, wall clock. */
  startElapsed: number;
  seconds: number;
  /** Metres into the hike. */
  distance: number;
  altitude?: number;
  /** A pause the watch took, rather than a stop it recorded through. */
  paused: boolean;
}

export interface HikeMovement {
  /** Seconds the samples cover, pauses not included. */
  recordedSeconds: number;
  /** Of those, the seconds spent moving. */
  movingSeconds: number;
  /** Per sample of `timedPoints`, whether it was moving. */
  moving: boolean[];
  /** Per sample, the seconds it stands for, pauses taken out. */
  held: number[];
  /** Every stop of `STOP_MIN_SECONDS` or more, and every pause, in order. */
  stops: HikeStop[];
}

/**
 * Moving time, and the stops.
 *
 * A stop is found in the samples by distance, not by a missing pace: the watch
 * keeps recording a position that wanders a few metres while the walker sits,
 * so the speed is taken over ten seconds and anything under a crawl is
 * standing still. A pause — auto-pause on, or the button pressed at the top —
 * is a gap in the wall clock, and is a stop of its own.
 */
export function hikeMovement(
  series: readonly TrainingHubActivitySeriesPoint[],
  pauses: readonly TrainingHubActivityPause[] = []
): HikeMovement {
  const points = timedPoints(series);
  const { held, brokenBefore } = timeline(points, pauses);
  const moving = new Array<boolean>(points.length).fill(true);

  // The speed over a window around each sample, never across a break: a pause
  // is not a stretch of standing still, and must not be read as one.
  for (let index = 0; index < points.length; index += 1) {
    const at = points[index]!.elapsed;
    let low = index;
    while (
      low > 0 &&
      !brokenBefore[low] &&
      (low === index || points[low - 1]!.elapsed >= at - SPEED_WINDOW_SECONDS)
    ) {
      low -= 1;
    }
    let high = index;
    while (
      high < points.length - 1 &&
      !brokenBefore[high + 1] &&
      (high === index || points[high + 1]!.elapsed <= at + SPEED_WINDOW_SECONDS)
    ) {
      high += 1;
    }
    const span = points[high]!.elapsed - points[low]!.elapsed;
    const covered = points[high]!.distance - points[low]!.distance;
    moving[index] = span <= 0 || covered / span >= STATIONARY_SPEED;
  }

  const stops: HikeStop[] = [];
  let start = -1;
  const close = (end: number) => {
    const seconds = held.slice(start, end + 1).reduce((sum, value) => sum + value, 0);
    if (seconds >= STOP_MIN_SECONDS) {
      const first = points[start]!;
      stops.push({
        from: start,
        to: end,
        startElapsed: first.elapsed,
        seconds,
        distance: first.distance,
        ...(typeof first.altitude === "number" ? { altitude: first.altitude } : {}),
        paused: false
      });
    } else {
      // Too short to be a stop: a hesitation at a fork is walking.
      for (let index = start; index <= end; index += 1) moving[index] = true;
    }
    start = -1;
  };
  for (let index = 0; index < points.length; index += 1) {
    if (!moving[index] && start === -1) start = index;
    if (moving[index] && start !== -1) close(index - 1);
  }
  if (start !== -1) close(points.length - 1);

  for (const pause of pauses) {
    if (!(pause.duration > 0)) continue;
    // The last sample before the watch stopped is where the walker stood.
    let before = -1;
    for (let index = 0; index < points.length && points[index]!.elapsed <= pause.start; index += 1) {
      before = index;
    }
    const at = points[Math.max(before, 0)];
    if (!at) continue;
    stops.push({
      from: Math.max(before, 0),
      to: Math.max(before, 0),
      startElapsed: pause.start,
      seconds: pause.duration,
      distance: at.distance,
      ...(typeof at.altitude === "number" ? { altitude: at.altitude } : {}),
      paused: true
    });
  }
  stops.sort((left, right) => left.startElapsed - right.startElapsed);

  const recordedSeconds = held.reduce((sum, value) => sum + value, 0);
  const movingSeconds = held.reduce((sum, value, index) => sum + (moving[index] ? value : 0), 0);
  return { recordedSeconds, movingSeconds, moving, held, stops };
}

/** The stops long enough to be called rests — the ones a walker would name. */
export function hikeRests(movement: HikeMovement): HikeStop[] {
  return movement.stops.filter((stop) => stop.seconds >= REST_MIN_SECONDS);
}

// --------------------------------------------------------------- terrain --

/** Metres between the points the trail is read at. */
const STEP_METERS = 25;
/** Either side of a point that its height is averaged over — a barometer's wobble is not a hill. */
const SMOOTH_METERS = 50;
/** Steeper than this either way is climbing or descending; between is the flat. */
const TERRAIN_GRADE = 0.04;

interface TrailPoint {
  distance: number;
  altitude: number;
  /** Seconds of moving time to here. */
  moving: number;
  hr?: number;
}

/**
 * The trail every `STEP_METERS`, heights smoothed, on the **moving** clock —
 * so an hour's lunch at a camp is not an hour spent on the 25 m it was eaten
 * beside, and a climb's rate is the rate it was climbed at.
 */
function trailProfile(
  series: readonly TrainingHubActivitySeriesPoint[],
  movement: HikeMovement
): TrailPoint[] {
  const points = timedPoints(series);
  const { held } = movement;
  const located: { distance: number; altitude: number; moving: number; hr?: number }[] = [];
  let clock = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    if (typeof point.altitude === "number" && Number.isFinite(point.altitude)) {
      located.push({
        distance: point.distance,
        altitude: point.altitude,
        moving: clock,
        ...(typeof point.hr === "number" && point.hr > 0 ? { hr: point.hr } : {})
      });
    }
    if (movement.moving[index]) clock += held[index]!;
  }
  if (located.length < 2) {
    return [];
  }

  const end = located[located.length - 1]!.distance;
  const raw: TrailPoint[] = [];
  let cursor = 0;
  for (let distance = located[0]!.distance; distance <= end; distance += STEP_METERS) {
    while (cursor < located.length - 2 && located[cursor + 1]!.distance < distance) cursor += 1;
    const from = located[cursor]!;
    const to = located[cursor + 1]!;
    const span = to.distance - from.distance;
    const t = span > 0 ? Math.min(1, Math.max(0, (distance - from.distance) / span)) : 0;
    raw.push({
      distance,
      altitude: from.altitude + (to.altitude - from.altitude) * t,
      moving: from.moving + (to.moving - from.moving) * t,
      ...(from.hr !== undefined ? { hr: from.hr } : {})
    });
  }

  const reach = Math.round(SMOOTH_METERS / STEP_METERS);
  return raw.map((point, index) => {
    const window = raw.slice(Math.max(0, index - reach), index + reach + 1);
    return {
      ...point,
      altitude: window.reduce((sum, entry) => sum + entry.altitude, 0) / window.length
    };
  });
}

export type TerrainKind = "up" | "flat" | "down";

export interface TerrainShare {
  kind: TerrainKind;
  /** Metres walked on it. */
  distance: number;
  /** Seconds of moving time on it. */
  seconds: number;
  /** Metres climbed on the up, lost on the down; nothing on the flat. */
  height: number;
  /** Km/h. */
  speed?: number;
  /** Metres an hour gained (up) or lost (down). */
  verticalRate?: number;
  avgHr?: number;
}

/**
 * The hike split into climbing, flat and descending, by the grade of every
 * 25 m — the split a walker reads a day in the mountains by. Up tells how
 * fast they gain height; down, which a runner's page never asks about, tells
 * how the knees and the ground treated them: a steep descent walked at a
 * climber's pace is technical ground, not a slow walker.
 */
export function hikeTerrain(
  series: readonly TrainingHubActivitySeriesPoint[],
  movement: HikeMovement
): TerrainShare[] {
  const trail = trailProfile(series, movement);
  const buckets: Record<TerrainKind, { distance: number; seconds: number; height: number; hrs: number[] }> = {
    up: { distance: 0, seconds: 0, height: 0, hrs: [] },
    flat: { distance: 0, seconds: 0, height: 0, hrs: [] },
    down: { distance: 0, seconds: 0, height: 0, hrs: [] }
  };
  for (let index = 1; index < trail.length; index += 1) {
    const from = trail[index - 1]!;
    const to = trail[index]!;
    const length = to.distance - from.distance;
    if (length <= 0) continue;
    const rise = to.altitude - from.altitude;
    const grade = rise / length;
    const kind: TerrainKind = grade > TERRAIN_GRADE ? "up" : grade < -TERRAIN_GRADE ? "down" : "flat";
    const bucket = buckets[kind];
    bucket.distance += length;
    bucket.seconds += Math.max(0, to.moving - from.moving);
    if (kind !== "flat") bucket.height += Math.abs(rise);
    if (to.hr !== undefined) bucket.hrs.push(to.hr);
  }

  return (["up", "flat", "down"] as const).flatMap((kind) => {
    const bucket = buckets[kind];
    if (bucket.distance <= 0) return [];
    const hours = bucket.seconds / 3600;
    return [
      {
        kind,
        distance: bucket.distance,
        seconds: bucket.seconds,
        height: bucket.height,
        ...(hours > 0 ? { speed: bucket.distance / 1000 / hours } : {}),
        ...(hours > 0 && kind !== "flat" ? { verticalRate: bucket.height / hours } : {}),
        ...(bucket.hrs.length > 0
          ? { avgHr: bucket.hrs.reduce((sum, value) => sum + value, 0) / bucket.hrs.length }
          : {})
      }
    ];
  });
}

// ------------------------------------------------------------------ legs --

/** Height the trail has to turn back by before a climb is over, or a descent. */
const LEG_TURN_METERS = 30;
/** A leg smaller than this is undulation, not an ascent anyone would name. */
export const LEG_MIN_HEIGHT = 60;
/** How far ahead a leg's end is tested for still climbing (or descending) … */
const LEG_TRIM_METERS = 100;
/** … and how steep that has to be, or the end is walked in. */
const LEG_TRIM_GRADE = 0.03;

export interface HikeLeg {
  direction: "up" | "down";
  startMeters: number;
  endMeters: number;
  lengthMeters: number;
  fromAltitude: number;
  toAltitude: number;
  /** Metres gained or lost, always positive. */
  height: number;
  /** Average grade, 0..1, always positive. */
  grade: number;
  /** Moving seconds on it. */
  seconds: number;
  /** Metres an hour. */
  verticalRate?: number;
  avgHr?: number;
}

/**
 * The ascents and descents of the day, bottom to top and top to bottom.
 *
 * Read off the smoothed trail as a walker would name them: a climb runs from
 * a low point to the next high one, carried through any dip that gives back
 * less than 30 m, and the same the other way — trimmed of the flat approach
 * and the flat top, which are walking, not climbing. Legs under 60 m are the ground
 * rolling, and are left out of the list — they are in the terrain split.
 */
export function hikeLegs(
  series: readonly TrainingHubActivitySeriesPoint[],
  movement: HikeMovement
): HikeLeg[] {
  const trail = trailProfile(series, movement);
  if (trail.length < 2) {
    return [];
  }

  // The turning points: each extreme the trail leaves by more than the turn.
  const turns: number[] = [0];
  let direction: "up" | "down" | null = null;
  let extreme = 0;
  // Until the trail has moved by a turn's worth either way, it has no
  // direction: the highest and lowest so far are both candidates.
  let highest = 0;
  let lowest = 0;
  for (let index = 1; index < trail.length; index += 1) {
    const altitude = trail[index]!.altitude;
    if (direction === null) {
      if (altitude > trail[highest]!.altitude) highest = index;
      if (altitude < trail[lowest]!.altitude) lowest = index;
      if (trail[highest]!.altitude - trail[lowest]!.altitude >= LEG_TURN_METERS) {
        // Whichever came first is where the trail turned.
        const turn = highest > lowest ? lowest : highest;
        if (turn !== 0) turns.push(turn);
        direction = highest > lowest ? "up" : "down";
        extreme = highest > lowest ? highest : lowest;
      }
      continue;
    }
    const held = trail[extreme]!.altitude;
    if (direction === "up") {
      if (altitude >= held) {
        extreme = index;
      } else if (held - altitude >= LEG_TURN_METERS) {
        turns.push(extreme);
        direction = "down";
        extreme = index;
      }
    } else if (altitude <= held) {
      extreme = index;
    } else if (altitude - held >= LEG_TURN_METERS) {
      turns.push(extreme);
      direction = "up";
      extreme = index;
    }
  }
  turns.push(direction === null ? trail.length - 1 : extreme);
  if (turns[turns.length - 1] !== trail.length - 1) {
    turns.push(trail.length - 1);
  }

  // The approach to a climb and the plateau past its top are not the climb:
  // each end is walked in while the 100 m beyond it is flatter than 3%.
  const trimSteps = Math.round(LEG_TRIM_METERS / STEP_METERS);
  const slope = (from: number, to: number) =>
    (trail[to]!.altitude - trail[from]!.altitude) / (trail[to]!.distance - trail[from]!.distance);

  const legs: HikeLeg[] = [];
  for (let index = 1; index < turns.length; index += 1) {
    let start = turns[index - 1]!;
    let end = turns[index]!;
    const sign = trail[end]!.altitude >= trail[start]!.altitude ? 1 : -1;
    while (end - start > trimSteps && sign * slope(start, start + trimSteps) < LEG_TRIM_GRADE) start += 1;
    while (end - start > trimSteps && sign * slope(end - trimSteps, end) < LEG_TRIM_GRADE) end -= 1;
    const from = trail[start]!;
    const to = trail[end]!;
    const rise = to.altitude - from.altitude;
    const height = Math.abs(rise);
    const lengthMeters = to.distance - from.distance;
    if (height < LEG_MIN_HEIGHT || lengthMeters <= 0) continue;
    const seconds = Math.max(0, to.moving - from.moving);
    const hrs = trail
      .slice(start, end + 1)
      .flatMap((point) => (point.hr !== undefined ? [point.hr] : []));
    legs.push({
      direction: rise > 0 ? "up" : "down",
      startMeters: from.distance,
      endMeters: to.distance,
      lengthMeters,
      fromAltitude: from.altitude,
      toAltitude: to.altitude,
      height,
      grade: height / lengthMeters,
      seconds,
      ...(seconds > 0 ? { verticalRate: height / (seconds / 3600) } : {}),
      ...(hrs.length > 0 ? { avgHr: hrs.reduce((sum, value) => sum + value, 0) / hrs.length } : {})
    });
  }
  return legs;
}

// ------------------------------------------------------------ the book --

/**
 * Naismith's rule, the book time every hiking guide still quotes: an hour for
 * every 5 km, plus an hour for every 600 m of ascent. Seconds.
 */
export function naismithSeconds(distanceMeters: number, ascentMeters: number): number {
  return (distanceMeters / 5000 + Math.max(0, ascentMeters) / 600) * 3600;
}

/** Highest and lowest the hike went, off the samples. */
export function altitudeRange(
  series: readonly TrainingHubActivitySeriesPoint[]
): { highest: number; lowest: number } | undefined {
  let highest = Number.NEGATIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;
  for (const point of series) {
    if (typeof point.altitude === "number" && Number.isFinite(point.altitude)) {
      highest = Math.max(highest, point.altitude);
      lowest = Math.min(lowest, point.altitude);
    }
  }
  return Number.isFinite(highest) ? { highest, lowest } : undefined;
}
