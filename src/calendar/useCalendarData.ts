import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { getLocalHappenDayKey, happenDayFromTimestamp } from "../training/formatters";
import {
  moveScheduledWorkoutEntries,
  type CalendarDragPayload
} from "./calendarDrag";
import type { CalendarDay, CalendarWeek } from "./calendarTypes";
import {
  computeWeeklyStats,
  pairPlannedWithActual,
  type PairingOverride
} from "./pairing";
import { scheduledWorkoutKey } from "./calendarTypes";

interface CalendarRangeData {
  /**
   * The range this was read for. Paging to a range with nothing cached keeps
   * the previous range's data on screen until the new one lands, so "is there
   * data" is not the same question as "has the range on screen been read".
   */
  rangeKey: string;
  scheduled: TrainingHubScheduledWorkoutEntry[];
  activities: TrainingHubActivity[];
  /**
   * What the athlete said by hand about a planned session — this one was
   * really that activity, or it was skipped. Stored locally, so reading them
   * costs no COROS request; without them the calendar's own greedy pairing
   * would silently overrule an override made on the day panel.
   */
  overrides: Map<string, PairingOverride>;
  metrics: TrainingHubDailyMetric[];
  /** Raw week aggregates from /analyse/dayDetail (recommended TL band per week). */
  weekAggregates: Record<string, unknown>[];
}

interface UseCalendarDataOptions {
  api: CorosLinkApi | undefined;
  authenticated: boolean;
  /** Rows of 7 dateKeys covering the visible range. */
  weekKeys: string[][];
  /** External bump (e.g. coach uploaded a plan) forcing a refetch. */
  refreshToken: number;
  isInMonth: (dateKey: string) => boolean;
}

/**
 * Today's date key, re-read when the calendar day turns over.
 *
 * The app is left open overnight — it is a desktop app an athlete keeps in a
 * window — and every "is this in the past" question on this screen was answered
 * from a key read once. Yesterday kept its Today ring, today read as a future
 * day, and the drag guard went on refusing a day that had since become valid.
 * The timer is set to the next local midnight rather than an interval, so it
 * fires once per day and costs nothing in between.
 *
 * It re-arms off a counter, not off the key. A firing that reads back the same
 * key — the clock stepped, the timer came in early, the machine woke a moment
 * before midnight — changes no state, so an effect keyed on the key would not
 * re-run and nothing would ever schedule the next midnight again. The counter
 * always changes, so the loop cannot end in a way that leaves the screen stuck
 * on a date it read once.
 */
function useTodayKey(): string {
  const [todayKey, setTodayKey] = useState(() => getLocalHappenDayKey());
  const [rollover, setRollover] = useState(0);

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    );
    const timer = window.setTimeout(
      () => {
        setTodayKey(getLocalHappenDayKey());
        setRollover((current) => current + 1);
      },
      // A second past midnight, so the new key is certainly the new day.
      Math.max(1_000, nextMidnight.getTime() - now.getTime() + 1_000)
    );
    return () => window.clearTimeout(timer);
  }, [rollover]);

  return todayKey;
}

