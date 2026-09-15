import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CloudOff,
  Loader2,
  LockKeyhole,
  RefreshCw,
  SearchX
} from "lucide-react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { ActivityDetailPane } from "./components/ActivityDetailPane";
import { ActivitiesFilterBar } from "./components/ActivitiesFilterBar";
import { ActivitiesSummary } from "./components/ActivitiesSummary";
import { ActivityJournalList } from "./components/ActivityJournalList";
import {
  ACTIVITY_PERIOD_OPTIONS,
  DEFAULT_ACTIVITY_FILTERS,
  type ActivityFilters,
  filterActivities,
  sportsPresent,
  summariseActivities
} from "./activityFilters";
import { resolveSportName } from "./sportTypes";
import { useActivityDetailSummaries } from "./useActivityDetailSummaries";
import { feelCoverage, useActivityFeelTypes } from "./useActivityFeelTypes";
import type { ActivitiesViewProps } from "./types";
import "./activities.css";

/** Rows built per page. See `limit` below for why there is a page at all. */
const PAGE_SIZE = 200;

/**
 * Below this, the two panes stop being a split and become two screens.
 *
 * Stacked, they were three scrollers inside each other — the page, the list and
 * the detail — and the detail sat a full list-length below the fold, so
 * clicking a session appeared to do nothing at all. Running already solves this
 * by opening a session as a page of its own; this is the same move, taken only
 * when the width forces it.
 */
const SPLIT_MIN_WIDTH_QUERY = "(max-width: 1199px)";

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
  onRetry,
  onOpenSportScreen
}: ActivitiesViewProps) {
  const connected = Boolean(status?.authenticated);
  const [filters, setFilters] = useState<ActivityFilters>(
    DEFAULT_ACTIVITY_FILTERS
  );
  /*
   * How many rows are built at once.
   *
   * There is no windowing here and no virtual-list dependency to reach for, so
   * the cap is the thing standing between a six-year history on "All" and
   * several thousand rows with an export menu each. The period filter is the
   * real answer; this is what stops the screen locking up before the athlete
   * reaches for it.
   */
  const [limit, setLimit] = useState(PAGE_SIZE);
  const narrow = useMediaQuery(SPLIT_MIN_WIDTH_QUERY);
  /*
   * Whether the narrow layout is showing the detail rather than the list. It
   * is not the selection: the screen auto-selects the newest session so the
   * wide layout opens on something, and reading that as "the athlete opened a
   * session" would land every narrow launch inside a detail they never asked
   * for.
   */
  const [detailOpen, setDetailOpen] = useState(false);
  const filterKey = `${filters.periodDays}|${filters.sports.join(",")}|${filters.query}|${filters.unratedOnly}`;
  const lastFilterKey = useRef(filterKey);
  if (lastFilterKey.current !== filterKey) {
    // Narrowing the list and keeping a limit from the wider one would leave the
    // athlete scrolled past the end of a much shorter result.
    lastFilterKey.current = filterKey;
    setLimit(PAGE_SIZE);
  }

  // Every activity list call pushes a new array holding the same activities, so
  // the clock is pinned to that rather than read per render — otherwise "the
  // last 90 days" moves under the filter while nobody is touching it.
  const nowMs = useMemo(() => Date.now(), [activities]);

  const sportTypeMap = useMemo(
    () => new Map(sportTypes.map((item) => [item.sportType, item.sportName])),
    [sportTypes]
  );

  const available = useMemo(() => sportsPresent(activities), [activities]);

  /*
   * Both read the whole history rather than the filtered list: each is keyed on
   * the activity ids, and narrowing the set would re-read on every keystroke.
   * Neither holds the screen back — the badges and the drift column fill in.
   */
  const feel = useActivityFeelTypes(api, activities);
  const summaries = useActivityDetailSummaries({
    api,
    activities,
    // Held back while a session the athlete just clicked is loading: computing
    // a summary is a detail fetch of its own, and that payload wants the
    // connection first.
    enabled: detailRequest?.status !== "pending"
  });

  const visible = useMemo(
    () =>
      filterActivities({
        activities,
        filters,
        nowMs,
        sportName: (activity) => resolveSportName(activity, sportTypeMap),
        isRated: (activity) => {
          const state = feel.state(activity.activityId);
          return state === "unchecked" ? undefined : state === "rated";
        }
      }),
    [activities, feel, filters, nowMs, sportTypeMap]
  );

  const totals = useMemo(() => summariseActivities(visible), [visible]);
  const coverage = useMemo(() => feelCoverage(visible, feel), [visible, feel]);
  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const hidden = visible.length - shown.length;

  const openActivity = useCallback(
    (activity: Parameters<typeof onLoadDetail>[0]) => {
      setDetailOpen(true);
      onLoadDetail(activity);
    },
    [onLoadDetail]
  );

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
        <>
          <ActivityJournalList
            activities={shown}
            sportTypes={sportTypes}
            selectedActivityId={selectedActivity?.activityId ?? null}
            busy={busy}
            nowMs={nowMs}
            feel={feel}
            summaries={summaries}
            onLoadDetail={openActivity}
            onExportFile={onExportFile}
          />
          {hidden > 0 ? (
            <div className="activity-journal-more">
              <p>
                {hidden.toLocaleString()} older{" "}
                {hidden === 1 ? "session" : "sessions"} not shown
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
              >
                Show more
              </button>
            </div>
          ) : null}
        </>
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

  const detailPane = (
    <ActivityDetailPane
      api={api}
      detail={activityDetail}
      listActivity={selectedActivity}
      sportTypes={sportTypes}
      detailRequest={detailRequest}
      onRetry={onLoadDetail}
      onOpenSportScreen={onOpenSportScreen}
    />
  );

  /*
   * Narrow: one screen at a time. The summary and the filters belong to the
   * list, so they go with it rather than sitting above an open session.
   */
  if (narrow && detailOpen && selectedActivity) {
    return (
      <div className="stack stack-fill training-dashboard activities-view is-narrow-detail">
        <header className="activities-head">
          <button
            type="button"
            className="secondary-button activities-back"
            onClick={() => setDetailOpen(false)}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            All sessions
          </button>
        </header>
        <section className="panel panel-flex training-activities-split-panel">
          <div className="training-activities-detail">{detailPane}</div>
        </section>
      </div>
    );
  }

  return (
    <div
      className={`stack stack-fill training-dashboard activities-view${
        narrow ? " is-narrow" : ""
      }`}
    >
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

      <ActivitiesSummary
        totals={totals}
        periodLabel={periodLabel}
        feelCoverage={coverage}
      />

      <ActivitiesFilterBar
        filters={filters}
        available={available}
        matched={visible.length}
        unratedCount={coverage.checked - coverage.rated}
        onChange={setFilters}
      />

      <section className="panel panel-flex training-activities-split-panel">
        <div className="training-activities-split">
          <div className="training-activities-list">{renderList()}</div>
          {narrow ? null : (
            <div className="training-activities-detail">{detailPane}</div>
          )}
        </div>
      </section>
    </div>
  );
}

export type { ActivitiesViewProps };
