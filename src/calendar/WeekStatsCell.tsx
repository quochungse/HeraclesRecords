import { MessageCircle } from "lucide-react";
import type { CSSProperties } from "react";
import { formatDurationSpan } from "../training/formatters";
import type { WeeklyStats } from "./calendarTypes";
import { WeekStatsSkeleton } from "./CalendarSkeleton";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { elevationUnit, formatDistanceValue, metersToElevation } from "../units/units";
import { formatCount, formatDecimal, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

interface WeekStatsCellProps {
  stats: WeeklyStats;
  /** Whether the range on screen has been read, so an empty week is known to be empty. */
  loaded: boolean;
  /** Set while the range has not been read: the cell shimmers, this far into the grid's wave. */
  placeholderDelayMs?: number;
  /**
   * The load the bar's full width stands for, shared by every week on screen
   * so two bars can be compared — see `weekLoadScale`.
   */
  loadScale: number;
  onAskCoach: () => void;
}

/**
 * The bar's full width: past the biggest week on screen — done and still
 * planned together — or its highest COROS target, whichever is more.
 */
export function weekLoadScale(weeks: WeeklyStats[]): number {
  const most = Math.max(
    200,
    ...weeks.map((stats) => Math.max(stats.actualLoad + stats.remainingLoad, stats.recommendedLoadMax ?? 0))
  );
  return most * 1.15;
}

/** Where the week's load sits against COROS's band, said in words on hover. */
function loadBandTitle(actual: number, min?: number, max?: number): string | undefined {
  if (min === undefined || max === undefined || actual === 0) {
    return undefined;
  }
  const band = { min: formatCount(min), max: formatCount(max) };
  if (actual > max) return t("calendar.week.band.above", band);
  if (actual < min) return t("calendar.week.band.below", band);
  return t("calendar.week.band.inside", band);
}

function share(value: number, scale: number): string {
  return `${((Math.max(0, Math.min(value, scale)) / scale) * 100).toFixed(1)}%`;
}

/**
 * A week at a glance: its load as a figure and as a bar — what was done
 * solid, what is still planned hatched — COROS's target for it in words, then
 * the plan apart from the week as it was. A "Planned" row counts only the
 * sessions on the calendar and a "Total" row everything done, so a session
 * nobody planned never reads as part of the plan. Ask Coach sits at the top
 * right, under the pointer, where the load ratio's chip was until it was
 * taken out by decision; the ratio, base fitness, load impact and the climb
 * are in the tooltip. The colours that once marked the target band on the bar
 * said less than the caption under it.
 */
export function WeekStatsCell({
  stats,
  loaded,
  placeholderDelayMs,
  loadScale,
  onAskCoach
}: WeekStatsCellProps) {
  const { rich } = useI18n();
  const { unitSystem } = useUnitSystem();
  const hasAny =
    stats.actualLoad > 0 ||
    stats.plannedLoad > 0 ||
    stats.plannedSessions > 0 ||
    stats.activityTimeSeconds > 0 ||
    stats.distanceMeters > 0;

  /* A week with neither a session nor a plan is most of a month opened in
     advance. Rows of "--" beside it said nothing and made the grid read as
     broken; one line says the same thing and leaves the eye on the days. */
  if (!hasAny) {
    /* Until the range has been read, an empty week is only a week nobody has
       asked COROS about yet. Saying "nothing planned" there told every athlete
       on every launch that their month was empty, then took it back. The cell
       stays, so the grid keeps its column, and says nothing. */
    if (!loaded) {
      return (
        <div className="calendar-weekstats" aria-hidden="true">
          {placeholderDelayMs !== undefined ? (
            <WeekStatsSkeleton delayMs={placeholderDelayMs} />
          ) : null}
        </div>
      );
    }
    return (
      <div className="calendar-weekstats is-empty">
        <p className="calendar-weekstats-empty">{t("calendar.week.empty")}</p>
      </div>
    );
  }

  /* A week nothing has been done in yet reads as what it will be. */
  const upcoming = stats.actualLoad === 0 && stats.remainingLoad > 0;
  const min = stats.recommendedLoadMin;
  const max = stats.recommendedLoadMax;
  const hasTarget = min !== undefined && max !== undefined;

  const rows: Array<{ label: string; value: string }> = [];
  if (stats.plannedSessions > 0) {
    rows.push({
      label: t("calendar.week.plannedSessions"),
      value: `${stats.plannedSessionsDone} / ${stats.plannedSessions}`
    });
    if (stats.plannedSeconds !== undefined) {
      rows.push({
        label: t("calendar.week.plannedTime"),
        value: `${formatDurationSpan(stats.plannedDoneSeconds)} / ${formatDurationSpan(stats.plannedSeconds)}`
      });
    }
  }
  if (stats.activityTimeSeconds > 0) {
    rows.push({ label: t("calendar.week.totalTime"), value: formatDurationSpan(stats.activityTimeSeconds) });
  }
  if (stats.distanceMeters > 0) {
    rows.push({
      label: t("calendar.week.totalDistance"),
      value: formatDistanceValue(stats.distanceMeters, unitSystem, { digits: 1 })
    });
  }

  const tooltip = [
    stats.loadRatio !== undefined ? `${t("calendar.week.loadRatio")} ${formatDecimal(stats.loadRatio, 2)}` : undefined,
    stats.baseFitness !== undefined ? `${t("calendar.week.baseFitness")} ${Math.round(stats.baseFitness)}` : undefined,
    stats.loadImpact !== undefined ? `${t("calendar.week.loadImpact")} ${Math.round(stats.loadImpact)}` : undefined,
    stats.elevationGain > 0
      ? `${t("calendar.week.elevGain")} ${Math.round(metersToElevation(stats.elevationGain, unitSystem))} ${elevationUnit(unitSystem)}`
      : undefined
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="calendar-weekstats" title={tooltip || undefined}>
      <div className="calendar-weekstats-top">
        <span
          className="calendar-weekstats-load"
          title={upcoming ? undefined : loadBandTitle(stats.actualLoad, min, max)}
        >
          {rich(
            upcoming ? "calendar.week.loadPlanned" : "calendar.week.load",
            { b: (chunk) => <strong>{chunk}</strong> },
            { value: formatCount(upcoming ? stats.remainingLoad : stats.actualLoad) }
          )}
        </span>
        <button
          type="button"
          className="calendar-weekstats-coach"
          onClick={onAskCoach}
          title={t("calendar.week.askTitle")}
          aria-label={t("calendar.week.askTitle")}
        >
          <MessageCircle size={15} aria-hidden="true" />
        </button>
      </div>
      <div
        className="calendar-weekstats-bar"
        title={
          stats.remainingLoad > 0
            ? t("calendar.week.barTitle", { done: formatCount(stats.actualLoad), remaining: formatCount(stats.remainingLoad) })
            : undefined
        }
        style={
          {
            "--week-done": share(stats.actualLoad, loadScale),
            "--week-remaining": share(stats.remainingLoad, loadScale)
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <span className="calendar-weekstats-bar-done" />
        <span className="calendar-weekstats-bar-remaining" />
      </div>
      <p className="calendar-weekstats-target" title={hasTarget ? t("calendar.week.targetRangeTitle") : undefined}>
        {min !== undefined && max !== undefined
          ? t("calendar.week.target", { min: formatCount(min), max: formatCount(max) })
          : t("calendar.week.noTarget")}
      </p>
      {rows.length ? (
        <dl className="calendar-weekstats-rows">
          {rows.map((row) => (
            <div key={row.label} className="calendar-weekstats-row">
              <dt className="calendar-weekstats-label">{row.label}</dt>
              <dd className="calendar-weekstats-value">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
