import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { TrainingHubActivity, UnitSystem } from "../../electron/types";
import { OptionGroup } from "../components/OptionGroup";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation
} from "../units/units";
import {
  buildHikeWeeks,
  hikeWindowStartMs,
  summariseHikes,
  type HikeTotals,
  type HikeWeek
} from "./hikeMetrics";
import { HIKE_TYPE_LABELS, type HikeType } from "./hikeType";
import { hikeTypeColors } from "./hikeTypeColors";

/**
 * What a week of hiking is measured in.
 *
 * It opens on ascent, where a ride's chart opens on time: ten kilometres by a
 * lake and ten kilometres up Fansipan are not the same week, and the height
 * gained is what tells them apart. Time on the trail and distance are a switch
 * away, and the bars, the average and the heading all follow the one chosen.
 */
export type HikeVolumeMeasure = "ascent" | "time" | "distance";

const MEASURE_OPTIONS: readonly { value: HikeVolumeMeasure; label: string }[] = [
  { value: "ascent", label: "Ascent" },
  { value: "time", label: "Time" },
  { value: "distance", label: "Distance" }
];

interface HikeVolumeChartProps {
  /** Hikes inside the chosen period, already narrowed to the chosen kind. */
  hikes: readonly TrainingHubActivity[];
  /** The same kind, but the whole history — for the year-ago comparison. */
  hikesAllTime: readonly TrainingHubActivity[];
  weeks: number;
  /** Kinds present in the period, so the stack only holds real ones. */
  types: readonly HikeType[];
  nowMs: number;
}

const MOVING_AVERAGE_WEEKS = 4;
const WEEKS_PER_YEAR = 52;
const SECONDS_PER_HOUR = 3600;

interface VolumeRow extends Record<string, number | string> {
  label: string;
  total: number;
  biggest: number;
}

function weekTotal(week: HikeTotals, measure: HikeVolumeMeasure, unitSystem: UnitSystem): number {
  if (measure === "time") return week.duration / SECONDS_PER_HOUR;
  if (measure === "ascent") return metersToElevation(week.elevationGain, unitSystem);
  return metersToDisplayDistance(week.distance, unitSystem);
}

function weekBiggest(week: HikeWeek, measure: HikeVolumeMeasure, unitSystem: UnitSystem): number {
  if (measure === "time") return week.longestHikeSeconds / SECONDS_PER_HOUR;
  if (measure === "ascent") return metersToElevation(week.biggestAscentMeters, unitSystem);
  return metersToDisplayDistance(week.longestHikeMeters, unitSystem);
}

function typeVolume(
  week: HikeWeek,
  type: HikeType,
  measure: HikeVolumeMeasure,
  unitSystem: UnitSystem
): number {
  const volume = week.byType[type];
  if (measure === "time") return volume.duration / SECONDS_PER_HOUR;
  if (measure === "ascent") return metersToElevation(volume.elevationGain, unitSystem);
  return metersToDisplayDistance(volume.distance, unitSystem);
}

function measureUnit(measure: HikeVolumeMeasure, unitSystem: UnitSystem): string {
  if (measure === "time") return "h";
  if (measure === "ascent") return elevationUnit(unitSystem);
  return distanceUnit(unitSystem);
}

function formatMeasure(value: number, measure: HikeVolumeMeasure, unitSystem: UnitSystem): string {
  const digits = measure === "ascent" ? 0 : 1;
  return `${value.toFixed(digits)} ${measureUnit(measure, unitSystem)}`;
}

function shiftWeeks(timestampMs: number, weeks: number): number {
  const date = new Date(timestampMs);
  date.setDate(date.getDate() - weeks * 7);
  return date.getTime();
}

/** The chart's own window a year back, as Running's and Cycling's charts take it. */
function oneYearEarlier(
  hikes: readonly TrainingHubActivity[],
  weeks: number,
  nowMs: number
): HikeTotals | undefined {
  const back = Math.max(WEEKS_PER_YEAR, weeks);
  if (back > WEEKS_PER_YEAR + 1) {
    return undefined;
  }
  const start = shiftWeeks(hikeWindowStartMs(weeks, nowMs), back) / 1000;
  const end = shiftWeeks(nowMs, back) / 1000;
  const inWindow = hikes.filter(
    (activity) =>
      activity.startTime !== undefined && activity.startTime >= start && activity.startTime <= end
  );
  return inWindow.length > 0 ? summariseHikes(inWindow) : undefined;
}

