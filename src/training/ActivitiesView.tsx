import { useMemo, useState } from "react";
import { CloudOff, Loader2, LockKeyhole, RefreshCw, SearchX } from "lucide-react";
import { ActivityDetailPanel } from "./components/ActivityDetailPanel";
import { ActivitiesFilterBar } from "./components/ActivitiesFilterBar";
import { ActivitiesSummary } from "./components/ActivitiesSummary";
import { TrainingActivityTable } from "./components/TrainingActivityTable";
import {
  ACTIVITY_PERIOD_OPTIONS,
  DEFAULT_ACTIVITY_FILTERS,
  type ActivityFilters,
  filterActivities,
  sportsPresent,
  summariseActivities
} from "./activityFilters";
import { resolveSportName } from "./sportTypes";
import type { ActivitiesViewProps } from "./types";
import "./activities.css";

export function ActivitiesView({
  api,
  status,
  activities,
  activitiesStatus,
  sportTypes,
  activityDetail,
  selectedActivity,
  detailRequest,
  busy,
  onLoadDetail,
  onExportFile,
  onConnect,
  onRetry
}: ActivitiesViewProps) {
  const connected = Boolean(status?.authenticated);
  const [filters, setFilters] = useState<ActivityFilters>(
    DEFAULT_ACTIVITY_FILTERS
  );

  // Every activity list call pushes a new array holding the same activities, so
  // the clock is pinned to that rather than read per render — otherwise "the
  // last 90 days" moves under the filter while nobody is touching it.
  const nowMs = useMemo(() => Date.now(), [activities]);

  const sportTypeMap = useMemo(
    () => new Map(sportTypes.map((item) => [item.sportType, item.sportName])),
    [sportTypes]
  );

  const available = useMemo(() => sportsPresent(activities), [activities]);

  const visible = useMemo(
    () =>
      filterActivities({
        activities,
        filters,
        nowMs,
        sportName: (activity) => resolveSportName(activity, sportTypeMap)
      }),
    [activities, filters, nowMs, sportTypeMap]
  );

  const totals = useMemo(() => summariseActivities(visible), [visible]);

  const periodLabel =
    ACTIVITY_PERIOD_OPTIONS.find((option) => option.days === filters.periodDays)
      ?.label ?? "All";

  if (!connected) {
    return (
      <section className="panel data-connect-panel">
        <LockKeyhole size={24} aria-hidden="true" />
        <div>
          <h3>Connect COROS first</h3>
          <p>
            Signing in to COROS lives on Overview. Connect there and your
            activities and their detail load here.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={onConnect}>
          Open Overview
        </button>
      </section>
    );
  }

  /*
   * Four states an empty list cannot tell apart, which is why it is not asked.
   * Until this screen read `activitiesStatus` it answered all of them with "No
   * Training Hub activities loaded" — including the launch where COROS simply
   * had not replied yet, and the filter the athlete had just typed.
   */
  function renderList() {
    if (visible.length > 0) {
      return (
        <TrainingActivityTable
          activities={visible}
          sportTypes={sportTypes}
          selectedActivityId={selectedActivity?.activityId ?? null}
          busy={busy}
          onLoadDetail={onLoadDetail}
          onExportFile={onExportFile}
        />
      );
    }

    if (activities.length === 0 && activitiesStatus === "pending") {
      return (
        <div className="training-empty-state">
          <Loader2 className="spin" size={20} aria-hidden="true" />
          <p>Reading your activities from COROS…</p>
        </div>
      );
    }

    if (activities.length === 0 && activitiesStatus === "failed") {
      return (
        <div className="training-empty-state">
          <CloudOff size={20} aria-hidden="true" />
          <p>COROS did not answer. Nothing was lost — try again.</p>
          <button type="button" className="secondary-button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            Try again
          </button>
        </div>
      );
    }

    if (activities.length > 0) {
      return (
        <div className="training-empty-state">
          <SearchX size={20} aria-hidden="true" />
          <p>Nothing in {periodLabel} matches these filters.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setFilters(DEFAULT_ACTIVITY_FILTERS)}
          >
            Reset filters
          </button>
        </div>
      );
    }

    return (
      <div className="training-empty-state">
        <p>No activities yet. They appear here once your watch syncs.</p>
      </div>
    );
  }

  return (
    <div className="stack stack-fill training-dashboard activities-view">
      <header className="activities-head">
        <div>
          <p className="eyebrow">Activities</p>
          <h2>
            {activities.length === 0 && activitiesStatus === "pending"
              ? "Loading…"
              : `${totals.count} ${totals.count === 1 ? "session" : "sessions"}`}
            <span> in {periodLabel}</span>
          </h2>
        </div>
      </header>

      <ActivitiesSummary totals={totals} periodLabel={periodLabel} />

      <ActivitiesFilterBar
        filters={filters}
        available={available}
        matched={visible.length}
        onChange={setFilters}
      />

      <section className="panel panel-flex training-activities-split-panel">
        <div className="training-activities-split">
          <div className="training-activities-list">{renderList()}</div>
          <div className="training-activities-detail">
            <ActivityDetailPanel
              api={api}
              detail={activityDetail}
              listActivity={selectedActivity}
              sportTypes={sportTypes}
              detailRequest={detailRequest}
              busy={busy}
              onRetry={onLoadDetail}
              embedded
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export type { ActivitiesViewProps };
