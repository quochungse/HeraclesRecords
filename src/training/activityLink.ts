import type {
  TrainingHubActivityLap,
  TrainingHubActivitySeriesPoint
} from "../../electron/types";

/*
 * What a session's chart, route map and lap table share: one cursor (a moment)
 * and one selection (a stretch), both in seconds on the chart's own clock — the
 * series' `elapsed` as the page hands it over, pauses out on a sport's page.
 * Each of the three sets them and draws them; none knows the others exist.
 *
 * Node-free and React-free, so a suite reaches the arithmetic.
 */

/** A stretch of the session, in seconds on the chart's clock. */
export interface LinkSpan {
  from: number;
  to: number;
}

/** A lap as a stretch; `index` is COROS's own, counted from one. */
export interface LapSpan extends LinkSpan {
  index: number;
}

/** Who moved the cursor: the one who did draws nothing for it, it has its own. */
export type CursorSource = "chart" | "map";

export interface ActivityLinkState {
  cursor: number | null;
  cursorSource: CursorSource | null;
  selection: LinkSpan | null;
  /** A lap under the pointer or the focus: shown, not chosen. */
  preview: LinkSpan | null;
}

export interface ActivityLink {
  getState: () => ActivityLinkState;
  subscribe: (listener: () => void) => () => void;
  setCursor: (elapsed: number | null, source?: CursorSource) => void;
  setSelection: (span: LinkSpan | null) => void;
  setPreview: (span: LinkSpan | null) => void;
  /** The laps as stretches, set by whoever owns the link. */
  laps: () => readonly LapSpan[];
  setLaps: (laps: readonly LapSpan[]) => void;
  /** Chooses a lap; pressed again it lets go, and `extend` reaches from the lap chosen before. */
  selectLap: (index: number, extend?: boolean) => void;
  /** Forgets everything: another session's page. */
  reset: () => void;
}

/** A selection shorter than this is a slip of the hand, not a stretch. */
export const MIN_SELECTION_SECONDS = 5;

const EMPTY: ActivityLinkState = { cursor: null, cursorSource: null, selection: null, preview: null };

export function sameSpan(a: LinkSpan | null, b: LinkSpan | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return Math.abs(a.from - b.from) < 0.5 && Math.abs(a.to - b.to) < 0.5;
}

export function createActivityLink(): ActivityLink {
  let state = EMPTY;
  let laps: readonly LapSpan[] = [];
  let anchorLap: number | null = null;
  const listeners = new Set<() => void>();
  const set = (next: ActivityLinkState) => {
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setCursor: (elapsed, source = "chart") => {
      if (elapsed === state.cursor && (elapsed === null || source === state.cursorSource)) {
        return;
      }
      set({ ...state, cursor: elapsed, cursorSource: elapsed === null ? null : source });
    },
    setSelection: (span) => {
      if (sameSpan(span, state.selection)) {
        return;
      }
      anchorLap = null;
      set({ ...state, selection: span });
    },
    setPreview: (span) => {
      if (sameSpan(span, state.preview)) {
        return;
      }
      set({ ...state, preview: span });
    },
    laps: () => laps,
    setLaps: (next) => {
      laps = next;
    },
    selectLap: (index, extend = false) => {
      const lap = laps.find((entry) => entry.index === index);
      if (!lap) {
        return;
      }
      const anchor = extend ? laps.find((entry) => entry.index === anchorLap) : undefined;
      if (anchor) {
        set({
          ...state,
          selection: { from: Math.min(anchor.from, lap.from), to: Math.max(anchor.to, lap.to) }
        });
        return;
      }
      if (sameSpan(state.selection, lap)) {
        anchorLap = null;
        set({ ...state, selection: null });
        return;
      }
      anchorLap = index;
      set({ ...state, selection: { from: lap.from, to: lap.to } });
    },
    reset: () => {
      anchorLap = null;
      if (state !== EMPTY) {
        set(EMPTY);
      }
    }
  };
}

/**
 * Laps as stretches of the clock.
 *
 * COROS states a lap's own duration, never a running total, so the bounds are
 * accumulated here. A lap missing its duration would shift every bound after
 * it, so an incomplete lap ends the sequence instead.
 */
export function lapSpans(laps: readonly TrainingHubActivityLap[]): LapSpan[] {
  const spans: LapSpan[] = [];
  let at = 0;
  for (const lap of laps) {
    const span = lap.duration;
    if (span === undefined || !Number.isFinite(span) || span <= 0) {
      break;
    }
    spans.push({ index: lap.index, from: at, to: at + span });
    at += span;
  }
  return spans;
}

