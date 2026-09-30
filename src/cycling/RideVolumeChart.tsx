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
  buildRideWeeks,
  rideWindowStartMs,
  summariseRides,
  type RideTypeVolume,
  type RideWeek
} from "./rideMetrics";
import { RIDE_TYPE_LABELS, type RideType } from "./rideType";
import { rideTypeColors } from "./rideTypeColors";

/**
 * What a week of riding is measured in.
 *
 * A run's week is kilometres and nothing else needs saying. A ride's is not:
 * an hour on the trainer covers whatever the trainer says it did, an hour of
 * singletrack half the road's ground, and a week in the hills is best read in
 * metres climbed. So the chart offers all three, and the bars, the average and
 * the heading all follow the one chosen. It opens on time, the one measure
 * every kind of ride counts in full — and the one the hero's week is read in.
 */
export type RideVolumeMeasure = "distance" | "time" | "climb";

const MEASURE_OPTIONS: readonly { value: RideVolumeMeasure; label: string }[] = [
  { value: "time", label: "Time" },
  { value: "distance", label: "Distance" },
  { value: "climb", label: "Climb" }
];

interface RideVolumeChartProps {
  /** Rides inside the chosen period, already narrowed to the chosen kind. */
  rides: readonly TrainingHubActivity[];
  /** The same kind, but the whole history — for the year-ago comparison. */
  ridesAllTime: readonly TrainingHubActivity[];
  weeks: number;
  /** Kinds present in the period, so the stack only holds real ones. */
  types: readonly RideType[];
  nowMs: number;
}

/** Weeks the trailing average is taken over. */
const MOVING_AVERAGE_WEEKS = 4;
/** "A year ago" in whole weeks, so the comparison starts on a Monday too. */
const WEEKS_PER_YEAR = 52;
const SECONDS_PER_HOUR = 3600;

interface VolumeRow extends Record<string, number | string> {
  label: string;
  total: number;
  longest: number;
}

/**
 * A volume in the chosen measure, in the unit the chart draws. A week's total,
 * one kind's share of it and its biggest ride all carry the same three
 * figures, so one reading serves all of them.
 */
function measured(
  volume: RideTypeVolume,
  measure: RideVolumeMeasure,
  unitSystem: UnitSystem
): number {
  if (measure === "time") {
    return volume.duration / SECONDS_PER_HOUR;
  }
  if (measure === "climb") {
    return metersToElevation(volume.elevationGain, unitSystem);
  }
  return metersToDisplayDistance(volume.distance, unitSystem);
}

/** The week's single biggest ride, by each measure — not one ride's three figures. */
function biggestRide(week: RideWeek): RideTypeVolume {
  return {
    distance: week.longestRideMeters,
    duration: week.longestRideSeconds,
    elevationGain: week.biggestClimbMeters
  };
}

function measureUnit(measure: RideVolumeMeasure, unitSystem: UnitSystem): string {
  if (measure === "time") return "h";
  if (measure === "climb") return elevationUnit(unitSystem);
  return distanceUnit(unitSystem);
}

/** One decimal where the numbers are small enough for it to matter. */
function formatMeasure(value: number, measure: RideVolumeMeasure, unitSystem: UnitSystem): string {
  const digits = measure === "climb" ? 0 : 1;
  return `${value.toFixed(digits)} ${measureUnit(measure, unitSystem)}`;
}

function shiftWeeks(timestampMs: number, weeks: number): number {
  const date = new Date(timestampMs);
  date.setDate(date.getDate() - weeks * 7);
  return date.getTime();
}

/**
 * The chart's own window, a year back — or nothing when the window is longer
 * than a year and "a year ago" would overlap the bars above it. The same rule
 * as the Running chart's.
 */
