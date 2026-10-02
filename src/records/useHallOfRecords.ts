import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActivityDetailSummary,
  RememberedMilestone,
  TrainingHubActivity,
  UnitSystem
} from "../../electron/types";
import { RECORDS_SUMMARY_VERSION } from "../../electron/activityMetrics";
import { isSleepDayRecord, totalSleepMinutes } from "../../electron/sleepMetrics";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { knownPlaceLabels, loadPlaceLabel } from "../trainingMap/placeLabels";
import { mergeTrainingDayLists } from "../training/parsers";
import type { TrainingHubLoadStatus, TrainingHubSnapshot } from "../training/types";
import { buildLabours, type LabourState } from "./labours";
import {
  computeRecords,
  needsRecordsSummary,
  type PlaceLabelLookup,
  type RecordsResult
} from "./milestones";

/** The nights the sleep cache keeps (`HISTORY_RETENTION_DAYS`). */
const SLEEP_DAYS = 400;

/**
 * A backstop on the records backfill, for the session rather than the visit:
 * an athlete with years of history should not spend their first afternoon on
 * this screen fetching all of it. Each fetch is a 2.5 MB detail; the rest
 * comes on later visits, oldest first so a record's history is right as far as
 * it reaches.
 */
const SESSION_FETCH_CAP = 400;
const BACKFILL_CHUNK = 4;
const BACKFILL_PAUSE_MS = 300;
let fetchedThisSession = 0;

/** Places named per visit, at most: each is a request to a public geocoder. */
const PLACE_NAMES_PER_VISIT = 40;

export interface HallOfRecordsState {
  result: RecordsResult;
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  labours: LabourState[];
  /** False until the activity list has answered — an empty hall is not yet a fact. */
  ready: boolean;
  /** The list failed and nothing is held: a failure to say, not a load to wait on. */
  failed: boolean;
  /**
   * Every source has answered once: the list, the stored summaries, the
   * remembered ledger, the snapshot and the sleep cache. The notifications wait
   * for it — reckoned on half the sources, the other half would arrive later
   * as "new".
   */
  settled: boolean;
  /** The renderer's own copy of the summaries, merged as the backfill lands. */
  mergeSummaries: (summaries: readonly ActivityDetailSummary[]) => void;
  /** Ask the place-name cache again, once a name has been resolved. */
  refreshPlaceLabels: () => void;
}

function namedPlaceLabels(): Record<string, PlaceLabelLookup> {
  const known = knownPlaceLabels();
  const named: Record<string, PlaceLabelLookup> = {};
  for (const [key, label] of Object.entries(known)) {
    // "Location" is `coordinateLabel`'s country: nobody answered for that cell.
    if (label.country && label.country !== "Location") {
      named[key] = { city: label.city, country: label.country };
    }
  }
  return named;
}

/**
 * Everything the Hall of Records reads, held in App rather than in the screen:
 * the rail's "new" count and the labour notifications have to know what was
 * reached while the athlete is on any other screen.
 *
 * It asks for nothing COROS has to compute: stored summaries, the remembered
 * ledger and the sleep cache (read `cacheOnly` — the Sleep screen and Overview
 * keep it filled) are all local reads. What costs a request — the records
 * backfill and the place names — runs only while the screen is open
 * (`useRecordsBackfill`, `usePlaceNames`).
 *
 * The ledger and the sleep cache move without telling anyone — a plan run
 * finishes in the plan cache, a night lands from the Sleep screen — so both
 * are read again on every visit to the hall and whenever the activity list
 * does, which is when there is something new to count.
 */
