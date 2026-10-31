import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageKey } from "../../i18n/core";
import {
  ArrowUpRight,
  Braces,
  CloudOff,
  Loader2,
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
import { isSpeedSport, resolveSportName } from "../sportTypes";
import { classifyRunSurface, isRunSportType } from "../../running/runSurface";
import { isRideSportType } from "../../cycling/rideType";
import { isHikeSportType } from "../../hiking/hikeType";
import { isSwimSportType } from "../../swimming/swimType";
import { sportScreenFor, type SportScreen } from "../../navigation/sportScreens";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatTemperatureValue } from "../../units/units";
import { formatSpeedValue } from "../../units/units";
import {
  activityReading,
  formatSwimPace,
  readsMovement
} from "../../../electron/activityReading";
import { ActivityElevationChart } from "./ActivityElevationChart";
import { ActivityExportMenu } from "./ActivityExportMenu";
import { ActivityFeelTag } from "./ActivityFeelTag";
import { ActivitySportBadge } from "./ActivitySportBadge";
import { ActivityRouteMap } from "./ActivityRouteMap";
import { ActivitySeriesChart } from "./ActivitySeriesChart";
import { ActivityZoneBar } from "./ActivityZoneBar";
import { StrengthDetailPanel } from "./StrengthDetailPanel";
import { activityLoadNote } from "../loadFigures";
import { useLoadSource } from "../loadSource";
import { activityCoachRequest } from "../askCoachAbout";
import { detailTrainingBenefit, type BenefitZoneFamily } from "../trainingBenefit";
import { TrainingBenefitChips, TrainingBenefitReason } from "./TrainingBenefitChip";
import { formatCount, formatDecimal, t } from "../../i18n/core";
import { isRecoveryLap, lapSections } from "../../../electron/lapSections";
import { LapRecoveryMark, LapSectionRow } from "./LapSections";

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
  /** The account's heart-rate model the session's label is read on; none until it is known. */
  benefitFamily?: BenefitZoneFamily;
  /** How the session felt, 1–5, as rated in the COROS app; none when unrated. */
  feelRating?: number;
}

interface Figure {
  key: string;
  label: string;
  value: string;
  title?: string;
}

interface FigureGroup {
  key: string;
  title: string;
  figures: Figure[];
}

/**
 * "7.10 km" as "7.10" and "km", so the unit can be set smaller than the
 * figure. Split at the last space, and only when what follows it is not a
 * number itself: "56:27" stays whole, and "2:13 /100m" keeps its "/100m".
 */
