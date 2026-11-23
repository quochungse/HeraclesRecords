import { useState, type PointerEvent } from "react";
import { stressLevelOf } from "../../../electron/stressHeartParser";
import type { StressDaySeries, StressHeartDay } from "../../../electron/types";
import { formatSleepDurationMinutes } from "../../training/formatters";
import { useI18n } from "../../i18n/useI18n";
import {
  MINUTES_PER_SLOT,
  STRESS_LEVELS,
  clockOf,
  dayDate,
  lastReadingSlot,
  measuredMinutes,
  peakReading,
  readingCount,
  type LanePiece,
  type LaneSession,
  type StressLevelKey
} from "../stressHeartModel";
import { stressLevelName } from "../stressLevelNames";
import { StressDayTimeline } from "./StressDayTimeline";

interface StressDayDetailProps {
  day: string;
  record: StressHeartDay | undefined;
  series: StressDaySeries | undefined;
  seriesLoading: boolean;
  sleep: LanePiece[];
  sessions: LaneSession[];
  isToday: boolean;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * One day's stress: its figure, its peak, the readings across it and the time
 * in each level. A day still being lived leads with its latest reading and
 * states no average (see `stressHeartModel.ts`). The levels are one bar whose
 * parts say what they are when pointed at — the timeline above carries no
 * legend, its colours are the bar's.
 */
export function StressDayDetail({ day, record, series, seriesLoading, sleep, sessions, isToday }: StressDayDetailProps) {
  const { t, plural, intl } = useI18n();
  const [pointed, setPointed] = useState<{ level: StressLevelKey; x: number } | null>(null);
  const lastSlot = lastReadingSlot(series);
  const latest = lastSlot >= 0 ? series?.slots[lastSlot] ?? undefined : undefined;
  const figure = isToday ? latest : record?.stressAvg;
  const level = figure !== undefined ? stressLevelOf(figure) : undefined;
  const levels = record?.levels;
  const measured = measuredMinutes(levels);
  const readings = readingCount(series);
  const peak = peakReading(series);

  const when = new Intl.DateTimeFormat(intl, { weekday: "long", month: "short", day: "numeric" }).format(dayDate(day));
  const measuredLine = isToday
    ? t("stress.detail.measuredSoFar", { duration: formatSleepDurationMinutes(measured) })
    : t("stress.detail.measured", { duration: formatSleepDurationMinutes(measured) });

  function point(event: PointerEvent<HTMLSpanElement>, key: StressLevelKey) {
    const bar = event.currentTarget.parentElement?.getBoundingClientRect();
    setPointed({ level: key, x: bar ? event.clientX - bar.left : 0 });
  }

  const pointedIndex = pointed ? STRESS_LEVELS.findIndex((item) => item.key === pointed.level) : -1;

  return (
    <article className="stress-day-detail" aria-label={t("stress.detail.aria")}>
      <header className="stress-day-detail-header">
        <div>
          <p className="stress-day-detail-date">{isToday ? t("stress.detail.todaySoFar", { day: when }) : when}</p>
          <div className="stress-day-detail-lead">
            <strong className={`stress-day-detail-figure${level ? ` is-${level}` : ""}`}>
              {figure !== undefined ? Math.round(figure) : "–"}
            </strong>
            <span className="stress-day-detail-unit">
              {isToday
                ? lastSlot >= 0
                  ? t("stress.detail.latestAt", { time: clockOf(lastSlot * MINUTES_PER_SLOT) })
                  : t("stress.detail.noReadingYet")
                : t("stress.detail.avgStress")}
            </span>
            {level ? (
              <span className="stress-level-chip">
                <i className={`is-${level}`} aria-hidden="true" />
                {stressLevelName(level)}
              </span>
            ) : null}
          </div>
          <p className="stress-day-detail-sub">
            {measured > 0 || readings > 0
              ? [measuredLine, readings > 0 ? plural("stress.detail.readings", readings) : null]
                  .filter(Boolean)
                  .join(" · ")
              : t("stress.detail.nothingMeasured")}
          </p>
        </div>

        <dl className="stress-day-figures">
          <div className="stress-day-figure">
            <dt>{t("stress.figure.peak")}</dt>
            <dd>
              <strong className={peak ? `is-${stressLevelOf(peak.value)}` : undefined}>
                {peak ? peak.value : "–"}
              </strong>
              <span>{peak ? t("stress.figure.peakAt", { time: clockOf(peak.slot * MINUTES_PER_SLOT) }) : " "}</span>
            </dd>
          </div>
          {(["high", "relaxed"] as const).map((key) => (
            <div key={key} className="stress-day-figure">
              <dt>{key === "high" ? t("stress.figure.high") : stressLevelName("relaxed")}</dt>
              <dd>
                <strong>{levels ? formatSleepDurationMinutes(levels[key]) : "–"}</strong>
                <span>
                  {levels && measured > 0
                    ? t("stress.figure.ofMeasured", { percent: percent(levels[key], measured) })
                    : " "}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {series || !seriesLoading ? (
        <StressDayTimeline series={series} sleep={sleep} sessions={sessions} live={isToday} />
      ) : (
        <div className="stress-timeline is-loading">{t("stress.timeline.loading")}</div>
      )}

      {measured > 0 && levels ? (
        <div className="stress-day-levels" onPointerLeave={() => setPointed(null)}>
          <div className="stress-day-levels-stack" role="img" aria-label={STRESS_LEVELS.map((item) =>
            t("stress.levels.tip", {
              level: stressLevelName(item.key),
              duration: formatSleepDurationMinutes(levels[item.key]),
              percent: percent(levels[item.key], measured)
            })
          ).join(", ")}>
            {STRESS_LEVELS.map((item) =>
              levels[item.key] > 0 ? (
                <span
                  key={item.key}
                  className={`is-${item.key}${pointed && pointed.level !== item.key ? " is-dimmed" : ""}`}
                  style={{ flexGrow: levels[item.key] }}
                  onPointerMove={(event) => point(event, item.key)}
                />
              ) : null
            )}
          </div>
          {pointed ? (
            <div className="stress-levels-tip" style={{ left: pointed.x }} aria-hidden="true">
              <i className={`is-${pointed.level}`} />
              <span>
                {t("stress.levels.range", {
                  level: stressLevelName(pointed.level),
                  low: pointedIndex === 0 ? 0 : STRESS_LEVELS[pointedIndex - 1].max + 1,
                  high: STRESS_LEVELS[pointedIndex].max
                })}
              </span>
              <strong>{formatSleepDurationMinutes(levels[pointed.level])}</strong>
              <span>{`${percent(levels[pointed.level], measured)}%`}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="stress-day-note">{t("stress.detail.note")}</p>
    </article>
  );
}
