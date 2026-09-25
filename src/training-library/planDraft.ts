/**
 * An edit in progress, held outside the component that draws it.
 *
 * The editor owned its own undo history, which meant the draft lived exactly
 * as long as the component: anything that unmounted it threw the work away.
 * That was survivable only because the tab strip was **disabled** while
 * editing — the screen prevented navigation rather than surviving it, which
 * also meant an athlete mid-plan could not go and look at a workout without
 * abandoning the plan first.
 *
 * So the draft moves up to the view, which outlives every tab switch, and the
 * editor becomes a view over it. Pure functions rather than a hook, for the
 * reason `planFilters.ts` is: a reducer with an undo stack has exactly the
 * kind of off-by-one a test should be able to reach.
 */
import type { TrainingPlanDocument } from "../../electron/types";

/**
 * How many states back the undo stack goes.
 *
 * A plan document is the whole plan — every week, every session, every step —
 * so an unbounded stack grows without limit across a long editing session.
 * The baseline is kept outside the cap, so however much is dropped, "has this
 * changed since it was opened" stays exact.
 */
export const DRAFT_HISTORY_LIMIT = 40;

export interface PlanDraft {
  /** The plan as it was opened. Never replaced; what `dirty` compares against. */
  base: TrainingPlanDocument;
  /** Committed states, oldest first. `base` is always the first. */
  history: TrainingPlanDocument[];
  index: number;
  /**
   * The text field the newest state was typed into, while it still is.
   *
   * Every keystroke is a commit, and each one used to be its own state — so
   * typing a twenty-letter plan name filled half the stack, Undo took the name
   * back one letter at a time, and the forty-state cap had pushed everything
   * before the name out of reach. Keystrokes into the same field now fold
   * into one state until the field is left (`sealDraft`) or anything else is
   * committed.
   */
  typing?: string;
}

export function startDraft(plan: TrainingPlanDocument): PlanDraft {
  const opened = structuredClone(plan);
  return { base: opened, history: [opened], index: 0 };
}

export function draftPlan(draft: PlanDraft): TrainingPlanDocument {
  return draft.history[draft.index] ?? draft.base;
}

/**
 * A new state, and everything that was redoable is gone.
 *
 * Trimming happens from position 1 rather than 0: position 0 is the baseline
 * and dropping it would make an edited plan compare equal to whatever state
 * happened to fall off the end, which reads as "no unsaved changes" on a plan
 * full of them.
 */
export function commitDraft(
  draft: PlanDraft,
  next: TrainingPlanDocument,
  typing?: string
): PlanDraft {
  /* Never into the baseline: folding a keystroke into position 0 would make
     the edited plan the one "unsaved changes" compares against. */
  const folds =
    typing !== undefined &&
    draft.typing === typing &&
    draft.index > 0 &&
    draft.index === draft.history.length - 1;
  if (folds) {
    const history = [...draft.history];
    history[draft.index] = next;
    return { ...draft, history };
  }
  const history = [...draft.history.slice(0, draft.index + 1), next];
  if (history.length <= DRAFT_HISTORY_LIMIT) {
    return { ...draft, history, index: history.length - 1, typing };
  }
  const trimmed = [history[0]!, ...history.slice(history.length - DRAFT_HISTORY_LIMIT + 1)];
  return { ...draft, history: trimmed, index: trimmed.length - 1, typing };
}

/** The field was left: the next keystroke into it starts a state of its own. */
export function sealDraft(draft: PlanDraft): PlanDraft {
  return draft.typing === undefined ? draft : { ...draft, typing: undefined };
}

export function canUndo(draft: PlanDraft): boolean {
  return draft.index > 0;
}

export function canRedo(draft: PlanDraft): boolean {
  return draft.index < draft.history.length - 1;
}

export function undoDraft(draft: PlanDraft): PlanDraft {
  return canUndo(draft) ? { ...draft, index: draft.index - 1, typing: undefined } : draft;
}

export function redoDraft(draft: PlanDraft): PlanDraft {
  return canRedo(draft) ? { ...draft, index: draft.index + 1, typing: undefined } : draft;
}

/**
 * Whether the draft differs from the plan that was opened.
 *
 * `updatedAt` is excluded because every commit stamps it — `withDerivedSportMix`
 * does, on every keystroke in the name field — so comparing the documents whole
 * reports "unsaved changes" for an edit that was typed and then undone back to
 * exactly where it started, and the athlete is warned about losing nothing.
 */
export function draftIsDirty(draft: PlanDraft): boolean {
  return !sameDocument(draftPlan(draft), draft.base);
}

function sameDocument(left: TrainingPlanDocument, right: TrainingPlanDocument): boolean {
  return JSON.stringify(withoutStamp(left)) === JSON.stringify(withoutStamp(right));
}

function withoutStamp(plan: TrainingPlanDocument): Omit<TrainingPlanDocument, "updatedAt"> {
  const { updatedAt: _stamp, ...rest } = plan;
  return rest;
}

/**
 * The draft to use for a plan that has just been opened.
 *
 * A held draft is resumed only when it is for the same plan *and* the stored
 * copy has not moved underneath it. A pull from another machine can rewrite a
 * plan while it is being edited here, and silently carrying on over the top of
 * that would publish this machine's copy as though it had seen the other's.
 * Reopening a plan whose stored `updatedAt` has changed starts fresh.
 */
export function resumeDraft(
  held: PlanDraft | null,
  plan: TrainingPlanDocument
): PlanDraft {
  if (held && held.base.id === plan.id && held.base.updatedAt === plan.updatedAt) {
    return held;
  }
  return startDraft(plan);
}
