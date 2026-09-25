import { AlertTriangle, CalendarPlus, CheckCircle2, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TrainingPlanCalendarPreview, TrainingPlanDocument } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { dateFromKey, keyFromDate } from "../calendar/dateUtils";
import { MonthDayPicker } from "./MonthDayPicker";

interface TrainingPlanCalendarDialogProps {
  api: CorosLinkApi;
  plan: TrainingPlanDocument;
  onClose: () => void;
  /** Answers the running copy COROS made of the plan. */
  onAdded: (instance: TrainingPlanDocument) => void;
}

/**
 * The first Monday from today on. COROS counts a plan's days from the Monday
 * of the week holding the start day, so a Monday start is the one that puts
 * every session of week 1 on the calendar.
 */
function nextMondayKey(today = new Date()): string {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  day.setDate(day.getDate() + ((8 - day.getDay()) % 7));
  return keyFromDate(day);
}

function displayDay(key: string): string {
  return dateFromKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function userFacingError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

/**
 * Puts a plan on the COROS calendar from a chosen day.
 *
 * COROS makes a running copy of the plan and dates its sessions from the
 * Monday of the start day's week, leaving off every session before the start
 * — and it never looks at what the calendar already holds. Both happen
 * without a word from COROS, so the preview is read again on every day
 * picked and says both before anything is written.
 */
export function TrainingPlanCalendarDialog({ api, plan, onClose, onAdded }: TrainingPlanCalendarDialogProps) {
  const [startDay, setStartDay] = useState(() => nextMondayKey());
  const [preview, setPreview] = useState<TrainingPlanCalendarPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  /* Which step failed decides what the error is called and what Try again does. */
  const [error, setError] = useState<{ during: "preview" | "add"; message: string } | null>(null);
  /* A preview answering an earlier pick must not land over a later one. */
  const request = useRef(0);

  const loadPreview = async (day: string) => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.previewTrainingPlanCalendar(plan.id, day);
      if (id === request.current) setPreview(next);
    } catch (cause) {
      if (id === request.current) {
        setPreview(null);
        setError({ during: "preview", message: userFacingError(cause) });
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadPreview(startDay);
    // Read again whenever the day changes, and only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDay]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || adding) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [adding, onClose]);

  const add = async () => {
    if (!preview || preview.blockers.length) return;
    setAdding(true);
    setError(null);
    try {
      onAdded(await api.addTrainingPlanToCalendar(plan.id, startDay));
    } catch (cause) {
      setError({ during: "add", message: userFacingError(cause) });
      setAdding(false);
    }
  };

  const current = preview?.startDay === startDay ? preview : null;
  const kept = current?.entries.filter((entry) => !entry.dropped) ?? [];
  const dropped = current?.entries.filter((entry) => entry.dropped) ?? [];
  /* Days, not sessions: two sessions on a day that holds a workout are one day. */
  const sharedDays = new Set(kept.filter((entry) => entry.existing.length).map((entry) => entry.happenDay)).size;

  return (
    <div
      className="plan-calendar-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !adding) onClose();
      }}
    >
      <section className="plan-calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-calendar-title">
        <header>
          <div>
            <p className="tl-eyebrow">COROS calendar</p>
            <h2 id="plan-calendar-title">
              <CalendarPlus size={20} /> Add plan to calendar
            </h2>
            <p>{plan.name}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" disabled={adding} onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="plan-calendar-body">
          <div className="plan-calendar-pick">
            <MonthDayPicker label="Start day" value={startDay} min={keyFromDate(new Date())} onChange={setStartDay} />
            <p>
              COROS counts the plan from the Monday of the week you pick. A later day in that week leaves off the
              sessions before it.
            </p>
          </div>

          <div className="plan-calendar-preview" aria-busy={loading}>
            {error ? (
              <div className="plan-calendar-error" role="alert">
                <AlertTriangle size={17} />
                <div>
                  <strong>
                    {error.during === "add" ? "COROS didn’t add the plan" : "Couldn’t read the COROS calendar"}
                  </strong>
                  <p>{error.message}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={loading || adding}
                  onClick={() => void (error.during === "add" ? add() : loadPreview(startDay))}
                >
                  <RefreshCw size={14} /> Try again
                </button>
              </div>
            ) : null}

            {!current && loading ? (
              <div className="plan-calendar-loading">
                <LoaderCircle className="is-spinning" size={22} />
                <strong>Checking the COROS calendar</strong>
              </div>
            ) : null}

            {current ? (
              <>
                <div className="plan-calendar-summary">
                  <span>
                    <strong>{kept.length}</strong>
                    <small>{kept.length === 1 ? "session to add" : "sessions to add"}</small>
                  </span>
                  <span>
                    <strong>{displayDay(current.anchorDay)}</strong>
                    <small>Week 1 starts</small>
                  </span>
                  <span className={sharedDays ? "has-conflict" : ""}>
                    <strong>{sharedDays}</strong>
                    <small>{sharedDays === 1 ? "day already holds a workout" : "days already hold a workout"}</small>
                  </span>
                </div>

                {current.blockers.length ? (
                  <div className="plan-calendar-blockers" role="alert">
                    <strong>
                      <AlertTriangle size={15} /> Can’t add from this day
                    </strong>
                    {current.blockers.map((blocker) => (
                      <p key={blocker}>{blocker}</p>
                    ))}
                  </div>
                ) : null}

                {dropped.length && kept.length ? (
                  <p className="plan-calendar-safety">
                    {dropped.length === 1 ? "One session falls" : `${dropped.length} sessions fall`} before{" "}
                    {displayDay(startDay)} and {dropped.length === 1 ? "is" : "are"} left off. Start on{" "}
                    {displayDay(current.anchorDay)} to keep {dropped.length === 1 ? "it" : "them"}.
                  </p>
                ) : null}

                <div className="plan-calendar-dates" role="list">
                  {current.entries.map((entry) => (
                    <article key={entry.entryId} role="listitem" className={entry.dropped ? "is-dropped" : undefined}>
                      <time>{displayDay(entry.happenDay)}</time>
                      <div>
                        <strong>{entry.name}</strong>
                        {entry.dropped ? (
                          <small>Before the start day — left off</small>
                        ) : entry.existing.length ? (
                          <small className="has-conflict">
                            <AlertTriangle size={12} /> Also on this day: {entry.existing.join(", ")}
                          </small>
                        ) : (
                          <small>
                            <CheckCircle2 size={12} /> Nothing else that day
                          </small>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <footer>
          <button type="button" className="ghost-button" disabled={adding} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={adding || loading || !current || current.blockers.length > 0}
            onClick={() => void add()}
          >
            {adding ? <LoaderCircle className="is-spinning" size={15} /> : <CalendarPlus size={15} />}
            {adding ? "Adding…" : sharedDays ? "Add alongside them" : "Add to calendar"}
          </button>
        </footer>
      </section>
    </div>
  );
}
