import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WorkoutExerciseOption, WorkoutSport } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { isStrengthStyleWorkout } from "../training/workoutSport";

/**
 * COROS's movement catalog for a sport, and the map that turns an exercise id
 * into a name.
 *
 * A strength step's own `exerciseName` is a localization key — the live
 * library answers `T1041` for a bench press — so any surface that draws a
 * strength session by name needs this. Without it every exercise falls back to
 * its step kind, which is the same word repeated down the whole session.
 *
 * Only strength and hyrox have one; every other sport answers with an empty
 * catalog rather than a request.
 *
 * **Held for the life of the window**, or until a refresh button says
 * otherwise. It is COROS's own fixed list of movements, not the athlete's, so
 * it does not change while the app is open; the main process ages its copy out
 * after an hour. The promise is cached rather than the rows, so a drawer and an
 * editor opening together share one request instead of racing two — and the day
 * drawer is opened over and over, which is the case this exists for.
 */
const catalogBySport = new Map<
  WorkoutSport,
  Promise<WorkoutExerciseOption[]>
>();

/**
 * Bumped when the athlete asks for fresh data, and read by every mounted
 * hook so they all refetch together.
 *
 * Clearing the map alone would do nothing for a drawer already on screen:
 * its effect has run, and nothing would run it again. The counter is what a
 * live surface can notice. `useSyncExternalStore` rather than a state in
 * each hook, so a refresh reaches a hook whose own component is not
 * re-rendering for any other reason.
 */
let catalogEpoch = 0;
const epochListeners = new Set<() => void>();

function subscribeToEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
}

/**
 * Forget every catalog this window holds.
 *
 * Pairs with `api.refreshWorkoutCaches()`, which does the same on the other
 * side of the bridge. Calling one without the other leaves half the staleness
 * in place: this side would re-ask and the main process would answer from
 * memory, or the main process would re-fetch and no mounted surface would
 * ever read the result.
 */
export function refreshWorkoutExerciseCatalogs(): void {
  catalogBySport.clear();
  catalogEpoch += 1;
  for (const listener of epochListeners) listener();
}

export interface WorkoutExerciseCatalog {
  options: WorkoutExerciseOption[];
  /** The same options, keyed by COROS exercise id. */
  byId: ReadonlyMap<string, WorkoutExerciseOption>;
  loading: boolean;
}

const EMPTY: WorkoutExerciseOption[] = [];

export function useWorkoutExerciseCatalog(
  api: CorosLinkApi | undefined,
  sport: WorkoutSport | undefined
): WorkoutExerciseCatalog {
  const wanted = isStrengthStyleWorkout(sport) ? sport : undefined;
  const epoch = useSyncExternalStore(
    subscribeToEpoch,
    () => catalogEpoch,
    () => catalogEpoch
  );
  const [options, setOptions] = useState<WorkoutExerciseOption[]>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!api || !wanted) {
      setOptions(EMPTY);
      setLoading(false);
      return;
    }

    let active = true;
    let pending = catalogBySport.get(wanted);
    if (!pending) {
      pending = api.listWorkoutExercises(wanted);
      catalogBySport.set(wanted, pending);
      // A catalog that could not be fetched is not an empty catalog: drop it so
      // the next surface asks again rather than reading the failure forever.
      void pending.catch(() => {
        if (catalogBySport.get(wanted) === pending) {
          catalogBySport.delete(wanted);
        }
      });
    }

    setLoading(true);
    void pending
      .then((loaded) => {
        if (active) setOptions(loaded);
      })
      .catch(() => {
        if (active) setOptions(EMPTY);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, wanted, epoch]);

  const byId = useMemo(
    () => new Map(options.map((option) => [option.id, option])),
    [options]
  );

  return { options, byId, loading };
}
