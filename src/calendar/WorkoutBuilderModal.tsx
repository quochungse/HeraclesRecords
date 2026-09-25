/**
 * The workout builder as a dialog of its own, for every workout that is not
 * being created from the Calendar or the library's Create button:
 *
 * - a **new plan session** — the builder as Create workout opens it, sport
 *   picker included, and "Add to plan" in place of "Save workout";
 * - an **existing plan session** — read into the builder, applied back to the
 *   plan through `editorDraftToPlanWorkoutInput`, the path the plan's own
 *   session editor wrote through before;
 * - **Edit workout** in the Training Library — read from COROS, saved back
 *   through `saveWorkoutEdit`, verified, with COROS's training load for the
 *   draft beside the builder's own totals.
 *
 * It replaced `WorkoutEditorModal` in all three, which was a second editor
 * for the same workouts with its own defaults, its own validator and its own
 * layout. The builder is Create workout's, moved rather than copied, so what
 * differs here is the frame: the heading, the button, and a question before
 * unsaved work is thrown away.
 *
 * Edits go through the rows' `origin`, so a step nobody touched is written
 * back exactly as it was read — see `workoutBuilderRows.ts`.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CalendarDays, Gauge, LoaderCircle, Plus, Save, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  PlanWorkoutEntryInput,
  RunWorkoutEditorDraft,
  TrainingPlanEntry,
  WorkoutEditPreview,
  WorkoutEditRef,
  WorkoutEditSaveResult,
  WorkoutEditorDocument,
  WorkoutSport
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  editorDraftToPlanWorkoutInput,
  planWorkoutInputToEditorDraft
} from "../../electron/planWorkoutEditor";
import { formatWorkoutSport, validateWorkoutDraftShared } from "../../electron/workoutCapabilities";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { WorkoutBuilderWorkspace, useWorkoutBuilder } from "./WorkoutBuilder";

export type WorkoutBuilderSource =
  /** A session that does not exist yet. The sport is where the picker opens. */
  | { kind: "plan-new"; sport?: WorkoutSport }
  /** A session already in a plan. */
  | { kind: "plan"; entry: TrainingPlanEntry }
  /** A workout in the COROS library. */
  | { kind: "library"; editRef: WorkoutEditRef };

export interface WorkoutBuilderModalProps {
  api: CorosLinkApi;
  source: WorkoutBuilderSource;
  /** The line above the title (the plan and the day), and the title. */
  heading: { eyebrow?: string; title: string };
  /**
   * The "discard unsaved changes?" question, drawn by the caller in its own
   * dialog, so the builder asks it the way the screen around it asks.
   */
  confirmDiscard: (answer: { keep: () => void; discard: () => void }) => ReactNode;
  onClose: () => void;
  /** A plan session, as the plan stores it. */
  onSavedToPlan?: (workout: PlanWorkoutEntryInput) => void;
  /** A library workout, as COROS saved it. */
  onSaved?: (result: WorkoutEditSaveResult) => void;
  onError: (message: string | null) => void;
}

interface LoadedWorkout {
  /** What the builder opens with; absent for a new session. */
  seed?: RunWorkoutEditorDraft;
  /** The COROS document a library edit saves against. */
  document?: WorkoutEditorDocument;
  /** The plan workout a session's save is written over. */
  previous?: PlanWorkoutEntryInput;
}

/**
 * What can be opened without asking COROS: a new session, and any plan
 * session — a session carries its whole workout, including one taken from the
 * library, which is copied in when it is added.
 */
function loadWithoutRequest(source: WorkoutBuilderSource): LoadedWorkout | null {
  if (source.kind === "plan-new") return {};
  if (source.kind === "plan") {
    return { seed: planWorkoutInputToEditorDraft(source.entry.workout), previous: source.entry.workout };
  }
  return null;
}

