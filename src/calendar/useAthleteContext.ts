import { useEffect, useState } from "react";
import type { UnitSystem, WorkoutEditorContext } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";

/**
 * The account's workout context — its heart-rate anchors, threshold pace and
 * zones — for the surfaces that state a planned workout's distance and time
 * (`workoutFigures`): a heart-rate step goes only as far as COROS's arithmetic
 * on these says.
 *
 * **One read per hour, shared.** It is `/account/query`, and a plan reader, a
 * Coach card and a session view mounting together would otherwise ask three
 * times; the promise is cached rather than the answer so they share one. An
 * answer without the heart-rate anchors is not kept — signed out, or read
 * before the start-up sign-in finished, the main process answers an empty
 * account rather than failing — so the next mount asks again, and until then
 * the figures fall back to what the steps alone can say.
 */
const CONTEXT_TTL_MS = 60 * 60_000;
const cached = new Map<UnitSystem, { promise: Promise<WorkoutEditorContext | undefined>; at: number }>();
const answered = new Map<UnitSystem, WorkoutEditorContext>();

export function useAthleteContext(
  api: HeraclesRecordsApi | undefined = typeof window === "undefined" ? undefined : window.heraclesRecords,
  unitSystem: UnitSystem = "metric"
): WorkoutEditorContext | undefined {
  const [context, setContext] = useState(() => answered.get(unitSystem));
  useEffect(() => {
    if (!api) return;
    let live = true;
    let entry = cached.get(unitSystem);
    if (!entry || Date.now() - entry.at > CONTEXT_TTL_MS) {
      const forget = () => cached.delete(unitSystem);
      const promise = api.getWorkoutEditorContext(unitSystem).then(
        (value) => {
          if (value?.maxHr && value.restingHr && value.lthrBpm) answered.set(unitSystem, value);
          else forget();
          return value;
        },
        () => {
          forget();
          return undefined;
        }
      );
      entry = { promise, at: Date.now() };
      cached.set(unitSystem, entry);
    }
    void entry.promise.then((value) => {
      if (live && value) setContext(value);
    });
    return () => {
      live = false;
    };
  }, [api, unitSystem]);
  return context;
}
