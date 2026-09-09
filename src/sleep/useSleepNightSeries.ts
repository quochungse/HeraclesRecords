import { useCallback, useEffect, useRef, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";
import type { SleepNightSeries } from "../../electron/types";

export interface SleepNightSeriesState {
  series: SleepNightSeries | null;
  loading: boolean;
  error: string | null;
}

/**
 * The selected night's samples. Fetched per night rather than for the whole
 * window: COROS caps both series at seven days, so there is no bulk answer to
 * ask for, and the main process keeps each night once it has one.
 */
export function useSleepNightSeries(
  api: CorosLinkApi | null,
  happenDay: string | null
): SleepNightSeriesState {
  const [series, setSeries] = useState<SleepNightSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!api || !happenDay) {
      setSeries(null);
      return;
    }

    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);

    try {
      const next = await api.getSleepNightSeries({ happenDay });
      if (requestSequence.current !== sequence) {
        return;
      }
      setSeries(next);
      setError(next.error ?? null);
    } catch (caught) {
      if (requestSequence.current !== sequence) {
        return;
      }
      setSeries(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestSequence.current === sequence) {
        setLoading(false);
      }
    }
  }, [api, happenDay]);

  useEffect(() => {
    void load();
  }, [load]);

  return { series, loading, error };
}
