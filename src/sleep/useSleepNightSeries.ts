import { useCallback, useEffect, useRef, useState } from "react";
import { isLastNightHappenDay } from "./sleepFreshness";
import type { CorosLinkApi } from "../coroslink-api";
import type { SleepNightSeries } from "../../electron/types";

/**
 * Whether an answer is the night's, or only what could be said this minute.
 *
 * Mirrors the main process's own `worthKeeping` — samples, or any answer for a
 * night that is over — with one case taken off the end that the main process
 * never reaches: an answer given while **COROS was unreachable**, which it
 * returns before it gets as far as deciding what to keep. That one arrives
 * empty like a settled night with no samples, so remembering it left a night
 * looked at during a reconnect reading "no overnight samples" for the life of
 * the screen, with only Refresh — on that night, while it is selected — able
 * to undo it.
 *
 * It is deliberately **not** keyed on `error`. "This night has no sleep window"
 * is a permanent fact about a day the athlete only napped, the main process
 * caches it, and refusing it here put the loading flash back on exactly that
 * day, on every click.
 */
function worthKeeping(happenDay: string, series: SleepNightSeries): boolean {
  if (series.hrv.length > 0 || series.stress.length > 0) {
    return true;
  }

  return series.mcpState === "ready" && !isLastNightHappenDay(happenDay);
}

export interface SleepNightSeriesState {
  series: SleepNightSeries | null;
  loading: boolean;
  error: string | null;
  /** Re-asks COROS for this night, past every freshness check. */
  refresh: () => void;
}

/**
 * The selected night's samples. Fetched per night rather than for the whole
 * window: COROS caps both series at seven days, so there is no bulk answer to
 * ask for, and the main process keeps each night once it has one.
 *
 * **A night this screen has already seen is answered from here, not over the
 * bridge.** The main process serves a settled night out of `sleep_night_series`
 * in a few milliseconds, so the round trip cost nothing but a frame — and that
 * frame was the whole problem: `loading` went up before the reply landed, the
 * curve swapped for "Loading the night…", and the detail pane collapsed 156px
 * and sprang back on *every* click, including a click back onto the night that
 * had just been on screen. Measured at 7–12 ms of collapse per selection.
 *
 * What is kept mirrors the main process's own `worthKeeping` — see the
 * function of that name below, and the two answers it refuses.
 */
export function useSleepNightSeries(
  api: CorosLinkApi | null,
  happenDay: string | null
): SleepNightSeriesState {
  const [series, setSeries] = useState<SleepNightSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  // A ref rather than a module-level map on purpose: the nights in it belong to
  // the COROS account that fetched them, and a cache that outlives the screen
  // would have to be told about a sign-out to stay honest. This one cannot go
  // stale — it dies with the screen.
  const answered = useRef(new Map<string, SleepNightSeries>());

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (!api || !happenDay) {
        setSeries(null);
        return;
      }

      if (forceRefresh) {
        answered.current.delete(happenDay);
      }

      const sequence = ++requestSequence.current;
      const known = forceRefresh ? undefined : answered.current.get(happenDay);

      if (known) {
        // Bumping the sequence above is what makes this safe: a request still
        // in the air for another night cannot land on top of this answer.
        setSeries(known);
        setError(known.error ?? null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const next = await api.getSleepNightSeries({
          happenDay,
          refresh: forceRefresh
        });
        // Kept before the sequence check, not after: the answer is filed under
        // the night it is for, so a night the athlete clicked past is still the
        // answer for that night and throwing it away only buys a second fetch.
        if (worthKeeping(happenDay, next)) {
          answered.current.set(happenDay, next);
        }
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
    },
    [api, happenDay]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { series, loading, error, refresh };
}