export function WorkoutBuilderModal(props: WorkoutBuilderModalProps) {
  const { api, source, onClose } = props;
  const { unitSystem } = useUnitSystem();
  /*
   * By what it names, not by identity: callers write the source as a literal,
   * which is a new object on every render of theirs, and a load keyed on that
   * would start again each time and throw away what had been typed.
   */
  const sourceKey = JSON.stringify(source);
  const immediate = useMemo(() => loadWithoutRequest(source), [sourceKey]);
  const [loaded, setLoaded] = useState<LoadedWorkout | null>(immediate);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (immediate) return;
    let cancelled = false;
    const load = async (): Promise<LoadedWorkout> => {
      if (source.kind === "library") {
        const document = await api.getWorkoutForEdit(source.editRef, unitSystem);
        return { seed: document.draft, document };
      }
      return {};
    };
    void load()
      .then((result) => { if (!cancelled) setLoaded(result); })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, sourceKey, unitSystem]);

  /* Nothing has been typed while the workout is loading, so Escape and the
     close button simply close. Once it is open the builder takes both. */
  useEffect(() => {
    if (loaded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loaded, onClose]);

  if (loaded) {
    return <LoadedWorkoutBuilder {...props} loaded={loaded} animateIn={Boolean(immediate)} />;
  }
  return createPortal(
    <BuilderFrame heading={props.heading} animateIn onClose={onClose}>
      {loadError ? (
        <div className="calendar-modal-body workout-builder-state is-error" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <strong>Workout could not be loaded</strong>
          <span>{loadError}</span>
        </div>
      ) : (
        <div className="calendar-modal-body workout-builder-state" aria-live="polite">
          <LoaderCircle className="is-spinning" size={18} aria-hidden="true" />
          <span>Loading workout…</span>
        </div>
      )}
    </BuilderFrame>,
    window.document.body
  );
}

/**
 * The dialog around the builder: the calendar modal's own frame, which is
 * what Create workout opens in, so the two cannot drift apart in chrome.
 * `is-stacked` lifts it over the plan editor, which shares the modal band.
 */
