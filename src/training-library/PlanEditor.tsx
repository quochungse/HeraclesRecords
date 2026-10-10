/**
 * Writing a plan.
 *
 * A plan is a COROS plan, so this edits what COROS stores and nothing else:
 * sessions on days, a name and a description, and a stage per week. Rest days,
 * notes, free-text phases and a start date on the plan went with the local
 * plans that held them (docs/training-plan-coros-first.md).
 *
 * What it is, in the order the athlete meets it:
 *
 * - **The plan reads as the reader draws it.** Title in the serif, the same
 *   figures, the same ridge, and every week as a card with its seven days — so
 *   the thing being written looks like the thing it will be, and editing is
 *   the reader with handles on it rather than a second screen to learn.
 * - **A session goes where it is put.** Each day's `+` offers a new session or
 *   a workout from the library, and each opens the screen that finishes it for
 *   that day. A library workout is copied in whole: a COROS plan holds its own
 *   copy of every program.
 * - **A session moves without a mouse.** Alt + arrow keys step it a day or a
 *   week, Delete removes it, and its ⋯ has Move to…, Duplicate and Copy to
 *   next week — so its card carries one control, not five.
 * - **A week says what block it is** — COROS's own stages, Preparation to
 *   Transition, picked in the week's head.
 * - **Problems are stated where Save is**, at every width. Save writes to
 *   COROS; Save draft keeps the edit here, unfinished work included.
 *
 * Calendar actions are not here: they act on a saved plan, and live in the
 * reader's ⋯, which is where saving lands.
 */
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Copy,
  CopyPlus,
  Eraser,
  FilePen,
  Library,
  LoaderCircle,
  MoreHorizontal,
  MoveRight,
  Pencil,
  PenLine,
  Plus,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent
} from "react";
import type {
  TrainingLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanEntry,
  TrainingPlanWeekStage
} from "../../electron/types";
import {
  COROS_WEEK_STAGES,
  TRAINING_PLAN_MAX_WEEKS,
  duplicateTrainingPlanWeek,
  reorderTrainingPlanWeek,
  summarizeTrainingPlan,
  validateTrainingPlan,
  weekStageOf,
  workoutSportFromType
} from "../../electron/trainingPlanDomain";
import { replaceTrainingPlanEntryWorkout } from "../../electron/planWorkoutEditor";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { WorkoutBuilderModal } from "../calendar/WorkoutBuilderModal";
import { OptionGroup } from "../components/OptionGroup";
import { SelectDropdown } from "../components/SelectDropdown";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue } from "../units/units";
import { ConfirmDialog } from "./ConfirmDialog";
import { PlanMenu, type PlanMenuItem } from "./PlanMenu";
import { PlanWeekRidge } from "./PlanWeekRidge";
import {
  canRedo,
  canUndo,
  commitDraft,
  draftIsDirty,
  draftPlan,
  redoDraft,
  sealDraft,
  undoDraft,
  type PlanDraft
} from "./planDraft";
import {
  addEntry,
  appendWeek,
  clearWeek,
  copyEntry,
  libraryEntry,
  moveEntry,
  removeEntry,
  removeWeek,
  setWeekStage,
  stepSlot,
  withDerivedSportMix,
  writtenEntry,
  type PlanSlot,
  type StepDirection
} from "./planEditorModel";
import {
  formatPlannedDuration,
  formatWeekLine,
  readPlan,
  type PlanEntryFacts,
  type PlanReaderWeek
} from "./planReaderModel";
import { PlanOriginBadge, SportMixDots, dominantSport, sportAccentStyle, sportChipStyle, sportTheme } from "./sportTheme";
import { workoutSportLabel } from "../training/workoutSport";
import { formatCount, formatDecimal, plural, t, weekdayNames } from "../i18n/core";
import { planStageLabel } from "../i18n/workoutWords";
import { useI18n } from "../i18n/useI18n";

interface PlanEditorProps {
  api: HeraclesRecordsApi;
  /**
   * The edit in progress, held by the caller so it survives a tab switch. The
   * editor draws it and reports every change back; it owns no history of its
   * own, because history that lives in a component dies with it.
   */
  draft: PlanDraft;
  onDraftChange: (draft: PlanDraft) => void;
  workouts: TrainingLibraryWorkout[];
  /**
   * Not on COROS as it stands — a blank plan, a resumed draft, or one the
   * generator or the coach handed over — so it can be saved without a change.
   * A plan opened from COROS only once something has changed.
   */
  isNew: boolean;
  /** Writes the plan to COROS. Absent where saving to COROS is not offered. */
  onSave?: (plan: TrainingPlanDocument) => Promise<void>;
  /** Keeps the edit here as a draft. Absent where drafts are not kept (the coach's editor). */
  onSaveDraft?: (plan: TrainingPlanDocument) => Promise<void>;
  /**
   * Throws the draft this edit was resumed from away. Given only for a kept
   * draft: a new plan opens straight into the editor, so this is the one
   * place its draft can be let go of.
   */
  onDiscardDraft?: () => void;
  /** What Save says, where it saves somewhere other than COROS. */
  saveLabel?: string;
  onClose: () => void;
}

/** What a drag carries. A custom type, so a drag from elsewhere is ignored. */
const ENTRY_DRAG = "application/x-heracles-plan-entry";

