import { useEffect, useMemo, useState } from "react";
import { CloudOff, LockKeyhole, Mountain, RefreshCw } from "lucide-react";
import type {
  CoachOpenRequest,
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import type {
  SportScreenRequest,
  TrainingHubDetailRequest,
  TrainingHubLoadStatus,
  TrainingHubSnapshot
} from "../training/types";
import {
  formatDistanceMeters,
  formatDurationSpan,
  formatElevationMeters
} from "../training/formatters";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { OptionGroup } from "../components/OptionGroup";
import {
  periodDaysFromValue,
  periodGroupOptions,
  periodValue,
  type PeriodDays
} from "../preferences/periodScale";
import { useHeartRateZoneModel } from "../training/useHeartRateZoneModel";
import { useActivityDetailSummaries } from "../training/useActivityDetailSummaries";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatSpeedValue } from "../units/units";
import type { PrimaryView } from "../navigation/primaryNav";
import { runningThresholdZones } from "../running/RunningHero";
import { RunIntensityPanel } from "../running/RunIntensityPanel";
import { RunBlockSkeleton, RunningPageSkeleton } from "../running/RunningSkeleton";
import type { RunZoneScale } from "../running/runMetrics";
import { useSessionPage, weeksForPeriod, withinPeriod } from "../running/sportPage";
import { HikeDetailView } from "./HikeDetailView";
import { DEFAULT_HIKE_SORT, HikeList, type HikeSort } from "./HikeList";
import { HikeTypePanel } from "./HikeTypePanel";
import { HikeVolumeChart } from "./HikeVolumeChart";
import { HikingHero } from "./HikingHero";
import {
  hikeTypesPresent,
  summariseHikes,
  totalsSpeedKmh
} from "./hikeMetrics";
import { HIKE_TYPE_LABELS, hikesOfType, type HikeType } from "./hikeType";
import "../running/running.css";
import "./hiking.css";

