import { useMemo } from "react";
import { HeartPulse, Loader2 } from "lucide-react";
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
import { t } from "../../i18n/core";

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
        {t("activity.hrv.baseline")}
      </span>
    </div>
  );
}

/** `yyyyMMdd` of the local day `offset` days before today. */
function dayKeyDaysAgo(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Nightly HRV against the baseline COROS keeps for the athlete. Both series
 * ride on the training snapshot's trend points, which is why the Sleep screen
 * takes them as a prop rather than fetching: sleep records carry no HRV at all.
 */
export function HrvBaselineChart({
  points,
  loading = false,
  days
}: {
  points: TrainingTrendPoint[];
  /**
   * A fixed window in days, with no chip and no "Last N days": the Sleep
   * screen's, the days its sleep-length chart draws. Cut by date, as that
   * chart's nights are, rather than by count. Without it the window is the
   * chip's, shared with Overview.
   */
  days?: number;
  /**
   * The snapshot these points come from has not arrived. Without it an empty
   * array reads as "this athlete has no HRV readings", which is a claim about
   * them rather than about the load, and it is the claim every launch made for
   * as long as COROS took to answer.
   */
  loading?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const { colors, metrics } = useChartColors();
  const [trendWindow, setTrendWindow] = useSelectionPreference(
    HRV_WINDOW_PREFERENCE
  );

  const hrvPoints = useMemo(() => {
    const from = days !== undefined ? dayKeyDaysAgo(days - 1) : undefined;
    return (from !== undefined ? points.filter((point) => point.date >= from) : points.slice(-trendWindow))
      .filter(
        (point) =>
          point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
      );
  }, [points, trendWindow, days]);

  return (
    <section className="panel training-chart-panel" data-metric="hrv">
      {days !== undefined ? (
        <div className="hrv-fixed-heading">
          <h2 className="sleep-pane-title">{t("activity.hrv.title")}</h2>
          <HrvChartLegend />
        </div>
      ) : (
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">{t("activity.hrv.title")}</p>
            <h2>{t("overview.sleepTrend.lastDays", { days: trendWindow })}</h2>
          </div>
          <div className="training-chart-heading-side">
            <TrendWindowToggle
              options={TRAINING_TREND_WINDOWS}
              value={trendWindow}
              onChange={setTrendWindow}
              label={t("activity.hrv.range")}
            />
            <HrvChartLegend />
          </div>
        </div>
      )}
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
          icon={loading ? Loader2 : HeartPulse}
          palette={metrics.hrv}
          busy={loading}
          title={loading ? t("activity.hrv.reading") : t("activity.hrv.none")}
        >
          {loading
            ? t("activity.hrv.loading")
            : t("activity.hrv.wear")}
        </EmptyChartNotice>
      )}
    </section>
  );
}
