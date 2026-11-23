import { useCallback, useMemo, useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import type { StressHeartDay, TrainingHubActivity } from "../../electron/types";
import { stressLevelOf } from "../../electron/stressHeartParser";
import { mcpNotice, mcpShortTextOr } from "../mcp/mcpNotice";
import { formatSleepDurationMinutes } from "../training/formatters";
import { useTodayKey } from "../training/useTodayKey";
import { useI18n } from "../i18n/useI18n";
import { DayList, type DayListRow } from "./components/DayList";
import { ScreenHeader } from "./components/ScreenHeader";
import { StressDayDetail } from "./components/StressDayDetail";
import { StressTrendPanel } from "./components/StressTrends";
import {
  DAY_LIST_DAYS,
  MINUTES_PER_SLOT,
  STRESS_LEVELS,
  clockOf,
  lastReadingSlot,
  listedDays,
  measuredMinutes,
  sessionsOnDay,
  sleepOnDay
} from "./stressHeartModel";
import { useCachedSleepRecords, useStressHeartDays, useStressSeries } from "./useStressHeart";
import "./stressHeart.css";

interface StressLevelViewProps {
  api: HeraclesRecordsApi | null;
  connected: boolean;
  activities: TrainingHubActivity[];
  onOpenOverview: () => void;
}

/**
 * Stress level: COROS's stress readings, a day at a time and by day. The
 * screen opens on today, which states no average until it is over
 * (`stressHeartModel.ts`). Every figure comes from the COROS MCP server through
 * `electron/stressHeartService.ts`; the sleep and sessions on a day's line come
 * from what this machine already holds.
 */
export function StressLevelView({ api, connected, activities, onOpenOverview }: StressLevelViewProps) {
  const { t } = useI18n();
  const today = useTodayKey();
  const listDays = useMemo(() => listedDays(today), [today]);
  const days = useStressHeartDays(api, connected);
  // One read for the month the list offers: picking a day costs no round trip.
  const series = useStressSeries(api, connected, listDays[listDays.length - 1], today);
  const sleepRecords = useCachedSleepRecords(api, connected, DAY_LIST_DAYS + 2);
  const [chosenDay, setChosenDay] = useState<string | null>(null);

  const records = useMemo(() => days.snapshot?.days ?? [], [days.snapshot]);
  const byDay = useMemo(() => new Map<string, StressHeartDay>(records.map((record) => [record.day, record])), [records]);
  const selectedDay = chosenDay && listDays.includes(chosenDay) ? chosenDay : today;
  const sleep = useMemo(() => sleepOnDay(selectedDay, sleepRecords), [selectedDay, sleepRecords]);
  const sessions = useMemo(() => sessionsOnDay(selectedDay, activities), [selectedDay, activities]);

  const mcpState = days.snapshot?.mcpState ?? series.mcpState;
  const banner = mcpNotice("stress", mcpState);
  const errors = [...new Set([days.error, series.error].filter((error): error is string => Boolean(error)))];

  const rows = useMemo(
    () =>
      listDays.map((day): DayListRow => {
        const record = byDay.get(day);
        const measured = measuredMinutes(record?.levels);
        const lastSlot = day === today ? lastReadingSlot(series.byDay.get(day)) : -1;
        const figure =
          day === today
            ? lastSlot >= 0
              ? series.byDay.get(day)?.slots[lastSlot] ?? undefined
              : undefined
            : record?.stressAvg;
        const meta =
          day === today
            ? lastSlot >= 0
              ? t("stress.list.metaToday", {
                  time: clockOf(lastSlot * MINUTES_PER_SLOT),
                  measured: formatSleepDurationMinutes(measured)
                })
              : t("stress.list.metaTodayNone")
            : measured > 0
              ? t("stress.list.meta", {
                  measured: formatSleepDurationMinutes(measured),
                  high: formatSleepDurationMinutes(record?.levels?.high ?? 0)
                })
              : t("stress.list.noReadings");
        return {
          day,
          figure: figure !== undefined ? Math.round(figure) : undefined,
          tone: figure !== undefined ? `is-${stressLevelOf(figure)}` : undefined,
          meta,
          strip:
            measured > 0 && record?.levels ? (
              <span className="stress-day-row-bar" aria-hidden="true">
                {STRESS_LEVELS.map((level) =>
                  record.levels![level.key] > 0 ? (
                    <span key={level.key} className={`is-${level.key}`} style={{ flexGrow: record.levels![level.key] }} />
                  ) : null
                )}
              </span>
            ) : undefined
        };
      }),
    [listDays, byDay, series.byDay, today, t]
  );

  const { refresh: refreshDays } = days;
  const { refresh: refreshSeries } = series;
  const refreshAll = useCallback(() => {
    refreshDays();
    refreshSeries();
  }, [refreshDays, refreshSeries]);

  if (!connected) {
    return (
      <section className="panel data-connect-panel">
        <LockKeyhole size={24} aria-hidden="true" />
        <div>
          <h3>{t("common.connectFirst.title")}</h3>
          <p>{t("stress.connectBody")}</p>
        </div>
        <button type="button" className="primary-button" onClick={onOpenOverview}>
          {t("common.openOverview")}
        </button>
      </section>
    );
  }

  return (
    <div className="stack stress-heart-view">
      <ScreenHeader
        title={t("stress.title")}
        snapshot={days.snapshot}
        loading={days.loading}
        refreshing={days.refreshing}
        refreshLabel={t("stress.refresh")}
        refreshingLabel={t("stress.refreshing")}
        onRefresh={refreshAll}
      />

      {errors.map((error) => (
        <p key={error} className="stress-details-error">
          {t("stress.corosError", { error })}
        </p>
      ))}
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
            <StressDayDetail
              day={selectedDay}
              record={byDay.get(selectedDay)}
              series={series.byDay.get(selectedDay)}
              seriesLoading={series.loading}
              sleep={sleep}
              sessions={sessions}
              isToday={selectedDay === today}
            />
          </div>
        </div>
      </section>

      {records.length > 1 ? <StressTrendPanel days={records} byDay={byDay} today={today} /> : null}
    </div>
  );
}
