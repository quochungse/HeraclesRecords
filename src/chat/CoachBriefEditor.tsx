import { Check, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlanBrief, PlanBriefRequest, TrainingPlanDataSources } from "../../electron/types";
import { generationRequestProblems, type TrainingPlanGenerationField } from "../../electron/trainingPlanGeneration";
import { GeneratorGoalStep } from "../training-library/GeneratorGoalStep";
import { GeneratorWeekStep } from "../training-library/GeneratorWeekStep";
import {
  SOURCES,
  STEP_FIELDS,
  planSnapshot,
  requestFromForm,
  spanSentence,
  type GeneratorForm
} from "../training-library/planGeneratorModel";
import "../training-library/trainingLibrary.css";
import { briefAsRequest, briefFromForm, formFromBrief } from "./planBriefModel";

type BriefStep = "goal" | "week";

const STEPS: readonly { step: BriefStep; label: string }[] = [
  { step: "goal", label: "Goal" },
  { step: "week", label: "Your week" }
];

/**
 * A plan brief's own screen (docs/coach-plan-canvas.md, P2.1, D10): the plan
 * generator's Goal and Your week steps, over the brief Coach set out. What
 * Coach may read is the conversation's, so its switches here change the
 * conversation — "From my data" sits beside the Activities switch it needs.
 *
 * Saving keeps whatever is there, open questions included: the card lists
 * them, and drawing the outline waits for them.
 *
 * Loaded when first opened, with the library's stylesheet its steps are drawn by.
 */
export default function CoachBriefEditor({
  brief,
  firstMonday,
  sources,
  saving = false,
  error,
  onSourcesChange,
  onSave,
  onClose
}: {
  brief: PlanBrief;
  firstMonday: string;
  sources: TrainingPlanDataSources;
  saving?: boolean;
  error?: string | null;
  onSourcesChange: (sources: TrainingPlanDataSources) => void;
  onSave: (request: PlanBriefRequest) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<GeneratorForm>(() => formFromBrief(brief.request, firstMonday, sources));
  const [step, setStep] = useState<BriefStep>("goal");
  // The form holds the sources only for its checks; the switches write the conversation's.
  const current = { ...form, sources };
  const request = useMemo(() => requestFromForm(current, firstMonday), [form, sources, firstMonday]);
  const problems = useMemo(
    () => generationRequestProblems(briefAsRequest(briefFromForm(current, firstMonday), sources), new Date()),
    [form, sources, firstMonday]
  );
  const stepOf = (field: TrainingPlanGenerationField): BriefStep => (STEP_FIELDS.goal.includes(field) ? "goal" : "week");
  const problemOf = (field: string) => problems.find((problem) => problem.field === field)?.message;
  const update = (patch: Partial<GeneratorForm>) => setForm((value) => ({ ...value, ...patch }));

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

  const stepProps = {
    form: current,
    firstMonday,
    update,
    problemOf,
    spanSentence: spanSentence(request)
  };

  return createPortal(
    <div className="coach-sheet">
      <div className="plan-generator-backdrop">
        <section className="plan-generator" role="dialog" aria-modal="true" aria-labelledby="coach-brief-title">
          <header>
            <span className="plan-generator-title-icon"><Sparkles size={16} /></span>
            <div className="plan-generator-heading">
              <p className="tl-eyebrow">Training Coach</p>
              <h2 id="coach-brief-title">Plan brief</h2>
            </div>
            <nav className="plan-generator-steps" aria-label="Steps">
              {STEPS.map((item, index) => {
                const currentStep = item.step === step;
                const flagged = problems.some((problem) => stepOf(problem.field) === item.step);
                return (
                  <button
                    type="button"
                    key={item.step}
                    className={currentStep ? "is-current" : flagged ? "" : "is-done"}
                    aria-current={currentStep ? "step" : undefined}
                    disabled={currentStep}
                    onClick={() => setStep(item.step)}
                  >
                    <span>{!currentStep && !flagged ? <Check size={10} /> : index + 1}</span>
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <button type="button" className="icon-button" aria-label="Close plan brief" onClick={onClose}>
              <X size={17} />
            </button>
          </header>

          <div className="plan-generator-body">
            <aside className="plan-generator-status">
              <p className="tl-eyebrow">What Coach reads</p>
              <ul className="plan-generator-sources">
                {SOURCES.map((source) => {
                  const on = sources[source.value];
                  return (
                    <li key={source.value}>
                      <span>
                        <strong id={`coach-brief-source-${source.value}`}>{source.label}</strong>
                        <small>{on ? source.detail : "Not shared in this conversation"}</small>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        className="plan-generator-source"
                        aria-checked={on}
                        aria-labelledby={`coach-brief-source-${source.value}`}
                        onClick={() => onSourcesChange({ ...sources, [source.value]: !on })}
                      >
                        <span />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="tl-eyebrow plan-generator-aside-eyebrow">Plan</p>
              <dl className="plan-generator-snapshot">
                {planSnapshot(current, request).map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
            <div className="plan-generator-form">
              {step === "goal" ? <GeneratorGoalStep {...stepProps} /> : <GeneratorWeekStep {...stepProps} />}
            </div>
          </div>

          <footer>
            <p className="plan-generator-footer-hint">
              {error ?? problems[0]?.message ?? "Coach draws the outline from this brief."}
            </p>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            {step === "goal" ? (
              <button type="button" className="ghost-button" onClick={() => setStep("week")}>
                Your week
              </button>
            ) : null}
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() => onSave(briefFromForm(current, firstMonday))}
            >
              {saving ? "Saving…" : "Save brief"}
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body
  );
}
