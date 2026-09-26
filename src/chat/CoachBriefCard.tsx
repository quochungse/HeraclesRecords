import type { PlanBrief, TrainingPlanDataSources } from "../../electron/types";
import { SOURCES } from "../training-library/planGeneratorModel";
import {
  BRIEF_ORIGIN_LABEL,
  briefOpenProblems,
  briefRows,
  briefSpan,
  briefTitle
} from "./planBriefModel";

/**
 * A plan brief under the answer that set it out (docs/coach-plan-canvas.md,
 * P2.1): read-only, each field marked with where Coach took it from, and what
 * the conversation lets Coach read. Changing it is done on its own screen
 * (D10), which Edit brief opens.
 */
export function CoachBriefCard({
  brief,
  firstMonday,
  sources,
  editing = false,
  busy = false,
  onEdit,
  onDrawOutline
}: {
  brief: PlanBrief;
  firstMonday: string;
  /** What the conversation shares; absent while it loads. */
  sources?: TrainingPlanDataSources;
  /** Its screen is open: the way on is back into it. */
  editing?: boolean;
  /** A turn is running: the outline waits for it. */
  busy?: boolean;
  onEdit?: () => void;
  /**
   * Ask Coach for the outline (P2.2). Absent once there is one — its card
   * leads from then on — and while the brief still misses what it needs.
   */
  onDrawOutline?: () => void;
}) {
  const rows = briefRows(brief, firstMonday);
  const open = briefOpenProblems(brief.request, sources);
  const reads = sources
    ? SOURCES.filter((source) => sources[source.value]).map((source) => source.label)
    : undefined;

  return (
    <article className="chat-plan-card chat-creation-card chat-brief-card" data-artifact-id={brief.artifactId}>
      <header className="chat-creation-head">
        <div>
          <span className="chat-creation-kicker">Plan brief</span>
          <h4>{briefTitle(brief.request)}</h4>
          <span className="chat-plan-card-summary">{briefSpan(brief.request)}</span>
        </div>
        <div className="chat-creation-head-aside">
          <span className="chat-creation-status">Brief</span>
        </div>
      </header>

      <dl className="chat-brief-rows">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>
              <span>{row.value}</span>
              {row.origin ? (
                <small className="chat-brief-origin" data-origin={row.origin}>
                  {BRIEF_ORIGIN_LABEL[row.origin]}
                </small>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      {reads ? (
        <p className="chat-brief-reads">
          Coach reads {reads.length ? reads.join(" · ") : "nothing of yours"} in this conversation
        </p>
      ) : null}
      {open.length ? (
        <ul className="chat-brief-open" aria-label="Still open">
          {open.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="chat-creation-actions">
        <div className="chat-plan-actions">
          {onDrawOutline ? (
            <button type="button" className="chat-plan-upload" disabled={busy} onClick={onDrawOutline}>
              Draw the outline
            </button>
          ) : null}
          <button type="button" className="chat-plan-review" disabled={!onEdit} onClick={onEdit}>
            {editing ? "Continue editing" : "Edit brief"}
          </button>
        </div>
      </div>
    </article>
  );
}
