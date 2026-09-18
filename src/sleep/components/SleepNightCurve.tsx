import { useLayoutEffect, useRef } from "react";
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
import { trainingChartMargin } from "../../training/chartConfig";
import { useChartColors } from "../../training/useChartColors";
import { mcpShortTextOr } from "../../mcp/mcpNotice";
import type { SleepNightSeries, SleepSeriesPoint } from "../../../electron/types";

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

/**
 * The sample nearest a hovered instant, and how far off it was.
 *
 * The two series are not sampled together: stress lands on a five-minute grid,
 * HRV every ten to fifteen minutes and irregularly. Only about a third of
 * stress readings share a timestamp with an HRV one, so a tooltip that reported
 * only what sits exactly under the cursor said "stress 12" and nothing else on
 * most of the night — while the line above it was drawn straight through, which
 * read as a broken chart rather than as a gap in the data.
 *
 * So the tooltip quotes the nearest real reading and says what time it was
 * taken. Nothing is interpolated; a gap wider than the tolerance is reported as
 * a gap.
 */
function nearestSample(
  points: SleepSeriesPoint[],
  at: number,
  toleranceMs: number
): { point: SleepSeriesPoint; offsetMs: number } | undefined {
  let best: SleepSeriesPoint | undefined;
  let bestGap = Number.POSITIVE_INFINITY;

  for (const point of points) {
    const gap = Math.abs(point.localAt - at);
    if (gap < bestGap) {
      bestGap = gap;
      best = point;
    }
  }

  return best && bestGap <= toleranceMs
    ? { point: best, offsetMs: bestGap }
    : undefined;
}

/** Wide enough to reach the next HRV sample, narrow enough not to span a gap. */
const NEAREST_TOLERANCE_MS = 8 * 60 * 1000;

function CurveTooltip({
  active,
  label,
  series,
  hrvColor,
  stressColor
}: {
  active?: boolean;
  label?: unknown;
  series: SleepNightSeries;
  hrvColor: string;
  stressColor: string;
}) {
  const at = Number(label);
  if (!active || !Number.isFinite(at)) {
    return null;
  }

  const rows: Array<{ key: string; color: string; value: string; taken?: string }> = [];
  const hrv = nearestSample(series.hrv, at, NEAREST_TOLERANCE_MS);
  const stress = nearestSample(series.stress, at, NEAREST_TOLERANCE_MS);

  rows.push({
    key: "HRV",
    color: hrvColor,
    value: hrv ? `${Math.round(hrv.point.value)} ms` : "no sample",
    taken: hrv && hrv.offsetMs >= 60_000 ? hrv.point.clock : undefined
  });
  rows.push({
    key: "Stress",
    color: stressColor,
    value: stress ? String(Math.round(stress.point.value)) : "no sample",
    taken: stress && stress.offsetMs >= 60_000 ? stress.point.clock : undefined
  });

  return (
    <div className="training-chart-tooltip">
      <span
        className="training-chart-tooltip-accent"
        style={{ background: `linear-gradient(90deg, ${hrvColor}, ${stressColor})` }}
      />
      <p className="training-chart-tooltip-label">{formatClock(at)}</p>
      <ul className="training-chart-tooltip-rows">
        {rows.map((row) => (
          <li key={row.key} className="training-chart-tooltip-row">
            <span className="training-chart-tooltip-key">
              <i style={{ background: row.color }} />
              {row.key}
              {row.taken ? (
                <em className="sleep-curve-tooltip-taken">at {row.taken}</em>
              ) : null}
            </span>
            <strong>{row.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
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
  const box = useRef<HTMLDivElement | null>(null);
  // The height this box settled at last, so the wait for a night's samples
  // holds the space rather than dropping it.
  //
  // The three states are three sizes — a chart is 210px of plot plus its
  // heading, an answered "no samples" is a short dashed strip — and swapping
  // through the short one on the way between two charts bounced the page under
  // it by 156px. Holding the last settled height means a selection moves the
  // layout once, when the new night turns out to be a different size, and never
  // on the way there. It cannot be a constant: which size to hold depends on
  // what was on screen, and a fixed one would invent the bounce in the other
  // direction, between two nights that both have no samples.
  const settledHeight = useRef<number | undefined>(undefined);

  // Keyed to the two things that change the box's size. Left with no
  // dependency list it forced a layout on every render of the detail pane,
  // which is every hover and every selection, to re-read a number that had not
  // moved.
  useLayoutEffect(() => {
    if (!loading && box.current) {
      settledHeight.current = box.current.getBoundingClientRect().height;
    }
  }, [loading, series]);

  if (loading) {
    return (
      <div
        ref={box}
        className="sleep-curve is-empty"
        style={{ minHeight: settledHeight.current }}
        aria-busy="true"
      >
        <Loader2 className="spin" size={16} aria-hidden="true" />
        <p>Loading the night…</p>
      </div>
    );
  }

  if (!series || (series.hrv.length === 0 && series.stress.length === 0)) {
    return (
      <div ref={box} className="sleep-curve is-empty">
        <p>
          {/* This night's own error first, then the server, then the
              seven-day limit COROS keeps these under. */}
          {series?.error ??
            mcpShortTextOr(
              series?.mcpState,
              "No overnight samples.",
              "No overnight HRV or stress samples for this night. COROS keeps them for about a week."
            )}
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
    <div ref={box} className="sleep-curve">
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
            cursor={{ stroke: colors.cursor }}
            content={
              <CurveTooltip
                series={series}
                hrvColor={colors.accentBright}
                stressColor={colors.gold}
              />
            }
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
