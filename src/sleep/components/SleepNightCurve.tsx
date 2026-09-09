import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Loader2 } from "lucide-react";
import { trainingChartMargin, trainingChartTooltipStyle } from "../../training/chartConfig";
import { useChartColors } from "../../training/useChartColors";
import type { SleepNightSeries } from "../../../electron/types";

interface SleepNightCurveProps {
  series: SleepNightSeries | null;
  loading: boolean;
}

interface CurveRow {
  at: number;
  hrv?: number;
  stress?: number;
}

/** Points are in the athlete's own frame, so read the clock off them as UTC. */
function formatClock(localAt: number): string {
  const date = new Date(localAt);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}`;
}

/**
 * Hourly marks between the two ends, so the axis reads as a night rather than
 * as whatever ticks the chart library would pick from the data.
 */
function hourTicks(start: number, end: number): number[] {
  const ticks: number[] = [];
  const first = Math.ceil(start / 3_600_000) * 3_600_000;

  for (let tick = first; tick <= end; tick += 3_600_000) {
    ticks.push(tick);
  }

  return ticks;
}

function merge(series: SleepNightSeries): CurveRow[] {
  const byTime = new Map<number, CurveRow>();
  const row = (at: number): CurveRow => {
    let existing = byTime.get(at);
    if (!existing) {
      existing = { at };
      byTime.set(at, existing);
    }
    return existing;
  };

  for (const point of series.hrv) {
    row(point.localAt).hrv = point.value;
  }
  for (const point of series.stress) {
    row(point.localAt).stress = point.value;
  }

  return [...byTime.values()].sort((left, right) => left.at - right.at);
}

/**
 * The night, sample by sample.
 *
 * COROS sends no sleep stages down any interface this app may use, so the
 * hypnogram from the watch app cannot be reproduced — inventing the order the
 * stages came in from four totals would be a drawing, not a reading. These two
 * series are what it does send inside the sleep window: HRV, which climbs as
 * the body settles, and stress, which is the pressure signal the watch itself
 * builds its sleep picture from.
 */
export function SleepNightCurve({ series, loading }: SleepNightCurveProps) {
  const { colors } = useChartColors();

  if (loading) {
    return (
      <div className="sleep-curve is-empty">
        <Loader2 className="spin" size={16} aria-hidden="true" />
        <p>Loading the night…</p>
      </div>
    );
  }

  if (!series || (series.hrv.length === 0 && series.stress.length === 0)) {
    return (
      <div className="sleep-curve is-empty">
        <p>
          {series?.error ??
            "No overnight HRV or stress samples for this night. COROS keeps them for about a week."}
        </p>
      </div>
    );
  }

  const rows = merge(series);
  const start = series.windowStart ?? rows[0].at;
  const end = series.windowEnd ?? rows[rows.length - 1].at;
  const hasHrv = series.hrv.length > 0;
  const hasStress = series.stress.length > 0;
  const assessment = series.assessment;

  return (
    <div className="sleep-curve">
      <div className="sleep-curve-head">
        <p className="sleep-curve-title">
          Across the night
          <span>
            {formatClock(start)} – {formatClock(end)}
          </span>
        </p>
        {assessment?.avg !== undefined ? (
          <p className="sleep-curve-assessment">
            HRV avg <strong>{Math.round(assessment.avg)} ms</strong>
            {assessment.evaluation ? ` · ${assessment.evaluation}` : ""}
            {assessment.normalLow !== undefined && assessment.normalHigh !== undefined
              ? ` · normal ${Math.round(assessment.normalLow)}–${Math.round(
                  assessment.normalHigh
                )} ms`
              : ""}
          </p>
        ) : null}
      </div>

      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={rows} margin={trainingChartMargin}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 6" vertical={false} />

          {/* COROS's own normal band, so a reading is judged against its
              baseline rather than against the shape of one night. */}
          {assessment?.normalLow !== undefined && assessment.normalHigh !== undefined ? (
            <ReferenceArea
              yAxisId="hrv"
              y1={assessment.normalLow}
              y2={assessment.normalHigh}
              fill={colors.accentSoft}
              fillOpacity={0.35}
              stroke="none"
            />
          ) : null}

          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={[start, end]}
            ticks={hourTicks(start, end)}
            tickFormatter={formatClock}
            stroke={colors.text}
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <YAxis
            yAxisId="hrv"
            stroke={colors.text}
            tickLine={false}
            axisLine={false}
            width={38}
            fontSize={11}
            tickFormatter={(value: number) => `${Math.round(value)}`}
            label={undefined}
          />
          <YAxis
            yAxisId="stress"
            orientation="right"
            stroke={colors.text}
            tickLine={false}
            axisLine={false}
            width={30}
            domain={[0, 100]}
            fontSize={11}
          />
          <Tooltip
            contentStyle={trainingChartTooltipStyle}
            cursor={{ stroke: colors.cursor }}
            labelFormatter={(value) => formatClock(Number(value))}
            formatter={(value, name) => {
              const numeric = typeof value === "number" ? value : Number(value);
              const label = String(name);
              if (!Number.isFinite(numeric)) {
                return ["–", label];
              }
              return label === "HRV"
                ? [`${Math.round(numeric)} ms`, label]
                : [String(Math.round(numeric)), label];
            }}
          />

          {hasStress ? (
            <Area
              yAxisId="stress"
              type="monotone"
              dataKey="stress"
              name="Stress"
              stroke={colors.gold}
              strokeWidth={1.5}
              fill={colors.gold}
              fillOpacity={0.14}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
          {hasHrv ? (
            <Line
              yAxisId="hrv"
              type="monotone"
              dataKey="hrv"
              name="HRV"
              stroke={colors.accentBright}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>

      <p className="sleep-curve-note">
        HRV in ms (left) and stress (right), clipped to the sleep window. COROS
        sends no stage-by-stage timeline, so this is the night's shape rather
        than the watch app's hypnogram.
      </p>
    </div>
  );
}
