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
import { buildRunWeeks, summariseRuns, type RunWeek } from "./runMetrics";
import { RUN_SURFACE_LABELS, type RunSurface } from "./runSurface";
import { runSurfaceColors } from "./runSurfaceColors";
import {
  MOVING_AVERAGE_WEEKS,
  formatMeasure,
  measureUnit,
  measured,
  oneYearEarlier,
  trailingAverage,
  type Volume,
  type VolumeMeasure
} from "./sportVolume";

/**
 * What a week of running is measured in.
 *
 * Distance is a road runner's week, and the chart opens on it. A trail week is
 * read in hours and in height instead — ten kilometres on the flat and ten
 * over a ridge are not the same week, and the kilometres cannot tell them
 * apart — so under the Trail filter the chart opens on time. The bars, the
 * average, the dashed line and the heading all follow the one chosen.
 */
const MEASURE_OPTIONS: readonly { value: VolumeMeasure; label: string }[] = [
  { value: "distance", label: "Distance" },
  { value: "time", label: "Time" },
  { value: "climb", label: "Climb" }
];

interface RunVolumeChartProps {
  /** Runs inside the chosen period, already narrowed to the chosen surface. */
  runs: readonly TrainingHubActivity[];
  /** The same surface, but the whole history — for the year-ago comparison. */
  runsAllTime: readonly TrainingHubActivity[];
  weeks: number;
  /** Surfaces present in the period, so the stack only holds real ones. */
  surfaces: readonly RunSurface[];
  nowMs: number;
  /** What the chart opens on. Read on mount; the switch owns it from there. */
  defaultMeasure?: VolumeMeasure;
}

interface VolumeRow extends Record<string, number | string> {
  label: string;
  total: number;
  longest: number;
}

/** The week's single biggest run, by each measure — not one run's three figures. */
function biggestRun(week: RunWeek): Volume {
  return {
    distance: week.longestRunMeters,
    duration: week.longestRunSeconds,
    elevationGain: week.biggestClimbMeters
  };
}

/** One surface's part of the week. */
function surfaceVolume(week: RunWeek, surface: RunSurface): Volume {
  return {
    distance: week.distanceBySurface[surface],
    duration: week.durationBySurface[surface],
    elevationGain: week.climbBySurface[surface]
  };
}

/** The dashed line: the week's longest run, or its biggest climb when height is the measure. */
const LONGEST_LABELS: Record<VolumeMeasure, string> = {
  distance: "Longest run",
  time: "Longest run",
  climb: "Biggest climb"
};

export function RunVolumeChart({
  runs,
  runsAllTime,
  weeks,
  surfaces,
  nowMs,
  defaultMeasure = "distance"
}: RunVolumeChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const palette = useMemo(() => runSurfaceColors(), []);
  const [measure, setMeasure] = useState<VolumeMeasure>(defaultMeasure);

  const weekBuckets = useMemo(
    () => buildRunWeeks(runs, { weeks, nowMs }),
    [nowMs, runs, weeks]
  );

  // The same surface over the whole history, reaching three weeks before the
  // chart, so its first point is a four-week average like every other one.
  const averageBuckets = useMemo(
    () =>
      buildRunWeeks(runsAllTime, {
        weeks: weeks + MOVING_AVERAGE_WEEKS - 1,
        nowMs
      }),
    [nowMs, runsAllTime, weeks]
  );

  const rows = useMemo<VolumeRow[]>(
    () =>
      weekBuckets.map((week, index) => {
        const row: VolumeRow = {
          label: week.label,
          total: measured(week, measure, unitSystem),
          longest: measured(biggestRun(week), measure, unitSystem),
          average: trailingAverage(
            averageBuckets,
            index + MOVING_AVERAGE_WEEKS - 1,
            measure,
            unitSystem
          )
        };
        for (const surface of surfaces) {
          row[surface] = measured(surfaceVolume(week, surface), measure, unitSystem);
        }
        return row;
      }),
    [averageBuckets, measure, surfaces, unitSystem, weekBuckets]
  );

  // What the bars add up to, not every run in the period: under "All" the
  // chart stops at two years, and a heading counting six years of runs "over
  // 104 weeks" was a figure no bar on the chart could account for.
  const total = useMemo(
    () => weekBuckets.reduce((sum, week) => sum + measured(week, measure, unitSystem), 0),
    [measure, unitSystem, weekBuckets]
  );

  const lastYear = useMemo(
    () => oneYearEarlier(runsAllTime, { weeks, nowMs }, summariseRuns),
    [nowMs, runsAllTime, weeks]
  );

  const unit = measureUnit(measure, unitSystem);
  const longestLabel = LONGEST_LABELS[measure];

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
              <strong>
                {measured(lastYear, measure, unitSystem).toFixed(0)} {unit}
              </strong>
            </p>
          ) : null}
          <OptionGroup
            label="Measure"
            value={measure}
            options={MEASURE_OPTIONS}
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
              tickFormatter={(value: number) => value.toFixed(0)}
            />

            {/* One segment per surface in the period. Under a surface filter
                that is a single segment: the buckets hold only that surface's
                runs, so the bar is its volume, not its share of the week. */}
            {surfaces.map((surface) => (
              <Bar
                key={surface}
                dataKey={surface}
                stackId="volume"
                fill={palette[surface]}
                fillOpacity={0.75}
                radius={surface === surfaces[surfaces.length - 1] ? [3, 3, 0, 0] : undefined}
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
            {/* The week's single longest run: the figure a marathon build is
                actually steered by, and one a total hides completely.
                Measured in climb, the week's biggest climb. */}
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
                  surfaces={surfaces}
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

      {/* Bars get a block swatch and lines get a rule, so the legend says which
          mark it is describing as well as which colour. */}
      <div className="run-legend">
        {surfaces.map((surface) => (
          <span key={surface}>
            <i className="is-bar" style={{ background: palette[surface] }} />
            {RUN_SURFACE_LABELS[surface]}
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
  surfaces: readonly RunSurface[];
  palette: Record<RunSurface, string>;
  measure: VolumeMeasure;
  unitSystem: UnitSystem;
  longestLabel: string;
}

function VolumeTooltip({
  active,
  payload,
  label,
  surfaces,
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
      {surfaces
        .filter((surface) => Number(row[surface]) > 0)
        .map((surface) => (
          <span key={surface} style={{ color: palette[surface] }}>
            {RUN_SURFACE_LABELS[surface]} {formatMeasure(Number(row[surface]), measure, unitSystem)}
          </span>
        ))}
      <span>
        {longestLabel} {formatMeasure(Number(row.longest), measure, unitSystem)}
      </span>
    </div>
  );
}
