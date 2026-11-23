import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StressHeartDay } from "../../../electron/types";
import { MotionFigure } from "../../motion/MotionFigure";
import { trainingChartMargin, trainingChartTooltipStyle } from "../../training/chartConfig";
import { useChartColors } from "../../training/useChartColors";
import { useI18n } from "../../i18n/useI18n";
import {
  TREND_PERIODS,
  heartFigures,
  heartTrendRows,
  periodDays,
  previousPeriodDays,
  type HeartTrendRow,
  type TrendPeriod
} from "../stressHeartModel";
import {
  BPM,
  CHART_HEIGHT,
  DayTip,
  PeriodControl,
  bpm,
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

/**
 * The chart's scale: from 40 bpm (or the decade under a lower reading),
 * spanning at least 150 bpm, ticked every 30.
 */
function heartScale(lows: number[], highs: number[]): { domain: [number, number]; ticks: number[] } {
  const low = Math.min(40, lows.length > 0 ? Math.floor(Math.min(...lows) / 10) * 10 : 40);
  const high = Math.max(low + 150, highs.length > 0 ? Math.ceil(Math.max(...highs) / 30) * 30 : 0);
  const ticks: number[] = [];
  for (let tick = low; tick <= high; tick += 30) ticks.push(tick);
  return { domain: [low, high], ticks };
}

function figureText(value: number | undefined): string {
  return value !== undefined ? String(Math.round(value)) : "–";
}

/** The day's range, its average and the resting heart rate under it. */
export function HeartTrendPanel({ days, byDay, today }: TrendProps) {
  const { t } = useI18n();
  const { colors } = useChartColors();
  const [period, choose] = usePeriod<TrendPeriod>(28);
  const shortDate = useShortDate();
  const longDate = useLongDate();
  const deltaLine = useDeltaLine();

  const shown = useMemo(() => periodDays(days, period, today), [days, period, today]);
  const rows = useMemo(
    () => heartTrendRows(byDay, shown, today).map(({ day, ...rest }) => ({ date: day, ...rest })),
    [byDay, shown, today]
  );
  const grow = useChartGrowth(rows);
  const figures = useMemo(
    () => heartFigures(byDay, shown, previousPeriodDays(days, period, today), today),
    [byDay, shown, days, period, today]
  );
  const scale = useMemo(
    () =>
      heartScale(
        rows.flatMap((row) => (row.range ? [row.range[0]] : [])),
        rows.flatMap((row) => (row.range ? [row.range[1]] : []))
      ),
    [rows]
  );

  return (
    <section className="panel stress-trend-panel">
      <div className="stress-trend-head">
        <h2 className="stress-pane-title">{t("heart.trend.title")}</h2>
        <PeriodControl periods={TREND_PERIODS} value={period} onChange={choose} />
      </div>

      <dl className="stress-trend-figures">
        <div className="is-resting">
          <dt>{t("heart.figure.restingHr")}</dt>
          <dd>
            <strong>
              <MotionFigure text={figureText(figures.resting)} value={figures.resting} />
              <small>{BPM}</small>
            </strong>
            <span>{deltaLine(figures.resting, figures.previousResting, ` ${BPM}`)}</span>
          </dd>
        </div>
        <div>
          <dt>{t("heart.figure.avgHr")}</dt>
          <dd>
            <strong>
              <MotionFigure text={figureText(figures.average)} value={figures.average} />
              <small>{BPM}</small>
            </strong>
            <span>{t("heart.trend.wholeDay")}</span>
          </dd>
        </div>
        <div>
          <dt>{t("heart.trend.lowest")}</dt>
          <dd>
            <strong>
              <MotionFigure text={figureText(figures.lowest?.bpm)} value={figures.lowest?.bpm} />
              <small>{BPM}</small>
            </strong>
            <span>{figures.lowest ? shortDate(figures.lowest.day) : " "}</span>
          </dd>
        </div>
      </dl>

      <div className="stress-trend-chart" data-grow={grow}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={rows} margin={trainingChartMargin} barCategoryGap="40%">
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="date" stroke={colors.text} tickLine={false} axisLine={false} minTickGap={28} fontSize={11} tickFormatter={shortDate} />
            <YAxis stroke={colors.text} tickLine={false} axisLine={false} width={34} fontSize={11} domain={scale.domain} ticks={scale.ticks} />
            <Tooltip
              content={(props) => {
                const row = hoveredRow<HeartTrendRow & { date: string }>(props);
                if (!row) return null;
                const tipRows: TipRow[] = [];
                if (row.resting !== undefined) {
                  tipRows.push({ key: "resting", name: t("heart.figure.restingHr"), color: "var(--heart-rate-resting)", value: bpm(row.resting) });
                }
                if (row.average !== undefined) {
                  tipRows.push({ key: "average", name: t("heart.figure.avgHr"), color: "var(--heart-rate)", value: bpm(row.average) });
                }
                if (row.range) {
                  tipRows.push({
                    key: "range",
                    name: t("heart.tip.range"),
                    color: "color-mix(in srgb, var(--heart-rate) 40%, transparent)",
                    value: t("heart.figure.rangeBpm", { low: Math.round(row.range[0]), high: Math.round(row.range[1]) })
                  });
                }
                return <DayTip heading={longDate(row.date)} rows={tipRows} />;
              }}
              contentStyle={trainingChartTooltipStyle}
              cursor={{ fill: colors.cursorBand }}
            />
            <Bar dataKey="range" fill="var(--heart-rate)" fillOpacity={0.28} radius={[2, 2, 2, 2]} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="average"
              stroke="none"
              dot={{ r: 2.5, fill: "var(--heart-rate)", stroke: "none" }}
              activeDot={{ r: 4, fill: "var(--heart-rate)", stroke: "none" }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="resting"
              stroke="var(--heart-rate-resting)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="stress-legend">
        <span>
          <i className="is-line is-resting" aria-hidden="true" />
          {t("heart.figure.restingHr")}
        </span>
        <span>
          <i className="is-dot is-heart" aria-hidden="true" />
          {t("heart.figure.avgHr")}
        </span>
        <span>
          <i className="is-range is-heart" aria-hidden="true" />
          {t("heart.trend.range")}
        </span>
      </div>
    </section>
  );
}
