/**
 * Which load strength sessions are read in — COROS's Training Load or Heracles
 * Training Load (docs/heracles-training-load.md) — and the helpers every
 * screen reads a session's load through.
 *
 * The choice is made on the Strength screen and kept by the main process
 * (`strength.loadSource`), which needs it too: the Training Library decides a
 * plan's completion there. This keeps a copy for the first paint, as the unit
 * system does, so a launch never draws one frame in the other load.
 *
 * Only a strength session reads differently: every other sport's Heracles load
 * is COROS's, and anything COROS derives from its own load — Base Fitness,
 * Load Impact, the recommended range — is only ever set against COROS's load.
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
import type {
  HeraclesLoad,
  HeraclesLoadInfo,
  HeraclesLoadQuality,
  StrengthLoadSource
} from "../../electron/types";
import { formatCount, t } from "../i18n/core";

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

/** A session's load as the athlete reads it: Heracles's for a strength session when chosen, else COROS's. */
export function activityLoad(
  activity: { trainingLoad?: number; heraclesLoad?: HeraclesLoad },
  source: StrengthLoadSource
): number | undefined {
  return source === "heracles" && activity.heraclesLoad ? activity.heraclesLoad.value : activity.trainingLoad;
}

function qualityNote(quality: HeraclesLoadQuality | undefined): string | undefined {
  if (quality === "estimate") return t("units.load.estimate");
  if (quality === "pending") return t("units.load.pending");
  if (quality === "planned") return t("units.load.planned");
  return undefined;
}

/**
 * The hover that states both figures, so whoever reads Heracles TL always
 * sees COROS's beside it. Undefined while COROS is the chosen load, and where
 * the two agree with nothing to flag.
 */
export function loadPairTitle(
  source: StrengthLoadSource,
  heracles: number | undefined,
  coros: number | undefined,
  quality?: HeraclesLoadQuality
): string | undefined {
  if (source !== "heracles" || heracles === undefined) return undefined;
  const note = qualityNote(quality);
  const shown = Math.round(heracles);
  const corosShown = coros !== undefined ? Math.round(coros) : undefined;
  if (corosShown === shown && !note) return undefined;
  const pair =
    corosShown !== undefined
      ? t("units.load.pair", { heracles: formatCount(shown), coros: formatCount(corosShown) })
      : t("units.load.pairNoCoros", { heracles: formatCount(shown) });
  return note ? `${pair}\n${note}` : pair;
}

/** `loadPairTitle` for one session. */
export function activityLoadTitle(
  activity: { trainingLoad?: number; heraclesLoad?: HeraclesLoad },
  source: StrengthLoadSource
): string | undefined {
  return loadPairTitle(source, activity.heraclesLoad?.value, activity.trainingLoad, activity.heraclesLoad?.quality);
}
