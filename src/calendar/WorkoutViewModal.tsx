import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Clock,
  Dumbbell,
  Layers,
  Gauge,
  ListChecks,
  Repeat,
  Route,
  X,
  type LucideIcon
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  PlanWorkoutEntryInput,
  RunWorkoutEditorDraft,
  RunWorkoutEditorStep,
  WorkoutEditRef,
  WorkoutEditorContext,
  WorkoutExerciseOption,
  WorkoutSport
} from "../../electron/types";
import { planWorkoutInputToEditorDraft } from "../../electron/planWorkoutEditor";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { OptionGroup } from "../components/OptionGroup";
import { remoteErrorMessage } from "../chat/remoteError";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { useWorkoutExerciseCatalog } from "./useWorkoutExerciseCatalog";
import {
  buildEditorDraftView,
  formatStepDistanceLabel,
  formatStepTimeLabel
} from "./scheduledStructure";
import {
  WorkoutStructure,
  flatSteps,
  formatTonnage,
  strengthTonnage
} from "./WorkoutStructureView";
import { workoutSportView } from "./workoutSportIcons";
import { isStrengthStyleWorkout, workoutSportLabel } from "../training/workoutSport";
import { formatCount, plural, t } from "../i18n/core";

/**
 * A workout, read in a dialog: a library workout from the Calendar, and from
 * Coach's conversation the session a proposed change acts on and the workout
 * it would put there.
 *
 * Every workout that is changed — a scheduled occurrence on the Calendar, a
 * plan session new or edited, and Edit workout in the Training Library — is
 * written in the workout builder (`WorkoutBuilderModal`), which is Create
 * workout's own form. This file was the Calendar's second editor until the
 * occurrence moved there too; what stays is the view, and the body the
 * Training Library and the plan reader draw a workout with.
 *
 * A library workout opens read-only from the Calendar because it is a
 * template every future use of it shares, and changing one there silently
 * rewrites what every future use of it will be — not a decision to offer from
 * a day cell that only wanted to know what the session is. Training Library
 * owns that.
 */
export type WorkoutViewSource =
  | WorkoutEditRef
  /** A workout no one has saved yet — what a proposed change would write. Drawn as it is, with no request. */
  | { kind: "proposed"; workout: PlanWorkoutEntryInput };

export interface WorkoutView {
  id: string;
  /** The switch's word for it; unused while it is the only view. */
  label: string;
  source: WorkoutViewSource;
}

interface WorkoutViewModalProps {
  api: HeraclesRecordsApi;
  /** What can be read, first shown unless `initialView` names another; past one, a switch picks. */
  views: readonly WorkoutView[];
  initialView?: string;
  /** The line over the name; "Library" when absent. */
  eyebrow?: string;
  onClose: () => void;
}

/**
 * The two fields `WorkoutReadOnlyBody` reads off a context are the pool length
 * and the climbing grade system, and both are only a fallback for a draft that
 * states neither — so a proposed workout is drawn on this at once, and on the
 * account's own context once it arrives.
 */
const LOCAL_CONTEXT: WorkoutEditorContext = {
  distanceUnit: "metric",
  paceUnit: "km",
  heartRateBasis: "maxHr",
  zones: {},
  lthrZones: [],
  defaultPoolLength: { value: 25, unit: "m" },
  climbSystems: {}
};

type ViewDocument = { draft: RunWorkoutEditorDraft; context: WorkoutEditorContext };
type ViewState = { document?: ViewDocument; error?: string };

