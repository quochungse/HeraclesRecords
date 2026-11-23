import { useMemo, useRef, useState } from "react";
import type { TooltipContentProps } from "recharts";
import { OptionGroup } from "../../components/OptionGroup";
import { periodDaysFromValue, periodGroupOptions, periodValue, type PeriodDays } from "../../preferences/periodScale";
import { useI18n } from "../../i18n/useI18n";
import { useFigureMotionFor } from "../../motion/useFigureMotionFor";
import { dayDate } from "../stressHeartModel";

/*
 * What the trend panels of Stress level and Heart rate share: the period
 * control, the hover card and the date words.
 *
 * A period chosen here moves the chart, but not through Recharts: it animates
 * by drawing every bar again each frame, and three months of four stacked
 * levels is several hundred bars — the zoom stuttered. Its animation is off
 * (`isAnimationActive={false}`) and `useChartGrowth` hands the chart's frame a
 * `data-grow` the stylesheet answers: the bars rise from the plot's floor and
 * the lines come in, drawn by the browser.
 */

export const CHART_HEIGHT = 220;
/** A unit symbol, the same in every language. */
export const BPM = "bpm"; // i18n-ignore

/**
 * "a" or "b" while a press here is being answered, alternating so a second
 * press restarts the motion; nothing otherwise, so a redraw nobody pressed for
 * (data arriving, a window resized) does not move. Under reduced motion
 * `useFigureMotionFor` answers nothing.
 */
export function useChartGrowth(data: unknown): "a" | "b" | undefined {
  const intent = useFigureMotionFor(data);
  const seen = useRef<{ data: unknown; count: number }>({ data, count: 0 });
  if (intent && seen.current.data !== data) {
    seen.current = { data, count: seen.current.count + 1 };
  }
  return intent ? (seen.current.count % 2 === 1 ? "a" : "b") : undefined; // i18n-ignore: keyframe names, not words
}

export function usePeriod<T extends PeriodDays>(initial: T): [T, (value: string) => void] {
  const [period, setPeriod] = useState<T>(initial);
  return [period, (value) => setPeriod(periodDaysFromValue(value) as T)];
}

export function PeriodControl({
  periods,
  value,
  onChange
}: {
  periods: readonly PeriodDays[];
  value: PeriodDays;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const options = useMemo(() => periodGroupOptions(periods), [periods]);
  return (
    <OptionGroup
      label={t("stress.trend.period")}
      motion="roll"
      tone="quiet"
      size="xs"
      value={periodValue(value)}
      options={options}
      onChange={onChange}
    />
  );
}

export function useShortDate() {
  const { intl } = useI18n();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(intl, { month: "short", day: "numeric" });
    return (day: string) => (/^\d{8}$/.test(day) ? format.format(dayDate(day)) : day);
  }, [intl]);
}

export function useLongDate() {
  const { intl } = useI18n();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(intl, { weekday: "short", month: "short", day: "numeric" });
    return (day: string) => format.format(dayDate(day));
  }, [intl]);
}

/** "+3 against the period before", or why there is none. */
export function useDeltaLine() {
  const { t } = useI18n();
  return (now: number | undefined, before: number | undefined, unit = "") => {
    if (now === undefined || before === undefined) return t("stress.trend.noEarlier");
    const delta = Math.round(now - before);
    if (delta === 0) return t("stress.trend.same");
    return t("stress.trend.delta", { delta: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}${unit}` });
  };
}

export interface TipRow {
  key: string;
  name: string;
  color: string;
  value: string;
}

/**
 * A day's hover card, in the shared tooltip's dress. Its rows are read from
 * the day itself and listed in the legend's order, each with the colour its
 * mark is drawn in — Recharts' own payload names a line drawn without a
 * stroke in no colour at all, and leaves out a series it has no value for.
 */
export function DayTip({ heading, rows }: { heading: string; rows: TipRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="training-chart-tooltip">
      <span
        className="training-chart-tooltip-accent"
        style={{ background: `linear-gradient(90deg, transparent, ${rows[0].color}, transparent)` }}
      />
      <span className="training-chart-tooltip-label">{heading}</span>
      <ul className="training-chart-tooltip-rows">
        {rows.map((row) => (
          <li className="training-chart-tooltip-row" key={row.key}>
            <span className="training-chart-tooltip-key">
              <i aria-hidden="true" style={{ background: row.color, boxShadow: `0 0 8px ${row.color}` }} />
              {row.name}
            </span>
            <strong>{row.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The chart row under the pointer, as the chart was handed it. */
export function hoveredRow<T>(props: TooltipContentProps): T | undefined {
  return props.active ? (props.payload?.[0]?.payload as T | undefined) : undefined;
}

/** The heart-rate scale: from 40 bpm (or the decade under a lower reading) up 150 bpm, ticked every 30. */
export function heartScale(lows: number[], highs: number[]): { domain: [number, number]; ticks: number[] } {
  const low = Math.min(40, lows.length > 0 ? Math.floor(Math.min(...lows) / 10) * 10 : 40);
  const high = Math.max(low + 150, highs.length > 0 ? Math.ceil(Math.max(...highs) / 30) * 30 : 0);
  const ticks: number[] = [];
  for (let tick = low; tick <= high; tick += 30) ticks.push(tick);
  return { domain: [low, high], ticks };
}
