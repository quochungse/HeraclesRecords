import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TrainingHubActivity,
  TrainingHubDailyMetric,
  TrainingHubScheduledWorkoutEntry
} from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { happenDayFromTimestamp } from "../training/formatters";
import { useLoadSource } from "../training/loadSource";
import { fitnessInLoadSource, weekRangeInLoadSource } from "../../electron/heraclesFitness";
import { useTodayKey } from "../training/useTodayKey";
import {
  moveScheduledWorkoutEntries,
  type CalendarDragPayload
} from "./calendarDrag";
import type { CalendarDay, CalendarWeek } from "./calendarTypes";
import { computeWeeklyStats, pairPlannedWithActual } from "./pairing";

interface CalendarRangeData {
  /**
   * The range this was read for. Paging to a range with nothing cached keeps
   * the previous range's data on screen until the new one lands, so "is there
   * data" is not the same question as "has the range on screen been read".
   */
  rangeKey: string;
  rangeStart: string;
  rangeEnd: string;
  scheduled: TrainingHubScheduledWorkoutEntry[];
  activities: TrainingHubActivity[];
  metrics: TrainingHubDailyMetric[];
  /** Raw week aggregates from /analyse/dayDetail (recommended TL band per week). */
  weekAggregates: Record<string, unknown>[];
}

interface UseCalendarDataOptions {
  api: HeraclesRecordsApi | undefined;
  authenticated: boolean;
  /** Rows of 7 dateKeys covering the visible range. */
  weekKeys: string[][];
  /** External bump (e.g. coach uploaded a plan) forcing a refetch. */
  refreshToken: number;
  isInMonth: (dateKey: string) => boolean;
}

/**
 * Ranges already read, held for the life of the window rather than the screen.
 *
 * The cache used to be a ref inside the hook, and the screen unmounts whenever
 * the athlete leaves it — so every visit to Calendar started from nothing and
 * waited on three COROS reads (measured 2026-09-30: ~0.4 s on a warm
 * connection, ~1.6 s on a cold one) before a single day was drawn. Held here,
 * a return paints at once and the same reads run behind it, so nothing is
 * ever shown for longer than one round trip past its last read.
 *
 * Keyed by the bridge object, so two harness mounts with two stubbed APIs do
 * not read each other's months. Cleared on sign-out, which is also the only way
 * one window moves between COROS accounts.
 */
const MAX_CACHED_RANGES = 12;
const rangeCaches = new WeakMap<HeraclesRecordsApi, Map<string, CalendarRangeData>>();

function rangeCacheFor(api: HeraclesRecordsApi): Map<string, CalendarRangeData> {
  let cache = rangeCaches.get(api);
  if (!cache) {
    cache = new Map();
    rangeCaches.set(api, cache);
  }
  return cache;
}

/**
 * A read that covers the range asked for — its own, or a wider one. A week
 * inside a month already read needs nothing more: `weeks` looks days up by
 * key, so the month's rows outside the week are simply never reached.
 */
function cachedRange(
  cache: Map<string, CalendarRangeData>,
  rangeKey: string,
  rangeStart: string,
  rangeEnd: string
): CalendarRangeData | undefined {
  const exact = cache.get(rangeKey);
  if (exact) {
    // Re-inserted, so the map's order is the order of last use.
    cache.delete(rangeKey);
    cache.set(rangeKey, exact);
    return exact;
  }
  for (const entry of cache.values()) {
    if (entry.rangeStart <= rangeStart && entry.rangeEnd >= rangeEnd) {
      return { ...entry, rangeKey, rangeStart, rangeEnd };
    }
  }
  return undefined;
}

function storeRange(
  cache: Map<string, CalendarRangeData>,
  entry: CalendarRangeData
): void {
  cache.delete(entry.rangeKey);
  cache.set(entry.rangeKey, entry);
  while (cache.size > MAX_CACHED_RANGES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function useCalendarData({
  api,
  authenticated,
  weekKeys,
  refreshToken,
  isInMonth
}: UseCalendarDataOptions) {
  const { unitSystem } = useUnitSystem();
  const { source: loadSource } = useLoadSource();
  const todayKey = useTodayKey();
  const dateKeys = useMemo(() => weekKeys.flat(), [weekKeys]);
  const rangeStart = dateKeys[0];
  const rangeEnd = dateKeys[dateKeys.length - 1];
  const rangeKey = `${rangeStart}-${rangeEnd}`;

  const [data, setData] = useState<CalendarRangeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const rangeKeyRef = useRef(rangeKey);
  rangeKeyRef.current = rangeKey;

  useEffect(() => {
    if (!api || !authenticated || !rangeStart || !rangeEnd) {
      if (api && !authenticated) {
        rangeCacheFor(api).clear();
      }
      setData(null);
      return;
    }

    let cancelled = false;
    const cache = rangeCacheFor(api);
    const cached = cachedRange(cache, rangeKey, rangeStart, rangeEnd);
    if (cached) {
      setData(cached);
    }
    setLoading(!cached);
    setError(null);

    const keysForRange = [...dateKeys];
    void Promise.all([
      api.listScheduledWorkouts(rangeStart, rangeEnd),
      api.listTrainingHubActivities(1, 200, rangeStart, rangeEnd),
      api.getDailyMetrics(keysForRange)
    ])
      .then(([scheduled, activities, dailyMetrics]) => {
        if (cancelled || rangeKeyRef.current !== rangeKey) {
          return;
        }
        const next: CalendarRangeData = {
          rangeKey,
          rangeStart,
          rangeEnd,
          scheduled,
          activities,
          metrics: dailyMetrics.dayList ?? [],
          weekAggregates: dailyMetrics.weekList ?? []
        };
        storeRange(cache, next);
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

  /* Every range goes, not only the one on screen: a write to a week also
     changes the month holding it, which would otherwise answer for that week
     the next time it is shown. */
  const reload = useCallback(() => {
    if (api) {
      rangeCacheFor(api).clear();
    }
    setVersion((current) => current + 1);
  }, [api]);

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
    // Load Impact, Base Fitness and the load ratio in the chosen load.
    for (const metric of fitnessInLoadSource(data?.metrics ?? [], loadSource)) {
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
          loadSource
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
      const range = weekRangeInLoadSource(aggregate, loadSource);
      const round = (value: number | undefined) => (value !== undefined ? Math.round(value) : undefined);

      return {
        key: weekKey,
        days,
        stats: {
          ...computeWeeklyStats(days, loadSource),
          recommendedLoadMin: round(range.min),
          recommendedLoadMax: round(range.max),
          recommendedCorosLoadMin: round(range.corosMin),
          recommendedCorosLoadMax: round(range.corosMax)
        }
      };
    });
  }, [data, weekKeys, isInMonth, todayKey, unitSystem, loadSource]);

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
