import { useMemo } from "react";
import { HeartPulse } from "lucide-react";
import { Area, ComposedChart, Line, ResponsiveContainer } from "recharts";
import {
  TRAINING_SHORT_TREND_DAYS,
  TRAINING_TREND_WINDOWS,
  trainingChartMargin,
  type TrainingTrendWindow
} from "../chartConfig";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { useChartColors } from "../useChartColors";
import type { TrainingTrendPoint } from "../types";
import {
  ChartAreaGradient,
  EmptyChartNotice,
  TrendChartAxes,
  TrendWindowToggle,
  formatRoundedValue,
  metricActiveDot,
  metricDot,
  usePrefersReducedMotion
} from "./trendChartParts";

/**
 * Shared by Overview and the Sleep screen, so the window the athlete picks in
 * one is the window they find in the other — nightly HRV is one reading, and
 * two panels disagreeing about how far back it runs would read as two metrics.
 */
const HRV_WINDOW_PREFERENCE = defineSelectionPreference<TrainingTrendWindow>({
  key: "training.hrvTrendWindow",
  defaultValue: TRAINING_SHORT_TREND_DAYS,
  validate: selectionIsOneOf(TRAINING_TREND_WINDOWS)
});

function HrvChartLegend() {
  return (
    <div className="training-chart-legend" aria-hidden="true">
      <span className="training-chart-legend-item">
        <span className="training-chart-legend-dot is-accent" />
        HRV
      </span>
      <span className="training-chart-legend-item">
        <span className="training-chart-legend-line is-gold" />
        Baseline
      </span>
    </div>
  );
}

/**
 * Nightly HRV against the baseline COROS keeps for the athlete. Both series
 * ride on the training snapshot's trend points, which is why the Sleep screen
 * takes them as a prop rather than fetching: sleep records carry no HRV at all.
 */
export function HrvBaselineChart({ points }: { points: TrainingTrendPoint[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const { colors, metrics } = useChartColors();
  const [trendWindow, setTrendWindow] = useSelectionPreference(
    HRV_WINDOW_PREFERENCE
  );

  const hrvPoints = useMemo(
    () =>
      points
        .slice(-trendWindow)
        .filter(
          (point) =>
            point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
        ),
    [points, trendWindow]
  );

  return (
    <section className="panel training-chart-panel" data-metric="hrv">
      <div className="section-heading compact training-chart-heading">
        <div>
          <p className="eyebrow">HRV vs Baseline · ms</p>
          <h2>Last {trendWindow} days</h2>
        </div>
        <div className="training-chart-heading-side">
          <TrendWindowToggle
            options={TRAINING_TREND_WINDOWS}
            value={trendWindow}
            onChange={setTrendWindow}
            label="HRV trend range"
          />
          <HrvChartLegend />
        </div>
      </div>
      {hrvPoints.length > 0 ? (
        <div className="training-chart-shell">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hrvPoints} margin={trainingChartMargin}>
              <defs>
                <ChartAreaGradient id="hrvFill" stops={metrics.hrv.stops} />
              </defs>
              <TrendChartAxes
                tooltipValueFormatter={(value) => `${formatRoundedValue(value)} ms`}
                yAxisDomain={[
                  (dataMin: number) => Math.max(0, Math.floor(dataMin - 14)),
                  (dataMax: number) => Math.ceil(dataMax + 12) || 1
                ]}
              />
              <Area
                type="monotone"
                dataKey="avgSleepHrv"
                name="HRV"
                stroke={metrics.hrv.stroke}
                fill="url(#hrvFill)"
                strokeWidth={2.5}
                dot={metricDot(metrics.hrv, colors.dotStroke)}
                activeDot={metricActiveDot(metrics.hrv)}
                connectNulls
                isAnimationActive={!reducedMotion}
                animationDuration={850}
              />
              <Line
                type="monotone"
                dataKey="sleepHrvBase"
                name="Baseline"
                stroke={colors.gold}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={!reducedMotion}
                animationDuration={850}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyChartNotice
          icon={HeartPulse}
          palette={metrics.hrv}
          title="No HRV readings"
        >
          Wear your device during sleep to capture nightly HRV.
        </EmptyChartNotice>
      )}
    </section>
  );
}
