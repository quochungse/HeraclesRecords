import { Check } from "lucide-react";
import { thoughtTail } from "../training-library/runTrail";
import { STEP_TITLE, type StepRun } from "./stepRun";

export { stepRunEvent, type StepRun } from "./stepRun";

/**
 * The skeleton of the card a pipeline step is making, drawn in the running
 * turn's bubble: a line per thing Coach did, the latest one still doing it,
 * and the words it is on. A long turn with only a spinner reads as stuck.
 */
export function CoachStepTrail({
  run,
  quiet = false
}: {
  run: StepRun;
  /**
   * An ordinary turn's trail, in its answer's bubble: the lines alone, with
   * no heading and no tail of the thinking, which has its own disclosure there.
   */
  quiet?: boolean;
}) {
  const tail = quiet ? "" : thoughtTail(run.notes.notes);
  const last = run.notes.trail.length - 1;
  return (
    <section
      className={quiet ? "chat-step-trail is-quiet" : "chat-step-trail"}
      aria-live="polite"
      aria-label={STEP_TITLE[run.step]}
    >
      {quiet ? null : <span className="chat-creation-kicker">{STEP_TITLE[run.step]}</span>}
      {run.notes.trail.length ? (
        <ol>
          {run.notes.trail.map((item, index) => {
            const doing = index === last && item.kind !== "passed";
            return (
              <li key={index} className={doing ? "is-doing" : undefined}>
                {doing ? <i aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
                <span>
                  {doing ? item.doing : item.done}
                  {item.count > 1 ? ` ×${item.count}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="chat-step-trail-tail">Starting…</p>
      )}
      {tail ? <p className="chat-step-trail-tail">{tail}</p> : null}
    </section>
  );
}
