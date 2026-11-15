import { useMemo } from "react";
import type { RunWorkoutEditorDraft, WorkoutEditorContext, WorkoutExerciseOption } from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { messageRecord, t } from "../i18n/core";
import {
  compareFieldLabel,
  compareWorkoutDrafts,
  type CompareCell,
  type CompareStatus
} from "./workoutCompare";

const STATUS_LABEL = messageRecord<Exclude<CompareStatus, "same">>({
  changed: "workout.compare.changed",
  added: "workout.compare.added",
  removed: "workout.compare.removed"
});

/**
 * Two workouts side by side, step against step (`workoutCompare.ts`): what a
 * proposed change would make of the session it acts on. The two views of the
 * dialog say what each workout is; this says where they part, which reading
 * one and then the other left to memory.
 */
export function WorkoutCompareBody({
  before,
  after,
  beforeLabel,
  afterLabel,
  context,
  exercisesById
}: {
  before: RunWorkoutEditorDraft;
  after: RunWorkoutEditorDraft;
  beforeLabel: string;
  afterLabel: string;
  /** The account's context; absent while it is read, and the session's distance and time wait for it. */
  context?: WorkoutEditorContext;
  exercisesById?: ReadonlyMap<string, WorkoutExerciseOption>;
}) {
  const { unitSystem } = useUnitSystem();
  const comparison = useMemo(
    () => compareWorkoutDrafts(before, after, { unitSystem, context, exercises: exercisesById }),
    [before, after, unitSystem, context, exercisesById]
  );
  return (
    <div className="workout-compare">
      {comparison.differs ? null : <p className="workout-compare-none">{t("workout.compare.none")}</p>}
      {comparison.fields.length ? (
        <dl className="workout-compare-fields">
          {comparison.fields.map(({ field, from, to }) => (
            <div key={field}>
              <dt>{compareFieldLabel(field)}</dt>
              <dd>
                {from ? <s>{from}</s> : null}
                {from && to ? <span aria-hidden="true">→</span> : null}
                {to ? <b>{to}</b> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="workout-compare-heads">
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
      <ol className="workout-compare-rows">
        {comparison.rows.map((row, index) => (
          <li
            key={index}
            data-status={row.status}
            data-nested={row.nested || undefined}
            aria-label={row.status === "same" ? undefined : STATUS_LABEL[row.status]}
          >
            <Cell cell={row.before} side="before" label={beforeLabel} />
            <Cell cell={row.after} side="after" label={afterLabel} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Cell({ cell, side, label }: { cell?: CompareCell; side: "before" | "after"; label: string }) {
  if (!cell) return <div className="workout-compare-cell is-empty" data-side={side} aria-hidden="true" />;
  const asks = cell.parts.filter(Boolean).join(" · ");
  return (
    <div className="workout-compare-cell" data-side={side} data-kind={cell.kind}>
      <span className="workout-compare-side">{label}</span>
      <span className="workout-compare-title">{cell.title}</span>
      {cell.label ? <span className="workout-compare-label">{cell.label}</span> : null}
      {asks ? <span className="workout-compare-asks">{asks}</span> : null}
    </div>
  );
}
