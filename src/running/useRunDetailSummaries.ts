import { useEffect, useMemo, useState } from "react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

/**
 * The per-run figures that only an activity detail knows — time in each heart
 * rate zone, and how far pace and heart rate drifted apart.
 *
 * A detail is 2.5 MB, so a list of thirty runs cannot simply ask for thirty of
 * them. Instead the main process keeps a ~130-byte summary per run, and this
 * reads whatever is already stored, then asks it to compute the rest a few at a
 * time, re-reading as they land so the column fills in while the athlete looks
 * at it. Nothing here waits: the screen is complete without any of it.
 */

/** Per call. Each is a payload fetch on a connection the screen may also want. */
const SUMMARY_CHUNK = 4;

/**
 * A backstop for a history nobody has met yet. Summaries are permanent and they
 * sync, so the sweep is a one-off per account — but an athlete with thousands
 * of activities should not have their first afternoon on this screen spent
 * fetching all of them. Module-level, so it bounds the session and not the
 * mount: switching period filters must not buy another allowance.
 */
const SESSION_FETCH_CAP = 300;
let fetchedThisSession = 0;

const EMPTY: ReadonlyMap<string, ActivityDetailSummary> = new Map();

function toMap(
  summaries: readonly ActivityDetailSummary[]
): ReadonlyMap<string, ActivityDetailSummary> {
  return new Map(summaries.map((summary) => [summary.activityId, summary]));
}

export interface RunDetailSummariesInput {
  api: CorosLinkApi | null;
  runs: readonly TrainingHubActivity[];
  /** False while a run is open: that page wants the connection for its own
   *  payload, and nothing on screen is reading these. */
  enabled: boolean;
}

export function useRunDetailSummaries({
  api,
  runs,
  enabled
}: RunDetailSummariesInput): ReadonlyMap<string, ActivityDetailSummary> {
  const [summaries, setSummaries] =
    useState<ReadonlyMap<string, ActivityDetailSummary>>(EMPTY);

  // Keyed by the ids themselves rather than by the array: every activity list
  // call pushes a new array holding the same runs, and an effect that restarted
  // on identity would re-sweep the list each time one arrived.
  const key = useMemo(
    () =>
      runs
        .map((run) => run.activityId)
        .filter((id): id is string => Boolean(id))
        .join(","),
    [runs]
  );

  useEffect(() => {
    const ids = key.length === 0 ? [] : key.split(",");
    if (!api || !enabled || ids.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const stored = await api.getActivityDetailSummaries(ids);
        if (cancelled) {
          return;
        }
        setSummaries(toMap(stored));

        while (!cancelled && fetchedThisSession < SESSION_FETCH_CAP) {
          const pass = await api.syncActivityDetailSummaries(ids, SUMMARY_CHUNK);
          if (cancelled) {
            return;
          }
          fetchedThisSession += pass.computed;

          if (pass.computed > 0) {
            const next = await api.getActivityDetailSummaries(ids);
            if (cancelled) {
              return;
            }
            setSummaries(toMap(next));
          }

          // Nothing left, or nothing moving — a pass that computes none is
          // either done or failing, and retrying it in a loop helps neither.
          if (pass.remaining === 0 || pass.computed === 0) {
            return;
          }
        }
      } catch {
        // COROS unreachable, or the channel is not there in this build: the
        // screen keeps whatever was stored and says nothing about it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, enabled, key]);

  return summaries;
}
