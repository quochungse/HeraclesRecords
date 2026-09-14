import { useEffect, useMemo } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import { ActivityRouteMap } from "../training/components/ActivityRouteMap";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatOptionalNumber,
  formatPaceSecondsPerKm,
  formatTrainingTimestamp
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { paceSecondsPerKm } from "./runMetrics";
import { RUN_SURFACE_LABELS, classifyRunSurface } from "./runSurface";

interface RunDetailViewProps {
  activity: TrainingHubActivity;
  /** Null until the fetch for *this* run lands. */
  detail: TrainingHubActivityDetail | null;
  loading: boolean;
  onBack: () => void;
}

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
  loading,
  onBack
}: RunDetailViewProps) {
  const { unitSystem } = useUnitSystem();
  const surface = classifyRunSurface(activity.sportType);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onBack();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  const headline = useMemo<Stat[]>(() => {
    const distance = detail?.distance ?? activity.distance;
    const duration = detail?.duration ?? activity.duration;
    const pace = paceSecondsPerKm({
      ...activity,
      ...(distance !== undefined ? { distance } : {}),
      ...(duration !== undefined ? { duration } : {})
    });

    const stats: Stat[] = [
      { label: "Distance", value: formatDistanceMeters(distance, unitSystem) },
      { label: "Time", value: formatDurationSeconds(duration) },
      { label: "Pace", value: formatPaceSecondsPerKm(pace, unitSystem) }
    ];

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

  const laps = detail?.laps ?? [];

  return (
    <section className="running-view run-detail">
      <header className="run-detail-header">
        <button type="button" className="run-detail-back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Running</span>
        </button>
        <div>
          <p className="running-eyebrow">
            {surface ? RUN_SURFACE_LABELS[surface] : "Run"} ·{" "}
            {formatTrainingTimestamp(activity.startTime)}
          </p>
          <h1>{activity.name?.trim() || (surface ? `${RUN_SURFACE_LABELS[surface]} run` : "Run")}</h1>
        </div>
      </header>

      <div className="run-detail-stats">
        {headline.map((stat) => (
          <div className="running-stat" key={stat.label} title={stat.title}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>

      {loading ? (
        <section className="panel run-detail-loading">
          <Loader2 size={18} className="spin" aria-hidden="true" />
          <p>Loading this run from COROS…</p>
        </section>
      ) : null}

      {!loading && detail === null ? (
        <section className="panel run-detail-loading">
          <p>
            COROS returned no detail for this run. The summary above is what the
            activity list carries.
          </p>
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

      {detail?.track ? (
        <section className="panel run-detail-panel run-detail-map">
          <p className="running-eyebrow">Route</p>
          <ActivityRouteMap track={detail.track} />
        </section>
      ) : null}

      {laps.length > 0 ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">Laps</p>
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
                <tr key={lap.index}>
                  <td>{lap.index + 1}</td>
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
        </section>
      ) : null}
    </section>
  );
}
