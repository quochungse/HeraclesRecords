import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Dumbbell,
  GripVertical,
  Layers,
  Gauge,
  ListChecks,
  LoaderCircle,
  Plus,
  Repeat,
  Route,
  Save,
  Trash2,
  Ungroup,
  X,
  type LucideIcon
} from "lucide-react";
import { OptionGroup } from "../components/OptionGroup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  RunWorkoutEditorDraft,
  RunWorkoutEditorIntensity,
  RunWorkoutEditorNode,
  RunWorkoutEditorRepeatGroup,
  RunWorkoutEditorStep,
  RunWorkoutEditorStepKind,
  RunWorkoutEditorTarget,
  WorkoutEditPreview,
  WorkoutEditRef,
  WorkoutEditSaveResult,
  WorkoutEditorDocument,
  WorkoutEditorContext,
  WorkoutExerciseOption,
  WorkoutHeartRateBasis,
  WorkoutIntensityInput,
  WorkoutSport
} from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { SelectDropdown } from "../components/SelectDropdown";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  elevationToMeters,
  elevationUnit,
  metersToElevation,
  swimDistanceUnit
} from "../units/units";
import { ExerciseCombobox } from "./ExerciseCombobox";
import { useWorkoutExerciseCatalog } from "./useWorkoutExerciseCatalog";
import { ExercisePreview } from "./ExercisePreview";
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
import {
  CLIMB_GRADES,
  CLIMB_SYSTEM_IDS,
  FTP_PRESETS,
  HEART_RATE_PRESETS,
  PACE_PRESETS,
  SWIM_STROKE_IDS,
  WORKOUT_SPORT_CAPABILITIES,
  validateWorkoutDraftShared,
  workoutIntensitiesForStep,
  workoutTargetsForStep
} from "../../electron/workoutCapabilities";
import { formatCount, formatDecimal, plural, t } from "../i18n/core";
import { intensityTypeLabel, swimStrokeLabel, zoneOptionText } from "../i18n/workoutWords";
import { builderTargetTypeLabel } from "./workoutBuilderRows";

/**
 * The Calendar's editor for a scheduled occurrence, and its read-only view of
 * a library workout.
 *
 * Every other workout — a plan session, new or edited, and Edit workout in the
 * Training Library — is written in the workout builder (`WorkoutBuilderModal`),
 * which is Create workout's own form. This modal's plan mode went with that
 * move, along with the heading and discard question that only the plan editor
 * passed.
 */
interface WorkoutEditorModalProps {
  api: HeraclesRecordsApi;
  editRef: WorkoutEditRef;
  /**
   * Opens the same surface with every control inert and no Save.
   *
   * The Calendar shows library workouts this way: a workout in the library is
   * a reusable template, and changing one there silently rewrites what every
   * future use of it will be, which is not a decision to offer from a day cell
   * that only wanted to know what the session is. Training Library owns that.
   *
   * It rides on the `canEdit` gate that the unsupported-sport case already
   * wired through every control, rather than a second disabled path beside it.
   */
  readOnly?: boolean;
  onClose: () => void;
  onSaved?: (result: WorkoutEditSaveResult) => void;
  onError: (message: string | null) => void;
}

interface StepLocation {
  nodeId: string;
  childId?: string;
}

let localNodeCounter = 0;

function localId(prefix: string): string {
  localNodeCounter += 1;
  return `${prefix}-new-${Date.now()}-${localNodeCounter}`;
}

function emptyStep(
  kind: RunWorkoutEditorStepKind = "training",
  sport: WorkoutSport = "run"
): RunWorkoutEditorStep {
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  return {
    id: localId("step"),
    nodeType: "step",
    kind,
    name: kind === "rest" ? "Rest" : kind === "warmup" ? "Warm Up" : kind === "cooldown" ? "Cool Down" : "Training",
    target: sport === "strength" && kind === "training"
      ? { type: "reps", count: 10 }
      : { type: "time", seconds: kind === "rest" ? 60 : 300 },
    intensity: sport === "strength" && kind !== "training"
      ? { type: "none" }
      : structuredClone(capability.defaultIntensity),
    ...(capability.requiresExercise && kind === "training"
      ? {
          exerciseName: "",
          ...(sport === "strength"
            ? { sets: 3, restType: 1, restValue: 60 }
            : {})
        }
      : {}),
    editable: true
  };
}

function cloneStep(step: RunWorkoutEditorStep): RunWorkoutEditorStep {
  return {
    ...structuredClone(step),
    id: localId("step"),
    sourceExerciseId: undefined
  };
}

function cloneNode(node: RunWorkoutEditorNode): RunWorkoutEditorNode {
  if (node.nodeType === "step") {
    return cloneStep(node);
  }
  return {
    ...structuredClone(node),
    id: localId("group"),
    sourceExerciseId: undefined,
    steps: node.steps.map(cloneStep)
  };
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

function secondsFromClock(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return 0;
  }
  if (parts.length === 2) {
    return Math.round(parts[0]! * 60 + parts[1]!);
  }
  if (parts.length === 3) {
    return Math.round(parts[0]! * 3600 + parts[1]! * 60 + parts[2]!);
  }
  return Number(value) > 0 ? Math.round(Number(value)) : 0;
}

/** A new step's name, saved to COROS, so in the words COROS shows. */
function stepTitle(kind: RunWorkoutEditorStepKind): string {
  return kind === "warmup"
    ? "Warm Up" // i18n-ignore: saved to COROS
    : kind === "cooldown"
      ? "Cool Down" // i18n-ignore: saved to COROS
      : kind === "rest"
        ? "Rest" // i18n-ignore: saved to COROS
        : kind === "sendOff"
          ? "Send-off" // i18n-ignore: saved to COROS
        : "Training"; // i18n-ignore: saved to COROS
}

/** The same kind, as the screen names it. */
function stepKindLabel(kind: RunWorkoutEditorStepKind): string {
  return t(`workout.step.${kind}`);
}

const STRENGTH_REST_PRESETS = [0, 30, 45, 60, 90, 120, 180] as const;

type StrengthLoadMode = "unspecified" | "bodyweight" | "added";

function strengthLoadMode(intensity: RunWorkoutEditorIntensity): StrengthLoadMode {
  if (intensity.type !== "weight") return "unspecified";
  return intensity.mode === "bodyweight" ? "bodyweight" : "added";
}

function strengthRestLabel(seconds: number): string {
  if (seconds === 0) return t("workout.e.none");
  if (seconds < 60) return t("units.duration.s", { s: seconds });
  const minutes = seconds / 60;
  return t("units.duration.m", { m: Number.isInteger(minutes) ? minutes : formatDecimal(minutes, 1) });
}

function strengthTargetSummary(target: RunWorkoutEditorTarget): string {
  if (target.type === "reps") return plural("workout.reps", target.count);
  if (target.type === "time") return clockFromSeconds(target.seconds);
  if (target.type === "open") return t("workout.open");
  return target.type;
}

function strengthStepSummary(
  step: RunWorkoutEditorStep
): string {
  const sets = step.sets ?? 1;
  const target = strengthTargetSummary(step.target);
  const load = step.intensity.type === "weight"
    ? step.intensity.mode === "bodyweight"
      ? t("workout.e.bodyweightLower")
      : `${step.intensity.value} ${step.intensity.unit}`
    : t("workout.e.loadNotSet");
  const rest = step.restValue ?? 0;
  return sets > 1
    ? t("workout.e.schemeRest", { sets: plural("workout.sets", sets), target, load, rest: strengthRestLabel(rest) })
    : t("workout.e.scheme", { sets: plural("workout.sets", sets), target, load });
}

function targetForType(
  type: RunWorkoutEditorTarget["type"],
  kind: RunWorkoutEditorStepKind
): RunWorkoutEditorTarget {
  if (type === "distance") return { type, meters: 1_000 };
  if (type === "load") return { type, load: 50 };
  if (type === "hrRecovery") {
    return kind === "rest" ? { type, bpm: 120 } : { type: "time", seconds: 60 };
  }
  if (type === "reps") return { type, count: 10 };
  if (type === "elevationGain") return { type, meters: 500 };
  if (type === "routes") return { type, count: 4 };
  if (type === "open") return { type };
  return { type, seconds: kind === "rest" ? 60 : 300 };
}

