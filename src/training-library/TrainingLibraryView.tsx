import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarRange,
  ChevronRight,
  CloudOff,
  Heart,
  Plus,
  RefreshCw,
  Sparkles,
  Zap
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CoachOpenRequest,
  TrainingActivityMatch,
  TrainingPlanDataSources,
  TrainingHubStatus,
  TrainingLibrarySnapshot,
  TrainingPlanDocument,
  TrainingPlanDraftRecord,
  TrainingPlanMetadataPatch
} from "../../electron/types";
import {
  createTrainingPlan,
  summarizeTrainingPlan
} from "../../electron/trainingPlanDomain";
import { defaultPlanBriefRequest } from "../../electron/planBrief";
import { firstPlanMonday } from "../../electron/trainingPlanGeneration";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { OptionGroup } from "../components/OptionGroup";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { CollapsibleSearch } from "./LibrarySearch";
import {
  PlanOriginBadge,
  SportMixDots,
  dominantSport,
  sportAccentStyle
} from "./sportTheme";
import {
  PLAN_SCOPES,
  attachPlanDrafts,
  filterPlans,
  groupPlans,
  listedPlans,
  planEmptyState,
  planScopeOptions,
  planStartLabel,
  planWeekPosition,
  runOutlivesItsPlan,
  type PlanDrafts,
  type PlanScope
} from "./planFilters";
import { compareFavoriteThenName } from "./libraryOrder";
import { Ridge } from "./Ridge";
import {
  describeCompliance,
  formatCompliance,
  planCompliance,
  type PlanCompliance
} from "./planCompliance";
import { PlanEditor } from "./PlanEditor";
import {
  RIDGE_CAPTIONS,
  RIDGE_UNITS,
  formatRidgeValue,
  readPlan,
  ridgeMeasure,
  weekRidgeValues
} from "./planReaderModel";
import { defaultPlanName } from "./planEditorModel";
import { PlanReader, type PlanCalendarAction } from "./PlanReader";
import { TrainingPlanCalendarDialog } from "./TrainingPlanCalendarDialog";
import { PlanCalendarBadge, isOnCalendar } from "./PlanCalendarBadge";
import { PlanDraftMark, type PlanDraftMarkKind } from "./PlanDraftMark";
import { ConfirmDialog } from "./ConfirmDialog";
import { resumeDraft, type PlanDraft } from "./planDraft";
import { WorkoutWorkspace } from "./WorkoutWorkspace";
import { TrainingLibrarySkeleton } from "./TrainingLibrarySkeleton";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";
import "./trainingLibrary.css";

