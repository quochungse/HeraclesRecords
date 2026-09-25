import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import {
  WEEKDAY_LABELS,
  dateFromKey,
  dayNumber,
  isKeyInMonth,
  keyFromDate,
  monthGridWeeks,
  monthLabel
} from "../calendar/dateUtils";

interface MonthDayPickerProps {
  /** The chosen day, as a COROS happen-day key (`yyyyMMdd`). */
  value: string;
  /** The earliest day that may be chosen, same shape. */
  min?: string;
  onChange: (key: string) => void;
  label?: string;
}

/**
 * One month of days, laid out as the calendar screen lays them out.
 *
 * A native `<input type="date">` was here, and it answers the question with a
 * text field: the day is typed or reached through the browser's own picker,
 * which is styled by the platform rather than by this app and which says
 * nothing about the week a session would land in. Scheduling is a decision
 * about a *week* — the athlete is looking for the gap between two sessions —
 * so the picker is the month, with today marked and the weeks in the same
 * Monday-first rows the calendar screen uses.
 *
 * The grid is built by `monthGridWeeks`, so a day here and the same day on the
 * calendar screen cannot fall in different weeks.
 */
export function MonthDayPicker({ value, min, onChange, label }: MonthDayPickerProps) {
  const selected = dateFromKey(value);
  const [view, setView] = useState(() => ({
    year: selected.getFullYear(),
    month: selected.getMonth()
  }));

  /* The month follows the day, so a value set from outside — the panel opening
     on tomorrow, a month away — is the month on screen. */
  useEffect(() => {
    const date = dateFromKey(value);
    setView({ year: date.getFullYear(), month: date.getMonth() });
  }, [value]);

  const weeks = monthGridWeeks(view.year, view.month);
  const today = keyFromDate(new Date());
  /*
   * The step back is closed when the month it would land on holds nothing
   * choosable — asked of that month rather than of this one, or the button
   * stays live right up to the floor and then opens a month where every day
   * is greyed out.
   *
   * It is the *grid's* last day, not the month's: a month's rows run to the
   * end of the week the last day falls in, so a February ending on a Tuesday
   * still offers the first days of March.
   */
  const previous = new Date(view.year, view.month - 1, 1);
  const canStepBack =
    !min ||
    monthGridWeeks(previous.getFullYear(), previous.getMonth()).flat().at(-1)! >= min;

  const step = (by: number) =>
    setView((current) => {
      const date = new Date(current.year, current.month + by, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });

  return (
    <div className="tl-daypick" {...(label ? { "aria-label": label } : {})} role="group">
      <div className="tl-daypick-head">
        <button
          type="button"
          className="tl-daypick-step"
          disabled={!canStepBack}
          aria-label="Previous month"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <strong aria-live="polite">{monthLabel(view.year, view.month)}</strong>
        <button
          type="button"
          className="tl-daypick-step"
          aria-label="Next month"
          onClick={() => step(1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="tl-daypick-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((day) => (
          <span key={day}>{day.slice(0, 2)}</span>
        ))}
      </div>

      <div className="tl-daypick-grid">
        {weeks.flat().map((key) => {
          const outside = !isKeyInMonth(key, view.year, view.month);
          const disabled = Boolean(min) && key < min!;
          const classes = [
            "tl-daypick-day",
            outside ? "is-outside" : "",
            key === today ? "is-today" : "",
            key === value ? "is-selected" : ""
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={key}
              type="button"
              className={classes}
              /* The key the cell stands for, so a probe or a suite can address
                 a day rather than a number that repeats across months. */
              data-day={key}
              disabled={disabled}
              aria-pressed={key === value}
              aria-label={dateFromKey(key).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
              })}
              onClick={() => onChange(key)}
            >
              {dayNumber(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