function intensityForType(
  type: RunWorkoutEditorIntensity["type"],
  context: WorkoutEditorContext
): RunWorkoutEditorIntensity {
  if (type === "pace" || type === "effortPace") {
    return {
      type,
      lowSecondsPerKm: 300,
      highSecondsPerKm: 330,
      displayUnit: context.paceUnit
    };
  }
  if (type === "heartRate") return { type, lowBpm: 140, highBpm: 155 };
  if (type === "heartRatePercent") return { type, basis: "maxHr", preset: "aerobicEndurance" };
  if (type === "lthrPercent") return { type, lowPercent: 91, highPercent: 95 };
  if (type === "thresholdPacePercent" || type === "effortPacePercent") return { type, preset: "aerobicEndurance" };
  if (type === "ftpPercent") return { type, preset: "aerobicEndurance" };
  if (type === "power") return { type, lowWatts: 180, highWatts: 220 };
  if (type === "speed") return { type, low: 10, high: 12, unit: context.distanceUnit === "imperial" ? "mph" : "km/h" };
  if (type === "cadence") return { type, low: 80, high: 90, unit: "rpm" };
  if (type === "swimStroke") return { type, stroke: "freestyle" };
  if (type === "weight") return { type, mode: "bodyweight" };
  if (type === "rpe") return { type, value: 5 };
  if (type === "climbGrade") return { type, system: "yds", relativeToOnsight: 0 };
  return { type: "none" };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(Math.min(to, next.length), 0, item);
  return next;
}

