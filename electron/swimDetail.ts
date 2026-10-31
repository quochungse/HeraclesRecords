// A swim, read out of COROS's detail payload: its lengths, the intervals swum
// between rests, the pool, and the few figures a swimming list is read by.
//
// The field names are COROS's web app's own (training.coros.com reads the
// same payload): `lapList` carries two groups, `type` 1 the lengths and `type`
// 2 the laps, each a `lapItemList`; an item has `swimStyle`, `strokes`,
// `avgSwolf`, `avgStrokeRateLen` and `swimRelationIndex`, which ties a length
// to its lap; a rest is an item with no distance. The summary adds `lengths`,
// `totalCadence` (the strokes), `avgSwolfLen`, `avgCadence` (the stroke rate)
// and `waterTemperature` in hundredths of a degree. The pool's length is not
// in the payload at all — it is what every length measures.
//
// Distances arrive in centimetres and times in hundredths of a second, as
// everywhere in this payload. A length's time is kept to the hundredth: a
// second is five per cent of a 25 m length.
//
// Written for both layers, like activityMetrics.ts: the main process parses
// and summarises, the renderer reads the same figures. No `node:` imports.

import type {
  SwimEffort,
  SwimStyle,
  SwimStyleTotals,
  SwimSummary,
  TrainingHubActivityLap,
  TrainingHubSwimDetail,
  TrainingHubSwimInterval,
  TrainingHubSwimLength
} from "./types";

/**
 * Bump when a stored swim summary changes shape or meaning; a row written by
 * an older version is read again rather than trusted.
 */
export const SWIM_SUMMARY_VERSION = 1;

export const POOL_SWIM_SPORT_TYPE = 300;
export const OPEN_WATER_SPORT_TYPE = 301;

export function isSwimSportType(sportType: number | undefined): boolean {
  return sportType === POOL_SWIM_SPORT_TYPE || sportType === OPEN_WATER_SPORT_TYPE;
}

/** The order strokes are listed in, everywhere. */
export const SWIM_STYLES: readonly SwimStyle[] = [
  "free",
  "back",
  "breast",
  "fly",
  "medley",
  "mixed",
  "drill",
  "unknown"
];

/**
 * COROS's `swimStyle` codes, as its web app's `SWIM_STYLE_TYPE` names them.
 * 5 is a drill logged by hand and 6 one the watch timed; both are drills. 255
 * is COROS's "medley" in the loose sense — an interval whose lengths changed
 * stroke — and 7 the individual medley, fly to free. 0 is not detected and
 * 254 a custom stroke; neither says which stroke it was.
 */
const STYLE_BY_CODE: Readonly<Record<number, SwimStyle>> = {
  1: "free",
  2: "breast",
  3: "back",
  4: "fly",
  5: "drill",
  6: "drill",
  7: "medley",
  255: "mixed"
};

/** COROS's `lapList` groups, as its web app names them (`{ Lap: 2, Length: 1 }`). */
const LAP_TYPE_LENGTH = 1;
const LAP_TYPE_LAP = 2;

/** The standard distances a best effort is read over, in metres. */
export const SWIM_EFFORT_DISTANCES: readonly number[] = [100, 200, 400, 800, 1500];

const METERS_PER_YARD = 0.9144;

