import { memo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ChartWhenNear } from "./charts/ChartWhenNear";
import type { TooltipContentProps } from "recharts";
import type { FitnessTrendPreview } from "../../electron/types";
import {
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { ChartAreaGradient } from "../training/components/trendChartParts";
import { t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

interface FitnessTrendCardProps {
  preview: FitnessTrendPreview;
}

function TrendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="training-chart-tooltip">
      {label ? <span>{label}</span> : null}
      {payload.map((entry) => (
        <strong key={String(entry.dataKey ?? entry.name)}>
          {entry.name}: {entry.value}
        </strong>
      ))}
    </div>
  );
}

/**
 * Memoised on `preview`, as `ActivityVisualCard` is and for the same reason.
 *
 * Recovery only: HRV against its baseline and the heart rate the night was
 * slept at, average and lowest. A card stored with training load or COROS's
 * daytime resting HR keeps them in its points, undrawn — load is a training
 * figure the coach's words carry, and the daytime figure moves with the day
 * rather than with recovery.
 */
export const FitnessTrendCard = memo(function FitnessTrendCard({
  preview
}: FitnessTrendCardProps) {
  useI18n();
  const { colors, activeDot, metrics } = useChartColors();
  // The night's heart rate wears its own lavender, as on the Sleep screen, so
  // it does not read as a second HRV chart in the accent green and gold above.
  const sleepHr = metrics.sleepHr;
  const hrvPoints = preview.trendPoints.filter(
    (point) => point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
  );
  const sleepHrPoints = preview.trendPoints.filter((point) => point.sleepAvgHr !== undefined);

  return (
    <div className="chat-visual-card">
      <div className="chat-visual-card-header">
        <div>
          <h4>{t("chat.trend.title")}</h4>
          <span className="chat-visual-card-subtitle">
            {t("chat.trend.lastDays", { n: preview.windowDays ?? 7 })}
          </span>
        </div>
      </div>

      {hrvPoints.length > 0 ? (
        <section className="chat-visual-section">
          <h5>{t("chat.trend.hrv")}</h5>
          <div className="chat-visual-chart-shell">
            <ChartWhenNear>
              <ComposedChart data={hrvPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id={`chatHrvFill-${preview.previewId}`} />
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: colors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: colors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  content={(props) => <TrendTooltip {...props} />}
                  contentStyle={trainingChartTooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="avgSleepHrv"
                  name={t("chat.trend.hrvShort")}
                  stroke={colors.accentBright}
                  fill={`url(#chatHrvFill-${preview.previewId})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={activeDot}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="sleepHrvBase"
                  name={t("activity.hrv.baseline")}
                  stroke={colors.gold}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ChartWhenNear>
          </div>
        </section>
      ) : null}

      {sleepHrPoints.length > 0 ? (
        <section className="chat-visual-section">
          <h5>{t("chat.trend.sleepHr")}</h5>
          <div className="chat-visual-chart-shell">
            <ChartWhenNear>
              <ComposedChart data={sleepHrPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient
                    id={`chatSleepHrFill-${preview.previewId}`}
                    stops={sleepHr.stops}
                  />
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: colors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: colors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  domain={["dataMin - 3", "dataMax + 3"]}
                  allowDecimals={false}
                />
                <Tooltip
                  content={(props) => <TrendTooltip {...props} />}
                  contentStyle={trainingChartTooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="sleepAvgHr"
                  name={t("chat.trend.sleepHrAvg")}
                  stroke={sleepHr.stroke}
                  fill={`url(#chatSleepHrFill-${preview.previewId})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ ...activeDot, fill: sleepHr.stroke }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="sleepMinHr"
                  name={t("chat.trend.sleepHrMin")}
                  stroke={sleepHr.chip}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ChartWhenNear>
          </div>
        </section>
      ) : null}

      {hrvPoints.length === 0 && sleepHrPoints.length === 0 ? (
        <p className="chat-visual-empty">{t("chat.trend.none")}</p>
      ) : null}
    </div>
  );
});
