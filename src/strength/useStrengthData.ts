import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HevyStatus,
  StrengthDataSource,
  StrengthSession
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";
import { buildSampleStrengthSessions } from "./sampleSessions";
import {
  buildStrengthAnalytics,
  type StrengthAnalytics
} from "./strengthAnalytics";

export const WINDOW_OPTIONS = [
  { days: 30, label: "30 days", phrase: "the last 30 days" },
  { days: 90, label: "3 months", phrase: "the last 3 months" },
  { days: 180, label: "6 months", phrase: "the last 6 months" },
  { days: 365, label: "1 year", phrase: "the last year" }
];

export const STRENGTH_DAYS_PREFERENCE = defineSelectionPreference<number>({
  key: "strength.days",
  defaultValue: 90,
  validate: selectionIsOneOf([30, 90, 180, 365])
});

export const STRENGTH_SOURCE_PREFERENCE =
  defineSelectionPreference<StrengthDataSource>({
    key: "strength.source",
    defaultValue: "combined",
    validate: selectionIsOneOf(["combined", "hevy", "coros"])
  });

/** Chunks are drained in a loop; this caps a runaway backfill. */
const MAX_SYNC_ROUNDS = 60;

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function activeStrengthWindow(days: number) {
  return WINDOW_OPTIONS.find((option) => option.days === days) ?? WINDOW_OPTIONS[1]!;
}

interface UseStrengthDataOptions {
  api: CorosLinkApi;
  corosConnected: boolean;
  /** Dev view unlocks the generated sample history; leaving it drops the preview. */
  showDevelopmentTools?: boolean;
}

export interface StrengthData {
  days: number;
  setDays: (days: number) => void;
  source: StrengthDataSource;
  setSource: (source: StrengthDataSource) => void;
  hevyStatus: HevyStatus | null;
  hevyStatusLoading: boolean;
  hevyConnected: boolean;
  anyConnected: boolean;
  sessions: StrengthSession[];
  analytics: StrengthAnalytics;
  loading: boolean;
  pending: number;
  error: string | null;
  warnings: string[];
  sampleMode: boolean;
  setSampleMode: (sampleMode: boolean) => void;
  runSync: (force: boolean) => Promise<void>;
  /** Hevy account writes. They throw, so callers own their own error surface. */
  connectHevy: (apiKey: string) => Promise<void>;
  setHevyWarmups: (includeWarmups: boolean) => Promise<void>;
  disconnectHevy: () => Promise<void>;
}

/**
 * Owns the strength history: which window and source it is read for, the Hevy
 * account it may come from, the drain loop that fills it in, and the analytics
 * built off it. Shared so the Strength screen and the Overview's Strength
 * Distribution section read the same sessions under the same preferences.
 */
