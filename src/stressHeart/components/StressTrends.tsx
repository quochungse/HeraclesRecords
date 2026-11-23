import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StressHeartDay } from "../../../electron/types";
import { MotionFigure } from "../../motion/MotionFigure";
import { trainingChartMargin, trainingChartTooltipStyle } from "../../training/chartConfig";
import { formatSleepDurationMinutes } from "../../training/formatters";
import { useChartColors } from "../../training/useChartColors";
import { useI18n } from "../../i18n/useI18n";
import {
  STRESS_LEVELS,
  TREND_PERIODS,
  periodDays,
  previousPeriodDays,
  stressFigures,
  stressTrendRows,
  type StressTrendRow,
  type TrendPeriod
} from "../stressHeartModel";
import { stressLevelName } from "../stressLevelNames";
import {
  CHART_HEIGHT,
  DayTip,
  PeriodControl,
  hoveredRow,
  useDeltaLine,
  useLongDate,
  useChartGrowth,
  usePeriod,
  useShortDate,
  type TipRow
} from "./trendParts";

interface TrendProps {
  days: readonly StressHeartDay[];
  byDay: ReadonlyMap<string, StressHeartDay>;
  today: string;
}

/** Hours in each level a day, and the day's average over them. */
export function StressTrendPanel({ days, byDay, today }: TrendProps) {
  const { t } = useI18n();
  const { colors } = useChartColors();
  const [period, choose] = usePeriod<TrendPeriod>(28);
  const shortDate = useShortDate();
  const longDate = useLongDate();
  const deltaLine = useDeltaLine();

  const shown = useMemo(() => periodDays(days, period, today), [days, period, today]);
  const rows = useMemo(
    () => stressTrendRows(byDay, shown, today).map(({ day, ...rest }) => ({ date: day, ...rest })),
    [byDay, shown, today]
  );
  const grow = useChartGrowth(rows);
  const figures = useMemo(
    () => stressFigures(byDay, shown, previousPeriodDays(days, period, today), today),
    [byDay, shown, days, period, today]
  );
  const averageLabel = period === null ? t("stress.trend.avgStressAll") : t("stress.trend.avgStress");

  return (
    <section className="panel stress-trend-panel">
      <div className="stress-trend-head">
        <h2 className="stress-pane-title">{t("stress.trend.stressTitle")}</h2>
        <PeriodControl periods={TREND_PERIODS} value={period} onChange={choose} />
      </div>

      <dl className="stress-trend-figures">
        <div>
          <dt>{averageLabel}</dt>
          <dd>
            <strong>
              <MotionFigure
                text={figures.average !== undefined ? String(Math.round(figures.average)) : "–"}
                value={figures.average}
              />
            </strong>
            <span>{deltaLine(figures.average, figures.previousAverage)}</span>
          </dd>
        </div>
        <div>
          <dt>{t("stress.trend.highPerDay")}</dt>
          <dd>
            <strong>
              <MotionFigure
                text={figures.highPerDay !== undefined ? formatSleepDurationMinutes(figures.highPerDay) : "–"}
                value={figures.highPerDay}
              />
            </strong>
            <span>{t("stress.trend.highNote")}</span>
          </dd>
        </div>
        <div>
          <dt>{stressLevelName("relaxed")}</dt>
          <dd>
            <strong>
              <MotionFigure
                text={figures.relaxedShare !== undefined ? `${Math.round(figures.relaxedShare)}%` : "–"}
                value={figures.relaxedShare}
              />
            </strong>
            <span>{t("stress.trend.ofMeasured")}</span>
          </dd>
        </div>
      </dl>

      <div className="stress-trend-chart" data-grow={grow}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={rows} margin={trainingChartMargin} barCategoryGap="22%">
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 6" vertical={false} />
            <XAxis
              dataKey="date"
              stroke={colors.text}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              fontSize={11}
              tickFormatter={shortDate}
            />
            <YAxis
              yAxisId="hours"
              stroke={colors.text}
              tickLine={false}
              axisLine={false}
              width={34}
              fontSize={11}
              domain={[0, 24]}
              ticks={[0, 6, 12, 18, 24]}
              tickFormatter={(value: number) => `${value}h`} // i18n-ignore
            />
            <YAxis
              yAxisId="stress"
              orientation="right"
              stroke={colors.text}
              tickLine={false}
              axisLine={false}
              width={30}
              fontSize={11}
              domain={[0, 100]}
              ticks={[0, 50, 100]}
            />
            <Tooltip
              content={(props) => {
                const row = hoveredRow<StressTrendRow & { date: string }>(props);
                if (!row) return null;
                const tipRows: TipRow[] = STRESS_LEVELS.flatMap((level) => {
                  const hours = row[level.key];
                  return hours !== undefined
                    ? [{
                        key: level.key,
                        name: stressLevelName(level.key),
                        color: `var(--stress-${level.key})`,
                        value: formatSleepDurationMinutes(hours * 60)
                      }]
                    : [];
                });
                if (row.average !== undefined) {
                  tipRows.push({
                    key: "average",
                    name: t("stress.trend.average"),
                    color: "var(--accent)",
                    value: String(Math.round(row.average))
                  });
                }
                return <DayTip heading={longDate(row.date)} rows={tipRows} />;
              }}
              contentStyle={trainingChartTooltipStyle}
              cursor={{ fill: colors.cursorBand }}
            />
            {STRESS_LEVELS.map((level, index) => (
              <Bar
                key={level.key}
                yAxisId="hours"
                dataKey={level.key}
                name={stressLevelName(level.key)}
                stackId="levels"
                fill={`var(--stress-${level.key})`}
                radius={index === STRESS_LEVELS.length - 1 ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
            <Line
              yAxisId="stress"
              type="monotone"
              dataKey="average"
              name={t("stress.trend.average")}
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="stress-legend">
        {STRESS_LEVELS.map((level) => (
          <span key={level.key}>
            <i className={`is-${level.key}`} aria-hidden="true" />
            {stressLevelName(level.key)}
          </span>
        ))}
        <span>
          <i className="is-line is-average" aria-hidden="true" />
          {t("stress.trend.average")}
        </span>
      </div>
    </section>
  );
}
