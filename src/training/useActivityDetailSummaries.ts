import { useEffect, useMemo, useState } from "react";
import type { ActivityDetailSummary, TrainingHubActivity } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";

/**
 * The per-activity figures that only a detail payload knows — time in each
 * heart rate zone, and how far pace and heart rate drifted apart.
 *
 * A detail is 2.2 MB, so a list of thirty sessions cannot simply ask for thirty
 * of them. Instead the main process keeps a ~130-byte summary per activity, and this
 * reads whatever is already stored, then asks it to compute the rest a few at a
 * time, re-reading as they land so the column fills in while the athlete looks
 * at it. Nothing here waits: the screen is complete without any of it.
 */

/** Per call. Each is a payload fetch on a connection the screen may also want. */
const SUMMARY_CHUNK = 4;

/**
 * A backstop for a history nobody has met yet. Summaries are kept, so the sweep
 * is a one-off per machine — not per account: the table is `derived` and does
 * not sync, so a second computer, or this one after a restore, computes its own.
 * Either way an athlete with thousands of activities should not have their
 * first afternoon on this screen spent fetching all of them. Module-level, so
 * it bounds the session and not the mount: switching period filters must not
 * buy another allowance.
 */
const SESSION_FETCH_CAP = 300;
let fetchedThisSession = 0;

const EMPTY: ReadonlyMap<string, ActivityDetailSummary> = new Map();

/**
 * What is held, with these laid over it. Never what is held thrown away: a
 * screen that reads another set for a while — Running's run page, with the six
 * weeks before it — came back to a list whose columns and charts drew from the
 * page's few runs until the list's own read landed, a frame later.
 */
function withSummaries(
  current: ReadonlyMap<string, ActivityDetailSummary>,
  summaries: readonly ActivityDetailSummary[]
): ReadonlyMap<string, ActivityDetailSummary> {
  if (summaries.length === 0) {
    return current;
  }
  const next = new Map(current);
  for (const summary of summaries) {
    next.set(summary.activityId, summary);
  }
  return next;
}

export interface ActivityDetailSummariesInput {
  api: HeraclesRecordsApi | null;
  activities: readonly TrainingHubActivity[];
  /** False while a session's own detail is loading: that payload wants the
   *  connection, and nothing on screen is reading these meanwhile. */
  enabled: boolean;
  /** Also count a run or a ride as missing until it carries its intensity: a list whose rows wear the label. */
  requireIntensity?: boolean;
  /** Also count a road or track run as missing until it carries its performance curve. */
  requirePerformance?: boolean;
  /** Also count a swim as missing until it carries its strokes, pool and best efforts. */
  requireSwim?: boolean;
}

export function useActivityDetailSummaries({
  api,
  activities,
  enabled,
  requireIntensity = false,
  requirePerformance = false,
  requireSwim = false
}: ActivityDetailSummariesInput): ReadonlyMap<string, ActivityDetailSummary> {
  const [summaries, setSummaries] =
    useState<ReadonlyMap<string, ActivityDetailSummary>>(EMPTY);

  // Keyed by the ids themselves rather than by the array: every activity list
  // call pushes a new array holding the same activities, and an effect that restarted
  // on identity would re-sweep the list each time one arrived.
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
    if (!api || !enabled || ids.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        // Taken as a list here, inside the `try`: React runs the updater later,
        // outside it, where a reply that is no list would take the screen down.
        const stored = [...(await api.getActivityDetailSummaries(ids))];
        if (cancelled) {
          return;
        }
        setSummaries((current) => withSummaries(current, stored));

        while (!cancelled && fetchedThisSession < SESSION_FETCH_CAP) {
          const pass = await api.syncActivityDetailSummaries(
            ids,
            SUMMARY_CHUNK,
            { requireIntensity, requirePerformance, requireSwim }
          );
          // Charged before anything else: the fetches happened whether or not
          // this effect is still around to see them, and a period change tears
          // it down mid-pass often enough that charging afterwards left the cap
          // bounding nothing.
          fetchedThisSession += pass.computed + pass.failed;
          if (cancelled) {
            return;
          }

          // Merged, not re-read: a fresh read of every id after every few
          // would send the whole summary table over IPC once per pass.
          const written = [...(pass.summaries ?? [])];
          setSummaries((current) => withSummaries(current, written));

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
  }, [api, enabled, key, requireIntensity, requirePerformance, requireSwim]);

  return summaries;
}
