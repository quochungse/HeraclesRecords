import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import {
  formatHappenDayLabel,
  formatSleepDurationMinutes
} from "../../training/formatters";
import { drawableStages } from "../sleepStages";
import type { TrainingHubSleepRecord } from "../../../electron/types";

interface SleepNightListProps {
  records: TrainingHubSleepRecord[];
  selectedDay: string | null;
  onSelect: (happenDay: string) => void;
  loading: boolean;
}

function scoreTone(score?: number): "low" | "mid" | "good" | "high" | "neutral" {
  if (score === undefined || !Number.isFinite(score)) {
    return "neutral";
  }
  if (score < 60) return "low";
  if (score < 75) return "mid";
  if (score < 90) return "good";
  return "high";
}

/**
 * The nights on file, newest first. Each row carries the three things worth
 * scanning down a column for — when, how long, how well — plus the stage strip,
 * which is the only way to see at a glance that a long night was mostly light.
 */
export function SleepNightList({
  records,
  selectedDay,
  onSelect,
  loading
}: SleepNightListProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // The trend chart selects nights too, and the one it picks is usually below
  // the fold of this list. Without this the detail pane changes and the list
  // appears not to have noticed.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedDay]);

  if (records.length === 0) {
    return (
      <p className="sleep-night-list-empty">
        {loading
          ? "Loading nights…"
          : "No nights on file yet. Sync your watch and refresh."}
      </p>
    );
  }

  return (
    // Plain list, plain buttons: a listbox would need its options to be the
    // listbox's own children, and `aria-current` says "this is the one on
    // screen" more accurately than a selection role does here anyway.
    <ul className="sleep-night-list" aria-label="Recent nights">
      {records.map((record) => {
        const selected = record.happenDay === selectedDay;
        const stages = drawableStages(record);
        const total = stages.reduce((sum, stage) => sum + stage.weight, 0);

        return (
          <li key={`${record.happenDay}:${record.kind ?? "main"}`}>
            <button
              type="button"
              ref={selected ? selectedRef : undefined}
              className={`sleep-night-row${selected ? " is-selected" : ""}`}
              onClick={() => onSelect(record.happenDay)}
              aria-current={selected ? "true" : undefined}
            >
              <div className="sleep-night-row-head">
                <span className="sleep-night-row-date">
                  {formatHappenDayLabel(record.happenDay)}
                </span>
                <span className={`sleep-night-row-score tone-${scoreTone(record.score)}`}>
                  {record.score !== undefined ? Math.round(record.score) : "–"}
                </span>
              </div>

              <div className="sleep-night-row-meta">
                <span>{formatSleepDurationMinutes(record.totalMinutes)}</span>
                {record.completeness === "partial" ? (
                  <span className="sleep-night-row-partial">
                    <AlertCircle size={12} aria-hidden="true" />
                    Partial
                  </span>
                ) : null}
              </div>

              {total > 0 ? (
                <div className="sleep-night-row-bar" aria-hidden="true">
                  {stages.map((stage) => (
                    <span
                      key={stage.key}
                      className={`sleep-stage-segment ${stage.className}`}
                      style={{ flexGrow: stage.weight }}
                    />
                  ))}
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
