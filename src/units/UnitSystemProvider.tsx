import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { UnitSystem } from "../../electron/types";
import {
  cacheTemperatureUnit,
  cacheUnitSystem,
  readCachedTemperatureUnit,
  readCachedUnitSystem,
  temperatureUnitFromCoros,
  unitSystemFromCorosUnit,
  type TemperatureUnit
} from "./units";

interface UnitSystemContextValue {
  unitSystem: UnitSystem;
  /** COROS's second display setting, and independent of the first. */
  temperatureUnit: TemperatureUnit;
  /**
   * Re-read the COROS account. The profile is served from the main process's
   * hour-long cache, so this costs no request unless `refresh` is passed —
   * which is what a save of the Measurement toggle does, the account having
   * just changed underneath that cache.
   */
  refreshUnitSystem: (options?: { refresh?: boolean }) => Promise<void>;
}

const UnitSystemContext = createContext<UnitSystemContextValue | null>(null);

/**
 * The app's units follow the COROS account, and there is no second switch.
 *
 * There used to be one: Settings → Units set this independently of the
 * account, and the Measurement toggle in Personal wrote only to COROS, with a
 * note under it saying so. Two switches for one question is one too many — an
 * athlete who sets Imperial on the screen that is about *them* has said what
 * they want, and the app answering in kilometres is not a preference being
 * honoured, it is the app disagreeing with itself. Following the account also
 * picks up a change made in the COROS app, which no switch in here ever could.
 *
 * `profile.unit` is COROS's own field: 0 metric, 1 imperial.
 */
export function UnitSystemProvider({ children }: { children: ReactNode }) {
  // The cache is what the first paint reads. Asking the main process is a
  // round trip, and every figure on the screen carries a unit, so starting at
  // a default would redraw the whole app one tick later — and would show the
  // wrong unit for that tick to exactly the athlete who changed it.
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(readCachedUnitSystem);
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(
    readCachedTemperatureUnit
  );
  const latest = useRef({ unitSystem, temperatureUnit });

  const apply = useCallback((next: UnitSystem) => {
    latest.current.unitSystem = next;
    cacheUnitSystem(next);
    setUnitSystem(next);
  }, []);

  const applyTemperature = useCallback((next: TemperatureUnit) => {
    latest.current.temperatureUnit = next;
    cacheTemperatureUnit(next);
    setTemperatureUnit(next);
  }, []);

  const refreshUnitSystem = useCallback(
    async (options?: { refresh?: boolean }) => {
      const api = window.corosLink;
      if (!api) {
        return;
      }
      try {
        const snapshot = await api.getCorosProfileSnapshot(
          options?.refresh ? { refresh: true } : undefined
        );
        const next = unitSystemFromCorosUnit(snapshot.profile.unit);
        // An account that states no unit says nothing about this machine, so
        // keep what is on screen rather than resetting to metric.
        if (next && next !== latest.current.unitSystem) {
          apply(next);
        }
        const nextTemperature = temperatureUnitFromCoros(
          snapshot.profile.temperatureUnit
        );
        if (nextTemperature && nextTemperature !== latest.current.temperatureUnit) {
          applyTemperature(nextTemperature);
        }
      } catch {
        // Signed out, offline, or COROS unreachable: the cached unit stands.
        // It is the last thing the account actually said.
      }
    },
    [apply, applyTemperature]
  );

  useEffect(() => {
    void refreshUnitSystem();
    // Signing in is when the account first becomes askable, and a restored
    // session arrives after mount, so the status change is the only signal
    // that the answer may have changed.
    return window.corosLink?.onTrainingHubSessionChanged(() => {
      void refreshUnitSystem();
    });
  }, [refreshUnitSystem]);

  const value = useMemo(
    () => ({ unitSystem, temperatureUnit, refreshUnitSystem }),
    [refreshUnitSystem, temperatureUnit, unitSystem]
  );

  return (
    <UnitSystemContext.Provider value={value}>
      {children}
    </UnitSystemContext.Provider>
  );
}

export function useUnitSystem(): UnitSystemContextValue {
  const value = useContext(UnitSystemContext);
  if (!value) {
    throw new Error("useUnitSystem must be used within UnitSystemProvider");
  }
  return value;
}