function num(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function positive(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function swimStyleOf(code: unknown): SwimStyle {
  const value = num(code);
  return (value !== undefined ? STYLE_BY_CODE[value] : undefined) ?? "unknown";
}

/** The items of one `lapList` group, wherever the payload keeps the list. */
function lapGroupItems(raw: Record<string, unknown>, type: number): Record<string, unknown>[] {
  const summary = asRecord(raw.summary);
  for (const source of [raw, summary]) {
    const list = source?.lapList;
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      const group = asRecord(entry);
      if (group && num(group.type) === type && Array.isArray(group.lapItemList)) {
        return group.lapItemList.flatMap((item) => {
          const record = asRecord(item);
          return record ? [record] : [];
        });
      }
    }
  }
  return [];
}

/** One `lapItemList` entry, a length or a lap, in metres and seconds. */
interface SwimPiece {
  style: SwimStyle;
  distance: number;
  seconds: number;
  strokes?: number;
  swolf?: number;
  strokeRate?: number;
  avgHr?: number;
  maxHr?: number;
  relation?: number;
  /** No distance: the swimmer stood at the wall. */
  rest: boolean;
}

function readPiece(item: Record<string, unknown>): SwimPiece {
  const distanceRaw = num(item.distance) ?? num(item.totalDistance) ?? 0;
  let timeRaw = num(item.time) ?? num(item.totalTime) ?? num(item.duration);
  if (timeRaw === undefined) {
    const start = num(item.startTimestamp);
    const end = num(item.endTimestamp);
    timeRaw = start !== undefined && end !== undefined && end > start ? end - start : 0;
  }
  const distance = Math.max(0, distanceRaw / 100);
  const seconds = Math.max(0, round(timeRaw / 100, 2));
  const style = swimStyleOf(item.swimStyle);
  // A drill is timed, not counted: COROS shows no SWOLF for one, and a stroke
  // count on a kick set is the watch guessing.
  const counts = style !== "drill";
  const strokes = counts ? positive(item.strokes) : undefined;
  const swolf = counts ? (positive(item.avgSwolf) ?? positive(item.swolf)) : undefined;
  const strokeRate = counts
    ? (positive(item.avgStrokeRateLen) ?? positive(item.avgStrokeRate) ?? positive(item.avgCadence))
    : undefined;
  const avgHr = positive(item.avgHr);
  const maxHr = positive(item.maxHr);
  const relation = num(item.swimRelationIndex);
  return {
    style,
    distance: round(distance, 2),
    seconds,
    ...(strokes !== undefined ? { strokes: Math.round(strokes) } : {}),
    ...(swolf !== undefined ? { swolf: Math.round(swolf) } : {}),
    ...(strokeRate !== undefined ? { strokeRate: Math.round(strokeRate) } : {}),
    ...(avgHr !== undefined ? { avgHr: Math.round(avgHr) } : {}),
    ...(maxHr !== undefined ? { maxHr: Math.round(maxHr) } : {}),
    ...(relation !== undefined ? { relation } : {}),
    rest: distance <= 0
  };
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function nearThird(value: number, tolerance: number): boolean {
  return Math.abs(value * 3 - Math.round(value * 3)) < tolerance * 3;
}

/**
 * The pool, from what its lengths measure: the median length, so a drill
 * logged as 50 m in a 25 m pool does not move it. A length that is a whole
 * number of yards and no tidy number of metres — 22.86 m — is a 25 yd pool and
 * is said in yards; 33⅓ m pools exist in both units and are snapped to the
 * third.
 */
export function poolFromLengths(
  distances: readonly number[]
): { poolLength: number; poolUnit: "m" | "yd" } | undefined {
  const middle = median(distances.filter((distance) => distance > 0));
  if (middle === undefined || middle < 10) {
    return undefined;
  }
  const yards = middle / METERS_PER_YARD;
  if (!nearThird(middle, 0.02) && nearThird(yards, 0.02)) {
    return {
      poolLength: round((Math.round(yards * 3) / 3) * METERS_PER_YARD, 3),
      poolUnit: "yd"
    };
  }
  return {
    poolLength: nearThird(middle, 0.02) ? round(Math.round(middle * 3) / 3, 3) : round(middle, 2),
    poolUnit: "m"
  };
}

/** One stroke, or `mixed` when the lengths changed it. */
function styleOfLengths(lengths: readonly TrainingHubSwimLength[]): SwimStyle | undefined {
  const styles = new Set(lengths.map((length) => length.style).filter((style) => style !== "unknown"));
  if (styles.size === 0) {
    return undefined;
  }
  return styles.size === 1 ? [...styles][0] : "mixed";
}

/** Strokes a minute over the lengths that carry a count. */
function strokeRateOf(lengths: readonly TrainingHubSwimLength[]): number | undefined {
  let strokes = 0;
  let seconds = 0;
  for (const length of lengths) {
    if (length.strokes !== undefined && length.seconds > 0) {
      strokes += length.strokes;
      seconds += length.seconds;
    }
  }
  return seconds > 0 && strokes > 0 ? Math.round((strokes / seconds) * 60) : undefined;
}

function swolfOf(lengths: readonly TrainingHubSwimLength[]): number | undefined {
  const scored = lengths.filter((length) => length.swolf !== undefined);
  if (scored.length > 0) {
    return Math.round(scored.reduce((sum, length) => sum + length.swolf!, 0) / scored.length);
  }
  const counted = lengths.filter((length) => length.strokes !== undefined);
  return counted.length > 0
    ? Math.round(
        counted.reduce((sum, length) => sum + length.seconds + length.strokes!, 0) / counted.length
      )
    : undefined;
}

/**
 * Lengths into the intervals they were swum in: by `swimRelationIndex` where
 * both sides carry it, otherwise in order, each interval taking lengths until
 * its distance is covered.
 */
function assignLengths(
  lengths: TrainingHubSwimLength[],
  intervals: { relation?: number; distance: number }[]
): TrainingHubSwimLength[][] {
  const groups: TrainingHubSwimLength[][] = intervals.map(() => []);
  const related =
    intervals.every((interval) => interval.relation !== undefined) &&
    lengths.every((length) => (length as { relation?: number }).relation !== undefined);
  if (related) {
    const byRelation = new Map<number, number>();
    intervals.forEach((interval, position) => byRelation.set(interval.relation!, position));
    for (const length of lengths) {
      const position = byRelation.get((length as { relation?: number }).relation!);
      if (position !== undefined) {
        groups[position]!.push(length);
      }
    }
    return groups;
  }

  let cursor = 0;
  intervals.forEach((interval, position) => {
    let covered = 0;
    while (cursor < lengths.length && covered < interval.distance - 0.5) {
      const length = lengths[cursor]!;
      groups[position]!.push(length);
      covered += length.distance;
      cursor += 1;
    }
  });
  return groups;
}

export interface ParseSwimOptions {
  sportType?: number;
  /**
   * The laps the generic parser read, for a payload with no typed groups — an
   * open-water swim splits by distance and has no lengths.
   */
  laps?: readonly TrainingHubActivityLap[];
}

/**
 * The swim in a detail payload, or nothing when it is not a swim. A pool swim
 * with no lengths — a watch that lost count — still answers, with its
 * intervals and no pool.
 */
export function parseSwimDetail(
  raw: Record<string, unknown>,
  { sportType, laps = [] }: ParseSwimOptions = {}
): TrainingHubSwimDetail | undefined {
  const lengthItems = lapGroupItems(raw, LAP_TYPE_LENGTH);
  // Every activity is asked: a payload naming no sport is a swim only when its
  // lengths carry a stroke, and a run's hundreds of laps are not read for one.
  if (!isSwimSportType(sportType) && !lengthItems.some((item) => swimStyleOf(item.swimStyle) !== "unknown")) {
    return undefined;
  }
  const lengthPieces = lengthItems.map(readPiece);
  const lapPieces = lapGroupItems(raw, LAP_TYPE_LAP).map(readPiece);
  const summary = asRecord(raw.summary) ?? raw;
  const openWater = sportType === OPEN_WATER_SPORT_TYPE;

  // Lengths, in order, each carrying the rest taken before it.
  const lengths: (TrainingHubSwimLength & { relation?: number })[] = [];
  let pendingRest = 0;
  let restInLengths = 0;
  if (!openWater) {
    for (const piece of lengthPieces) {
      if (piece.rest) {
        pendingRest += piece.seconds;
        restInLengths += piece.seconds;
        continue;
      }
      if (piece.seconds <= 0) {
        continue;
      }
      lengths.push({
        index: lengths.length + 1,
        style: piece.style,
        distance: piece.distance,
        seconds: piece.seconds,
        ...(piece.strokes !== undefined ? { strokes: piece.strokes } : {}),
        ...(piece.swolf !== undefined
          ? { swolf: piece.swolf }
          : piece.strokes !== undefined
            ? { swolf: Math.round(piece.seconds) + piece.strokes }
            : {}),
        ...(piece.strokeRate !== undefined
          ? { strokeRate: piece.strokeRate }
          : piece.strokes !== undefined
            ? { strokeRate: Math.round((piece.strokes / piece.seconds) * 60) }
            : {}),
        ...(piece.avgHr !== undefined ? { avgHr: piece.avgHr } : {}),
        ...(pendingRest >= 1 && lengths.length > 0 ? { restBefore: round(pendingRest, 1) } : {}),
        ...(piece.relation !== undefined ? { relation: piece.relation } : {})
      });
      pendingRest = 0;
    }
  }

  // Intervals: COROS's laps with the rests between them folded onto the one
  // before; failing those, the lengths split where a rest broke them; failing
  // those, the laps the generic parser found.
  type Draft = Omit<TrainingHubSwimInterval, "index" | "lengths"> & { relation?: number };
  const drafts: Draft[] = [];
  let restInLaps = 0;
  if (lapPieces.length > 0) {
    for (const piece of lapPieces) {
      if (piece.rest) {
        restInLaps += piece.seconds;
        const previous = drafts[drafts.length - 1];
        if (previous && piece.seconds >= 1) {
          previous.restAfter = round((previous.restAfter ?? 0) + piece.seconds, 1);
        }
        continue;
      }
      if (piece.seconds <= 0) {
        continue;
      }
      drafts.push({
        style: piece.style,
        distance: piece.distance,
        seconds: piece.seconds,
        ...(piece.strokes !== undefined ? { strokes: piece.strokes } : {}),
        ...(piece.swolf !== undefined ? { swolf: piece.swolf } : {}),
        ...(piece.strokeRate !== undefined ? { strokeRate: piece.strokeRate } : {}),
        ...(piece.avgHr !== undefined ? { avgHr: piece.avgHr } : {}),
        ...(piece.maxHr !== undefined ? { maxHr: piece.maxHr } : {}),
        ...(piece.relation !== undefined ? { relation: piece.relation } : {})
      });
    }
  } else if (lengths.length > 0) {
    for (const length of lengths) {
      const current = drafts[drafts.length - 1];
      if (!current || length.restBefore !== undefined) {
        if (current && length.restBefore !== undefined) {
          current.restAfter = length.restBefore;
        }
        drafts.push({ style: "unknown", distance: 0, seconds: 0 });
      }
      const draft = drafts[drafts.length - 1]!;
      draft.distance = round(draft.distance + length.distance, 2);
      draft.seconds = round(draft.seconds + length.seconds, 2);
    }
  } else {
    for (const lap of laps) {
      if ((lap.distance ?? 0) <= 0 || (lap.duration ?? 0) <= 0) {
        continue;
      }
      drafts.push({
        style: "unknown",
        distance: round(lap.distance!, 2),
        seconds: lap.duration!,
        ...(lap.avgCadence !== undefined && lap.avgCadence > 0
          ? { strokeRate: Math.round(lap.avgCadence) }
          : {}),
        ...(lap.avgHr !== undefined ? { avgHr: lap.avgHr } : {}),
        ...(lap.maxHr !== undefined ? { maxHr: lap.maxHr } : {})
      });
    }
  }

  const groups = lengths.length > 0 ? assignLengths(lengths, drafts) : drafts.map(() => []);
  const intervals: TrainingHubSwimInterval[] = drafts.map((draft, position) => {
    const members = groups[position] ?? [];
    for (const length of members) {
      length.interval = position + 1;
    }
    // The first length of an interval follows the rest the lap list recorded,
    // where the length list itself had no rest item there.
    const before = drafts[position - 1]?.restAfter;
    if (members[0] && members[0].restBefore === undefined && before !== undefined) {
      members[0].restBefore = before;
    }
    const counted = members.filter((length) => length.strokes !== undefined);
    const strokes =
      draft.strokes ?? (counted.length > 0 ? counted.reduce((sum, length) => sum + length.strokes!, 0) : undefined);
    const style =
      draft.style !== "unknown" ? draft.style : (styleOfLengths(members) ?? "unknown");
    const swolf = draft.swolf ?? swolfOf(members);
    const strokeRate = draft.strokeRate ?? strokeRateOf(members);
    const { relation: _relation, ...rest } = draft;
    return {
      ...rest,
      index: position + 1,
      style,
      ...(members.length > 0 ? { lengths: members.length } : {}),
      ...(strokes !== undefined ? { strokes } : {}),
      ...(swolf !== undefined ? { swolf } : {}),
      ...(strokeRate !== undefined ? { strokeRate } : {})
    };
  });

  const pool = openWater ? undefined : poolFromLengths(lengths.map((length) => length.distance));
  const swimSeconds = round(
    intervals.length > 0
      ? intervals.reduce((sum, interval) => sum + interval.seconds, 0)
      : lengths.reduce((sum, length) => sum + length.seconds, 0),
    1
  );
  const restSeconds = round(restInLaps > 0 ? restInLaps : restInLengths, 1);

  const countedStrokes = lengths.reduce((sum, length) => sum + (length.strokes ?? 0), 0);
  const totalStrokes = countedStrokes > 0 ? countedStrokes : positive(summary.totalCadence);
  const avgSwolf =
    positive(summary.avgSwolfLen) ??
    positive(summary.avgSwolf) ??
    positive(summary.swolf) ??
    swolfOf(lengths);
  const avgStrokeRate =
    positive(summary.avgStrokeRate) ?? positive(summary.avgCadence) ?? strokeRateOf(lengths);
  // Hundredths of a degree, as COROS's web app reads it; a whole-degree value
  // is taken as it is.
  const water = positive(summary.waterTemperature);
  const waterTemperatureC = water === undefined ? undefined : round(water > 100 ? water / 100 : water, 1);

  return {
    ...(pool ?? {}),
    lengths: lengths.map(({ relation: _relation, ...length }) => length),
    intervals,
    ...(swimSeconds > 0 ? { swimSeconds } : {}),
    ...(restSeconds > 0 ? { restSeconds } : {}),
    ...(totalStrokes !== undefined ? { totalStrokes: Math.round(totalStrokes) } : {}),
    ...(avgSwolf !== undefined ? { avgSwolf: Math.round(avgSwolf) } : {}),
    ...(avgStrokeRate !== undefined ? { avgStrokeRate: Math.round(avgStrokeRate) } : {}),
    ...(waterTemperatureC !== undefined ? { waterTemperatureC } : {})
  };
}

/**
 * The fastest freestyle stretch over each standard distance, swum without
 * stopping: lengths in a row inside one interval, with no rest between them.
 * Where the lengths do not add up to the distance exactly — four 25 yd
 * lengths are 91 m — the shortest run of lengths that covers it is taken and
 * its time scaled to the distance.
 */
export function bestSwimEfforts(
  lengths: readonly TrainingHubSwimLength[],
  distances: readonly number[] = SWIM_EFFORT_DISTANCES
): SwimEffort[] {
  const runs: TrainingHubSwimLength[][] = [];
  let current: TrainingHubSwimLength[] = [];
  let previous: TrainingHubSwimLength | undefined;
  for (const length of lengths) {
    const breaks =
      length.style !== "free" ||
      length.distance <= 0 ||
      length.restBefore !== undefined ||
      (previous !== undefined && previous.interval !== length.interval);
    if (breaks && current.length > 0) {
      runs.push(current);
      current = [];
    }
    if (length.style === "free" && length.distance > 0) {
      current.push(length);
    }
    previous = length;
  }
  if (current.length > 0) {
    runs.push(current);
  }

  const efforts: SwimEffort[] = [];
  for (const target of distances) {
    let best: number | undefined;
    for (const run of runs) {
      let start = 0;
      let meters = 0;
      let seconds = 0;
      for (let end = 0; end < run.length; end += 1) {
        meters += run[end]!.distance;
        seconds += run[end]!.seconds;
        while (start < end && meters - run[start]!.distance >= target - 0.01) {
          meters -= run[start]!.distance;
          seconds -= run[start]!.seconds;
          start += 1;
        }
        if (meters >= target - 0.01) {
          const scaled = (seconds * target) / meters;
          if (best === undefined || scaled < best) {
            best = scaled;
          }
        }
      }
    }
    if (best !== undefined) {
      efforts.push({ distance: target, seconds: round(best, 1) });
    }
  }
  return efforts;
}

/** Each stroke's share of a swim, in `SWIM_STYLES` order. */
export function swimStyleTotals(lengths: readonly TrainingHubSwimLength[]): SwimStyleTotals[] {
  const totals = new Map<SwimStyle, SwimStyleTotals>();
  for (const length of lengths) {
    const entry = totals.get(length.style) ?? {
      style: length.style,
      meters: 0,
      seconds: 0,
      lengths: 0
    };
    entry.meters += length.distance;
    entry.seconds += length.seconds;
    entry.lengths += 1;
    if (length.strokes !== undefined) {
      const counted = entry.counted ?? { lengths: 0, meters: 0, seconds: 0, strokes: 0 };
      counted.lengths += 1;
      counted.meters += length.distance;
      counted.seconds += length.seconds;
      counted.strokes += length.strokes;
      entry.counted = counted;
    }
    totals.set(length.style, entry);
  }
  return SWIM_STYLES.flatMap((style) => {
    const entry = totals.get(style);
    if (!entry) {
      return [];
    }
    return [
      {
        ...entry,
        meters: round(entry.meters, 1),
        seconds: round(entry.seconds, 1),
        ...(entry.counted
          ? {
              counted: {
                ...entry.counted,
                meters: round(entry.counted.meters, 1),
                seconds: round(entry.counted.seconds, 1)
              }
            }
          : {})
      }
    ];
  });
}

/**
 * What a swim's list row, trend and stroke mix keep of it: a few hundred bytes
 * against the payload's megabytes.
 */
export function swimSummaryOf(
  swim: TrainingHubSwimDetail,
  fallback: { duration?: number } = {}
): SwimSummary {
  return {
    version: SWIM_SUMMARY_VERSION,
    ...(swim.poolLength !== undefined ? { poolLength: swim.poolLength } : {}),
    ...(swim.poolUnit !== undefined ? { poolUnit: swim.poolUnit } : {}),
    ...(swim.lengths.length > 0 ? { lengths: swim.lengths.length } : {}),
    swimSeconds: swim.swimSeconds ?? fallback.duration ?? 0,
    restSeconds: swim.restSeconds ?? 0,
    byStyle: swimStyleTotals(swim.lengths),
    best: bestSwimEfforts(swim.lengths),
    ...(swim.waterTemperatureC !== undefined ? { waterTemperatureC: swim.waterTemperatureC } : {})
  };
}

/**
 * A pool swim's intervals as the laps every other reader of a detail reads —
 * the Activities lap table, Coach's lap tool, the chart's lap focus. COROS's
 * generic lap list for one is its lengths, rests among them, which read as
 * sixty 25 m "laps" and a row of zero-metre ones.
 */
export function swimLaps(swim: TrainingHubSwimDetail): TrainingHubActivityLap[] {
  return swim.intervals.map((interval) => ({
    index: interval.index,
    distance: interval.distance,
    duration: Math.round(interval.seconds),
    ...(interval.avgHr !== undefined ? { avgHr: interval.avgHr } : {}),
    ...(interval.maxHr !== undefined ? { maxHr: interval.maxHr } : {}),
    ...(interval.strokeRate !== undefined ? { avgCadence: interval.strokeRate } : {}),
    ...(interval.distance > 0 ? { pace: Math.round((interval.seconds / interval.distance) * 1000) } : {})
  }));
}

/**
 * A swim's SWOLF: seconds plus strokes a length, over every length that
 * carries a count — drills carry none. The one figure the list row and the
 * swim's own page both state, so they cannot disagree.
 */
export function sessionSwolf(totals: readonly SwimStyleTotals[]): number | undefined {
  let seconds = 0;
  let strokes = 0;
  let lengths = 0;
  for (const entry of totals) {
    if (entry.counted) {
      seconds += entry.counted.seconds;
      strokes += entry.counted.strokes;
      lengths += entry.counted.lengths;
    }
  }
  return lengths > 0 ? (seconds + strokes) / lengths : undefined;
}

/** Seconds per 100 m. */
export function secondsPer100m(seconds: number, meters: number): number | undefined {
  return seconds > 0 && meters > 0 ? (seconds / meters) * 100 : undefined;
}

/** SWOLF of a stroke's counted lengths: seconds plus strokes, a length. */
export function styleSwolf(totals: SwimStyleTotals): number | undefined {
  const counted = totals.counted;
  return counted && counted.lengths > 0
    ? (counted.seconds + counted.strokes) / counted.lengths
    : undefined;
}

/** Strokes a length, over a stroke's counted lengths. */
export function styleStrokesPerLength(totals: SwimStyleTotals): number | undefined {
  const counted = totals.counted;
  return counted && counted.lengths > 0 ? counted.strokes / counted.lengths : undefined;
}

/** Metres each stroke carries the swimmer, over a stroke's counted lengths. */
export function styleDistancePerStroke(totals: SwimStyleTotals): number | undefined {
  const counted = totals.counted;
  return counted && counted.strokes > 0 ? counted.meters / counted.strokes : undefined;
}

/** Strokes a minute, over a stroke's counted lengths. */
export function styleStrokeRate(totals: SwimStyleTotals): number | undefined {
  const counted = totals.counted;
  return counted && counted.seconds > 0 && counted.strokes > 0
    ? (counted.strokes / counted.seconds) * 60
    : undefined;
}
