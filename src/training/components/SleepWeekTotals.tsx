import { Activity, Gauge, HeartPulse, Moon } from "lucide-react";
import { formatSleepDurationMinutes } from "../formatters";
import { SLEEP_WEEK_DAYS, type SleepWeekTotals as Totals } from "../sleepWeekTotals";
import { EMPTY_FIGURE, WEEK_TOTALS_ICON_SIZE, WeekTotalsRow } from "./WeekTotals";
import { plural, t } from "../../i18n/core";
import { useI18n } from "../../i18n/useI18n";

function overNights(count: number, unit: "night" | "day" = "night"): string | undefined {
  if (count <= 0) return undefined;
  return unit === "day"
    ? plural("overview.sleepWeek.overDays", count)
    : plural("overview.sleepWeek.overNights", count);
}

function rounded(value?: number): string {
  return value !== undefined ? String(Math.round(value)) : EMPTY_FIGURE;
}

/**
 * The seven days up to the night the Sleep card shows, beside it — the column
 * Weekly Activity has, built of the same rows. Every figure is over the days
 * that have it (`buildSleepWeekTotals`), so a night without data is not a zero.
 */
export function SleepWeekTotals({ totals }: { totals: Totals }) {
  useI18n();
  const hrv =
    totals.hrvMin !== undefined && totals.hrvMax !== undefined
      ? Math.round(totals.hrvMin) === Math.round(totals.hrvMax)
        ? rounded(totals.hrvMin)
        : `${Math.round(totals.hrvMin)}–${Math.round(totals.hrvMax)}`
      : EMPTY_FIGURE;

  return (
    <section
      className="week-totals sleep-week-totals"
      aria-label={t("overview.sleepTrend.lastDays", { days: SLEEP_WEEK_DAYS })}
    >
      <p className="week-totals-caption">{t("overview.sleepTrend.lastDays", { days: SLEEP_WEEK_DAYS })}</p>
      <ul className="week-totals-list">
        <WeekTotalsRow
          icon={<Moon size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.sleepWeek.avgSleep")}
          value={
            totals.avgSleepMinutes !== undefined
              ? formatSleepDurationMinutes(totals.avgSleepMinutes)
              : EMPTY_FIGURE
          }
          hover={
            totals.sleepNights > 0
              ? t("overview.sleepWeek.mainSleep", { over: overNights(totals.sleepNights) ?? "" })
              : undefined
          }
        />
        <WeekTotalsRow
          icon={<Gauge size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.sleepWeek.avgScore")}
          value={rounded(totals.avgScore)}
          hover={overNights(totals.scoreNights)}
        />
        <WeekTotalsRow
          icon={<HeartPulse size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.sleepWeek.avgRhr")}
          value={rounded(totals.avgRhr)}
          unit="bpm"
          hover={overNights(totals.rhrDays, "day")}
        />
        <WeekTotalsRow
          icon={<Activity size={WEEK_TOTALS_ICON_SIZE} />}
          label={t("overview.sleepWeek.hrvRange")}
          value={hrv}
          unit="ms"
          hover={
            totals.hrvNights > 0
              ? plural("overview.sleepWeek.hrvOver", totals.hrvNights)
              : undefined
          }
        />
      </ul>
    </section>
  );
}