export function WorkoutEditorModal({
  api,
  editRef: editRefProp,
  readOnly = false,
  onClose,
  onSaved,
  onError
}: WorkoutEditorModalProps) {
  const { unitSystem } = useUnitSystem();
  const reducedMotion = useReducedMotion();
  /*
   * The ref by what it names, not by identity. The load below is keyed on it,
   * and a caller that writes the ref as a literal hands over a new object on
   * every render of its own — each of which reset the document and fetched it
   * again, so the editor flashed back to its skeleton a few seconds after
   * opening and dropped whatever had been typed.
   */
  const editRefKey = JSON.stringify(editRefProp);
  const editRef = useMemo(() => editRefProp, [editRefKey]);
  const [document, setDocument] = useState<WorkoutEditorDocument | null>(null);
  const [draft, setDraft] = useState<RunWorkoutEditorDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkoutEditPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const previewSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setDraft(null);
    setLoadError(null);
    void api.getWorkoutForEdit(editRef, unitSystem).then((loaded) => {
      if (!cancelled) {
        setDocument(readOnly ? { ...loaded, canEdit: false } : loaded);
        setDraft(structuredClone(loaded.draft));
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [api, editRef, readOnly, unitSystem]);

  /* Shared with the day drawer, which needs the same catalog to name a
     strength session — and shared means one request between them rather than
     one each, because the promise is cached per sport. */
  const {
    options: exerciseOptions,
    byId: exercisesById,
    loading: exerciseOptionsLoading
  } = useWorkoutExerciseCatalog(api, draft?.sport);

  const dirty = Boolean(document && draft && JSON.stringify(document.draft) !== JSON.stringify(draft));
  const validation = useMemo(
    () => draft ? validateWorkoutDraftShared(draft) : { valid: false, errors: {} },
    [draft]
  );

  useEffect(() => {
    const sequence = ++previewSequence.current;
    if (!document || !draft || !document.canEdit || !validation.valid) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      setPreviewError(null);
      void api.previewWorkoutEdit(
        editRef,
        document.revision,
        draft,
        unitSystem
      )
        .then((result) => {
          if (previewSequence.current === sequence) setPreview(result);
        })
        .catch((cause: unknown) => {
          if (previewSequence.current === sequence) {
            setPreviewError(cause instanceof Error ? cause.message : String(cause));
          }
        })
        .finally(() => {
          if (previewSequence.current === sequence) setPreviewing(false);
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [api, document, draft, editRef, unitSystem, validation.valid]);

  const requestClose = useCallback(() => {
    if (dirty && !saving) setConfirmClose(true);
    else onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (confirmClose) setConfirmClose(false);
      else requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmClose, requestClose]);

  const updateStep = (location: StepLocation, update: (step: RunWorkoutEditorStep) => RunWorkoutEditorStep) => {
    setDraft((current) => current ? {
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== location.nodeId) return node;
        if (node.nodeType === "step") return update(node);
        return { ...node, steps: node.steps.map((step) => step.id === location.childId ? update(step) : step) };
      })
    } : current);
  };

  const deleteAt = (location: StepLocation) => {
    setDraft((current) => current ? {
      ...current,
      nodes: current.nodes.flatMap((node) => {
        if (node.id !== location.nodeId) return [node];
        if (node.nodeType === "step") return [];
        const steps = node.steps.filter((step) => step.id !== location.childId);
        return steps.length > 0 ? [{ ...node, steps }] : [];
      })
    } : current);
  };

  const duplicateAt = (location: StepLocation) => {
    setDraft((current) => current ? {
      ...current,
      nodes: current.nodes.flatMap((node) => {
        if (node.id !== location.nodeId) return [node];
        if (node.nodeType === "step") return [node, cloneStep(node)];
        const index = node.steps.findIndex((step) => step.id === location.childId);
        if (index < 0) return [node];
        const steps = [...node.steps];
        steps.splice(index + 1, 0, cloneStep(steps[index]!));
        return [{ ...node, steps }];
      })
    } : current);
  };

  const moveAt = (location: StepLocation, direction: -1 | 1) => {
    setDraft((current) => {
      if (!current) return current;
      if (!location.childId) {
        const index = current.nodes.findIndex((node) => node.id === location.nodeId);
        return { ...current, nodes: moveItem(current.nodes, index, index + direction) };
      }
      return {
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== location.nodeId || node.nodeType !== "repeat") return node;
          const index = node.steps.findIndex((step) => step.id === location.childId);
          return { ...node, steps: moveItem(node.steps, index, index + direction) };
        })
      };
    });
  };

  const ungroupStep = (groupId: string, childId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const groupIndex = current.nodes.findIndex((node) => node.id === groupId);
      const group = current.nodes[groupIndex];
      if (!group || group.nodeType !== "repeat") return current;
      const child = group.steps.find((step) => step.id === childId);
      if (!child) return current;
      const remaining = group.steps.filter((step) => step.id !== childId);
      const replacement: RunWorkoutEditorNode[] = remaining.length > 0 ? [{ ...group, steps: remaining }, child] : [child];
      return { ...current, nodes: [...current.nodes.slice(0, groupIndex), ...replacement, ...current.nodes.slice(groupIndex + 1)] };
    });
  };

  const groupWithPrevious = (nodeId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const index = current.nodes.findIndex((node) => node.id === nodeId);
      const previous = current.nodes[index - 1];
      const selected = current.nodes[index];
      if (index < 1 || !previous || !selected || previous.nodeType !== "step" || selected.nodeType !== "step" || !previous.editable || !selected.editable) return current;
      const group: RunWorkoutEditorRepeatGroup = {
        id: localId("group"),
        nodeType: "repeat",
        name: "Repeat", // i18n-ignore: saved to COROS
        repeat: 2,
        steps: [previous, selected],
        editable: true
      };
      return { ...current, nodes: [...current.nodes.slice(0, index - 1), group, ...current.nodes.slice(index + 1)] };
    });
  };

  const reorderTop = (sourceId: string, targetIndex: number) => {
    setDraft((current) => {
      if (!current) return current;
      const from = current.nodes.findIndex((node) => node.id === sourceId);
      if (from < 0) return current;
      return { ...current, nodes: moveItem(current.nodes, from, targetIndex > from ? targetIndex - 1 : targetIndex) };
    });
  };

  const groupByDrop = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setDraft((current) => {
      if (!current) return current;
      const sourceIndex = current.nodes.findIndex((node) => node.id === sourceId);
      const targetIndex = current.nodes.findIndex((node) => node.id === targetId);
      const source = current.nodes[sourceIndex];
      const target = current.nodes[targetIndex];
      if (!source || !target || source.nodeType !== "step" || target.nodeType !== "step" || !source.editable || !target.editable) return current;
      const first = Math.min(sourceIndex, targetIndex);
      const nodes = current.nodes.filter((node) => node.id !== sourceId && node.id !== targetId);
      nodes.splice(first, 0, {
        id: localId("group"), nodeType: "repeat", name: "Repeat", repeat: 2, // i18n-ignore: saved to COROS
        steps: sourceIndex < targetIndex ? [source, target] : [target, source], editable: true
      });
      return { ...current, nodes };
    });
  };

  const save = async () => {
    if (!document || !draft || !validation.valid) return;
    setSaving(true);
    try {
      if (!onSaved) throw new Error("The workout editor is missing its save target."); // i18n-ignore: a programming error
      const result = await api.saveWorkoutEdit(
        editRef,
        document.revision,
        draft,
        unitSystem
      );
      onSaved(result);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
    <AnimatePresence>
      <motion.div className="workout-editor-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.section
          className={readOnly ? "workout-editor-modal is-view" : "workout-editor-modal"}
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
              {/* The sport leads the line above the title. It used to be a Sport
                  field in the form, which no workout here can change — a new
                  plan session has its sport chosen before this opens, and an
                  existing COROS workout cannot change sport in place — so it
                  was a locked dropdown with one option. */}
              <p className="eyebrow workout-editor-eyebrow">
                {draft ? <WorkoutSportTag sport={draft.sport} /> : null}
                <span>{editRef.kind === "scheduled" ? t("workout.e.scheduled") : t("workout.e.library")}</span>
              </p>
              {/* Reading a workout, its own name is the heading — it was in a
                  disabled text box two thirds of the way down the form, under
                  a title that named the sport instead. Editing still says what
                  is being edited, because the name is a field there. */}
              <h2 id="workout-editor-title">
                {readOnly
                  ? (draft?.name.trim() || (draft ? workoutSportLabel(draft.sport) : t("workout.untitled")))
                  : draft ? t("workout.e.edit", { sport: workoutSportLabel(draft.sport) }) : t("workout.e.editWorkout")}
              </h2>
            </div>
            <button type="button" className="icon-button" aria-label={readOnly ? t("workout.e.closeWorkout") : t("workout.e.closeEditor")} onClick={requestClose} disabled={saving}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {!document && !loadError ? <EditorSkeleton /> : null}
          {loadError ? (
            <div className="workout-editor-state is-error">
              <AlertTriangle size={22} aria-hidden="true" />
              <h3>{t("workout.builderModal.loadFailed")}</h3><p>{loadError}</p>
              <button type="button" className="ghost-button" onClick={onClose}>{t("common.close")}</button>
            </div>
          ) : null}

          {document && draft && readOnly ? (
            <>
              <div className="workout-editor-scroll">
                <WorkoutReadOnlyBody
                  draft={draft}
                  context={document.context}
                  exercisesById={exercisesById}
                />
              </div>
              <footer className="workout-editor-footer">
                <div className="workout-editor-footer-actions">
                  <button type="button" className="primary-button" onClick={onClose}>{t("common.close")}</button>
                </div>
              </footer>
            </>
          ) : null}

          {document && draft && !readOnly ? (
            <>
              <div className="workout-editor-scroll">
                {!document.canEdit ? <div className="workout-editor-notice"><AlertTriangle size={16} aria-hidden="true" />{document.unsupportedReason}</div> : null}
                <div className="workout-editor-basics">
                  {draft.sport === "swim" ? (
                    <label className="calendar-field">
                      <span>{t("workout.e.poolLength", { unit: document.context.defaultPoolLength.unit })}</span>
                      <div className="workout-range-inputs">
                        <input
                          type="number"
                          min="1"
                          value={draft.sportOptions?.poolLength?.value ?? document.context.defaultPoolLength.value}
                          disabled={!document.canEdit || saving}
                          onChange={(event) => setDraft({
                            ...draft,
                            sportOptions: {
                              ...draft.sportOptions,
                              poolLength: {
                                value: Number(event.target.value),
                                unit: draft.sportOptions?.poolLength?.unit ?? document.context.defaultPoolLength.unit
                              }
                            }
                          })}
                        />
                        <span className="calendar-builder-readonly-value">
                          {document.context.defaultPoolLength.unit}
                        </span>
                      </div>
                    </label>
                  ) : null}
                  {(draft.sport === "indoorClimb" || draft.sport === "bouldering") ? (
                    <label className="calendar-field">
                      <span>{t("workout.b.w.gradingSystem")}</span>
                      <SelectDropdown<keyof typeof CLIMB_SYSTEM_IDS>
                        label={t("workout.b.w.gradingSystem")}
                        value={draft.sportOptions?.gradingSystem ?? document.context.climbSystems[draft.sport] ?? (draft.sport === "bouldering" ? "vScale" : "yds")}
                        disabled={!document.canEdit || saving}
                        options={(Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>).map((system) => ({ value: system, label: system }))}
                        portal
                        onChange={(gradingSystem) => setDraft({ ...draft, sportOptions: { ...draft.sportOptions, gradingSystem } })}
                      />
                    </label>
                  ) : null}
                  <label className="calendar-field">
                    <span>{t("workout.e.name")}</span>
                    <input maxLength={90} value={draft.name} disabled={!document.canEdit || saving} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    <small>{draft.name.length}/90</small>
                    {validation.errors.name ? <em>{validation.errors.name}</em> : null}
                  </label>
                  <label className="calendar-field">
                    <span>{t("workout.b.w.description")}</span>
                    <textarea maxLength={300} rows={3} value={draft.overview} disabled={!document.canEdit || saving} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} />
                    <small>{draft.overview.length}/300</small>
                    {validation.errors.overview ? <em>{validation.errors.overview}</em> : null}
                  </label>
                </div>

                <div className="workout-editor-structure-header">
                  <div>
                    <h3>{draft.sport === "strength" ? t("workout.e.strengthSession") : t("workout.detail.structure")}</h3>
                    <p>{draft.sport === "strength"
                      ? t("workout.e.strengthBody")
                      : t("workout.e.structureBody")}</p>
                  </div>
                  {draft.sport === "strength" ? (
                    <div className="workout-editor-add-actions" aria-label={t("workout.e.addStrength")}>
                      {([
                        ["warmup", t("workout.kind.warmup")],
                        ["training", t("workout.b.ex.label")],
                        ["rest", t("workout.kind.rest")],
                        ["cooldown", t("workout.kind.cooldown")]
                      ] as const).map(([kind, label]) => (
                        <button
                          key={kind}
                          type="button"
                          className="ghost-button"
                          disabled={!document.canEdit || saving}
                          onClick={() => setDraft({
                            ...draft,
                            nodes: [...draft.nodes, emptyStep(kind, draft.sport)]
                          })}
                        >
                          <Plus size={14} aria-hidden="true" /> {label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button type="button" className="ghost-button" disabled={!document.canEdit || saving} onClick={() => setDraft({ ...draft, nodes: [...draft.nodes, emptyStep("training", draft.sport)] })}>
                      <Plus size={15} aria-hidden="true" /> {t("workout.e.addStep")}
                    </button>
                  )}
                </div>

                {draft.nodes.length === 0 ? (
                  <div className="workout-editor-empty"><p>{t("workout.e.noSteps")}</p><button type="button" className="primary-button" onClick={() => setDraft({ ...draft, nodes: [emptyStep("training", draft.sport)] })}>{draft.sport === "strength" ? t("workout.e.firstExercise") : t("workout.e.firstStep")}</button></div>
                ) : (
                  <div className="workout-editor-nodes">
                    {draft.nodes.map((node, index) => (
                      <div key={node.id}>
                        <div className="workout-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderTop(event.dataTransfer.getData("text/workout-node"), index); }} />
                        {node.nodeType === "step" ? (
                          <StepCard
                            step={node} location={{ nodeId: node.id }} context={document.context} sport={draft.sport}
                            exerciseOptions={exerciseOptions}
                            exerciseOptionsLoading={exerciseOptionsLoading}
                            error={validation.errors[`nodes.${index}.target`]
                              ?? validation.errors[`nodes.${index}.intensity`]
                              ?? validation.errors[`nodes.${index}.exercise`]
                              ?? validation.errors[`nodes.${index}.sets`]
                              ?? validation.errors[`nodes.${index}.rest`]}
                            disabled={!document.canEdit || saving} draggable
                            onDragStart={(event) => event.dataTransfer.setData("text/workout-node", node.id)}
                            onDropCard={node.editable ? (sourceId) => groupByDrop(sourceId, node.id) : undefined}
                            onChange={(step) => updateStep({ nodeId: node.id }, () => step)}
                            onMove={(direction) => moveAt({ nodeId: node.id }, direction)}
                            onDuplicate={() => duplicateAt({ nodeId: node.id })}
                            onDelete={() => deleteAt({ nodeId: node.id })}
                            onGroup={index > 0 && node.editable ? () => groupWithPrevious(node.id) : undefined}
                          />
                        ) : (
                          <RepeatCard
                            group={node} nodeIndex={index} context={document.context} sport={draft.sport} errors={validation.errors}
                            exerciseOptions={exerciseOptions}
                            exerciseOptionsLoading={exerciseOptionsLoading}
                            disabled={!document.canEdit || saving}
                            onDragStart={(event) => event.dataTransfer.setData("text/workout-node", node.id)}
                            onChange={(group) => setDraft({ ...draft, nodes: draft.nodes.map((item) => item.id === group.id ? group : item) })}
                            onMove={(direction) => moveAt({ nodeId: node.id }, direction)}
                            onDuplicate={() => setDraft({ ...draft, nodes: draft.nodes.flatMap((item) => item.id === node.id ? [item, cloneNode(item)] : [item]) })}
                            onDelete={() => setDraft({ ...draft, nodes: draft.nodes.filter((item) => item.id !== node.id) })}
                            onStepChange={(childId, step) => updateStep({ nodeId: node.id, childId }, () => step)}
                            onStepMove={(childId, direction) => moveAt({ nodeId: node.id, childId }, direction)}
                            onStepDuplicate={(childId) => duplicateAt({ nodeId: node.id, childId })}
                            onStepDelete={(childId) => deleteAt({ nodeId: node.id, childId })}
                            onStepUngroup={(childId) => ungroupStep(node.id, childId)}
                          />
                        )}
                      </div>
                    ))}
                    <div className="workout-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderTop(event.dataTransfer.getData("text/workout-node"), draft.nodes.length); }} />
                  </div>
                )}
              </div>

              <footer className="workout-editor-footer">
                {draft.sport === "strength" ? (
                  <StrengthEstimateFooter draft={draft} />
                ) : (
                  <EstimateFooter preview={preview} loading={previewing} error={previewError} context={document.context} />
                )}
                <div className="workout-editor-footer-actions">
                  <button type="button" className="ghost-button" onClick={requestClose} disabled={saving}>{t("common.cancel")}</button>
                  <button type="button" className="primary-button" disabled={!document.canEdit || !dirty || !validation.valid || saving} onClick={() => void save()}>
                    {saving ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                    {saving ? t("workout.e.saving") : t("workout.e.save")}
                  </button>
                </div>
              </footer>
            </>
          ) : null}

          {confirmClose ? (
            <div className="workout-editor-confirm" role="alertdialog" aria-label={t("workout.e.discardLabel")}>
              <div><strong>{t("workout.e.discardTitle")}</strong><span>{t("workout.e.discardBody")}</span></div>
              <button type="button" className="ghost-button" onClick={() => setConfirmClose(false)}>{t("workout.e.keepEditing")}</button>
              <button type="button" className="primary-button danger" onClick={onClose}>{t("workout.e.discard")}</button>
            </div>
          ) : null}
        </motion.section>
      </motion.div>
    </AnimatePresence>
    </>,
    window.document.body
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

/**
 * What to call a strength step's exercise.
 *
 * `exerciseName` on a COROS-built workout is a localization key — the live
 * library answers `T1041` for a bench press — so the catalog is asked first
 * and the key is only shown when nothing else is known. Display only: the
 * draft keeps what COROS sent, so a save writes back the same field.
 */
function stepExerciseName(
  step: RunWorkoutEditorStep,
  options: WorkoutExerciseOption[]
): string {
  const catalogName = step.exerciseId
    ? options.find((option) => option.id === step.exerciseId)?.name
    : undefined;
  return (catalogName ?? step.exerciseName ?? "").trim();
}

function EditorSkeleton() {
  return <div className="workout-editor-skeleton" aria-label={t("workout.v.loading")}><div /><div /><div /><div /></div>;
}

interface StepCardProps {
  step: RunWorkoutEditorStep;
  location: StepLocation;
  context: WorkoutEditorContext;
  sport: WorkoutSport;
  exerciseOptions: WorkoutExerciseOption[];
  exerciseOptionsLoading: boolean;
  error?: string;
  disabled: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDropCard?: (sourceId: string) => void;
  onChange: (step: RunWorkoutEditorStep) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
}

function StepCard({ step, context, sport, exerciseOptions, exerciseOptionsLoading, error, disabled, draggable, onDragStart, onDropCard, onChange, onMove, onDuplicate, onDelete, onGroup, onUngroup }: StepCardProps) {
  const locked = disabled || !step.editable;
  const capability = WORKOUT_SPORT_CAPABILITIES[sport];
  const strengthExercise = sport === "strength" && step.kind === "training";
  const changeKind = (kind: RunWorkoutEditorStepKind) => {
    let target = step.target;
    const targetTypes = workoutTargetsForStep(sport, kind, step.exerciseKind);
    if (sport === "strength" && kind === "training" && step.kind !== "training") {
      target = { type: "reps", count: 10 };
    } else if (!targetTypes.includes(target.type)) {
      target = targetForType(targetTypes[0] ?? "time", kind);
    }
    const intensityTypes = workoutIntensitiesForStep(sport, kind, step.exerciseKind);
    const currentIntensityType = step.intensity.type === "lthrPercent"
      ? "heartRatePercent"
      : step.intensity.type;
    const intensity = sport === "strength" && kind === "training" && step.kind !== "training"
      ? structuredClone(capability.defaultIntensity)
      : intensityTypes.includes(currentIntensityType)
        ? step.intensity
        : intensityForType(intensityTypes[0] ?? "none", context);
    onChange({
      ...step,
      kind,
      name: stepTitle(kind),
      target,
      intensity,
      ...(sport === "strength" && kind === "training"
        ? {
            sets: step.sets ?? 3,
            restType: step.restType ?? 1,
            restValue: step.restValue ?? 60
          }
        : {}),
      ...(kind === "sendOff" ? { sendOffSeconds: step.sendOffSeconds ?? 120 } : {})
    });
  };
  return (
    <motion.article layout className={`workout-step-card is-${step.kind} ${!step.editable ? "is-locked" : ""}`} draggable={draggable && !disabled} onDragStartCapture={onDragStart} onDragOver={(event) => { if (onDropCard) event.preventDefault(); }} onDrop={(event) => { if (!onDropCard) return; event.preventDefault(); onDropCard(event.dataTransfer.getData("text/workout-node")); }}>
      <header className="workout-step-header">
        <GripVertical className="workout-drag-handle" size={18} aria-hidden="true" />
        <SelectDropdown<RunWorkoutEditorStepKind>
          className="workout-step-kind-select"
          label={t("workout.c.stepKind")}
          value={step.kind}
          options={capability.stepKinds.map((kind) => ({ value: kind, label: stepKindLabel(kind) }))}
          disabled={locked}
          portal
          onChange={changeKind}
        />
        {strengthExercise ? (
          <div className="workout-strength-step-heading">
            <strong>{stepExerciseName(step, exerciseOptions) || t("workout.b.ex.placeholder")}</strong>
            <span>{strengthStepSummary(step)}</span>
          </div>
        ) : (
          <input aria-label={t("workout.c.stepName")} value={step.name} disabled={locked} maxLength={90} onChange={(event) => onChange({ ...step, name: event.target.value })} />
        )}
        <div className="workout-step-actions">
          <IconAction label={t("workout.c.moveUp")} onClick={() => onMove(-1)} disabled={disabled}><ChevronUp /></IconAction>
          <IconAction label={t("workout.c.moveDown")} onClick={() => onMove(1)} disabled={disabled}><ChevronDown /></IconAction>
          {onGroup ? <IconAction label={t("workout.c.group")} onClick={onGroup} disabled={disabled}><GripVertical /></IconAction> : null}
          {onUngroup && step.editable ? <IconAction label={t("workout.c.ungroup")} onClick={onUngroup} disabled={disabled}><Ungroup /></IconAction> : null}
          <IconAction label={t("workout.c.duplicate")} onClick={onDuplicate} disabled={disabled || !step.editable}><Copy /></IconAction>
          <IconAction label={t("workout.c.delete")} onClick={onDelete} disabled={disabled}><Trash2 /></IconAction>
        </div>
      </header>
      {step.unsupportedReason ? <div className="workout-step-warning"><AlertTriangle size={14} aria-hidden="true" />{step.unsupportedReason}</div> : null}
      {strengthExercise ? (
        <StrengthStepFields
          step={step}
          context={context}
          exerciseOptions={exerciseOptions}
          exerciseOptionsLoading={exerciseOptionsLoading}
          disabled={locked}
          onChange={onChange}
        />
      ) : (
        <div className="workout-step-fields">
          <TargetFields step={step} context={context} sport={sport} disabled={locked} onChange={onChange} />
          <IntensityFields step={step} context={context} sport={sport} disabled={locked} onChange={onChange} />
          {step.kind === "sendOff" ? <label className="workout-control-group"><span>{t("workout.c.sendOff")}</span><ClockInput label={t("workout.c.sendOff")} seconds={step.sendOffSeconds ?? 120} disabled={locked} onChange={(seconds) => onChange({ ...step, sendOffSeconds: seconds })} /></label> : null}
          {capability.requiresExercise && step.kind === "training" ? <div className="workout-control-group workout-exercise-control"><span>{t("workout.b.ex.label")}</span><ExerciseCombobox value={step.exerciseName ?? ""} selectedId={step.exerciseId} options={exerciseOptions} placeholder={t("workout.b.ex.placeholder")} label={t("workout.b.ex.label")} loading={exerciseOptionsLoading} disabled={locked} onChange={(selection) => onChange({ ...step, exerciseName: selection.name, exerciseId: selection.id, exerciseKind: selection.exerciseKind })} />{step.exerciseId ? <small>{t("workout.c.corosSelected")}</small> : <small>{t("workout.c.selectExact")}</small>}</div> : null}
        </div>
      )}
      {error ? <p className="workout-field-error">{error}</p> : null}
    </motion.article>
  );
}

function StrengthStepFields({
  step,
  context,
  exerciseOptions,
  exerciseOptionsLoading,
  disabled,
  onChange
}: {
  step: RunWorkoutEditorStep;
  context: WorkoutEditorContext;
  exerciseOptions: WorkoutExerciseOption[];
  exerciseOptionsLoading: boolean;
  disabled: boolean;
  onChange: (step: RunWorkoutEditorStep) => void;
}) {
  const selectedExercise = step.exerciseId
    ? exerciseOptions.find((option) => option.id === step.exerciseId)
    : undefined;
  const hasExercisePreview = Boolean(
    selectedExercise?.media?.some((media) => media.videoUrl)
  );
  const sets = step.sets ?? 1;
  const restSeconds = step.restValue ?? 0;
  const loadMode = strengthLoadMode(step.intensity);
  const displayWeightUnit = context.distanceUnit === "imperial" ? "lb" : "kg";
  const targetTypes = workoutTargetsForStep("strength", "training", step.exerciseKind)
    .filter((target): target is "reps" | "time" | "open" =>
      target === "reps" || target === "time" || target === "open"
    );
  const editableTarget = step.target.type === "reps"
    || step.target.type === "time"
    || step.target.type === "open"
    ? step.target
    : { type: "open" as const };
  const totalRest = sets > 1 ? restSeconds * (sets - 1) : 0;
  const totalSummary = sets > 1 && step.target.type === "reps"
    ? totalRest
      ? t("workout.s.totalRepsRest", { reps: formatCount(sets * step.target.count), rest: clockFromSeconds(totalRest) })
      : t("workout.s.totalReps", { reps: formatCount(sets * step.target.count) })
    : sets > 1 && step.target.type === "time"
      ? t("workout.s.includingRest", { time: clockFromSeconds(sets * step.target.seconds + totalRest) })
      : undefined;

  const changeTargetType = (type: "reps" | "time" | "open") => {
    onChange({ ...step, target: targetForType(type, "training") });
  };
  const changeLoadMode = (mode: StrengthLoadMode) => {
    const intensity: RunWorkoutEditorIntensity = mode === "bodyweight"
      ? { type: "weight", mode: "bodyweight" }
      : mode === "added"
        ? { type: "weight", mode: "weight", value: 0, unit: displayWeightUnit }
        : { type: "none" };
    onChange({ ...step, intensity });
  };

  return (
    <div className={`workout-strength-fields${hasExercisePreview ? " has-preview" : ""}`}>
      <div className="workout-strength-form">
        <section className="strength-block">
          <h4>{t("workout.b.s.movement")}</h4>
          <ExerciseCombobox
            value={step.exerciseName ?? ""}
            selectedId={step.exerciseId}
            options={exerciseOptions}
            placeholder={t("workout.b.s.chooseMovement")}
            label={t("workout.b.ex.label")}
            loading={exerciseOptionsLoading}
            disabled={disabled}
            hidePreview
            onChange={(selection) => onChange({
              ...step,
              ...(selection.id ? { name: selection.name } : {}),
              exerciseName: selection.name,
              exerciseId: selection.id,
              exerciseKind: selection.exerciseKind
            })}
          />
          {exerciseOptionsLoading ? (
            <p className="strength-block-note">{t("workout.b.s.libLoading")}</p>
          ) : exerciseOptions.length === 0 ? (
            <p className="strength-block-note">{t("workout.s.reconnect")}</p>
          ) : !step.exerciseId ? (
            <p className="strength-block-note">{t("workout.s.selectExact")}</p>
          ) : null}
        </section>

        <section className="strength-block">
          <h4>{t("workout.b.s.prescription")}</h4>
          <div className="set-line">
            <label className="set-line-cell">
              <span>{t("workout.b.s.sets")}</span>
              <input
                type="number"
                min="1"
                max="99"
                value={sets}
                disabled={disabled}
                onChange={(event) => onChange({ ...step, sets: Number(event.target.value) })}
              />
            </label>
            <span className="set-line-operator" aria-hidden="true">×</span>
            <div className="set-line-cell">
              <span>{t("workout.b.s.perSet")}</span>
              <div className="set-line-compound">
                {editableTarget.type === "open" ? (
                  <span className="set-line-open">{t("workout.s.lap")}</span>
                ) : (
                  <input
                    type="number"
                    min="1"
                    max={editableTarget.type === "reps" ? 500 : 86_399}
                    aria-label={editableTarget.type === "reps" ? t("workout.b.s.repsPerSet") : t("workout.b.s.secondsPerSet")}
                    value={editableTarget.type === "reps" ? editableTarget.count : editableTarget.seconds}
                    disabled={disabled}
                    onChange={(event) => onChange({
                      ...step,
                      target: editableTarget.type === "reps"
                        ? { type: "reps", count: Number(event.target.value) }
                        : { type: "time", seconds: Number(event.target.value) }
                    })}
                  />
                )}
                <SelectDropdown<"reps" | "time" | "open">
                  className="set-line-select"
                  label={t("workout.b.s.measureBy")}
                  value={editableTarget.type}
                  disabled={disabled}
                  options={targetTypes.map((type) => ({
                    value: type,
                    label: type === "reps" ? t("workout.b.s.reps") : type === "time" ? t("workout.b.s.seconds") : t("workout.open")
                  }))}
                  portal
                  onChange={changeTargetType}
                />
              </div>
            </div>
            <span className="set-line-operator" aria-hidden="true">@</span>
            <div className="set-line-cell is-load">
              <span>{t("workout.b.s.load")}</span>
              <div className="set-line-compound">
                <SelectDropdown<StrengthLoadMode>
                  className="set-line-select"
                  label={t("workout.b.s.load")}
                  value={loadMode}
                  disabled={disabled}
                  options={[
                    { value: "bodyweight", label: t("workout.bodyweight") },
                    { value: "added", label: t("workout.b.added") },
                    { value: "unspecified", label: t("workout.notSet") }
                  ]}
                  portal
                  onChange={changeLoadMode}
                />
                {step.intensity.type === "weight" && step.intensity.mode === "weight" ? (
                  <span className="set-line-weight">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      aria-label={t("workout.s.addedWeightIn", { unit: step.intensity.unit })}
                      value={step.intensity.value}
                      disabled={disabled}
                      onChange={(event) => onChange({
                        ...step,
                        intensity: {
                          type: "weight",
                          mode: "weight",
                          value: Number(event.target.value),
                          unit: step.intensity.type === "weight" && step.intensity.mode === "weight"
                            ? step.intensity.unit
                            : displayWeightUnit
                        }
                      })}
                    />
                    <em>{step.intensity.unit}</em>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {totalSummary ? <p className="set-line-readout">{totalSummary}</p> : null}
        </section>

        <section className="strength-block">
          <h4>{t("workout.b.s.restBetween")}</h4>
          <div className="rest-picker">
            <OptionGroup
              label={t("workout.b.s.restBetween")}
              tone="quiet"
              value={String(restSeconds)}
              options={STRENGTH_REST_PRESETS.map((preset) => ({
                value: String(preset),
                label: strengthRestLabel(preset)
              }))}
              disabled={disabled}
              onChange={(next) =>
                onChange({ ...step, restType: 1, restValue: Number(next) })
              }
            />
            <label className="rest-picker-custom">
              <input
                type="number"
                min="0"
                max="3600"
                step="5"
                aria-label={t("workout.b.s.restSeconds")}
                value={restSeconds}
                disabled={disabled}
                onChange={(event) => onChange({
                  ...step,
                  restType: 1,
                  restValue: Number(event.target.value)
                })}
              />
              <em>{t("workout.b.s.sec")}</em>
            </label>
          </div>
        </section>

        <label className="workout-strength-instructions">
          <span>{t("workout.s.instructions")}</span>
          <textarea
            rows={2}
            maxLength={300}
            placeholder={t("workout.s.instructionsPh")}
            value={step.overview ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ ...step, overview: event.target.value })}
          />
          <small>{step.overview?.length ?? 0}/300</small>
        </label>
      </div>

      {selectedExercise && hasExercisePreview ? (
        <aside className="workout-strength-preview">
          <ExercisePreview
            option={selectedExercise}
            name={step.exerciseName ?? selectedExercise.name}
            showTargets
          />
        </aside>
      ) : null}
    </div>
  );
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactElement<{ size?: number; "aria-hidden"?: string }> }) {
  return <button type="button" className="workout-icon-action" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children && <>{children}</>}</button>;
}

function ClockInput({ seconds, disabled, label, onChange }: { seconds: number; disabled: boolean; label: string; onChange: (seconds: number) => void }) {
  const [value, setValue] = useState(() => clockFromSeconds(seconds));
  useEffect(() => setValue(clockFromSeconds(seconds)), [seconds]);
  const commit = () => {
    const parsed = secondsFromClock(value);
    onChange(parsed);
    setValue(clockFromSeconds(parsed));
  };
  return <input aria-label={label} value={value} disabled={disabled} inputMode="numeric" placeholder="05:00" onChange={(event) => setValue(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function TargetFields({ step, context, sport, disabled, onChange }: { step: RunWorkoutEditorStep; context: WorkoutEditorContext; sport: WorkoutSport; disabled: boolean; onChange: (step: RunWorkoutEditorStep) => void }) {
  const target = step.target;
  const targetTypes = workoutTargetsForStep(sport, step.kind, step.exerciseKind);
  const distanceMultiplier = sport === "swim"
    ? context.distanceUnit === "imperial" ? 0.9144 : 1
    : context.distanceUnit === "imperial" ? 1609.344 : 1000;
  const targetDistanceUnit = sport === "swim"
    ? swimDistanceUnit(context.distanceUnit)
    : context.distanceUnit === "imperial" ? "mi" : "km";
  return <div className="workout-control-group">
    <label><span>{t("workout.t.target")}</span><SelectDropdown<RunWorkoutEditorTarget["type"]> label={t("workout.t.target")} value={target.type} options={targetTypes.map((type) => ({ value: type, label: builderTargetTypeLabel(type) }))} disabled={disabled} portal onChange={(type) => onChange({ ...step, target: targetForType(type, step.kind) })} /></label>
    {target.type === "time" ? <label><span>{t("workout.t.duration")}</span><ClockInput label={t("workout.t.duration")} seconds={target.seconds} disabled={disabled} onChange={(seconds) => onChange({ ...step, target: { type: "time", seconds } })} /></label> : null}
    {target.type === "distance" ? <label><span>{t("workout.t.distanceIn", { unit: targetDistanceUnit })}</span><input type="number" min="0" step="0.1" value={Number((target.meters / distanceMultiplier).toFixed(3))} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "distance", meters: Number(event.target.value) * distanceMultiplier } })} /></label> : null}
    {target.type === "load" ? <label><span>{t("workout.t.load")}</span><input type="number" min="0" max="999" step="1" value={target.load} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "load", load: Number(event.target.value) } })} /></label> : null}
    {target.type === "hrRecovery" ? <label><span>{t("workout.t.returnBpm")}</span><input type="number" min="30" max="180" value={target.bpm} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "hrRecovery", bpm: Number(event.target.value) } })} /></label> : null}
    {target.type === "reps" ? <label><span>{t("workout.t.reps")}</span><input type="number" min="1" max="500" value={target.count} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "reps", count: Number(event.target.value) } })} /></label> : null}
    {target.type === "routes" ? <label><span>{t("workout.t.routes")}</span><input type="number" min="1" max="20" value={target.count} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "routes", count: Number(event.target.value) } })} /></label> : null}
    {target.type === "elevationGain" ? <label><span>{t("workout.t.gainIn", { unit: elevationUnit(context.distanceUnit) })}</span><input type="number" min="20" max={context.distanceUnit === "imperial" ? 32808 : 10000} value={Number(metersToElevation(target.meters, context.distanceUnit).toFixed(1))} disabled={disabled} onChange={(event) => onChange({ ...step, target: { type: "elevationGain", meters: elevationToMeters(Number(event.target.value), context.distanceUnit) } })} /></label> : null}
    {target.type === "open" ? <p className="workout-control-hint">{t("workout.t.lap")}</p> : null}
  </div>;
}