function BuilderFrame({
  heading,
  animateIn,
  closeDisabled = false,
  style,
  onClose,
  children
}: {
  heading: WorkoutBuilderModalProps["heading"];
  animateIn: boolean;
  closeDisabled?: boolean;
  style?: CSSProperties;
  onClose: () => void;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const titleId = useId();
  return (
    <AnimatePresence>
      <motion.div
        className="calendar-modal-backdrop is-stacked"
        initial={reducedMotion || !animateIn ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
      >
        {/* No close on a press outside the sheet, for the reason Create
            workout gives: building a workout is minutes of input. */}
        <motion.div
          className="calendar-modal calendar-modal-workspace calendar-modal-builder panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={style}
          initial={reducedMotion || !animateIn ? false : { opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 18, scale: 0.98 }}
          transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 30 }}
        >
          <header className="calendar-modal-header">
            <div>
              {heading.eyebrow ? (
                <p className="calendar-modal-date">
                  <CalendarDays size={13} aria-hidden="true" />
                  {heading.eyebrow}
                </p>
              ) : null}
              <h3 id={titleId} className={heading.eyebrow ? undefined : "is-library"}>
                {heading.title}
              </h3>
            </div>
            <button
              type="button"
              className="ghost-button calendar-modal-close"
              onClick={onClose}
              disabled={closeDisabled}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function LoadedWorkoutBuilder({
  api,
  source,
  heading,
  confirmDiscard,
  onClose,
  onSavedToPlan,
  onSaved,
  onError,
  loaded,
  animateIn
}: WorkoutBuilderModalProps & { loaded: LoadedWorkout; animateIn: boolean }) {
  const { unitSystem } = useUnitSystem();
  const builder = useWorkoutBuilder(api, {
    seed: loaded.seed,
    initialSport: source.kind === "plan-new" ? source.sport : undefined
  });
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [preview, setPreview] = useState<WorkoutEditPreview | null>(null);
  const previewSequence = useRef(0);

  const { builderSport, builderValid, builderSportMeta, edited } = builder;
  const isNew = source.kind === "plan-new";
  /* What an unnamed workout is saved as. Create workout says "Structured
     Workout"; a plan session is named for its sport, which is what a new one
     was called before the builder wrote them. */
  const fallbackName = source.kind === "library"
    ? "Structured Workout"
    : `New ${formatWorkoutSport(builderSport).toLowerCase()} session`;
  const draft = builder.toEditorDraft(fallbackName);
  const draftKey = JSON.stringify(draft);
  /* The builder's rows have the first word; the shared validator has the
     last, as it did for every save these three used to make. */
  const shared = useMemo(() => validateWorkoutDraftShared(draft), [draftKey]);
  const document = loaded.document;
  const blocked = document && !document.canEdit
    ? document.unsupportedReason ?? "This workout cannot be edited here."
    : undefined;
  const problem = blocked ?? (builderValid && !shared.valid
    ? Object.values(shared.errors)[0]
    : undefined);
  const canSave = builderValid && shared.valid && !blocked && !saving && (isNew || edited);

  const requestClose = () => {
    if (saving) return;
    if (edited) setConfirmClose(true);
    else onClose();
  };

  useEffect(() => {
    if (confirmClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  /* COROS's own figures for a library workout, which the editor this
     replaced showed along its foot. Only COROS can price a step, and only a
     timed or distance step with an intensity target gets a load. */
  const canPreview = source.kind === "library"
    && Boolean(document?.canEdit)
    && builderValid
    && shared.valid
    && builderSport !== "strength";
  useEffect(() => {
    const sequence = ++previewSequence.current;
    if (source.kind !== "library" || !document || !canPreview) {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void api.previewWorkoutEdit(source.editRef, document.revision, draft, unitSystem)
        .then((result) => { if (previewSequence.current === sequence) setPreview(result); })
        .catch(() => { if (previewSequence.current === sequence) setPreview(null); });
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canPreview, draftKey, unitSystem]);

  const save = async () => {
    if (!canSave) return;
    if (source.kind !== "library") {
      if (!onSavedToPlan) return;
      const previous = loaded.previous ?? {
        key: `local:${Date.now()}`,
        name: draft.name,
        sport: draft.sport,
        save_to_library: false
      };
      onSavedToPlan(editorDraftToPlanWorkoutInput(draft, previous));
      return;
    }
    if (!document || !onSaved) return;
    setSaving(true);
    try {
      onSaved(await api.saveWorkoutEdit(source.editRef, document.revision, draft, unitSystem));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const trainingLoad = preview?.trainingLoad;
  const actionLabel = source.kind === "library"
    ? saving ? "Saving and verifying…" : "Save changes"
    : isNew ? "Add to plan" : "Apply to plan";

  return createPortal(
    <>
      <BuilderFrame
        heading={heading}
        animateIn={animateIn}
        closeDisabled={saving}
        style={{ "--builder-sport": builderSportMeta.colorVar } as CSSProperties}
        onClose={requestClose}
      >
        <WorkoutBuilderWorkspace
          builder={builder}
          sportLocked={!isNew}
          footerLead={problem ? (
            <p className="calendar-builder-error workout-builder-problem" role="alert">
              <AlertTriangle size={13} aria-hidden="true" />
              <span>{problem}</span>
            </p>
          ) : null}
          totalsExtra={trainingLoad !== undefined && trainingLoad > 0 ? (
            <span className="calendar-builder-total" title="Training load, as COROS calculates it">
              <Gauge size={11} aria-hidden="true" />
              {Math.round(trainingLoad)} TL
            </span>
          ) : null}
          action={
            <button
              type="button"
              className="primary-button"
              disabled={!canSave}
              onClick={() => void save()}
            >
              {saving
                ? <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                : isNew ? <Plus size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {actionLabel}
            </button>
          }
        />
      </BuilderFrame>
      {/* Outside the sheet: a fixed dialog inside a transformed ancestor is
          placed against that ancestor, not the window. */}
      {confirmClose
        ? confirmDiscard({ keep: () => setConfirmClose(false), discard: onClose })
        : null}
    </>,
    window.document.body
  );
}
