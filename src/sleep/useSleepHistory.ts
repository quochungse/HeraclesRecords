import { useCallback, useEffect, useRef, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";
import type { SleepHistorySnapshot } from "../../electron/types";

/** The window the screen opens on. Wide enough for a month's shape, cheap to hold. */
export const SLEEP_HISTORY_DAYS = 30;

export interface SleepHistoryState {
  snapshot: SleepHistorySnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Owns the Sleep screen's data so `App.tsx` does not have to. The main process
 * decides whether the answer costs a request — see `sleepHistoryService` — so
 * this hook is free to ask on every mount.
 */
export function useSleepHistory(
  api: CorosLinkApi | null,
  enabled: boolean
): SleepHistoryState {
  const [snapshot, setSnapshot] = useState<SleepHistorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (!api || !enabled) {
        return;
      }

      const sequence = ++requestSequence.current;
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const next = await api.getSleepHistory({
          days: SLEEP_HISTORY_DAYS,
          refresh: forceRefresh
        });

        if (requestSequence.current !== sequence) {
          return;
        }

        setSnapshot(next);
        // A fill that failed still returns the cache, so the message rides on
        // the snapshot rather than replacing the screen with an error.
        setError(next.error ?? null);
      } catch (caught) {
        if (requestSequence.current !== sequence) {
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (requestSequence.current === sequence) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, enabled]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { snapshot, loading, refreshing, error, refresh };
}