const MAX_WEEKS = TRAINING_PLAN_MAX_WEEKS;
/** COROS's seven stages, named in the language on screen. */
function stageOptions(): { value: string; label: string }[] {
  return COROS_WEEK_STAGES.map((stage) => ({
    value: String(stage.value),
    label: planStageLabel(stage.slug)
  }));
}

type Layer =
  | { kind: "workout"; entryId: string }
  | { kind: "library"; slot: PlanSlot; loading?: string }
  | { kind: "create"; slot: PlanSlot }
  | { kind: "move"; entryId: string }
  | { kind: "discard" }
  | { kind: "delete-week"; weekIndex: number };

type WeekAction = "duplicate" | "earlier" | "later" | "clear" | "delete";
type AddKind = "session" | "library";

/**
 * Everything a week can ask the editor to do. Handed down as one object that
 * never changes identity, so a week that did not change skips its render —
 * typing the plan's name used to redraw every day of every week per keystroke.
 */
interface EditorActions {
  add: (kind: AddKind, slot: PlanSlot) => void;
  open: (entryId: string) => void;
  duplicate: (entryId: string) => void;
  copyToNextWeek: (entryId: string) => void;
  requestMove: (entryId: string) => void;
  remove: (entryId: string) => void;
  step: (entryId: string, direction: StepDirection) => void;
  dragStart: () => void;
  dragEnd: () => void;
  dragOver: (event: DragEvent, key: string) => void;
  dragLeave: (event: DragEvent, key: string) => void;
  drop: (event: DragEvent, slot: PlanSlot) => void;
  week: (action: WeekAction, weekIndex: number) => void;
  stage: (weekIndex: number, stage: TrainingPlanWeekStage) => void;
}

function slotKey(slot: PlanSlot): string {
  return `${slot.weekIndex}:${slot.dayIndex}`;
}

function slotLabel(slot: PlanSlot, week: PlanReaderWeek | undefined): string {
  return t("library.ed.slot", { n: slot.weekIndex + 1, day: week?.days[slot.dayIndex]?.label ?? weekdayNames("short")[slot.dayIndex] });
}

