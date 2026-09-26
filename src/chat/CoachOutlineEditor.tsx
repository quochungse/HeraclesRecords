import { Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlanBrief, TrainingPlanOutline, TrainingPlanWeekStage } from "../../electron/types";
import { OptionGroup } from "../components/OptionGroup";
import { formatPlanDate } from "../training-library/planGeneratorModel";
import "../training-library/trainingLibrary.css";
import { briefTitle } from "./planBriefModel";
import {
  OUTLINE_STAGES,
  outlineChanged,
  outlineProblems,
  outlineSpan,
  outlineStageSlug,
  outlineWeekMonday,
  withOutlineWeek
} from "./planOutlineModel";

const STAGE_OPTIONS = OUTLINE_STAGES.map((stage) => ({ value: String(stage.value), label: stage.label }));

/**
 * An outline's own screen (docs/coach-plan-canvas.md, P2.2): the athlete's
 * figures for each week — its stage, its hours, its sessions, whether it is a
 * lighter week — checked as they are typed by the outline tool's own
 * `planOutlineProblems`. No model is asked; a save is the outline's next
 * version, by the athlete. What a week is for and the sessions it is built
 * around are Coach's, and change with a redraw.
 *
 * Loaded when first opened, with the library's stylesheet its sheet is drawn by.
 */
export default function CoachOutlineEditor({
  brief,
  saving = false,
  error,
  onSave,
  onClose
}: {
  brief: PlanBrief & { outline: NonNullable<PlanBrief["outline"]> };
  saving?: boolean;
  error?: string | null;
  onSave: (outline: TrainingPlanOutline) => void;
  onClose: () => void;
}) {
  const [outline, setOutline] = useState<TrainingPlanOutline>(brief.outline.outline);
  const problems = useMemo(() => outlineProblems(outline, brief), [outline, brief]);
  const changed = outlineChanged(brief.outline.outline, outline);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const figure = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

  return createPortal(
    <div className="coach-sheet">
      <div className="plan-generator-backdrop">
        <section
          className="plan-generator chat-outline-editor"
          role="dialog"
          aria-modal="true"
          aria-labelledby="coach-outline-title"
        >
          <header>
            <span className="plan-generator-title-icon"><Sparkles size={16} /></span>
            <div className="plan-generator-heading">
              <p className="tl-eyebrow">{briefTitle(brief.request)}</p>
              <h2 id="coach-outline-title">Adjust outline</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Close outline" onClick={onClose}>
              <X size={17} />
            </button>
          </header>

          <div className="chat-outline-editor-body">
            <p className="chat-outline-editor-lede">
              {outlineSpan(outline)}. Change a week&rsquo;s stage, time or sessions here; ask Coach to redraw it for
              anything else.
            </p>
            <ol className="chat-outline-editor-weeks">
              {outline.weeks.map((week, index) => (
                <li key={index} data-stage={outlineStageSlug(week.stage)}>
                  <span className="chat-outline-editor-week">
                    <strong>Week {index + 1}</strong>
                    <small>{formatPlanDate(outlineWeekMonday(brief, index))}</small>
                  </span>
                  <OptionGroup
                    label={`Stage of week ${index + 1}`}
                    mode="dropdown"
                    size="sm"
                    className="chat-outline-editor-stage"
                    value={String(week.stage)}
                    options={STAGE_OPTIONS}
                    onChange={(value) =>
                      setOutline((current) =>
                        withOutlineWeek(current, index, { stage: Number(value) as TrainingPlanWeekStage })
                      )
                    }
                  />
                  <label className="chat-outline-editor-figure">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={week.hours}
                      aria-label={`Hours in week ${index + 1}`}
                      onChange={(event) =>
                        setOutline((current) => withOutlineWeek(current, index, { hours: figure(event.target.value) }))
                      }
                    />
                    <span>h</span>
                  </label>
                  <label className="chat-outline-editor-figure">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={week.sessions}
                      aria-label={`Sessions in week ${index + 1}`}
                      onChange={(event) =>
                        setOutline((current) =>
                          withOutlineWeek(current, index, { sessions: figure(event.target.value) })
                        )
                      }
                    />
                    <span>sessions</span>
                  </label>
                  <label className="chat-outline-editor-lighter">
                    <input
                      type="checkbox"
                      checked={week.lighter}
                      onChange={(event) =>
                        setOutline((current) => withOutlineWeek(current, index, { lighter: event.target.checked }))
                      }
                    />
                    Lighter
                  </label>
                  {week.focus ? <p className="chat-outline-editor-focus">{week.focus}</p> : null}
                </li>
              ))}
            </ol>
          </div>

          <footer>
            <p className="plan-generator-footer-hint" role={problems.length || error ? "alert" : undefined}>
              {error ?? problems[0] ?? (changed ? "Saved as the outline’s next version." : "Nothing changed yet.")}
              {!error && problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}
            </p>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={saving || !changed || problems.length > 0}
              onClick={() => onSave(outline)}
            >
              {saving ? "Saving…" : "Save outline"}
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body
  );
}