export function HikeVolumeChart({ hikes, hikesAllTime, weeks, types, nowMs }: HikeVolumeChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const palette = useMemo(() => hikeTypeColors(), []);
  const [measure, setMeasure] = useState<HikeVolumeMeasure>("ascent");

  const weekBuckets = useMemo(() => buildHikeWeeks(hikes, { weeks, nowMs }), [hikes, nowMs, weeks]);
  const averageBuckets = useMemo(
    () => buildHikeWeeks(hikesAllTime, { weeks: weeks + MOVING_AVERAGE_WEEKS - 1, nowMs }),
    [hikesAllTime, nowMs, weeks]
  );

  const rows = useMemo<VolumeRow[]>(
    () =>
      weekBuckets.map((week, index) => {
        const end = index + MOVING_AVERAGE_WEEKS - 1;
        const window = averageBuckets.slice(Math.max(0, end - MOVING_AVERAGE_WEEKS + 1), end + 1);
        const average =
          window.reduce((sum, bucket) => sum + weekTotal(bucket, measure, unitSystem), 0) /
          Math.max(1, window.length);
        const row: VolumeRow = {
          label: week.label,
          total: weekTotal(week, measure, unitSystem),
          biggest: weekBiggest(week, measure, unitSystem),
          average
        };
        for (const type of types) {
          row[type] = typeVolume(week, type, measure, unitSystem);
        }
        return row;
      }),
    [averageBuckets, measure, types, unitSystem, weekBuckets]
  );

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.total, 0), [rows]);
  const lastYear = useMemo(() => oneYearEarlier(hikesAllTime, weeks, nowMs), [hikesAllTime, nowMs, weeks]);

  const unit = measureUnit(measure, unitSystem);
  const biggestLabel =
    measure === "ascent" ? "Biggest ascent" : measure === "time" ? "Longest day" : "Longest hike";

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">Weekly volume</p>
          <h3>
            {total.toFixed(0)} {unit}
            <span className="run-block-sub">
              {" "}
              over {weeks} {weeks === 1 ? "week" : "weeks"}
            </span>
          </h3>
        </div>
        <div className="sport-volume-aside">
          {lastYear !== undefined ? (
            <p className="run-block-aside">
              Same span a year ago:{" "}
              <strong>{weekTotal(lastYear, measure, unitSystem).toFixed(0)} {unit}</strong>
            </p>
          ) : null}
          <OptionGroup
            label="Measure"
            value={measure}
            options={MEASURE_OPTIONS}
            onChange={(next) => setMeasure(next as HikeVolumeMeasure)}
          />
        </div>
      </header>

      <div className="run-block-plot">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: colors.text, fontSize: 11 }}
              stroke={colors.grid}
              tickFormatter={(value: number) => value.toFixed(0)}
            />
            {types.map((type) => (
              <Bar
                key={type}
                dataKey={type}
                stackId="volume"
                fill={palette[type]}
                fillOpacity={0.75}
                radius={type === types[types.length - 1] ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
            <Line
              dataKey="average"
              type="monotone"
              stroke={colors.accentBright}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {/* The week's single biggest day: the long day a hike is trained
                for, which a weekly total hides behind two short ones. */}
            <Line
              dataKey="biggest"
              type="monotone"
              stroke={colors.gold}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              cursor={{ fill: colors.cursorBand }}
              content={(props: TooltipContentProps) => (
                <VolumeTooltip
                  {...props}
                  types={types}
                  palette={palette}
                  measure={measure}
                  unitSystem={unitSystem}
                  biggestLabel={biggestLabel}
                />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="run-legend">
        {types.map((type) => (
          <span key={type}>
            <i className="is-bar" style={{ background: palette[type] }} />
            {HIKE_TYPE_LABELS[type]}
          </span>
        ))}
        <span>
          <i style={{ background: colors.accentBright }} />4-week average
        </span>
        <span>
          <i className="is-dashed" style={{ background: colors.gold }} />
          {biggestLabel}
        </span>
      </div>
    </section>
  );
}

interface VolumeTooltipProps extends TooltipContentProps {
  types: readonly HikeType[];
  palette: Record<HikeType, string>;
  measure: HikeVolumeMeasure;
  unitSystem: UnitSystem;
  biggestLabel: string;
}

function VolumeTooltip({
  active,
  payload,
  label,
  types,
  palette,
  measure,
  unitSystem,
  biggestLabel
}: VolumeTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload as VolumeRow | undefined;
  if (!row) {
    return null;
  }
  return (
    <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
      <span>Week of {label}</span>
      <strong>{formatMeasure(Number(row.total), measure, unitSystem)}</strong>
      {types
        .filter((type) => Number(row[type]) > 0)
        .map((type) => (
          <span key={type} style={{ color: palette[type] }}>
            {HIKE_TYPE_LABELS[type]} {formatMeasure(Number(row[type]), measure, unitSystem)}
          </span>
        ))}
      <span>
        {biggestLabel} {formatMeasure(Number(row.biggest), measure, unitSystem)}
      </span>
    </div>
  );
}
