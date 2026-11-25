import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import type {
  McpAvailability,
  StressDaySeries,
  StressHeartSnapshot,
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubSleepRecord
} from "../../electron/types";

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export interface StressHeartDaysState {
  snapshot: StressHeartSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/** Every day on file. The main process decides whether the answer costs a request. */
export function useStressHeartDays(api: HeraclesRecordsApi | null, enabled: boolean): StressHeartDaysState {
  const [snapshot, setSnapshot] = useState<StressHeartSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!api || !enabled) return;
      const mine = ++sequence.current;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await api.getStressHeartDays({ refresh });
        if (sequence.current !== mine) return;
        setSnapshot(next);
        // A fill that failed still answers with the cache.
        setError(next.error ?? null);
      } catch (caught) {
        if (sequence.current === mine) setError(messageOf(caught));
      } finally {
        if (sequence.current === mine) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, enabled]
  );

  useEffect(() => {
    if (!enabled) {
      // As `useSleepHistory`: a kept answer would read as loaded under the next load.
      sequence.current += 1;
      setSnapshot(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }
    void load(false);
  }, [enabled, load]);

  const refresh = useCallback(() => void load(true), [load]);
  return { snapshot, loading, refreshing, error, refresh };
}

export interface StressSeriesState {
  /** Every day answered so far, kept across reads. */
  byDay: ReadonlyMap<string, StressDaySeries>;
  loading: boolean;
  mcpState?: McpAvailability;
  error: string | null;
  refresh: () => void;
}

/**
 * The five-minute readings for a run of days, read once for the whole run so
 * that picking a day in it costs no round trip.
 */
export function useStressSeries(
  api: HeraclesRecordsApi | null,
  enabled: boolean,
  fromDay: string,
  toDay: string
): StressSeriesState {
  const [byDay, setByDay] = useState<ReadonlyMap<string, StressDaySeries>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [mcpState, setMcpState] = useState<McpAvailability>();
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!api || !enabled) return;
      const mine = ++sequence.current;
      setLoading(true);
      try {
        const answer = await api.getStressSeries({ fromDay, toDay, refresh });
        if (sequence.current !== mine) return;
        setByDay((current) => {
          const next = new Map(current);
          for (const day of answer.days) next.set(day.day, day);
          return next;
        });
        setMcpState(answer.mcpState);
        setError(answer.error ?? null);
      } catch (caught) {
        if (sequence.current === mine) setError(messageOf(caught));
      } finally {
        if (sequence.current === mine) setLoading(false);
      }
    },
    [api, enabled, fromDay, toDay]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => void load(true), [load]);
  return { byDay, loading, mcpState, error, refresh };
}

/**
 * The nights already on this machine, for the sleep on the day's timeline.
 * Read from the cache only: the Sleep screen and Overview keep it filled, and
 * a whole sleep fetch is not this screen's to spend.
 */
export function useCachedSleepRecords(
  api: HeraclesRecordsApi | null,
  enabled: boolean,
  days: number
): TrainingHubSleepRecord[] {
  const [records, setRecords] = useState<TrainingHubSleepRecord[]>([]);

  useEffect(() => {
    if (!api || !enabled) return undefined;
    let live = true;
    api
      .getSleepHistory({ days, cacheOnly: true })
      .then((snapshot) => {
        if (live) setRecords(snapshot.records);
      })
      .catch(() => {
        // No sleep band on the timeline; the readings stand on their own.
      });
    return () => {
      live = false;
    };
  }, [api, enabled, days]);

  return records;
}

export interface SessionDetailsState {
  /** A session's detail, `null` when it could not be read; absent while it is being read. */
  details: ReadonlyMap<string, TrainingHubActivityDetail | null>;
  /** Counts the answers so far: `details` is one map filled in place. */
  answers: number;
}

/**
 * The details of the sessions on the day on screen: their highest heart rate
 * and their own time in each heart-rate zone, which the activity list does
 * not carry. Read through the same channel opening a session uses — the copy
 * on disk when there is one, COROS otherwise — one session at a time, and kept
 * for the life of the screen, so going back to a day asks for nothing.
 */
export function useSessionDetails(
  api: HeraclesRecordsApi | null,
  sessions: readonly TrainingHubActivity[]
): SessionDetailsState {
  const known = useRef(new Map<string, TrainingHubActivityDetail | null>());
  const inFlight = useRef(new Set<string>());
  const [answers, answered] = useReducer((count: number) => count + 1, 0);
  const key = sessions.map((session) => session.activityId).join(",");

  useEffect(() => {
    if (!api) return;
    const wanted = sessions.filter(
      (session) => !known.current.has(session.activityId) && !inFlight.current.has(session.activityId)
    );
    if (wanted.length === 0) return;
    for (const session of wanted) inFlight.current.add(session.activityId);
    void (async () => {
      for (const session of wanted) {
        try {
          const detail = await api.getTrainingHubActivityDetail(session.activityId, session.sportType, session);
          known.current.set(session.activityId, detail ?? null);
        } catch {
          known.current.set(session.activityId, null);
        } finally {
          inFlight.current.delete(session.activityId);
        }
        // Filed whether or not the day is still on screen: it is the answer for that session.
        answered();
      }
    })();
    // `key` names the sessions; the array itself is rebuilt on every render.
  }, [api, key]);

  return { details: known.current, answers };
}
