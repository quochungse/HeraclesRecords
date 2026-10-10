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
import { t } from "../i18n/core";

function stageOptions() {
  return OUTLINE_STAGES.map((stage) => ({ value: String(stage.value), label: stage.label }));
}

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
              <h2 id="coach-outline-title">{t("chat.outline.adjust")}</h2>
            </div>
            <button type="button" className="icon-button" aria-label={t("chat.outline.close")} onClick={onClose}>
              <X size={17} />
            </button>
          </header>

          <div className="chat-outline-editor-body">
            <p className="chat-outline-editor-lede">
              {outlineSpan(outline)}. {t("chat.outline.editorLede")}
            </p>
            <ol className="chat-outline-editor-weeks">
              {outline.weeks.map((week, index) => (
                <li key={index} data-stage={outlineStageSlug(week.stage)}>
                  <span className="chat-outline-editor-week">
                    <strong>{t("chat.refs.week", { n: index + 1 })}</strong>
                    <small>{formatPlanDate(outlineWeekMonday(brief, index))}</small>
                  </span>
                  <OptionGroup
                    label={t("chat.outline.stageOf", { n: index + 1 })}
                    mode="dropdown"
                    size="sm"
                    className="chat-outline-editor-stage"
                    value={String(week.stage)}
                    options={stageOptions()}
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
                      aria-label={t("chat.outline.hoursIn", { n: index + 1 })}
                      onChange={(event) =>
                        setOutline((current) => withOutlineWeek(current, index, { hours: figure(event.target.value) }))
                      }
                    />
                    <span>h</span>{/* i18n-ignore: a unit symbol */}
                  </label>
                  <label className="chat-outline-editor-figure">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={week.sessions}
                      aria-label={t("chat.outline.sessionsIn", { n: index + 1 })}
                      onChange={(event) =>
                        setOutline((current) =>
                          withOutlineWeek(current, index, { sessions: figure(event.target.value) })
                        )
                      }
                    />
                    <span>{t("chat.outline.sessionsUnit")}</span>
                  </label>
                  <label className="chat-outline-editor-lighter">
                    <input
                      type="checkbox"
                      checked={week.lighter}
                      onChange={(event) =>
                        setOutline((current) => withOutlineWeek(current, index, { lighter: event.target.checked }))
                      }
                    />
                    {t("chat.outline.lighterLabel")}
                  </label>
                  {week.focus ? <p className="chat-outline-editor-focus">{week.focus}</p> : null}
                </li>
              ))}
            </ol>
          </div>

          <footer>
            <p className="plan-generator-footer-hint" role={problems.length || error ? "alert" : undefined}>
              {error ?? problems[0] ?? (changed ? t("chat.outline.savedNext") : t("chat.outline.nothingChanged"))}
              {!error && problems.length > 1 ? ` (${t("chat.event.more", { n: problems.length - 1 })})` : ""}
            </p>
            <button type="button" className="ghost-button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={saving || !changed || problems.length > 0}
              onClick={() => onSave(outline)}
            >
              {saving ? t("library.ed.saving") : t("chat.outline.save")}
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body
  );
}
