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
  TrainingHubLoadStatus
} from "../training/types";
import { formatDurationSpan } from "../training/formatters";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { OptionGroup } from "../components/OptionGroup";
import { MotionFigure } from "../motion/MotionFigure";
import {
  periodDaysFromValue,
  periodGroupOptions,
  periodValue,
  type PeriodDays
} from "../preferences/periodScale";
import { useHeartRateZoneModel } from "../training/useHeartRateZoneModel";
import { useActivityDetailSummariesState } from "../training/useActivityDetailSummaries";
import { useAthleteContextRead } from "../calendar/useAthleteContext";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { elevationUnit, metersToElevation } from "../units/units";
import type { PrimaryView } from "../navigation/primaryNav";
import { RunningPageSkeleton } from "../running/RunningSkeleton";
import { useSessionPage, weeksForPeriod, withinPeriod } from "../running/sportPage";
import { ClimbDetailView } from "./ClimbDetailView";
import { ClimbKindPanel } from "./ClimbKindPanel";
import { ClimbList, DEFAULT_CLIMB_SORT, type ClimbSort } from "./ClimbList";
import { ClimbVolumeChart } from "./ClimbVolumeChart";
import { ClimbWallPanel } from "./ClimbWallPanel";
import { ClimbingHero, CLIMB_HERO_WEEKS } from "./ClimbingHero";
import { GradePyramidPanel } from "./GradePyramidPanel";
import { GradeTrendPanel } from "./GradeTrendPanel";
import { ClimbIcon } from "./climbIcon";
import { climbRecords, climbScales, climbWindowStartMs, summariseClimbs } from "./climbMetrics";
import { MOVING_AVERAGE_WEEKS } from "../running/sportVolume";
import { CLIMB_KINDS, CLIMB_KIND_LABELS, climbsOfKind, classifyClimbKind, type ClimbKind } from "./climbType";
import type { ClimbFamily } from "../../electron/climbGrades";
import "../running/running.css";
import "./climbing.css";
import { getIntlLocale, t } from "../i18n/core";

