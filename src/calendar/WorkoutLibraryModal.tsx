import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarPlus, Eye, Library, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TrainingHubLibraryWorkout } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel, getLocalHappenDayKey } from "../training/formatters";
import { scheduledWorkoutSport, workoutSportLabel } from "../training/workoutSport";

interface WorkoutLibraryModalProps {
  api: CorosLinkApi;
  onClose: () => void;
  /**
   * Opens a library workout to be read. The calendar does not offer to change
   * one: a library workout is a template every future use of it shares, so
   * editing it from here would rewrite sessions nobody is looking at.
   * Training Library owns that.
   */
  onView: (programId: string) => void;
  onScheduled: (message: string) => void;
  onError: (message: string | null) => void;
  /**
   * Another dialog is open over this one, so it waits rather than closing.
   *
   * The workout view opens from here and closes back to here, which means
   * both are mounted at once. Escape is listened for on the document by each
   * of them, so without this one press closed the view and the library under
   * it in the same breath; `inert` keeps the pointer and the tab ring out of
   * a panel the reader cannot see.
   */
  covered?: boolean;
}

function keyToInputDate(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function inputDateToKey(value: string): string {
  return value.replace(/-/g, "");
}

export function WorkoutLibraryModal({ api, onClose, onView, onScheduled, onError, covered = false }: WorkoutLibraryModalProps) {
  const reducedMotion = useReducedMotion();
  const today = getLocalHappenDayKey();
  const [items, setItems] = useState<TrainingHubLibraryWorkout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // Today is schedulable everywhere else on this screen — the day cell's "+"
  // and a drag both accept it, and COROS only refuses a day already past — so
  // this panel starts on today rather than inventing a stricter rule of its own.
  const [date, setDate] = useState(keyToInputDate(today));
  const [scheduling, setScheduling] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setItems(null);
    setError(null);
    let cancelled = false;
    void api.listLibraryWorkouts().then((result) => {
      if (!cancelled) setItems(result);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setItems([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => { cancelled = true; };
  }, [api, reloadToken]);

  useEffect(() => {
    if (covered) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !scheduling) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [covered, onClose, scheduling]);

  const visible = useMemo(() => {
    const filter = query.trim().toLowerCase();
    return (items ?? []).filter((item) => !filter || item.name.toLowerCase().includes(filter));
  }, [items, query]);

  const schedule = async () => {
    if (!selected) return;
    const happenDay = inputDateToKey(date);
    if (happenDay < today) {
      onError("COROS doesn't allow scheduling workouts in the past.");
      return;
    }
    setScheduling(true);
    try {
      await api.scheduleLibraryWorkout(selected, happenDay);
      const workout = items?.find((item) => item.id === selected);
      onScheduled(`Scheduled "${workout?.name ?? "Workout"}" on ${formatHappenDayLabel(happenDay)}.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScheduling(false);
    }
  };

  return <AnimatePresence>
    <motion.div className="calendar-modal-backdrop" inert={covered} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="calendar-modal calendar-library-modal" role="dialog" aria-modal="true" aria-labelledby="library-manager-title" initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
        <header className="calendar-modal-header">
          <div><p className="eyebrow">COROS Training Hub</p><h2 id="library-manager-title">Workout Library</h2></div>
          <button type="button" className="icon-button" aria-label="Close workout library" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="calendar-modal-body">
          <label className="calendar-field calendar-library-search"><span>Search workouts</span><span className="calendar-sport-search-control"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" /></span></label>
          <div className="workout-library-manager-list">
            {items === null ? <div className="workout-library-state"><LoaderCircle className="is-spinning" size={20} aria-hidden="true" /><p>Loading your COROS workout library...</p></div> : error ? <div className="workout-library-state"><p>{error}</p><button type="button" className="ghost-button" onClick={() => setReloadToken((current) => current + 1)}>Try again</button></div> : visible.length === 0 ? <div className="workout-library-state"><Library size={24} aria-hidden="true" /><p>{query ? "No workouts match your search." : "Your workout library is empty."}</p></div> : visible.map((item) => {
              /* The badge used to read "Run" for every editable workout — a
                 bike, a swim and a strength session all wore it, because the
                 only thing being tested was whether the sport code was in the
                 editor's supported range. Name the sport COROS actually sent. */
              const sport = scheduledWorkoutSport(item.sportType);
              const supported = Boolean(sport);
              return <article key={item.id} className={`workout-library-row ${selected === item.id ? "is-selected" : ""}`}>
                <button type="button" className="workout-library-select" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                  <span><strong>{item.name}</strong><small>{[item.volume, item.trainingLoad !== undefined ? `${Math.round(item.trainingLoad)} TL` : null].filter(Boolean).join(" · ") || "No calculated totals"}</small></span>
                  <span className={`workout-library-sport ${supported ? "is-supported" : ""}`}>{sport ? workoutSportLabel(sport) : "View only"}</span>
                </button>
                {supported ? <button type="button" className="ghost-button workout-library-edit" onClick={() => onView(item.id)}><Eye size={14} aria-hidden="true" /> View</button> : <span className="workout-library-readonly">No preview for this sport.</span>}
              </article>;
            })}
          </div>
        </div>
        <footer className="calendar-modal-footer workout-library-footer">
          <label className="calendar-field"><span>Schedule selected workout</span><input type="date" min={keyToInputDate(today)} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <button type="button" className="primary-button" disabled={!selected || !date || scheduling} onClick={() => void schedule()}>{scheduling ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : <CalendarPlus size={15} aria-hidden="true" />}{scheduling ? "Scheduling..." : "Schedule"}</button>
        </footer>
      </motion.section>
    </motion.div>
  </AnimatePresence>;
}
