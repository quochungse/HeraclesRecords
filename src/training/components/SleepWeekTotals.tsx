import { Activity, Gauge, HeartPulse, Moon } from "lucide-react";
import { formatSleepDurationMinutes } from "../formatters";
import { SLEEP_WEEK_DAYS, type SleepWeekTotals as Totals } from "../sleepWeekTotals";
import { EMPTY_FIGURE, WEEK_TOTALS_ICON_SIZE, WeekTotalsRow } from "./WeekTotals";

function overNights(count: number, noun = "night"): string | undefined {
  return count > 0
    ? `Average of ${count} ${noun}${count === 1 ? "" : "s"} with data`
    : undefined;
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
  const hrv =
    totals.hrvMin !== undefined && totals.hrvMax !== undefined
      ? Math.round(totals.hrvMin) === Math.round(totals.hrvMax)
        ? rounded(totals.hrvMin)
        : `${Math.round(totals.hrvMin)}–${Math.round(totals.hrvMax)}`
      : EMPTY_FIGURE;

  return (
    <section
      className="week-totals sleep-week-totals"
      aria-label={`Last ${SLEEP_WEEK_DAYS} days`}
    >
      <p className="week-totals-caption">Last {SLEEP_WEEK_DAYS} days</p>
      <ul className="week-totals-list">
        <WeekTotalsRow
          icon={<Moon size={WEEK_TOTALS_ICON_SIZE} />}
          label="Avg sleep"
          value={
            totals.avgSleepMinutes !== undefined
              ? formatSleepDurationMinutes(totals.avgSleepMinutes)
              : EMPTY_FIGURE
          }
          hover={
            totals.sleepNights > 0
              ? `Main sleep, naps left out. ${overNights(totals.sleepNights)}`
              : undefined
          }
        />
        <WeekTotalsRow
          icon={<Gauge size={WEEK_TOTALS_ICON_SIZE} />}
          label="Avg score"
          value={rounded(totals.avgScore)}
          hover={overNights(totals.scoreNights)}
        />
        <WeekTotalsRow
          icon={<HeartPulse size={WEEK_TOTALS_ICON_SIZE} />}
          label="Avg RHR"
          value={rounded(totals.avgRhr)}
          unit="bpm"
          hover={overNights(totals.rhrDays, "day")}
        />
        <WeekTotalsRow
          icon={<Activity size={WEEK_TOTALS_ICON_SIZE} />}
          label="HRV range"
          value={hrv}
          unit="ms"
          hover={
            totals.hrvNights > 0
              ? `Lowest to highest of ${totals.hrvNights} night${totals.hrvNights === 1 ? "" : "s"}`
              : undefined
          }
        />
      </ul>
    </section>
  );
}