export function useHallOfRecords({
  api,
  activities,
  activitiesStatus,
  snapshot,
  snapshotStatus,
  connected,
  visible,
  unitSystem
}: {
  api: HeraclesRecordsApi | undefined;
  activities: readonly TrainingHubActivity[];
  activitiesStatus: TrainingHubLoadStatus;
  snapshot: TrainingHubSnapshot | null;
  snapshotStatus: TrainingHubLoadStatus;
  connected: boolean;
  /** The hall is the screen on show. */
  visible: boolean;
  unitSystem: UnitSystem;
}): HallOfRecordsState {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, ActivityDetailSummary>>(
    () => new Map()
  );
  const [remembered, setRemembered] = useState<RememberedMilestone[]>([]);
  const [sleepNights, setSleepNights] = useState<Array<{ day: string; minutes: number }>>([]);
  const [labelVersion, setLabelVersion] = useState(0);
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  const [rememberedLoaded, setRememberedLoaded] = useState(false);
  const [sleepLoaded, setSleepLoaded] = useState(false);

  const activityIds = useMemo(
    () => activities.map((activity) => activity.activityId),
    [activities]
  );

  useEffect(() => {
    if (!api || activityIds.length === 0) return;
    let cancelled = false;
    void api
      .getActivityDetailSummaries(activityIds)
      .then((stored) => {
        if (cancelled) return;
        // Merged, not replaced: a backfill pass may have landed since this read
        // went out, and its rows are newer than what the read found.
        setSummaries((current) => {
          const next = new Map(current);
          for (const summary of stored) {
            const held = next.get(summary.activityId);
            if (
              held?.recordsVersion === RECORDS_SUMMARY_VERSION &&
              summary.recordsVersion !== RECORDS_SUMMARY_VERSION
            ) {
              continue;
            }
            next.set(summary.activityId, summary);
          }
          return next;
        });
        setSummariesLoaded(true);
      })
      .catch(() => setSummariesLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [api, activityIds]);

  const loadRemembered = useCallback(() => {
    if (!api) return;
    void api
      .listRememberedMilestones()
      .then(setRemembered)
      .catch(() => undefined)
      .finally(() => setRememberedLoaded(true));
  }, [api]);

  // A finished plan run is worked out from the plan cache and the matches as
  // the ledger is read, and neither says when it moved.
  useEffect(() => {
    loadRemembered();
  }, [loadRemembered, connected, visible, activityIds]);

  // The other machine's memory arrives by sync.
  useEffect(() => {
    if (!api?.onSyncChanged) return;
    return api.onSyncChanged((change) => {
      if (change.tables?.includes("athlete_milestones")) loadRemembered();
    });
  }, [api, loadRemembered]);

  useEffect(() => {
    if (!api || !connected) return;
    let cancelled = false;
    void api
      .getSleepHistory({ days: SLEEP_DAYS, cacheOnly: true })
      .then((history) => {
        if (cancelled) return;
        setSleepNights(
          history.records.filter(isSleepDayRecord).flatMap((record) => {
            const minutes = totalSleepMinutes(record);
            return minutes !== undefined && minutes > 0
              ? [{ day: record.happenDay, minutes }]
              : [];
          })
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSleepLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, connected, visible, activityIds]);

  const vo2Readings = useMemo(
    () =>
      mergeTrainingDayLists(snapshot?.dailyMetrics ?? null, snapshot?.analytics ?? null).flatMap(
        (day) =>
          typeof day.vo2max === "number" && Number.isFinite(day.vo2max) && day.vo2max > 0
            ? [{ day: day.happenDay, value: day.vo2max }]
            : []
      ),
    [snapshot]
  );

  // The labels live in a module cache; the version is what says it moved.
  const placeLabels = useMemo(() => {
    void labelVersion;
    return namedPlaceLabels();
  }, [labelVersion]);

  const result = useMemo(
    () =>
      computeRecords({
        activities,
        summaries,
        personalRecords: snapshot?.dashboard?.personalRecords,
        vo2Readings,
        sleepNights,
        remembered,
        placeLabels,
        unitSystem
      }),
    [activities, summaries, snapshot, vo2Readings, sleepNights, remembered, placeLabels, unitSystem]
  );

  const labours = useMemo(
    () => buildLabours(result.milestones, result.progress),
    [result]
  );

  // What a source will forget goes to the ledger — only when it says something
  // the ledger does not already hold, so a recompute is not a write.
  useEffect(() => {
    if (!api) return;
    const held = new Map(remembered.map((row) => [row.id, row.day]));
    const fresh = result.toRemember.filter((row) => {
      const day = held.get(row.id);
      return day === undefined || row.day < day;
    });
    if (fresh.length === 0) return;
    void api
      .rememberMilestones(fresh)
      .then((moved) => {
        if (moved > 0) loadRemembered();
      })
      .catch(() => undefined);
  }, [api, result.toRemember, remembered, loadRemembered]);

  const mergeSummaries = useCallback((incoming: readonly ActivityDetailSummary[]) => {
    if (incoming.length === 0) return;
    setSummaries((current) => {
      const next = new Map(current);
      for (const summary of incoming) next.set(summary.activityId, summary);
      return next;
    });
  }, []);

  const refreshPlaceLabels = useCallback(() => setLabelVersion((version) => version + 1), []);

  return {
    result,
    summaries,
    labours,
    ready: activitiesStatus === "ready" || activities.length > 0,
    failed: activitiesStatus === "failed" && activities.length === 0,
    settled:
      connected &&
      activitiesStatus === "ready" &&
      (summariesLoaded || activityIds.length === 0) &&
      rememberedLoaded &&
      sleepLoaded &&
      snapshotStatus !== "pending",
    mergeSummaries,
    refreshPlaceLabels
  };
}

/**
 * Fill in the records figures — best efforts and a start point — for the
 * activities whose summary predates them, a few at a time, oldest first, while
 * the screen is open. Answers how many are still to read, or `undefined` while
 * nothing has been asked yet.
 */
export function useRecordsBackfill({
  api,
  activities,
  summaries,
  enabled,
  onSummaries
}: {
  api: HeraclesRecordsApi | undefined;
  activities: readonly TrainingHubActivity[];
  summaries: ReadonlyMap<string, ActivityDetailSummary>;
  enabled: boolean;
  onSummaries: (summaries: readonly ActivityDetailSummary[]) => void;
}): { remaining: number | undefined; paused: boolean } {
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;

  // Recomputed per list and once the stored summaries first arrive, not per
  // summary landing: the loop below asks the main process, which knows what it
  // has just written, and a new list of ids would restart it every pass.
  const loaded = summaries.size > 0;
  const pendingIds = useMemo(
    () =>
      activities
        .filter((activity) =>
          needsRecordsSummary(activity, summariesRef.current.get(activity.activityId))
        )
        .sort((left, right) => (left.startTime ?? 0) - (right.startTime ?? 0))
        .map((activity) => activity.activityId),
    [activities, loaded]
  );

  useEffect(() => {
    if (!api || !enabled || pendingIds.length === 0) {
      setRemaining(pendingIds.length === 0 ? 0 : undefined);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    // A chunk at a time, not the whole list each pass: main fingerprints every
    // id it is handed, and handing it thousands to fetch four is the cost.
    let cursor = 0;
    const step = async () => {
      if (cancelled) return;
      if (cursor >= pendingIds.length) {
        setRemaining(0);
        return;
      }
      if (fetchedThisSession >= SESSION_FETCH_CAP) {
        setPaused(true);
        setRemaining(pendingIds.length - cursor);
        return;
      }
      const chunk = pendingIds.slice(cursor, cursor + BACKFILL_CHUNK);
      try {
        const pass = await api.syncActivityDetailSummaries(chunk, BACKFILL_CHUNK, {
          requireRecords: true
        });
        // Taken even when this loop has been superseded: main has stored these
        // and counts them as done, so no later pass would hand them over again.
        fetchedThisSession += pass.computed + pass.failed;
        onSummaries(pass.summaries);
        if (cancelled) return;
        cursor += chunk.length;
        setRemaining(pendingIds.length - cursor);
        if (pass.failed > 0 && pass.computed === 0) {
          // Every fetch in the chunk failed: COROS is not answering.
          setPaused(true);
          return;
        }
        timer = window.setTimeout(
          () => void step(),
          pass.computed + pass.failed > 0 ? BACKFILL_PAUSE_MS : 0
        );
      } catch {
        // Offline, or COROS said no: the next visit tries again.
        setPaused(true);
      }
    };
    void step();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, enabled, pendingIds, onSummaries]);

  return { remaining, paused };
}

/**
 * Name the places trained in, busiest first, a few per visit. The names land in
 * the globe's own cache (`placeLabels.ts`), so a cell "Where you've been" has
 * named is never asked about again here, and the reverse.
 */
export function usePlaceNames({
  cells,
  enabled,
  onNamed
}: {
  cells: RecordsResult["places"];
  enabled: boolean;
  onNamed: () => void;
}): void {
  const asked = useRef(new Set<string>());
  // Counted for the visit (the screen's mount), not per run of the effect: a
  // name landing recomputes the places, and a cap per run would be no cap.
  const askedThisVisit = useRef(0);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  // The cells as a set of places, so a recompute that names one does not start
  // the queue again.
  const cellKeys = cells.map((cell) => cell.key).join(",");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const known = knownPlaceLabels();
    const queue = cellsRef.current
      .filter((cell) => !known[cell.key] && !asked.current.has(cell.key))
      .slice(0, Math.max(0, PLACE_NAMES_PER_VISIT - askedThisVisit.current));
    void (async () => {
      for (const cell of queue) {
        if (cancelled) return;
        asked.current.add(cell.key);
        askedThisVisit.current += 1;
        const named = await loadPlaceLabel(cell.key, { lat: cell.lat, lon: cell.lon }).then(
          () => true,
          () => false
        );
        // Told even when superseded: the name is in the cache either way.
        if (named) onNamed();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cellKeys, enabled, onNamed]);
}
