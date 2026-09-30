import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import type { CorosLinkApi } from "../coroslink-api";
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
import { PRIMARY_NAV_ITEMS, type PrimaryView } from "../navigation/primaryNav";
import { runningThresholdZones } from "../running/RunningHero";
import { RunIntensityPanel } from "../running/RunIntensityPanel";
import { RunBlockSkeleton, RunningPageSkeleton } from "../running/RunningSkeleton";
import type { RunZoneScale } from "../running/runMetrics";
import { HikeDetailView } from "./HikeDetailView";
import { DEFAULT_HIKE_SORT, HikeList, type HikeSort } from "./HikeList";
import { HikeTypePanel } from "./HikeTypePanel";
import { HikeVolumeChart } from "./HikeVolumeChart";
import { HikingHero } from "./HikingHero";
import {
  hikeTypesPresent,
  hikeWindowStartMs,
  summariseHikes,
  totalsSpeedKmh
} from "./hikeMetrics";
import { HIKE_TYPE_LABELS, hikesOfType, type HikeType } from "./hikeType";
import "../running/running.css";
import "./hiking.css";

export interface HikingViewProps {
  api: CorosLinkApi | null;
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

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

const MAX_ALL_TIME_WEEKS = 104;

function weeksForPeriod(days: number | null): number {
  return days === null ? MAX_ALL_TIME_WEEKS : Math.max(1, Math.ceil(days / 7));
}

/** The hikes a period covers, cut at the Monday the charts start on. */
function withinPeriod(
  activities: readonly TrainingHubActivity[],
  days: number | null,
  nowMs: number
): TrainingHubActivity[] {
  if (days === null) {
    return [...activities];
  }
  const cutoff = hikeWindowStartMs(weeksForPeriod(days), nowMs) / 1000;
  return activities.filter(
    (activity) => activity.startTime !== undefined && activity.startTime >= cutoff
  );
}

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
  const [selectedHikeId, setSelectedHikeId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<PrimaryView | null>(null);
  const [sort, setSort] = useState<HikeSort>(DEFAULT_HIKE_SORT);
  const pageRef = useRef<HTMLElement>(null);
  const pageScrollTop = useRef(0);

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

  const selectedHike = useMemo(
    () =>
      selectedHikeId === null
        ? null
        : (activities.find((a) => a.activityId === selectedHikeId) ?? null),
    [activities, selectedHikeId]
  );

  const summaries = useActivityDetailSummaries({
    api,
    activities: hikes,
    enabled: connected && selectedHikeId === null
  });

  const openHike = useCallback(
    (activity: TrainingHubActivity) => {
      pageScrollTop.current = pageRef.current?.scrollTop ?? 0;
      setSelectedHikeId(activity.activityId);
      setReturnTo(null);
      onSelectActivity(activity);
    },
    [onSelectActivity]
  );

  const closeHike = useCallback(() => {
    setSelectedHikeId(null);
    setReturnTo(null);
    if (returnTo && onReturn) {
      onReturn(returnTo);
    }
  }, [onReturn, returnTo]);

  // A hike handed over from Activities or the Library: taken straight by id and
  // cleared at once, as Running takes a run.
  useEffect(() => {
    if (!openRequest) {
      return;
    }
    const activity = activities.find((row) => row.activityId === openRequest.activityId);
    setSelectedHikeId(openRequest.activityId);
    setReturnTo(openRequest.from ?? null);
    if (activity) {
      onSelectActivity(activity);
    }
    onOpenRequestHandled?.();
  }, [activities, onOpenRequestHandled, onSelectActivity, openRequest]);

  // Back from a hike lands where the list was left — re-applied on a timer
  // until it takes, for the reasons written out in RunningView.
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (selectedHike !== null || !page) {
      return;
    }
    const target = pageScrollTop.current;
    page.scrollTop = target;
    if (page.scrollTop >= target - 1) {
      return;
    }
    const pageEvents = ["wheel", "touchstart", "pointerdown"] as const;
    let finished = false;
    const interval = window.setInterval(() => {
      page.scrollTop = target;
      if (page.scrollTop >= target - 1) {
        finish();
      }
    }, 50);
    const deadline = window.setTimeout(finish, 1000);
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) {
        finish();
      }
    };
    function finish() {
      if (finished) {
        return;
      }
      finished = true;
      window.clearInterval(interval);
      window.clearTimeout(deadline);
      for (const type of pageEvents) {
        page?.removeEventListener(type, finish);
      }
      window.removeEventListener("keydown", onKeyDown);
    }
    for (const type of pageEvents) {
      page.addEventListener(type, finish, { passive: true });
    }
    window.addEventListener("keydown", onKeyDown);
    return finish;
  }, [selectedHike]);

  if (!connected) {
    return (
      <section className="running-view hiking-view running-view-disconnected">
        <HikingPageHeader />
        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{restoring ? "Reconnecting to COROS" : "Connect COROS first"}</h3>
            <p>
              {restoring
                ? "Signing back in with your saved credentials. Your hikes load as soon as that finishes."
                : "This screen is drawn from your COROS activity history. Signing in lives on Overview."}
            </p>
          </div>
          {restoring ? null : (
            <button type="button" className="primary-button" onClick={onOpenOverview}>
              Open Overview
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
        backLabel={
          (returnTo && onReturn && PRIMARY_NAV_ITEMS.find((item) => item.id === returnTo)?.label) ||
          "Hiking"
        }
        onRetry={() => onSelectActivity(selectedHike)}
        onAskCoach={onAskCoach}
      />
    );
  }

  if (!hasAnyHike && activitiesStatus === "pending") {
    return (
      <section className="running-view hiking-view" ref={pageRef}>
        <HikingPageHeader />
        <RunningPageSkeleton label="Loading your hikes" />
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
            <h3>Your activities did not load</h3>
            <p>
              COROS did not return the activity list. This is usually the
              connection; nothing on this machine was lost.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={retrying}
            onClick={onRetryActivities}
          >
            <RefreshCw size={14} aria-hidden="true" className={retrying ? "spin" : undefined} />
            {retrying ? "Loading" : "Try again"}
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
            <h3>No hikes yet</h3>
            <p>
              Hikes and mountain climbs from your COROS watch land here once
              they sync. A trail run is a run, and stays on Running.
            </p>
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
          label="Kind"
          value={hikeType ?? "all"}
          options={[
            { value: "all", label: "All" },
            ...availableTypes.map((option) => ({ value: option, label: HIKE_TYPE_LABELS[option] }))
          ]}
          onChange={(next) => setHikeType(next === "all" ? null : (next as HikeType))}
        />
        <OptionGroup
          label="Period"
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
            <span>Hikes</span>
            <strong>{totals.count}</strong>
          </div>
          <div className="running-stat">
            <span>Distance</span>
            <strong>{formatDistanceMeters(totals.distance, unitSystem)}</strong>
          </div>
          <div className="running-stat" title="Recorded time, stops included where the watch kept recording">
            <span>Time</span>
            <strong>{formatDurationSpan(totals.duration)}</strong>
          </div>
          <div className="running-stat">
            <span>Ascent</span>
            <strong>{formatElevationMeters(totals.elevationGain, unitSystem)}</strong>
          </div>
          <div className="running-stat" title="Total distance over the recorded time">
            <span>Avg speed</span>
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
                <RunBlockSkeleton label="Loading your heart-rate zones" />
              )}
              <HikeTypePanel hikes={hikesInPeriod} />
            </div>
          </>
        ) : null}

        {hikes.length === 0 ? (
          <section className="panel running-empty">
            <Mountain size={22} aria-hidden="true" />
            <div>
              <h3>No hikes in this window</h3>
              <p>
                {hikeType === null
                  ? "Widen the period, or record a hike and sync your watch."
                  : `No ${HIKE_TYPE_LABELS[hikeType].toLowerCase()}s here. Try the other kind or a wider period.`}
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
      <p className="running-eyebrow">Your training</p>
      <h1>Hiking</h1>
      <p>Every hike and mountain climb you have logged, read down the time axis.</p>
    </header>
  );
}
