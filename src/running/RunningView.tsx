import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail
} from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatElevationMeters,
  formatPaceSecondsPerKm
} from "../training/formatters";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { RunDetailView } from "./RunDetailView";
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
const MS_PER_DAY = 86_400_000;

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
  busy,
  onSelectActivity,
  onOpenOverview
}: RunningViewProps) {
  const { unitSystem } = useUnitSystem();
  const [surface, setSurface] = useState<RunSurface | null>(null);
  const [periodDays, setPeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [sort, setSort] = useState<RunSort>(DEFAULT_RUN_SORT);
  const listRef = useRef<HTMLDivElement>(null);
  const listScrollTop = useRef(0);

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
      listScrollTop.current = listRef.current?.scrollTop ?? 0;
      setSelectedRunId(activity.activityId);
      onSelectActivity(activity);
    },
    [onSelectActivity]
  );

  const closeRun = useCallback(() => setSelectedRunId(null), []);

  // Restoring the scroll is what makes a full-page detail feel like a drill-down
  // rather than a trip back to the top of the list.
  useLayoutEffect(() => {
    if (selectedRun === null && listRef.current) {
      listRef.current.scrollTop = listScrollTop.current;
    }
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
    <section className="running-view">
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

      <div className="running-list-scroll" ref={listRef}>
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
          <RunList
            runs={runs}
            sort={sort}
            onSortChange={setSort}
            onOpenRun={openRun}
          />
        )}
      </div>
    </section>
  );
}