export function useCalendarData({
  api,
  authenticated,
  weekKeys,
  refreshToken,
  isInMonth
}: UseCalendarDataOptions) {
  const { unitSystem } = useUnitSystem();
  const todayKey = useTodayKey();
  const dateKeys = useMemo(() => weekKeys.flat(), [weekKeys]);
  const rangeStart = dateKeys[0];
  const rangeEnd = dateKeys[dateKeys.length - 1];
  const rangeKey = `${rangeStart}-${rangeEnd}`;

  const [data, setData] = useState<CalendarRangeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const cacheRef = useRef(new Map<string, CalendarRangeData>());
  const rangeKeyRef = useRef(rangeKey);
  rangeKeyRef.current = rangeKey;

  useEffect(() => {
    if (!api || !authenticated || !rangeStart || !rangeEnd) {
      setData(null);
      return;
    }

    let cancelled = false;
    const cached = cacheRef.current.get(rangeKey);
    if (cached) {
      setData(cached);
    }
    setLoading(!cached);
    setError(null);

    const keysForRange = [...dateKeys];
    void Promise.all([
      api.listScheduledWorkouts(rangeStart, rangeEnd),
      api.listTrainingHubActivities(1, 200, rangeStart, rangeEnd),
      api.getDailyMetrics(keysForRange),
      // Local read, so it adds no round trip and cannot fail the range.
      api.listTrainingActivityMatches().catch(() => [])
    ])
      .then(([scheduled, activities, dailyMetrics, matches]) => {
        if (cancelled || rangeKeyRef.current !== rangeKey) {
          return;
        }
        const overrides = new Map<string, PairingOverride>();
        for (const match of matches) {
          if (!match.manual) continue;
          const key = scheduledWorkoutKey({
            planId: match.schedulePlanId,
            idInPlan: match.scheduleIdInPlan
          });
          if (match.status === "skipped") {
            overrides.set(key, { kind: "skipped" });
          } else if (match.activityId) {
            overrides.set(key, { kind: "activity", activityId: match.activityId });
          } else {
            overrides.set(key, { kind: "none" });
          }
        }
        const next: CalendarRangeData = {
          rangeKey,
          scheduled,
          activities,
          overrides,
          metrics: dailyMetrics.dayList ?? [],
          weekAggregates: dailyMetrics.weekList ?? []
        };
        cacheRef.current.set(rangeKey, next);
        setData(next);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled || rangeKeyRef.current !== rangeKey) {
          return;
        }
        setLoading(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, authenticated, rangeKey, refreshToken, version]);

  const reload = useCallback(() => {
    cacheRef.current.delete(rangeKeyRef.current);
    setVersion((current) => current + 1);
  }, []);

  /**
   * Move a scheduled entry to another day in local state only, so a drag lands
   * instantly; callers must reload() after the API call settles (or fails).
   */
  const applyOptimisticMove = useCallback(
    (entry: CalendarDragPayload, newHappenDay: string) => {
      setData((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          scheduled: moveScheduledWorkoutEntries(
            current.scheduled,
            entry,
            newHappenDay
          )
        };
      });

      return () => {
        setData((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            scheduled: moveScheduledWorkoutEntries(
              current.scheduled,
              { ...entry, happenDay: newHappenDay },
              entry.happenDay
            )
          };
        });
      };
    },
    []
  );

  const weeks = useMemo<CalendarWeek[]>(() => {
    const scheduledByDay = new Map<string, TrainingHubScheduledWorkoutEntry[]>();
    const activitiesByDay = new Map<string, TrainingHubActivity[]>();
    const metricByDay = new Map<string, TrainingHubDailyMetric>();

    for (const entry of data?.scheduled ?? []) {
      const list = scheduledByDay.get(entry.happenDay) ?? [];
      list.push(entry);
      scheduledByDay.set(entry.happenDay, list);
    }
    for (const activity of data?.activities ?? []) {
      const key = happenDayFromTimestamp(activity.startTime);
      if (!key) {
        continue;
      }
      const list = activitiesByDay.get(key) ?? [];
      list.push(activity);
      activitiesByDay.set(key, list);
    }
    for (const metric of data?.metrics ?? []) {
      metricByDay.set(metric.happenDay, metric);
    }

    return weekKeys.map((row) => {
      const days: CalendarDay[] = row.map((dateKey) => {
        const scheduled = (scheduledByDay.get(dateKey) ?? []).sort(
          (left, right) => (left.sortNo ?? 0) - (right.sortNo ?? 0)
        );
        const activities = (activitiesByDay.get(dateKey) ?? []).sort(
          (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
        );
        const { pairs, unplanned } = pairPlannedWithActual(
          scheduled,
          activities,
          unitSystem,
          data?.overrides
        );
        return {
          dateKey,
          inMonth: isInMonth(dateKey),
          isToday: dateKey === todayKey,
          isPast: dateKey < todayKey,
          scheduled,
          activities,
          metric: metricByDay.get(dateKey),
          pairs,
          unplannedActivities: unplanned
        };
      });

      const weekKey = row[0]!;
      const aggregate = (data?.weekAggregates ?? []).find(
        (candidate) => String(candidate.firstDayOfWeek ?? "") === weekKey
      );
      const recommendedMin = Number(aggregate?.recomendTlMin);
      const recommendedMax = Number(aggregate?.recomendTlMax);

      return {
        key: weekKey,
        days,
        stats: {
          ...computeWeeklyStats(days),
          recommendedLoadMin: Number.isFinite(recommendedMin)
            ? Math.round(recommendedMin)
            : undefined,
          recommendedLoadMax: Number.isFinite(recommendedMax)
            ? Math.round(recommendedMax)
            : undefined
        }
      };
    });
  }, [data, weekKeys, isInMonth, todayKey, unitSystem]);

  /*
   * Whether the range on screen has been read at least once. `loading` cannot
   * answer that: it is false for the renders before the effect that raises it,
   * and it goes up again on every reload of a range already on screen. An
   * empty week may only say so once this is true — before that, "nothing
   * planned" is a statement about a request that has not come back.
   */
  const rangeLoaded = data?.rangeKey === rangeKey;

  return { weeks, loading, rangeLoaded, error, reload, applyOptimisticMove, todayKey };
}
