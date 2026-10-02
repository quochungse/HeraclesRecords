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
  /** The labour completed, shown one at a time when two complete at once. */
  celebration: Celebration | null;
  closeCelebration: () => void;
}

interface Celebration {
  labour: LabourState;
  completed: number;
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
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
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
    if (onRecordsScreen && next && fresh.length > 0) {
      const shown = fresh;
      setVisitNew((current) => new Set([...current, ...shown]));
      next = markSeen(next, fresh) ?? next;
      fresh = [];
    }
    // Written whenever there is a state, not only when this reckoning moved
    // it: the synced copy may be the other machine's, short of what this one
    // holds, and writing the union back is what mends it. A no-op otherwise.
    if (next) writeNoticeState(next);
    setFreshCount(fresh.length);

    // A labour completed is one celebration — each of them, in turn, when two
    // complete at once — and its other stages reached at the same moment are
    // not toasted beside it.
    const completingIds = new Set(
      reckoning.announce.filter((entry) => entry.completes).map((entry) => entry.labourId)
    );
    const completed = labours.filter((candidate) => candidate.complete).length;
    const celebrated = [...completingIds].flatMap((labourId) => {
      const labour = labourOf.get(labourId);
      return labour ? [{ labour, completed }] : [];
    });
    if (celebrated.length > 0) {
      setCelebrations((current) => [...current, ...celebrated]);
    }
    const toasted = reckoning.announce.filter((entry) => !completingIds.has(entry.labourId));
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
    celebration: celebrations[0] ?? null,
    closeCelebration: useCallback(() => setCelebrations((current) => current.slice(1)), [])
  };
}
