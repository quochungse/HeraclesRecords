import { useEffect, useMemo, useState } from "react";
import type { TrainingHubActivity } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

/**
 * The end-of-activity feeling COROS holds for each session, read from this
 * machine's mirror.
 *
 * It is the input to every RPE figure in the app — `rpeLoad` turns a 1..5
 * feeling into a Foster CR10 session load, and the load heatmap draws it — and
 * until now no screen showed it at all.
 *
 * Nothing here fetches from COROS: the RPE backfill owns that, and this is a
 * SQLite read of what the backfill has already stored. A row the backfill has
 * not reached is simply absent, which is why this is a map rather than a
 * three-state answer: the screen draws a face where there is a rating and
 * nothing where there is not, and "not looked at yet" and "looked at, unrated"
 * are the same nothing to it.
 */
export type ActivityFeelMap = ReadonlyMap<string, number>;

const EMPTY: ActivityFeelMap = new Map();

/**
 * Pass the *whole* history rather than the filtered list: the read is keyed on
 * the ids, so filtering on a narrower set would re-read on every keystroke.
 */
export function useActivityFeelTypes(
  api: CorosLinkApi | null | undefined,
  activities: readonly TrainingHubActivity[]
): ActivityFeelMap {
  const [feels, setFeels] = useState<Record<string, number>>({});

  // Keyed by the ids themselves rather than by the array: every activity list
  // call pushes a new array holding the same activities, and an effect that
  // restarted on identity would re-read on each one.
  const key = useMemo(
    () =>
      activities
        .map((activity) => activity.activityId)
        .filter((id): id is string => Boolean(id))
        .join(","),
    [activities]
  );

  useEffect(() => {
    const ids = key.length === 0 ? [] : key.split(",");
    if (!api || ids.length === 0) {
      return;
    }

    let cancelled = false;
    void api
      .getActivityFeelTypes(ids)
      .then((result) => {
        if (!cancelled) {
          setFeels(result);
        }
      })
      // A feeling is a badge on a row; a failed read leaves the badges off
      // rather than taking the list down with it.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [api, key]);

  return useMemo(() => {
    const rating = new Map<string, number>();
    for (const [activityId, feel] of Object.entries(feels)) {
      if (feel >= 1 && feel <= 5) {
        rating.set(activityId, feel);
      }
    }

    return rating.size === 0 ? EMPTY : rating;
  }, [feels]);
}

/** What COROS's five smileys mean. */
export const FEEL_LABELS: Record<number, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Moderate",
  4: "Hard",
  5: "Very hard"
};
