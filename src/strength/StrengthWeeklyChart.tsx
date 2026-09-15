import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useTheme } from "../theme/ThemeProvider";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { kilogramsToDisplayWeight } from "../units/units";
import { startOfWeekMs, type WeekBucket } from "./strengthAnalytics";
import { formatTotalWeight } from "./strengthFormat";

const MS_PER_WEEK = 604_800_000;

/** Plot box of the weekly chart, in the same pixels the gradient is drawn in. */
const CHART_HEIGHT = 268;
const CHART_PLOT_TOP = 6;
const CHART_PLOT_BOTTOM = 236;

/**
 * The page's own ramp, taken from the heat legend on the figure above: work is
 * warm. Deliberately not the app's teal accent, which belongs to every other
 * view — green is kept here for one job only, marking a lift that improved.
 */
const EMBER = {
  dark: {
    hot: "#f6b04a",
    mid: "#e8813c",
    base: "#d9434b",
    sets: "#f3dfc4",
    /* The hover column reads as the bar's own warmth turned up, not as the
       shared white wash — which on this chart outshone the bar it marked. */
    cursor: "rgba(232, 129, 60, 0.12)"
  },
  paper: {
    hot: "#d9901c",
    mid: "#cf6a2a",
    base: "#bd3238",
    sets: "#614b3a",
    cursor: "rgba(207, 106, 42, 0.1)"
  }
};

interface WeekPoint {
  weekStart: number;
  label: string;
  sessions: number;
  sets: number;
  volumeKg: number;
}

/**
 * Zero-filled weeks across the whole window. The analytics only bucket weeks
 * that had a session, so a week off would otherwise close up and the chart
 * would read as an unbroken streak.
 */
function buildWeekSeries(weeks: WeekBucket[], windowDays: number): WeekPoint[] {
  const byWeekStart = new Map(weeks.map((week) => [week.weekStart, week]));
  const currentWeek = startOfWeekMs(Date.now());
  const firstWeek = startOfWeekMs(Date.now() - (windowDays - 1) * 86_400_000);
  const points: WeekPoint[] = [];

  for (let at = firstWeek; at <= currentWeek; at += MS_PER_WEEK) {
    const bucket = byWeekStart.get(Math.floor(at / 1000));
    points.push({
      weekStart: Math.floor(at / 1000),
      label: new Date(at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      }),
      sessions: bucket?.sessions ?? 0,
      sets: bucket?.sets ?? 0,
      volumeKg: bucket?.volumeKg ?? 0
    });
  }

  return points;
}

interface RecentChange {
  /** Percent change from the previous block of the same length. */
  percent: number;
  weeks: number;
}

/**
 * Compare the last few finished weeks against the same number before them. The
 * week in progress is left out — half a week always looks like a slump.
 */
function compareRecentWeeks(
  series: WeekPoint[],
  valueOf: (point: WeekPoint) => number
): RecentChange | null {
  const finished = series.slice(0, -1);
  const span = Math.min(4, Math.floor(finished.length / 2));
  if (span < 2) {
    return null;
  }
  const total = (points: WeekPoint[]) =>
    points.reduce((sum, point) => sum + valueOf(point), 0);
  const earlier = total(finished.slice(-span * 2, -span));
  if (earlier <= 0) {
    return null;
  }
  const recent = total(finished.slice(-span));
  return { percent: ((recent - earlier) / earlier) * 100, weeks: span };
}

interface StrengthWeeklyChartProps {
  weeks: WeekBucket[];
  /** Window length in days; the series is zero-filled across all of it. */
  days: number;
  /** False for a bodyweight-only history, where the bars count sets. */
  usesWeights: boolean;
}

/**
 * Weight lifted and sets per week across the window, with the average week
 * and how the last few weeks compare with the ones before them.
 */
