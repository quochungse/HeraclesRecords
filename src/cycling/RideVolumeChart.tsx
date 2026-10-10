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
  MOVING_AVERAGE_WEEKS,
  formatMeasure,
  measureUnit,
  measured,
  oneYearEarlier,
  trailingAverage,
  type Volume,
  type VolumeMeasure
} from "../running/sportVolume";
import { buildRideWeeks, summariseRides, type RideWeek } from "./rideMetrics";
import { RIDE_TYPE_LABELS, type RideType } from "./rideType";
import { rideTypeColors } from "./rideTypeColors";
import { formatDecimal, plural, t } from "../i18n/core";

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
const measureOptions = (): { value: VolumeMeasure; label: string }[] => [
  { value: "time", label: t("activity.m.time") },
  { value: "distance", label: t("activity.m.distance") },
  { value: "climb", label: t("activity.m.climb") }
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

interface VolumeRow extends Record<string, number | string> {
  label: string;
  total: number;
  longest: number;
}

/** The week's single biggest ride, by each measure — not one ride's three figures. */
function biggestRide(week: RideWeek): Volume {
  return {
    distance: week.longestRideMeters,
    duration: week.longestRideSeconds,
    elevationGain: week.biggestClimbMeters
  };
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
  const [measure, setMeasure] = useState<VolumeMeasure>("time");

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
        const average = trailingAverage(
          averageBuckets,
          index + MOVING_AVERAGE_WEEKS - 1,
          measure,
          unitSystem
        );
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
    () => oneYearEarlier(ridesAllTime, { weeks, nowMs }, summariseRides),
    [nowMs, ridesAllTime, weeks]
  );

  const unit = measureUnit(measure, unitSystem);
  const longestLabel = measure === "climb" ? t("ride.volume.hilliest") : t("ride.volume.longest");

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("run.volume.title")}</p>
          <h3>
            {formatDecimal(total, 0)} {unit}
            <span className="run-block-sub"> {plural("run.volume.over", weeks)}</span>
          </h3>
        </div>
        <div className="sport-volume-aside">
          {lastYear !== undefined ? (
            <p className="run-block-aside">
              {t("run.volume.yearAgo")}{" "}
              <strong>{formatDecimal(measured(lastYear, measure, unitSystem), 0)} {unit}</strong>
            </p>
          ) : null}
          <OptionGroup
            label={t("run.volume.measure")}
            value={measure}
            options={measureOptions()}
            onChange={(next) => setMeasure(next as VolumeMeasure)}
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
              tickFormatter={(value: number) => formatDecimal(value, 0)}
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
          <i style={{ background: colors.accentBright }} />
          {t("run.volume.avg4w")}
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
  measure: VolumeMeasure;
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
      <span>{t("activity.week.of", { date: String(label ?? "") })}</span>
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
