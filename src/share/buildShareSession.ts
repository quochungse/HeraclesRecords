import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivitySeriesPoint,
  TrainingHubSwimDetail,
  UnitSystem
} from "../../electron/types";
import { SWIM_STYLE_COLORS } from "../swimming/swimColors";
import { formatPer100, formatPoolLength } from "../swimming/swimMetrics";
import { SWIM_STYLE_LABELS } from "../swimming/swimType";
import { formatCount, formatDecimal, t } from "../i18n/core";
import { formatElevationMeters, formatPaceSecondsPerKm, formatTrainingTimestamp } from "../training/formatters";
import { readStoredSportColors, sportColorCategory } from "../training/sportColors";
import { isSpeedSport } from "../training/sportTypes";
import { hasActivityRoute, routePoints } from "../training/components/ActivityRouteMap";
import { buildRouteReplay } from "../training/components/routeReplay";
import { routePerformance } from "../training/components/routePerformance";
import { formatSpeedValue } from "../units/units";
import { TRAINING_BENEFITS, type TrainingBenefitReading } from "../training/trainingBenefit";
import { trainingBenefitName } from "../training/components/TrainingBenefitChip";
import { zoneColor } from "../training/components/routeColoring";
import { shareFileName, shareStat, thin } from "./shareModel";
import type { ShareChart, ShareChartKind, ShareRoute, ShareSession, ShareSport, ShareSwim } from "./shareTypes";

/** A figure as a detail page lists it. */
export interface PageStat {
  id?: string;
  label: string;
  value: string;
}

interface ActivityShareInput {
  sport: Exclude<ShareSport, "strength">;
  activity: TrainingHubActivity;
  detail: TrainingHubActivityDetail | null;
  /** The samples with the pauses taken out, as the page charts them. */
  series: readonly TrainingHubActivitySeriesPoint[];
  /** "Road run", "Pool swim". */
  kind: string;
  name: string;
  stats: readonly PageStat[];
  defaultStats: readonly string[];
  defaultHero?: string;
  trainingLabel?: { name: string; color: string };
  /** The charts this sport offers, in order; each is kept only when the session recorded it. */
  charts: readonly ShareChartKind[];
  unitSystem: UnitSystem;
  swim?: ShareSwim;
}

/** Samples a chart is drawn from: enough for a smooth line at 1080 px. */
const CHART_SAMPLES = 160;
/** A pace slower than this is standing still, as the route colouring reads it. */
const SLOWEST_PACE = 1800;

/** The session's training label, named and coloured as the chip on its page is. */
export function shareTrainingLabel(reading: TrainingBenefitReading | undefined): { name: string; color: string } | undefined {
  return reading
    ? { name: trainingBenefitName(reading.primary), color: zoneColor(TRAINING_BENEFITS.indexOf(reading.primary)) }
    : undefined;
}

export function sportColor(sportType: number | undefined): string {
  return readStoredSportColors()[sportColorCategory(sportType)];
}

/** Ids for a page's figures: its own where it has them, else its label, made unique. */
export function shareStats(stats: readonly PageStat[]) {
  const seen = new Set<string>();
  return stats.map((stat) => {
    let id = stat.id ?? stat.label;
    while (seen.has(id)) id = `${id}+`;
    seen.add(id);
    return shareStat(id, stat.label, stat.value);
  });
}

function shareRoute(detail: TrainingHubActivityDetail | null): ShareRoute | undefined {
  if (!detail || !hasActivityRoute(detail.track)) {
    return undefined;
  }
  const replay = buildRouteReplay(routePoints(detail.track));
  if (!replay) {
    return undefined;
  }
  const speed = isSpeedSport(detail.sportType, detail.sportName);
  return {
    latLngs: replay.latLngs,
    distances: replay.distances,
    performance: routePerformance(replay, detail, speed),
    speed
  };
}

/** A light smoothing, so a chart reads as a line rather than as sensor noise. */
function smooth(values: readonly number[], radius: number): number[] {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let at = Math.max(0, index - radius); at <= Math.min(values.length - 1, index + radius); at += 1) {
      sum += values[at]!;
      count += 1;
    }
    return sum / count;
  });
}

function channel(series: readonly TrainingHubActivitySeriesPoint[], read: (point: TrainingHubActivitySeriesPoint) => number | undefined): number[] {
  const values: number[] = [];
  for (const point of series) {
    const value = read(point);
    if (value !== undefined && Number.isFinite(value)) values.push(value);
  }
  return values;
}

/**
 * Each whole kilometre's (or mile's) pace, from the samples' distance and
 * clock. The moment a mark is passed is read between the two samples either
 * side of it, so a gap in the samples spanning several marks shares its time
 * among them rather than making one split of it and a next one of nothing.
 */
function splits(series: readonly TrainingHubActivitySeriesPoint[], unitSystem: UnitSystem): number[] {
  const length = unitSystem === "imperial" ? 1609.344 : 1000;
  const paces: number[] = [];
  let mark = length;
  let markTime: number | undefined;
  let previous: { distance: number; elapsed: number } | undefined;
  for (const point of series) {
    if (point.distance === undefined || point.elapsed === undefined) continue;
    const here = { distance: point.distance, elapsed: point.elapsed };
    if (!previous) {
      previous = here;
      markTime = here.elapsed;
      continue;
    }
    while (here.distance >= mark) {
      const span = here.distance - previous.distance;
      const passed = span > 0 ? previous.elapsed + ((mark - previous.distance) / span) * (here.elapsed - previous.elapsed) : here.elapsed;
      const seconds = passed - (markTime ?? passed);
      if (seconds > 0) paces.push((seconds / length) * 1000);
      markTime = passed;
      mark += length;
    }
    previous = here;
  }
  return paces;
}

