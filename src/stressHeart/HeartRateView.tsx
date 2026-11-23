import { useMemo, useState, type CSSProperties } from "react";
import { LockKeyhole } from "lucide-react";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import type { StressHeartDay, TrainingHubActivity, TrainingHubThresholdZone } from "../../electron/types";
import { mcpNotice, mcpShortTextOr } from "../mcp/mcpNotice";
import { useTodayKey } from "../training/useTodayKey";
import { sportColorCategory } from "../training/sportColors";
import { useHeartRateZoneModel } from "../training/useHeartRateZoneModel";
import { useActivityDetailSummariesState } from "../training/useActivityDetailSummaries";
import { activityStartTimeMs } from "../training/activityWindow";
import { useI18n } from "../i18n/useI18n";
import { DayList, type DayListRow } from "./components/DayList";
import { ExerciseZonesPanel } from "./components/ExerciseZonesPanel";
import { HeartDayDetail } from "./components/HeartDayDetail";
import { HeartTrendPanel } from "./components/HeartTrends";
import { ScreenHeader } from "./components/ScreenHeader";
import {
  DAY_LIST_DAYS,
  dayDate,
  dayHeartRange,
  daysBetween,
  heartScaleAt,
  sessionsOnDay,
  shiftDay,
  sleepHeartByDay
} from "./stressHeartModel";
import { useCachedSleepRecords, useSessionDetails, useStressHeartDays } from "./useStressHeart";
import "./stressHeart.css";

interface HeartRateViewProps {
  api: HeraclesRecordsApi | null;
  connected: boolean;
  activities: TrainingHubActivity[];
  /** The dashboard's LTHR zones, for an account whose own model has not come back. */
  lthrZones: TrainingHubThresholdZone[];
  onOpenOverview: () => void;
}

/** The ladder's scale, so a row's strip is the day's ladder in small. */
const stripAt = heartScaleAt;

/**
 * Heart rate: the day's resting, average and range from COROS MCP, the heart
 * rate asleep from the nights this machine keeps, and time in the athlete's own
 * heart-rate zones from the sessions' details. COROS sends no heart rate
 * through the day, so a day is these figures, not a curve.
 */
