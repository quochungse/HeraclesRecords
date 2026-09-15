import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CloudOff, LockKeyhole, RefreshCw } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import type {
  TrainingHubDetailRequest,
  TrainingHubLoadStatus,
  TrainingHubSnapshot
} from "../training/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatPaceSecondsPerKm
} from "../training/formatters";
import type { CorosLinkApi } from "../coroslink-api";
import { useHeartRateZoneModel } from "../training/useHeartRateZoneModel";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { RunDetailView } from "./RunDetailView";
import { RunEfficiencyChart } from "./RunEfficiencyChart";
import { RunIntensityPanel } from "./RunIntensityPanel";
import { RunningHero, runningThresholdZones } from "./RunningHero";
import { RunSurfacePanel } from "./RunSurfacePanel";
import { RunBlockSkeleton, RunningPageSkeleton } from "./RunningSkeleton";
import { RunVolumeChart } from "./RunVolumeChart";
import { DEFAULT_RUN_SORT, RunList, type RunSort } from "./RunList";
import {
  runWindowStartMs,
  summariseRuns,
  surfacesPresent,
  type RunZoneScale
} from "./runMetrics";
import { useRunDetailSummaries } from "./useRunDetailSummaries";
import { RunnerIcon } from "./runnerIcon";
import {
  RUN_SURFACE_LABELS,
  runsOnSurface,
  type RunSurface
} from "./runSurface";
import "./running.css";

export interface RunningViewProps {
  api: CorosLinkApi | null;
  activities: TrainingHubActivity[];
  connected: boolean;
  /** A start-up re-login in flight: signed out now, probably not in a moment. */
  restoring?: boolean;
  /** Whether `activities` has arrived — an empty list alone cannot say. */
  activitiesStatus: TrainingHubLoadStatus;
  detail: TrainingHubActivityDetail | null;
  /** Where the latest detail request stands, and which run it was for. */
  detailRequest: TrainingHubDetailRequest | null;
  /** Account-level figures the blocks read: VO2max, thresholds, zones. */
  snapshot: TrainingHubSnapshot | null;
  busy: string | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  /** Reloads the COROS data after the activity list failed to arrive. */
  onRetryActivities: () => void;
  onOpenOverview: () => void;
}

interface PeriodOption {
  /** null means the whole history. */
  days: number | null;
  label: string;
}

/**
 * The whole history is a deliberate choice rather than the default: the
 * renderer holds every activity COROS has, and tallying years of them on every
 * filter change is work nobody asked for while looking at this month.
 */
const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { days: 28, label: "4 weeks" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
  { days: null, label: "All" }
];

const DEFAULT_PERIOD_DAYS = 90;

/** Keys that scroll a page — the ones that mean the athlete took over. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " "
]);

/**
 * Weeks the charts draw for a period.
 *
 * "All" is capped rather than unbounded: an athlete with six years of history
 * would get three hundred bars two pixels wide, which is a texture rather than
 * a chart, and the years before last are not what this screen is for.
 */
const MAX_ALL_TIME_WEEKS = 104;

function weeksForPeriod(days: number | null): number {
  return days === null
    ? MAX_ALL_TIME_WEEKS
    : Math.max(1, Math.ceil(days / 7));
}

/**
 * The runs a period covers, cut at the same Monday the charts start on — see
 * `runWindowStartMs`. "4 weeks" is four calendar weeks, this one included, for
 * the totals strip, the list and every chart alike.
 */
function withinPeriod(
  activities: readonly TrainingHubActivity[],
  days: number | null,
  nowMs: number
): TrainingHubActivity[] {
  if (days === null) {
    return [...activities];
  }

  const cutoff = runWindowStartMs(weeksForPeriod(days), nowMs) / 1000;
  return activities.filter(
    (activity) => activity.startTime !== undefined && activity.startTime >= cutoff
  );
}

/**
 * Running on a screen of its own.
 *
 * One sport read down the time axis, which is the thing Activities cannot do:
 * that screen answers "how was yesterday", this one answers "how is the block
 * going". The detail of a single run takes the whole page rather than a side
 * panel — a chart carrying eleven channels, a route and a lap table does not
 * fit beside a table — so the list keeps its scroll position and its filters
 * while a run is open, and hands them back on the way out.
 */
