import { AnimatePresence, motion } from "motion/react";
import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  TrainingHubScheduledWorkoutEntry,
  TrainingHubSportType,
  TrainingHubUpcomingWorkout
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import { ScheduledWorkoutDetail } from "../../calendar/ScheduledWorkoutDetail";
import { formatHappenDayLabel } from "../formatters";
import {
  matchScheduledEntry,
  scheduledEntryFromUpcoming
} from "../upcomingWorkoutMatch";

interface UpcomingWorkoutDetailPanelProps {
  api: CorosLinkApi;
  workout: TrainingHubUpcomingWorkout | null;
  sportTypes: TrainingHubSportType[];
  onClose: () => void;
}

/**
 * The calendar's day slide-over, opened from an Overview upcoming row. It wears
 * the calendar's `calendar-detail-*` shell on purpose — this is the same screen,
 * reached from somewhere else — but carries none of the calendar's edit, remove
 * or bulk-select machinery: Overview has nothing to reload after a mutation, so
 * scheduling changes stay on the Calendar screen.
 *
 * It renders through a portal because the shell is `position: fixed` and the
 * Overview card it is opened from ends its `training-card-enter` animation on a
 * `transform` (`fill-mode: both` keeps that computed value), which makes the
 * card a containing block — the slide-over would otherwise be boxed inside the
 * panel it came from rather than covering the window.
 */
export function UpcomingWorkoutDetailPanel({
  api,
  workout,
  sportTypes,
  onClose
}: UpcomingWorkoutDetailPanelProps) {
  const [entry, setEntry] = useState<TrainingHubScheduledWorkoutEntry | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  // Scheduled entries are fetched a day at a time; reopening a row (or opening
  // its neighbour) should not go back to COROS for a day already answered.
  const cacheRef = useRef(new Map<string, TrainingHubScheduledWorkoutEntry[]>());

  useEffect(() => {
    if (!workout) {
      return;
    }

    // The upcoming row is already the right workout — it just carries the
    // thinner parsed structure. Show it immediately, then upgrade to the
    // scheduled entry's raw program when it lands.
    const fallback = scheduledEntryFromUpcoming(workout);
    setEntry(fallback);

    const cached = cacheRef.current.get(workout.happenDay);
    if (cached) {
      setEntry(matchScheduledEntry(cached, workout) ?? fallback);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void api
      .listScheduledWorkouts(workout.happenDay, workout.happenDay)
      .then((entries) => {
        cacheRef.current.set(workout.happenDay, entries);
        if (!cancelled) {
          setEntry(matchScheduledEntry(entries, workout) ?? fallback);
        }
      })
      .catch(() => {
        // The fallback already shows the workout; a failed lookup only costs
        // the richer step structure, which is not worth an error banner.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, workout]);

  useEffect(() => {
    if (!workout) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [workout, onClose]);

  return createPortal(
    <AnimatePresence>
      {workout && entry ? (
        <>
          <motion.div
            className="calendar-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="calendar-detail-panel"
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <header className="calendar-detail-header">
              <div>
                <p className="eyebrow">
                  {formatHappenDayLabel(workout.happenDay)}
                </p>
                <h3>{workout.name}</h3>
              </div>
              <div className="calendar-detail-actions">
                {loading ? (
                  <span
                    className="training-upcoming-detail-busy"
                    aria-live="polite"
                  >
                    <Loader2 className="spin" size={14} aria-hidden="true" />
                    Loading
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ghost-button calendar-detail-action"
                  onClick={onClose}
                  aria-label="Close details"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="calendar-detail-body">
              <ScheduledWorkoutDetail entry={entry} sportTypes={sportTypes} />
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