export function useStrengthData({
  api,
  corosConnected,
  showDevelopmentTools = false
}: UseStrengthDataOptions): StrengthData {
  const [days, setDays] = useSelectionPreference(STRENGTH_DAYS_PREFERENCE);
  const [source, setSource, sourcePreference] = useSelectionPreference(
    STRENGTH_SOURCE_PREFERENCE
  );
  const [hevyStatus, setHevyStatus] = useState<HevyStatus | null>(null);
  const [hevyStatusLoading, setHevyStatusLoading] = useState(true);
  const [loadedSessions, setLoadedSessions] = useState<StrengthSession[]>([]);
  const [sampleMode, setSampleMode] = useState(false);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const syncSequenceRef = useRef(0);
  const sourceInitializedRef = useRef(sourcePreference.restored);
  const hevyConnected = Boolean(hevyStatus?.connected);
  const anyConnected = corosConnected || hevyConnected;

  useEffect(() => {
    let active = true;
    setHevyStatusLoading(true);
    api
      .getHevyStatus()
      .then((next) => {
        if (!active) return;
        setHevyStatus(next);
        if (!sourceInitializedRef.current) {
          sourceInitializedRef.current = true;
          setSource(
            corosConnected && next.connected
              ? "combined"
              : next.connected
                ? "hevy"
                : "coros"
          );
        }
      })
      .catch((caught) => {
        if (!active) return;
        setHevyStatus({ connected: false, includeWarmups: false });
        sourceInitializedRef.current = true;
        setSource("coros");
        setError(toErrorMessage(caught));
      })
      .finally(() => {
        if (active) setHevyStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, corosConnected]);

  useEffect(() => {
    if (hevyStatus === null) return;
    setSource((current) => {
      if (current === "combined" && corosConnected && hevyConnected) return current;
      if (current === "coros" && corosConnected) return current;
      if (current === "hevy" && hevyConnected) return current;
      return corosConnected && hevyConnected
        ? "combined"
        : hevyConnected
          ? "hevy"
          : "coros";
    });
  }, [corosConnected, hevyConnected, hevyStatus]);

  const runSync = useCallback(
    async (force: boolean) => {
      if (hevyStatusLoading || !anyConnected) {
        return;
      }

      const sequence = ++syncSequenceRef.current;
      setLoading(true);
      setError(null);
      setWarnings([]);

      try {
        let result = await api.syncStrengthHistory({ days, force, source });
        if (syncSequenceRef.current !== sequence) {
          return;
        }
        setLoadedSessions(result.sessions);
        setPending(result.pending);
        setWarnings(result.warnings ?? []);

        // Keep draining while COROS still owes us breakdowns; each round
        // repaints the body map so it fills in as the history arrives.
        for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
          if (result.pending <= 0) {
            break;
          }
          const next = await api.syncStrengthHistory({
            days,
            force: false,
            source
          });
          if (syncSequenceRef.current !== sequence) {
            return;
          }
          setLoadedSessions(next.sessions);
          setPending(next.pending);
          setWarnings(next.warnings ?? []);
          // A round that fetched nothing means the API is refusing; stop
          // instead of spinning against it.
          if (next.fetched === 0) {
            break;
          }
          result = next;
        }
      } catch (caught) {
        if (syncSequenceRef.current === sequence) {
          setError(toErrorMessage(caught));
        }
      } finally {
        if (syncSequenceRef.current === sequence) {
          setLoading(false);
          if (source !== "coros") {
            void api.getHevyStatus().then(setHevyStatus).catch(() => undefined);
          }
        }
      }
    },
    [api, anyConnected, days, hevyStatusLoading, source]
  );

  useEffect(() => {
    void runSync(false);
    return () => {
      syncSequenceRef.current += 1;
    };
  }, [runSync]);

  // Leaving dev view drops the preview, so generated data can never linger in
  // the production view.
  useEffect(() => {
    if (!showDevelopmentTools) {
      setSampleMode(false);
    }
  }, [showDevelopmentTools]);

  const connectHevy = useCallback(
    async (apiKey: string) => {
      const next = await api.connectHevy(apiKey);
      setHevyStatus(next);
      setSource(corosConnected ? "combined" : "hevy");
    },
    [api, corosConnected]
  );

  const setHevyWarmups = useCallback(
    async (includeWarmups: boolean) => {
      const next = await api.updateHevySettings({ includeWarmups });
      setHevyStatus(next);
      await runSync(false);
    },
    [api, runSync]
  );

  const disconnectHevy = useCallback(async () => {
    syncSequenceRef.current += 1;
    await api.disconnectHevy();
    setHevyStatus({ connected: false, includeWarmups: false });
    setLoadedSessions([]);
    setWarnings([]);
    setPending(0);
    setSource(corosConnected ? "coros" : "hevy");
  }, [api, corosConnected]);

  // Sample mode swaps in a generated history so the page can be worked on
  // without a populated account; nothing about it touches the API or the cache.
  const sessions = useMemo(
    () => (sampleMode ? buildSampleStrengthSessions(days) : loadedSessions),
    [sampleMode, days, loadedSessions]
  );

  const analytics = useMemo(
    () => buildStrengthAnalytics(sessions, days),
    [sessions, days]
  );

  return {
    days,
    setDays,
    source,
    setSource,
    hevyStatus,
    hevyStatusLoading,
    hevyConnected,
    anyConnected,
    sessions,
    analytics,
    loading,
    pending,
    error,
    warnings,
    sampleMode,
    setSampleMode,
    runSync,
    connectHevy,
    setHevyWarmups,
    disconnectHevy
  };
}
