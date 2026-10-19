import type {
  CorosProfileZoneFamily,
  TrainingHubActivityZoneBucket
} from "../../electron/types";
import { HEART_RATE_PRESETS } from "../../electron/workoutCapabilities.ts";

/*
 * A session's time in each of its zones, as COROS scored it — the seconds on
 * the detail's `zoneList`, the same figures COROS's own app draws, never
 * worked out again from the samples. Node-free, so a suite can reach it.
 */

export interface ZoneTimeRow {
  /** 0 is the easiest zone. Picks the row's colour, so a band wears one colour on both scales. */
  position: number;
  /** COROS's English name for the band, or none when the model is not known. */
  label?: string;
  seconds: number;
  /** Of the whole session's scored time, 0–1. */
  share: number;
  /** The bound on the easier side: bpm, or seconds per km. Absent on the easiest zone. */
  easyEdge?: number;
  /** The bound on the harder side. Absent on the hardest zone, whose top is a sentinel. */
  hardEdge?: number;
}

/** COROS's `hrZoneType` — 1 Max HR, 2 HR Reserve, 3 LTHR — as a zone family. */
const ZONE_TYPE_FAMILY: Readonly<Record<number, CorosProfileZoneFamily>> = {
  1: "maxHr",
  2: "restingHr",
  3: "lthr"
};

/**
 * The model an activity's heart-rate zones were scored on: its own
 * `hrZoneType`, or the account's when the activity says 0. COROS writes 0 on
 * some activities of an account that has been on one model all along — two
 * runs a day apart came back 2 and 0 with the same bounds — so the activity
 * alone left half the sessions unnamed.
 */
export function heartRateZoneFamily(
  hrZoneType: number | undefined,
  accountFamily: CorosProfileZoneFamily | undefined
): CorosProfileZoneFamily | undefined {
  return (hrZoneType !== undefined ? ZONE_TYPE_FAMILY[hrZoneType] : undefined) ?? accountFamily;
}

/** COROS's English names for a family's zones, easiest first; none when the model is not known. */
export function zoneNamesFor(family: CorosProfileZoneFamily | undefined): readonly string[] | undefined {
  if (family === "maxHr") {
    return HEART_RATE_PRESETS.maxHr.map((zone) => zone.label);
  }
  // Heart-rate reserve, LTHR and pace share one set of names.
  if (family === "restingHr" || family === "lthr" || family === "thresholdPace") {
    return HEART_RATE_PRESETS.reserve.map((zone) => zone.label);
  }
  return undefined;
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Which field of a bucket holds the bound on each side of the zone. */
interface EdgeFields {
  easy: "low" | "high";
  hard: "low" | "high";
}

/**
 * Rows from buckets in easy-to-hard order, each row one or more adjacent
 * buckets. The easiest row has no easy bound (it is everything under the
 * first) and the hardest no hard one (its top is a sentinel, 255 or 404 bpm, or
 * a pace no one runs), whatever the parser left in those fields.
 */
function zoneRows(
  zones: readonly TrainingHubActivityZoneBucket[],
  edges: EdgeFields,
  group: (count: number) => number[][],
  names: readonly string[] | undefined
): ZoneTimeRow[] {
  const buckets = [...zones].sort((left, right) => left.index - right.index);
  const total = buckets.reduce((sum, bucket) => sum + (positive(bucket.seconds) ?? 0), 0);
  if (total <= 0) {
    return [];
  }
  const groups = group(buckets.length);
  return groups.map((members, position) => {
    const first = buckets[members[0]!]!;
    const final = buckets[members[members.length - 1]!]!;
    const seconds = members.reduce((sum, at) => sum + (positive(buckets[at]!.seconds) ?? 0), 0);
    const easyEdge = position === 0 ? undefined : positive(first[edges.easy]);
    const hardEdge = position === groups.length - 1 ? undefined : positive(final[edges.hard]);
    const label = names?.[position];
    return {
      position,
      ...(label !== undefined ? { label } : {}),
      seconds,
      share: seconds / total,
      ...(easyEdge !== undefined ? { easyEdge } : {}),
      ...(hardEdge !== undefined ? { hardEdge } : {})
    };
  });
}

/** One row per bucket. */
const eachBucket = (count: number) => Array.from({ length: count }, (_, at) => [at]);

/**
 * Time in each heart-rate zone, every zone listed — one the session never
 * reached reads 0 rather than going missing. Bounds in bpm: `low` the floor,
 * `high` the ceiling.
 */
export function heartRateZoneTime(
  zones: readonly TrainingHubActivityZoneBucket[],
  family: CorosProfileZoneFamily | undefined
): ZoneTimeRow[] {
  return zoneRows(zones, { easy: "low", hard: "high" }, eachBucket, zoneNamesFor(family));
}

/**
 * Time in each pace zone, in seconds per kilometre: `low` a bucket's fast
 * edge, `high` its slow one — the parser keeps bucket 0's one bound in `low`.
 *
 * COROS keeps seven pace buckets where it names six zones: its threshold
 * band (92–102% of threshold speed) is stored split at 100%, so buckets 3 and
 * 4 are the two halves of one Threshold and are drawn as one row — the row
 * then reads in the same six names, in the same colours, as the heart-rate
 * scale beside it. A list of any other length is drawn bucket for bucket and
 * named by number.
 */
export function paceZoneTime(zones: readonly TrainingHubActivityZoneBucket[]): ZoneTimeRow[] {
  const coros = zones.length === 7;
  return zoneRows(
    zones,
    { easy: "high", hard: "low" },
    coros ? () => [[0], [1], [2], [3, 4], [5], [6]] : eachBucket,
    coros ? zoneNamesFor("thresholdPace") : undefined
  );
}
