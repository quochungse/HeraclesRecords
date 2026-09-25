import { AlertTriangle, ArrowRight, Check, CheckCheck, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import type { TrainingPlanDocument, TrainingPlanOutline } from "../../electron/types";
import { COROS_WEEK_STAGES } from "../../electron/trainingPlanDomain";
import { formatHours } from "./planGeneratorModel";
import { readPlan } from "./planReaderModel";
import { PlanWeekRidge } from "./PlanWeekRidge";
import { WeekCard } from "./PlanReader";
import { thoughtTail, type RunNotes } from "./runTrail";

/** What a running generation has said so far. `stage` only ever moves forward. */
export interface RunState {
  /** An outline turn, or the turn that writes the sessions. */
  kind: "outline" | "plan";
  requestId: string;
  startedAt: number;
  stage: number;
  activity: string;
  /** How many times the model has handed a plan to the check. */
  attempts: number;
  /** What the run has done so far, and the words it is on now. */
  notes: RunNotes;
}

/** How a finished run landed: the plan, and whether it is kept in the library yet. */
export interface Finished {
  plan: TrainingPlanDocument;
  draftId?: string;
  keeping: boolean;
  keepError?: string;
  /** Being written to COROS from the last step. */
  saving?: boolean;
  saveError?: string;
  /** The plan as COROS saved it; the draft is gone once this is here. */
  saved?: TrainingPlanDocument;
  /** Put on the calendar from the last step. */
  scheduled?: boolean;
}

/**
 * The run's four steps. The stream says which tools the model calls, not how
 * far it has got, so a step is inferred from the kind of event and never goes
 * back: a read after the model has started writing changes the line under the
 * steps, not the step. It used to be set straight from each event, so a tool
 * call after the first tokens stepped the list back to "Reviewing", and a
 * failed read put its raw error text where the step was.
 */
export const RUN_STAGES: Record<RunState["kind"], readonly string[]> = {
  outline: ["Reading your training", "Drawing the outline", "Checking it against your week"],
  plan: ["Reading your training", "Designing the plan", "Writing the sessions", "Checking every week"]
};

export function stageSlug(stage: number): string | undefined {
  return COROS_WEEK_STAGES.find((candidate) => candidate.value === stage)?.slug;
}

export function stageLabel(stage: number): string {
  return COROS_WEEK_STAGES.find((candidate) => candidate.value === stage)?.label ?? "Not set";
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A run in progress. Writing to an outline, the weeks it will fill are listed
 * under the steps — all in one state, because the draft tool is handed the
 * whole plan at once and says nothing about a week until it has all of them.
 */
export function GeneratorRun({ run, now, outline }: { run: RunState; now: number; outline?: TrainingPlanOutline }) {
  const weekState = run.stage >= 3 ? "Checked" : run.stage >= 2 ? "Writing…" : "Queued";
  return (
    <div className={`plan-generator-run${outline && run.kind === "plan" ? " has-weeks" : ""}`} aria-live="polite">
      <span className="plan-generator-pulse"><Sparkles size={18} /></span>
      <strong>{run.kind === "outline" ? "Drawing the outline" : "Writing your plan"}</strong>
      <p className="plan-generator-run-activity">{run.activity}</p>
      {/* The weeks first, under the title: everything below them grows as the
          run goes on, and the weeks were being pushed down the screen by it. */}
      {outline && run.kind === "plan" ? (
        <ul className="plan-generator-run-weeks">
          {outline.weeks.map((week, index) => (
            <li key={index} data-stage={stageSlug(week.stage)} data-state={weekState}>
              <span>Week {index + 1}</span>
              <small>{stageLabel(week.stage)}{week.lighter ? " · lighter" : ""} · {week.sessions} sessions</small>
              <em>{weekState}</em>
            </li>
          ))}
        </ul>
      ) : null}
      {run.attempts > 1 ? (
        <p className="plan-generator-run-checks">
          The check sent {run.kind === "outline" ? "the outline" : "the plan"} back {run.attempts - 1 === 1 ? "once" : `${run.attempts - 1} times`}; Coach is fixing what it found.
        </p>
      ) : null}
      <ol className="plan-generator-stages">
        {RUN_STAGES[run.kind].map((label, index) => (
          <li key={label} className={index < run.stage ? "is-done" : index === run.stage ? "is-active" : ""}>
            <span className="plan-generator-stage-dot">{index < run.stage ? <Check size={10} /> : null}</span>
            {label}
          </li>
        ))}
      </ol>
      <RunTrail notes={run.notes} />
      <p className="plan-generator-run-time">
        <span className="plan-generator-elapsed">{formatElapsed(now - run.startedAt)}</span>
        {run.kind === "outline"
          ? "Coach reads your training and proposes the plan's shape. Nothing is written until you have read it."
          : "A long plan can take a few minutes. Every draft is checked against your days, your time and the outline, and Coach fixes what the check finds."}
      </p>
    </div>
  );
}

/** How many lines of the trail stand on screen; the ones before are counted. */
const TRAIL_SHOWN = 6;

/**
 * What Coach has done so far, a line each, and the words its thinking is on
 * now. The latest line is what it is doing; the ones before, what it did.
 * The words are hidden from assistive technology: they change with every
 * token, and the run's live region would read each one out.
 */
function RunTrail({ notes }: { notes: RunNotes }) {
  const { trail } = notes;
  const tail = thoughtTail(notes.notes);
  if (!trail.length && !tail) return null;
  const hidden = Math.max(0, trail.length - TRAIL_SHOWN);
  return (
    <section className="plan-generator-trail" aria-label="What Coach is doing">
      <p className="tl-eyebrow">What Coach is doing</p>
      {hidden ? <p className="plan-generator-trail-earlier">{hidden === 1 ? "1 earlier step" : `${hidden} earlier steps`}</p> : null}
      <ol>
        {trail.slice(hidden).map((item, index) => {
          const latest = hidden + index === trail.length - 1;
          const mark = item.kind === "passed"
            ? <CheckCheck size={12} />
            : item.kind === "check"
              ? <RotateCcw size={11} />
              : item.kind === "thought"
                ? <Sparkles size={11} />
                : latest ? <LoaderCircle className="is-spinning" size={12} /> : <Check size={12} />;
          return (
            <li key={hidden + index} data-kind={item.kind} className={latest ? "is-latest" : undefined}>
              <span className="plan-generator-trail-mark" aria-hidden="true">{mark}</span>
              <span>
                {latest ? item.doing : item.done}
                {item.count > 1 ? <small> ×{item.count}</small> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {tail ? <p className="plan-generator-trail-thought" aria-hidden="true">{tail}</p> : null}
    </section>
  );
}

/**
 * The plan, kept. Its shape is the reader's ridge and its weeks are the
 * reader's cards — the pictures of a plan this app already draws — and each
 * bar of the ridge scrolls to its week.
 */
export function GeneratorDone({ finished }: { finished: Finished }) {
  const { plan } = finished;
  const reading = readPlan(plan);
  const sessions = plan.entries.length;
  const minutes = reading.timed
    ? reading.weeks.reduce((sum, week) => sum + week.summary.durationSeconds / 60, 0) / Math.max(1, plan.weekCount)
    : undefined;
  const figures = [
    { label: "Weeks", value: String(plan.weekCount) },
    { label: "Sessions", value: String(sessions) },
    { label: "A week", value: minutes ? `about ${formatHours(minutes)}` : `${Math.round((sessions / Math.max(1, plan.weekCount)) * 10) / 10} sessions` }
  ];
  return (
    <div className="plan-generator-done" aria-live="polite">
      {/* The plan exists from here on — kept as a draft before anything is
          asked — and the head says so plainly, in the success ink, so the
          buttons below read as what to do with it rather than how to make it. */}
      <div className="plan-generator-done-head">
        <span className={`plan-generator-done-mark${finished.keeping || finished.saving ? " is-busy" : ""}`} aria-hidden="true">
          {finished.keeping || finished.saving ? <LoaderCircle className="is-spinning" size={24} /> : <Check size={30} strokeWidth={2.6} />}
        </span>
        <div>
          <p className="plan-generator-done-title">
            {finished.scheduled
              ? "Plan created and on your calendar"
              : finished.saved
                ? "Plan created and saved to COROS"
                : finished.draftId
                  ? "Plan created and saved as a draft"
                  : "Plan created"}
          </p>
          <strong className="plan-generator-done-name">{plan.name}</strong>
        </div>
      </div>
      <p className="plan-generator-done-kept">
        {finished.scheduled
          ? "Saved to COROS and on your calendar."
          : finished.saved
            ? "Saved to COROS. Add it to your calendar when you are ready to start."
            : finished.saving
              ? "Saving it to COROS…"
              : finished.keeping
                ? "Keeping it as a draft in your library…"
                : finished.keepError
                  ? null
                  : "Kept as a draft in your library. Save it to COROS as it is, add it to your calendar from a day you pick, or edit it first."}
      </p>
      {finished.saveError ? (
        <p className="plan-generator-done-warning" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          It was not saved to COROS ({finished.saveError}). It is still a draft in your library.
        </p>
      ) : null}
      {finished.keepError && !finished.saved ? (
        <p className="plan-generator-done-warning" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          It could not be kept as a draft ({finished.keepError}). Open it in the editor and save it there, or it is gone when this closes.
        </p>
      ) : null}
      {plan.description ? <p className="plan-generator-done-overview">{plan.description}</p> : null}
      <dl className="plan-generator-done-figures">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt>{figure.label}</dt>
            <dd>{figure.value}</dd>
          </div>
        ))}
      </dl>
      {reading.weeks.length > 2 ? (
        <div className="plan-generator-done-ridge">
          <PlanWeekRidge
            weeks={reading.weeks}
            onJump={(weekIndex) =>
              document.querySelector(`.plan-generator-done-weeks [data-week="${weekIndex}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })
            }
          />
        </div>
      ) : null}
      {finished.saved ? null : (
        <p className="plan-generator-note">
          Want to change a session first? Edit plan opens it in the editor, where it saves the same way. <ArrowRight size={12} aria-hidden="true" />
        </p>
      )}
      {/* Week by week, as the reader draws it; each ridge bar scrolls to its week. */}
      <p className="tl-eyebrow plan-generator-done-weeks-title">Week by week</p>
      <ol className="plan-reader-weeks plan-generator-done-weeks">
        {reading.weeks.map((week) => (
          <WeekCard key={week.weekIndex} week={week} />
        ))}
      </ol>
    </div>
  );
}
