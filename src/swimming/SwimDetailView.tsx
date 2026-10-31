import { useMemo } from "react";
import { ArrowLeft, CloudOff, MessageCircle, RefreshCw } from "lucide-react";
import type {
  CoachOpenRequest,
  CorosProfileZoneFamily,
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import {
  bestSwimEfforts,
  secondsPer100m,
  styleDistancePerStroke,
  swimStyleTotals
} from "../../electron/swimDetail";
import { withPausesRemoved } from "../../electron/activityMetrics";
import type { TrainingHubLoadStatus } from "../training/types";
import { activityCoachRequest } from "../training/askCoachAbout";
import { ActivityRouteCover, hasActivityRoute } from "../training/components/ActivityRouteMap";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatOptionalNumber,
  formatTrainingTimestamp
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatTemperatureValue } from "../units/units";
import { ActivitySeriesChart } from "../training/components/ActivitySeriesChart";
import { ActivityZoneTimePanel } from "../training/components/ActivityZoneTimePanel";
import { RunDetailSkeleton } from "../running/RunningSkeleton";
import { useBackGesture } from "../running/sportPage";
import { SwimLengthsChart } from "./SwimLengthsChart";
import { SwimSetsPanel } from "./SwimSetsPanel";
import { SwimStrokeTable } from "./SwimStrokePanel";
import { formatClock } from "./SwimmingHero";
import { formatDistancePerStroke, formatPer100, formatPoolLength, swimSeconds } from "./swimMetrics";
import { SWIM_TYPE_LABELS, classifySwimType } from "./swimType";
import { formatDecimal, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";

interface SwimDetailViewProps {
  activity: TrainingHubActivity;
  /** Null until the fetch for *this* swim lands. */
  detail: TrainingHubActivityDetail | null;
  /** This swim's own detail request — never inferred from the app's `busy`. */
  detailStatus: TrainingHubLoadStatus;
  onBack: () => void;
  /** Where Back goes, as its button reads: the list, or the screen the swim came from. */
  backLabel?: string;
  onRetry: () => void;
  onAskCoach?: (request: CoachOpenRequest) => void;
  /** The account's heart-rate model, naming the zones of an activity COROS left unlabelled. */
  zoneFamily?: CorosProfileZoneFamily;
}

/** Rest worth a figure of its own; under it the swim barely stopped. */
const MIN_REST_SHOWN_SECONDS = 30;

/** The band at the top of the route cover the heading leaves clear; see running.css. */
const COVER_VISIBLE_BAND = 0.15;

interface Stat {
  label: string;
  value: string;
  title?: string;
}

/** No lap table focuses the chart here: the intervals are read beside it, not through it. */
function ignoreFocusLap(): void {}

/**
 * One swim, on the whole page — Running's detail page with a swimmer's figures.
 *
 * In the pool the watch counts every length, so the page is read from them:
 * the time swimming apart from the rests at the wall, the pace per 100 over
 * the swimming alone, SWOLF, strokes a length, the stroke rate and the
 * distance each stroke carries; a bar for every length in its stroke's colour,
 * with the rests as gaps; the intervals under the sets they make — `8 × 100 m`
 * — and the strokes the swim was made of. Open water has no lengths: its page
 * is the route, the pace and heart rate over time, and the watch's distance
 * laps. The running-form panel, decoupling and the elevation are gone; none of
 * them is recorded in the water.
 */
export function SwimDetailView({
  activity,
  detail,
  detailStatus,
  onBack,
  backLabel = t("nav.swimming"),
  onRetry,
  onAskCoach,
  zoneFamily
}: SwimDetailViewProps) {
  const { unitSystem, temperatureUnit } = useUnitSystem();
  const { locale } = useI18n();
  const type = classifySwimType(activity.sportType) ?? "pool";
  const kindLabel = SWIM_TYPE_LABELS[type];
  const swim = detail?.swim;
  const openWater = type === "open";

  const series = useMemo(
    () => withPausesRemoved(detail?.series ?? [], detail?.pauses),
    [detail]
  );
  const styleTotals = useMemo(() => (swim ? swimStyleTotals(swim.lengths) : []), [swim]);
  const best = useMemo(() => (swim ? bestSwimEfforts(swim.lengths) : []), [swim]);

  const hasRoute = useMemo(() => hasActivityRoute(detail?.track), [detail]);
  const loading = detailStatus === "pending" && detail === null;
  const failed = detailStatus === "failed" && detail === null;

  useBackGesture(onBack);

  const headline = useMemo<Stat[]>(() => {
    const distance = detail?.distance ?? activity.distance;
    const listed = swimSeconds({ duration: detail?.duration ?? activity.duration });
    const swimming = swim?.swimSeconds ?? listed;
    const rest = swim?.restSeconds;
    const stats: Stat[] = [
      {
        label: t("activity.m.distance"),
        value: distance !== undefined && distance > 0 ? formatDistanceMeters(distance, unitSystem, true) : "—"
      },
      {
        label: t("swim.detail.swimTime"),
        value: formatDurationSeconds(swimming),
        title: swim?.swimSeconds !== undefined ? t("swim.detail.swimTimeTitle") : t("swim.timeTitle")
      }
    ];
    if (rest !== undefined && rest >= MIN_REST_SHOWN_SECONDS) {
      stats.push({
        label: t("swim.sets.rest"),
        value: formatDurationSeconds(Math.round(rest)),
        title: t("swim.detail.restTitle")
      });
    }
    const pace = distance !== undefined && swimming !== undefined ? secondsPer100m(swimming, distance) : undefined;
    stats.push({
      label: t("activity.m.avgPace"),
      value: formatPer100(pace, unitSystem),
      title: swim?.swimSeconds !== undefined ? t("swim.detail.paceTitle") : t("swim.avgPaceTitle")
    });
    if (swim?.poolLength !== undefined) {
      stats.push({
        label: t("swim.detail.pool"),
        value: formatPoolLength(swim.poolLength, swim.poolUnit),
        title: t("swim.detail.poolTitle", { lengths: swim.lengths.length })
      });
    }
    const best100 = best.find((effort) => effort.distance === 100);
    if (best100) {
      stats.push({
        label: t("swim.hero.best100"),
        value: formatClock(best100.seconds),
        title: t("swim.detail.bestTitle")
      });
    }
    if (swim?.avgSwolf !== undefined) {
      stats.push({ label: t("swim.m.swolf"), value: String(swim.avgSwolf), title: t("swim.m.swolfTitle") });
    }
    const counted = swim?.lengths.filter((length) => length.strokes !== undefined) ?? [];
    if (counted.length > 0) {
      const strokes = counted.reduce((sum, length) => sum + length.strokes!, 0);
      stats.push({
        label: t("swim.m.strokesPerLength"),
        value: formatDecimal(strokes / counted.length, 1),
        title: t("swim.m.strokesTitle")
      });
    }
    const rate = swim?.avgStrokeRate ?? detail?.dynamics?.avgCadence;
    if (rate !== undefined && rate > 0) {
      stats.push({
        label: t("swim.m.strokeRate"),
        value: t("swim.rateValue", { value: Math.round(rate) }),
        title: t("swim.m.strokeRateTitle")
      });
    }
    const free = styleTotals.find((entry) => entry.style === "free");
    const dps = free ? styleDistancePerStroke(free) : undefined;
    if (dps !== undefined) {
      stats.push({
        label: t("swim.m.dps"),
        value: formatDistancePerStroke(dps, unitSystem),
        title: t("swim.detail.dpsTitle")
      });
    }
    const avgHr = detail?.avgHr ?? activity.avgHr;
    if (avgHr !== undefined) {
      stats.push({ label: t("activity.m.avgHr"), value: `${avgHr} bpm`, title: t("swim.detail.hrTitle") });
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
    if (swim?.waterTemperatureC !== undefined) {
      stats.push({
        label: t("swim.detail.water"),
        value: formatTemperatureValue(swim.waterTemperatureC, temperatureUnit)
      });
    }
    return stats;
  }, [activity, best, detail, styleTotals, swim, temperatureUnit, unitSystem, locale]);

  const effect = useMemo<Stat[]>(() => {
    const stats: Stat[] = [];
    if (detail?.effect?.aerobic !== undefined) {
      stats.push({ label: t("run.detail.aerobic"), value: formatDecimal(detail.effect.aerobic, 1) });
    }
    if (detail?.effect?.anaerobic !== undefined) {
      stats.push({ label: t("run.detail.anaerobic"), value: formatDecimal(detail.effect.anaerobic, 1) });
    }
    for (const effort of best) {
      stats.push({
        label: t("swim.detail.bestOver", { distance: formatDistanceMeters(effort.distance, unitSystem, true) }),
        value: formatClock(effort.seconds),
        title: t("swim.detail.bestTitle")
      });
    }
    return stats;
  }, [best, detail, unitSystem, locale]);

  const hasLengths = (swim?.lengths.length ?? 0) > 1;
  const intervals = swim?.intervals ?? [];

  return (
    <section className="running-view swimming-view run-detail">
      <div className={`run-detail-hero${hasRoute || (loading && openWater) ? " has-cover" : ""}`}>
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
                      activityCoachRequest({ ...activity, sportName: activity.sportName ?? kindLabel }, unitSystem)
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
        ) : loading && openWater ? (
          <div className="run-detail-cover run-skeleton" aria-hidden="true" />
        ) : null}
      </div>

      {loading ? <RunDetailSkeleton label={t("swim.loadingOne")} /> : null}

      {failed ? (
        <section className="panel running-empty running-state-panel">
          <CloudOff size={22} aria-hidden="true" />
          <div>
            <h3>{t("swim.detail.failed")}</h3>
            <p>{t("swim.detail.failedBody")}</p>
          </div>
          <button type="button" className="primary-button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            {t("common.tryAgain")}
          </button>
        </section>
      ) : null}

      {swim && hasLengths ? <SwimLengthsChart swim={swim} /> : null}

      {intervals.length > 1 ? <SwimSetsPanel intervals={intervals} openWater={openWater} /> : null}

      {styleTotals.length > 0 ? (
        <section className="panel run-detail-panel run-block">
          <p className="running-eyebrow">{t("swim.strokes.sessionTitle")}</p>
          <SwimStrokeTable totals={styleTotals} onePool />
        </section>
      ) : null}

      {series.length > 0 ? (
        <ActivitySeriesChart
          series={series}
          laps={detail?.laps ?? []}
          hrZones={detail?.hrZones ?? []}
          focusLapIndex={null}
          onFocusLapHandled={ignoreFocusLap}
          activityTime={detail?.duration ?? activity.duration}
          sportType={activity.sportType}
          motion="swim"
        />
      ) : null}

      {detail ? (
        <ActivityZoneTimePanel
          hrZones={detail.hrZones}
          hrZoneType={detail.hrZoneType}
          accountFamily={zoneFamily}
        />
      ) : null}

      {effect.length > 0 ? (
        <section className="panel run-detail-panel">
          <p className="running-eyebrow">{t("run.detail.effect")}</p>
          <div className="run-detail-stats">
            {effect.map((stat) => (
              <div className="running-stat" key={stat.label} title={stat.title}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
          <p className="run-block-note">{t("swim.detail.hrNote")}</p>
        </section>
      ) : null}
    </section>
  );
}