function splitFigure(value: string): [string, string | undefined] {
  const match = /^(.*\d)\s+(\S+)$/u.exec(value);
  if (!match || !/\D/u.test(match[2]!.replace(/[\d.,]/gu, ""))) {
    return [value, undefined];
  }
  return [match[1]!, match[2]];
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
 * The screen the "Open in …" button leads to, per sport, named in its words.
 */
const SPORT_SCREEN_LABELS: Record<SportScreen, MessageKey> = {
  running: "nav.running",
  cycling: "nav.cycling",
  hiking: "nav.hiking",
  swimming: "nav.swimming",
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
  onAskCoach,
  benefitFamily,
  feelRating
}: ActivityDetailPaneProps) {
  const { unitSystem, temperatureUnit } = useUnitSystem();
  const { source: loadSource } = useLoadSource();
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

  const reading = activityReading(sportType, sportName);
  const swim = reading === "swim";
  // A hike is read in km/h as a ride is — a 19:40 /km pace says nothing to a
  // walker — but its cadence is still steps, so the two stay apart.
  const cycling = reading === "speed";
  const readsSpeed = isSpeedSport(sportType, sportName);
  const distance = detail.distance ?? listActivity.distance;
  const duration = detail.duration ?? listActivity.duration;
  const startTime = detail.startTime ?? listActivity.startTime;

  // A swim is read per 100 m (or yd), the way a swimmer reads it: a pace per
  // kilometre put a pool session at 20:00 /km.
  const formatPerformance = (meters: number, seconds: number): string =>
    readsSpeed
      ? formatSpeedValue(meters / 1000 / (seconds / 3600), unitSystem)
      : swim
        ? formatSwimPace(seconds / (meters / 1000), unitSystem)
        : formatPaceSecondsPerKm(seconds / (meters / 1000), unitSystem);
  const performance =
    distance && duration && readsMovement(reading)
      ? formatPerformance(distance, duration)
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
  }
  if (detail.avgHr) {
    headline.push({
      key: "avgHr",
      label: t("activity.m.avgHr"),
      value: `${Math.round(detail.avgHr)} bpm`
    });
  }

  /*
   * Everything the headline did not take, in three groups named for what they
   * say — how hard it was, the ground it covered, how the body moved — rather
   * than fifteen equal cells: in a grid a calorie count weighed what the
   * training load did, and the eye had nowhere to start.
   */
  const headlineKeys = new Set(headline.map((figure) => figure.key));
  const effort: Figure[] = [];
  const terrain: Figure[] = [];
  const movement: Figure[] = [];
  const pushTo = (group: Figure[]) => (figure: Figure | null) => {
    if (figure && !headlineKeys.has(figure.key)) {
      group.push(figure);
    }
  };
  let push = pushTo(effort);

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
  push = pushTo(terrain);
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
  pushTo(effort)(
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
  push = pushTo(effort);
  // The list row carries Heracles Training Load; COROS's detail never does.
  const heraclesLoad = loadSource === "heracles" ? listActivity?.heraclesLoad : undefined;
  const shownLoad = heraclesLoad?.value ?? detail.trainingLoad;
  push(
    shownLoad
      ? {
          key: "load",
          label: t("activity.m.trainingLoad"),
          value: formatCount(Math.round(shownLoad)),
          title: [
            t("activity.pane.loadTitle"),
            activityLoadNote({ heraclesLoad }, loadSource)
          ]
            .filter(Boolean)
            .join("\n")
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
  push = pushTo(movement);
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

  // Calories last among the effort figures: it is the one a reader looks for
  // least, and it was pushed before the load only to keep the old grid's order.
  effort.sort((a, b) => Number(a.key === "calories") - Number(b.key === "calories"));

  const groups: FigureGroup[] = [
    { key: "effort", title: t("activity.group.effort"), figures: effort },
    { key: "terrain", title: t("activity.group.terrain"), figures: terrain },
    {
      key: "movement",
      title: isRideSportType(sportType)
        ? t("activity.group.pedalling")
        : isRunSportType(sportType)
          ? t("activity.group.runForm")
          : t("activity.group.movement"),
      figures: movement
    }
  ].filter((group) => group.figures.length > 0);

  const pausedSeconds =
    detail.elapsedDuration !== undefined && duration !== undefined
      ? detail.elapsedDuration - duration
      : 0;
  const showPaused = pausedSeconds >= PAUSE_NOTICE_S;
  const hasZones = detail.hrZones.some((zone) => (zone.seconds ?? 0) > 0);

  const weather = detail.weather;
  const laps = detail.laps.filter(
    (lap) =>
      (lap.distance !== undefined && lap.distance > 0) ||
      (lap.duration !== undefined && lap.duration > 0)
  );
  const lapSectionList = lapSections(laps);
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

  // Read the way a list row's summary is, so the pane and a row agree.
  const benefit = detailTrainingBenefit(detail, sportType, benefitFamily);

  // Which screen, if any, is built for this sport — and none when the athlete
  // took it off the rail.
  const builtScreen = sportScreenFor(sportType);
  const sportScreen =
    builtScreen && !hiddenSportScreens?.includes(builtScreen)
      ? builtScreen
      : null;

  return (
    <div className="activity-detail-pane">
      {/*
        * The sport and the day lead, small, so the session's own name is the
        * first thing read; what was a row of a coloured chip, a date and a
        * weather reading is a line above and a line below it.
        */}
      <header className="activity-detail-pane-head">
        <div className="activity-detail-pane-title">
          <p className="activity-detail-kicker">
            <ActivitySportBadge sportType={sportType} size="sm" />
            <span>
              {[sportName, startTime ? formatTrainingTimestamp(startTime) : undefined]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          <h2>{detail.name ?? listActivity.name ?? t("activity.selected")}</h2>
          {benefit || feelRating !== undefined || showPaused || weather?.temperatureC !== undefined ? (
            <div className="activity-detail-pane-meta">
              {benefit ? <TrainingBenefitChips reading={benefit} /> : null}
              {feelRating !== undefined ? <ActivityFeelTag rating={feelRating} /> : null}
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
              {showPaused ? (
                <span title={t("activity.pane.pausedTitle")}>
                  {t("activity.pane.paused", { time: formatDurationSpan(pausedSeconds) })}
                </span>
              ) : null}
            </div>
          ) : null}
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
              onClick={() =>
                onOpenSportScreen({
                  view: sportScreen,
                  activityId,
                  startTime: detail.startTime ?? listActivity?.startTime
                })
              }
            >
              {t("activity.openIn", { screen: t(SPORT_SCREEN_LABELS[sportScreen]) })}
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          ) : null}
          {/* Export and raw JSON: bare icons at the end of the row — the rarest
              actions in the pane, drawn as such. */}
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
      </header>

      {detail.strength ? (
        <StrengthDetailPanel strength={detail.strength} heraclesLoad={listActivity?.heraclesLoad} />
      ) : (
        <>
          {/* Up to four figures in the display face, each with its unit set
              smaller beside it, on the pane itself rather than in boxes. */}
          <div className="activity-detail-headline">
            {headline.map((figure) => {
              const [amount, unit] = splitFigure(figure.value);
              return (
                <div key={figure.key} title={figure.title}>
                  <span>{figure.label}</span>
                  <strong>
                    {amount}
                    {unit ? <small>{unit}</small> : null}
                  </strong>
                </div>
              );
            })}
          </div>

          {hasZones ? (
            <ActivityZoneBar
              zones={detail.hrZones}
              aside={benefit ? <TrainingBenefitReason reading={benefit} /> : null}
            />
          ) : benefit ? (
            <TrainingBenefitReason reading={benefit} />
          ) : null}

          {groups.length > 0 ? (
            <div className="activity-detail-groups">
              {groups.map((group) => (
                <section className="activity-detail-group" key={group.key}>
                  <h3>{group.title}</h3>
                  <dl>
                    {group.figures.map((figure) => (
                      <div key={figure.key} title={figure.title}>
                        <dt>{figure.label}</dt>
                        <dd>{figure.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ) : null}

          {hasSeries ? (
            <ActivitySeriesChart
              series={series}
              laps={detail.laps}
              hrZones={detail.hrZones}
              focusLapIndex={focusLapIndex}
              onFocusLapHandled={() => setFocusLapIndex(null)}
              activityTime={duration}
              embedded
              sportType={sportType}
              // A ride reads in km/h and rpm here as it does on Cycling, a
              // hike in km/h and metres an hour as it does on Hiking, a trail
              // run in pace and metres an hour as it does on Running, and a
              // swim in pace per 100 and stroke rate as it does on Swimming.
              motion={
                isRideSportType(sportType)
                  ? "speed"
                  : isHikeSportType(sportType)
                    ? "hike"
                    : isSwimSportType(sportType)
                      ? "swim"
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
                  {laps.map((lap, position) => {
                    const recovery = isRecoveryLap(lap, lapSectionList[position]);
                    return (
                      <Fragment key={lap.index}>
                        <LapSectionRow sections={lapSectionList} index={position} colSpan={7} />
                        <tr
                          className={
                            [
                              hasSeries ? "is-pickable" : "",
                              recovery ? "is-lap-recovery" : ""
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          onClick={
                            hasSeries ? () => setFocusLapIndex(lap.index) : undefined
                          }
                        >
                          <td>
                            {lap.index}
                            {recovery ? <LapRecoveryMark /> : null}
                          </td>
                          <td className="is-numeric">
                            {formatDurationSeconds(lap.duration)}
                          </td>
                          <td className="is-numeric">
                            {formatDistanceMeters(lap.distance, unitSystem, swim)}
                          </td>
                          <td className="is-numeric">
                            {lap.distance && lap.duration
                              ? formatPerformance(lap.distance, lap.duration)
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
                      </Fragment>
                    );
                  })}
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
