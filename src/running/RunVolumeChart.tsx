import { useMemo } from "react";
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
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { distanceUnit, metersToDisplayDistance } from "../units/units";
import { buildRunWeeks, type RunWeek } from "./runMetrics";
import { RUN_SURFACE_LABELS, type RunSurface } from "./runSurface";
import { runSurfaceColors } from "./runSurfaceColors";

interface RunVolumeChartProps {
  /** Runs inside the chosen period, already narrowed to the chosen surface. */
  runs: readonly TrainingHubActivity[];
  /** The same surface, but the whole history — for the year-ago comparison. */
  runsAllTime: readonly TrainingHubActivity[];
  weeks: number;
  /** Surfaces present in the period, so the stack only holds real ones. */
  surfaces: readonly RunSurface[];
}

/** Weeks the trailing average is taken over. */
const MOVING_AVERAGE_WEEKS = 4;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365;

interface VolumeRow extends Record<string, number | string> {
  label: string;
  total: number;
  longest: number;
}

function movingAverage(weeks: readonly RunWeek[], index: number): number {
  const from = Math.max(0, index - MOVING_AVERAGE_WEEKS + 1);
  const window = weeks.slice(from, index + 1);
  return window.reduce((sum, week) => sum + week.distance, 0) / window.length;
}

/**
 * The same span of the calendar, a year back.
 *
 * Answered against the whole history rather than the filtered period, because
 * the period is what the athlete is looking at now and the comparison is
 * explicitly about a window they are not looking at.
 */
function distanceOneYearEarlier(
  runs: readonly TrainingHubActivity[],
  spanDays: number,
  nowMs: number
): number | undefined {
  const end = nowMs - DAYS_PER_YEAR * MS_PER_DAY;
  const start = end - spanDays * MS_PER_DAY;
  let total = 0;
  let seen = 0;

  for (const activity of runs) {
    const at = (activity.startTime ?? 0) * 1000;
    if (at >= start && at <= end) {
      total += activity.distance ?? 0;
      seen += 1;
    }
  }

  return seen > 0 ? total : undefined;
}

export function RunVolumeChart({
  runs,
  runsAllTime,
  weeks,
  surfaces
}: RunVolumeChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const palette = useMemo(() => runSurfaceColors(), []);
  const nowMs = useMemo(() => Date.now(), [runsAllTime]);

  const weekBuckets = useMemo(
    () => buildRunWeeks(runs, { weeks, nowMs }),
    [nowMs, runs, weeks]
  );

  const rows = useMemo<VolumeRow[]>(
    () =>
      weekBuckets.map((week, index) => {
        const row: VolumeRow = {
          label: week.label,
          total: metersToDisplayDistance(week.distance, unitSystem),
          longest: metersToDisplayDistance(week.longestRunMeters, unitSystem),
          average: metersToDisplayDistance(
            movingAverage(weekBuckets, index),
            unitSystem
          )
        };
        for (const surface of surfaces) {
          row[surface] = metersToDisplayDistance(
            week.distanceBySurface[surface],
            unitSystem
          );
        }
        return row;
      }),
    [surfaces, unitSystem, weekBuckets]
  );

  const total = useMemo(
    () => runs.reduce((sum, run) => sum + (run.distance ?? 0), 0),
    [runs]
  );

  const lastYear = useMemo(
    () => distanceOneYearEarlier(runsAllTime, weeks * 7, nowMs),
    [nowMs, runsAllTime, weeks]
  );

  const unit = distanceUnit(unitSystem);

  return (
    <section className="panel run-block">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">Weekly volume</p>
          <h3>
            {metersToDisplayDistance(total, unitSystem).toFixed(0)} {unit}
            <span className="run-block-sub">
              {" "}
              over {weeks} {weeks === 1 ? "week" : "weeks"}
            </span>
          </h3>
        </div>
        {lastYear !== undefined ? (
          <p className="run-block-aside">
            Same span a year ago:{" "}
            <strong>
              {metersToDisplayDistance(lastYear, unitSystem).toFixed(0)} {unit}
            </strong>
          </p>
        ) : null}
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

            {/* Stacked whatever the filter, so narrowing to one surface still
                shows how that surface sat inside the week it belonged to. */}
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
                actually steered by, and one a total hides completely. */}
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
                  unitSystem={unitSystem}
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
          Longest run
        </span>
      </div>
    </section>
  );
}

interface VolumeTooltipProps extends TooltipContentProps {
  surfaces: readonly RunSurface[];
  palette: Record<RunSurface, string>;
  unitSystem: UnitSystem;
}

function VolumeTooltip({
  active,
  payload,
  label,
  surfaces,
  palette,
  unitSystem
}: VolumeTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload as VolumeRow | undefined;
  if (!row) {
    return null;
  }

  const unit = distanceUnit(unitSystem);
  return (
    <div className="training-chart-tooltip" style={trainingChartTooltipStyle}>
      <span>Week of {label}</span>
      <strong>
        {Number(row.total).toFixed(1)} {unit}
      </strong>
      {surfaces
        .filter((surface) => Number(row[surface]) > 0)
        .map((surface) => (
          <span key={surface} style={{ color: palette[surface] }}>
            {RUN_SURFACE_LABELS[surface]} {Number(row[surface]).toFixed(1)} {unit}
          </span>
        ))}
      <span>
        Longest {Number(row.longest).toFixed(1)} {unit}
      </span>
    </div>
  );
}