/** Only figures the session states — the reader's rule, for the same reason. */
function entryFigures(entry: PlanEntryFacts, unitSystem: ReturnType<typeof useUnitSystem>["unitSystem"]): string[] {
  return [
    entry.durationComplete ? formatPlannedDuration(entry.durationSeconds) : null,
    entry.distanceMeters ? formatDistanceValue(entry.distanceMeters, unitSystem, { digits: 1 }) : null,
    entry.trainingLoad ? t("library.entry.load", { n: Math.round(entry.trainingLoad) }) : null,
    entry.strengthSets ? plural("workout.sets", entry.strengthSets) : null
  ].filter((figure): figure is string => Boolean(figure));
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export function PlanEditor({
  api,
  draft,
  onDraftChange,
  workouts,
  isNew,
  onSave,
  onSaveDraft,
  onDiscardDraft,
  saveLabel,
  onClose
}: PlanEditorProps) {
  const { unitSystem } = useUnitSystem();
  const { rich, locale } = useI18n();
  const plan = draftPlan(draft);
  const dirty = draftIsDirty(draft);

  const [saving, setSaving] = useState<"coros" | "draft" | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [workoutEditorError, setWorkoutEditorError] = useState<string | null>(null);

  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  /* A new plan opens with its default name selected, so the first keystroke
     replaces it and leaving it alone is a plan that saves as it is. Once, on
     open: a draft resumed after leaving the tab keeps whatever was typed. */
  useEffect(() => {
    if (!isNew || plan.remoteId || draft.index > 0) return;
    nameField.current?.focus();
    nameField.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* A session the keyboard just moved, to put focus back on once it has been
     drawn in its new day — React mounts it afresh there. */
  const refocusEntry = useRef<string | null>(null);
  const [jumpTo, setJumpTo] = useState<number | null>(null);

  /*
   * The read-only shape of the plan, from the reader's own model: days with
   * their labels, sessions with their figures, stages, week totals. Keyed on
   * what it reads, so a keystroke in the name field reuses it — and with it
   * every week's props, which is what lets the weeks skip that render.
   */
  const { entries, weekCount, weekStages } = plan;
  const shape = useMemo(
    () => ({ entries, weekCount, weekStages }),
    [entries, weekCount, weekStages]
  );
  /* Only the shape is read, so only the shape is a dependency. A plan on the
     calendar is read without its dates: the editor places sessions in weeks,
     and is not the place to be told a session was missed. */
  const reading = useMemo(
    () => readPlan({ ...plan, ...shape, startDate: undefined, calendar: "unscheduled" }),
    // The day labels and stage names are in the language on screen.
    [shape, locale]
  );
  const summary = useMemo(() => summarizeTrainingPlan({ ...plan, ...shape }), [shape]);
  const validation = useMemo(() => validateTrainingPlan(plan), [plan]);
  const errors = validation.filter((issue) => issue.severity === "error");
  /* An empty plan is not listed as a problem: the hint under the figures says
     what to do, and a red line on a plan nobody has touched is noise. Save
     still names it in its title. */
  const listed = plan.entries.length
    ? validation
    : validation.filter((issue) => issue.path !== "entries");
  const unchanged = !dirty && !isNew;
  const saveBlocked = saving !== null || errors.length > 0 || unchanged;
  const dominant = dominantSport(summary.sportDistribution, plan.sportMix);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  const commit = (next: TrainingPlanDocument, typing?: string) => {
    onDraftChange(commitDraft(draft, withDerivedSportMix(next), typing));
  };
  /** A keystroke into a text field: folded into one undo state per visit. */
  const type = (field: "name" | "description") => (value: string) =>
    commit({ ...plan, [field]: value }, field);
  const seal = () => onDraftChange(sealDraft(draft));
  /* A session's unsaved edits are asked about with the dialog the plan's are. */
  const discardSession = ({ keep, discard }: { keep: () => void; discard: () => void }) => (
    <ConfirmDialog
      title={t("library.w.discardTitle")}
      description={t("library.ed.discardSessionBody")}
      confirmLabel={t("library.w.discard")}
      cancelLabel={t("library.w.keep")}
      danger
      onConfirm={discard}
      onCancel={keep}
    />
  );

  const close = () => {
    if (dirty) setLayer({ kind: "discard" });
    else onClose();
  };

  const save = async (target: "coros" | "draft") => {
    const write = target === "coros" ? onSave : onSaveDraft;
    if (!write || saving) return;
    if (target === "coros" && saveBlocked) return;
    if (target === "draft" && unchanged) return;
    setSaving(target);
    try {
      await write(plan);
    } finally {
      setSaving(null);
    }
  };

  const placeNew = (entry: TrainingPlanEntry, slot: PlanSlot) => {
    commit(addEntry(plan, entry, slot));
  };

  const addFromLibrary = async (workout: TrainingLibraryWorkout, slot: PlanSlot) => {
    setLayer({ kind: "library", slot, loading: workout.id });
    try {
      const session = await api.libraryWorkoutAsPlanSession(workout.id);
      placeNew(libraryEntry(session), slot);
      setLayer(null);
    } catch (cause) {
      setWorkoutEditorError(cause instanceof Error ? cause.message : String(cause));
      setLayer({ kind: "library", slot });
    }
  };

  /* ------------------------------------------------------------ actions */

  const live = useRef<EditorActions>(null!);
  live.current = {
    add: (kind, slot) => setLayer(kind === "session" ? { kind: "create", slot } : { kind: "library", slot }),
    open: (entryId) => {
      if (plan.entries.some((item) => item.id === entryId)) setLayer({ kind: "workout", entryId });
    },
    duplicate: (entryId) => {
      const entry = plan.entries.find((item) => item.id === entryId);
      if (entry) commit(copyEntry(plan, entryId, entry));
    },
    copyToNextWeek: (entryId) => {
      const entry = plan.entries.find((item) => item.id === entryId);
      if (!entry || entry.weekIndex >= plan.weekCount - 1) return;
      commit(copyEntry(plan, entryId, { weekIndex: entry.weekIndex + 1, dayIndex: entry.dayIndex }));
    },
    requestMove: (entryId) => setLayer({ kind: "move", entryId }),
    remove: (entryId) => commit(removeEntry(plan, entryId)),
    step: (entryId, direction) => {
      const entry = plan.entries.find((item) => item.id === entryId);
      if (!entry) return;
      const next = stepSlot(entry, direction, plan.weekCount);
      if (!next) return;
      refocusEntry.current = entryId;
      commit(moveEntry(plan, entryId, next));
    },
    dragStart: () => setDragging(true),
    dragEnd: () => {
      setDragging(false);
      setDropKey(null);
    },
    dragOver: (event, key) => {
      if (!event.dataTransfer.types.includes(ENTRY_DRAG)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = event.altKey || event.ctrlKey || event.metaKey ? "copy" : "move";
      if (dropKey !== key) setDropKey(key);
    },
    dragLeave: (event, key) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !event.currentTarget.contains(next)) {
        setDropKey((current) => (current === key ? null : current));
      }
    },
    drop: (event, slot) => {
      event.preventDefault();
      setDropKey(null);
      setDragging(false);
      const entryId = event.dataTransfer.getData(ENTRY_DRAG);
      if (entryId) {
        /* Held Alt, Ctrl or ⌘ copies, the way a file manager does. */
        const copying = event.altKey || event.ctrlKey || event.metaKey;
        commit(copying ? copyEntry(plan, entryId, slot) : moveEntry(plan, entryId, slot));
      }
    },
    week: (action, weekIndex) => {
      switch (action) {
        case "duplicate":
          if (plan.weekCount < MAX_WEEKS) commit(duplicateTrainingPlanWeek(plan, weekIndex));
          return;
        case "earlier":
          if (weekIndex > 0) commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex - 1));
          return;
        case "later":
          if (weekIndex < plan.weekCount - 1) commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex + 1));
          return;
        case "clear":
          commit(clearWeek(plan, weekIndex));
          return;
        case "delete": {
          if (plan.weekCount <= 1) return;
          const holds = plan.entries.some((entry) => entry.weekIndex === weekIndex);
          if (holds) setLayer({ kind: "delete-week", weekIndex });
          else commit(removeWeek(plan, weekIndex));
        }
      }
    },
    stage: (weekIndex, stage) => commit(setWeekStage(plan, weekIndex, stage))
  };
  const actions = useMemo<EditorActions>(
    () => ({
      add: (...args) => live.current.add(...args),
      open: (...args) => live.current.open(...args),
      duplicate: (...args) => live.current.duplicate(...args),
      copyToNextWeek: (...args) => live.current.copyToNextWeek(...args),
      requestMove: (...args) => live.current.requestMove(...args),
      remove: (...args) => live.current.remove(...args),
      step: (...args) => live.current.step(...args),
      dragStart: () => live.current.dragStart(),
      dragEnd: () => live.current.dragEnd(),
      dragOver: (...args) => live.current.dragOver(...args),
      dragLeave: (...args) => live.current.dragLeave(...args),
      drop: (...args) => live.current.drop(...args),
      week: (...args) => live.current.week(...args),
      stage: (...args) => live.current.stage(...args)
    }),
    []
  );

  /* ----------------------------------------------------- focus & scroll */

  useLayoutEffect(() => {
    const id = refocusEntry.current;
    if (!id) return;
    refocusEntry.current = null;
    const button = section.current?.querySelector<HTMLElement>(
      `[data-entry-id="${CSS.escape(id)}"] .plan-editor-entry-main`
    );
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  });

  useLayoutEffect(() => {
    if (jumpTo === null) return;
    const node = canvas.current;
    const card = node?.querySelector<HTMLElement>(`[data-week="${jumpTo}"]`);
    if (node && card) {
      const offset = card.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
      const glide = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollTo({ top: Math.max(0, offset - 12), behavior: glide ? "smooth" : "auto" });
      card.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    }
    setJumpTo(null);
  }, [jumpTo]);

  /* The reader's measured edge fade, for the same reason: a week cut at a
     hard line reads as the end of the plan. */
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measureEdges = useCallback(() => {
    const node = canvas.current;
    if (!node) return;
    const top = node.scrollTop > 2;
    const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 2;
    setEdges((held) => (held.top === top && held.bottom === bottom ? held : { top, bottom }));
  }, []);
  useLayoutEffect(measureEdges);

  /* ---------------------------------------------------------- keyboard */

  /*
   * On the window, not the section. An undo moves a session back to the day
   * it came from, and React mounts it afresh there, so the button that had
   * focus is gone and focus falls to <body> — outside the section, where a
   * handler on it heard nothing, so the second Ctrl+Z of a run did nothing.
   * The editor covers the window, so nothing else is listening for these.
   */
  const keys = useRef<(event: globalThis.KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    /* A dialog over the editor owns the keyboard; the workout editor is
       portalled beside this one and listens on the window too. */
    if (layer || event.defaultPrevented) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "s") {
      event.preventDefault();
      void save(onSave ? "coros" : "draft");
      return;
    }
    /* In a text field these belong to the field. */
    if (isTextField(event.target)) return;
    if (mod && key === "z" && !event.shiftKey) {
      event.preventDefault();
      onDraftChange(undoDraft(draft));
    } else if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      onDraftChange(redoDraft(draft));
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  useEffect(() => {
    const listen = (event: globalThis.KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);

  /* ------------------------------------------------------------ render */

  const hours = reading.timed ? Math.round(summary.durationSeconds / 360) / 10 : 0;
  const figures = [
    { label: plural("library.fig.weeks", plan.weekCount), value: formatCount(plan.weekCount) },
    { label: plural("library.fig.sessions", summary.workouts), value: formatCount(summary.workouts) },
    hours ? { label: plural("library.fig.hours", hours), value: formatDecimal(hours, Number.isInteger(hours) ? 0 : 1) } : null,
    summary.distanceMeters
      ? { label: t("library.fig.distance"), value: formatDistanceValue(summary.distanceMeters, unitSystem, { digits: 0 }) }
      : null,
    summary.trainingLoad ? { label: t("library.fig.load"), value: String(Math.round(summary.trainingLoad)) } : null
  ].filter((figure): figure is { label: string; value: string } => Boolean(figure));
  const lastWeekHolds = plan.entries.some((entry) => entry.weekIndex === plan.weekCount - 1);

  const editingEntry =
    layer?.kind === "workout" ? plan.entries.find((entry) => entry.id === layer.entryId) : undefined;
  const movingEntry =
    layer?.kind === "move" ? plan.entries.find((entry) => entry.id === layer.entryId) : undefined;

  const title = !plan.remoteId
    ? t("library.ed.titleNew")
    : plan.calendar === "running"
      ? t("library.ed.titleCalendar")
      : t("library.ed.titleEditing");
  const saveTitle = errors.length
    ? errors.map((issue) => issue.message).join(" ")
    : unchanged
      ? t("library.ed.unchanged")
      : undefined;

  return (
    <section
      ref={section}
      className="plan-editor"
      aria-label={plan.remoteId ? t("library.ed.editName", { name: plan.name }) : t("library.ed.titleNew")}
      style={dominant ? sportAccentStyle(dominant) : undefined}
    >
      <header className="plan-editor-bar">
        <button
          type="button"
          className="icon-button"
          aria-label={t("library.ed.close")}
          title={dirty ? t("library.ed.closeDirty") : t("common.close")}
          onClick={close}
        >
          <X size={16} />
        </button>
        <span className="plan-editor-bar-title">{title}</span>
        <span className="plan-editor-state" data-state={dirty ? "dirty" : "clean"} aria-live="polite">
          {dirty ? t("library.ed.dirty") : isNew ? t("library.ed.notSaved") : t("library.ed.noChanges")}
        </span>
        <div className="plan-editor-bar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={t("library.ed.undo")}
            title={t("library.ed.undoTitle")}
            disabled={!canUndo(draft)}
            onClick={() => onDraftChange(undoDraft(draft))}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("library.ed.redo")}
            title={t("library.ed.redoTitle")}
            disabled={!canRedo(draft)}
            onClick={() => onDraftChange(redoDraft(draft))}
          >
            <Redo2 size={16} />
          </button>
          {onDiscardDraft ? (
            <button
              type="button"
              className="ghost-button"
              disabled={saving !== null}
              title={t("library.ed.discardDraftTitle")}
              onClick={onDiscardDraft}
            >
              <Trash2 size={14} /> {t("library.ed.discardDraft")}
            </button>
          ) : null}
          {onSaveDraft ? (
            <button
              type="button"
              className="ghost-button"
              disabled={saving !== null || unchanged}
              title={unchanged ? t("library.ed.unchanged") : t("library.ed.keepLater")}
              onClick={() => void save("draft")}
            >
              {saving === "draft" ? <LoaderCircle size={14} className="is-spinning" /> : <FilePen size={14} />}
              {saving === "draft" ? t("library.ed.saving") : t("library.ed.saveDraft")}
            </button>
          ) : null}
          {onSave ? (
            <button
              type="button"
              className="primary-button"
              disabled={saveBlocked}
              title={saveTitle ?? t("library.ed.saveTitle")}
              onClick={() => void save("coros")}
            >
              {saving === "coros" ? <LoaderCircle size={14} className="is-spinning" /> : <Save size={14} />}
              {saving === "coros" ? t("library.ed.saving") : saveLabel ?? t("library.ed.saveCoros")}
            </button>
          ) : null}
        </div>
      </header>

      {listed.length ? (
        <ul className="plan-editor-issues" aria-label={t("library.ed.problems")}>
          {listed.map((issue, index) => (
            <li key={`${issue.path}:${index}`} data-severity={issue.severity}>
              <AlertTriangle size={13} aria-hidden="true" />
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="plan-editor-body">
        <div
          ref={canvas}
          className={`plan-editor-canvas${edges.top ? " has-fade-top" : ""}${edges.bottom ? " has-fade-bottom" : ""}${dragging ? " is-dragging" : ""}`}
          onScroll={measureEdges}
        >
          <div className="plan-editor-title">
            <input
              className="plan-editor-name"
              aria-label={t("library.ed.planName")}
              aria-invalid={!plan.name.trim() || undefined}
              placeholder={t("library.ed.namePh")}
              ref={nameField}
              value={plan.name}
              onChange={(event) => type("name")(event.target.value)}
              onBlur={seal}
            />
            <p className="plan-reader-meta">
              <PlanOriginBadge plan={plan} />
              <SportMixDots sports={plan.sportMix} counts={summary.sportDistribution} />
            </p>
            {plan.calendar === "running" ? (
              <p className="plan-editor-note is-warning">
                {t("library.ed.runningCopy")}
              </p>
            ) : null}
            <div className="plan-editor-about">
              <label className="plan-editor-field">
                <span>{t("library.ed.description")}</span>
                <textarea
                  rows={3}
                  value={plan.description}
                  placeholder={t("library.ed.descriptionPh")}
                  onChange={(event) => type("description")(event.target.value)}
                  onBlur={seal}
                />
              </label>
            </div>
          </div>

          <div className="plan-reader-figures">
            {figures.map((figure) => (
              <span key={figure.label}>
                <b>{figure.value}</b>
                <small>{figure.label}</small>
              </span>
            ))}
          </div>

          {plan.weekCount > 2 && summary.workouts > 0 ? (
            <PlanWeekRidge weeks={reading.weeks} onJump={setJumpTo} />
          ) : null}

          {plan.entries.length === 0 ? (
            <p className="plan-editor-start">
              {rich("library.ed.startHint", { b: () => <Plus size={12} aria-label={t("library.ed.plus")} /> })}
            </p>
          ) : null}

          <ol className="plan-reader-weeks">
            {reading.weeks.map((week) => (
              <EditorWeek
                key={week.weekIndex}
                week={week}
                stage={weekStageOf(plan, week.weekIndex)}
                weekCount={plan.weekCount}
                dropKey={dropKey?.startsWith(`${week.weekIndex}:`) ? dropKey : null}
                dragging={dragging}
                unitSystem={unitSystem}
                actions={actions}
              />
            ))}
          </ol>

          <div className="plan-editor-week-add">
            <button
              type="button"
              className="ghost-button"
              disabled={plan.weekCount >= MAX_WEEKS}
              onClick={() => commit(appendWeek(plan))}
            >
              <Plus size={14} /> {t("library.ed.addWeek")}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={plan.weekCount >= MAX_WEEKS || !lastWeekHolds}
              title={lastWeekHolds ? undefined : t("library.ed.nothingToRepeat", { n: plan.weekCount })}
              onClick={() => commit(duplicateTrainingPlanWeek(plan, plan.weekCount - 1))}
            >
              <Copy size={14} /> {t("library.ed.repeatWeek", { n: plan.weekCount })}
            </button>
          </div>
        </div>
      </div>

      {workoutEditorError ? (
        <div className="plan-editor-workout-error" role="alert">
          <AlertTriangle size={14} />
          {workoutEditorError}
          <button type="button" aria-label={t("library.ed.dismiss")} onClick={() => setWorkoutEditorError(null)}>
            <X size={12} />
          </button>
        </div>
      ) : null}

      {layer?.kind === "discard" ? (
        <ConfirmDialog
          title={t("library.w.discardTitle")}
          description={t("library.ed.discardPlanBody", { name: plan.name || t("library.ed.thisPlan") })}
          confirmLabel={t("library.w.discard")}
          cancelLabel={t("library.w.keep")}
          danger
          onConfirm={() => {
            setLayer(null);
            onClose();
          }}
          onCancel={() => setLayer(null)}
        />
      ) : null}

      {layer?.kind === "delete-week" ? (
        <ConfirmDialog
          title={t("library.ed.deleteWeekTitle", { n: layer.weekIndex + 1 })}
          description={plural(
            "library.ed.deleteWeekBody",
            plan.entries.filter((entry) => entry.weekIndex === layer.weekIndex).length
          )}
          confirmLabel={t("library.ed.deleteWeek")}
          danger
          onConfirm={() => {
            commit(removeWeek(plan, layer.weekIndex));
            setLayer(null);
          }}
          onCancel={() => setLayer(null)}
        />
      ) : null}

      {layer?.kind === "library" ? (
        <LibraryDialog
          where={slotLabel(layer.slot, reading.weeks[layer.slot.weekIndex])}
          workouts={workouts}
          loading={layer.loading}
          onPick={(workout) => void addFromLibrary(workout, layer.slot)}
          onCancel={() => setLayer(null)}
        />
      ) : null}

      {movingEntry ? (
        <MoveDialog
          entry={movingEntry}
          weeks={reading.weeks}
          onMove={(slot, copy) => {
            refocusEntry.current = copy ? null : movingEntry.id;
            commit(copy ? copyEntry(plan, movingEntry.id, slot) : moveEntry(plan, movingEntry.id, slot));
            setLayer(null);
          }}
          onCancel={() => setLayer(null)}
        />
      ) : null}

      {editingEntry ? (
        <WorkoutBuilderModal
          api={api}
          source={{ kind: "plan", entry: editingEntry }}
          heading={{
            eyebrow: `${plan.name || t("library.ed.titleNew")} · ${slotLabel(editingEntry, reading.weeks[editingEntry.weekIndex])}`,
            title: t("library.ed.editSession", { name: editingEntry.title || t("library.ed.session") })
          }}
          confirmDiscard={discardSession}
          onClose={() => setLayer(null)}
          onSavedToPlan={(workout) => {
            commit({
              ...plan,
              entries: plan.entries.map((entry) =>
                entry.id === editingEntry.id ? replaceTrainingPlanEntryWorkout(entry, workout) : entry
              )
            });
            setLayer(null);
          }}
          onError={setWorkoutEditorError}
        />
      ) : null}

      {layer?.kind === "create" ? (
        /* The builder as Create workout opens it, sport picker and all, on
           the plan's own sport. */
        <WorkoutBuilderModal
          api={api}
          source={{ kind: "plan-new", sport: dominant }}
          heading={{
            eyebrow: `${plan.name || t("library.ed.titleNew")} · ${slotLabel(layer.slot, reading.weeks[layer.slot.weekIndex])}`,
            title: t("library.ed.newSession")
          }}
          confirmDiscard={discardSession}
          onClose={() => setLayer(null)}
          onSavedToPlan={(workout) => {
            placeNew(replaceTrainingPlanEntryWorkout(writtenEntry(workout), workout), layer.slot);
            setLayer(null);
          }}
          onError={setWorkoutEditorError}
        />
      ) : null}
    </section>
  );
}

/* ================================================================ a week */

interface EditorWeekProps {
  week: PlanReaderWeek;
  stage: TrainingPlanWeekStage;
  weekCount: number;
  /** The slot under a drag, when it is in this week. */
  dropKey: string | null;
  dragging: boolean;
  unitSystem: ReturnType<typeof useUnitSystem>["unitSystem"];
  actions: EditorActions;
}

const EditorWeek = memo(function EditorWeek({
  week,
  stage,
  weekCount,
  dropKey,
  dragging,
  unitSystem,
  actions
}: EditorWeekProps) {
  useI18n();
  const weekNumber = week.weekIndex + 1;
  const holds = week.days.some((day) => day.entries.length > 0);
  const menu: PlanMenuItem[] = [
    { label: t("library.wk.dupWeek"), icon: Copy, disabled: weekCount >= MAX_WEEKS, onSelect: () => actions.week("duplicate", week.weekIndex) },
    { label: t("library.wk.earlier"), icon: ArrowUp, disabled: week.weekIndex === 0, separated: true, onSelect: () => actions.week("earlier", week.weekIndex) },
    { label: t("library.wk.later"), icon: ArrowDown, disabled: week.weekIndex >= weekCount - 1, onSelect: () => actions.week("later", week.weekIndex) },
    { label: t("library.wk.clearWeek"), icon: Eraser, disabled: !holds, separated: true, onSelect: () => actions.week("clear", week.weekIndex) },
    {
      label: t("library.wk.deleteWeek"),
      icon: Trash2,
      danger: true,
      disabled: weekCount <= 1,
      title: weekCount <= 1 ? t("library.wk.oneWeek") : undefined,
      onSelect: () => actions.week("delete", week.weekIndex)
    }
  ];

  return (
    <li
      className="plan-week-card plan-editor-week"
      data-week={week.weekIndex}
      data-stage={week.stageSlug}
    >
      <header>
        <h2 tabIndex={-1}>{t("library.reader.weekN", { n: weekNumber })}</h2>
        <p>{formatWeekLine(week)}</p>
        <OptionGroup<string>
          label={t("library.wk.stageOf", { n: weekNumber })}
          className="plan-editor-week-stage"
          value={String(stage)}
          options={stageOptions()}
          onChange={(value) => actions.stage(week.weekIndex, Number(value) as TrainingPlanWeekStage)}
          mode="dropdown"
        />
        <PlanMenu label={t("library.wk.actionsWeek", { n: weekNumber })} className="plan-editor-week-menu" items={menu} />
      </header>

      <div className="plan-editor-days">
        {week.days.map((day) => {
          const slot = { weekIndex: week.weekIndex, dayIndex: day.dayIndex };
          const key = slotKey(slot);
          return (
            <div
              key={day.dayIndex}
              className={`plan-editor-day${day.entries.length ? "" : " is-empty"}${dropKey === key ? " is-drop" : ""}`}
              onDragOver={(event) => actions.dragOver(event, key)}
              onDragLeave={(event) => actions.dragLeave(event, key)}
              onDrop={(event) => actions.drop(event, slot)}
            >
              <div className="plan-editor-day-head">
                <span className="plan-editor-day-label">{day.label}</span>
                <PlanMenu
                  label={t("library.wk.addTo", { day: day.label, n: weekNumber })}
                  className="plan-editor-day-menu"
                  triggerClassName="plan-editor-day-add"
                  trigger={<Plus size={13} aria-hidden="true" />}
                  align={day.dayIndex < 4 ? "start" : "end"}
                  items={[
                    { label: t("library.wk.newSession"), icon: PenLine, onSelect: () => actions.add("session", slot) },
                    { label: t("library.wk.fromLibrary"), icon: Library, onSelect: () => actions.add("library", slot) }
                  ]}
                />
              </div>
              {day.entries.length ? (
                <ul className="plan-editor-day-entries">
                  {day.entries.map((entry) => (
                    <EditorEntry
                      key={entry.id}
                      entry={entry}
                      lastWeek={week.weekIndex >= weekCount - 1}
                      unitSystem={unitSystem}
                      actions={actions}
                    />
                  ))}
                </ul>
              ) : dragging ? null : (
                <span className="plan-editor-day-empty" aria-hidden="true">
                  {t("library.wk.free")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </li>
  );
});

/* ============================================================= a session */

interface EditorEntryProps {
  entry: PlanEntryFacts;
  lastWeek: boolean;
  unitSystem: ReturnType<typeof useUnitSystem>["unitSystem"];
  actions: EditorActions;
}

const STEP_KEYS: Record<string, StepDirection> = {
  ArrowLeft: "previous-day",
  ArrowRight: "next-day",
  ArrowUp: "previous-week",
  ArrowDown: "next-week"
};

function EditorEntry({ entry, lastWeek, unitSystem, actions }: EditorEntryProps) {
  const Icon = sportTheme(entry.sport).icon;
  const figures = entryFigures(entry, unitSystem);

  const menu: PlanMenuItem[] = [
    { label: t("library.wk.editSession"), icon: Pencil, onSelect: () => actions.open(entry.id) },
    { label: t("library.wk.moveTo"), icon: MoveRight, onSelect: () => actions.requestMove(entry.id) },
    { label: t("library.wk.duplicate"), icon: Copy, onSelect: () => actions.duplicate(entry.id) },
    {
      label: t("library.wk.copyNext"),
      icon: CopyPlus,
      disabled: lastWeek,
      title: lastWeek ? t("library.wk.lastWeek") : undefined,
      onSelect: () => actions.copyToNextWeek(entry.id)
    },
    { label: t("library.wk.delete"), icon: Trash2, danger: true, separated: true, onSelect: () => actions.remove(entry.id) }
  ];

  return (
    <li
      className="plan-editor-entry"
      data-entry-id={entry.id}
      style={sportChipStyle(entry.sport)}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(ENTRY_DRAG, entry.id);
        event.dataTransfer.effectAllowed = "copyMove";
        actions.dragStart();
      }}
      onDragEnd={actions.dragEnd}
    >
      <button
        type="button"
        className="plan-editor-entry-main"
        title={t("library.wk.entryTitle", { name: entry.title })}
        onClick={() => actions.open(entry.id)}
        onKeyDown={(event) => {
          const direction = STEP_KEYS[event.key];
          if (direction && event.altKey) {
            event.preventDefault();
            actions.step(entry.id, direction);
          } else if ((event.key === "Delete" || event.key === "Backspace") && !event.altKey) {
            event.preventDefault();
            actions.remove(entry.id);
          }
        }}
      >
        <span className="plan-editor-entry-mark" aria-hidden="true">
          <Icon size={12} strokeWidth={2.2} />
        </span>
        <span className="plan-editor-entry-name">{entry.title}</span>
        <span className={`plan-editor-entry-detail${figures.length ? "" : " is-nil"}`}>
          {figures.join(" · ") || t("library.entry.noTarget")}
        </span>
      </button>
      <PlanMenu
        label={t("library.wk.actionsFor", { name: entry.title })}
        className="plan-editor-entry-menu"
        triggerClassName="plan-editor-entry-more"
        trigger={<MoreHorizontal size={14} aria-hidden="true" />}
        items={menu}
      />
    </li>
  );
}

/* ======================================================= library workout */

function LibraryRow({
  workout,
  loading,
  disabled,
  onAdd
}: {
  workout: TrainingLibraryWorkout;
  loading: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const sport = workoutSportFromType(workout.sportType);
  const Icon = sportTheme(sport).icon;
  const facts = [
    workoutSportLabel(sport ?? "run"),
    workout.durationSeconds ? formatPlannedDuration(workout.durationSeconds) : null,
    workout.setCount ? plural("workout.sets", workout.setCount) : null
  ].filter(Boolean);
  return (
    <li style={sportChipStyle(sport)}>
      <button type="button" onClick={onAdd} disabled={disabled} aria-busy={loading || undefined}>
        <span className="plan-editor-entry-mark" aria-hidden="true">
          <Icon size={12} strokeWidth={2.2} />
        </span>
        <span className="plan-editor-library-text">
          <span className="plan-editor-library-name">{workout.name}</span>
          <small>{facts.join(" · ")}</small>
        </span>
        {loading ? (
          <LoaderCircle className="plan-editor-library-add is-spinning" size={14} aria-hidden="true" />
        ) : (
          <Plus className="plan-editor-library-add" size={14} aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

/* ======================================================== add dialogs */

/**
 * Escape closes a dialog before the editor behind it hears the key — captured,
 * for the reason ConfirmDialog captures it.
 */
function useDialogEscape(onCancel: () => void) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
}

/** A saved workout, picked for one day and copied in whole. */
function LibraryDialog({
  where,
  workouts,
  loading,
  onPick,
  onCancel
}: {
  where: string;
  workouts: TrainingLibraryWorkout[];
  /** The workout being read from COROS, while it is. */
  loading?: string;
  onPick: (workout: TrainingLibraryWorkout) => void;
  onCancel: () => void;
}) {
  useDialogEscape(onCancel);
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? workouts.filter((workout) => workout.name.toLowerCase().includes(needle))
    : workouts;
  return (
    <div className="tl-dialog-backdrop" onMouseDown={onCancel}>
      <section
        className="tl-dialog plan-editor-add-dialog is-library"
        role="dialog"
        aria-modal="true"
        aria-label={t("library.libdlg.addLabel")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{t("library.libdlg.title")}</h2>
        <p>{t("library.libdlg.on", { where })}</p>
        <label className="plan-editor-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={field}
            value={query}
            placeholder={plural("library.libdlg.searchPh", workouts.length)}
            aria-label={t("library.libdlg.search")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches.length === 1 && !loading) onPick(matches[0]!);
            }}
          />
        </label>
        {matches.length ? (
          <ul className="plan-editor-library">
            {matches.map((workout) => (
              <LibraryRow
                key={workout.id}
                workout={workout}
                loading={loading === workout.id}
                disabled={Boolean(loading)}
                onAdd={() => onPick(workout)}
              />
            ))}
          </ul>
        ) : (
          <p className="plan-editor-hint">
            {workouts.length
              ? t("library.libdlg.noMatch")
              : t("library.libdlg.empty")}
          </p>
        )}
        <footer>
          <button type="button" className="ghost-button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </footer>
      </section>
    </div>
  );
}

/* ============================================================ move dialog */

function MoveDialog({
  entry,
  weeks,
  onMove,
  onCancel
}: {
  entry: TrainingPlanEntry;
  weeks: readonly PlanReaderWeek[];
  onMove: (slot: PlanSlot, copy: boolean) => void;
  onCancel: () => void;
}) {
  const [weekIndex, setWeekIndex] = useState(entry.weekIndex);
  const [day, setDay] = useState(String(entry.dayIndex));
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  useDialogEscape(onCancel);

  const week = weeks[weekIndex];
  const slot: PlanSlot = { weekIndex, dayIndex: Number(day) };
  const unchanged = slot.weekIndex === entry.weekIndex && slot.dayIndex === entry.dayIndex;
  const name = entry.title || t("library.move.session");

  return (
    <div className="tl-dialog-backdrop" onMouseDown={onCancel}>
      <section
        className="tl-dialog plan-editor-move"
        role="dialog"
        aria-modal="true"
        aria-label={t("library.move.label", { name })}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{t("library.move.title", { name })}</h2>
        <div className="plan-editor-field">
          <span>{t("library.move.week")}</span>
          <SelectDropdown<string>
            label={t("library.move.week")}
            value={String(weekIndex)}
            options={weeks.map((item) => ({
              value: String(item.weekIndex),
              label: item.stage
                ? t("library.move.weekStage", { n: item.weekIndex + 1, stage: item.stage })
                : t("library.move.weekOption", { n: item.weekIndex + 1 })
            }))}
            portal
            onChange={(value) => setWeekIndex(Number(value))}
          />
        </div>
        <div className="plan-editor-field">
          <span>{t("library.move.day")}</span>
          <OptionGroup<string>
            label={t("library.move.day")}
            value={day}
            options={weekdayNames("short").map((dayName, index) => ({
              value: String(index),
              label: dayName,
              title: week?.days[index]?.label
            }))}
            onChange={setDay}
            size="md"
            fill
          />
        </div>
        <footer>
          <button ref={cancel} type="button" className="ghost-button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="ghost-button" onClick={() => onMove(slot, true)}>
            {t("library.move.copy")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={unchanged}
            onClick={() => onMove(slot, false)}
          >
            {t("library.move.move")}
          </button>
        </footer>
      </section>
    </div>
  );
}