/** The lap a moment falls in; the last one takes its own end. */
export function lapAt(spans: readonly LapSpan[], elapsed: number): LapSpan | undefined {
  const last = spans[spans.length - 1];
  return (
    spans.find((span) => elapsed >= span.from && elapsed < span.to) ??
    (last && elapsed >= last.from && elapsed <= last.to + 0.5 ? last : undefined)
  );
}

/** The first and last lap of a stretch that is exactly whole laps; null for any other stretch. */
export function wholeLaps(
  spans: readonly LapSpan[],
  stretch: LinkSpan
): { first: LapSpan; last: LapSpan } | null {
  const first = spans.find((span) => Math.abs(span.from - stretch.from) < 0.5);
  const last = spans.find((span) => Math.abs(span.to - stretch.to) < 0.5);
  return first && last && last.to > first.from ? { first, last } : null;
}

/** How a lap stands to a stretch: all of it inside, part of it, or none. */
export function lapCover(lap: LinkSpan, stretch: LinkSpan | null): "whole" | "part" | "none" {
  if (!stretch) {
    return "none";
  }
  if (lap.from >= stretch.from - 0.5 && lap.to <= stretch.to + 0.5) {
    return "whole";
  }
  return lap.to > stretch.from + 0.5 && lap.from < stretch.to - 0.5 ? "part" : "none";
}

/** A moment moved onto a lap's edge when it is within `tolerance` seconds of one. */
export function snapToLaps(spans: readonly LapSpan[], elapsed: number, tolerance: number): number {
  let best = elapsed;
  let gap = tolerance;
  const edges = spans.length > 0 ? [spans[0]!.from, ...spans.map((span) => span.to)] : [];
  for (const edge of edges) {
    const distance = Math.abs(edge - elapsed);
    if (distance <= gap) {
      gap = distance;
      best = edge;
    }
  }
  return best;
}

/**
 * The clock against the distance, for reading one off the other: the samples
 * that carry both, in order. A chart drawn over distance still selects in
 * seconds, so every x it draws goes through here.
 */
export interface LinkClock {
  elapsed: number[];
  distance: number[];
}

export function linkClock(series: readonly TrainingHubActivitySeriesPoint[]): LinkClock {
  const elapsed: number[] = [];
  const distance: number[] = [];
  for (const point of series) {
    if (typeof point.elapsed !== "number" || typeof point.distance !== "number") {
      continue;
    }
    const last = elapsed.length - 1;
    // Both rise or the sample is left out: a watch that repeats a second, or
    // steps its distance back on a fix, would make one of the two readings
    // ambiguous.
    if (last >= 0 && (point.elapsed <= elapsed[last]! || point.distance < distance[last]!)) {
      continue;
    }
    elapsed.push(point.elapsed);
    distance.push(point.distance);
  }
  return { elapsed, distance };
}

function readAcross(from: readonly number[], to: readonly number[], value: number): number | undefined {
  const last = from.length - 1;
  if (last < 0) {
    return undefined;
  }
  if (value <= from[0]!) {
    return to[0]!;
  }
  if (value >= from[last]!) {
    return to[last]!;
  }
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (from[mid]! <= value) {
      low = mid;
    } else {
      high = mid;
    }
  }
  const span = from[high]! - from[low]!;
  const share = span > 0 ? (value - from[low]!) / span : 0;
  return to[low]! + (to[high]! - to[low]!) * share;
}

export function distanceAtElapsed(clock: LinkClock, elapsed: number): number | undefined {
  return readAcross(clock.elapsed, clock.distance, elapsed);
}

export function elapsedAtDistance(clock: LinkClock, distance: number): number | undefined {
  return readAcross(clock.distance, clock.elapsed, distance);
}

/** What a stretch's figures are read off: a sample, and how it is cut. */
export type StretchPoint = TrainingHubActivitySeriesPoint;

export interface StretchReading {
  /** State a ride's power; a run's is the watch's own estimate and is left out. */
  power: boolean;
  /** Average the cadence over the turning alone: a ride's coasting and a hike's rests read 0. */
  cadenceSkipsZeros: boolean;
  /** State the height gained: a hike's and a trail run's. */
  gain: boolean;
}

export interface StretchFigures {
  distance?: number;
  duration?: number;
  /** Seconds per kilometre, from the stretch's own distance and clock. */
  pace?: number;
  /** The same figure the other way up, km/h. */
  speed?: number;
  hr?: number;
  hrMax?: number;
  cadence?: number;
  power?: number;
  gain?: number;
  /** Seconds at each heart-rate reading's band, by the band's place in `bands`. */
  zoneSeconds?: number[];
}

