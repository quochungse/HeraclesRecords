import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLocalHappenDayKey } from "../training/formatters";
import type { LabourId, LabourState } from "./labours";
import {
  markSeen,
  readNoticeState,
  reckonNotices,
  writeNoticeState,
  type Announcement
} from "./recordsNotices";
import type { HallOfRecordsState } from "./useHallOfRecords";

/** A labour toast stays up longer than a plain one: it is worth reading. */
const LABOUR_TOAST_MS = 15_000;

export interface RecordsNotices {
  /** Unseen recent milestones: the rail's count. */
  freshCount: number;
  /** What the open visit to the hall marks "New" — captured as it began. */
  visitNew: ReadonlySet<string>;
  toasts: Array<{ announcement: Announcement; labour: LabourState }>;
  dismissToast: (key: string) => void;
  celebration: { labour: LabourState; completed: number } | null;
  closeCelebration: () => void;
}

/**
 * Reckons what the athlete has not been told — new milestones, labour stages
 * reached — once every source has answered (`settled`), and again whenever
 * the milestones change. Opening the hall marks its new milestones seen, while
 * keeping them marked "New" for the rest of that visit.
 */
export function useRecordsNotices({
  records,
  onRecordsScreen
}: {
  records: HallOfRecordsState;
  onRecordsScreen: boolean;
}): RecordsNotices {
  const [freshCount, setFreshCount] = useState(0);
  const [visitNew, setVisitNew] = useState<ReadonlySet<string>>(() => new Set());
  const [toasts, setToasts] = useState<Array<{ announcement: Announcement; labour: LabourState }>>([]);
  const [celebration, setCelebration] = useState<RecordsNotices["celebration"]>(null);
  const timers = useRef(new Map<string, number>());
  const { result, labours, settled } = records;

  const labourOf = useMemo(
    () => new Map<LabourId, LabourState>(labours.map((labour) => [labour.definition.id, labour])),
    [labours]
  );

  const dismissToast = useCallback((key: string) => {
    setToasts((current) => current.filter((toast) => toast.announcement.key !== key));
    const timer = timers.current.get(key);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(key);
    }
  }, []);

  useEffect(() => {
    if (!settled) return;
    // Read every time rather than held: a sync pull may have written the
    // other machine's copy since the last reckoning.
    const stored = readNoticeState();
    const reckoning = reckonNotices(stored, result.milestones, labours, getLocalHappenDayKey());
    let next = reckoning.next ?? stored;
    let fresh = reckoning.fresh;
    let write = Boolean(reckoning.next);
    if (onRecordsScreen && next && fresh.length > 0) {
      const shown = fresh;
      setVisitNew((current) => new Set([...current, ...shown]));
      const seen = markSeen(next, fresh);
      if (seen) {
        next = seen;
        write = true;
      }
      fresh = [];
    }
    if (write && next) writeNoticeState(next);
    setFreshCount(fresh.length);

    // A labour completed is one celebration; its other stages reached at the
    // same moment are not toasted beside it.
    const completing = reckoning.announce.find((entry) => entry.completes);
    if (completing) {
      const labour = labourOf.get(completing.labourId);
      if (labour) {
        setCelebration({
          labour,
          completed: labours.filter((candidate) => candidate.complete).length
        });
      }
    }
    const toasted = reckoning.announce.filter(
      (entry) => !entry.completes && entry.labourId !== completing?.labourId
    );
    if (toasted.length > 0) {
      setToasts((current) => [
        ...current,
        ...toasted.flatMap((announcement) => {
          const labour = labourOf.get(announcement.labourId);
          return labour ? [{ announcement, labour }] : [];
        })
      ]);
      for (const announcement of toasted) {
        timers.current.set(
          announcement.key,
          window.setTimeout(() => dismissToast(announcement.key), LABOUR_TOAST_MS)
        );
      }
    }
  }, [settled, result.milestones, labours, labourOf, onRecordsScreen, dismissToast]);

  // Leaving the hall ends the visit: what was new on it has been seen.
  useEffect(() => {
    if (!onRecordsScreen) setVisitNew(new Set());
  }, [onRecordsScreen]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return {
    freshCount,
    visitNew,
    toasts,
    dismissToast,
    celebration,
    closeCelebration: useCallback(() => setCelebration(null), [])
  };
}
