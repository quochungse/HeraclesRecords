import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CloudOff, RefreshCw } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import type { TrainingHubLoadStatus } from "../training/types";
import {
  ActivityRouteCover,
  hasActivityRoute
} from "../training/components/ActivityRouteMap";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatOptionalNumber,
  formatPaceSecondsPerKm,
  formatTrainingTimestamp
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { RunDetailChart } from "./RunDetailChart";
import { RunDetailSkeleton } from "./RunningSkeleton";
import {
  paceHrDecoupling,
  paceSecondsPerKm,
  runSeconds,
  withPausesRemoved
} from "./runMetrics";
import {
  RUN_SURFACE_LABELS,
  classifyRunSurface,
  isOutdoorRunSurface
} from "./runSurface";

interface RunDetailViewProps {
  activity: TrainingHubActivity;
  /** Null until the fetch for *this* run lands. */
  detail: TrainingHubActivityDetail | null;
  /** This run's own detail request — never inferred from the app's `busy`. */
  detailStatus: TrainingHubLoadStatus;
  onBack: () => void;
  /** Fetches this run's detail again after a failed load. */
  onRetry: () => void;
}

/**
 * How much longer start-to-finish has to be than the running itself before it
 * earns a stat of its own. COROS rounds the two separately, so a run that never
 * stopped still comes back a second or two apart, and a "Total time" one second
 * over "Time" is a figure that says nothing.
 */
const MIN_PAUSED_SECONDS_SHOWN = 60;

/**
 * The band at the top of the route cover the heading leaves clear, as a
 * fraction of the page width: 15%, the title's offset in running.css. The route
 * is fitted into it, however tall the stats below make the cover.
 */
const COVER_VISIBLE_BAND = 0.15;

interface Stat {
  label: string;
  value: string;
  title?: string;
}

/**
 * One run, on the whole page.
 *
 * The back button is not the only way out: a screen reached by clicking a row
 * has to answer Escape, or the keyboard route in has no keyboard route out.
 */