function oneYearEarlier(
  rides: readonly TrainingHubActivity[],
  weeks: number,
  nowMs: number
): RideTypeVolume | undefined {
  const back = Math.max(WEEKS_PER_YEAR, weeks);
  if (back > WEEKS_PER_YEAR + 1) {
    return undefined;
  }

  const start = shiftWeeks(rideWindowStartMs(weeks, nowMs), back) / 1000;
  const end = shiftWeeks(nowMs, back) / 1000;
  const inWindow = rides.filter(
    (activity) =>
      activity.startTime !== undefined &&
      activity.startTime >= start &&
      activity.startTime <= end
  );
  return inWindow.length > 0 ? summariseRides(inWindow) : undefined;
}

export function RideVolumeChart({
  rides,
  ridesAllTime,
  weeks,
  types,
  nowMs
}: RideVolumeChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const palette = useMemo(() => rideTypeColors(), []);
  const [measure, setMeasure] = useState<RideVolumeMeasure>("time");

  const weekBuckets = useMemo(
    () => buildRideWeeks(rides, { weeks, nowMs }),
    [nowMs, rides, weeks]
  );

  // The same kind over the whole history, reaching three weeks before the
  // chart, so its first point is a four-week average like every other one.
  const averageBuckets = useMemo(
    () =>
      buildRideWeeks(ridesAllTime, {
        weeks: weeks + MOVING_AVERAGE_WEEKS - 1,
        nowMs
      }),
    [nowMs, ridesAllTime, weeks]
  );

  const rows = useMemo<VolumeRow[]>(
    () =>
      weekBuckets.map((week, index) => {
        const end = index + MOVING_AVERAGE_WEEKS - 1;
        const window = averageBuckets.slice(Math.max(0, end - MOVING_AVERAGE_WEEKS + 1), end + 1);
        const average =
          window.reduce((sum, bucket) => sum + measured(bucket, measure, unitSystem), 0) /
          Math.max(1, window.length);
        const row: VolumeRow = {
          label: week.label,
          total: measured(week, measure, unitSystem),
          longest: measured(biggestRide(week), measure, unitSystem),
          average
        };
        for (const type of types) {
          row[type] = measured(week.byType[type], measure, unitSystem);
        }
        return row;
      }),
    [averageBuckets, measure, types, unitSystem, weekBuckets]
  );

  // What the bars add up to, not every ride in the period — see the Running
  // chart: under "All" the chart stops at two years.
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.total, 0),
    [rows]
  );

  const lastYear = useMemo(
    () => oneYearEarlier(ridesAllTime, weeks, nowMs),
    [nowMs, ridesAllTime, weeks]
  );

  const unit = measureUnit(measure, unitSystem);
  const longestLabel = measure === "climb" ? "Hilliest ride" : "Longest ride";

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
              <strong>{measured(lastYear, measure, unitSystem).toFixed(0)} {unit}</strong>
            </p>
          ) : null}
          <OptionGroup
            label="Measure"
            value={measure}
            options={MEASURE_OPTIONS}
            onChange={(next) => setMeasure(next as RideVolumeMeasure)}
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

            {/* One segment per kind of ride in the period. Under a kind filter
                that is a single segment: its volume, not its share. */}
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
            {/* The week's single biggest ride in the chosen measure: the long
                ride a build is steered by, which a weekly total hides. */}
            <Line
              dataKey="longest"
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
                  longestLabel={longestLabel}
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
            {RIDE_TYPE_LABELS[type]}
          </span>
        ))}
        <span>
          <i style={{ background: colors.accentBright }} />4-week average
        </span>
        <span>
          <i className="is-dashed" style={{ background: colors.gold }} />
          {longestLabel}
        </span>
      </div>
    </section>
  );
}

interface VolumeTooltipProps extends TooltipContentProps {
  types: readonly RideType[];
  palette: Record<RideType, string>;
  measure: RideVolumeMeasure;
  unitSystem: UnitSystem;
  longestLabel: string;
}

function VolumeTooltip({
  active,
  payload,
  label,
  types,
  palette,
  measure,
  unitSystem,
  longestLabel
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
            {RIDE_TYPE_LABELS[type]} {formatMeasure(Number(row[type]), measure, unitSystem)}
          </span>
        ))}
      <span>
        {longestLabel} {formatMeasure(Number(row.longest), measure, unitSystem)}
      </span>
    </div>
  );
}
