import { useEffect, useMemo, useState } from "react";
import { CloudOff, LockKeyhole, RefreshCw } from "lucide-react";
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
  formatDurationSeconds,
  formatElevationMeters,
  formatPaceSecondsPerKm
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
import { useUnitSystem } from "../units/UnitSystemProvider";
import { distanceUnit, elevationUnit } from "../units/units";
import type { PrimaryView } from "../navigation/primaryNav";
import { RunDetailView } from "./RunDetailView";
import { RunEfficiencyChart } from "./RunEfficiencyChart";
import { RunIntensityPanel } from "./RunIntensityPanel";
import { RunningHero, runningThresholdZones } from "./RunningHero";
import { RunSurfacePanel } from "./RunSurfacePanel";
import { RunBlockSkeleton, RunningPageSkeleton } from "./RunningSkeleton";
import { RunVolumeChart } from "./RunVolumeChart";
import { DEFAULT_RUN_SORT, RunList, type RunSort } from "./RunList";
import { TrailRunningHero } from "./TrailRunningHero";
import {
  climbPerDistanceUnit,
  summariseRuns,
  surfacesPresent,
  type RunZoneScale
} from "./runMetrics";
import { useActivityDetailSummaries } from "../training/useActivityDetailSummaries";
import { useSessionPage, weeksForPeriod, withinPeriod } from "./sportPage";
import { RunnerIcon } from "./runnerIcon";
import {
  RUN_SURFACE_LABELS,
  runsOnSurface,
  type RunSurface
} from "./runSurface";
import "./running.css";