function profileZone(
  context: WorkoutEditorContext,
  key: keyof WorkoutEditorContext["zones"],
  preset: string | undefined,
  id: number | undefined
) {
  return context.zones[key]?.find(
    (zone) => zone.id === id || zone.key === preset || zone.label === preset
  );
}

function derivedPaceLabel(secondsPerKm: number, context: WorkoutEditorContext): string {
  const displaySeconds = secondsPerKm * (context.paceUnit === "mi" ? 1.609344 : 1);
  return `${clockFromSeconds(displaySeconds)}/${context.paceUnit}`;
}

function IntensityFields({ step, context, sport, disabled, onChange }: { step: RunWorkoutEditorStep; context: WorkoutEditorContext; sport: WorkoutSport; disabled: boolean; onChange: (step: RunWorkoutEditorStep) => void }) {
  const intensity = step.intensity;
  const intensityTypes = workoutIntensitiesForStep(sport, step.kind, step.exerciseKind);
  const paceFactor = context.paceUnit === "mi" ? 1.609344 : 1;
  const setIntensity = (next: RunWorkoutEditorIntensity) => onChange({ ...step, intensity: next });
  const numberRange = (low: number, high: number, lowLabel: string, highLabel: string, update: (low: number, high: number) => WorkoutIntensityInput, min = 0, max = 3000) => (
    <div className="workout-range-inputs"><label><span>{lowLabel}</span><input type="number" min={min} max={max} value={low} disabled={disabled} onChange={(event) => setIntensity(update(Number(event.target.value), high))} /></label><span>{t("workout.i.to")}</span><label><span>{highLabel}</span><input type="number" min={min} max={max} value={high} disabled={disabled} onChange={(event) => setIntensity(update(low, Number(event.target.value)))} /></label></div>
  );
  const percentRange = (value: { lowPercent: number; highPercent: number }, update: (low: number, high: number) => WorkoutIntensityInput) => numberRange(value.lowPercent, value.highPercent, t("workout.i.lowPct"), t("workout.i.highPct"), update, 1, 300);
  return <div className="workout-control-group">
    <label><span>{t("workout.b.intensity")}</span><SelectDropdown<RunWorkoutEditorIntensity["type"]> label={t("workout.b.intensity")} value={intensity.type === "lthrPercent" ? "heartRatePercent" : intensity.type} options={intensityTypes.map((type) => ({ value: type, label: intensityTypeLabel(type) }))} disabled={disabled} portal onChange={(type) => setIntensity(intensityForType(type, context))} /></label>

    {(intensity.type === "pace" || intensity.type === "effortPace") ? <div className="workout-range-inputs"><label><span>{t("workout.i.fast", { unit: context.paceUnit })}</span><ClockInput label={t("workout.i.fastPer", { unit: context.paceUnit })} seconds={intensity.lowSecondsPerKm * paceFactor} disabled={disabled} onChange={(seconds) => setIntensity({ ...intensity, lowSecondsPerKm: seconds / paceFactor, displayUnit: context.paceUnit })} /></label><span>{t("workout.i.to")}</span><label><span>{t("workout.i.slow", { unit: context.paceUnit })}</span><ClockInput label={t("workout.i.slowPer", { unit: context.paceUnit })} seconds={intensity.highSecondsPerKm * paceFactor} disabled={disabled} onChange={(seconds) => setIntensity({ ...intensity, highSecondsPerKm: seconds / paceFactor, displayUnit: context.paceUnit })} /></label></div> : null}

    {intensity.type === "heartRate" ? numberRange(intensity.lowBpm, intensity.highBpm, t("workout.i.lowBpm"), t("workout.i.highBpm"), (lowBpm, highBpm) => ({ type: "heartRate", lowBpm, highBpm }), 30, 250) : null}

    {intensity.type === "heartRatePercent" ? <>
      <label><span>{t("workout.i.basis")}</span><SelectDropdown<WorkoutHeartRateBasis> label={t("workout.i.basisLabel")} value={intensity.basis} options={[{ value: "maxHr", label: t("workout.i.maxHr") }, { value: "reserve", label: t("workout.i.reserve") }, { value: "lthr", label: t("workout.i.lthr") }]} disabled={disabled} portal onChange={(basis) => setIntensity({ type: "heartRatePercent", basis, preset: HEART_RATE_PRESETS[basis][1]!.preset })} /></label>
      <label><span>{t("workout.i.zoneOrCustom")}</span><SelectDropdown label={t("workout.i.hrZone")} value={intensity.preset ?? "custom"} options={[{ value: "custom", label: t("workout.b.custom") }, ...HEART_RATE_PRESETS[intensity.basis].map((zone, zoneIndex, list) => { const configured = profileZone(context, intensity.basis, zone.preset, zone.id); return { value: zone.preset, label: zoneOptionText(zone, zoneIndex, list.length, configured) }; })]} disabled={disabled} portal onChange={(preset) => { const definition = HEART_RATE_PRESETS[intensity.basis].find((zone) => zone.preset === preset); const configured = profileZone(context, intensity.basis, preset, definition?.id); setIntensity(preset === "custom" ? { type: "heartRatePercent", basis: intensity.basis, lowPercent: 80, highPercent: 90 } : { type: "heartRatePercent", basis: intensity.basis, preset: preset as never, ...(configured ? { zoneId: configured.id } : {}) }); }} /></label>
      {!intensity.preset ? percentRange(intensity, (lowPercent, highPercent) => ({ type: "heartRatePercent", basis: intensity.basis, lowPercent, highPercent })) : null}
      <HeartRatePreview intensity={intensity} context={context} />
    </> : null}

    {(intensity.type === "thresholdPacePercent" || intensity.type === "effortPacePercent") ? <>
      <label><span>{t("workout.i.zoneOrCustom")}</span><SelectDropdown label={t("workout.i.paceZone")} value={intensity.preset ?? "custom"} options={[{ value: "custom", label: t("workout.b.custom") }, ...PACE_PRESETS.map((zone, zoneIndex, list) => { const configured = profileZone(context, "thresholdPace", zone.preset, zone.id); return { value: zone.preset, label: zoneOptionText(zone, zoneIndex, list.length, configured) }; })]} disabled={disabled} portal onChange={(preset) => { const definition = PACE_PRESETS.find((zone) => zone.preset === preset); const configured = profileZone(context, "thresholdPace", preset, definition?.id); setIntensity((preset === "custom" ? { type: intensity.type, lowPercent: 90, highPercent: 100 } : { type: intensity.type, preset, ...(configured ? { zoneId: configured.id } : {}) }) as WorkoutIntensityInput); }} /></label>
      {!intensity.preset ? percentRange(intensity, (lowPercent, highPercent) => ({ type: intensity.type, lowPercent, highPercent })) : null}
      <PacePercentPreview intensity={intensity} context={context} />
    </> : null}

    {intensity.type === "ftpPercent" ? <>
      <label><span>{t("workout.i.zoneOrCustom")}</span><SelectDropdown label={t("workout.i.powerZone")} value={intensity.preset ?? "custom"} options={[{ value: "custom", label: t("workout.b.custom") }, ...FTP_PRESETS.map((zone, zoneIndex, list) => { const configured = profileZone(context, "ftp", zone.preset, zone.id); return { value: zone.preset, label: zoneOptionText(zone, zoneIndex, list.length, configured) }; })]} disabled={disabled} portal onChange={(preset) => { const definition = FTP_PRESETS.find((zone) => zone.preset === preset); const configured = profileZone(context, "ftp", preset, definition?.id); setIntensity(preset === "custom" ? { type: "ftpPercent", lowPercent: 90, highPercent: 100 } : { type: "ftpPercent", preset: preset as never, ...(configured ? { zoneId: configured.id } : {}) }); }} /></label>
      {!intensity.preset ? percentRange(intensity, (lowPercent, highPercent) => ({ type: "ftpPercent", lowPercent, highPercent })) : null}
      <PowerPercentPreview intensity={intensity} context={context} reference={context.ftp} zoneKey="ftp" />
    </> : null}

    {intensity.type === "power"
      ? numberRange(intensity.lowWatts, intensity.highWatts, t("workout.i.lowW"), t("workout.i.highW"), (lowWatts, highWatts) => ({ type: "power", lowWatts, highWatts }), 0, 3000)
      : null}

    {intensity.type === "speed" ? numberRange(intensity.low, intensity.high, t("workout.i.lowUnit", { unit: intensity.unit }), t("workout.i.highUnit", { unit: intensity.unit }), (low, high) => ({ ...intensity, low, high }), 0, 200) : null}
    {intensity.type === "cadence" ? numberRange(intensity.low, intensity.high, t("workout.i.lowUnit", { unit: intensity.unit }), t("workout.i.highUnit", { unit: intensity.unit }), (low, high) => ({ ...intensity, low, high }), 0, 300) : null}

    {intensity.type === "swimStroke" ? <label><span>{t("workout.b.stroke")}</span><SelectDropdown label={t("workout.b.swimStroke")} value={intensity.stroke} options={(Object.keys(SWIM_STROKE_IDS) as Array<keyof typeof SWIM_STROKE_IDS>).map((stroke) => ({ value: stroke, label: swimStrokeLabel(stroke) }))} disabled={disabled} portal onChange={(stroke) => setIntensity({ type: "swimStroke", stroke })} /></label> : null}

    {intensity.type === "weight" ? <><label><span>{t("workout.b.s.load")}</span><SelectDropdown label={t("workout.b.s.load")} value={intensity.mode} options={[{ value: "bodyweight", label: t("workout.bodyweight") }, { value: "weight", label: t("workout.i.weight") }]} disabled={disabled} portal onChange={(mode) => setIntensity(mode === "bodyweight" ? { type: "weight", mode: "bodyweight" } : { type: "weight", mode: "weight", value: 10, unit: context.distanceUnit === "imperial" ? "lb" : "kg" })} /></label>{intensity.mode === "weight" ? <label><span>{t("workout.b.weightIn", { unit: context.distanceUnit === "imperial" ? "lb" : "kg" })}</span><input type="number" min="0" max="2000" value={intensity.value} disabled={disabled} onChange={(event) => setIntensity({ ...intensity, value: Number(event.target.value), unit: context.distanceUnit === "imperial" ? "lb" : "kg" })} /></label> : null}</> : null}

    {intensity.type === "rpe" ? <label><span>{t("workout.intensity.rpe")}</span><SelectDropdown label={t("workout.intensity.rpe")} value={String(intensity.value)} options={Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => ({ value, label: value }))} disabled={disabled} portal onChange={(value) => setIntensity({ type: "rpe", value: Number(value) })} /></label> : null}

    {intensity.type === "climbGrade" ? <>
      <label><span>{t("workout.i.system")}</span><SelectDropdown<keyof typeof CLIMB_SYSTEM_IDS> label={t("workout.i.climbingSystem")} value={intensity.system} options={(Object.keys(CLIMB_SYSTEM_IDS) as Array<keyof typeof CLIMB_SYSTEM_IDS>).map((system) => ({ value: system, label: system }))} disabled={disabled} portal onChange={(system) => setIntensity({ type: "climbGrade", system, relativeToOnsight: 0 })} /></label>
      <label><span>{t("workout.b.gradeMode")}</span><SelectDropdown label={t("workout.b.gradeMode")} value={"relativeToOnsight" in intensity ? "relative" : "absolute"} options={[{ value: "relative", label: t("workout.b.relative") }, { value: "absolute", label: t("workout.b.absolute") }]} disabled={disabled} portal onChange={(mode) => setIntensity(mode === "relative" ? { type: "climbGrade", system: intensity.system, relativeToOnsight: 0 } : { type: "climbGrade", system: intensity.system, absoluteGrade: CLIMB_GRADES[intensity.system][0]! })} /></label>
      {"relativeToOnsight" in intensity && intensity.relativeToOnsight !== undefined ? <label><span>{t("workout.b.relativeLevel")}</span><SelectDropdown label={t("workout.i.relativeLevel")} value={String(intensity.relativeToOnsight)} options={Array.from({ length: 13 }, (_, index) => index - 8).map((value) => ({ value: String(value), label: value === 0 ? t("workout.i.onsight") : `${value > 0 ? "+" : ""}${value}` }))} disabled={disabled} portal onChange={(value) => setIntensity({ ...intensity, relativeToOnsight: Number(value) })} /></label> : null}
      {"absoluteGrade" in intensity && intensity.absoluteGrade !== undefined ? <label><span>{t("workout.b.grade")}</span><SelectDropdown label={t("workout.b.climbingGrade")} value={intensity.absoluteGrade} options={CLIMB_GRADES[intensity.system].map((grade) => ({ value: grade, label: grade }))} disabled={disabled} portal onChange={(absoluteGrade) => setIntensity({ ...intensity, absoluteGrade })} /></label> : null}
    </> : null}
  </div>;
}

