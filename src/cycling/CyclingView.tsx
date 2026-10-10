import { useEffect, useMemo, useState } from "react";
import { Bike, CloudOff, LockKeyhole, RefreshCw } from "lucide-react";
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
import { CyclingHero } from "./CyclingHero";
import { RideDetailView } from "./RideDetailView";
import { DEFAULT_RIDE_SORT, RideList, type RideSort } from "./RideList";
import { RideTypePanel } from "./RideTypePanel";
import { RideVolumeChart } from "./RideVolumeChart";
import { rideTypesPresent, summariseRides, totalsSpeedKmh } from "./rideMetrics";
import { RIDE_TYPE_LABELS, ridesOfType, type RideType } from "./rideType";
import "../running/running.css";
import "./cycling.css";
import { t } from "../i18n/core";

export interface CyclingViewProps {
  api: HeraclesRecordsApi | null;
  activities: TrainingHubActivity[];
  connected: boolean;
  /** A start-up re-login in flight: signed out now, probably not in a moment. */
  restoring?: boolean;
  /** Whether `activities` has arrived — an empty list alone cannot say. */
  activitiesStatus: TrainingHubLoadStatus;
  detail: TrainingHubActivityDetail | null;
  /** Where the latest detail request stands, and which ride it was for. */
  detailRequest: TrainingHubDetailRequest | null;
  /** Account-level figures: the dashboard's LTHR zones, as a fallback. */
  snapshot: TrainingHubSnapshot | null;
  busy: string | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  /** Reloads the COROS data after the activity list failed to arrive. */
  onRetryActivities: () => void;
  onOpenOverview: () => void;
  /** A ride another screen handed over, to be opened rather than merely listed. */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same ride is not re-opened when the athlete closes it. */
  onOpenRequestHandled?: () => void;
  /** Back on a ride handed over from another screen: that screen, again. */
  onReturn?: (view: PrimaryView) => void;
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/** The scale's windows, as Running offers them — see periodScale.ts. */
const PERIOD_OPTIONS = periodGroupOptions([28, 90, 365, null]);

const DEFAULT_PERIOD_DAYS = 90;

/**
 * Cycling on a screen of its own.
 *
 * The Running screen, built again for a bike. What carries over is the shape:
 * one sport read down the time axis — "how is the block going", where
 * Activities answers "how was yesterday" — a list that keeps its scroll, sort
 * and filters while a ride is open on the whole page, and the same stylesheet,
 * so the two screens cannot drift apart in how they look.
 *
 * What changes is what a rider reads. Rides split by bike rather than surface;
 * speed stands where pace does; a week is measured in distance, hours or metres
 * climbed rather than kilometres alone; and the hero trades the running VO₂max
 * and threshold pace for FTP and the week's climb, with COROS's cycling VO₂max
 * beside them once COROS has one.
 * The aerobic-efficiency chart is not carried over: metres per heartbeat on a
 * bike is a reading of the road and the wind as much as of the rider.
 */
export function CyclingView({
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
}: CyclingViewProps) {
  const { unitSystem } = useUnitSystem();
  const [rideType, setRideType] = useState<RideType | null>(null);
  const [periodDays, setPeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);
  const [sort, setSort] = useState<RideSort>(DEFAULT_RIDE_SORT);
  const {
    pageRef,
    selected: selectedRide,
    selectedId: selectedRideId,
    backLabel,
    open: openRide,
    close: closeRide
  } = useSessionPage({
    activities,
    onSelectActivity,
    openRequest,
    onOpenRequestHandled,
    onReturn,
    listLabel: t("nav.cycling")
  });

  // Pinned to the list rather than read per render, so "the last 90 days"
  // does not move under the filter while nobody is touching it.
  const nowMs = useMemo(() => Date.now(), [activities]);

  // The load ratio is about the whole rider, so it is the one figure the kind
  // filter does not narrow.
  const allRides = useMemo(() => ridesOfType(activities, null), [activities]);

  const ridesInPeriod = useMemo(
    () => withinPeriod(allRides, periodDays, nowMs),
    [allRides, nowMs, periodDays]
  );

  const availableTypes = useMemo(
    () => rideTypesPresent(ridesInPeriod),
    [ridesInPeriod]
  );

  const rides = useMemo(
    () => ridesOfType(ridesInPeriod, rideType),
    [ridesInPeriod, rideType]
  );

  const totals = useMemo(() => summariseRides(rides), [rides]);

  // "Nothing in the last four weeks" and "never ridden at all" are different
  // screens, so this is asked of the whole history.
  const hasAnyRide = allRides.length > 0;

  // Every ride of the chosen kind, whatever the period — the hero's week and
  // the chart's year-ago figure look back a span the period must not cut.
  const ridesAllTime = useMemo(
    () => (rideType === null ? allRides : ridesOfType(allRides, rideType)),
    [allRides, rideType]
  );

  const chartWeeks = useMemo(() => weeksForPeriod(periodDays), [periodDays]);

  // The account's own zone model, and the profile it came from for FTP. A ride
  // is scored against the same heart-rate zones as a run, so the intensity
  // panel waits on them for the same reason Running's does.
  const {
    model: zoneModel,
    settled: zonesSettled,
    profile
  } = useHeartRateZoneModel({ api, corosConnected: connected });
  const zoneScale = useMemo<RunZoneScale>(
    () => zoneModel ?? { family: "lthr", zones: runningThresholdZones(snapshot) },
    [snapshot, zoneModel]
  );
  const stackedTypes = useMemo(
    () => (rideType === null ? availableTypes : [rideType]),
    [availableTypes, rideType]
  );

  // A kind with no rides in the newly chosen period would leave the screen
  // filtered to nothing with no chip left to un-press.
  useEffect(() => {
    if (rideType !== null && !availableTypes.includes(rideType)) {
      setRideType(null);
    }
  }, [availableTypes, rideType]);

  // Time in zone, out of the detail payload and kept as a row per ride, so the
  // intensity panel can split an interval session across its bands.
  const summaries = useActivityDetailSummaries({
    api,
    activities: rides,
    enabled: connected && selectedRideId === null
  });

  if (!connected) {
    return (
      <section className="running-view cycling-view running-view-disconnected">
        <CyclingPageHeader />

        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{restoring ? t("run.reconnecting") : t("common.connectFirst.title")}</h3>
            <p>{restoring ? t("ride.reconnectingBody") : t("run.connectBody")}</p>
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

  if (selectedRide) {
    const ownDetail = detail?.activityId === selectedRide.activityId ? detail : null;
    const detailStatus =
      detailRequest?.activityId === selectedRide.activityId
        ? detailRequest.status
        : "pending";
    return (
      <RideDetailView
        activity={selectedRide}
        detail={ownDetail}
        detailStatus={detailStatus}
        onBack={closeRide}
        backLabel={backLabel}
        onRetry={() => onSelectActivity(selectedRide)}
        onAskCoach={onAskCoach}
        ftp={profile?.thresholds.ftp}
        powerZones={profile?.thresholds.zones.cyclePower}
      />
    );
  }

  // Signed in, but the list has not arrived: every figure would be a zero, and
  // a zero reads as a fact.
  if (!hasAnyRide && activitiesStatus === "pending") {
    return (
      <section className="running-view cycling-view" ref={pageRef}>
        <CyclingPageHeader />
        <RunningPageSkeleton label={t("ride.loading")} />
      </section>
    );
  }

  if (!hasAnyRide && activitiesStatus === "failed") {
    const retrying = busy === "training-refresh";
    return (
      <section className="running-view cycling-view" ref={pageRef}>
        <CyclingPageHeader />
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

  if (!hasAnyRide) {
    return (
      <section className="running-view cycling-view" ref={pageRef}>
        <CyclingPageHeader />
        <section className="panel running-empty running-state-panel">
          <Bike size={22} aria-hidden="true" />
          <div>
            <h3>{t("ride.none")}</h3>
            <p>{t("ride.noneBody")}</p>
          </div>
        </section>
      </section>
    );
  }

  const averageSpeed = totalsSpeedKmh(totals);

  return (
    <section className="running-view cycling-view" ref={pageRef}>
      <CyclingPageHeader />

      <div className="running-controls">
        <OptionGroup
          label={t("ride.bike")}
          value={rideType ?? "all"}
          options={[
            { value: "all", label: t("common.all") },
            ...availableTypes.map((option) => ({
              value: option,
              label: RIDE_TYPE_LABELS[option]
            }))
          ]}
          onChange={(next) =>
            setRideType(next === "all" ? null : (next as RideType))
          }
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
        <CyclingHero
          rides={ridesAllTime}
          allRides={allRides}
          ftp={profile?.thresholds.ftp}
          weightKg={profile?.weightKg}
          profileSettled={zonesSettled}
          snapshot={snapshot}
          filtered={rideType !== null}
          nowMs={nowMs}
        />

        <div className="running-totals">
          <div className="running-stat">
            <span>{t("ride.rides")}</span>
            <strong>{totals.count}</strong>
          </div>
          <div className="running-stat">
            <span>{t("activity.m.distance")}</span>
            <strong>{formatDistanceMeters(totals.distance, unitSystem)}</strong>
          </div>
          <div className="running-stat">
            <span>{t("activity.m.time")}</span>
            <strong>{formatDurationSpan(totals.duration)}</strong>
          </div>
          <div className="running-stat" title={t("ride.avgSpeedTitle")}>
            <span>{t("activity.m.avgSpeed")}</span>
            <strong>
              {averageSpeed === undefined ? "—" : formatSpeedValue(averageSpeed, unitSystem)}
            </strong>
          </div>
          <div className="running-stat">
            <span>{t("activity.m.climb")}</span>
            <strong>{formatElevationMeters(totals.elevationGain, unitSystem)}</strong>
          </div>
        </div>

        {rides.length > 0 ? (
          <>
            <RideVolumeChart
              rides={rides}
              ridesAllTime={ridesAllTime}
              weeks={chartWeeks}
              types={stackedTypes}
              nowMs={nowMs}
            />
            <div className="running-columns">
              {zonesSettled ? (
                <RunIntensityPanel
                  sessions={rides}
                  sport="ride"
                  zoneScale={zoneScale}
                  zoneModelLabel={zoneModel?.title}
                  summaries={summaries}
                />
              ) : (
                <RunBlockSkeleton label={t("run.loadingZones")} />
              )}
              <RideTypePanel rides={ridesInPeriod} />
            </div>
          </>
        ) : null}

        {rides.length === 0 ? (
          <section className="panel running-empty">
            <Bike size={22} aria-hidden="true" />
            <div>
              <h3>{t("ride.noneInWindow")}</h3>
              <p>
                {rideType === null
                  ? t("ride.widen")
                  : t(`ride.noneOfType.${rideType}` as const)}
              </p>
            </div>
          </section>
        ) : (
          <div className="running-list-panel">
            <RideList
              rides={rides}
              sort={sort}
              onSortChange={setSort}
              onOpenRide={openRide}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function CyclingPageHeader() {
  return (
    <header className="running-page-header">
      <p className="running-eyebrow">{t("run.eyebrow")}</p>
      <h1>{t("nav.cycling")}</h1>
      <p>{t("ride.lead")}</p>
    </header>
  );
}
