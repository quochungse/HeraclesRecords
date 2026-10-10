import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageKey } from "../../i18n/core";
import {
  Braces,
  CloudOff,
  Loader2,
  Maximize2,
  MessageCircle,
  RefreshCw,
  X
} from "lucide-react";
import type {
  CoachOpenRequest,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityFileType,
  TrainingHubSportType
} from "../../../electron/types";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
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
  isSwimSportType,
  resolveSportName
} from "../sportTypes";
import { classifyRunSurface } from "../../running/runSurface";
import { isRideSportType } from "../../cycling/rideType";
import { isHikeSportType } from "../../hiking/hikeType";
import { sportScreenFor, type SportScreen } from "../../navigation/sportScreens";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatTemperatureValue } from "../../units/units";
import { formatSpeedValue } from "../../units/units";
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityExportMenu } from "./ActivityExportMenu";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { ActivitySeriesChart } from "./ActivitySeriesChart";
import { ActivityZoneBar } from "./ActivityZoneBar";
import { StrengthDetailPanel } from "./StrengthDetailPanel";
import { activityCoachRequest } from "../askCoachAbout";
import { formatCount, formatDecimal, t } from "../../i18n/core";

interface ActivityDetailPaneProps {
  detail: TrainingHubActivityDetail | null;
  listActivity: TrainingHubActivity | null;
  sportTypes: TrainingHubSportType[];
  detailRequest: TrainingHubDetailRequest | null;
  api?: HeraclesRecordsApi | null;
  /** The app's busy key; an export in flight is read off it. */
  busy?: string | null;
  onRetry: (activity: TrainingHubActivity) => void;
  /** Saves this session's file. Offered quietly, beside the other actions. */
  onExportFile?: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
  /** Hands a run or a lifting session to the screen built for that sport. */
  onOpenSportScreen?: (request: SportScreenRequest) => void;
  /** Sport screens taken off the rail; their door is not offered. */
  hiddenSportScreens?: readonly SportScreen[];
  /** Asks Coach about this session, as the Calendar's Ask Coach does. */
  onAskCoach?: (request: CoachOpenRequest) => void;
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

/**
 * The screen the Open button leads to, per sport. The button itself says only
 * "Open" — the screen is in its tooltip and its accessible name.
 */
const SPORT_SCREEN_LABELS: Record<SportScreen, MessageKey> = {
  running: "nav.running",
  cycling: "nav.cycling",
  hiking: "nav.hiking",
  strength: "nav.strength"
};

export function ActivityDetailPane({
  detail: incomingDetail,
  listActivity,
  sportTypes,
  detailRequest,
  api = null,
  busy = null,
  onRetry,
  onExportFile,
  onOpenSportScreen,
  hiddenSportScreens,
  onAskCoach
}: ActivityDetailPaneProps) {
  const { unitSystem, temperatureUnit } = useUnitSystem();
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
        <p>{t("activity.pane.pick")}</p>
      </div>
    );
  }

  if (request?.status === "failed") {
    return (
      <div className="activity-detail-pane is-blank">
        <CloudOff size={22} aria-hidden="true" />
        <p>{t("activity.detailMissing")}</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onRetry(listActivity)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {t("common.tryAgain")}
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="activity-detail-pane is-blank">
        <Loader2 className="spin" size={22} aria-hidden="true" />
        <p>{t("activity.loadingNamed", { name: listActivity.name ?? t("activity.activity") })}</p>
      </div>
    );
  }

  const swim = isSwimSportType(sportType);
  const cycling =
    isCyclingSportType(sportType) || /bike|cycl|ride/i.test(sportName ?? "");
  // A hike is read in km/h as a ride is — a 19:40 /km pace says nothing to a
  // walker — but its cadence is still steps, so the two stay apart.
  const readsSpeed = cycling || isHikeSportType(sportType);
  const distance = detail.distance ?? listActivity.distance;
  const duration = detail.duration ?? listActivity.duration;
  const startTime = detail.startTime ?? listActivity.startTime;

  const performance =
    distance && duration
      ? readsSpeed
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
      label: t("activity.m.distance"),
      value: formatDistanceMeters(distance, unitSystem, swim)
    });
  }
  headline.push({
    key: "duration",
    label: t("activity.m.time"),
    value: formatDurationSeconds(duration),
    title: t("activity.pane.timeTitle")
  });
  if (performance) {
    headline.push({
      key: "performance",
      label: readsSpeed ? t("activity.m.avgSpeed") : t("activity.m.avgPace"),
      value: performance
    });
  } else if (detail.avgHr) {
    headline.push({
      key: "avgHr",
      label: t("activity.m.avgHr"),
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
      ? { key: "avgHr", label: t("activity.m.avgHr"), value: `${Math.round(detail.avgHr)} bpm` }
      : null
  );
  push(
    detail.maxHr
      ? { key: "maxHr", label: t("activity.m.maxHr"), value: `${Math.round(detail.maxHr)} bpm` }
      : null
  );
  push(
    detail.adjustedPace && !readsSpeed && !swim
      ? {
          key: "adjustedPace",
          label: t("activity.m.gap"),
          value: formatPaceSecondsPerKm(detail.adjustedPace, unitSystem),
          title: t("activity.pane.gapTitle")
        }
      : null
  );
  push(
    detail.calories
      ? {
          key: "calories",
          label: t("activity.m.calories"),
          value: formatCount(Math.round(detail.calories))
        }
      : null
  );
  push(
    detail.elevationGain
      ? {
          key: "climb",
          label: t("activity.m.climb"),
          value: formatElevationMeters(detail.elevationGain, unitSystem)
        }
      : null
  );
  push(
    detail.elevationLoss
      ? {
          key: "descent",
          label: t("activity.m.descent"),
          value: formatElevationMeters(detail.elevationLoss, unitSystem)
        }
      : null
  );
  push(
    detail.trainingLoad
      ? {
          key: "load",
          label: t("activity.m.trainingLoad"),
          value: formatCount(Math.round(detail.trainingLoad)),
          title: t("activity.pane.loadTitle")
        }
      : null
  );
  // Training effect, on the payload all along and drawn only for strength.
  push(
    detail.effect?.aerobic !== undefined
      ? {
          key: "aerobic",
          label: t("activity.m.aerobicTe"),
          value: formatDecimal(detail.effect.aerobic, 1),
          title: t("activity.pane.aerobicTeTitle")
        }
      : null
  );
  push(
    detail.effect?.anaerobic !== undefined
      ? {
          key: "anaerobic",
          label: t("activity.m.anaerobicTe"),
          value: formatDecimal(detail.effect.anaerobic, 1),
          title: t("activity.pane.anaerobicTeTitle")
        }
      : null
  );
  push(
    detail.effect?.vo2max !== undefined
      ? {
          key: "vo2max",
          label: "VO₂max",
          value: formatDecimal(detail.effect.vo2max, 1),
          title: t("activity.pane.vo2Title")
        }
      : null
  );
  push(
    detail.dynamics?.avgCadence
      ? {
          key: "cadence",
          label: t("activity.m.avgCadence"),
          value: `${Math.round(detail.dynamics.avgCadence)} ${cycling ? "rpm" : "spm"}`
        }
      : null
  );
  push(
    detail.dynamics?.avgPower
      ? {
          key: "power",
          label: t("activity.m.avgPower"),
          value: `${Math.round(detail.dynamics.avgPower)} W`
        }
      : null
  );
  push(
    detail.dynamics?.strideLength
      ? {
          key: "stride",
          label: t("activity.m.stride"),
          value: `${formatDecimal(detail.dynamics.strideLength, 2)} m`
        }
      : null
  );
  push(
    detail.dynamics?.groundTime
      ? {
          key: "groundTime",
          label: t("activity.m.groundContact"),
          value: `${Math.round(detail.dynamics.groundTime)} ms`
        }
      : null
  );
  push(
    detail.dynamics?.verticalOscillation
      ? {
          key: "verticalOscillation",
          label: t("activity.m.vertOsc"),
          value: `${formatDecimal(detail.dynamics.verticalOscillation, 1)} cm`
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

  // Which screen, if any, is built for this sport — and none when the athlete
  // took it off the rail.
  const builtScreen = sportScreenFor(sportType);
  const sportScreen =
    builtScreen && !hiddenSportScreens?.includes(builtScreen)
      ? builtScreen
      : null;

  return (
    <div className="activity-detail-pane">
      <header className="activity-detail-pane-head">
        <div className="activity-detail-pane-title">
          <h2>{detail.name ?? listActivity.name ?? t("activity.selected")}</h2>
          <div className="activity-detail-pane-meta">
            {sportName ? (
              <span className="sport-chip" data-sport={sportColorCategory(sportType)}>
                {sportName}
              </span>
            ) : null}
            {startTime ? <span>{formatTrainingTimestamp(startTime)}</span> : null}
            {pausedSeconds !== undefined && pausedSeconds >= PAUSE_NOTICE_S ? (
              <span title={t("activity.pane.pausedTitle")}>
                {t("activity.pane.paused", { time: formatDurationSpan(pausedSeconds) })}
              </span>
            ) : null}
            {weather?.temperatureC !== undefined ? (
              <span
                title={
                  weather.feelsLikeC !== undefined
                    ? t("activity.pane.feltLike", { temp: formatTemperatureValue(weather.feelsLikeC, temperatureUnit) })
                    : undefined
                }
              >
                {formatTemperatureValue(weather.temperatureC, temperatureUnit)}
                {weather.humidityPct !== undefined
                  ? t("activity.pane.humidity", { percent: Math.round(weather.humidityPct) })
                  : ""}
              </span>
            ) : null}
            {onExportFile ? (
              <ActivityExportMenu
                activity={listActivity}
                activityName={detail.name ?? listActivity.name ?? sportName ?? t("activity.activity")}
                busy={busy}
                onExportFile={onExportFile}
              />
            ) : null}
            {rawAvailable ? (
              <button
                type="button"
                className="activity-meta-action"
                aria-label={t("activity.raw.show")}
                title={t("activity.raw.show")}
                onClick={() => void openRaw()}
              >
                <Braces size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="activity-detail-pane-actions">
          {onAskCoach && listActivity ? (
            <button
              type="button"
              className="ghost-button activity-ask-coach"
              onClick={() =>
                onAskCoach(activityCoachRequest({ ...listActivity, ...(sportName ? { sportName } : {}) }, unitSystem))
              }
            >
              <MessageCircle size={15} aria-hidden="true" />
              {t("activity.askCoach")}
            </button>
          ) : null}
          {sportScreen && onOpenSportScreen && activityId !== undefined ? (
            <button
              type="button"
              className="activity-open-screen"
              aria-label={t("activity.openIn", { screen: t(SPORT_SCREEN_LABELS[sportScreen]) })}
              title={t("activity.openIn", { screen: t(SPORT_SCREEN_LABELS[sportScreen]) })}
              onClick={() =>
                onOpenSportScreen({
                  view: sportScreen,
                  activityId,
                  startTime: detail.startTime ?? listActivity?.startTime
                })
              }
            >
              <Maximize2 size={14} aria-hidden="true" />
              {t("activity.open")}
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
              embedded
              // A ride reads in km/h and rpm here as it does on Cycling, a
              // hike in km/h and metres an hour as it does on Hiking, and a
              // trail run in pace and metres an hour as it does on Running.
              motion={
                isRideSportType(sportType)
                  ? "speed"
                  : isHikeSportType(sportType)
                    ? "hike"
                    : classifyRunSurface(sportType) === "trail"
                      ? "trail"
                      : "pace"
              }
            />
          ) : null}

          {gpsPoints > 1 ? (
            <section className="activity-detail-block">
              <h3>{t("activity.m.route")}</h3>
              <ActivityRouteMap track={detail.track} detail={detail} />
            </section>
          ) : null}

          {showElevationProfile ? (
            <section className="activity-detail-block">
              <h3>{t("activity.m.elevation")}</h3>
              <ActivityElevationChart track={detail.track} />
            </section>
          ) : null}

          {laps.length > 0 ? (
            <section className="activity-detail-block">
              <h3>{t("activity.m.laps")}</h3>
              {hasSeries ? (
                <p className="activity-detail-hint">
                  {t("activity.pane.pickLap")}
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
                    <th scope="col" className="is-numeric">{t("activity.m.time")}</th>
                    <th scope="col" className="is-numeric">{t("activity.m.distance")}</th>
                    <th scope="col" className="is-numeric">
                      {readsSpeed ? t("activity.m.speed") : t("activity.m.pace")}
                    </th>
                    <th scope="col" className="is-numeric">{t("activity.m.avgHr")}</th>
                    <th scope="col" className="is-numeric">{t("activity.m.maxHr")}</th>
                    <th scope="col" className="is-numeric">{t("activity.m.climb")}</th>
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
                          ? readsSpeed
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
                  <h2 id="activity-raw-modal-title">{t("activity.raw.title")}</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("activity.raw.close")}
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
                    <p>{t("activity.raw.fetching")}</p>
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