function chartFor(
  kind: ShareChartKind,
  series: readonly TrainingHubActivitySeriesPoint[],
  unitSystem: UnitSystem
): ShareChart | undefined {
  if (kind === "splits") {
    const paces = splits(series, unitSystem);
    if (paces.length < 2) return undefined;
    return {
      kind,
      title: t("share.chart.splits"),
      note: t("share.chart.fastest", { value: formatPaceSecondsPerKm(Math.min(...paces), unitSystem) }),
      values: paces.map((pace) => 1000 / pace),
      bars: true
    };
  }
  if (kind === "pace" || kind === "speed") {
    const paces = channel(series, (point) => (point.pace && point.pace > 0 && point.pace < SLOWEST_PACE ? point.pace : undefined));
    if (paces.length < 10) return undefined;
    const last = series[series.length - 1];
    const average = last?.distance && last.elapsed ? (last.elapsed / last.distance) * 1000 : undefined;
    const values = smooth(thin(paces.map((pace) => 3600 / pace), CHART_SAMPLES), 2);
    if (kind === "pace") {
      return {
        kind,
        title: t("activity.m.pace"),
        note: average ? t("share.chart.average", { value: formatPaceSecondsPerKm(average, unitSystem) }) : "",
        values
      };
    }
    return {
      kind,
      title: t("activity.m.speed"),
      note: average ? t("share.chart.average", { value: formatSpeedValue(3600 / average, unitSystem) }) : "",
      values
    };
  }
  if (kind === "hr") {
    const beats = channel(series, (point) => (point.hr && point.hr > 0 ? point.hr : undefined));
    if (beats.length < 10) return undefined;
    const average = beats.reduce((sum, value) => sum + value, 0) / beats.length;
    return {
      kind,
      title: t("activity.m.heartRate"),
      note: t("share.chart.heartRate", { average: formatCount(Math.round(average)), max: formatCount(Math.max(...beats)) }),
      values: smooth(thin(beats, CHART_SAMPLES), 1)
    };
  }
  if (kind === "elevation") {
    const heights = channel(series, (point) => point.altitude);
    if (heights.length < 10 || Math.max(...heights) - Math.min(...heights) < 3) return undefined;
    return {
      kind,
      title: t("activity.m.elevation"),
      note: t("share.chart.range", {
        low: formatElevationMeters(Math.min(...heights), unitSystem),
        high: formatElevationMeters(Math.max(...heights), unitSystem)
      }),
      values: smooth(thin(heights, CHART_SAMPLES), 1)
    };
  }
  const watts = channel(series, (point) => (point.power && point.power > 0 ? point.power : undefined));
  if (watts.length < 10) return undefined;
  const average = watts.reduce((sum, value) => sum + value, 0) / watts.length;
  return {
    kind,
    title: t("activity.m.power"),
    note: t("share.chart.average", { value: `${formatDecimal(average, 0)} W` }),
    values: smooth(thin(watts, CHART_SAMPLES), 2)
  };
}

/** A pool swim's lengths, each as fast as it was and in its stroke's colour. */
export function shareSwimLengths(swim: TrainingHubSwimDetail | undefined, unitSystem: UnitSystem): ShareSwim | undefined {
  const lengths = (swim?.lengths ?? []).filter((length) => length.seconds > 0 && length.distance > 0);
  if (!swim || lengths.length < 2) {
    return undefined;
  }
  const fastest = Math.min(...lengths.map((length) => (length.seconds / length.distance) * 100));
  const styles = [...new Set(lengths.map((length) => length.style))];
  return {
    lengths: lengths.map((length) => ({ speed: length.distance / length.seconds, color: SWIM_STYLE_COLORS[length.style] })),
    title: swim.poolLength
      ? t("share.swim.lengths", { count: formatCount(lengths.length), length: formatPoolLength(swim.poolLength, swim.poolUnit) })
      : formatCount(lengths.length),
    note: t("share.chart.fastest", { value: formatPer100(fastest, unitSystem) }),
    legend: styles.map((style) => ({ label: SWIM_STYLE_LABELS[style], color: SWIM_STYLE_COLORS[style] }))
  };
}

/** A run, ride, hike or swim, from what its detail page already holds. */
export function buildActivityShareSession(input: ActivityShareInput): ShareSession {
  const { activity, detail, unitSystem } = input;
  const charts = input.charts
    .map((kind) => chartFor(kind, input.series, unitSystem))
    .filter((chart): chart is ShareChart => Boolean(chart));
  return {
    sport: input.sport,
    activityId: activity.activityId,
    color: sportColor(activity.sportType),
    kind: input.kind,
    date: formatTrainingTimestamp(activity.startTime),
    name: input.name,
    trainingLabel: input.trainingLabel,
    stats: shareStats(input.stats),
    defaultStats: [...input.defaultStats],
    defaultHero: input.defaultHero,
    route: shareRoute(detail),
    charts,
    swim: input.swim,
    fileName: shareFileName(input.name, `activity-${activity.activityId}`)
  };
}
