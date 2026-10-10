import { MessageCircle } from "lucide-react";
import {
  formatDistanceMeters,
  formatDurationSeconds
} from "../training/formatters";
import type { WeeklyStats } from "./calendarTypes";
import { WeekStatsSkeleton } from "./CalendarSkeleton";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation
} from "../units/units";
import { formatDecimal, t } from "../i18n/core";

interface WeekStatsCellProps {
  stats: WeeklyStats;
  /** Whether the range on screen has been read, so an empty week is known to be empty. */
  loaded: boolean;
  /** Set while the range has not been read: the cell shimmers, this far into the grid's wave. */
  placeholderDelayMs?: number;
  onAskCoach: () => void;
}

/**
 * A tone here has to mean something. These three rows used to be painted
 * accent, gold and warning unconditionally — Load Ratio wore the warning colour
 * at a perfectly healthy 1.0 — so the colour said only "this is the third row",
 * which is what the row's own label already said. Only a value that has crossed
 * a band is coloured now, and the band is named in the tooltip.
 */
function StatRow({
  label,
  value,
  tone,
  title
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger";
  title?: string;
}) {
  return (
    <div className="calendar-weekstats-row" title={title}>
      <span className="calendar-weekstats-label">{label}</span>
      <span className={`calendar-weekstats-value ${tone ? `tone-${tone}` : ""}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * COROS's acute-to-chronic style ratio. Under 0.8 is detraining, over 1.5 is
 * the band injury risk climbs in, and the whole middle is simply steady — so
 * only the two ends are worth a colour.
 */
function loadRatioTone(ratio: number): {
  tone?: "ok" | "warn" | "danger";
  title: string;
} {
  if (ratio >= 1.5) {
    return { tone: "danger", title: t("calendar.week.ratio.rampFast") };
  }
  if (ratio >= 1.3) {
    return { tone: "warn", title: t("calendar.week.ratio.building") };
  }
  if (ratio < 0.8) {
    return { tone: "warn", title: t("calendar.week.ratio.easing") };
  }
  return { tone: "ok", title: t("calendar.week.ratio.steady") };
}

/** Where the week's actual load sits against COROS's own recommended band. */
function loadBandTone(
  actual: number,
  min?: number,
  max?: number
): { tone?: "ok" | "warn" | "danger"; title?: string } {
  if (min === undefined || max === undefined || actual === 0) {
    return {};
  }
  if (actual > max) {
    return { tone: "danger", title: t("calendar.week.band.above", { min, max }) };
  }
  if (actual < min) {
    return { tone: "warn", title: t("calendar.week.band.below", { min, max }) };
  }
  return { tone: "ok", title: t("calendar.week.band.inside", { min, max }) };
}

export function WeekStatsCell({
  stats,
  loaded,
  placeholderDelayMs,
  onAskCoach
}: WeekStatsCellProps) {
  const { unitSystem } = useUnitSystem();
  const hasAny =
    stats.actualLoad > 0 ||
    stats.plannedLoad > 0 ||
    stats.activityTimeSeconds > 0 ||
    stats.distanceMeters > 0;

  /* A week with neither a session nor a plan is most of a month opened in
     advance. Seven rows of "--" beside it said nothing and made the grid read
     as broken; one line says the same thing and leaves the eye on the days. */
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

  const ratio = stats.loadRatio;
  const band = loadBandTone(
    stats.actualLoad,
    stats.recommendedLoadMin,
    stats.recommendedLoadMax
  );

  return (
    <div className="calendar-weekstats">
      {stats.baseFitness !== undefined ? (
        <StatRow
          label={t("calendar.week.baseFitness")}
          value={String(Math.round(stats.baseFitness))}
          title={t("calendar.week.baseFitnessTitle")}
        />
      ) : null}
      {stats.loadImpact !== undefined ? (
        <StatRow
          label={t("calendar.week.loadImpact")}
          value={String(Math.round(stats.loadImpact))}
          title={t("calendar.week.loadImpactTitle")}
        />
      ) : null}
      {ratio !== undefined ? (
        <StatRow label={t("calendar.week.loadRatio")} value={formatDecimal(ratio, 2)} {...loadRatioTone(ratio)} />
      ) : null}
      <StatRow
        label={t("calendar.week.trainingLoad")}
        value={
          stats.plannedLoad > 0
            ? t("calendar.loadOf", { actual: stats.actualLoad, planned: stats.plannedLoad })
            : t("units.trainingLoadShort", { value: stats.actualLoad })
        }
        tone={band.tone}
        title={band.title}
      />
      {stats.recommendedLoadMin !== undefined && stats.recommendedLoadMax !== undefined ? (
        <StatRow
          label={t("calendar.week.targetRange")}
          value={t("calendar.week.targetRangeValue", { min: stats.recommendedLoadMin, max: stats.recommendedLoadMax })}
          title={t("calendar.week.targetRangeTitle")}
        />
      ) : null}
      <StatRow
        label={t("calendar.week.activityTime")}
        value={stats.activityTimeSeconds > 0 ? formatDurationSeconds(stats.activityTimeSeconds) : "--"}
      />
      <StatRow
        label={t("activity.m.distance")}
        value={
          stats.plannedDistanceKm > 0
            ? `${formatDecimal(metersToDisplayDistance(stats.distanceMeters, unitSystem), 1)} / ${formatDecimal(metersToDisplayDistance(stats.plannedDistanceKm * 1_000, unitSystem), 1)} ${distanceUnit(unitSystem)}`
            : stats.distanceMeters > 0
              ? formatDistanceMeters(stats.distanceMeters, unitSystem)
              : "--"
        }
      />
      <StatRow
        label={t("calendar.week.elevGain")}
        value={
          stats.elevationGain > 0
            ? `${Math.round(metersToElevation(stats.elevationGain, unitSystem))} ${elevationUnit(unitSystem)}`
            : "--"
        }
      />
      <button
        type="button"
        className="calendar-weekstats-coach"
        onClick={onAskCoach}
        title={t("calendar.week.askTitle")}
      >
        <MessageCircle size={13} aria-hidden="true" />
        {t("activity.askCoach")}
      </button>
    </div>
  );
}
