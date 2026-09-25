import { RotateCw } from "lucide-react";
import type { CSSProperties } from "react";
import type { TrainingPlanOutline, WorkoutSport } from "../../electron/types";
import { PLAN_WEEKDAYS, addPlanWeeks } from "../../electron/trainingPlanGeneration";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { addPlanDays, formatHours, formatPlanDate } from "./planGeneratorModel";
import { stageLabel, stageSlug } from "./GeneratorRun";
import { sportTheme } from "./sportTheme";

interface GeneratorOutlineStepProps {
  outline: TrainingPlanOutline;
  startDate: string;
  /** Coach chose the length: the intro says so. */
  lengthChosen: boolean;
  selected: number;
  onSelect: (weekIndex: number) => void;
  note: string;
  onNote: (note: string) => void;
  onRedraw: () => void;
  redrawDisabled: boolean;
}

/** The tallest bar, in pixels. */
const BAR_MAX = 118;

/**
 * The plan's shape before a session is written: a bar a week, as tall as its
 * hours and coloured by its stage, and the week picked out below — what it is
 * for and the sessions it is built around. The athlete may ask for a change
 * in their own words and have it redrawn, as often as they like.
 */
export function GeneratorOutlineStep({
  outline,
  startDate,
  lengthChosen,
  selected,
  onSelect,
  note,
  onNote,
  onRedraw,
  redrawDisabled
}: GeneratorOutlineStepProps) {
  const peak = Math.max(0.5, ...outline.weeks.map((week) => week.hours));
  const week = outline.weeks[Math.min(selected, outline.weeks.length - 1)];
  const index = outline.weeks.indexOf(week);
  const monday = addPlanWeeks(startDate, index);
  const stages = [...new Set(outline.weeks.map((item) => item.stage))].sort((a, b) => a - b);

  return (
    <div className="plan-generator-step plan-generator-outline">
      <div className="plan-generator-step-head">
        <div>
          <h3>The plan&rsquo;s shape</h3>
          <p>
            {lengthChosen ? `Coach chose ${outline.weeks.length} weeks for this goal. ` : ""}
            {outline.summary}
          </p>
        </div>
        <ul className="plan-generator-outline-legend" aria-label="Stages">
          {stages.map((stage) => (
            <li key={stage} data-stage={stageSlug(stage)}>{stageLabel(stage)}</li>
          ))}
        </ul>
      </div>

      <div className="plan-generator-outline-bars" role="group" aria-label="Weeks">
        {outline.weeks.map((item, weekIndex) => (
          <button
            type="button"
            key={weekIndex}
            className={`plan-generator-outline-bar${weekIndex === index ? " is-selected" : ""}${item.lighter ? " is-lighter" : ""}`}
            data-stage={stageSlug(item.stage)}
            aria-pressed={weekIndex === index}
            aria-label={`Week ${weekIndex + 1}, ${stageLabel(item.stage)}${item.lighter ? ", lighter week" : ""}, ${formatHours(item.hours * 60)}`}
            onClick={() => onSelect(weekIndex)}
          >
            <small>{formatHours(item.hours * 60)}</small>
            <span style={{ height: `${Math.max(8, Math.round((item.hours / peak) * BAR_MAX))}px` }} />
            <em>W{weekIndex + 1}</em>
          </button>
        ))}
      </div>

      <section className="plan-generator-outline-week" data-stage={stageSlug(week.stage)} aria-live="polite">
        <header>
          <span>Week {index + 1} · {formatPlanDate(monday)} – {formatPlanDate(addPlanDays(monday, 6))}</span>
          <strong>{stageLabel(week.stage)}{week.lighter ? " · lighter week" : ""}</strong>
          <small>{week.sessions} sessions · {formatHours(week.hours * 60)}</small>
        </header>
        {week.focus ? <p>{week.focus}</p> : null}
        {week.keySessions.length ? (
          <ul>
            {week.keySessions.map((session, at) => (
              <li key={at} style={{ "--sport-accent": sportTheme(session.sport as WorkoutSport).color } as CSSProperties}>
                <span>{PLAN_WEEKDAYS[session.dayIndex].slice(0, 3)}</span>
                <i aria-hidden="true" />
                <strong>{session.name}</strong>
                <small>{formatWorkoutSport(session.sport)}{session.minutes ? ` · ${session.minutes} min` : ""}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="plan-generator-note"><strong>What Coach read:</strong> {outline.basis}</p>

      <form
        className="plan-generator-redraw"
        onSubmit={(event) => {
          event.preventDefault();
          if (!redrawDisabled) onRedraw();
        }}
      >
        <input
          id="plan-generator-outline-note"
          value={note}
          maxLength={400}
          placeholder="Ask Coach to change the outline — e.g. “a lighter week 5, I’m travelling”"
          aria-label="What to change in the outline"
          onChange={(event) => onNote(event.target.value)}
        />
        <button type="submit" className="ghost-button" disabled={redrawDisabled}>
          <RotateCw size={13} /> Redraw outline
        </button>
      </form>
    </div>
  );
}
