import { useEffect, useRef, type ReactNode } from "react";
import { formatHappenDayLabel } from "../../training/formatters";
import { useI18n } from "../../i18n/useI18n";

export interface DayListRow {
  day: string;
  /** The row's figure, already rounded or written; nothing is a dash. */
  figure?: number | string;
  /** A class for the figure (its colour). */
  tone?: string;
  meta: string;
  /** A strip under the row: the day's levels, or its heart-rate range. */
  strip?: ReactNode;
}

interface DayListProps {
  rows: DayListRow[];
  today: string;
  selectedDay: string;
  onSelect: (day: string) => void;
  /** Said instead of the rows while there are none. */
  empty?: string;
  ariaLabel: string;
}

/**
 * The last month, a row a day, newest first, for both Stress level and
 * Heart rate: each screen decides what a row says, this draws it. Plain
 * buttons, with `aria-current` on the day on screen.
 */
export function DayList({ rows, today, selectedDay, onSelect, empty, ariaLabel }: DayListProps) {
  const { t } = useI18n();
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedDay]);

  if (empty) {
    return <p className="stress-day-list-empty">{empty}</p>;
  }

  return (
    <ul className="stress-day-list" aria-label={ariaLabel}>
      {rows.map((row) => {
        const selected = row.day === selectedDay;
        return (
          <li key={row.day}>
            <button
              type="button"
              ref={selected ? selectedRef : undefined}
              className={`stress-day-row${selected ? " is-selected" : ""}`}
              onClick={() => onSelect(row.day)}
              aria-current={selected ? "true" : undefined}
            >
              <span className="stress-day-row-head">
                <span className="stress-day-row-date">
                  {row.day === today ? t("stress.today") : formatHappenDayLabel(row.day)}
                </span>
                <span className={`stress-day-row-figure${row.tone ? ` ${row.tone}` : ""}`}>
                  {row.figure !== undefined ? row.figure : "–"}
                </span>
              </span>
              <span className="stress-day-row-meta">{row.meta}</span>
              {row.strip ?? null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
