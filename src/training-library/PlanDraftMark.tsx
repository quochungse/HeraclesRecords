/**
 * Unsaved work, said where the plan is drawn.
 *
 * `draft` is a plan that exists only as a draft — a new plan, kept here and
 * not yet on COROS. `editing` is a plan on COROS with edits kept here that
 * have not been saved to it. The two read differently because they mean
 * different things: one is not on the watch at all, the other is, as it was
 * before the edit.
 */
export type PlanDraftMarkKind = "draft" | "editing";

export function PlanDraftMark({ kind }: { kind: PlanDraftMarkKind }) {
  return (
    <span
      className="tl-draft-mark"
      data-mark={kind}
      title={
        kind === "draft"
          ? "A draft kept here — not on COROS yet"
          : "Edits kept here — the plan on COROS is unchanged until they are saved"
      }
    >
      {kind === "draft" ? "Draft" : "Editing"}
    </span>
  );
}