export interface ClimbingViewProps {
  api: HeraclesRecordsApi | null;
  activities: TrainingHubActivity[];
  connected: boolean;
  /** A start-up re-login in flight: signed out now, probably not in a moment. */
  restoring?: boolean;
  /** Whether `activities` has arrived — an empty list alone cannot say. */
  activitiesStatus: TrainingHubLoadStatus;
  detail: TrainingHubActivityDetail | null;
  /** Where the latest detail request stands, and which session it was for. */
  detailRequest: TrainingHubDetailRequest | null;
  busy: string | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  /** Reloads the COROS data after the activity list failed to arrive. */
  onRetryActivities: () => void;
  onOpenOverview: () => void;
  /** A session another screen handed over, to be opened rather than merely listed. */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same session is not re-opened when the athlete closes it. */
  onOpenRequestHandled?: () => void;
  /** Back on a session handed over from another screen: that screen, again. */
  onReturn?: (view: PrimaryView) => void;
  /** Presses of this screen's rail item while it showed: back to the list. */
  railReselect?: number;
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/** The scale's windows, as the other sport screens offer them — see periodScale.ts. */
const PERIOD_OPTIONS = periodGroupOptions([28, 90, 365, null]);

const DEFAULT_PERIOD_DAYS = 90;

/**
 * Indoor routes, boulders, outdoor routes and multi-pitches on a screen of
 * their own.
 *
 * Running's page built again for the wall, on the same stylesheet, as
 * Swimming was. A climber reads **grades**, not distance: what they sent and
 * how — first go, or worked until it went — counted on a pyramid, and the
 * hardest of it week by week. Routes and boulders are graded on different
 * scales and are never put on one: every grade figure is said twice, a
 * route's and a boulder's. Grades recorded in another scale are converted
 * through COROS's own ladder into the one the athlete chose in COROS's
 * climb settings. The heart-rate intensity split and the load ratio are not
 * carried over: a climb's effort is the grip, which the heart barely shows.
 */
export function ClimbingView({
  api,
  activities,
  connected,
  restoring = false,
  activitiesStatus,
  detail,
  detailRequest,
  busy,
  onSelectActivity,
  onRetryActivities,
  onOpenOverview,
  openRequest = null,
  onOpenRequestHandled,
  onReturn,
  railReselect,
  onAskCoach
}: ClimbingViewProps) {
  const { unitSystem } = useUnitSystem();
  const [kind, setKind] = useState<ClimbKind | null>(null);
  const [periodDays, setPeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);
  const [sort, setSort] = useState<ClimbSort>(DEFAULT_CLIMB_SORT);
  const [family, setFamily] = useState<ClimbFamily | null>(null);
  const {
    pageRef,
    selected: selectedClimb,
    selectedId: selectedClimbId,
    backLabel,
    open: openClimb,
    close: closeClimb
  } = useSessionPage({
    activities,
    onSelectActivity,
    openRequest,
    onOpenRequestHandled,
    onReturn,
    railReselect,
    listLabel: t("nav.climbing")
  });

  // Pinned to the list, so "the last year" does not move under the filter.
  const nowMs = useMemo(() => Date.now(), [activities]);

  const allSessions = useMemo(() => climbsOfKind(activities, null), [activities]);
  const sessionsInPeriod = useMemo(
    () => withinPeriod(allSessions, periodDays, nowMs),
    [allSessions, nowMs, periodDays]
  );
  const availableKinds = useMemo(
    () => CLIMB_KINDS.filter((entry) => sessionsInPeriod.some((activity) => classifyClimbKind(activity.sportType) === entry)),
    [sessionsInPeriod]
  );
  const sessions = useMemo(() => climbsOfKind(sessionsInPeriod, kind), [sessionsInPeriod, kind]);
  const hasAnySession = allSessions.length > 0;

  // Every session of the chosen kind, whatever the period — the hero and the
  // chart's year-ago figure look back spans the period must not cut.
  const sessionsAllTime = useMemo(
    () => (kind === null ? allSessions : climbsOfKind(allSessions, kind)),
    [allSessions, kind]
  );

  const chartWeeks = useMemo(() => weeksForPeriod(periodDays), [periodDays]);
  const stackedKinds = useMemo(() => (kind === null ? availableKinds : [kind]), [availableKinds, kind]);

  useEffect(() => {
    if (kind !== null && !availableKinds.includes(kind)) {
      setKind(null);
    }
  }, [availableKinds, kind]);

  // The climbs, their grades and how they went live in each session's
  // detail, so the sessions on screen are read — and the hero's twelve weeks
  // and the weeks the chart's four-week average reaches back past its first
  // column, which a short period would otherwise leave unread. No further:
  // every session read is a payload fetched from COROS.
  const summarySessions = useMemo(() => {
    const from =
      Math.min(
        climbWindowStartMs(CLIMB_HERO_WEEKS, nowMs),
        climbWindowStartMs(chartWeeks + MOVING_AVERAGE_WEEKS - 1, nowMs)
      ) / 1000;
    const ids = new Set(sessionsInPeriod.map((activity) => activity.activityId));
    return [
      ...sessionsInPeriod,
      ...allSessions.filter((activity) => !ids.has(activity.activityId) && (activity.startTime ?? 0) >= from)
    ];
  }, [allSessions, chartWeeks, nowMs, sessionsInPeriod]);
  const { summaries, settled: summariesSettled } = useActivityDetailSummariesState({
    api,
    activities: summarySessions,
    enabled: connected && selectedClimbId === null,
    requireClimb: true
  });

  const { context: athlete } = useAthleteContextRead(api, unitSystem);
  const records = useMemo(() => climbRecords(sessions, summaries), [sessions, summaries]);
  // Every read climb of the chosen kind, whatever the period: the hero's
  // twelve weeks reach past a short one. Read once, handed to the blocks.
  const recordsAllTime = useMemo(() => climbRecords(sessionsAllTime, summaries), [sessionsAllTime, summaries]);
  const allRecords = useMemo(() => climbRecords(allSessions, summaries), [allSessions, summaries]);
  const scales = useMemo(() => climbScales(athlete, allRecords), [athlete, allRecords]);
  const totals = useMemo(() => summariseClimbs(sessions, summaries), [sessions, summaries]);

  // The families the sessions on screen were graded in; a boulder-only kind
  // offers no route pyramid.
  const families = useMemo<ClimbFamily[]>(() => {
    const present = new Set(records.map((record) => record.family));
    const order: ClimbFamily[] = ["route", "boulder"];
    const found = order.filter((entry) => present.has(entry));
    if (found.length > 0) return found;
    return kind === "boulder" ? ["boulder"] : kind === null ? order : ["route"];
  }, [kind, records]);
  const shownFamily: ClimbFamily = family !== null && families.includes(family) ? family : families[0] ?? "route";

  const { model: zoneModel } = useHeartRateZoneModel({ api, corosConnected: connected });

  if (!connected) {
    return (
      <section className="running-view climbing-view running-view-disconnected">
        <ClimbingPageHeader />
        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{restoring ? t("run.reconnecting") : t("common.connectFirst.title")}</h3>
            <p>{restoring ? t("climb.reconnectingBody") : t("run.connectBody")}</p>
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

  if (selectedClimb) {
    const ownDetail = detail?.activityId === selectedClimb.activityId ? detail : null;
    const detailStatus =
      detailRequest?.activityId === selectedClimb.activityId ? detailRequest.status : "pending";
    return (
      <ClimbDetailView
        activity={selectedClimb}
        detail={ownDetail}
        detailStatus={detailStatus}
        scales={scales}
        onBack={closeClimb}
        backLabel={backLabel}
        onRetry={() => onSelectActivity(selectedClimb)}
        onAskCoach={onAskCoach}
        zoneFamily={zoneModel?.family}
      />
    );
  }

  if (!hasAnySession && activitiesStatus === "pending") {
    return (
      <section className="running-view climbing-view" ref={pageRef}>
        <ClimbingPageHeader />
        <RunningPageSkeleton label={t("climb.loading")} />
      </section>
    );
  }

  if (!hasAnySession && activitiesStatus === "failed") {
    const retrying = busy === "training-refresh";
    return (
      <section className="running-view climbing-view" ref={pageRef}>
        <ClimbingPageHeader />
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

  if (!hasAnySession) {
    return (
      <section className="running-view climbing-view" ref={pageRef}>
        <ClimbingPageHeader />
        <section className="panel running-empty running-state-panel">
          <ClimbIcon size={22} aria-hidden="true" />
          <div>
            <h3>{t("climb.none")}</h3>
            <p>{t("climb.noneBody")}</p>
          </div>
        </section>
      </section>
    );
  }

  const read = totals.read === totals.sessions;
  const pending = !read && !summariesSettled;
  const needsSummary = (text: string) => (pending ? "…" : totals.read === 0 ? "—" : text);

  return (
    <section className="running-view climbing-view" ref={pageRef}>
      <ClimbingPageHeader />

      <div className="running-controls">
        <OptionGroup
          label={t("climb.kind")}
          motion="roll"
          value={kind ?? "all"}
          options={[
            { value: "all", label: t("common.all") },
            ...availableKinds.map((option) => ({ value: option, label: CLIMB_KIND_LABELS[option] }))
          ]}
          onChange={(next) => setKind(next === "all" ? null : (next as ClimbKind))}
        />
        <OptionGroup
          label={t("activity.filter.period")}
          motion="roll"
          mode="collapsible"
          className="running-period"
          value={periodValue(periodDays as PeriodDays)}
          options={PERIOD_OPTIONS}
          onChange={(next) => setPeriodDays(periodDaysFromValue(next))}
        />
      </div>

      <div className="running-body">
        <ClimbingHero
          sessions={sessionsAllTime}
          records={recordsAllTime}
          summaries={summaries}
          settled={summariesSettled}
          scales={scales}
          nowMs={nowMs}
        />

        <div className="running-totals">
          <div className="running-stat">
            <span>{t("climb.sessions")}</span>
            <strong><MotionFigure text={String(totals.sessions)} value={totals.sessions} /></strong>
          </div>
          <div className="running-stat" title={t("climb.climbsTitle")}>
            <span>{t("climb.climbs")}</span>
            <strong>
              <MotionFigure text={needsSummary(String(totals.climbs))} value={totals.climbs} />
            </strong>
          </div>
          <div className="running-stat" title={t("climb.climbingTimeTitle")}>
            <span>{t("climb.climbingTime")}</span>
            <strong>
              <MotionFigure text={needsSummary(formatDurationSpan(totals.climbingSeconds))} value={totals.climbingSeconds} />
            </strong>
          </div>
          <div className="running-stat" title={t("climb.heightTitle")}>
            <span>{t("climb.height")}</span>
            <strong>
              <MotionFigure
                text={needsSummary(
                  totals.heightMeters > 0
                    ? `${Math.round(metersToElevation(totals.heightMeters, unitSystem)).toLocaleString(getIntlLocale())} ${elevationUnit(unitSystem)}`
                    : "—"
                )}
                value={totals.heightMeters}
              />
            </strong>
          </div>
          <div className="running-stat">
            <span>{t("climb.falls")}</span>
            <strong>
              <MotionFigure text={needsSummary(String(totals.falls))} value={totals.falls} />
            </strong>
          </div>
        </div>

        {sessions.length > 0 ? (
          <>
            <ClimbVolumeChart
              sessions={sessions}
              sessionsAllTime={sessionsAllTime}
              summaries={summaries}
              settled={summariesSettled}
              weeks={chartWeeks}
              kinds={stackedKinds}
              nowMs={nowMs}
            />
            <div className="running-columns">
              <GradePyramidPanel
                records={records}
                families={families}
                family={shownFamily}
                onFamilyChange={setFamily}
                scales={scales}
                settled={summariesSettled}
              />
              <GradeTrendPanel
                sessions={sessions}
                records={records}
                summaries={summaries}
                family={shownFamily}
                scales={scales}
                weeks={chartWeeks}
                nowMs={nowMs}
                settled={summariesSettled}
              />
            </div>
            <div className="running-columns">
              <ClimbKindPanel sessions={sessionsInPeriod} summaries={summaries} scales={scales} settled={summariesSettled} />
              <ClimbWallPanel sessions={sessions} summaries={summaries} settled={summariesSettled} />
            </div>
          </>
        ) : null}

        {sessions.length === 0 ? (
          <section className="panel running-empty">
            <ClimbIcon size={22} aria-hidden="true" />
            <div>
              <h3>{t("climb.noneInWindow")}</h3>
              <p>{t("climb.widen")}</p>
            </div>
          </section>
        ) : (
          <div className="running-list-panel">
            <ClimbList
              sessions={sessions}
              summaries={summaries}
              scales={scales}
              sort={sort}
              onSortChange={setSort}
              onOpenSession={openClimb}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function ClimbingPageHeader() {
  return (
    <header className="running-page-header">
      <p className="running-eyebrow">{t("run.eyebrow")}</p>
      <h1>{t("nav.climbing")}</h1>
      <p>{t("climb.lead")}</p>
    </header>
  );
}