import { messageRecord, plural, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
interface TrainingLibraryViewProps {
  api: HeraclesRecordsApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
  /** Coach, with a prompt — or a Coach plan to ask about in its own conversation (P1.7). */
  onOpenCoach: (prompt?: string | CoachOpenRequest) => void;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
  /** Raised after a write to the COROS calendar, so surfaces outside this view
      that read the same schedule can re-read it. */
  onScheduleChanged: () => void;
  /** Opens the activity a planned session was matched to, on its own screen. */
  onOpenActivity?: (activityId: string) => void;
}

/**
 * Two entities, two tabs.
 *
 * A workout is one session — a sport, a name and an ordered list of steps,
 * with no date. A plan is a multi-week schedule of them. They share four
 * attributes (name, tags, favourite, archived) and nothing else: not one
 * figure either of them carries fits the other. Templates were a third tab
 * rendering this same list over the same data one enum value apart; a
 * template is a plan with no start date, so it is one now.
 */
type LibrarySection = "workouts" | "plans";

/* AI Plan's brief (P2.5), the screen Coach edits a brief on: loaded when pressed. */
const CoachBriefEditor = lazy(() => import("../chat/CoachBriefEditor"));

const SECTION_LABELS = messageRecord<LibrarySection>({
  workouts: "library.section.workouts",
  plans: "library.section.plans"
});

const SECTIONS: Array<{ id: LibrarySection; icon: typeof Zap }> = [
  { id: "workouts", icon: Zap },
  { id: "plans", icon: CalendarRange }
];

const LIBRARY_SECTION_PREFERENCE =
  defineSelectionPreference<LibrarySection>({
    key: "trainingLibrary.section",
    defaultValue: "workouts",
    validate: selectionIsOneOf([
      "workouts",
      "plans"
    ])
  });

/**
 * The tables a `TrainingLibrarySnapshot` is built from, as `syncPolicy.ts`
 * classifies them. A pull touching one of these means the list on screen is
 * behind; a pull touching anything else is none of this screen's business.
 */
const LIBRARY_SYNCED_TABLES = new Set([
  "training_plan_metadata",
  "training_plan_drafts",
  "training_workout_metadata"
]);

/**
 * The plan being edited, and where the edit came from: a stored draft is
 * saved back into its own row, and an edit of a COROS plan remembers the
 * version it began from, so a save can tell whether that plan moved.
 */
interface PlanEdit {
  plan: TrainingPlanDocument;
  /** The stored draft this edit continues. */
  draftId?: string;
  /** The version of the COROS plan the edit began from. */
  baseVersion?: number;
}

export function TrainingLibraryView({
  api,
  status,
  onOpenTraining,
  onOpenCoach,
  onMessage,
  onError,
  onScheduleChanged,
  onOpenActivity
}: TrainingLibraryViewProps) {
  const { unitSystem } = useUnitSystem();
  const [section, setSection] = useSelectionPreference(
    LIBRARY_SECTION_PREFERENCE
  );
  const [snapshot, setSnapshot] = useState<TrainingLibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanEdit | null>(null);
  /* The plan being read. Reading and editing are different intentions and
     only one can be on screen, so opening the editor clears this. */
  const [readingPlan, setReadingPlan] = useState<TrainingPlanDocument | null>(null);
  /* AI Plan's brief (P2.5), filled in here before any conversation is made:
     Cancel leaves nothing behind, and Start plan opens Coach on it. */
  const [newPlanSources, setNewPlanSources] = useState<TrainingPlanDataSources | null>(null);
  const [calendarChange, setCalendarChange] = useState<{
    plan: TrainingPlanDocument;
    action: PlanCalendarAction;
  } | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  /*
   * The edit in progress, held here rather than inside the editor so that
   * leaving the Plans tab does not throw it away. The tab strip used to be
   * disabled while editing for exactly this reason — the screen prevented
   * navigation rather than surviving it, so looking up a workout meant
   * abandoning the plan first.
   */
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [pendingDraftDiscard, setPendingDraftDiscard] = useState<TrainingPlanDraftRecord | null>(null);
  const [pendingPlanDelete, setPendingPlanDelete] = useState<TrainingPlanDocument | null>(null);
  const [deletingPlan, setDeletingPlan] = useState(false);
  /* A save refused because the plan moved on COROS since the edit began. */
  const [saveConflict, setSaveConflict] = useState<TrainingPlanDocument | null>(null);
  /* A save of a plan on the calendar, waiting on whether the calendar follows. */
  const [calendarSave, setCalendarSave] = useState<TrainingPlanDocument | null>(null);
  /* The answer, held across a save conflict so "Replace with my edit" keeps it. */
  const updateCalendarOnSave = useRef(false);
  /* What an answered save question is doing now; the question stays up until it is done. */
  const [saveBusy, setSaveBusy] = useState<{ target: "confirm" | "alternative"; label: string } | null>(null);
  const [deepening, setDeepening] = useState<string | null>(null);
  /* The plan being copied on COROS — two requests and a read, and the
     reader says so rather than sitting still. */
  const [duplicating, setDuplicating] = useState<string | null>(null);
  /*
   * The reader is a modal: focus goes into it when it opens and back to the
   * tile that opened it when it closes. The index turns `inert` under it, and
   * an inert element drops focus to <body> — so without this, Escape had
   * nothing to land on and closing left the keyboard at the top of the page.
   */
  const readerSheet = useRef<HTMLDivElement>(null);
  const readerOpener = useRef<HTMLElement | null>(null);
  const readingId = readingPlan?.id ?? null;
  useEffect(() => {
    if (readingId) {
      readerSheet.current?.focus();
      return;
    }
    readerOpener.current?.focus();
    readerOpener.current = null;
  }, [readingId]);

  const load = useCallback(async (): Promise<TrainingLibrarySnapshot | null> => {
    setLoading(true);
    setFatalError(null);
    try {
      const next = await api.getTrainingLibrarySnapshot();
      setSnapshot(next);
      return next;
    } catch (cause) {
      setFatalError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (status?.authenticated) void load();
  }, [load, status?.authenticated]);

  /*
   * The tables this screen reads are `personal` tier and travel between
   * machines, so a plan built on the laptop lands in SQLite here while the
   * list on screen is the one read on mount. ChatView was the first subscriber
   * for the same reason its sidebar needed one; this is the second.
   *
   * `tables`, not the count: a pull carrying nothing but a sleep night must not
   * cost the library a COROS round trip. The editor is deliberately left
   * alone — it holds unsaved work and its own undo stack, and reloading the
   * snapshot under it would replace neither but confuse both.
   */
  useEffect(() => {
    if (!status?.authenticated || !api.onSyncChanged) return;
    return api.onSyncChanged((change) => {
      const touched = change.tables.some((table) =>
        LIBRARY_SYNCED_TABLES.has(table)
      );
      if (touched) void load();
    });
  }, [api, load, status?.authenticated]);

  /* Derived once per snapshot: every memo under the index keys on these. */
  const plans = useMemo(() => (snapshot ? listedPlans(snapshot.plans) : []), [snapshot]);
  const planDrafts = useMemo(
    () => attachPlanDrafts(plans, snapshot?.drafts ?? []),
    [plans, snapshot?.drafts]
  );

  if (!status?.authenticated) {
    return (
      <section className="training-library-gate">
        <BookOpen size={30} strokeWidth={1.5} />
        <h1>{t("nav.library")}</h1>
        <p>{t("library.gate.body")}</p>
        <button type="button" className="primary-button" onClick={onOpenTraining}>
          {t("calendar.connect.button")}
        </button>
      </section>
    );
  }

  if (!snapshot && loading) {
    return <TrainingLibrarySkeleton />;
  }

  if (!snapshot && fatalError) {
    return (
      <section className="training-library-gate">
        <AlertTriangle size={30} strokeWidth={1.5} />
        <h1>{t("library.gate.failed")}</h1>
        <p>{fatalError}</p>
        <button type="button" className="primary-button" onClick={() => void load()}>
          {t("common.tryAgain")}
        </button>
      </section>
    );
  }

  const current = snapshot!;
  /* Asked of a running copy whose plan is gone, a removal is the last of it:
     a run taken off is not listed. */
  const removalEndsPlan =
    calendarChange?.action === "remove" && runOutlivesItsPlan(calendarChange.plan, current.plans);
  const counts: Record<LibrarySection, number> = {
    workouts: current.workouts.length,
    plans: plans.length
  };

  /*
   * A draft is the edit kept here, unfinished work included — saving one
   * never touches COROS. It records which plan it edits and at which
   * version, so the save that finishes it can tell if that plan moved.
   *
   * A plan holds one draft: Edit starts again from the plan on COROS, and
   * keeping that edit replaces the draft already held for the plan rather
   * than standing a second one beside it.
   */
  const savePlanDraft = async (plan: TrainingPlanDocument) => {
    if (!editing) return;
    const held = plan.remoteId
      ? current.drafts.find((record) => record.baseRemoteId === plan.remoteId)
      : undefined;
    try {
      const record = await api.saveTrainingPlanDraft({
        id: editing.draftId ?? held?.id,
        baseRemoteId: plan.remoteId,
        baseVersion: editing.baseVersion ?? plan.remoteVersion,
        plan
      });
      closeEditor();
      onMessage(
        record.baseRemoteId
          ? t("library.msg.keptEdits", { name: record.plan.name })
          : t("library.msg.keptDraft", { name: record.plan.name })
      );
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /*
   * Saving writes the plan to COROS and lands on it, read back. A plan that
   * moved on COROS since the edit began is not written over: the athlete is
   * asked, and can overwrite it, save the edit as a new plan, or go back to
   * the editor, where the edit still is.
   */
  const savePlanToCoros = async (
    plan: TrainingPlanDocument,
    choice?: "overwrite" | "asNew",
    progress?: { updatingCalendar?: () => void; written?: () => void }
  ) => {
    if (!editing) return;
    try {
      const result = await api.saveTrainingPlanToCoros({
        plan,
        unitSystem,
        draftId: editing.draftId,
        expectedVersion: plan.remoteId ? editing.baseVersion : undefined,
        overwrite: choice === "overwrite",
        asNew: choice === "asNew"
      });
      if (!result.ok) {
        setSaveConflict(plan);
        return;
      }
      /* Saved as a new plan, the edit has no calendar to update. */
      const updateCalendar = updateCalendarOnSave.current && result.plan.id === plan.id;
      updateCalendarOnSave.current = false;
      setSaveConflict(null);
      closeEditor();
      setReadingPlan(result.plan);
      if (updateCalendar) {
        progress?.updatingCalendar?.();
        try {
          await api.syncTrainingPlanToCalendar(result.plan.id);
          onMessage(t("library.msg.savedCalendar", { name: result.plan.name }));
        } catch (cause) {
          onError(
            t("library.msg.savedNoCalendar", {
              name: result.plan.name,
              reason: cause instanceof Error ? cause.message : String(cause)
            })
          );
        }
      } else {
        onMessage(t("library.msg.saved", { name: result.plan.name }));
      }
      if (updateCalendar || result.plan.calendar === "running") onScheduleChanged();
      /* The plan is written and on screen; the library's reload is not waited on. */
      progress?.written?.();
      await load();
    } catch (cause) {
      updateCalendarOnSave.current = false;
      setSaveConflict(null);
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /*
   * A plan on the calendar runs as COROS's own copy of it, which a save to the
   * plan does not touch. So the save asks whether the calendar follows, at the
   * one moment it can change — asked anywhere else, it is left to memory. A
   * running copy edited directly needs no question: it is the calendar.
   */
  const requestSave = async (plan: TrainingPlanDocument) => {
    const listed = snapshot?.plans.find((item) => item.id === plan.id);
    if (listed?.runningInstanceId) {
      setCalendarSave(plan);
      return;
    }
    updateCalendarOnSave.current = false;
    await savePlanToCoros(plan);
  };

  /*
   * The question stays up while its answer is carried out, and says which step
   * is running: closing it first left a save and a calendar update of several
   * seconds with nothing on screen.
   */
  const answerCalendarSave = async (updateCalendar: boolean) => {
    if (!calendarSave || saveBusy) return;
    const plan = calendarSave;
    updateCalendarOnSave.current = updateCalendar;
    setSaveBusy({ target: updateCalendar ? "confirm" : "alternative", label: t("library.msg.saving") });
    const done = () => {
      setSaveBusy(null);
      setCalendarSave(null);
    };
    try {
      await savePlanToCoros(plan, undefined, {
        updatingCalendar: () => setSaveBusy({ target: "confirm", label: t("library.msg.updatingCalendar") }),
        written: done
      });
    } finally {
      done();
    }
  };

  const answerSaveConflict = async (choice: "overwrite" | "asNew") => {
    if (!saveConflict || saveBusy) return;
    const plan = saveConflict;
    setSaveBusy({ target: choice === "overwrite" ? "confirm" : "alternative", label: t("library.msg.saving") });
    try {
      await savePlanToCoros(plan, choice, {
        updatingCalendar: () => setSaveBusy({ target: "confirm", label: t("library.msg.updatingCalendar") }),
        written: () => setSaveBusy(null)
      });
    } finally {
      setSaveBusy(null);
    }
  };

  const duplicatePlan = async (plan: TrainingPlanDocument) => {
    if (duplicating) return;
    setDuplicating(plan.id);
    try {
      const copy = await api.duplicateTrainingPlan(plan.id);
      setReadingPlan(copy);
      onMessage(t("library.msg.copied", { name: plan.name }));
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDuplicating(null);
    }
  };

  const deletePlan = async () => {
    if (!pendingPlanDelete || deletingPlan) return;
    setDeletingPlan(true);
    try {
      /* A plan on the calendar comes off it first, which the confirmation
         said; without the flag the service refuses one. */
      const onCalendar = isOnCalendar(pendingPlanDelete);
      await api.deleteTrainingPlan(
        pendingPlanDelete.id,
        true,
        onCalendar ? { takeOffCalendar: true } : undefined
      );
      onMessage(
        onCalendar
          ? t("library.msg.tookOffDeleted", { name: pendingPlanDelete.name })
          : t("library.msg.deleted", { name: pendingPlanDelete.name })
      );
      if (onCalendar) onScheduleChanged();
      /* Delete is reached from the reader, so the plan being read is the one
         just removed; the reader would otherwise go on drawing it. */
      setReadingPlan((current) => (current?.id === pendingPlanDelete.id ? null : current));
      setPendingPlanDelete(null);
      await load();
    } catch (cause) {
      setPendingPlanDelete(null);
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingPlan(false);
    }
  };

  /*
   * A calendar change is made to COROS's running copy of a plan, and what
   * the reader shows — "On calendar", the ⋯ items, the figures under a running
   * plan — is read off the plan document. So the library is read again and
   * the reader re-pointed at the fresh copy of the plan it was showing.
   */
  const afterCalendarChange = async (planId: string, message: string) => {
    onMessage(message);
    onScheduleChanged();
    const next = await load();
    /* A run taken off whose plan is gone is no longer listed, so the reader
       closes on it rather than drawing a plan the list does not have. */
    const fresh = next ? listedPlans(next.plans).find((plan) => plan.id === planId) : undefined;
    setReadingPlan((current) => (current?.id === planId ? fresh ?? null : current));
  };

  const confirmCalendarChange = async () => {
    if (!calendarChange || calendarChange.action === "add" || calendarBusy) return;
    const { plan, action } = calendarChange;
    setCalendarBusy(true);
    try {
      if (action === "remove") {
        await api.removeTrainingPlanFromCalendar(plan.id);
        setCalendarChange(null);
        await afterCalendarChange(plan.id, t("library.msg.tookOff", { name: plan.name }));
      }
    } catch (cause) {
      setCalendarChange(null);
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCalendarBusy(false);
    }
  };

  const openEditor = (edit: PlanEdit) => {
    setDraft((held) => resumeDraft(held, edit.plan));
    setEditing(edit);
  };

  const closeEditor = () => {
    setEditing(null);
    setDraft(null);
  };

  /* Named, so a plan nobody has touched yet opens without an error on it; the
     editor selects the name, so the first keystroke replaces it. */
  const createPlan = () =>
    openEditor({ plan: createTrainingPlan(defaultPlanName(current.plans.map((plan) => plan.name))) });

  const resumePlanDraft = (record: TrainingPlanDraftRecord) =>
    openEditor({ plan: record.plan, draftId: record.id, baseVersion: record.baseVersion });

  const discardDraft = async () => {
    if (!pendingDraftDiscard) return;
    const { id, baseRemoteId, plan } = pendingDraftDiscard;
    try {
      await api.deleteTrainingPlanDraft(id);
      onMessage(
        baseRemoteId
          ? t("library.msg.clearedEdits", { name: plan.name })
          : t("library.msg.discardedDraft", { name: plan.name })
      );
      setPendingDraftDiscard(null);
      /* Discarded from inside the editor, the editor goes with it. */
      if (editing?.draftId === id) closeEditor();
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /*
   * Opening a plan shows it. The snapshot already holds its weeks and
   * sessions, so the reader draws immediately and asks COROS for nothing.
   *
   * It is then read again in the background: `/training/plan/detail` carries
   * every session's program, which the list endpoint leaves out for a plan
   * written here and which a save writes back, and it is COROS's answer now
   * rather than when the library loaded. Edit waits for it only when the copy
   * in hand lacks the programs — one the cache kept deep is enough to edit,
   * and a save compares versions before it writes anyway. A failure is silent:
   * the reader keeps the copy it has rather than trading it for an error.
   *
   * The answer goes into the list as well as the reader, so the tile holds the
   * deep copy too and reopening the plan does not pay for the same read again.
   */
  const openPlan = (plan: TrainingPlanDocument) => {
    readerOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReadingPlan(plan);
    if (!plan.remoteId) return;
    const complete = hasPrograms(plan);
    if (!complete) setDeepening(plan.id);
    void api
      .getNativeTrainingPlan(plan.remoteId)
      .then((fresh) => {
        if (fresh) takeFreshPlan(fresh);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!complete) setDeepening((current) => (current === plan.id ? null : current));
      });
  };

  /* A reply that lost a race to a newer copy — a save read back while the
     open's read was still out — is dropped rather than drawn over it. */
  const takeFreshPlan = (fresh: TrainingPlanDocument) => {
    const replaces = (held: TrainingPlanDocument) =>
      held.id === fresh.id && (fresh.remoteVersion ?? -1) >= (held.remoteVersion ?? -1);
    setReadingPlan((current) => (current && replaces(current) ? fresh : current));
    setSnapshot((current) =>
      current && current.plans.some(replaces)
        ? { ...current, plans: current.plans.map((held) => (replaces(held) ? fresh : held)) }
        : current
    );
  };

  /*
   * Favourite and archive, from the reader. They were two of the four icons
   * that appeared in a tile's corner on hover; the plan a metadata write acts
   * on is the one open in front of the athlete now.
   */
  const updatePlanMetadata = async (
    plan: TrainingPlanDocument,
    patch: TrainingPlanMetadataPatch
  ) => {
    try {
      const updated = await api.updateTrainingPlanMetadata(plan.id, patch);
      /* The reader is drawing the copy it was handed, so it has to take the
         new settings or the heart it just filled in empties again. */
      setReadingPlan((current) =>
        current?.id === plan.id
          ? { ...current, favorite: updated.favorite, archived: updated.archived, tags: updated.tags }
          : current
      );
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const stateLabel = current.offline ? t("library.view.offline") : current.stale ? t("library.view.partial") : t("library.view.synced");

  /*
   * Which of the two full screens is over the index, if either. Only the Plans
   * tab has them — a draft survives a trip to Workouts, so `editingPlan` can be
   * set while the workout list is the thing on screen.
   */
  const planScreen =
    section !== "plans"
      ? null
      : editing && draft
        ? "editor"
        : readingPlan
          ? "reader"
          : null;
  /* The draft held for the plan being read, and the one the editor resumed. */
  const readingDraft = readingPlan ? planDrafts.byPlan.get(readingPlan.id) : undefined;
  const editingDraft = editing?.draftId
    ? current.drafts.find((record) => record.id === editing.draftId)
    : undefined;
  const planScreenLabel =
    planScreen === "editor"
      ? editing?.plan.remoteId ? t("library.view.editing", { name: editing.plan.name }) : t("library.view.newPlan")
      : planScreen === "reader"
        ? (readingPlan?.name ?? t("library.view.plan"))
        : "";

  return (
    <section className="training-library-view">
      {/* One line: the title, and the two controls that belong to the whole
          screen. The census that stood under the title said what the two tab
          counts already say a few pixels below it, and cost the list the
          height of a second line. */}
      <header className="tl-masthead" inert={planScreen !== null}>
        <h1>{t("nav.library")}</h1>
        <div className="tl-masthead-actions">
          <span className={`tl-state${current.stale || current.offline ? " is-stale" : ""}`}>
            {current.offline ? <CloudOff size={13} /> : null}
            {stateLabel}
          </span>
          <button
            type="button"
            className="ghost-button"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} /> {t("library.view.refresh")}
          </button>
        </div>
      </header>

      {current.partialFailures.length ? (
        <details className="tl-notice">
          <summary>
            <AlertTriangle size={14} />
            {t("library.view.notice")}
          </summary>
          {current.partialFailures.map((failure) => (
            <p key={failure}>{failure}</p>
          ))}
        </details>
      ) : null}

      <nav className="tl-sections" aria-label={t("library.view.sections")} inert={planScreen !== null}>
        {SECTIONS.map(({ id, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-current={section === id ? "page" : undefined}
            onClick={() => setSection(id)}
          >
            <Icon aria-hidden="true" />
            {SECTION_LABELS[id]}
            <span>{counts[id]}</span>
          </button>
        ))}
      </nav>

      {section === "workouts" ? (
        <WorkoutWorkspace
          api={api}
          workouts={current.workouts}
          onRefresh={async () => { await load(); }}
          onMessage={onMessage}
          onError={onError}
        />
      ) : (
        <PlanIndex
          plans={plans}
          drafts={planDrafts}
          onResumeDraft={resumePlanDraft}
          inert={planScreen !== null}
          onCreate={createPlan}
          onGenerate={() => setNewPlanSources({ activities: true, sleep: true, zones: true })}
          offline={current.offline}
          onOpen={openPlan}
          matches={current.matches}
        />
      )}

      {/*
       * A plan is read and written in a dialog over the library, not in place
       * of it.
       *
       * Opening one used to swap the index out of the tree, so coming back
       * rebuilt it: the search emptied, the chip went back to All and the
       * scroll jumped to the top — a reader comparing three plans in a long
       * library paid that toll on every one of them. The index is still
       * mounted underneath and keeps all of it, which is also what makes the
       * reader readable as a layer: the library it came from is still there
       * behind the scrim.
       *
       * The two are not the same size. The reader is a document and sits over
       * the library; the editor is a workspace and takes the window, like the
       * workout builder does.
       *
       * `inert` covers the masthead, the tab strip and the index together, so
       * the keyboard cannot reach a screen the scrim has put behind glass.
       */}
      {planScreen ? (
        planScreen === "editor" && editing && draft ? (
          /*
           * The editor takes the whole window, like the workout builder it
           * stands beside: every week is a card of seven day boxes, more than
           * one screen region's width can lay out.
           *
           * **Portalled to <body>, like `AddWorkoutModal`.** A fixed box left
           * inside the view covers the window but cannot rise above the rail:
           * the shell's own stacking context bounds it, so `z-index` inside
           * the view is only a position among the view's children. Measured —
           * the backdrop filled 1861×1011 and the rail was drawn over it.
           *
           * What the portal costs is the `--tl-*` tokens, which are declared
           * on `.training-library-view`. A custom property that resolves to
           * nothing deletes the declaration reading it — a day box keeps its
           * size with nothing painted around it — so `.tl-plan-modal-backdrop`
           * is named in the three token blocks too.
           */
          createPortal(
            <div className="tl-plan-modal-backdrop" role="presentation">
              <div
                className="tl-plan-modal"
                role="dialog"
                aria-modal="true"
                aria-label={planScreenLabel}
              >
                <PlanEditor
                  api={api}
                  draft={draft}
                  onDraftChange={setDraft}
                  workouts={current.workouts}
                  isNew={!editing.plan.remoteId || Boolean(editing.draftId)}
                  onSave={requestSave}
                  onSaveDraft={savePlanDraft}
                  onDiscardDraft={
                    editingDraft ? () => setPendingDraftDiscard(editingDraft) : undefined
                  }
                  onClose={closeEditor}
                />
              </div>
            </div>,
            document.body
          )
        ) : (
        <div
          className="tl-dialog-scrim"
          role="presentation"
          /* A press on the ground behind the reader dismisses it. The editor
             gets no such exit — it holds unsaved work, and its own Back button
             is what asks about that. */
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReadingPlan(null);
          }}
        >
          <div
            ref={readerSheet}
            className="tl-dialog-sheet is-reader"
            role="dialog"
            aria-modal="true"
            aria-label={planScreenLabel}
            tabIndex={-1}
            /* A session open inside the reader takes Escape first and stops
               it, so this only ever closes the plan itself. */
            onKeyDown={(event) => {
              if (event.key === "Escape") setReadingPlan(null);
            }}
          >
            {readingPlan ? (
              <PlanReader
                key={readingPlan.id}
                plan={readingPlan}
                matches={current.matches}
                offline={current.offline}
                api={api}
                loadingFull={deepening === readingPlan.id}
                duplicating={duplicating === readingPlan.id}
                onOpenActivity={onOpenActivity}
                onBack={() => setReadingPlan(null)}
                onEdit={(plan) => openEditor({ plan, baseVersion: plan.remoteVersion })}
                onDuplicate={(plan) => void duplicatePlan(plan)}
                onFavorite={(plan) => void updatePlanMetadata(plan, { favorite: !plan.favorite })}
                onArchive={(plan) => void updatePlanMetadata(plan, { archived: !plan.archived })}
                onDelete={setPendingPlanDelete}
                onAskCoachAboutSession={(plan, entry, label) =>
                  onOpenCoach({
                    scheduleRefs: [
                      {
                        scope: "session",
                        planId: plan.remoteId,
                        idInPlan: entry.idInPlan,
                        ...(entry.happenDay ? { day: entry.happenDay } : {}),
                        label
                      }
                    ]
                  })
                }
                onAskCoach={
                  readingPlan.origin === "coach" && readingPlan.coach?.draftId
                    ? (plan) => {
                        const draftId = plan.coach?.draftId ?? "";
                        onOpenCoach({
                          draftId,
                          refs: [
                            {
                              artifactId: draftId,
                              draftId,
                              name: plan.name,
                              artifactType: "plan",
                              scope: "plan",
                              label: t("library.view.wholePlan")
                            }
                          ]
                        });
                      }
                    : undefined
                }
                onCalendar={(plan, action) => setCalendarChange({ plan, action })}
                onContinueDraft={readingDraft ? () => resumePlanDraft(readingDraft) : undefined}
                onClearDraft={readingDraft ? () => setPendingDraftDiscard(readingDraft) : undefined}
              />
            ) : null}
          </div>
        </div>
        )
      ) : null}

      {/* Over the editor, which is portalled to <body>: a dialog left inside the
          view is held under it by the view's stacking context. */}
      {saveConflict ? createPortal(
        <ConfirmDialog
          title={t("library.dlg.conflict.title")}
          description={t("library.dlg.conflict.body", { name: saveConflict.name })}
          cancelLabel={t("library.dlg.keepEditing")}
          alternative={{ label: t("library.dlg.conflict.asNew"), onSelect: () => void answerSaveConflict("asNew") }}
          confirmLabel={t("library.dlg.conflict.replace")}
          danger
          busy={saveBusy ?? undefined}
          onConfirm={() => void answerSaveConflict("overwrite")}
          onCancel={() => setSaveConflict(null)}
        />,
        document.body
      ) : null}

      {calendarSave ? createPortal(
        <ConfirmDialog
          title={t("library.dlg.calSave.title", { name: calendarSave.name })}
          description={t("library.dlg.calSave.body")}
          warning={t("library.dlg.calSave.warning")}
          cancelLabel={t("library.dlg.keepEditing")}
          alternative={{ label: t("library.dlg.calSave.only"), onSelect: () => void answerCalendarSave(false) }}
          confirmLabel={t("library.dlg.calSave.update")}
          busy={saveBusy ?? undefined}
          onConfirm={() => void answerCalendarSave(true)}
          onCancel={() => setCalendarSave(null)}
        />,
        document.body
      ) : null}

      {calendarChange?.action === "add" ? (
        <TrainingPlanCalendarDialog
          api={api}
          plan={calendarChange.plan}
          onClose={() => setCalendarChange(null)}
          onAdded={() => {
            const { plan } = calendarChange;
            setCalendarChange(null);
            void afterCalendarChange(plan.id, t("library.msg.added", { name: plan.name }));
          }}
        />
      ) : null}

      {calendarChange?.action === "remove" ? (
        <ConfirmDialog
          title={t("library.dlg.remove.title", { name: calendarChange.plan.name })}
          description={removalEndsPlan ? t("library.dlg.remove.body") : t("library.dlg.remove.stays")}
          warning={removalEndsPlan ? t("library.dlg.remove.warning") : undefined}
          alternative={
            removalEndsPlan
              ? {
                  label: t("library.dlg.remove.duplicate"),
                  onSelect: () => {
                    const { plan } = calendarChange;
                    setCalendarChange(null);
                    void duplicatePlan(plan);
                  }
                }
              : undefined
          }
          confirmLabel={t("library.dlg.remove.confirm")}
          danger
          busy={calendarBusy ? { target: "confirm", label: t("library.dlg.remove.removing") } : undefined}
          onConfirm={() => void confirmCalendarChange()}
          onCancel={() => setCalendarChange(null)}
        />
      ) : null}

      {newPlanSources ? (
        <Suspense fallback={null}>
          <CoachBriefEditor
            mode="new"
            request={defaultPlanBriefRequest(firstPlanMonday())}
            firstMonday={firstPlanMonday()}
            sources={newPlanSources}
            onSourcesChange={setNewPlanSources}
            onSave={(request) => {
              setNewPlanSources(null);
              onOpenCoach({ newPlan: { request, sources: newPlanSources } });
            }}
            onClose={() => setNewPlanSources(null)}
          />
        </Suspense>
      ) : null}

      {pendingPlanDelete ? (
        <ConfirmDialog
          title={t("library.dlg.delete.title", { name: pendingPlanDelete.name })}
          description={plural("library.dlg.delete.body", pendingPlanDelete.entries.length)}
          warning={isOnCalendar(pendingPlanDelete) ? t("library.dlg.delete.warning") : undefined}
          confirmLabel={isOnCalendar(pendingPlanDelete) ? t("library.dlg.delete.removeAndDelete") : t("library.dlg.delete.confirm")}
          danger
          busy={deletingPlan ? { target: "confirm", label: t("library.dlg.delete.deleting") } : undefined}
          onConfirm={() => void deletePlan()}
          onCancel={() => setPendingPlanDelete(null)}
        />
      ) : null}

      {/* Portalled: it is asked from inside the editor as well as the reader. */}
      {pendingDraftDiscard ? createPortal(
        pendingDraftDiscard.baseRemoteId ? (
          <ConfirmDialog
            title={t("library.dlg.clear.title", { name: pendingDraftDiscard.plan.name })}
            description={t("library.dlg.clear.body")}
            confirmLabel={t("library.dlg.clear.confirm")}
            danger
            onConfirm={() => void discardDraft()}
            onCancel={() => setPendingDraftDiscard(null)}
          />
        ) : (
          <ConfirmDialog
            title={t("library.dlg.discard.title", { name: pendingDraftDiscard.plan.name })}
            description={t("library.dlg.discard.body")}
            confirmLabel={t("library.dlg.discard.confirm")}
            danger
            onConfirm={() => void discardDraft()}
            onCancel={() => setPendingDraftDiscard(null)}
          />
        ),
        document.body
      ) : null}
    </section>
  );
}

const PLAN_SCOPE_PREFERENCE = defineSelectionPreference<PlanScope>({
  key: "trainingLibrary.plans.scope",
  defaultValue: "all",
  validate: selectionIsOneOf(PLAN_SCOPES)
});

/** Whether a plan carries every session's program — what a save writes back — so Edit need not wait for a read. */
function hasPrograms(plan: TrainingPlanDocument): boolean {
  return plan.entries.length > 0 && plan.entries.every((entry) => entry.corosProgram);
}

/**
 * Everything a tile needs, derived once.
 *
 * It served two layouts — a tile grid and a table — which is two sets of rules
 * about the same figures, kept in step by hand. The table is gone: a plan is
 * a shape across weeks and a couple of totals, and a ridge 132px wide in a row
 * says less than the same ridge across a tile. What the table could do that
 * tiles cannot is sort by a column heading, and that was already a dropdown.
 */
function planView(
  plan: TrainingPlanDocument,
  summary: ReturnType<typeof summarizeTrainingPlan> | undefined,
  compliance: PlanCompliance | undefined
) {
  /* The reader's own measure, so the tile and the ridge it opens onto agree. */
  const { weeks } = readPlan(plan);
  const measure = ridgeMeasure(weeks);
  const values = weekRidgeValues(weeks, measure);
  const peak = Math.max(0, ...values);

  return {
    /*
     * What the athlete wrote on the plan, and nothing invented. It used to
     * fall back through the sports to the words "Local plan", which is the
     * badge restated as prose — a line every tile carried and none of them
     * earned.
     */
    description: plan.description || undefined,
    startLabel: planStartLabel(plan),
    /*
     * What replaced the Adherence tab: how a plan on the calendar is going, as
     * one figure. `null` for a plan that is not on the calendar — which is
     * a different statement from 0%, and the one an athlete would otherwise
     * read as failure.
     */
    compliance,
    complianceLabel: formatCompliance(compliance),
    complianceNote: describeCompliance(compliance),
    sessions: summary?.workouts ?? 0,
    dominant: dominantSport(summary?.sportDistribution, plan.sportMix),
    sportCounts: summary?.sportDistribution,
    /*
     * **The ridge says which quantity it is drawing** (`ridgeMeasure`): load
     * only where every week of training has some, because every COROS list
     * endpoint answers 0 and only `/training/program/calculate` knows better.
     * An unlabelled fallback is a chart that looks like load and is not — the
     * shape of every week with one session is flat whatever the sessions cost.
     */
    ridgeCaption: RIDGE_CAPTIONS[measure],
    ridgePeak: peak > 0 ? formatRidgeValue(peak, measure) : undefined,
    ridge: {
      values,
      peakWeek: measure === "load" ? summary?.peakWeek : undefined,
      unit: RIDGE_UNITS[measure],
      variant: measure === "load" ? ("load" as const) : ("count" as const),
      label: t("library.ridge.across", { caption: RIDGE_CAPTIONS[measure], weeks: weeks.length })
    }
  };
}

type PlanCardView = ReturnType<typeof planView>;

interface PlanIndexProps {
  plans: TrainingPlanDocument[];
  /**
   * Edits kept here, not yet on COROS. An edit to a plan marks that plan's
   * tile; a new plan's draft is a tile of its own, which opens the editor
   * rather than the reader — there is nothing on COROS to read yet.
   */
  drafts: PlanDrafts;
  onResumeDraft: (draft: TrainingPlanDraftRecord) => void;
  onCreate: () => void;
  onGenerate?: () => void;
  offline?: boolean;
  onOpen: (plan: TrainingPlanDocument) => void;
  /** Plan-versus-done, rebuilt with the snapshot. */
  matches: readonly TrainingActivityMatch[];
  /** Raised while a plan dialog covers the index, so the keyboard cannot
      reach a list that is not on screen. */
  inert?: boolean;
}

/**
 * One tile, in the grid or standing alone as the hero.
 *
 * The row of icon buttons that used to sit in its corner is gone: favourite,
 * duplicate, calendar and delete are the reader's now, acting on the plan on
 * screen. They appeared on hover, which put an irreversible delete behind a
 * pointer gesture on a card the eye was only passing over, and they were four
 * unlabelled glyphs in 26px boxes — the workout tab reached the same
 * conclusion first.
 */
function PlanTile({
  plan,
  view,
  mark,
  onOpen
}: {
  plan: TrainingPlanDocument;
  view: PlanCardView;
  /** Unsaved work: a draft of its own, or edits held for this plan. */
  mark?: PlanDraftMarkKind;
  onOpen: () => void;
}) {
  return (
    <li
      className="tl-card"
      data-accent={view.dominant ?? undefined}
      data-mark={mark}
      style={view.dominant ? sportAccentStyle(view.dominant) : undefined}
    >
      <button type="button" className="tl-card-open" onClick={onOpen}>
        {/* The corner, out of the flow. In the flow it led the line, so a tile
            with a favourite laid its flags out one heart further right than
            the tile beside it. */}
        {plan.favorite ? (
          <span className="tl-card-fav">
            <Heart size={13} fill="currentColor" strokeWidth={0} aria-label={t("library.w.favorite")} />
          </span>
        ) : null}
        {/* Its own line above the name, so the name stays the whole of
            `.tl-card-name` and wraps where an unmarked tile's does. */}
        {mark ? <PlanDraftMark kind={mark} /> : null}
        <span className="tl-card-name">
          <PlanCalendarBadge plan={plan} />
          {plan.name}
        </span>
        {/*
         * Two lines, each drawn only when it holds something. They were one —
         * `goal · start date`, with the goal falling back to the description,
         * then to the sports, then to the words "Local plan" — so a line that
         * was sometimes a goal and sometimes a restatement of the badge above
         * it, always on one row, clipped at the tile's edge.
         */}
        {view.startLabel ? (
          <span className="tl-card-start">{view.startLabel}</span>
        ) : null}
        {view.description ? (
          <span className="tl-card-desc">{view.description}</span>
        ) : null}
        <SportMixDots sports={plan.sportMix} counts={view.sportCounts} />
        {/*
         * The ridge says what it is drawing, and what its tallest week comes
         * to. It was an unlabelled silhouette: where COROS had priced nothing
         * it quietly fell back to counting sessions, so a plan of five equal
         * weeks drew a flat line that read as five weeks of equal *load*.
         *
         * **A plan with nothing in any week says so rather than drawing it.**
         * Every bar at zero is a row of 2px stubs under a caption with no
         * figure — a chart of an absence. Drawing nothing at all was worse:
         * this box is what pushes the figures to the tile floor, so a tile
         * without it stood a chart's height shorter than the one beside it.
         */}
        <span className="tl-card-ridge">
          {view.ridgePeak !== undefined ? (
            <>
              <Ridge {...view.ridge} />
              <small>
                {view.ridgeCaption}
                <b>{view.ridgePeak}</b>
              </small>
            </>
          ) : (
            <small className="is-empty">{t("library.tile.noSessions")}</small>
          )}
        </span>
        <span className="tl-card-figs">
          <span>
            <b>{plan.weekCount}</b>
            <small>{plural("library.fig.weeks", plan.weekCount)}</small>
          </span>
          <span>
            <b className={view.sessions ? "" : "is-nil"}>{view.sessions || "—"}</b>
            <small>{plural("library.fig.sessions", view.sessions)}</small>
          </span>
          {/* Only a plan this app put on the calendar has anything to report,
              which is why this is a figure the tile grows rather than a column
              that was a dash down the whole list. */}
          {view.complianceLabel ? (
            <span className="tl-card-fig-done" title={view.complianceNote ?? undefined}>
              <b>{view.complianceLabel}</b>
              <small>{t("library.fig.done")}</small>
            </span>
          ) : null}
          {/* Where a plan came from, at the far end of the line that says what
              it amounts to. It led the tile before, above the name, which gave
              the first word of every tile to a fact that changes nothing about
              how the plan is read. */}
          <PlanOriginBadge plan={plan} className="tl-card-source" />
        </span>
      </button>
    </li>
  );
}

/**
 * The plan being trained right now, above the library rather than in it.
 *
 * One question is asked of this screen far more than any other — *what am I
 * on, and where am I in it* — and a grid of equal tiles answers it only after
 * the reader has worked out which tile's dates contain today. There is at most
 * one (`activePlan`), and nothing is drawn at all when there is none: an empty
 * frame saying "no plan running" is a row of pixels spent on the absence of
 * news.
 */
function PlanHero({
  plan,
  view,
  position,
  editing,
  onOpen
}: {
  plan: TrainingPlanDocument;
  view: PlanCardView;
  position: { week: number; of: number } | undefined;
  /** Edits to this plan are held here as a draft. */
  editing?: boolean;
  onOpen: (plan: TrainingPlanDocument) => void;
}) {
  return (
    <button
      type="button"
      className="tl-hero"
      data-accent={view.dominant ?? undefined}
      style={view.dominant ? sportAccentStyle(view.dominant) : undefined}
      onClick={() => onOpen(plan)}
    >
      {/* Two columns, each a stack: what the plan is, and where it has got to.
          They were laid out as one grid with hand-placed rows, which left the
          ridge stranded in a cell of its own whenever the figures beside it
          were shorter than the name. */}
      <span className="tl-hero-main">
        <span className="tl-hero-eyebrow">
          <Activity size={12} aria-hidden="true" /> {t("library.tile.inProgress")}
          {editing ? <PlanDraftMark kind="editing" /> : null}
        </span>
        <span className="tl-hero-name">
          <PlanCalendarBadge plan={plan} />
          {plan.name}
        </span>
        <span className="tl-hero-note">
          {view.description ? <span>{view.description}</span> : null}
          <SportMixDots sports={plan.sportMix} counts={view.sportCounts} />
          <PlanOriginBadge plan={plan} />
        </span>
      </span>
      <span className="tl-hero-side">
        <span className="tl-hero-figs">
          {position ? (
            <span>
              <b>
                {position.week}
                <em>/{position.of}</em>
              </b>
              <small>{t("library.tile.week")}</small>
            </span>
          ) : null}
          <span>
            <b className={view.sessions ? "" : "is-nil"}>{view.sessions || "—"}</b>
            <small>{plural("library.fig.sessions", view.sessions)}</small>
          </span>
          {view.complianceLabel ? (
            <span className="tl-hero-fig-done" title={view.complianceNote ?? undefined}>
              <b>{view.complianceLabel}</b>
              <small>{t("library.fig.done")}</small>
            </span>
          ) : null}
        </span>
        {view.ridgePeak !== undefined ? (
          <span className="tl-hero-ridge">
            <Ridge {...view.ridge} />
            <small>
              {view.ridgeCaption}
              <b>{view.ridgePeak}</b>
            </small>
          </span>
        ) : null}
      </span>
    </button>
  );
}

function PlanIndex({
  plans,
  drafts,
  onResumeDraft,
  onCreate,
  onGenerate,
  offline = false,
  onOpen,
  matches,
  inert = false
}: PlanIndexProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useSelectionPreference(PLAN_SCOPE_PREFERENCE);
  /* Archived is folded until asked for: a plan is archived to get it out of
     the way, and a section standing open at the foot of the list put it back. */
  const [archivedOpen, setArchivedOpen] = useState(false);

  const summaries = useMemo(
    () => new Map(plans.map((plan) => [plan.id, summarizeTrainingPlan(plan)])),
    [plans]
  );

  /* Joined once for the whole list: the matcher produces a few hundred rows
     and every plan would otherwise walk all of them on every render. A plan
     running on the calendar is measured by its calendar copy, which is the one
     whose sessions COROS dated. */
  const compliance = useMemo(() => {
    const byRemoteId = new Map(plans.map((plan) => [plan.remoteId, plan]));
    return new Map(
      plans.map((plan) => {
        const running = plan.runningInstanceId ? byRemoteId.get(plan.runningInstanceId) : undefined;
        return [plan.id, planCompliance(running ?? plan, matches)];
      })
    );
  }, [plans, matches]);

  const { locale } = useI18n();
  const scopes = useMemo(() => planScopeOptions(plans), [plans, locale]);

  const scopeAvailable = scopes.some((option) => option.id === scope);
  useEffect(() => {
    if (!scopeAvailable) setScope("all");
  }, [scopeAvailable, setScope]);

  const empty = useMemo(() => planEmptyState(query, scope), [query, scope, locale]);

  /*
   * One order — favourites first, then by name (`compareFavoriteThenName`) — and
   * no control to change it.
   *
   * A dropdown offered five — updated, name, start date, weeks, sessions — over
   * a library that is a dozen tiles on one screen, where re-ordering is quicker
   * to do with the eye than with a menu. It opened on "updated", which moved a
   * plan to the top every time a metadata write touched it, so the list never
   * held still. A favourite is the plan the athlete reaches for; the name finds
   * the rest. The sections underneath answer "what is running" and "what is
   * over", which is what the date orders were reached for. Workouts open in the
   * same order (`libraryOrder.ts`).
   */
  const visible = useMemo(
    () => filterPlans(plans, query, scope).sort(compareFavoriteThenName),
    [plans, query, scope]
  );

  /*
   * What the chips used to hide. `scheduled`, `reusable` and `archived` each
   * showed one state and hid the other two, so "what am I training and what
   * else have I got" took three presses to answer — and `reusable` was not a
   * state at all. These are on the screen at once, in the order the question
   * is asked: the plan running now, then everything still to come, then what
   * is over.
   *
   * `Date.now()` is read once per grouping rather than per plan, so every
   * section is judged against the same instant — a plan cannot be in two of
   * them because the clock moved between two comparisons.
   */
  const sections = useMemo(() => groupPlans(visible), [visible]);

  /* A new plan's draft is filtered like a plan — it is one, as far as the
     athlete can tell — and leads the list, newest first: it is the work most
     recently put down. */
  const looseDrafts = useMemo(
    () => {
      const shown = new Set(filterPlans(drafts.loose.map((draft) => draft.plan), query, scope));
      return drafts.loose.filter((draft) => shown.has(draft.plan));
    },
    [drafts.loose, query, scope]
  );
  const draftViews = useMemo(
    () =>
      new Map(
        drafts.loose.map((draft) => [
          draft.id,
          planView(draft.plan, summarizeTrainingPlan(draft.plan), undefined)
        ])
      ),
    [drafts.loose, locale]
  );
  const heroPosition = useMemo(
    () => (sections.hero ? planWeekPosition(sections.hero) : undefined),
    [sections.hero]
  );

  /* Once per plan, not per render: a view reads the whole plan week by week,
     and a keystroke in the search re-renders every tile. */
  const views = useMemo(
    () =>
      new Map(
        plans.map((plan) => [plan.id, planView(plan, summaries.get(plan.id), compliance.get(plan.id))])
      ),
    [plans, summaries, compliance, locale]
  );
  const viewOf = (plan: TrainingPlanDocument) => views.get(plan.id)!;

  const grid = (
    list: TrainingPlanDocument[],
    label: string,
    lead: TrainingPlanDraftRecord[] = []
  ) => (
    <ul className="tl-grid" role="list" aria-label={label}>
      {lead.map((draft) => (
        <PlanTile
          key={draft.id}
          plan={draft.plan}
          view={draftViews.get(draft.id)!}
          mark="draft"
          onOpen={() => onResumeDraft(draft)}
        />
      ))}
      {list.map((plan) => (
        <PlanTile
          key={plan.id}
          plan={plan}
          view={viewOf(plan)}
          mark={drafts.byPlan.has(plan.id) ? "editing" : undefined}
          onOpen={() => onOpen(plan)}
        />
      ))}
    </ul>
  );

  return (
    <div className="tl-panel tl-plans" inert={inert}>
      <div className="tl-filters">
        {/*
         * Where a plan came from, and nothing else — four chips at most, all
         * of them on screen. They folded to the chosen one, which is what a
         * header with no width to spare needs; this one has the width, and a
         * fold costs a press to answer "what sources have I got".
         */}
        <OptionGroup
          label={t("library.index.filter")}
          className="tl-chips"
          value={scope}
          options={scopes.map((option) => ({
            value: option.id,
            label: option.label
          }))}
          onChange={(next) => setScope(next as PlanScope)}
        />
        <div className="tl-filters-tail">
          {/* The same folded field the workout header carries. This one was a
              plain always-open input wearing `.tl-search` without ever setting
              `data-open`, so it sat at the folded 30px with the field clipped
              inside it. */}
          <CollapsibleSearch
            value={query}
            onChange={setQuery}
            label={t("library.index.search")}
          />
        </div>
      </div>

      {visible.length === 0 && looseDrafts.length === 0 ? (
        <div className="tl-empty">
          <h3>{empty.title}</h3>
          <p>{empty.body}</p>
          {empty.action === "clear" ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setQuery("");
                setScope("all");
              }}
            >
              {t("library.w.clear")}
            </button>
          ) : (
            /* An empty index is exactly where the create action is looked for. */
            <button type="button" className="primary-button" onClick={onCreate}>
              <Plus size={14} /> {t("library.view.newPlan")}
            </button>
          )}
        </div>
      ) : (
        <div className="tl-plans-scroll">
          {sections.hero ? (
            <PlanHero
              plan={sections.hero}
              view={viewOf(sections.hero)}
              position={heroPosition}
              editing={drafts.byPlan.has(sections.hero.id)}
              onOpen={onOpen}
            />
          ) : null}

          {sections.current.length || looseDrafts.length
            ? grid(sections.current, t("library.section.plans"), looseDrafts)
            : null}

          {/*
           * Two closed sections, each drawn only when it holds something. A
           * heading over nothing is a promise the library has not kept.
           */}
          {sections.done.length ? (
            <>
              <h3 className="tl-section-head">
                {t("library.index.done")} <span>{sections.done.length}</span>
              </h3>
              {grid(sections.done, t("library.index.doneLabel"))}
            </>
          ) : null}

          {/* The heading stays with its count while folded, so a search that
              only matches archived plans still says where they are. */}
          {sections.archived.length ? (
            <>
              <h3 className="tl-section-head">
                <button
                  type="button"
                  className="tl-section-toggle"
                  aria-expanded={archivedOpen}
                  onClick={() => setArchivedOpen((open) => !open)}
                >
                  <ChevronRight size={12} strokeWidth={2.4} aria-hidden="true" />
                  {t("library.index.archived")} <span>{sections.archived.length}</span>
                </button>
              </h3>
              {archivedOpen ? grid(sections.archived, t("library.index.archivedLabel")) : null}
            </>
          ) : null}
        </div>
      )}

      {/*
       * The two ways to get a new plan, floating in the list's own corner
       * rather than standing in the header — where they were the two widest
       * controls in a line of folded ones and set the height of the row. The
       * scroll area carries their height as bottom padding, so the last plan
       * can always be scrolled clear of them rather than sitting underneath
       * with nowhere further to go.
       *
       * Both wear the same button: writing one and having one written are two
       * ways of doing the same thing, and a ghost beside a filled pill said
       * one of them was the lesser.
       */}
      <div className="tl-plans-dock">
        <button type="button" className="primary-button" onClick={onCreate}>
          <Plus size={15} aria-hidden="true" /> {t("library.view.newPlan")}
        </button>
        {onGenerate ? (
          <button
            type="button"
            className="primary-button"
            disabled={offline}
            title={offline ? t("library.index.reconnectAi") : undefined}
            onClick={onGenerate}
          >
            <Sparkles size={15} aria-hidden="true" /> {t("library.index.aiPlan")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