import { t } from "../i18n/core";
export interface HikingViewProps {
  api: HeraclesRecordsApi | null;
  activities: TrainingHubActivity[];
  connected: boolean;
  /** A start-up re-login in flight: signed out now, probably not in a moment. */
  restoring?: boolean;
  /** Whether `activities` has arrived — an empty list alone cannot say. */
  activitiesStatus: TrainingHubLoadStatus;
  detail: TrainingHubActivityDetail | null;
  /** Where the latest detail request stands, and which hike it was for. */
  detailRequest: TrainingHubDetailRequest | null;
  /** Account-level figures: the dashboard's LTHR zones, as a fallback. */
  snapshot: TrainingHubSnapshot | null;
  busy: string | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  /** Reloads the COROS data after the activity list failed to arrive. */
  onRetryActivities: () => void;
  onOpenOverview: () => void;
  /** A hike another screen handed over, to be opened rather than merely listed. */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same hike is not re-opened when the athlete closes it. */
  onOpenRequestHandled?: () => void;
  /** Back on a hike handed over from another screen: that screen, again. */
  onReturn?: (view: PrimaryView) => void;
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/** The scale's windows, as Running and Cycling offer them — see periodScale.ts. */
const PERIOD_OPTIONS = periodGroupOptions([28, 90, 365, null]);

const DEFAULT_PERIOD_DAYS = 90;

/**
 * Hikes and mountain climbs on a screen of their own.
 *
 * Running's page built again for a trail, on the same stylesheet, the way
 * Cycling was. Running leaves hikes out on purpose — a walking pace in a
 * running pace distribution is noise — so until now they had no home but
 * Activities, which cannot read them down the time axis.
 *
 * What a walker reads is not what a runner does. A hike is measured in height
 * and hours before distance, so the week is read in metres climbed and time on
 * the trail, and the climbing rate stands where pace does. Speed is km/h,
 * never a pace. The efficiency chart and the load ratio are not carried over:
 * metres per heartbeat on a trail measures the gradient, and a weekend in the
 * mountains after three at home is the trip, not a ramp to warn about. The 80/20
 * mark is not held up against the intensity split — the climb decides it.
 */
export function HikingView({
  api,
  activities,
  connected,
  restoring = false,
  activitiesStatus,
  detail,
  detailRequest,
  snapshot,
  busy,
  onSelectActivity,
  onRetryActivities,
  onOpenOverview,
  openRequest = null,
  onOpenRequestHandled,
  onReturn,
  onAskCoach
}: HikingViewProps) {
  const { unitSystem } = useUnitSystem();
  const [hikeType, setHikeType] = useState<HikeType | null>(null);
  const [periodDays, setPeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);
  const [sort, setSort] = useState<HikeSort>(DEFAULT_HIKE_SORT);
  const {
    pageRef,
    selected: selectedHike,
    selectedId: selectedHikeId,
    backLabel,
    open: openHike,
    close: closeHike
  } = useSessionPage({
    activities,
    onSelectActivity,
    openRequest,
    onOpenRequestHandled,
    onReturn,
    listLabel: t("nav.hiking")
  });

  // Pinned to the list, so "the last year" does not move under the filter.
  const nowMs = useMemo(() => Date.now(), [activities]);

  const allHikes = useMemo(() => hikesOfType(activities, null), [activities]);
  const hikesInPeriod = useMemo(
    () => withinPeriod(allHikes, periodDays, nowMs),
    [allHikes, nowMs, periodDays]
  );
  const availableTypes = useMemo(() => hikeTypesPresent(hikesInPeriod), [hikesInPeriod]);
  const hikes = useMemo(() => hikesOfType(hikesInPeriod, hikeType), [hikesInPeriod, hikeType]);
  const totals = useMemo(() => summariseHikes(hikes), [hikes]);
  const hasAnyHike = allHikes.length > 0;

  // Every hike of the chosen kind, whatever the period — the hero and the
  // chart's year-ago figure look back spans the period must not cut.
  const hikesAllTime = useMemo(
    () => (hikeType === null ? allHikes : hikesOfType(allHikes, hikeType)),
    [allHikes, hikeType]
  );

  const chartWeeks = useMemo(() => weeksForPeriod(periodDays), [periodDays]);

  // Heart-rate zones belong to the athlete, so a hike is banded exactly as a
  // run is — and waits on the account's model for the same reason.
  const { model: zoneModel, settled: zonesSettled } = useHeartRateZoneModel({
    api,
    corosConnected: connected
  });
  const zoneScale = useMemo<RunZoneScale>(
    () => zoneModel ?? { family: "lthr", zones: runningThresholdZones(snapshot) },
    [snapshot, zoneModel]
  );
  const stackedTypes = useMemo(
    () => (hikeType === null ? availableTypes : [hikeType]),
    [availableTypes, hikeType]
  );

  useEffect(() => {
    if (hikeType !== null && !availableTypes.includes(hikeType)) {
      setHikeType(null);
    }
  }, [availableTypes, hikeType]);

  const summaries = useActivityDetailSummaries({
    api,
    activities: hikes,
    enabled: connected && selectedHikeId === null
  });

  if (!connected) {
    return (
      <section className="running-view hiking-view running-view-disconnected">
        <HikingPageHeader />
        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{restoring ? t("run.reconnecting") : t("common.connectFirst.title")}</h3>
            <p>{restoring ? t("hike.reconnectingBody") : t("run.connectBody")}</p>
          </div>
          {restoring ? null : (
            <button type="button" className="primary-button" onClick={onOpenOverview}>
              {t("common.openOverview")}
            </button>
          )}
        </section>
      </section>
    );
  }

  if (selectedHike) {
    const ownDetail = detail?.activityId === selectedHike.activityId ? detail : null;
    const detailStatus =
      detailRequest?.activityId === selectedHike.activityId ? detailRequest.status : "pending";
    return (
      <HikeDetailView
        activity={selectedHike}
        detail={ownDetail}
        detailStatus={detailStatus}
        onBack={closeHike}
        backLabel={backLabel}
        onRetry={() => onSelectActivity(selectedHike)}
        onAskCoach={onAskCoach}
      />
    );
  }

  if (!hasAnyHike && activitiesStatus === "pending") {
    return (
      <section className="running-view hiking-view" ref={pageRef}>
        <HikingPageHeader />
        <RunningPageSkeleton label={t("hike.loading")} />
      </section>
    );
  }

  if (!hasAnyHike && activitiesStatus === "failed") {
    const retrying = busy === "training-refresh";
    return (
      <section className="running-view hiking-view" ref={pageRef}>
        <HikingPageHeader />
        <section className="panel running-empty running-state-panel">
          <CloudOff size={22} aria-hidden="true" />
          <div>
            <h3>{t("run.listFailed")}</h3>
            <p>{t("run.listFailedBody")}</p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={retrying}
            onClick={onRetryActivities}
          >
            <RefreshCw size={14} aria-hidden="true" className={retrying ? "spin" : undefined} />
            {retrying ? t("common.loading") : t("common.tryAgain")}
          </button>
        </section>
      </section>
    );
  }

  if (!hasAnyHike) {
    return (
      <section className="running-view hiking-view" ref={pageRef}>
        <HikingPageHeader />
        <section className="panel running-empty running-state-panel">
          <Mountain size={22} aria-hidden="true" />
          <div>
            <h3>{t("hike.none")}</h3>
            <p>{t("hike.noneBody")}</p>
          </div>
        </section>
      </section>
    );
  }

  const averageSpeed = totalsSpeedKmh(totals);

  return (
    <section className="running-view hiking-view" ref={pageRef}>
      <HikingPageHeader />

      <div className="running-controls">
        <OptionGroup
          label={t("hike.kind")}
          value={hikeType ?? "all"}
          options={[
            { value: "all", label: t("common.all") },
            ...availableTypes.map((option) => ({ value: option, label: HIKE_TYPE_LABELS[option] }))
          ]}
          onChange={(next) => setHikeType(next === "all" ? null : (next as HikeType))}
        />
        <OptionGroup
          label={t("activity.filter.period")}
          mode="collapsible"
          className="running-period"
          value={periodValue(periodDays as PeriodDays)}
          options={PERIOD_OPTIONS}
          onChange={(next) => setPeriodDays(periodDaysFromValue(next))}
        />
      </div>

      <div className="running-body">
        <HikingHero hikes={hikesAllTime} nowMs={nowMs} />

        <div className="running-totals">
          <div className="running-stat">
            <span>{t("hike.hikes")}</span>
            <strong>{totals.count}</strong>
          </div>
          <div className="running-stat">
            <span>{t("activity.m.distance")}</span>
            <strong>{formatDistanceMeters(totals.distance, unitSystem)}</strong>
          </div>
          <div className="running-stat" title={t("hike.timeTitle")}>
            <span>{t("activity.m.time")}</span>
            <strong>{formatDurationSpan(totals.duration)}</strong>
          </div>
          <div className="running-stat">
            <span>{t("hike.ascent")}</span>
            <strong>{formatElevationMeters(totals.elevationGain, unitSystem)}</strong>
          </div>
          <div className="running-stat" title={t("hike.avgSpeedTitle")}>
            <span>{t("activity.m.avgSpeed")}</span>
            <strong>
              {averageSpeed === undefined ? "—" : formatSpeedValue(averageSpeed, unitSystem)}
            </strong>
          </div>
        </div>

        {hikes.length > 0 ? (
          <>
            <HikeVolumeChart
              hikes={hikes}
              hikesAllTime={hikesAllTime}
              weeks={chartWeeks}
              types={stackedTypes}
              nowMs={nowMs}
            />
            <div className="running-columns">
              {zonesSettled ? (
                <RunIntensityPanel
                  sessions={hikes}
                  sport="hike"
                  zoneScale={zoneScale}
                  zoneModelLabel={zoneModel?.title}
                  summaries={summaries}
                />
              ) : (
                <RunBlockSkeleton label={t("run.loadingZones")} />
              )}
              <HikeTypePanel hikes={hikesInPeriod} />
            </div>
          </>
        ) : null}

        {hikes.length === 0 ? (
          <section className="panel running-empty">
            <Mountain size={22} aria-hidden="true" />
            <div>
              <h3>{t("hike.noneInWindow")}</h3>
              <p>
                {hikeType === null
                  ? t("hike.widen")
                  : t(`hike.noneOfType.${hikeType}` as const)}
              </p>
            </div>
          </section>
        ) : (
          <div className="running-list-panel">
            <HikeList hikes={hikes} sort={sort} onSortChange={setSort} onOpenHike={openHike} />
          </div>
        )}
      </div>
    </section>
  );
}

function HikingPageHeader() {
  return (
    <header className="running-page-header">
      <p className="running-eyebrow">{t("run.eyebrow")}</p>
      <h1>{t("nav.hiking")}</h1>
      <p>{t("hike.lead")}</p>
    </header>
  );
}
