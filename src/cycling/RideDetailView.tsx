import { useI18n } from "../i18n/useI18n";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, CloudOff, MessageCircle, RefreshCw } from "lucide-react";
import type {
  CoachOpenRequest,
  CorosProfileZone,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubActivityLap
} from "../../electron/types";
import type { TrainingHubLoadStatus } from "../training/types";
import { activityCoachRequest } from "../training/askCoachAbout";
import {
  ActivityRouteCover,
  hasActivityRoute
} from "../training/components/ActivityRouteMap";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatOptionalNumber,
  formatTrainingTimestamp
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatSpeedValue, formatTemperatureValue } from "../units/units";
import { ActivitySeriesChart } from "../training/components/ActivitySeriesChart";
import { withPausesRemoved } from "../../electron/activityMetrics";
import { RunDetailSkeleton } from "../running/RunningSkeleton";
import { useBackGesture } from "../running/sportPage";
import { rideMaxSpeedKmh } from "./rideAnalysis";
import { RideClimbsPanel } from "./RideClimbsPanel";
import { rideSeconds, speedKmh } from "./rideMetrics";
import { RidePowerPanel } from "./RidePowerPanel";
import { StatGrid, type Stat } from "./StatGrid";
import {
  untitledRide,
  RIDE_TYPE_LABELS,
  classifyRideType,
  isOutdoorRideType
} from "./rideType";
import { formatDecimal, t } from "../i18n/core";

interface RideDetailViewProps {
  activity: TrainingHubActivity;
  /** Null until the fetch for *this* ride lands. */
  detail: TrainingHubActivityDetail | null;
  /** This ride's own detail request — never inferred from the app's `busy`. */
  detailStatus: TrainingHubLoadStatus;
  onBack: () => void;
  /** Where Back goes, as its button reads: the list, or the screen the ride came from. */
  backLabel?: string;
  /** Fetches this ride's detail again after a failed load. */
  onRetry: () => void;
  onAskCoach?: (request: CoachOpenRequest) => void;
  /** FTP on the COROS profile, for intensity and TSS. */
  ftp?: number;
  /** The account's cycling power zones, as COROS states them. */
  powerZones?: readonly CorosProfileZone[];
}

/**
 * How much longer start-to-finish has to be than the riding before it earns a
 * stat of its own — see RunDetailView. On a bike this one is usually there: a
 * ride with a coffee stop in it is the ordinary kind.
 */
const MIN_PAUSED_SECONDS_SHOWN = 60;

/** The band at the top of the route cover the heading leaves clear; see running.css. */
const COVER_VISIBLE_BAND = 0.15;

/** A lap's own speed, from its distance and clock, or its pace turned over. */
function lapSpeedKmh(lap: TrainingHubActivityLap): number | undefined {
  const fromTotals = speedKmh(lap);
  if (fromTotals !== undefined) {
    return fromTotals;
  }
  return lap.pace !== undefined && lap.pace > 0 ? 3600 / lap.pace : undefined;
}

/**
 * One ride, on the whole page — Running's detail page with a rider's figures.
 *
 * Speed stands where pace does, with the top speed beside it; the form panel of
 * a run (stride, ground contact, oscillation) gives way to power — normalised,
 * IF and TSS, the ride's peaks and its time in COROS's power zones — which is
 * what a bike measures; the climbs are listed, because a ride's hills are the
 * story of it where a run's are a few hundred metres; and the channel chart
 * reads speed in km/h and cadence in rpm. Aerobic decoupling is left out on
 * purpose: taken from speed, as a run's is, it measures the terrain and the
 * wind as much as the rider.
 */
