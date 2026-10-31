import { useEffect, useMemo, useState } from "react";
import { CloudOff, LockKeyhole, RefreshCw, Waves } from "lucide-react";
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
import { formatDistanceMeters, formatDurationSpan } from "../training/formatters";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { OptionGroup } from "../components/OptionGroup";
import {
  periodDaysFromValue,
  periodGroupOptions,
  periodValue,
  type PeriodDays
} from "../preferences/periodScale";
import { useHeartRateZoneModel } from "../training/useHeartRateZoneModel";
import { useActivityDetailSummariesState } from "../training/useActivityDetailSummaries";
import { useUnitSystem } from "../units/UnitSystemProvider";
import type { PrimaryView } from "../navigation/primaryNav";
import { RunningPageSkeleton } from "../running/RunningSkeleton";
import { useSessionPage, weeksForPeriod, withinPeriod } from "../running/sportPage";
import { SwimDetailView } from "./SwimDetailView";
import { DEFAULT_SWIM_SORT, SwimList, type SwimSort } from "./SwimList";
import { SwimStrokePanel } from "./SwimStrokePanel";
import { SwimTechniquePanel } from "./SwimTechniquePanel";
import { SwimVolumeChart } from "./SwimVolumeChart";
import { SwimmingHero, SWIM_HERO_DAYS } from "./SwimmingHero";
import { formatPer100, summariseSwims, swimTypesPresent, swimmingPaceOf } from "./swimMetrics";
import { SWIM_TYPE_LABELS, classifySwimType, swimsOfType, type SwimType } from "./swimType";
import "../running/running.css";
import "./swimming.css";
import { t } from "../i18n/core";

export interface SwimmingViewProps {
  api: HeraclesRecordsApi | null;
  activities: TrainingHubActivity[];
  connected: boolean;
  /** A start-up re-login in flight: signed out now, probably not in a moment. */
  restoring?: boolean;
  /** Whether `activities` has arrived — an empty list alone cannot say. */
  activitiesStatus: TrainingHubLoadStatus;
  detail: TrainingHubActivityDetail | null;
  /** Where the latest detail request stands, and which swim it was for. */
  detailRequest: TrainingHubDetailRequest | null;
  busy: string | null;
  onSelectActivity: (activity: TrainingHubActivity) => void;
  /** Reloads the COROS data after the activity list failed to arrive. */
  onRetryActivities: () => void;
  onOpenOverview: () => void;
  /** A swim another screen handed over, to be opened rather than merely listed. */
  openRequest?: SportScreenRequest | null;
  /** Taken, so the same swim is not re-opened when the athlete closes it. */
  onOpenRequestHandled?: () => void;
  /** Back on a swim handed over from another screen: that screen, again. */
  onReturn?: (view: PrimaryView) => void;
  /** Presses of this screen's rail item while it showed: back to the list. */
  railReselect?: number;
  onAskCoach?: (request: CoachOpenRequest) => void;
}

/** The scale's windows, as the other sport screens offer them — see periodScale.ts. */
const PERIOD_OPTIONS = periodGroupOptions([28, 90, 365, null]);

const DEFAULT_PERIOD_DAYS = 90;

const MS_PER_DAY = 86_400_000;

/**
 * Pool swims and open water on a screen of their own.
 *
 * Running's page built again for the water, on the same stylesheet, as
 * Cycling and Hiking were. What a swimmer reads is not what a runner does: a
 * pace per 100 metres, never per kilometre; a week in metres; and, in the
 * pool, the length — the strokes it took and the SWOLF it scored, which is
 * how a swimmer reads technique the way a runner reads cadence. Critical Swim
 * Speed stands where threshold pace does. The heart-rate intensity split and
 * the load ratio are not carried over: a wrist reads heart rate poorly in the
 * water and it runs lower there than on land, so zones set on a run band a
 * swim a zone low.
 */
