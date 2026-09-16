import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Braces,
  CloudOff,
  Loader2,
  RefreshCw,
  X
} from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubSportType
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import type { SportScreenRequest, TrainingHubDetailRequest } from "../types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatDurationSpan,
  formatElevationMeters,
  formatPaceSecondsPerKm,
  formatTrainingTimestamp
} from "../formatters";
import { detailMatchesActivity } from "../activityDetail";
import { sportColorCategory } from "../sportColors";
import {
  isCyclingSportType,
  isStrengthSportType,
  isSwimSportType,
  resolveSportName
} from "../sportTypes";
import { isRunSportType } from "../../running/runSurface";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatSpeedValue } from "../../units/units";
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { ActivitySeriesChart } from "./ActivitySeriesChart";
import { ActivityZoneBar } from "./ActivityZoneBar";
import { StrengthDetailPanel } from "./StrengthDetailPanel";

interface ActivityDetailPaneProps {
  detail: TrainingHubActivityDetail | null;
  listActivity: TrainingHubActivity | null;
  sportTypes: TrainingHubSportType[];
  detailRequest: TrainingHubDetailRequest | null;
  api?: CorosLinkApi | null;
  onRetry: (activity: TrainingHubActivity) => void;
  /** Hands a run or a lifting session to the screen built for that sport. */
  onOpenSportScreen?: (request: SportScreenRequest) => void;
}

interface Figure {
  key: string;
  label: string;
  value: string;
  title?: string;
}

/**
 * Elevation worth drawing a profile of.
 *
 * Under this, the chart auto-scales to GPS noise and draws a sawtooth that
 * reads as interval work: a 12 km road run with four metres of gain came out
 * as a perfect comb. The series chart already carries altitude as a backdrop
 * where a payload has one, so nothing is lost by refusing.
 */
const ELEVATION_PROFILE_MIN_GAIN_M = 30;

/** Paused time worth reporting, in seconds. Below this it is a traffic light. */
const PAUSE_NOTICE_S = 60;