import { t } from "../i18n/core";
export interface RunningViewProps {
  api: HeraclesRecordsApi | null;
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
  /**
   * A run Activities handed over, to be opened rather than merely listed.
   * "Open in Running" is pressed while looking at that run; arriving on the
   * list with nothing open is not what the button says it does.
   */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same run is not re-opened when the athlete closes it. */
  onOpenRequestHandled?: () => void;
  /** Back on a run handed over from another screen: that screen, again. */
  onReturn?: (view: PrimaryView) => void;
  /** Asks Coach about the run open, as the Calendar's Ask Coach does. */
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/**
 * The whole history is a deliberate choice rather than the default: the
 * renderer holds every activity COROS has, and tallying years of them on every
 * filter change is work nobody asked for while looking at this month.
 *
 * The labels are the scale's, not this screen's — see periodScale.ts.
 */
const PERIOD_OPTIONS = periodGroupOptions([28, 90, 365, null]);

const DEFAULT_PERIOD_DAYS = 90;

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
  onOpenOverview,
  openRequest = null,
  onOpenRequestHandled,
  onReturn,
  onAskCoach
}: RunningViewProps) {
  const { unitSystem } = useUnitSystem();
  const [surface, setSurface] = useState<RunSurface | null>(null);
  const [periodDays, setPeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);
  const [sort, setSort] = useState<RunSort>(DEFAULT_RUN_SORT);
  const {
    pageRef,
    selected: selectedRun,
    selectedId: selectedRunId,
    backLabel,
    open: openRun,
    close: closeRun
  } = useSessionPage({
    activities,
    onSelectActivity,
    openRequest,
    onOpenRequestHandled,
    onReturn,
    listLabel: t("nav.running")
  });

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

  // The Trail filter is also a way of reading: a trail run is running, and
  // stays on this screen and in its load, but a week of it is read in hours
  // and height rather than kilometres and pace.
  const trail = surface === "trail";

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

  // Time in zone and pace:HR drift, which live in the 2.5 MB detail payload and
  // are kept as a row per run so a whole list can show them. Read for the runs
  // on screen; missing ones are computed in the background and appear as they
  // land.
  const summaries = useActivityDetailSummaries({
    api,
    activities: runs,
    enabled: connected && selectedRunId === null
  });

  if (!connected) {
    return (
      <section className="running-view running-view-disconnected">
        <RunningPageHeader />

        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{restoring ? t("run.reconnecting") : t("common.connectFirst.title")}</h3>
            <p>{restoring ? t("run.reconnectingBody") : t("run.connectBody")}</p>
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
        backLabel={backLabel}
        onRetry={() => onSelectActivity(selectedRun)}
        onAskCoach={onAskCoach}
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

  if (!hasAnyRun) {
    return (
      <section className="running-view" ref={pageRef}>
        <RunningPageHeader />
        <section className="panel running-empty running-state-panel">
          <RunnerIcon size={22} aria-hidden="true" />
          <div>
            <h3>{t("run.none")}</h3>
            <p>{t("run.noneBody")}</p>
          </div>
        </section>
      </section>
    );
  }

  const averagePace =
    totals.distance > 0 && totals.duration > 0
      ? totals.duration / (totals.distance / 1000)
      : undefined;
  const climbPerKm =
    totals.distance > 0 ? totals.elevationGain / (totals.distance / 1000) : undefined;

  return (
    <section className="running-view" ref={pageRef}>
      <RunningPageHeader />

      <div className="running-controls">
        {/* The same control as the load heatmap on Training Overview — the
            same component now, not merely the same class, so a filter reads
            the same wherever it sits in the app. */}
        <OptionGroup
          label={t("run.surface")}
          value={surface ?? "all"}
          options={[
            { value: "all", label: t("common.all") },
            ...availableSurfaces.map((option) => ({
              value: option,
              label: RUN_SURFACE_LABELS[option]
            }))
          ]}
          onChange={(next) =>
            setSurface(next === "all" ? null : (next as RunSurface))
          }
        />

        {/* Folded at rest: the period is read far more often than it is
            changed, and the header has a surface picker and the run count to
            fit beside it. */}
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
        {trail ? (
          <TrailRunningHero trailRuns={runsAllTime} allRuns={allRuns} nowMs={nowMs} />
        ) : (
          <RunningHero
            runs={runsAllTime}
            allRuns={allRuns}
            snapshot={snapshot}
            filtered={surface !== null}
            nowMs={nowMs}
          />
        )}

        <div className="running-totals">
          <div className="running-stat">
            <span>{t("run.runs")}</span>
            <strong>{totals.count}</strong>
          </div>
          <div className="running-stat">
            <span>{t("activity.m.distance")}</span>
            <strong>{formatDistanceMeters(totals.distance, unitSystem)}</strong>
          </div>
          <div className="running-stat">
            <span>{t("activity.m.time")}</span>
            <strong>{formatDurationSeconds(totals.duration)}</strong>
          </div>
          {/* A trail's average pace is an average over its gradients, which
              says how hilly the period was rather than how it was run. Its
              climb per kilometre says the first thing honestly. */}
          {trail ? (
            <div className="running-stat">
              <span>{t("run.climbPer", { unit: distanceUnit(unitSystem) })}</span>
              <strong>
                {climbPerKm === undefined
                  ? "—"
                  : `${Math.round(climbPerDistanceUnit(climbPerKm, unitSystem))} ${elevationUnit(unitSystem)}`}
              </strong>
            </div>
          ) : (
            <div className="running-stat">
              <span>{t("activity.m.avgPace")}</span>
              <strong>{formatPaceSecondsPerKm(averagePace, unitSystem)}</strong>
            </div>
          )}
          <div className="running-stat">
            <span>{t("activity.m.climb")}</span>
            <strong>{formatElevationMeters(totals.elevationGain, unitSystem)}</strong>
          </div>
        </div>

        {runs.length > 0 ? (
          <>
            {/* Keyed on the mode, so the Trail filter opens the chart on its
                own measure and leaving it gives the road's back. */}
            <RunVolumeChart
              key={trail ? "trail" : "road"}
              runs={runs}
              runsAllTime={runsAllTime}
              weeks={chartWeeks}
              surfaces={stackedSurfaces}
              nowMs={nowMs}
              defaultMeasure={trail ? "time" : "distance"}
            />
            {/* Efficiency is ground covered per heartbeat, and on a trail the
                gradient decides the ground covered: the chart would rank the
                hilly weeks as unfit ones. So the trail view leaves it out
                rather than draw it with a caveat. */}
            {trail ? null : zonesSettled ? (
              <RunEfficiencyChart
                runs={runs}
                weeks={chartWeeks}
                surfaces={stackedSurfaces}
                zoneScale={zoneScale}
                nowMs={nowMs}
              />
            ) : (
              <RunBlockSkeleton label={t("run.loadingZones")} />
            )}
            <div className="running-columns">
              {zonesSettled ? (
                <RunIntensityPanel
                  sessions={runs}
                  zoneScale={zoneScale}
                  zoneModelLabel={zoneModel?.title}
                  summaries={summaries}
                />
              ) : (
                <RunBlockSkeleton label={t("run.loadingZones")} />
              )}
              <RunSurfacePanel runs={runsInPeriod} />
            </div>
          </>
        ) : null}

        {runs.length === 0 ? (
          <section className="panel running-empty">
            <RunnerIcon size={22} aria-hidden="true" />
            <div>
              <h3>{t("run.noneInWindow")}</h3>
              <p>
                {surface === null
                  ? t("run.widen")
                  : t(`run.noneOnSurface.${surface}` as const)}
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
              trail={trail}
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
      <p className="running-eyebrow">{t("run.eyebrow")}</p>
      <h1>{t("nav.running")}</h1>
      <p>{t("run.lead")}</p>
    </header>
  );
}
