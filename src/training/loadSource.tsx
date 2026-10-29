/**
 * Which load strength sessions are read in — COROS's Training Load or Heracles
 * Training Load (docs/heracles-training-load.md). The figures themselves are
 * read through `loadFigures.ts`.
 *
 * The choice is made on the Strength screen and kept by the main process
 * (`strength.loadSource`), which needs it too: the Training Library decides a
 * plan's completion there. This keeps a copy for the first paint, as the unit
 * system does, so a launch never draws one frame in the other load.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { HeraclesLoadInfo, StrengthLoadSource } from "../../electron/types";

const CACHE_KEY = "heraclesrecords.loadSource";

function readCachedSource(): StrengthLoadSource {
  try {
    return localStorage.getItem(CACHE_KEY) === "heracles" ? "heracles" : "coros";
  } catch {
    return "coros";
  }
}

function cacheSource(source: StrengthLoadSource): void {
  try {
    localStorage.setItem(CACHE_KEY, source);
  } catch {
    // The setting itself lives in the main process; only the first paint misses it.
  }
}

interface LoadSourceContextValue {
  source: StrengthLoadSource;
  /** What the figures are read with; undefined until the main process has answered. */
  info?: HeraclesLoadInfo;
  setSource: (source: StrengthLoadSource) => Promise<void>;
}

// Outside the provider — a renderer suite mounting one screen — every load is COROS's.
const LoadSourceContext = createContext<LoadSourceContextValue>({
  source: "coros",
  setSource: async () => undefined
});

export function LoadSourceProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<StrengthLoadSource>(readCachedSource);
  const [info, setInfo] = useState<HeraclesLoadInfo>();

  const apply = useCallback((next: HeraclesLoadInfo) => {
    cacheSource(next.source);
    setSourceState(next.source);
    setInfo(next);
  }, []);

  const refresh = useCallback(async () => {
    const api = window.heraclesRecords;
    if (!api) return;
    try {
      apply(await api.getStrengthLoadSource());
    } catch {
      // Unreadable for now: the cached choice stands.
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
    // The setting travels between machines, and a pull that carried only
    // settings names no table, so any pull is a reason to ask again.
    return window.heraclesRecords?.onSyncChanged(() => void refresh());
  }, [refresh]);

  const setSource = useCallback(
    async (next: StrengthLoadSource) => {
      cacheSource(next);
      setSourceState(next);
      const api = window.heraclesRecords;
      if (!api) return;
      try {
        apply(await api.setStrengthLoadSource(next));
      } catch {
        void refresh();
      }
    },
    [apply, refresh]
  );

  const value = useMemo(() => ({ source, info, setSource }), [info, setSource, source]);
  return <LoadSourceContext.Provider value={value}>{children}</LoadSourceContext.Provider>;
}

export function useLoadSource(): LoadSourceContextValue {
  return useContext(LoadSourceContext);
}