function HeartRatePreview({ intensity, context }: { intensity: Extract<WorkoutIntensityInput, { type: "heartRatePercent" }>; context: WorkoutEditorContext }) {
  const definition = HEART_RATE_PRESETS[intensity.basis].find((zone) => zone.preset === intensity.preset);
  const configured = profileZone(context, intensity.basis, intensity.preset, intensity.zoneId ?? definition?.id);
  const low = intensity.lowPercent ?? configured?.lowPercent ?? definition?.low;
  const high = intensity.highPercent ?? configured?.highPercent ?? definition?.high;
  const reference = intensity.basis === "lthr" ? context.lthrBpm : context.maxHr;
  if (low === undefined || high === undefined || !reference) return <p className="workout-control-hint">{t("workout.i.noRef")}</p>;
  const lowBpm = intensity.basis === "reserve" && context.restingHr
    ? context.restingHr + (reference - context.restingHr) * low / 100
    : reference * low / 100;
  const highBpm = intensity.basis === "reserve" && context.restingHr
    ? context.restingHr + (reference - context.restingHr) * high / 100
    : reference * high / 100;
  return <p className="workout-control-hint">{t("workout.i.derivedBpm", { low: Math.round(lowBpm), high: Math.round(highBpm) })}</p>;
}

function PacePercentPreview({ intensity, context }: { intensity: Extract<WorkoutIntensityInput, { type: "thresholdPacePercent" | "effortPacePercent" }>; context: WorkoutEditorContext }) {
  const definition = PACE_PRESETS.find((zone) => zone.preset === intensity.preset);
  const configured = profileZone(context, "thresholdPace", intensity.preset, intensity.zoneId ?? definition?.id);
  const low = intensity.lowPercent ?? configured?.lowPercent ?? definition?.low;
  const high = intensity.highPercent ?? configured?.highPercent ?? definition?.high;
  if (!context.thresholdPaceSecondsPerKm || !low || !high) {
    return <p className="workout-control-hint">{t("workout.i.noThreshold")}</p>;
  }
  return <p className="workout-control-hint">{t("workout.i.derivedPace", { fast: derivedPaceLabel(context.thresholdPaceSecondsPerKm * 100 / high, context), slow: derivedPaceLabel(context.thresholdPaceSecondsPerKm * 100 / low, context) })}</p>;
}