export function RideDetailView({
  activity,
  detail,
  detailStatus,
  onBack,
  backLabel = t("nav.cycling"),
  onRetry,
  onAskCoach,
  ftp,
  powerZones
}: RideDetailViewProps) {
  const { unitSystem, temperatureUnit } = useUnitSystem();
  const { locale } = useI18n();
  const type = classifyRideType(activity.sportType);

  const laps = detail?.laps ?? [];
  const series = useMemo(
    () => withPausesRemoved(detail?.series ?? [], detail?.pauses),
    [detail]
  );

  const [focusLapIndex, setFocusLapIndex] = useState<number | null>(null);
  const clearFocusLap = useCallback(() => setFocusLapIndex(null), []);

  const maxSpeed = useMemo(() => rideMaxSpeedKmh(series), [series]);

  const hasRoute = useMemo(() => hasActivityRoute(detail?.track), [detail]);
  const loading = detailStatus === "pending" && detail === null;
  const failed = detailStatus === "failed" && detail === null;
  const awaitingRoute = loading && type !== null && isOutdoorRideType(type);

  useBackGesture(onBack);

  const headline = useMemo<Stat[]>(() => {
    const distance = detail?.distance ?? activity.distance;
    const active = rideSeconds({ duration: detail?.duration ?? activity.duration });
    const total = detail?.elapsedDuration ?? activity.elapsedDuration;
    const speed = speedKmh({ distance, duration: active });

    const stats: Stat[] = [
      {
        label: t("activity.m.distance"),
        value: distance !== undefined && distance > 0
          ? formatDistanceMeters(distance, unitSystem)
          : "—"
      },
      {
        label: t("activity.m.time"),
        value: formatDurationSeconds(active),
        title: t("ride.detail.timeTitle")
      },
      {
        label: t("activity.m.speed"),
        value: speed === undefined ? "—" : formatSpeedValue(speed, unitSystem)
      }
    ];

    if (maxSpeed !== undefined && speed !== undefined) {
      stats.push({
        label: t("ride.detail.maxSpeed"),
        value: formatSpeedValue(maxSpeed, unitSystem),
        title: t("ride.detail.maxSpeedTitle")
      });
    }

    if (
      total !== undefined &&
      active !== undefined &&
      total - active >= MIN_PAUSED_SECONDS_SHOWN
    ) {
      stats.push({
        label: t("run.detail.totalTime"),
        value: formatDurationSeconds(total),
        title: t("ride.detail.totalTimeTitle", { stopped: formatDurationSeconds(total - active) })
      });
    }

    const avgHr = detail?.avgHr ?? activity.avgHr;
    if (avgHr !== undefined) {
      stats.push({ label: t("activity.m.avgHr"), value: `${avgHr} bpm` });
    }
    const maxHr = detail?.maxHr ?? activity.maxHr;
    if (maxHr !== undefined) {
      stats.push({ label: t("activity.m.maxHr"), value: `${maxHr} bpm` });
    }

    const climb = detail?.elevationGain ?? activity.elevationGain;
    if (climb !== undefined && climb > 0) {
      stats.push({ label: t("activity.m.climb"), value: formatElevationMeters(climb, unitSystem) });
    }
    const descent = detail?.elevationLoss;
    if (descent !== undefined && descent > 0) {
      stats.push({ label: t("activity.m.descent"), value: formatElevationMeters(descent, unitSystem) });
    }

    const load = detail?.trainingLoad ?? activity.trainingLoad;
    if (load !== undefined) {
      stats.push({ label: t("overview.tiles.load"), value: formatOptionalNumber(Math.round(load)) });
    }

    const calories = detail?.calories ?? activity.calories;
    if (calories !== undefined && calories > 0) {
      stats.push({ label: t("activity.m.calories"), value: `${Math.round(calories)} kcal` });
    }

    return stats;
  }, [activity, detail, maxSpeed, unitSystem, locale]);

  const conditions = useMemo<Stat[]>(() => {
    const stats: Stat[] = [];
    if (detail?.effect?.aerobic !== undefined) {
      stats.push({ label: t("run.detail.aerobic"), value: formatDecimal(detail.effect.aerobic, 1) });
    }
    if (detail?.effect?.anaerobic !== undefined) {
      stats.push({ label: t("run.detail.anaerobic"), value: formatDecimal(detail.effect.anaerobic, 1) });
    }
    if (detail?.weather?.temperatureC !== undefined) {
      stats.push({
        label: t("run.detail.temperature"),
        value: formatTemperatureValue(detail.weather.temperatureC, temperatureUnit)
      });
    }
    if (detail?.weather?.humidityPct !== undefined) {
      stats.push({ label: t("run.detail.humidity"), value: `${Math.round(detail.weather.humidityPct)}%` });
    }
    return stats;
  }, [detail, temperatureUnit, locale]);

  const lapsHavePower = laps.some((lap) => lap.avgPower !== undefined);
  // One lap is the whole ride again: a rider who turned auto-lap off, or a
  // trainer session with no distance to split it by.
  const showLaps = laps.length > 1;

  return (
    <section className="running-view cycling-view run-detail">
      <div
        className={`run-detail-hero${
          hasRoute || awaitingRoute ? " has-cover" : ""
        }`}
      >
        <div className="run-detail-hero-content">
          <header className="run-detail-header">
            <div className="run-detail-header-bar">
              <button type="button" className="run-detail-back" onClick={onBack}>
                <ArrowLeft size={16} aria-hidden="true" />
                <span>{backLabel}</span>
              </button>
              {onAskCoach ? (
                <button
                  type="button"
                  className="ghost-button activity-ask-coach"
                  onClick={() =>
                    onAskCoach(
                      activityCoachRequest(
                        { ...activity, sportName: activity.sportName ?? t("ride.ride") },
                        unitSystem
                      )
                    )
                  }
                >
                  <MessageCircle size={15} aria-hidden="true" />
                  {t("activity.askCoach")}
                </button>
              ) : null}
            </div>
            <div className="run-detail-title">
              <p className="running-eyebrow">
                {type ? RIDE_TYPE_LABELS[type] : t("ride.ride")} ·{" "}
                {formatTrainingTimestamp(activity.startTime)}
              </p>
              <h1>
                {activity.name?.trim() || untitledRide(type)}
              </h1>
            </div>
          </header>

          <StatGrid stats={headline} />
        </div>

        {hasRoute ? (
          <ActivityRouteCover
            track={detail?.track}
            detail={detail ?? undefined}
            className="run-detail-cover"
            visibleBand={COVER_VISIBLE_BAND}
          />
        ) : awaitingRoute ? (
          <div className="run-detail-cover run-skeleton" aria-hidden="true" />
        ) : null}
      </div>

      {loading ? <RunDetailSkeleton label={t("ride.loadingOne")} /> : null}

      {failed ? (
        <section className="panel running-empty running-state-panel">
          <CloudOff size={22} aria-hidden="true" />
          <div>
            <h3>{t("ride.detail.failed")}</h3>
            <p>{t("run.detail.failedBody")}</p>
          </div>
          <button type="button" className="primary-button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("common.tryAgain")}
          </button>
        </section>
      ) : null}

      {detail ? (
        <RidePowerPanel
          series={series}
          dynamics={detail.dynamics}
          ftp={ftp}
          powerZones={powerZones}
        />
      ) : null}

      {conditions.length > 0 ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">{t("run.detail.effect")}</p>
          <StatGrid stats={conditions} />
        </section>
      ) : null}

      {series.length > 0 ? (
        <ActivitySeriesChart
          series={series}
          laps={laps}
          hrZones={detail?.hrZones ?? []}
          focusLapIndex={focusLapIndex}
          onFocusLapHandled={clearFocusLap}
          activityTime={detail?.duration ?? activity.duration}
          motion="speed"
        />
      ) : null}

      {series.length > 0 ? <RideClimbsPanel series={series} /> : null}

      {showLaps ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">{t("activity.m.laps")}</p>
          <div className="run-table-scroll">
            <table className="run-list run-lap-table">
              <thead>
                <tr>
                  <th scope="col">{t("run.detail.lap")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.distance")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.time")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.speed")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.avgHr")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.climb")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.cadence")}</th>
                  {lapsHavePower ? (
                    <th scope="col" className="is-numeric">{t("activity.m.power")}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {laps.map((lap) => {
                  const speed = lapSpeedKmh(lap);
                  return (
                    <tr
                      key={lap.index}
                      tabIndex={0}
                      className="run-lap-row"
                      title={t("run.detail.focusLap")}
                      onClick={() => setFocusLapIndex(lap.index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setFocusLapIndex(lap.index);
                        }
                      }}
                    >
                      <td>{lap.index}</td>
                      <td className="is-numeric">
                        {formatDistanceMeters(lap.distance, unitSystem)}
                      </td>
                      <td className="is-numeric">{formatDurationSeconds(lap.duration)}</td>
                      <td className="is-numeric">
                        {speed === undefined ? "—" : formatSpeedValue(speed, unitSystem)}
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
                      {lapsHavePower ? (
                        <td className="is-numeric">
                          {lap.avgPower === undefined ? "—" : `${Math.round(lap.avgPower)} W`}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}
