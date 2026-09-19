import { MessageCircle } from "lucide-react";
import {
  formatDistanceMeters,
  formatDurationSeconds
} from "../training/formatters";
import type { WeeklyStats } from "./calendarTypes";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation
} from "../units/units";

interface WeekStatsCellProps {
  stats: WeeklyStats;
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
    return { tone: "danger", title: "Ramping up fast — above the 1.5 load ratio COROS flags." };
  }
  if (ratio >= 1.3) {
    return { tone: "warn", title: "Building — a load ratio above 1.3 is a sharp week." };
  }
  if (ratio < 0.8) {
    return { tone: "warn", title: "Easing off — below 0.8 this week is detraining territory." };
  }
  return { tone: "ok", title: "Steady — a load ratio near 1.0 holds fitness." };
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
    return { tone: "danger", title: `Above the ${min}–${max} TL COROS recommends for this week.` };
  }
  if (actual < min) {
    return { tone: "warn", title: `Below the ${min}–${max} TL COROS recommends for this week.` };
  }
  return { tone: "ok", title: `Inside the ${min}–${max} TL COROS recommends for this week.` };
}

export function WeekStatsCell({ stats, onAskCoach }: WeekStatsCellProps) {
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
    return (
      <div className="calendar-weekstats is-empty">
        <p className="calendar-weekstats-empty">Nothing planned or logged</p>
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
          label="Base Fitness"
          value={String(Math.round(stats.baseFitness))}
          title="COROS Base Fitness at the end of this week."
        />
      ) : null}
      {stats.loadImpact !== undefined ? (
        <StatRow
          label="Load Impact"
          value={String(Math.round(stats.loadImpact))}
          title="How much of this week's load is still being carried."
        />
      ) : null}
      {ratio !== undefined ? (
        <StatRow label="Load Ratio" value={ratio.toFixed(2)} {...loadRatioTone(ratio)} />
      ) : null}
      <StatRow
        label="Training Load"
        value={
          stats.plannedLoad > 0
            ? `${stats.actualLoad} / ${stats.plannedLoad} TL`
            : `${stats.actualLoad} TL`
        }
        tone={band.tone}
        title={band.title}
      />
      {stats.recommendedLoadMin !== undefined && stats.recommendedLoadMax !== undefined ? (
        <StatRow
          label="Target Range"
          value={`${stats.recommendedLoadMin}–${stats.recommendedLoadMax} TL`}
          title="COROS's recommended weekly load for your current fitness."
        />
      ) : null}
      <StatRow
        label="Activity Time"
        value={stats.activityTimeSeconds > 0 ? formatDurationSeconds(stats.activityTimeSeconds) : "--"}
      />
      <StatRow
        label="Distance"
        value={
          stats.plannedDistanceKm > 0
            ? `${metersToDisplayDistance(stats.distanceMeters, unitSystem).toFixed(1)} / ${metersToDisplayDistance(stats.plannedDistanceKm * 1_000, unitSystem).toFixed(1)} ${distanceUnit(unitSystem)}`
            : stats.distanceMeters > 0
              ? formatDistanceMeters(stats.distanceMeters, unitSystem)
              : "--"
        }
      />
      <StatRow
        label="Elev. Gain"
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
        title="Ask Coach about this week"
      >
        <MessageCircle size={13} aria-hidden="true" />
        Ask Coach
      </button>
    </div>
  );
}