export function RunDetailView({
  activity,
  detail,
  detailStatus,
  onBack,
  onRetry
}: RunDetailViewProps) {
  const { unitSystem } = useUnitSystem();
  const surface = classifyRunSurface(activity.sportType);

  const laps = detail?.laps ?? [];
  // On activity time, which is what the laps, the headline and every figure
  // read off the chart are stated in. See `withPausesRemoved`.
  const series = useMemo(
    () => withPausesRemoved(detail?.series ?? [], detail?.pauses),
    [detail]
  );

  // Set from a lap row below, consumed by the chart, then cleared — a lap stays
  // selectable a second time, and the chart is not re-focused on every render.
  const [focusLapIndex, setFocusLapIndex] = useState<number | null>(null);
  const clearFocusLap = useCallback(() => setFocusLapIndex(null), []);

  /**
   * How far pace and heart rate drifted apart over the run. Above roughly 5%
   * the effort was beyond what the athlete could hold — the one thing a single
   * run can say about aerobic durability.
   */
  const decoupling = useMemo(() => paceHrDecoupling(series), [series]);

  const hasRoute = useMemo(() => hasActivityRoute(detail?.track), [detail]);
  const loading = detailStatus === "pending" && detail === null;
  const failed = detailStatus === "failed" && detail === null;
  const awaitingRoute =
    loading && surface !== null && isOutdoorRunSurface(surface);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Something above this page — a menu, a dialog — may already have
      // answered this Escape; one press closes one thing.
      if (event.key === "Escape" && !event.defaultPrevented) {
        onBack();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  const headline = useMemo<Stat[]>(() => {
    const distance = detail?.distance ?? activity.distance;
    const total = detail?.duration ?? activity.duration;
    const active = runSeconds({
      activeDuration: detail?.activeDuration ?? activity.activeDuration,
      duration: total
    });
    const pace = paceSecondsPerKm({
      ...activity,
      distance,
      duration: total,
      activeDuration: active
    });

    const stats: Stat[] = [
      { label: "Distance", value: formatDistanceMeters(distance, unitSystem) },
      {
        label: "Time",
        value: formatDurationSeconds(active),
        title: "Activity time — the pauses are not in it"
      },
      { label: "Pace", value: formatPaceSecondsPerKm(pace, unitSystem) }
    ];

    if (
      total !== undefined &&
      active !== undefined &&
      total - active >= MIN_PAUSED_SECONDS_SHOWN
    ) {
      stats.push({
        label: "Total time",
        value: formatDurationSeconds(total),
        title: `Start to finish, including ${formatDurationSeconds(total - active)} paused`
      });
    }

    if (detail?.adjustedPace !== undefined) {
      stats.push({
        label: "GAP",
        value: formatPaceSecondsPerKm(detail.adjustedPace, unitSystem),
        title: "Grade-adjusted pace — what this effort would have been on the flat"
      });
    }

    const avgHr = detail?.avgHr ?? activity.avgHr;
    if (avgHr !== undefined) {
      stats.push({ label: "Avg HR", value: `${avgHr} bpm` });
    }
    const maxHr = detail?.maxHr ?? activity.maxHr;
    if (maxHr !== undefined) {
      stats.push({ label: "Max HR", value: `${maxHr} bpm` });
    }

    const climb = detail?.elevationGain ?? activity.elevationGain;
    if (climb !== undefined) {
      stats.push({ label: "Climb", value: formatElevationMeters(climb, unitSystem) });
    }

    const load = detail?.trainingLoad ?? activity.trainingLoad;
    if (load !== undefined) {
      stats.push({ label: "Load", value: formatOptionalNumber(Math.round(load)) });
    }

    return stats;
  }, [activity, detail, unitSystem]);

  const decouplingStat = useMemo<Stat | null>(
    () =>
      decoupling === undefined
        ? null
        : {
            label: "Decoupling",
            value: `${decoupling.percent > 0 ? "+" : ""}${decoupling.percent.toFixed(1)}%`,
            title:
              "How far pace and heart rate drifted apart between the first and second half. Under 5% is a run held together."
          },
    [decoupling]
  );

  const dynamics = useMemo<Stat[]>(() => {
    const source = detail?.dynamics;
    if (!source) {
      return [];
    }

    const stats: Stat[] = [];
    if (source.avgCadence !== undefined) {
      stats.push({ label: "Cadence", value: `${Math.round(source.avgCadence)} spm` });
    }
    if (source.strideLength !== undefined) {
      stats.push({ label: "Stride", value: `${source.strideLength.toFixed(2)} m` });
    }
    if (source.groundTime !== undefined) {
      stats.push({ label: "Ground contact", value: `${Math.round(source.groundTime)} ms` });
    }
    if (source.verticalOscillation !== undefined) {
      stats.push({
        label: "Vertical osc.",
        value: `${source.verticalOscillation.toFixed(1)} cm`
      });
    }
    if (source.verticalRatio !== undefined) {
      stats.push({ label: "Vertical ratio", value: `${source.verticalRatio.toFixed(1)}%` });
    }
    if (source.avgPower !== undefined) {
      stats.push({ label: "Power", value: `${Math.round(source.avgPower)} W` });
    }
    return stats;
  }, [detail]);

  const conditions = useMemo<Stat[]>(() => {
    const stats: Stat[] = [];
    if (detail?.effect?.aerobic !== undefined) {
      stats.push({ label: "Aerobic effect", value: detail.effect.aerobic.toFixed(1) });
    }
    if (detail?.effect?.anaerobic !== undefined) {
      stats.push({ label: "Anaerobic effect", value: detail.effect.anaerobic.toFixed(1) });
    }
    if (detail?.effect?.vo2max !== undefined) {
      stats.push({ label: "VO₂max", value: formatOptionalNumber(detail.effect.vo2max) });
    }
    if (detail?.weather?.temperatureC !== undefined) {
      stats.push({
        label: "Temperature",
        value: `${Math.round(detail.weather.temperatureC)}°C`
      });
    }
    if (detail?.weather?.humidityPct !== undefined) {
      stats.push({ label: "Humidity", value: `${Math.round(detail.weather.humidityPct)}%` });
    }
    return stats;
  }, [detail]);

  return (
    <section className="running-view run-detail">
      {/* The route sits under the heading as a cover rather than in a panel of
          its own. An outdoor run whose detail is still on its way keeps the
          cover's space, so the heading does not jump when the map lands. */}
      <div
        className={`run-detail-hero${
          hasRoute || awaitingRoute ? " has-cover" : ""
        }`}
      >
        <div className="run-detail-hero-content">
          <header className="run-detail-header">
            <button type="button" className="run-detail-back" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" />
              <span>Running</span>
            </button>
            <div className="run-detail-title">
              <p className="running-eyebrow">
                {surface ? RUN_SURFACE_LABELS[surface] : "Run"} ·{" "}
                {formatTrainingTimestamp(activity.startTime)}
              </p>
              <h1>
                {activity.name?.trim() ||
                  (surface ? `${RUN_SURFACE_LABELS[surface]} run` : "Run")}
              </h1>
            </div>
          </header>

          <div className="run-detail-stats">
            {[...headline, ...(decouplingStat ? [decouplingStat] : [])].map((stat) => (
              <div className="running-stat" key={stat.label} title={stat.title}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </div>

        {hasRoute ? (
          <ActivityRouteCover
            track={detail?.track}
            className="run-detail-cover"
            visibleBand={COVER_VISIBLE_BAND}
          />
        ) : awaitingRoute ? (
          <div className="run-detail-cover run-skeleton" aria-hidden="true" />
        ) : null}
      </div>

      {/* A detail already on screen stays while it is fetched again; only a
          run with nothing to show yet gets the placeholder. */}
      {loading ? <RunDetailSkeleton /> : null}

      {failed ? (
        <section className="panel running-empty running-state-panel">
          <CloudOff size={22} aria-hidden="true" />
          <div>
            <h3>This run's detail did not load</h3>
            <p>
              The summary above comes from the activity list. The chart, laps and
              route need a second request to COROS, and that one failed.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            Try again
          </button>
        </section>
      ) : null}

      {dynamics.length > 0 ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">Running form</p>
          <div className="run-detail-stats">
            {dynamics.map((stat) => (
              <div className="running-stat" key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {conditions.length > 0 ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">Effect and conditions</p>
          <div className="run-detail-stats">
            {conditions.map((stat) => (
              <div className="running-stat" key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {series.length > 0 ? (
        <RunDetailChart
          series={series}
          laps={laps}
          hrZones={detail?.hrZones ?? []}
          focusLapIndex={focusLapIndex}
          onFocusLapHandled={clearFocusLap}
          activeDuration={detail?.activeDuration ?? activity.activeDuration}
        />
      ) : null}

      {laps.length > 0 ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">Laps</p>
          {/* Seven columns do not fit the narrowest column the window allows;
              a secondary table scrolls inside its panel rather than taking the
              page sideways. */}
          <div className="run-table-scroll">
          <table className="run-list run-lap-table">
            <thead>
              <tr>
                <th scope="col">Lap</th>
                <th scope="col" className="is-numeric">Distance</th>
                <th scope="col" className="is-numeric">Time</th>
                <th scope="col" className="is-numeric">Pace</th>
                <th scope="col" className="is-numeric">Avg HR</th>
                <th scope="col" className="is-numeric">Climb</th>
                <th scope="col" className="is-numeric">Cadence</th>
              </tr>
            </thead>
            <tbody>
              {laps.map((lap) => (
                <tr
                  key={lap.index}
                  tabIndex={0}
                  className="run-lap-row"
                  title="Focus the chart on this lap"
                  onClick={() => setFocusLapIndex(lap.index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setFocusLapIndex(lap.index);
                    }
                  }}
                >
                  {/* Already counted from one by the parser. */}
                  <td>{lap.index}</td>
                  <td className="is-numeric">
                    {formatDistanceMeters(lap.distance, unitSystem)}
                  </td>
                  <td className="is-numeric">{formatDurationSeconds(lap.duration)}</td>
                  <td className="is-numeric">
                    {formatPaceSecondsPerKm(lap.pace, unitSystem)}
                  </td>
                  <td className="is-numeric">{lap.avgHr ?? "—"}</td>
                  <td className="is-numeric">
                    {lap.elevationGain === undefined
                      ? "—"
                      : formatElevationMeters(lap.elevationGain, unitSystem)}
                  </td>
                  <td className="is-numeric">
                    {lap.avgCadence === undefined ? "—" : Math.round(lap.avgCadence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}