export function HeartRateView({ api, connected, activities, lthrZones, onOpenOverview }: HeartRateViewProps) {
  const { t } = useI18n();
  const today = useTodayKey();
  const days = useStressHeartDays(api, connected);
  // Every night on file: the asleep trend reads as far back as the day trend.
  const sleepRecords = useCachedSleepRecords(api, connected, 400);
  const { model: zoneModel } = useHeartRateZoneModel({ api, corosConnected: connected });
  const [chosenDay, setChosenDay] = useState<string | null>(null);

  const records = useMemo(() => days.snapshot?.days ?? [], [days.snapshot]);
  const byDay = useMemo(() => new Map<string, StressHeartDay>(records.map((record) => [record.day, record])), [records]);
  const nights = useMemo(() => sleepHeartByDay(sleepRecords), [sleepRecords]);
  // The month, as Sleep and Stress level list it.
  const listDays = useMemo(() => daysBetween(shiftDay(today, -(DAY_LIST_DAYS - 1)), today).reverse(), [today]);
  const selectedDay = chosenDay && listDays.includes(chosenDay) ? chosenDay : today;
  const sessions = useMemo(() => sessionsOnDay(selectedDay, activities), [selectedDay, activities]);
  // Every listed day's sessions, newest first, for their highest heart rate:
  // the list COROS sends has none, so it is read once from each session's
  // detail into its stored summary (`requireHeartRate`) and from there after.
  const listFrom = listDays[listDays.length - 1];
  const listSessions = useMemo(() => {
    const from = listFrom ? dayDate(listFrom).getTime() : Number.POSITIVE_INFINITY;
    return activities
      .filter((activity) => (activityStartTimeMs(activity) ?? 0) >= from && activity.avgHr !== undefined)
      .sort((left, right) => (activityStartTimeMs(right) ?? 0) - (activityStartTimeMs(left) ?? 0));
  }, [activities, listFrom]);
  const { summaries } = useActivityDetailSummariesState({
    api,
    activities: listSessions,
    enabled: connected,
    requireHeartRate: true
  });
  const sessionActivities = useMemo(() => sessions.map((session) => session.activity), [sessions]);
  const { details, answers } = useSessionDetails(api, sessionActivities);

  const mcpState = days.snapshot?.mcpState;
  const banner = mcpNotice("heart", mcpState);

  const rows = useMemo(
    () =>
      listDays.map((day): DayListRow => {
        const record = byDay.get(day);
        const range = dayHeartRange(record);
        const resting = record?.restingHr !== undefined ? Math.round(record.restingHr) : "–";
        const meta = !range
          ? t("heart.list.noReadings")
          : day === today || record?.avgHr === undefined
            ? t("heart.list.metaToday", { resting })
            : t("heart.list.meta", { avg: Math.round(record.avgHr), resting });
        // The day's ladder in small, on its scale: the night's range, and each
        // session from its average to its highest (its stored summary's, or
        // its detail's once the day is opened); a mark at its average while
        // neither has answered yet.
        const night = nights.get(day);
        const daySessions = sessionsOnDay(day, activities).filter((session) => session.activity.avgHr !== undefined);
        return {
          day,
          // The day's lowest to highest leads the row; resting and average follow.
          figure: range ? `${Math.round(range[0])}–${Math.round(range[1])}` : undefined,
          tone: "is-plain",
          meta,
          strip: range ? (
            <span className="heart-day-row-range" aria-hidden="true">
              <i
                className="is-day"
                style={{
                  left: stripAt(range[0]),
                  width: `calc(${stripAt(range[1])} - ${stripAt(range[0])})`
                }}
              />
              {night?.minHr !== undefined && night.maxHr !== undefined ? (
                <i
                  className="is-sleep"
                  style={{
                    left: stripAt(night.minHr),
                    width: `calc(${stripAt(night.maxHr)} - ${stripAt(night.minHr)})`
                  }}
                />
              ) : null}
              {daySessions.map((session) => {
                const known = summaries.get(session.activity.activityId)?.heartRate;
                const average = known?.avg ?? session.activity.avgHr!;
                const highest = details.get(session.activity.activityId)?.maxHr ?? known?.max;
                const color = {
                  "--heart-session-color": `var(--sport-${sportColorCategory(session.activity.sportType)})`
                } as CSSProperties;
                return highest !== undefined && highest > average ? (
                  <i
                    key={session.activity.activityId}
                    className="is-session"
                    style={{ ...color, left: stripAt(average), width: `calc(${stripAt(highest)} - ${stripAt(average)})` }}
                  />
                ) : (
                  <b key={session.activity.activityId} className="is-session" style={{ ...color, left: stripAt(average) }} />
                );
              })}
            </span>
          ) : undefined
        };
      }),
    // `answers`: a session's detail arriving lets its strip reach its highest.
    [listDays, byDay, nights, activities, today, t, details, answers, summaries]
  );

  if (!connected) {
    return (
      <section className="panel data-connect-panel">
        <LockKeyhole size={24} aria-hidden="true" />
        <div>
          <h3>{t("common.connectFirst.title")}</h3>
          <p>{t("heart.connectBody")}</p>
        </div>
        <button type="button" className="primary-button" onClick={onOpenOverview}>
          {t("common.openOverview")}
        </button>
      </section>
    );
  }

  return (
    <div className="stack stress-heart-view heart-rate-view">
      <ScreenHeader
        title={t("heart.title")}
        snapshot={days.snapshot}
        loading={days.loading}
        refreshing={days.refreshing}
        refreshLabel={t("heart.refresh")}
        refreshingLabel={t("heart.refreshing")}
        onRefresh={days.refresh}
      />

      {days.error ? <p className="stress-details-error">{t("stress.corosError", { error: days.error })}</p> : null}
      {banner ? <p className="stress-details-error">{banner}</p> : null}

      <section className="panel stress-day-panel">
        <div className="stress-day-split">
          <div className="stress-day-list-pane">
            <h2 className="stress-pane-title">{t("stress.recent")}</h2>
            <div className="stress-day-list-scroll">
              <DayList
                rows={rows}
                today={today}
                selectedDay={selectedDay}
                onSelect={setChosenDay}
                ariaLabel={t("stress.list.aria")}
                empty={
                  records.length > 0
                    ? undefined
                    : days.loading
                      ? t("stress.loadingDays")
                      : mcpShortTextOr(mcpState, t("stress.list.noneShort"), t("stress.list.none"))
                }
              />
            </div>
          </div>
          <div className="stress-day-main">
            <HeartDayDetail
              day={selectedDay}
              record={byDay.get(selectedDay)}
              byDay={byDay}
              night={nights.get(selectedDay)}
              sessions={sessions}
              details={details}
              summaries={summaries}
              accountFamily={zoneModel?.family}
              isToday={selectedDay === today}
            />
          </div>
        </div>
      </section>

      {records.length > 1 ? <HeartTrendPanel days={records} byDay={byDay} today={today} /> : null}

      <ExerciseZonesPanel api={api} activities={activities} zoneModel={zoneModel} lthrZones={lthrZones} />
    </div>
  );
}
