import { renderRich, useI18n } from "../i18n/useI18n";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, CloudOff, MessageCircle, RefreshCw } from "lucide-react";
import type {
  CoachOpenRequest,
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
import {
  formatSpeedValue,
  formatTemperatureValue,
  formatVerticalRate
} from "../units/units";
import { ActivitySeriesChart } from "../training/components/ActivitySeriesChart";
import { withPausesRemoved } from "../../electron/activityMetrics";
import { RunDetailSkeleton } from "../running/RunningSkeleton";
import { useBackGesture } from "../running/sportPage";
import {
  altitudeRange,
  hikeLegs,
  hikeMovement,
  hikeRests,
  hikeTerrain,
  naismithSeconds,
  type HikeStop
} from "./hikeAnalysis";
import { hikeSeconds } from "./hikeMetrics";
import { HIKE_TYPE_LABELS, classifyHikeType } from "./hikeType";
import { ClimbsPanel, TerrainPanel } from "./TerrainPanels";

import { formatDecimal, getIntlLocale, t } from "../i18n/core";
interface HikeDetailViewProps {
  activity: TrainingHubActivity;
  /** Null until the fetch for *this* hike lands. */
  detail: TrainingHubActivityDetail | null;
  /** This hike's own detail request — never inferred from the app's `busy`. */
  detailStatus: TrainingHubLoadStatus;
  onBack: () => void;
  /** Where Back goes, as its button reads: the list, or the screen the hike came from. */
  backLabel?: string;
  onRetry: () => void;
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/** Stopped time worth a stat of its own. Below it the day had no rest in it to speak of. */
const MIN_STOPPED_SECONDS_SHOWN = 60;

/** The band at the top of the route cover the heading leaves clear; see running.css. */
const COVER_VISIBLE_BAND = 0.15;

interface Stat {
  label: string;
  value: string;
  title?: string;
}

function lapSpeedKmh(lap: TrainingHubActivityLap): number | undefined {
  if (lap.distance !== undefined && lap.distance > 0 && lap.duration !== undefined && lap.duration > 0) {
    return lap.distance / 1000 / (lap.duration / 3600);
  }
  return lap.pace !== undefined && lap.pace > 0 ? 3600 / lap.pace : undefined;
}

function clockAt(startTime: number | undefined, elapsed: number): string | undefined {
  if (startTime === undefined) {
    return undefined;
  }
  return new Date((startTime + elapsed) * 1000).toLocaleTimeString(getIntlLocale(), {
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * One hike, on the whole page — Running's detail page with a walker's figures.
 *
 * What changes is what a day on a trail is read by. The watch kept recording
 * through every stop, so the moving time is worked out of the samples and the
 * rests are listed where they were taken; the day is split into climbing, flat
 * and descending, because the way down is half of a mountain and a run's page
 * never asks about it; the ascents and descents are listed with their rate; and
 * the day is set against Naismith's book time, which is how a walker plans the
 * next one. Speed along the trail is stated in km/h and never as a pace. The
 * running-form panel is gone — a hiking watch records none of it — and so is
 * decoupling, which on a trail measures the gradient far more than the walker.
 */
export function HikeDetailView({
  activity,
  detail,
  detailStatus,
  onBack,
  backLabel = t("nav.hiking"),
  onRetry,
  onAskCoach
}: HikeDetailViewProps) {
  const { unitSystem, temperatureUnit } = useUnitSystem();
  const { locale } = useI18n();
  const type = classifyHikeType(activity.sportType);
  const kindLabel = type ? HIKE_TYPE_LABELS[type] : t("hike.type.hike");

  const laps = detail?.laps ?? [];
  const rawSeries = useMemo(() => detail?.series ?? [], [detail]);
  // On activity time, which is what the laps and the chart are stated in.
  const series = useMemo(
    () => withPausesRemoved(rawSeries, detail?.pauses),
    [detail, rawSeries]
  );

  const movement = useMemo(
    () => hikeMovement(rawSeries, detail?.pauses ?? []),
    [detail, rawSeries]
  );
  const rests = useMemo(() => hikeRests(movement), [movement]);
  const terrain = useMemo(() => hikeTerrain(rawSeries, movement), [movement, rawSeries]);
  const legs = useMemo(() => hikeLegs(rawSeries, movement), [movement, rawSeries]);
  const range = useMemo(() => altitudeRange(rawSeries), [rawSeries]);

  const [focusLapIndex, setFocusLapIndex] = useState<number | null>(null);
  const clearFocusLap = useCallback(() => setFocusLapIndex(null), []);

  const hasRoute = useMemo(() => hasActivityRoute(detail?.track), [detail]);
  const loading = detailStatus === "pending" && detail === null;
  const failed = detailStatus === "failed" && detail === null;

  useBackGesture(onBack);

  const hasSamples = movement.recordedSeconds > 0;
  const movingSeconds = hasSamples ? movement.movingSeconds : undefined;

  const headline = useMemo<Stat[]>(() => {
    const distance = detail?.distance ?? activity.distance;
    const onTrail = hikeSeconds({ duration: detail?.duration ?? activity.duration });
    const total = detail?.elapsedDuration ?? activity.elapsedDuration ?? onTrail;
    const moving = movingSeconds ?? onTrail;
    const ascent = detail?.elevationGain ?? activity.elevationGain;

    const stats: Stat[] = [
      {
        label: t("activity.m.distance"),
        value: distance !== undefined && distance > 0 ? formatDistanceMeters(distance, unitSystem) : "—"
      },
      {
        label: t("hike.detail.moving"),
        value: formatDurationSeconds(moving),
        title: movingSeconds !== undefined
          ? t("hike.detail.movingTitle")
          : t("hike.detail.recordedTitle")
      }
    ];

    if (total !== undefined && moving !== undefined && total - moving >= MIN_STOPPED_SECONDS_SHOWN) {
      stats.push({
        label: t("run.detail.totalTime"),
        value: formatDurationSeconds(total),
        title: t("ride.detail.totalTimeTitle", { stopped: formatDurationSeconds(total - moving) })
      });
    }

    if (distance !== undefined && distance > 0 && moving !== undefined && moving > 0) {
      stats.push({
        label: t("hike.detail.movingSpeed"),
        value: formatSpeedValue(distance / 1000 / (moving / 3600), unitSystem)
      });
    }

    if (ascent !== undefined && ascent > 0) {
      stats.push({ label: t("hike.ascent"), value: formatElevationMeters(ascent, unitSystem) });
    }
    const descent = detail?.elevationLoss;
    if (descent !== undefined && descent > 0) {
      stats.push({ label: t("activity.m.descent"), value: formatElevationMeters(descent, unitSystem) });
    }
    if (range) {
      stats.push({
        label: t("run.detail.highest"),
        value: formatElevationMeters(range.highest, unitSystem),
        title: t("run.detail.lowest", { value: formatElevationMeters(range.lowest, unitSystem) })
      });
    }

    const up = terrain.find((share) => share.kind === "up");
    if (up?.verticalRate !== undefined) {
      stats.push({
        label: t("activity.channel.verticalSpeed"),
        value: formatVerticalRate(up.verticalRate, unitSystem),
        title: t("hike.detail.climbingRateTitle")
      });
    }

    if (distance !== undefined && distance > 0 && moving !== undefined && moving > 0 && ascent !== undefined) {
      const book = naismithSeconds(distance, ascent);
      stats.push({
        label: t("hike.detail.naismith"),
        value: `${formatDecimal(moving / book, 2)}×`,
        title: t("hike.detail.naismithTitle", { book: formatDurationSeconds(book) })
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
    const load = detail?.trainingLoad ?? activity.trainingLoad;
    if (load !== undefined) {
      stats.push({ label: t("overview.tiles.load"), value: formatOptionalNumber(Math.round(load)) });
    }
    const calories = detail?.calories ?? activity.calories;
    if (calories !== undefined && calories > 0) {
      stats.push({ label: t("activity.m.calories"), value: `${Math.round(calories)} kcal` });
    }
    return stats;
  }, [activity, detail, movingSeconds, range, terrain, unitSystem, locale]);

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
    if (detail?.dynamics?.avgCadence !== undefined && detail.dynamics.avgCadence > 0) {
      stats.push({
        label: t("activity.m.cadence"),
        value: `${Math.round(detail.dynamics.avgCadence)} spm`,
        title: t("hike.detail.cadenceTitle")
      });
    }
    return stats;
  }, [detail, temperatureUnit, locale]);

  const showLaps = laps.length > 1;

  return (
    <section className="running-view hiking-view run-detail">
      <div className={`run-detail-hero${hasRoute || loading ? " has-cover" : ""}`}>
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
                        { ...activity, sportName: activity.sportName ?? kindLabel },
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
                {kindLabel} · {formatTrainingTimestamp(activity.startTime)}
              </p>
              <h1>{activity.name?.trim() || kindLabel}</h1>
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
        </div>

        {hasRoute ? (
          <ActivityRouteCover
            track={detail?.track}
            detail={detail ?? undefined}
            className="run-detail-cover"
            visibleBand={COVER_VISIBLE_BAND}
          />
        ) : loading ? (
          <div className="run-detail-cover run-skeleton" aria-hidden="true" />
        ) : null}
      </div>

      {loading ? <RunDetailSkeleton label={t("hike.loadingOne")} /> : null}

      {failed ? (
        <section className="panel running-empty running-state-panel">
          <CloudOff size={22} aria-hidden="true" />
          <div>
            <h3>{t("hike.detail.failed")}</h3>
            <p>{t("hike.detail.failedBody")}</p>
          </div>
          <button type="button" className="primary-button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("common.tryAgain")}
          </button>
        </section>
      ) : null}

      {terrain.length > 0 ? <TerrainPanel terrain={terrain} reading="hike" /> : null}

      {series.length > 0 ? (
        <ActivitySeriesChart
          series={series}
          laps={laps}
          hrZones={detail?.hrZones ?? []}
          focusLapIndex={focusLapIndex}
          onFocusLapHandled={clearFocusLap}
          activityTime={detail?.duration ?? activity.duration}
          motion="hike"
        />
      ) : null}

      {legs.length > 0 ? <ClimbsPanel legs={legs} /> : null}

      {hasSamples ? (
        <HikeRestsPanel
          rests={rests}
          stoppedSeconds={
            movement.recordedSeconds -
            movement.movingSeconds +
            movement.stops.filter((stop) => stop.paused).reduce((sum, stop) => sum + stop.seconds, 0)
          }
          startTime={activity.startTime}
        />
      ) : null}

      {conditions.length > 0 ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">{t("run.detail.effect")}</p>
          <div className="run-detail-stats">
            {conditions.map((stat) => (
              <div className="running-stat" key={stat.label} title={stat.title}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showLaps ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">{t("hike.detail.splits")}</p>
          <div className="run-table-scroll">
            <table className="run-list run-lap-table">
              <thead>
                <tr>
                  <th scope="col">{t("hike.detail.split")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.distance")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.time")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.speed")}</th>
                  <th scope="col" className="is-numeric">{t("hike.ascent")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.avgHr")}</th>
                  <th scope="col" className="is-numeric">{t("activity.m.cadence")}</th>
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
                      title={t("hike.detail.focusSplit")}
                      onClick={() => setFocusLapIndex(lap.index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setFocusLapIndex(lap.index);
                        }
                      }}
                    >
                      <td>{lap.index}</td>
                      <td className="is-numeric">{formatDistanceMeters(lap.distance, unitSystem)}</td>
                      <td className="is-numeric">{formatDurationSeconds(lap.duration)}</td>
                      <td className="is-numeric">
                        {speed === undefined ? "—" : formatSpeedValue(speed, unitSystem)}
                      </td>
                      <td className="is-numeric">
                        {lap.elevationGain === undefined
                          ? "—"
                          : formatElevationMeters(lap.elevationGain, unitSystem)}
                      </td>
                      <td className="is-numeric">{lap.avgHr ?? "—"}</td>
                      <td className="is-numeric">
                        {lap.avgCadence === undefined ? "—" : Math.round(lap.avgCadence)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="run-block-note">
            {t("hike.detail.splitNote")}
          </p>
        </section>
      ) : null}
    </section>
  );
}

/** Where the day stopped: the camp, the view, the top. */
function HikeRestsPanel({
  rests,
  stoppedSeconds,
  startTime
}: {
  rests: readonly HikeStop[];
  stoppedSeconds: number;
  startTime: number | undefined;
}) {
  const { unitSystem } = useUnitSystem();

  return (
    <section className="panel run-detail-panel">
      <header className="run-block-head">
        <div>
          <p className="running-eyebrow">{t("hike.rests.title")}</p>
          <h3>
            {renderRich(t("hike.rests.total", { time: formatDurationSeconds(stoppedSeconds) }), {
              s: (chunk) => <span className="run-block-sub"> {chunk}</span>
            })}
          </h3>
        </div>
      </header>
      {rests.length > 0 ? (
        <div className="run-table-scroll">
          <table className="run-list run-surface-table">
            <thead>
              <tr>
                <th scope="col">{t("hike.rests.at")}</th>
                <th scope="col" className="is-numeric">{t("hike.rests.where")}</th>
                <th scope="col" className="is-numeric">{t("hike.legs.altitude")}</th>
                <th scope="col" className="is-numeric">{t("hike.rests.stopped")}</th>
              </tr>
            </thead>
            <tbody>
              {rests.map((rest) => (
                <tr key={`${rest.startElapsed}-${rest.paused ? "p" : "s"}`}>
                  <td>
                    {clockAt(startTime, rest.startElapsed) ?? formatDurationSeconds(rest.startElapsed)}
                    {rest.paused ? <span className="hike-rest-paused">{t("hike.rests.paused")}</span> : null}
                  </td>
                  <td className="is-numeric">{formatDistanceMeters(rest.distance, unitSystem)}</td>
                  <td className="is-numeric">
                    {rest.altitude === undefined ? "—" : formatElevationMeters(rest.altitude, unitSystem)}
                  </td>
                  <td className="is-numeric">{formatDurationSeconds(rest.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="run-block-empty">{t("hike.rests.none")}</p>
      )}
      <p className="run-block-note">
        {renderRich(t("hike.rests.note"), { em: (chunk) => <em>{chunk}</em> })}
      </p>
    </section>
  );
}