export function ActivityDetailPane({
  detail: incomingDetail,
  listActivity,
  sportTypes,
  detailRequest,
  api = null,
  onRetry,
  onOpenSportScreen
}: ActivityDetailPaneProps) {
  const { unitSystem } = useUnitSystem();
  // A detail belonging to some other session is no detail at all — see
  // `detailMatchesActivity` for the window in which that happens.
  const detail = detailMatchesActivity(incomingDetail, listActivity)
    ? incomingDetail
    : null;

  const [showRaw, setShowRaw] = useState(false);
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [focusLapIndex, setFocusLapIndex] = useState<number | null>(null);

  const sportName = useMemo(() => {
    if (detail) {
      return resolveSportName(detail, sportTypes);
    }
    return listActivity ? resolveSportName(listActivity, sportTypes) : undefined;
  }, [detail, listActivity, sportTypes]);

  const activityId = detail?.activityId ?? listActivity?.activityId;
  const sportType = detail?.sportType ?? listActivity?.sportType;
  const rawAvailable = import.meta.env.DEV && Boolean(api);

  const openRaw = useCallback(async () => {
    if (!api || activityId === undefined) {
      return;
    }

    setShowRaw(true);
    setRaw(null);
    setRawError(null);
    try {
      setRaw(await api.getTrainingHubActivityDetailRaw(activityId, sportType ?? 0));
    } catch (caught) {
      setRawError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [api, activityId, sportType]);

  useEffect(() => {
    if (!showRaw) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRaw(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showRaw]);

  // A new activity's chart must not inherit the previous one's focused lap.
  useEffect(() => {
    setFocusLapIndex(null);
  }, [activityId]);

  const request =
    detailRequest && detailRequest.activityId === listActivity?.activityId
      ? detailRequest
      : null;

  if (!listActivity) {
    return (
      <div className="activity-detail-pane is-blank">
        <p>Pick a session to see its route, its zones and its splits.</p>
      </div>
    );
  }

  if (request?.status === "failed") {
    return (
      <div className="activity-detail-pane is-blank">
        <CloudOff size={22} aria-hidden="true" />
        <p>This activity&apos;s detail did not arrive.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onRetry(listActivity)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="activity-detail-pane is-blank">
        <Loader2 className="spin" size={22} aria-hidden="true" />
        <p>Loading {listActivity.name ?? "activity"}…</p>
      </div>
    );
  }

  const swim = isSwimSportType(sportType);
  const cycling =
    isCyclingSportType(sportType) || /bike|cycl|ride/i.test(sportName ?? "");
  const distance = detail.distance ?? listActivity.distance;
  const duration = detail.duration ?? listActivity.duration;
  const startTime = detail.startTime ?? listActivity.startTime;

  const performance =
    distance && duration
      ? cycling
        ? formatSpeedValue(distance / 1000 / (duration / 3600), unitSystem)
        : !swim
          ? formatPaceSecondsPerKm(duration / (distance / 1000), unitSystem)
          : undefined
      : undefined;

  /*
   * Three figures at the top, then everything else at half the size.
   *
   * The pane used to lay eight identical chips in a row, which gives calories
   * the same weight as distance and leaves nothing for the eye to land on.
   */
  const headline: Figure[] = [];
  if (distance && distance > 0) {
    headline.push({
      key: "distance",
      label: "Distance",
      value: formatDistanceMeters(distance, unitSystem, swim)
    });
  }
  headline.push({
    key: "duration",
    label: "Time",
    value: formatDurationSeconds(duration),
    title: "Activity time, pauses taken out"
  });
  if (performance) {
    headline.push({
      key: "performance",
      label: cycling ? "Avg speed" : "Avg pace",
      value: performance
    });
  } else if (detail.avgHr) {
    headline.push({
      key: "avgHr",
      label: "Avg HR",
      value: `${Math.round(detail.avgHr)} bpm`
    });
  }

  const headlineKeys = new Set(headline.map((figure) => figure.key));
  const rest: Figure[] = [];
  const push = (figure: Figure | null) => {
    if (figure && !headlineKeys.has(figure.key)) {
      rest.push(figure);
    }
  };

  push(
    detail.avgHr
      ? { key: "avgHr", label: "Avg HR", value: `${Math.round(detail.avgHr)} bpm` }
      : null
  );
  push(
    detail.maxHr
      ? { key: "maxHr", label: "Max HR", value: `${Math.round(detail.maxHr)} bpm` }
      : null
  );
  push(
    detail.adjustedPace && !cycling && !swim
      ? {
          key: "adjustedPace",
          label: "Grade-adj. pace",
          value: formatPaceSecondsPerKm(detail.adjustedPace, unitSystem),
          title: "What this pace would have been on the flat"
        }
      : null
  );
  push(
    detail.calories
      ? {
          key: "calories",
          label: "Calories",
          value: Math.round(detail.calories).toLocaleString()
        }
      : null
  );
  push(
    detail.elevationGain
      ? {
          key: "climb",
          label: "Climb",
          value: formatElevationMeters(detail.elevationGain, unitSystem)
        }
      : null
  );
  push(
    detail.elevationLoss
      ? {
          key: "descent",
          label: "Descent",
          value: formatElevationMeters(detail.elevationLoss, unitSystem)
        }
      : null
  );
  push(
    detail.trainingLoad
      ? {
          key: "load",
          label: "Training load",
          value: Math.round(detail.trainingLoad).toLocaleString(),
          title: "As COROS scores this session"
        }
      : null
  );
  // Training effect, on the payload all along and drawn only for strength.
  push(
    detail.effect?.aerobic !== undefined
      ? {
          key: "aerobic",
          label: "Aerobic TE",
          value: detail.effect.aerobic.toFixed(1),
          title: "Aerobic training effect, 0–5"
        }
      : null
  );
  push(
    detail.effect?.anaerobic !== undefined
      ? {
          key: "anaerobic",
          label: "Anaerobic TE",
          value: detail.effect.anaerobic.toFixed(1),
          title: "Anaerobic training effect, 0–5"
        }
      : null
  );
  push(
    detail.effect?.vo2max !== undefined
      ? {
          key: "vo2max",
          label: "VO₂max",
          value: detail.effect.vo2max.toFixed(1),
          title: "As of this session"
        }
      : null
  );
  push(
    detail.dynamics?.avgCadence
      ? {
          key: "cadence",
          label: "Avg cadence",
          value: `${Math.round(detail.dynamics.avgCadence)} ${cycling ? "rpm" : "spm"}`
        }
      : null
  );
  push(
    detail.dynamics?.avgPower
      ? {
          key: "power",
          label: "Avg power",
          value: `${Math.round(detail.dynamics.avgPower)} W`
        }
      : null
  );
  push(
    detail.dynamics?.strideLength
      ? {
          key: "stride",
          label: "Stride",
          value: `${detail.dynamics.strideLength.toFixed(2)} m`
        }
      : null
  );
  push(
    detail.dynamics?.groundTime
      ? {
          key: "groundTime",
          label: "Ground contact",
          value: `${Math.round(detail.dynamics.groundTime)} ms`
        }
      : null
  );
  push(
    detail.dynamics?.verticalOscillation
      ? {
          key: "verticalOscillation",
          label: "Vert. oscillation",
          value: `${detail.dynamics.verticalOscillation.toFixed(1)} cm`
        }
      : null
  );

  const pausedSeconds =
    detail.elapsedDuration !== undefined && duration !== undefined
      ? detail.elapsedDuration - duration
      : undefined;

  const weather = detail.weather;
  const laps = detail.laps.filter(
    (lap) =>
      (lap.distance !== undefined && lap.distance > 0) ||
      (lap.duration !== undefined && lap.duration > 0)
  );
  const series = detail.series ?? [];
  const hasSeries = series.length > 1;
  const gpsPoints =
    detail.track?.points.filter(
      (point) => point.lat !== undefined && point.lon !== undefined
    ).length ?? 0;
  const showElevationProfile =
    !hasSeries &&
    gpsPoints > 1 &&
    (detail.elevationGain ?? 0) >= ELEVATION_PROFILE_MIN_GAIN_M;

  /*
   * Which screen, if any, is built for this sport. Both answers are taken from
   * the module that owns them rather than re-decided here — `isRunSportType`
   * is where the deliberate exclusion of hikes and mountain climbs is written
   * down, and a door that disagrees with the room behind it is worse than no
   * door.
   */
  const sportScreen = isRunSportType(sportType)
    ? ("running" as const)
    : isStrengthSportType(sportType)
      ? ("strength" as const)
      : null;

  return (
    <div className="activity-detail-pane">
      <header className="activity-detail-pane-head">
        <div className="activity-detail-pane-title">
          <h2>{detail.name ?? listActivity.name ?? "Selected activity"}</h2>
          <p className="activity-detail-pane-meta">
            {sportName ? (
              <span className="sport-chip" data-sport={sportColorCategory(sportType)}>
                {sportName}
              </span>
            ) : null}
            {startTime ? <span>{formatTrainingTimestamp(startTime)}</span> : null}
            {pausedSeconds !== undefined && pausedSeconds >= PAUSE_NOTICE_S ? (
              <span title="Wall clock minus activity time">
                Paused {formatDurationSpan(pausedSeconds)}
              </span>
            ) : null}
            {weather?.temperatureC !== undefined ? (
              <span
                title={
                  weather.feelsLikeC !== undefined
                    ? `Felt like ${Math.round(weather.feelsLikeC)}°C`
                    : undefined
                }
              >
                {Math.round(weather.temperatureC)}°C
                {weather.humidityPct !== undefined
                  ? ` · ${Math.round(weather.humidityPct)}% humidity`
                  : ""}
              </span>
            ) : null}
          </p>
        </div>

        <div className="activity-detail-pane-actions">
          {sportScreen && onOpenSportScreen && activityId !== undefined ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onOpenSportScreen({
                  view: sportScreen,
                  activityId,
                  startTime: detail.startTime ?? listActivity?.startTime
                })
              }
            >
              Open in {sportScreen === "running" ? "Running" : "Strength"}
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ) : null}
          {rawAvailable ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Show raw JSON"
              title="Show raw JSON"
              onClick={() => void openRaw()}
            >
              <Braces size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      {detail.strength ? (
        <StrengthDetailPanel strength={detail.strength} />
      ) : (
        <>
          <div className="activity-detail-headline">
            {headline.map((figure) => (
              <div key={figure.key} title={figure.title}>
                <span>{figure.label}</span>
                <strong>{figure.value}</strong>
              </div>
            ))}
          </div>

          {rest.length > 0 ? (
            <div className="activity-detail-figures">
              {rest.map((figure) => (
                <div key={figure.key} title={figure.title}>
                  <span>{figure.label}</span>
                  <strong>{figure.value}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <ActivityZoneBar zones={detail.hrZones} />

          {hasSeries ? (
            <ActivitySeriesChart
              series={series}
              laps={detail.laps}
              hrZones={detail.hrZones}
              focusLapIndex={focusLapIndex}
              onFocusLapHandled={() => setFocusLapIndex(null)}
              activityTime={duration}
            />
          ) : null}

          {gpsPoints > 1 ? (
            <section className="activity-detail-block">
              <h3>Route</h3>
              <ActivityRouteMap track={detail.track} />
            </section>
          ) : null}

          {showElevationProfile ? (
            <section className="activity-detail-block">
              <h3>Elevation</h3>
              <ActivityElevationChart track={detail.track} />
            </section>
          ) : null}

          {laps.length > 0 ? (
            <section className="activity-detail-block">
              <h3>Laps</h3>
              {hasSeries ? (
                <p className="activity-detail-hint">
                  Pick a lap to focus the chart on it.
                </p>
              ) : null}
              {/*
               * No scroller of its own. The pane already scrolls, and a table
               * that scrolled inside it meant reading sixteen splits four at a
               * time through a 258-pixel window with the pane held still.
               */}
              <table className="activity-lap-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col" className="is-numeric">Time</th>
                    <th scope="col" className="is-numeric">Distance</th>
                    <th scope="col" className="is-numeric">Pace</th>
                    <th scope="col" className="is-numeric">Avg HR</th>
                    <th scope="col" className="is-numeric">Max HR</th>
                    <th scope="col" className="is-numeric">Climb</th>
                  </tr>
                </thead>
                <tbody>
                  {laps.map((lap) => (
                    <tr
                      key={lap.index}
                      className={hasSeries ? "is-pickable" : undefined}
                      onClick={
                        hasSeries ? () => setFocusLapIndex(lap.index) : undefined
                      }
                    >
                      <td>{lap.index}</td>
                      <td className="is-numeric">
                        {formatDurationSeconds(lap.duration)}
                      </td>
                      <td className="is-numeric">
                        {formatDistanceMeters(lap.distance, unitSystem, swim)}
                      </td>
                      <td className="is-numeric">
                        {lap.distance && lap.duration
                          ? cycling
                            ? formatSpeedValue(
                                lap.distance / 1000 / (lap.duration / 3600),
                                unitSystem
                              )
                            : formatPaceSecondsPerKm(
                                lap.duration / (lap.distance / 1000),
                                unitSystem
                              )
                          : "—"}
                      </td>
                      <td className="is-numeric">{lap.avgHr ?? "—"}</td>
                      <td className="is-numeric">{lap.maxHr ?? "—"}</td>
                      <td className="is-numeric">
                        {lap.elevationGain
                          ? formatElevationMeters(lap.elevationGain, unitSystem)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}

      {showRaw &&
        createPortal(
          <div
            className="training-raw-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-raw-modal-title"
            onClick={() => setShowRaw(false)}
          >
            <section
              className="panel training-raw-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="training-raw-modal-header">
                <div className="training-raw-modal-title">
                  <Braces size={16} aria-hidden="true" />
                  <h2 id="activity-raw-modal-title">Raw JSON</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close raw JSON"
                  onClick={() => setShowRaw(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div className="training-raw-modal-body">
                {rawError ? (
                  <p className="training-raw-json">{rawError}</p>
                ) : raw ? (
                  <pre className="training-raw-json">
                    {JSON.stringify(raw, null, 2)}
                  </pre>
                ) : (
                  <div className="training-detail-loading">
                    <Loader2 className="spin" size={18} aria-hidden="true" />
                    <p>Fetching payload…</p>
                  </div>
                )}
              </div>
            </section>
          </div>,
          document.body
        )}
    </div>
  );
}