/**
 * Metres climbed in a stretch, as a barometric watch counts them: a rise is
 * only counted once it has held for 2 m, so the altimeter's own wobble on the
 * flat adds nothing.
 */
export function stretchGain(points: readonly StretchPoint[]): number | undefined {
  let gain = 0;
  let anchor: number | undefined;
  for (const point of points) {
    if (typeof point.altitude !== "number") continue;
    if (anchor === undefined) {
      anchor = point.altitude;
    } else if (point.altitude - anchor >= 2) {
      gain += point.altitude - anchor;
      anchor = point.altitude;
    } else if (anchor - point.altitude >= 2) {
      anchor = point.altitude;
    }
  }
  return anchor === undefined ? undefined : gain;
}

/** The longest a sample is taken to stand for: past it the watch was not recording. */
const LONGEST_SAMPLE_SECONDS = 10;

/**
 * A stretch's figures, off the recorded samples inside it — never off a
 * chart's downsampled rows, where a row is a bucket's mean: one holding ten
 * seconds of pedalling and twenty of freewheeling reads 30 rpm.
 *
 * `key` is what the stretch is cut on: the clock, or the distance on a series
 * that carries no clock. `bands` are heart-rate floors, easiest first.
 */
export function stretchFigures(
  series: readonly StretchPoint[],
  key: "elapsed" | "distance",
  from: number,
  to: number,
  reading: StretchReading,
  bands?: readonly number[]
): StretchFigures | null {
  const inside = series.filter((point) => {
    const at = point[key];
    return typeof at === "number" && at >= from && at <= to;
  });
  if (inside.length < 2) {
    return null;
  }

  const mean = (pick: (point: StretchPoint) => number | undefined, skipZeros = false) => {
    let sum = 0;
    let count = 0;
    for (const point of inside) {
      const value = pick(point);
      if (typeof value === "number" && (!skipZeros || value > 0)) {
        sum += value;
        count += 1;
      }
    }
    return count === 0 ? undefined : sum / count;
  };

  // From the first and last samples that carry a distance, not the stretch's
  // ends: a watch records the clock before GPS has a fix and after it has
  // stopped counting, and a stretch ending on such a sample stated no distance.
  const firstDistance = inside.find((point) => typeof point.distance === "number")?.distance;
  let lastDistance: number | undefined;
  for (let index = inside.length - 1; index >= 0; index -= 1) {
    if (typeof inside[index]!.distance === "number") {
      lastDistance = inside[index]!.distance;
      break;
    }
  }
  const distance =
    firstDistance !== undefined && lastDistance !== undefined ? lastDistance - firstDistance : undefined;
  const first = inside[0]!;
  const last = inside[inside.length - 1]!;
  const duration =
    typeof first.elapsed === "number" && typeof last.elapsed === "number"
      ? last.elapsed - first.elapsed
      : undefined;

  // The stretch's own pace, from its own distance and clock, rather than the
  // mean of per-sample paces — a run that stopped would otherwise read faster
  // than it was, since a stopped sample carries no pace at all.
  const pace =
    distance !== undefined && duration !== undefined && distance > 0
      ? duration / (distance / 1000)
      : mean((point) => point.pace);

  let hrMax: number | undefined;
  for (const point of inside) {
    if (typeof point.hr === "number" && (hrMax === undefined || point.hr > hrMax)) {
      hrMax = point.hr;
    }
  }

  let zoneSeconds: number[] | undefined;
  if (bands && bands.length > 1) {
    zoneSeconds = bands.map(() => 0);
    for (let index = 1; index < inside.length; index += 1) {
      const point = inside[index]!;
      const before = inside[index - 1]!;
      if (
        typeof point.hr !== "number" ||
        typeof point.elapsed !== "number" ||
        typeof before.elapsed !== "number"
      ) {
        continue;
      }
      const seconds = Math.min(LONGEST_SAMPLE_SECONDS, Math.max(0, point.elapsed - before.elapsed));
      let band = 0;
      for (let at = 1; at < bands.length; at += 1) {
        if (point.hr >= bands[at]!) {
          band = at;
        }
      }
      zoneSeconds[band]! += seconds;
    }
  }

  return {
    distance,
    duration,
    pace,
    speed: pace !== undefined && pace > 0 ? 3600 / pace : undefined,
    hr: mean((point) => point.hr),
    hrMax,
    cadence: mean((point) => point.cadence, reading.cadenceSkipsZeros),
    power: reading.power ? mean((point) => point.power) : undefined,
    gain: reading.gain ? stretchGain(inside) : undefined,
    zoneSeconds
  };
}