export function RunningView({
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
  onOpenOverview
}: RunningViewProps) {
  const { unitSystem } = useUnitSystem();
  const [surface, setSurface] = useState<RunSurface | null>(null);
  const [periodDays, setPeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [sort, setSort] = useState<RunSort>(DEFAULT_RUN_SORT);
  // The whole page is one scroll, title and filters included, so nothing sits
  // pinned over the content. The position is kept so the drill-down returns to
  // exactly where it left.
  const pageRef = useRef<HTMLElement>(null);
  const pageScrollTop = useRef(0);

  // Every activity list call pushes a new array, so the clock is pinned to that
  // rather than read per render — otherwise "the last 90 days" moves under the
  // filter while nobody is touching it.
  const nowMs = useMemo(() => Date.now(), [activities]);

  // The load ratio asks about the whole leg, not one surface — a trail-only
  // ramp still lands on the same body — so it is the one figure the surface
  // filter does not narrow, and the hero labels it when a filter is on.
  const allRuns = useMemo(() => runsOnSurface(activities, null), [activities]);

  const runsInPeriod = useMemo(
    () => withinPeriod(allRuns, periodDays, nowMs),
    [allRuns, nowMs, periodDays]
  );

  const availableSurfaces = useMemo(
    () => surfacesPresent(runsInPeriod),
    [runsInPeriod]
  );

  const runs = useMemo(
    () => runsOnSurface(runsInPeriod, surface),
    [runsInPeriod, surface]
  );

  const totals = useMemo(() => summariseRuns(runs), [runs]);

  // Asked of the whole history, not the period: "nothing in the last four
  // weeks" and "never run at all" are different screens.
  const hasAnyRun = allRuns.length > 0;

  // Every run of the chosen surface, whatever the period. The year-ago
  // comparison is about a window the period filter excludes, and the hero's
  // "this week" and load ratio look back a fixed four weeks — fed only the
  // period, a "4 weeks" filter cut the oldest of those short and inflated the
  // week-on-baseline change.
  const runsAllTime = useMemo(
    () => (surface === null ? allRuns : runsOnSurface(allRuns, surface)),
    [allRuns, surface]
  );


  const chartWeeks = useMemo(() => weeksForPeriod(periodDays), [periodDays]);
  // The zones the account is actually scored against — the model picked on the
  // Personal screen. The dashboard only ever carries LTHR zones, and reading
  // those for an account on heart-rate reserve put a run COROS scored as 83%
  // zone 2 into "hard". Until the profile answers, the blocks that sort runs by
  // zone wait rather than draw from LTHR: this view remounts on every visit, and
  // on such an account the fallback found no easy runs, so the efficiency
  // headline switched to "All runs" and back each time.
  const { model: zoneModel, settled: zonesSettled } = useHeartRateZoneModel({
    api,
    corosConnected: connected
  });
  // The dashboard's zones are LTHR, so that is the model they are banded by.
  const zoneScale = useMemo<RunZoneScale>(
    () => zoneModel ?? { family: "lthr", zones: runningThresholdZones(snapshot) },
    [snapshot, zoneModel]
  );
  const stackedSurfaces = useMemo(
    () => (surface === null ? availableSurfaces : [surface]),
    [availableSurfaces, surface]
  );

  // A surface that has no runs in the newly chosen period would otherwise leave
  // the screen filtered to nothing with no chip left to un-press.
  useEffect(() => {
    if (surface !== null && !availableSurfaces.includes(surface)) {
      setSurface(null);
    }
  }, [availableSurfaces, surface]);

  const selectedRun = useMemo(
    () =>
      selectedRunId === null
        ? null
        : (activities.find((a) => a.activityId === selectedRunId) ?? null),
    [activities, selectedRunId]
  );

  // Time in zone and pace:HR drift, which live in the 2.5 MB detail payload and
  // are kept as a row per run so a whole list can show them. Read for the runs
  // on screen; missing ones are computed in the background and appear as they
  // land.
  const summaries = useRunDetailSummaries({
    api,
    runs,
    enabled: connected && selectedRunId === null
  });

  const openRun = useCallback(
    (activity: TrainingHubActivity) => {
      pageScrollTop.current = pageRef.current?.scrollTop ?? 0;
      setSelectedRunId(activity.activityId);
      onSelectActivity(activity);
    },
    [onSelectActivity]
  );

  const closeRun = useCallback(() => setSelectedRunId(null), []);

  // Restoring the scroll is what makes a full-page detail feel like a drill-down
  // rather than a trip back to the top of the list.
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (selectedRun !== null || !page) {
      return;
    }

    const target = pageScrollTop.current;
    page.scrollTop = target;
    if (page.scrollTop >= target - 1) {
      return;
    }

    // The remounted page can still be growing at this moment, and a position
    // past its current end is clamped short — seen once in a real window as a
    // run opened at 2000px coming back at 798px. So the position is re-applied
    // until it lands, the athlete scrolls on their own, or a second has passed.
    // Never longer: fighting a scroll the athlete started is worse than landing
    // a little high.
    //
    // A timer, not a ResizeObserver. An observer only reports during a rendering
    // frame, and a window that is not being given frames — an occluded GNOME
    // Wayland window, which this app has met before — never reports, so the
    // restore quietly gave up. Writing `scrollTop` forces layout synchronously,
    // so a timer lands whether or not anything is being painted.
    const pageEvents = ["wheel", "touchstart", "pointerdown"] as const;
    let finished = false;
    const interval = window.setInterval(() => {
      page.scrollTop = target;
      if (page.scrollTop >= target - 1) {
        finish();
      }
    }, 50);
    const deadline = window.setTimeout(finish, 1000);

    // Only keys that scroll count. Escape is what closes the detail page, and
    // its keydown is still travelling up to the window when this effect runs —
    // listening for any key here would catch the very press that brought the
    // athlete back and cancel the restore on arrival.
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
    // Keyboard scrolling reaches the window, not the page, when focus sits on
    // the document body.
    window.addEventListener("keydown", onKeyDown);
    return finish;
  }, [selectedRun]);

  if (!connected) {
    return (
      <section className="running-view running-view-disconnected">
        <RunningPageHeader />

        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{restoring ? "Reconnecting to COROS" : "Connect COROS first"}</h3>
            <p>
              {restoring
                ? "Signing back in with your saved credentials. Your runs load as soon as that finishes."
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

  if (selectedRun) {
    const ownDetail = detail?.activityId === selectedRun.activityId ? detail : null;
    // A request for another run, or none yet, means this one is about to be
    // asked for: `openRun` requests in the same tick it selects.
    const detailStatus =
      detailRequest?.activityId === selectedRun.activityId
        ? detailRequest.status
        : "pending";
    return (
      <RunDetailView
        activity={selectedRun}
        detail={ownDetail}
        detailStatus={detailStatus}
        onBack={closeRun}
        onRetry={() => onSelectActivity(selectedRun)}
      />
    );
  }

  // Signed in, but the list has not arrived. Every figure below would be a
  // zero, and a zero reads as a fact — so nothing is shown until it lands.
  // Data already on screen from an earlier load is kept instead: only an empty
  // list waits on this.
  if (!hasAnyRun && activitiesStatus === "pending") {
    return (
      <section className="running-view" ref={pageRef}>
        <RunningPageHeader />
        <RunningPageSkeleton />
      </section>
    );
  }

  if (!hasAnyRun && activitiesStatus === "failed") {
    const retrying = busy === "training-refresh";
    return (
      <section className="running-view" ref={pageRef}>
        <RunningPageHeader />
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

  if (!hasAnyRun) {
    return (
      <section className="running-view" ref={pageRef}>
        <RunningPageHeader />
        <section className="panel running-empty running-state-panel">
          <RunnerIcon size={22} aria-hidden="true" />
          <div>
            <h3>No runs yet</h3>
            <p>
              Road, trail, track and treadmill runs from your COROS watch land
              here once they sync. Everything else you record stays under
              Activities.
            </p>
          </div>
        </section>
      </section>
    );
  }

  const averagePace =
    totals.distance > 0 && totals.duration > 0
      ? totals.duration / (totals.distance / 1000)
      : undefined;

  return (
    <section className="running-view" ref={pageRef}>
      <RunningPageHeader />

      <div className="running-controls">
        {/* The same chips as the load heatmap on Training Overview, class for
            class, so a filter reads the same wherever it sits in the app. */}
        <div className="training-metric-toggle" role="group" aria-label="Surface">
          <button
            type="button"
            className={`training-metric-option${surface === null ? " is-active" : ""}`}
            aria-pressed={surface === null}
            onClick={() => setSurface(null)}
          >
            All
          </button>
          {availableSurfaces.map((option) => (
            <button
              key={option}
              type="button"
              className={`training-metric-option${surface === option ? " is-active" : ""}`}
              aria-pressed={surface === option}
              onClick={() => setSurface(option)}
            >
              {RUN_SURFACE_LABELS[option]}
            </button>
          ))}
        </div>

        <div
          className="training-metric-toggle running-period"
          role="group"
          aria-label="Period"
        >
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className={`training-metric-option${
                periodDays === option.days ? " is-active" : ""
              }`}
              aria-pressed={periodDays === option.days}
              onClick={() => setPeriodDays(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="running-body">
        <RunningHero
          runs={runsAllTime}
          allRuns={allRuns}
          snapshot={snapshot}
          filtered={surface !== null}
          nowMs={nowMs}
        />

        <div className="running-totals">
          <div className="running-stat">
            <span>Runs</span>
            <strong>{totals.count}</strong>
          </div>
          <div className="running-stat">
            <span>Distance</span>
            <strong>{formatDistanceMeters(totals.distance, unitSystem)}</strong>
          </div>
          <div className="running-stat">
            <span>Time</span>
            <strong>{formatDurationSeconds(totals.duration)}</strong>
          </div>
          <div className="running-stat">
            <span>Avg pace</span>
            <strong>{formatPaceSecondsPerKm(averagePace, unitSystem)}</strong>
          </div>
          <div className="running-stat">
            <span>Climb</span>
            <strong>{formatElevationMeters(totals.elevationGain, unitSystem)}</strong>
          </div>
        </div>

        {runs.length > 0 ? (
          <>
            <RunVolumeChart
              runs={runs}
              runsAllTime={runsAllTime}
              weeks={chartWeeks}
              surfaces={stackedSurfaces}
              nowMs={nowMs}
            />
            {zonesSettled ? (
              <RunEfficiencyChart
                runs={runs}
                weeks={chartWeeks}
                surfaces={stackedSurfaces}
                zoneScale={zoneScale}
                nowMs={nowMs}
              />
            ) : (
              <RunBlockSkeleton label="Loading your heart-rate zones" />
            )}
            <div className="running-columns">
              {zonesSettled ? (
                <RunIntensityPanel
                  runs={runs}
                  zoneScale={zoneScale}
                  zoneModelLabel={zoneModel?.title}
                  summaries={summaries}
                />
              ) : (
                <RunBlockSkeleton label="Loading your heart-rate zones" />
              )}
              <RunSurfacePanel runs={runsInPeriod} />
            </div>
          </>
        ) : null}

        {runs.length === 0 ? (
          <section className="panel running-empty">
            <RunnerIcon size={22} aria-hidden="true" />
            <div>
              <h3>No runs in this window</h3>
              <p>
                {surface === null
                  ? "Widen the period, or log a run and sync your watch."
                  : `No ${RUN_SURFACE_LABELS[surface].toLowerCase()} runs here. Try another surface or a wider period.`}
              </p>
            </div>
          </section>
        ) : (
          <div className="running-list-panel">
            <RunList
              runs={runs}
              summaries={summaries}
              sort={sort}
              onSortChange={setSort}
              onOpenRun={openRun}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function RunningPageHeader() {
  return (
    <header className="running-page-header">
      <p className="running-eyebrow">Your training</p>
      <h1>Running</h1>
      <p>Every run you have logged, read down the time axis.</p>
    </header>
  );
}