export function WorkoutViewModal({ api, views, initialView, eyebrow, onClose }: WorkoutViewModalProps) {
  const { unitSystem } = useUnitSystem();
  const reducedMotion = useReducedMotion();
  const [viewId, setViewId] = useState(initialView ?? views[0]?.id ?? "");
  const view = views.find((item) => item.id === viewId) ?? views[0];
  // Keyed by content: a caller builds its views every render, and a new
  // object for the same workout must not read it again.
  const viewsKey = JSON.stringify(views.map((item) => [item.id, item.source]));
  /*
   * Every view is read as the dialog opens and kept, rather than the one on
   * screen read on each switch: a switch then changes nothing but which one
   * shows, and no skeleton passes between two workouts.
   */
  const [loaded, setLoaded] = useState<Record<string, ViewState>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded({});
    const settle = (id: string, state: ViewState) => {
      if (!cancelled) setLoaded((previous) => ({ ...previous, [id]: state }));
    };
    for (const [id, source] of JSON.parse(viewsKey) as [string, WorkoutViewSource][]) {
      if (source.kind === "proposed") {
        const draft = planWorkoutInputToEditorDraft(source.workout);
        settle(id, { document: { draft, context: LOCAL_CONTEXT } });
        void api.getWorkoutEditorContext(unitSystem).then((context) => {
          settle(id, { document: { draft, context } });
        }).catch(() => undefined);
      } else {
        void api.getWorkoutForEdit(source, unitSystem).then((document) => {
          settle(id, { document });
        }).catch((cause: unknown) => {
          settle(id, { error: remoteErrorMessage(cause, "") });
        });
      }
    }
    return () => { cancelled = true; };
  }, [api, viewsKey, unitSystem]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [viewId]);

  /*
   * The box is as tall as the tallest view, so a switch never resizes the
   * dialog; what scrolls is the view on screen alone, so a shorter one does
   * not scroll on into the room a longer one needs. The hidden views are
   * still laid out (clipped out of the scroll), which is what lets them be
   * measured.
   */
  const bodiesRef = useRef<HTMLDivElement>(null);
  const several = views.length > 1;
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const bodies = bodiesRef.current;
    if (!several || !scroll || !bodies) return;
    const fit = () => {
      // Layout heights: a rect would be read through the dialog's opening scale.
      const tallest = Math.max(0, ...[...bodies.children].map((cell) => (cell as HTMLElement).offsetHeight));
      const style = getComputedStyle(scroll);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      // A basis of its own height, shrinking under the dialog's cap like any box.
      scroll.style.flex = "0 1 auto";
      scroll.style.height = `${Math.ceil(tallest + padding)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    for (const cell of bodies.children) observer.observe(cell);
    return () => observer.disconnect();
  }, [several, viewsKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const draft = view ? loaded[view.id]?.document?.draft : undefined;
  const titleOf = (item: WorkoutView) => {
    const shown = loaded[item.id]?.document?.draft;
    return shown?.name.trim() || (shown ? workoutSportLabel(shown.sport) : t("workout.untitled"));
  };

  return createPortal(
    <AnimatePresence>
      <motion.div className="workout-editor-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.section
          className="workout-editor-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workout-editor-title"
          initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
        >
          <header className="workout-editor-header">
            <div>
              <p className="eyebrow workout-editor-eyebrow">
                {draft ? <WorkoutSportTag sport={draft.sport} /> : null}
                <span>{eyebrow ?? t("workout.e.library")}</span>
              </p>
              {/* Every view's name in one cell, so a longer one wrapping does not move the dialog on a switch. */}
              <h2 id="workout-editor-title" className="workout-view-stack">
                {views.map((item) => (
                  <span key={item.id} data-shown={item.id === view?.id} aria-hidden={item.id !== view?.id}>
                    {titleOf(item)}
                  </span>
                ))}
              </h2>
            </div>
            {views.length > 1 ? (
              <OptionGroup
                className="workout-view-switch"
                label={t("workout.v.which")}
                options={views.map((item) => ({ value: item.id, label: item.label }))}
                value={view?.id ?? ""}
                onChange={setViewId}
              />
            ) : null}
            <button type="button" className="icon-button" aria-label={t("workout.e.closeWorkout")} onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="workout-editor-scroll" ref={scrollRef}>
            <div className="workout-view-bodies" ref={bodiesRef}>
              {views.map((item) => (
                <WorkoutViewCell
                  key={item.id}
                  api={api}
                  state={loaded[item.id]}
                  shown={item.id === view?.id}
                />
              ))}
            </div>
          </div>
          <footer className="workout-editor-footer">
            <div className="workout-editor-footer-actions">
              <button type="button" className="primary-button" onClick={onClose}>{t("common.close")}</button>
            </div>
          </footer>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    window.document.body
  );
}

/** One view of the dialog: waiting, refused, or the workout. */
function WorkoutViewCell({ api, state, shown }: { api: HeraclesRecordsApi; state?: ViewState; shown: boolean }) {
  /* Shared with the day drawer, which needs the same catalog to name a
     strength session — and shared means one request between them rather than
     one each, because the promise is cached per sport. */
  const { byId: exercisesById } = useWorkoutExerciseCatalog(api, state?.document?.draft.sport);
  return (
    <div data-shown={shown} aria-hidden={!shown} inert={!shown}>
      {state?.document ? (
        <WorkoutReadOnlyBody
          draft={state.document.draft}
          context={state.document.context}
          exercisesById={exercisesById}
        />
      ) : state?.error !== undefined ? (
        <div className="workout-editor-state is-error">
          <AlertTriangle size={22} aria-hidden="true" />
          <h3>{t("workout.builderModal.loadFailed")}</h3>
          {state.error ? <p>{state.error}</p> : null}
        </div>
      ) : (
        <EditorSkeleton />
      )}
    </div>
  );
}

/**
 * A workout, read.
 *
 * View mode used to be the edit form with `disabled` on every control, which
 * says the wrong thing twice over: a greyed-out text box reads as something
 * broken rather than something settled, and the form's own furniture — the
 * character counters, the "Add step" buttons, the drag handles, the Sport
 * picker that has never been changeable in place, the empty Description box —
 * is all scaffolding for a decision nobody is being offered here. The measured
 * shape of that was 212 controls, 194 of them dead.
 *
 * So this draws the same view the day drawer draws for a scheduled workout,
 * off the same `ScheduledStructureView` and through the same renderer. Every
 * figure is computed from the draft rather than asked of COROS: a view that
 * waits on a round trip to say how long a workout is has no reason to.
 *
 * **Exported, because the Training Library reads workouts too.** Its detail
 * pane drew its own hero, its own metric list and its own step list off the
 * same `WorkoutEditorDocument` — a second renderer for the same payload,
 * which is exactly the drift `WorkoutStructure` exists to prevent one level
 * down. Neither surface shows the other, so nothing would have caught them
 * disagreeing.
 */
export function WorkoutReadOnlyBody({
  draft,
  context,
  exercisesById,
  title,
  heroAside,
  subtitleAside,
  heroFooter
}: {
  draft: RunWorkoutEditorDraft;
  context: WorkoutEditorContext;
  exercisesById: ReadonlyMap<string, WorkoutExerciseOption>;
  /**
   * The workout's name, for a surface that has no title bar of its own. Given
   * one, the hero leads with it and the sport steps down to the line beneath —
   * which is the order a reader wants when the pane is the whole answer rather
   * than the body of a dialog that already says what it is showing.
   *
   * The Calendar passes none: its modal header carries the name, and a second
   * copy a few pixels below it is the same word twice.
   */
  title?: string;
  /**
   * The hero's top-right corner — a favourite toggle, say. Three slots rather
   * than one because a surface that owns the whole pane has things to say about
   * the workout that the hero is the place for, and each belongs at a
   * different height: something you act on sits in the corner, something that
   * qualifies the sport rides on its line, and something about the workout's
   * place in the rest of the library is a last line under the figures.
   */
  heroAside?: ReactNode;
  /** Follows the sport on the subtitle line — its tags, say. */
  subtitleAside?: ReactNode;
  /** A closing line inside the hero, under its figures. */
  heroFooter?: ReactNode;
}) {
  const { unitSystem } = useUnitSystem();
  const view = useMemo(
    () => buildEditorDraftView(draft, unitSystem, exercisesById),
    [draft, exercisesById, unitSystem]
  );
  const { category, icon: SportIcon } = workoutSportView(draft.sport);
  const isStrength = isStrengthStyleWorkout(draft.sport);
  const strength = useMemo(() => strengthTotals(draft), [draft]);
  const tonnage = useMemo(() => strengthTonnage(flatSteps(view)), [view]);

  const poolLength = draft.sport === "swim"
    ? (draft.sportOptions?.poolLength ?? context.defaultPoolLength)
    : undefined;
  const gradingSystem = draft.sport === "indoorClimb" || draft.sport === "bouldering"
    ? (draft.sportOptions?.gradingSystem ?? context.climbSystems[draft.sport])
    : undefined;

  // Only figures the draft actually holds. A strength session has no distance
  // and an open-ended run has no duration; a "--" in a box is not information.
  const stats: Array<{ icon: LucideIcon; label: string; value: string }> = [];
  if (isStrength) {
    stats.push({ icon: Dumbbell, label: t("workout.v.exercises"), value: formatCount(strength.exercises) });
    if (strength.sets > 0) {
      stats.push({ icon: Layers, label: t("workout.v.sets"), value: formatCount(strength.sets) });
    }
    // One third figure, whichever the session has: what it moves, or what it
    // spends waiting. A session of single sets has no rest between them.
    if (tonnage > 0) {
      stats.push({ icon: Gauge, label: t("workout.v.lifted"), value: formatTonnage(tonnage, unitSystem) });
    } else if (strength.restSeconds > 0) {
      stats.push({ icon: Clock, label: t("workout.v.setRest"), value: clockFromSeconds(strength.restSeconds) });
    }
  } else {
    if (view.totals.distanceMeters) {
      stats.push({
        icon: Route,
        label: t("workout.v.distance"),
        value: formatStepDistanceLabel(
          view.totals.distanceMeters,
          unitSystem,
          draft.sport === "swim"
        )
      });
    }
    if (view.totals.durationSeconds) {
      stats.push({
        icon: Clock,
        label: view.totals.distanceMeters ? t("workout.v.timedSteps") : t("workout.v.duration"),
        value: formatStepTimeLabel(view.totals.durationSeconds)
      });
    }
    stats.push({
      icon: ListChecks,
      label: view.totals.stepCount === 1 ? t("workout.v.step") : t("workout.v.steps"),
      value: formatCount(view.totals.stepCount)
    });
  }

  const structureSummary = view.totals.repeatGroups > 0
    ? plural("workout.repeatGroups", view.totals.repeatGroups)
    : undefined;
  const overview = draft.overview.trim();

  return (
    <div className={`sched-detail workout-view is-${category}`}>
      <div className="sched-hero">
        <div className="sched-hero-top">
          <span className="sched-hero-icon" aria-hidden="true">
            <SportIcon size={20} />
          </span>
          <div className="sched-hero-title">
            <div className="sched-hero-heading">
              {title ? (
                <h2 className="sched-hero-name">{title}</h2>
              ) : (
                <span className="sched-hero-sport">{workoutSportLabel(draft.sport)}</span>
              )}
              {poolLength ? (
                <span className="sched-hero-chip">
                  {t("workout.v.pool", { value: poolLength.value, unit: poolLength.unit })}
                </span>
              ) : null}
              {gradingSystem ? (
                <span className="sched-hero-chip">{gradingSystem}</span>
              ) : null}
            </div>
            {title || structureSummary || subtitleAside ? (
              <span className="sched-hero-context">
                {/* With a name above it the sport is the subtitle; without
                    one it is the heading and this line is only the shape. */}
                {title ? <b>{workoutSportLabel(draft.sport)}</b> : null}
                {structureSummary ? (
                  <>
                    <Repeat size={12} aria-hidden="true" />
                    {structureSummary}
                  </>
                ) : null}
                {subtitleAside}
              </span>
            ) : null}
          </div>
          {/* The corner, not the name's line: a control that acts on the whole
              workout reads as the hero's own rather than as part of its title,
              and the title keeps the width to wrap in. */}
          {heroAside ? (
            <div className="sched-hero-aside">{heroAside}</div>
          ) : null}
        </div>
        <dl className={`sched-hero-stats is-${stats.length}`}>
          {stats.map((stat) => (
            <div className="sched-stat" key={stat.label}>
              <dt className="sched-stat-label">
                <stat.icon size={12} aria-hidden="true" />
                {stat.label}
              </dt>
              <dd className="sched-stat-value">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {heroFooter}
      </div>

      {/* Framed, with its name on the frame: bare under the hero it read as
          one more line of the hero's own copy. A workout with none draws
          nothing here rather than an empty box. */}
      {overview ? (
        <fieldset className="workout-view-overview">
          <legend>{t("workout.b.w.description")}</legend>
          <p>{overview}</p>
        </fieldset>
      ) : null}

      {view.nodes.length > 0 ? (
        <div className="sched-structure">
          <div className="sched-structure-head">
            <h4>
              <ListChecks size={14} aria-hidden="true" />
              {t("workout.detail.structure")}
            </h4>
          </div>
          <WorkoutStructure
            view={view}
            unitSystem={unitSystem}
            strength={isStrength}
            swim={draft.sport === "swim"}
            showSummary={false}
            exercises={exercisesById}
          />
        </div>
      ) : (
        <div className="sched-empty">
          <ListChecks size={18} aria-hidden="true" />
          <p>{t("workout.detail.noSteps")}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The strength figures the hero shows, counted the same way the editor's own
 * footer counts them — a repeat group multiplies its children.
 */
function strengthTotals(draft: RunWorkoutEditorDraft): {
  exercises: number;
  sets: number;
  restSeconds: number;
} {
  let exercises = 0;
  let sets = 0;
  let restSeconds = 0;
  const countStep = (step: RunWorkoutEditorStep, multiplier: number) => {
    if (step.kind !== "training") return;
    exercises += 1;
    const stepSets = Math.max(1, step.sets ?? 1);
    sets += stepSets * multiplier;
    restSeconds += Math.max(0, stepSets - 1) * Math.max(0, step.restValue ?? 0) * multiplier;
  };
  for (const node of draft.nodes) {
    if (node.nodeType === "step") countStep(node, 1);
    else node.steps.forEach((step) => countStep(step, Math.max(1, node.repeat)));
  }
  return { exercises, sets, restSeconds };
}

function clockFromSeconds(total: number): string {
  const seconds = Math.max(0, Math.round(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function EditorSkeleton() {
  return <div className="workout-editor-skeleton" aria-label={t("workout.v.loading")}><div /><div /><div /><div /></div>;
}

/** The workout's sport, in its own colour and icon, as the eyebrow's lead. */
function WorkoutSportTag({ sport }: { sport: WorkoutSport }) {
  const { category, icon: Icon } = workoutSportView(sport);
  return (
    <span className={`workout-editor-sport is-${category}`}>
      <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
      {workoutSportLabel(sport)}
    </span>
  );
}