export function SwimmingView({
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
}: SwimmingViewProps) {
  const { unitSystem } = useUnitSystem();
  const [swimType, setSwimType] = useState<SwimType | null>(null);
  const [periodDays, setPeriodDays] = useState<number | null>(DEFAULT_PERIOD_DAYS);
  const [sort, setSort] = useState<SwimSort>(DEFAULT_SWIM_SORT);
  const {
    pageRef,
    selected: selectedSwim,
    selectedId: selectedSwimId,
    backLabel,
    open: openSwim,
    close: closeSwim
  } = useSessionPage({
    activities,
    onSelectActivity,
    openRequest,
    onOpenRequestHandled,
    onReturn,
    railReselect,
    listLabel: t("nav.swimming")
  });

  // Pinned to the list, so "the last year" does not move under the filter.
  const nowMs = useMemo(() => Date.now(), [activities]);

  const allSwims = useMemo(() => swimsOfType(activities, null), [activities]);
  const swimsInPeriod = useMemo(
    () => withinPeriod(allSwims, periodDays, nowMs),
    [allSwims, nowMs, periodDays]
  );
  const availableTypes = useMemo(() => swimTypesPresent(swimsInPeriod), [swimsInPeriod]);
  const swims = useMemo(() => swimsOfType(swimsInPeriod, swimType), [swimsInPeriod, swimType]);
  const totals = useMemo(() => summariseSwims(swims), [swims]);
  const hasAnySwim = allSwims.length > 0;

  // Every swim of the chosen kind, whatever the period — the hero and the
  // chart's year-ago figure look back spans the period must not cut.
  const swimsAllTime = useMemo(
    () => (swimType === null ? allSwims : swimsOfType(allSwims, swimType)),
    [allSwims, swimType]
  );

  const chartWeeks = useMemo(() => weeksForPeriod(periodDays), [periodDays]);
  const stackedTypes = useMemo(
    () => (swimType === null ? availableTypes : [swimType]),
    [availableTypes, swimType]
  );

  useEffect(() => {
    if (swimType !== null && !availableTypes.includes(swimType)) {
      setSwimType(null);
    }
  }, [availableTypes, swimType]);

  // The strokes, pools and best efforts live in each swim's detail, so the
  // swims on screen are read — and the hero's twelve weeks, which a short
  // period would otherwise leave unread. No further: every swim read is a
  // payload fetched from COROS.
  const summarySwims = useMemo(() => {
    const heroFrom = (nowMs - SWIM_HERO_DAYS * MS_PER_DAY) / 1000;
    const ids = new Set(swimsInPeriod.map((activity) => activity.activityId));
    return [
      ...swimsInPeriod,
      ...allSwims.filter(
        (activity) => !ids.has(activity.activityId) && (activity.startTime ?? 0) >= heroFrom
      )
    ];
  }, [allSwims, nowMs, swimsInPeriod]);
  const { summaries, settled: summariesSettled } = useActivityDetailSummariesState({
    api,
    activities: summarySwims,
    enabled: connected && selectedSwimId === null,
    requireSwim: true
  });

  const { model: zoneModel } = useHeartRateZoneModel({ api, corosConnected: connected });

  if (!connected) {
    return (
      <section className="running-view swimming-view running-view-disconnected">
        <SwimmingPageHeader />
        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{restoring ? t("run.reconnecting") : t("common.connectFirst.title")}</h3>
            <p>{restoring ? t("swim.reconnectingBody") : t("run.connectBody")}</p>
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

  if (selectedSwim) {
    const ownDetail = detail?.activityId === selectedSwim.activityId ? detail : null;
    const detailStatus =
      detailRequest?.activityId === selectedSwim.activityId ? detailRequest.status : "pending";
    return (
      <SwimDetailView
        activity={selectedSwim}
        detail={ownDetail}
        detailStatus={detailStatus}
        onBack={closeSwim}
        backLabel={backLabel}
        onRetry={() => onSelectActivity(selectedSwim)}
        onAskCoach={onAskCoach}
        zoneFamily={zoneModel?.family}
      />
    );
  }

  if (!hasAnySwim && activitiesStatus === "pending") {
    return (
      <section className="running-view swimming-view" ref={pageRef}>
        <SwimmingPageHeader />
        <RunningPageSkeleton label={t("swim.loading")} />
      </section>
    );
  }

  if (!hasAnySwim && activitiesStatus === "failed") {
    const retrying = busy === "training-refresh";
    return (
      <section className="running-view swimming-view" ref={pageRef}>
        <SwimmingPageHeader />
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

  if (!hasAnySwim) {
    return (
      <section className="running-view swimming-view" ref={pageRef}>
        <SwimmingPageHeader />
        <section className="panel running-empty running-state-panel">
          <Waves size={22} aria-hidden="true" />
          <div>
            <h3>{t("swim.none")}</h3>
            <p>{t("swim.noneBody")}</p>
          </div>
        </section>
      </section>
    );
  }

  const pace = swimmingPaceOf(swims, summaries);
  const poolSwims = swims.filter((activity) => classifySwimType(activity.sportType) === "pool");

  return (
    <section className="running-view swimming-view" ref={pageRef}>
      <SwimmingPageHeader />

      <div className="running-controls">
        <OptionGroup
          label={t("swim.kind")}
          value={swimType ?? "all"}
          options={[
            { value: "all", label: t("common.all") },
            ...availableTypes.map((option) => ({ value: option, label: SWIM_TYPE_LABELS[option] }))
          ]}
          onChange={(next) => setSwimType(next === "all" ? null : (next as SwimType))}
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
        <SwimmingHero swims={swimsAllTime} summaries={summaries} settled={summariesSettled} nowMs={nowMs} />

        <div className="running-totals">
          <div className="running-stat">
            <span>{t("swim.swims")}</span>
            <strong>{totals.count}</strong>
          </div>
          <div className="running-stat">
            <span>{t("activity.m.distance")}</span>
            <strong>{formatDistanceMeters(totals.distance, unitSystem, true)}</strong>
          </div>
          <div className="running-stat" title={t("swim.timeTitle")}>
            <span>{t("activity.m.time")}</span>
            <strong>{formatDurationSpan(totals.duration)}</strong>
          </div>
          <div className="running-stat" title={t("swim.avgPaceTitle")}>
            <span>{t("activity.m.avgPace")}</span>
            <strong>{formatPer100(pace, unitSystem)}</strong>
          </div>
          <div className="running-stat">
            <span>{t("swim.perSwim")}</span>
            <strong>
              {totals.count > 0
                ? formatDistanceMeters(totals.distance / totals.count, unitSystem, true)
                : "—"}
            </strong>
          </div>
        </div>

        {swims.length > 0 ? (
          <>
            <SwimVolumeChart
              swims={swims}
              swimsAllTime={swimsAllTime}
              weeks={chartWeeks}
              types={stackedTypes}
              nowMs={nowMs}
            />
            {poolSwims.length > 0 ? (
              <div className="running-columns">
                <SwimTechniquePanel swims={poolSwims} summaries={summaries} settled={summariesSettled} />
                <SwimStrokePanel swims={poolSwims} summaries={summaries} settled={summariesSettled} />
              </div>
            ) : null}
          </>
        ) : null}

        {swims.length === 0 ? (
          <section className="panel running-empty">
            <Waves size={22} aria-hidden="true" />
            <div>
              <h3>{t("swim.noneInWindow")}</h3>
              <p>
                {swimType === null ? t("swim.widen") : t(`swim.noneOfType.${swimType}` as const)}
              </p>
            </div>
          </section>
        ) : (
          <div className="running-list-panel">
            <SwimList
              swims={swims}
              summaries={summaries}
              sort={sort}
              onSortChange={setSort}
              onOpenSwim={openSwim}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function SwimmingPageHeader() {
  return (
    <header className="running-page-header">
      <p className="running-eyebrow">{t("run.eyebrow")}</p>
      <h1>{t("nav.swimming")}</h1>
      <p>{t("swim.lead")}</p>
    </header>
  );
}