function PowerPercentPreview({ intensity, context, reference, zoneKey }: { intensity: Extract<WorkoutIntensityInput, { type: "ftpPercent" }>; context: WorkoutEditorContext; reference?: number; zoneKey: "ftp" }) {
  const definition = FTP_PRESETS.find((zone) => zone.preset === intensity.preset);
  const configured = profileZone(context, zoneKey, intensity.preset, intensity.zoneId ?? definition?.id);
  const low = intensity.lowPercent ?? configured?.lowPercent ?? definition?.low;
  const high = intensity.highPercent ?? configured?.highPercent ?? definition?.high;
  if (!reference || low === undefined || high === undefined) {
    return <p className="workout-control-hint">{t("workout.i.noRefZone")}</p>;
  }
  return <p className="workout-control-hint">{t("workout.i.derivedW", { low: Math.round(reference * low / 100), high: Math.round(reference * high / 100) })}</p>;
}

function RepeatCard({ group, nodeIndex, context, sport, exerciseOptions, exerciseOptionsLoading, errors, disabled, onDragStart, onChange, onMove, onDuplicate, onDelete, onStepChange, onStepMove, onStepDuplicate, onStepDelete, onStepUngroup }: {
  group: RunWorkoutEditorRepeatGroup; nodeIndex: number; context: WorkoutEditorContext; sport: WorkoutSport; exerciseOptions: WorkoutExerciseOption[]; exerciseOptionsLoading: boolean; errors: Record<string, string>; disabled: boolean;
  onDragStart: (event: DragEvent) => void; onChange: (group: RunWorkoutEditorRepeatGroup) => void; onMove: (direction: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void;
  onStepChange: (id: string, step: RunWorkoutEditorStep) => void; onStepMove: (id: string, direction: -1 | 1) => void; onStepDuplicate: (id: string) => void; onStepDelete: (id: string) => void; onStepUngroup: (id: string) => void;
}) {
  const locked = disabled || !group.editable;
  const duplicateLocked = locked || group.steps.some((step) => !step.editable);
  return <motion.section layout className="workout-repeat-card" draggable={!disabled} onDragStartCapture={onDragStart}>
    <header className="workout-repeat-header"><GripVertical size={18} aria-hidden="true" /><input aria-label={t("workout.g.groupName")} value={group.name} disabled={locked} onChange={(event) => onChange({ ...group, name: event.target.value })} /><div className="workout-repeat-count"><span>{t("workout.g.repeat")}</span><button type="button" disabled={locked || group.repeat <= 1} onClick={() => onChange({ ...group, repeat: group.repeat - 1 })}>−</button><input aria-label={t("workout.b.r.count")} type="number" min="1" max="99" value={group.repeat} disabled={locked} onChange={(event) => onChange({ ...group, repeat: Number(event.target.value) })} /><button type="button" disabled={locked || group.repeat >= 99} onClick={() => onChange({ ...group, repeat: group.repeat + 1 })}>+</button></div><div className="workout-step-actions"><IconAction label={t("workout.g.moveUp")} onClick={() => onMove(-1)} disabled={disabled}><ChevronUp /></IconAction><IconAction label={t("workout.g.moveDown")} onClick={() => onMove(1)} disabled={disabled}><ChevronDown /></IconAction><IconAction label={t("workout.g.duplicate")} onClick={onDuplicate} disabled={duplicateLocked}><Copy /></IconAction><IconAction label={t("workout.g.delete")} onClick={onDelete} disabled={disabled}><Trash2 /></IconAction></div></header>
    {errors[`nodes.${nodeIndex}.repeat`] ? <p className="workout-field-error">{errors[`nodes.${nodeIndex}.repeat`]}</p> : null}
    <div className="workout-repeat-steps">{group.steps.map((step, childIndex) => <StepCard key={step.id} step={step} location={{ nodeId: group.id, childId: step.id }} context={context} sport={sport} exerciseOptions={exerciseOptions} exerciseOptionsLoading={exerciseOptionsLoading} disabled={disabled} draggable error={errors[`nodes.${nodeIndex}.steps.${childIndex}.target`] ?? errors[`nodes.${nodeIndex}.steps.${childIndex}.intensity`] ?? errors[`nodes.${nodeIndex}.steps.${childIndex}.exercise`] ?? errors[`nodes.${nodeIndex}.steps.${childIndex}.sets`] ?? errors[`nodes.${nodeIndex}.steps.${childIndex}.rest`]} onDragStart={(event) => event.dataTransfer.setData("text/workout-node", step.id)} onDropCard={(sourceId) => { const from = group.steps.findIndex((candidate) => candidate.id === sourceId); const to = group.steps.findIndex((candidate) => candidate.id === step.id); if (from >= 0 && to >= 0) onChange({ ...group, steps: moveItem(group.steps, from, to) }); }} onChange={(next) => onStepChange(step.id, next)} onMove={(direction) => onStepMove(step.id, direction)} onDuplicate={() => onStepDuplicate(step.id)} onDelete={() => onStepDelete(step.id)} onUngroup={() => onStepUngroup(step.id)} />)}</div>
    <button type="button" className="ghost-button workout-repeat-add" disabled={locked} onClick={() => onChange({ ...group, steps: [...group.steps, emptyStep("rest", sport)] })}><Plus size={14} aria-hidden="true" /> {t("workout.g.addStep")}</button>
  </motion.section>;
}

function EstimateFooter({ preview, loading, error, context }: { preview: WorkoutEditPreview | null; loading: boolean; error: string | null; context: WorkoutEditorContext }) {
  const distance = preview?.distanceMeters;
  const displayDistance = distance === undefined ? "--" : context.distanceUnit === "imperial" ? `${formatDecimal(distance / 1609.344, 2)} mi` : `${formatDecimal(distance / 1000, 2)} km`;
  return <div className="workout-estimate" aria-live="polite">
    {loading ? <span><LoaderCircle className="is-spinning" size={14} aria-hidden="true" /> {t("workout.f.calculating")}</span> : error ? <span className="is-error"><AlertTriangle size={14} aria-hidden="true" /> {error}</span> : <>
      <span><small>{t("workout.f.duration")}</small><strong>{preview?.durationSeconds !== undefined ? clockFromSeconds(preview.durationSeconds) : "--"}</strong></span>
      <span><small>{t("workout.f.distance")}</small><strong>{displayDistance}</strong></span>
      <span><small>{t("workout.f.load")}</small><strong>{preview?.trainingLoad !== undefined ? Math.round(preview.trainingLoad) : "--"}</strong></span>
      {preview?.baseFitness !== undefined ? <span><small>{t("workout.f.baseFitness")}</small><strong>{Math.round(preview.baseFitness)}</strong></span> : null}
      {preview?.loadImpact !== undefined ? <span><small>{t("workout.f.loadImpact")}</small><strong>{Math.round(preview.loadImpact)}</strong></span> : null}
      {preview?.intensityTrendPercent !== undefined ? <span><small>{t("workout.f.trend")}</small><strong>{Math.round(preview.intensityTrendPercent)}%</strong></span> : null}
    </>}
  </div>;
}

function StrengthEstimateFooter({ draft }: { draft: RunWorkoutEditorDraft }) {
  let exercises = 0;
  let sets = 0;
  let reps = 0;
  let restSeconds = 0;
  const countStep = (step: RunWorkoutEditorStep, multiplier: number) => {
    if (step.kind !== "training") return;
    exercises += 1;
    const stepSets = Math.max(1, step.sets ?? 1);
    sets += stepSets * multiplier;
    if (step.target.type === "reps") {
      reps += step.target.count * stepSets * multiplier;
    }
    restSeconds += Math.max(0, stepSets - 1) * Math.max(0, step.restValue ?? 0) * multiplier;
  };
  for (const node of draft.nodes) {
    if (node.nodeType === "step") countStep(node, 1);
    else node.steps.forEach((step) => countStep(step, Math.max(1, node.repeat)));
  }
  return (
    <div className="workout-estimate" aria-label={t("workout.f.strengthTotals")}>
      <span><small>{t("workout.f.exercises")}</small><strong>{formatCount(exercises)}</strong></span>
      <span><small>{t("workout.f.sets")}</small><strong>{formatCount(sets)}</strong></span>
      <span><small>{t("workout.f.reps")}</small><strong>{reps ? formatCount(reps) : "--"}</strong></span>
      <span><small>{t("workout.f.setRest")}</small><strong>{restSeconds ? clockFromSeconds(restSeconds) : "--"}</strong></span>
    </div>
  );
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
