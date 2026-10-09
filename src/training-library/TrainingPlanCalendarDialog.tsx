import { AlertTriangle, CalendarPlus, CheckCircle2, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TrainingPlanCalendarPreview, TrainingPlanDocument } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { dateFromKey, keyFromDate } from "../calendar/dateUtils";
import { MonthDayPicker } from "./MonthDayPicker";

import { formatCount, getIntlLocale, plural, t } from "../i18n/core";
interface TrainingPlanCalendarDialogProps {
  api: HeraclesRecordsApi;
  plan: TrainingPlanDocument;
  onClose: () => void;
  /** Answers the running copy COROS made of the plan. */
  onAdded: (instance: TrainingPlanDocument) => void;
  /**
   * A plan not on COROS yet — a library draft, `plan.id` its record's id — is
   * saved by this before it is added, once the day is picked. It answers the
   * saved plan, and must answer the same one if asked again after the add
   * failed, so Try again adds rather than saving a second copy.
   */
  saveFirst?: () => Promise<TrainingPlanDocument>;
  /**
   * The day to open on, `yyyyMMdd` — the Monday the athlete already chose for
   * a generated plan, which a race plan is counted back from. Ignored once it
   * has gone by; the next Monday otherwise.
   */
  defaultStartDay?: string;
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
  return dateFromKey(key).toLocaleDateString(getIntlLocale(), { weekday: "short", month: "short", day: "numeric" });
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
export function TrainingPlanCalendarDialog({
  api,
  plan,
  onClose,
  onAdded,
  saveFirst,
  defaultStartDay
}: TrainingPlanCalendarDialogProps) {
  const [startDay, setStartDay] = useState(() =>
    defaultStartDay && /^\d{8}$/.test(defaultStartDay) && defaultStartDay >= keyFromDate(new Date())
      ? defaultStartDay
      : nextMondayKey()
  );
  const [preview, setPreview] = useState<TrainingPlanCalendarPreview | null>(null);
  const [loading, setLoading] = useState(true);
  /* What an add is doing now: saving the plan first, or putting it on the calendar. */
  const [adding, setAdding] = useState<"saving" | "adding" | null>(null);
  /* Which step failed decides what the error is called and what Try again does. */
  const [error, setError] = useState<{ during: "preview" | "save" | "add"; message: string } | null>(null);
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
    setError(null);
    let planId = plan.id;
    if (saveFirst) {
      setAdding("saving");
      try {
        planId = (await saveFirst()).id;
      } catch (cause) {
        setError({ during: "save", message: userFacingError(cause) });
        setAdding(null);
        return;
      }
    }
    setAdding("adding");
    try {
      onAdded(await api.addTrainingPlanToCalendar(planId, startDay));
    } catch (cause) {
      setError({ during: "add", message: userFacingError(cause) });
      setAdding(null);
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
            <p className="tl-eyebrow">{t("library.cal.eyebrow")}</p>
            <h2 id="plan-calendar-title">
              <CalendarPlus size={20} /> {t("library.cal.title")}
            </h2>
            <p>{plan.name}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t("common.close")} disabled={Boolean(adding)} onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="plan-calendar-body">
          <div className="plan-calendar-pick">
            <MonthDayPicker label={t("library.cal.startDay")} value={startDay} min={keyFromDate(new Date())} onChange={setStartDay} />
            <p>{t("library.cal.startBody")}</p>
          </div>

          <div className="plan-calendar-preview" aria-busy={loading}>
            {error ? (
              <div className="plan-calendar-error" role="alert">
                <AlertTriangle size={17} />
                <div>
                  <strong>
                    {error.during === "save"
                      ? t("library.cal.err.save")
                      : error.during === "add"
                        ? saveFirst ? t("library.cal.err.savedNotAdded") : t("library.cal.err.add")
                        : t("library.cal.err.read")}
                  </strong>
                  <p>{error.message}</p>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={loading || Boolean(adding)}
                  onClick={() => void (error.during === "preview" ? loadPreview(startDay) : add())}
                >
                  <RefreshCw size={14} /> {t("common.tryAgain")}
                </button>
              </div>
            ) : null}

            {!current && loading ? (
              <div className="plan-calendar-loading">
                <LoaderCircle className="is-spinning" size={22} />
                <strong>{t("library.cal.checking")}</strong>
              </div>
            ) : null}

            {current ? (
              <>
                <div className="plan-calendar-summary">
                  <span>
                    <strong>{formatCount(kept.length)}</strong>
                    <small>{plural("library.cal.toAdd", kept.length)}</small>
                  </span>
                  <span>
                    <strong>{displayDay(current.anchorDay)}</strong>
                    <small>{t("library.cal.week1")}</small>
                  </span>
                  <span className={sharedDays ? "has-conflict" : ""}>
                    <strong>{formatCount(sharedDays)}</strong>
                    <small>{plural("library.cal.shared", sharedDays)}</small>
                  </span>
                </div>

                {current.blockers.length ? (
                  <div className="plan-calendar-blockers" role="alert">
                    <strong>
                      <AlertTriangle size={15} /> {t("library.cal.blocked")}
                    </strong>
                    {current.blockers.map((blocker) => (
                      <p key={blocker}>{blocker}</p>
                    ))}
                  </div>
                ) : null}

                {dropped.length && kept.length ? (
                  <p className="plan-calendar-safety">
                    {plural("library.cal.leftOff", dropped.length, { start: displayDay(startDay), anchor: displayDay(current.anchorDay) })}
                  </p>
                ) : null}

                <div className="plan-calendar-dates" role="list">
                  {current.entries.map((entry) => (
                    <article key={entry.entryId} role="listitem" className={entry.dropped ? "is-dropped" : undefined}>
                      <time>{displayDay(entry.happenDay)}</time>
                      <div>
                        <strong>{entry.name}</strong>
                        {entry.dropped ? (
                          <small>{t("library.cal.dropped")}</small>
                        ) : entry.existing.length ? (
                          <small className="has-conflict">
                            <AlertTriangle size={12} /> {t("library.cal.alsoOn", { names: entry.existing.join(", ") })}
                          </small>
                        ) : (
                          <small>
                            <CheckCircle2 size={12} /> {t("library.cal.nothingElse")}
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
          <button type="button" className="ghost-button" disabled={Boolean(adding)} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={Boolean(adding) || loading || !current || current.blockers.length > 0}
            onClick={() => void add()}
          >
            {adding ? <LoaderCircle className="is-spinning" size={15} /> : <CalendarPlus size={15} />}
            {adding === "saving"
              ? t("library.cal.saving")
              : adding
                ? t("library.cal.adding")
                : saveFirst
                  ? sharedDays ? t("library.cal.saveAddAlongside") : t("library.cal.saveAdd")
                  : sharedDays ? t("library.cal.addAlongside") : t("library.cal.add")}
          </button>
        </footer>
      </section>
    </div>
  );
}
