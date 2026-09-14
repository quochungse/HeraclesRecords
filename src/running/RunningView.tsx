import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import type { TrainingHubSnapshot } from "../training/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatPaceSecondsPerKm
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { RunDetailView } from "./RunDetailView";
import { RunEfficiencyChart } from "./RunEfficiencyChart";
import { RunIntensityPanel } from "./RunIntensityPanel";
import { RunningHero, runningThresholdZones } from "./RunningHero";
import { RunSurfacePanel } from "./RunSurfacePanel";
import { RunVolumeChart } from "./RunVolumeChart";
import { DEFAULT_RUN_SORT, RunList, type RunSort } from "./RunList";
import { summariseRuns, surfacesPresent } from "./runMetrics";
import { RunnerIcon } from "./runnerIcon";
import {
  RUN_SURFACE_LABELS,
  isRunSportType,
  runsOnSurface,
  type RunSurface
} from "./runSurface";
import "./running.css";

export interface RunningViewProps {
  activities: TrainingHubActivity[];
  connected: boolean;
  /** A start-up re-login in flight: signed out now, probably not in a moment. */
  restoring?: boolean;
  detail: TrainingHubActivityDetail | null;
  /** Account-level figures the blocks read: VO2max, thresholds, zones. */
  snapshot: TrainingHubSnapshot | null;
  busy: string | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
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
const MS_PER_DAY = 86_400_000;

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

function withinPeriod(
  activities: readonly TrainingHubActivity[],
  days: number | null,
  nowMs: number
): TrainingHubActivity[] {
  if (days === null) {
    return [...activities];
  }

  const cutoff = (nowMs - days * MS_PER_DAY) / 1000;
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
  activities,
  connected,
  restoring = false,
  detail,
  snapshot,
  busy,
  onSelectActivity,
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

  const runsInPeriod = useMemo(
    () => withinPeriod(activities.filter((a) => isRunSportType(a.sportType)), periodDays, nowMs),
    [activities, nowMs, periodDays]
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

  // Every run of the chosen surface, whatever the period: the year-ago
  // comparison is explicitly about a window the period filter excludes.
  const runsAllTime = useMemo(
    () => runsOnSurface(activities, surface),
    [activities, surface]
  );

  // The load ratio asks about the whole leg, not one surface — a trail-only
  // ramp still lands on the same body — so it is the one figure the surface
  // filter does not narrow, and the hero labels it when a filter is on.
  const allRunsInPeriod = useMemo(() => runsOnSurface(runsInPeriod, null), [runsInPeriod]);

  const chartWeeks = useMemo(() => weeksForPeriod(periodDays), [periodDays]);
  const zones = useMemo(() => runningThresholdZones(snapshot), [snapshot]);
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
        <header className="running-page-header">
          <p className="running-eyebrow">Your training</p>
          <h1>Running</h1>
          <p>Every run you have logged, read down the time axis.</p>
        </header>

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
    return (
      <RunDetailView
        activity={selectedRun}
        detail={detail?.activityId === selectedRun.activityId ? detail : null}
        loading={busy === `training-detail:${selectedRun.activityId}`}
        onBack={closeRun}
      />
    );
  }

  const averagePace =
    totals.distance > 0 && totals.duration > 0
      ? totals.duration / (totals.distance / 1000)
      : undefined;

  return (
    <section className="running-view" ref={pageRef}>
      <header className="running-page-header">
        <p className="running-eyebrow">Your training</p>
        <h1>Running</h1>
        <p>Every run you have logged, read down the time axis.</p>
      </header>

      <div className="running-controls">
        <div className="running-switch" role="group" aria-label="Surface">
          <button
            type="button"
            className={surface === null ? "is-active" : undefined}
            onClick={() => setSurface(null)}
          >
            All
          </button>
          {availableSurfaces.map((option) => (
            <button
              key={option}
              type="button"
              className={surface === option ? "is-active" : undefined}
              onClick={() => setSurface(option)}
            >
              {RUN_SURFACE_LABELS[option]}
            </button>
          ))}
        </div>

        <div className="running-switch running-period" role="group" aria-label="Period">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className={periodDays === option.days ? "is-active" : undefined}
              onClick={() => setPeriodDays(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="running-body">
        <RunningHero
          runs={runs}
          allRuns={allRunsInPeriod}
          snapshot={snapshot}
          filtered={surface !== null}
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
            />
            <RunEfficiencyChart
              runs={runs}
              weeks={chartWeeks}
              surfaces={stackedSurfaces}
              zones={zones}
            />
            <div className="running-columns">
              <RunIntensityPanel runs={runs} zones={zones} />
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
