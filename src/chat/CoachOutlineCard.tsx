import { RotateCw } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { PlanBrief, WorkoutSport } from "../../electron/types";
import { PLAN_WEEKDAYS } from "../../electron/trainingPlanGeneration";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { addPlanDays, formatPlanDate } from "../training-library/planGeneratorModel";
import { sportTheme } from "../training-library/sportTheme";
import { briefTitle } from "./planBriefModel";
import {
  outlineProblems,
  outlineSpan,
  outlineStageBands,
  outlineStageLabel,
  outlineStageSlug,
  outlineWeekMonday
} from "./planOutlineModel";

/** The tallest bar, in pixels. */
const BAR_MAX = 64;

/**
 * A brief's outline under the answer that drew it (docs/coach-plan-canvas.md,
 * P2.2): read-only, a bar a week as tall as its hours and coloured by its
 * stage, and the week picked out below. Changing it is either the athlete's
 * own figures (Adjust outline, no model) or Coach's redraw with a note.
 *
 * Only the artifact's current outline is drawn: an older anchor folds to a
 * line in the conversation, since the artifact keeps one outline.
 */
export function CoachOutlineCard({
  brief,
  busy = false,
  editing = false,
  written = false,
  blocked,
  onWriteSessions,
  onAdjust,
  onRedraw
}: {
  brief: PlanBrief & { outline: NonNullable<PlanBrief["outline"]> };
  /** A turn is running: nothing here may start another. */
  busy?: boolean;
  /** Its Adjust screen is open: the way on is back into it. */
  editing?: boolean;
  /** The sessions are written (P2.3): the plan is changed from its own card from here on. */
  written?: boolean;
  /** What the brief still misses for the sessions to be written, as the main process would refuse it. */
  blocked?: string;
  onWriteSessions?: () => void;
  onAdjust?: () => void;
  onRedraw?: (note: string) => void;
}) {
  const { outline, version, author } = brief.outline;
  const [selected, setSelected] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const index = Math.min(selected, outline.weeks.length - 1);
  const week = outline.weeks[index];
  const monday = outlineWeekMonday(brief, index);
  const peak = Math.max(0.5, ...outline.weeks.map((item) => item.hours));
  const problems = outlineProblems(outline, brief);

  const submitNote = () => {
    const said = note.trim();
    if (!said || busy || !onRedraw) return;
    onRedraw(said);
    setNote("");
    setNoteOpen(false);
  };

  return (
    <article
      className="chat-plan-card chat-creation-card chat-outline-card"
      data-artifact-id={brief.artifactId}
      data-outline-version={version}
    >
      <header className="chat-creation-head">
        <div>
          <span className="chat-creation-kicker">Plan outline</span>
          <h4>{briefTitle(brief.request)}</h4>
          <span className="chat-plan-card-summary">{outlineSpan(outline)}</span>
        </div>
        <div className="chat-creation-head-aside">
          <span className="chat-creation-status">
            {author === "athlete" ? "Adjusted by you" : "Outline"}
            {version > 1 ? ` · v${version}` : ""}
          </span>
        </div>
      </header>

      {outline.summary ? <p className="chat-outline-summary">{outline.summary}</p> : null}

      <div
        className="chat-outline-ridge"
        style={{ "--chat-outline-weeks": outline.weeks.length } as CSSProperties}
      >
        <div className="chat-outline-bars" role="group" aria-label="Weeks">
          {outline.weeks.map((item, weekIndex) => (
            <button
              type="button"
              key={weekIndex}
              className={`chat-outline-bar${weekIndex === index ? " is-selected" : ""}${item.lighter ? " is-lighter" : ""}`}
              data-stage={outlineStageSlug(item.stage)}
              aria-pressed={weekIndex === index}
              aria-label={`Week ${weekIndex + 1}, ${outlineStageLabel(item.stage)}${item.lighter ? ", lighter week" : ""}, ${item.hours} hours`}
              onClick={() => setSelected(weekIndex)}
            >
              <span style={{ height: `${Math.max(6, Math.round((item.hours / peak) * BAR_MAX))}px` }} />
            </button>
          ))}
        </div>
        <div className="chat-outline-band" aria-hidden="true">
          {outlineStageBands(outline).map((band) => (
            <span
              key={band.start}
              data-stage={outlineStageSlug(band.stage)}
              style={{ gridColumn: `${band.start + 1} / span ${band.span}` }}
              title={outlineStageLabel(band.stage)}
            />
          ))}
        </div>
      </div>

      <section className="chat-outline-week" data-stage={outlineStageSlug(week.stage)} aria-live="polite">
        <header>
          <strong>
            Week {index + 1} · {outlineStageLabel(week.stage)}
            {week.lighter ? " · lighter" : ""}
          </strong>
          <small>
            {formatPlanDate(monday)} – {formatPlanDate(addPlanDays(monday, 6))} · {week.sessions} sessions · {week.hours} h
          </small>
        </header>
        {week.focus ? <p>{week.focus}</p> : null}
        {week.keySessions.length ? (
          <ul>
            {week.keySessions.map((session, at) => (
              <li
                key={at}
                style={{ "--sport-accent": sportTheme(session.sport as WorkoutSport).color } as CSSProperties}
              >
                <span>{PLAN_WEEKDAYS[session.dayIndex]?.slice(0, 3)}</span>
                <strong>{session.name}</strong>
                <small>
                  {formatWorkoutSport(session.sport)}
                  {session.minutes ? ` · ${session.minutes} min` : ""}
                </small>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {outline.basis ? (
        <p className="chat-brief-reads">
          <strong>What Coach read:</strong> {outline.basis}
        </p>
      ) : null}
      {problems.length ? (
        <ul className="chat-brief-open" aria-label="Does not fit the brief">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {written ? (
        <p className="chat-brief-reads">The sessions are written to this outline — change the plan from its card.</p>
      ) : (
        <div className="chat-creation-actions">
          <div className="chat-plan-actions">
            {onWriteSessions ? (
              <button
                type="button"
                className="chat-plan-upload"
                disabled={busy || problems.length > 0 || Boolean(blocked)}
                title={
                  blocked
                    ? blocked
                    : problems.length
                      ? "Adjust or redraw the outline so it fits the brief first"
                      : undefined
                }
                onClick={onWriteSessions}
              >
                Write the sessions
              </button>
            ) : null}
            <button type="button" className="chat-plan-review" disabled={!onAdjust} onClick={onAdjust}>
              {editing ? "Continue adjusting" : "Adjust outline"}
            </button>
            <button
              type="button"
              className="chat-plan-review"
              aria-expanded={noteOpen}
              disabled={!onRedraw || busy}
              onClick={() => setNoteOpen((open) => !open)}
            >
              <RotateCw size={13} aria-hidden="true" /> Redraw with a note
            </button>
          </div>
          {noteOpen ? (
            <form
              className="chat-outline-redraw"
              onSubmit={(event) => {
                event.preventDefault();
                submitNote();
              }}
            >
              <input
                value={note}
                maxLength={400}
                autoFocus
                placeholder="What to change — e.g. “a lighter week 5, I’m travelling”"
                aria-label="What to change in the outline"
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setNoteOpen(false);
                  }
                }}
              />
              <button type="submit" className="chat-plan-upload" disabled={busy || !note.trim()}>
                Redraw
              </button>
            </form>
          ) : null}
        </div>
      )}
    </article>
  );
}