export function StrengthWeeklyChart({
  weeks,
  days,
  usesWeights
}: StrengthWeeklyChartProps) {
  const { unitSystem } = useUnitSystem();
  const { colors } = useChartColors();
  const { theme } = useTheme();
  const ember = theme === "paper" ? EMBER.paper : EMBER.dark;

  const weekSeries = useMemo(
    () => buildWeekSeries(weeks, days),
    [weeks, days]
  );

  const chartData = useMemo(
    () =>
      weekSeries.map((week) => ({
        label: week.label,
        value: usesWeights
          ? Math.round(kilogramsToDisplayWeight(week.volumeKg, unitSystem))
          : Math.round(week.sets),
        volumeKg: week.volumeKg,
        sets: Math.round(week.sets),
        sessions: week.sessions
      })),
    [weekSeries, unitSystem, usesWeights]
  );

  /**
   * Averaged over the weeks that were actually trained: counting rest weeks
   * would drag the line below every bar it is meant to sit among.
   */
  const average = useMemo(() => {
    const active = weekSeries.filter(
      (week) => (usesWeights ? week.volumeKg : week.sets) > 0
    );
    if (active.length === 0) {
      return { kg: 0, sets: 0 };
    }
    return {
      kg: active.reduce((total, week) => total + week.volumeKg, 0) / active.length,
      sets: active.reduce((total, week) => total + week.sets, 0) / active.length
    };
  }, [weekSeries, usesWeights]);

  const averageValue = usesWeights
    ? Math.round(kilogramsToDisplayWeight(average.kg, unitSystem))
    : Math.round(average.sets);

  const change = useMemo(
    () =>
      compareRecentWeeks(weekSeries, (week) =>
        usesWeights ? week.volumeKg : week.sets
      ),
    [weekSeries, usesWeights]
  );

  const axisFormatter = (value: number) => {
    if (!usesWeights) {
      return String(value);
    }
    return value >= 1000
      ? unitSystem === "metric"
        ? `${Math.round(value / 1000)} tonnes`
        : `${Math.round(value / 1000)}k`
      : String(value);
  };

  const averageLabel = usesWeights
    ? formatTotalWeight(average.kg, unitSystem)
    : `${Math.round(average.sets)} sets`;

  return (
    <section className="panel strength-card strength-week-card">
      <div className="strength-card-head">
        <div>
          <h3>{usesWeights ? "Weight lifted and sets each week" : "Sets each week"}</h3>
          <p>
            {usesWeights
              ? "Bars show total weight lifted; the line tracks your sets."
              : "Every bar is every set you did that week."}
          </p>
        </div>
        {change ? (
          <span
            className="strength-change"
            data-tone={
              Math.abs(change.percent) < 5
                ? "flat"
                : change.percent > 0
                  ? "up"
                  : "down"
            }
          >
            {Math.abs(change.percent) < 5 ? (
              <Minus size={13} aria-hidden="true" />
            ) : change.percent > 0 ? (
              <ArrowUpRight size={13} aria-hidden="true" />
            ) : (
              <ArrowDownRight size={13} aria-hidden="true" />
            )}
            {Math.abs(change.percent) < 5
              ? `About the same as the ${change.weeks} weeks before`
              : `${Math.abs(Math.round(change.percent))}% ${
                  change.percent > 0 ? "more" : "less"
                } than the ${change.weeks} weeks before`}
          </span>
        ) : null}
      </div>

      <div className="strength-chart">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart
            data={chartData}
            margin={{ top: 6, right: 2, left: 0, bottom: 0 }}
          >
            <defs>
              {/*
               * Anchored to the plot box rather than to each bar, so the
               * ramp is a property of the chart and not of the shape: a
               * big week climbs into the amber, a light one stays low and
               * deep red. Same reading as the heat on the figure above.
               */}
              <linearGradient
                id="strengthWeekFill"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={CHART_PLOT_TOP}
                x2="0"
                y2={CHART_PLOT_BOTTOM}
              >
                <stop offset="0%" stopColor={ember.hot} stopOpacity={0.98} />
                <stop offset="55%" stopColor={ember.mid} stopOpacity={0.9} />
                <stop offset="100%" stopColor={ember.base} stopOpacity={0.62} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="label"
              stroke={colors.text}
              tickLine={false}
              axisLine={false}
              fontSize={11.5}
              tickMargin={10}
              minTickGap={28}
            />
            <YAxis
              yAxisId="weight"
              stroke={colors.text}
              tickLine={false}
              axisLine={false}
              fontSize={11.5}
              tickMargin={6}
              width={usesWeights && unitSystem === "metric" ? 82 : 52}
              tickFormatter={axisFormatter}
            />
            {usesWeights ? (
              <YAxis
                yAxisId="sets"
                orientation="right"
                stroke={ember.sets}
                tickLine={false}
                axisLine={false}
                fontSize={11.5}
                tickMargin={6}
                width={32}
                allowDecimals={false}
              />
            ) : null}
            <Tooltip
              content={(props: TooltipContentProps) => {
                if (!props.active || !props.payload?.length) {
                  return null;
                }
                const point = props.payload[0].payload as (typeof chartData)[number];
                return (
                  <div className="strength-tooltip">
                    <span>Week of {props.label}</span>
                    <strong>
                      {point.sessions === 0
                        ? "No sessions"
                        : usesWeights
                          ? formatTotalWeight(point.volumeKg, unitSystem)
                          : `${point.sets} sets`}
                    </strong>
                    {point.sessions > 0 ? (
                      <span>
                        {point.sessions} session
                        {point.sessions === 1 ? "" : "s"}
                        {usesWeights ? ` · ${point.sets} sets` : ""}
                      </span>
                    ) : null}
                  </div>
                );
              }}
              contentStyle={trainingChartTooltipStyle}
              cursor={{ fill: ember.cursor, radius: 6 }}
            />
            {averageValue > 0 ? (
              <ReferenceLine
                yAxisId="weight"
                y={averageValue}
                stroke={colors.text}
                strokeOpacity={0.45}
                strokeDasharray="2 6"
              />
            ) : null}
            <Bar
              yAxisId="weight"
              dataKey="value"
              name={usesWeights ? "Weight lifted" : "Sets"}
              fill="url(#strengthWeekFill)"
              radius={[5, 5, 2, 2]}
              maxBarSize={30}
            />
            {usesWeights ? (
              <Line
                yAxisId="sets"
                type="monotone"
                dataKey="sets"
                name="Sets"
                stroke={ember.sets}
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: ember.sets,
                  stroke: colors.dotStroke,
                  strokeWidth: 2
                }}
                isAnimationActive={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {averageValue > 0 ? (
        <p className="strength-chart-note">
          <span className="strength-chart-dash" aria-hidden="true" />
          Your average week: {averageLabel}
        </p>
      ) : null}
    </section>
  );
}
