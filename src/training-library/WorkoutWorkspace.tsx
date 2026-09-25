import {
  CalendarPlus,
  Copy,
  Heart,
  LoaderCircle,
  Pencil,
  Plus,
  Tag,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RunWorkoutEditorNode,
  TrainingLibraryWorkout,
  UnitSystem,
  WorkoutEditorDocument
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { OptionGroup } from "../components/OptionGroup";
import { CollapsibleSearch } from "./LibrarySearch";
import { formatHappenDayLabel } from "../training/formatters";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { workoutSportFromType } from "../../electron/trainingPlanDomain";
import { SportBadge, sportAccentStyle } from "./sportTheme";
import { keyFromDate } from "../calendar/dateUtils";
import { MonthDayPicker } from "./MonthDayPicker";
import { PromptDialog } from "./PromptDialog";
import { compareFavoriteThenName } from "./libraryOrder";
import { TAG_MAX_LENGTH, clampTagInput, parseTagInput } from "./tagInput";
import { WorkoutReadOnlyBody } from "../calendar/WorkoutEditorModal";
import { WorkoutBuilderModal } from "../calendar/WorkoutBuilderModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { useWorkoutExerciseCatalog } from "../calendar/useWorkoutExerciseCatalog";
import { AddWorkoutModal } from "../calendar/AddWorkoutModal";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue, formatElevationValue } from "../units/units";
import {
  defineSelectionPreference,
  useSelectionPreference
} from "../preferences/selectionPreferences";

interface WorkoutWorkspaceProps {
  api: CorosLinkApi;
  workouts: TrainingLibraryWorkout[];
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}

const WORKOUT_SCOPE_PREFERENCE = defineSelectionPreference<string>({
  key: "trainingLibrary.workouts.scope",
  defaultValue: "all",
  validate: (value): value is string =>
    typeof value === "string" &&
    (["all", "favorite", "unsettled"].includes(value) ||
      /^sport:\d+$/.test(value))
});

const UNSETTLED_SYNC = new Set(["pending", "conflicted", "failed", "stale"]);
/** Enough segments to read an interval comb without drawing thousands of them. */
const SHAPE_SEGMENT_LIMIT = 96;
/*
 * A row's shape needs the step list, and COROS only ships that on
 * /training/program/detail — one request per workout. So rows ask for it only
 * once they scroll into view, a few at a time, and never twice for the same
 * workout. Browsing the library costs a handful of requests, not sixty.
 */
const SHAPE_BATCH = 3;
/** Draws the line a beat before the row lands, so it is never seen filling in. */
const SHAPE_PREFETCH_MARGIN = "160px";
/**
 * Tomorrow, as a COROS happen-day key.
 *
 * Read off the local clock, not `toISOString()`, which reports the day in UTC:
 * a morning east of Greenwich is still yesterday there, so "tomorrow" came
 * back as today and the earliest day the picker offered was one the athlete
 * had already half spent.
 */
function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return keyFromDate(date);
}

function targetLabel(
  node: RunWorkoutEditorNode,
  unitSystem: UnitSystem,
  swim = false
): string {
  if (node.nodeType === "repeat") return `${node.repeat} rounds`;
  const target = node.target;
  if (target.type === "time") return `${Math.round(target.seconds / 60)} min`;
  if (target.type === "distance") {
    if (unitSystem === "metric" && !swim && target.meters < 1000) {
      return `${Math.round(target.meters)} m`;
    }
    return formatDistanceValue(target.meters, unitSystem, {
      swim,
      ...(swim ? { digits: 0 } : {})
    });
  }
  if (target.type === "load") return `${target.load} load`;
  if (target.type === "reps") return `${target.count} reps`;
  if (target.type === "routes") return `${target.count} routes`;
  if (target.type === "elevationGain") return `${formatElevationValue(target.meters, unitSystem)} gain`;
  if (target.type === "hrRecovery") return `${target.bpm} bpm recovery`;
  return "Open";
}

interface ShapeSegment {
  kind: string;
  share: number;
  label: string;
}

/**
 * The reader's counterpart to the plan ridge: one segment per step, width
 * proportional to how long the step runs, shaded by the step's declared kind.
 * Repeats expand, so an interval set reads as a comb.
 */
function workoutShape(
  nodes: RunWorkoutEditorNode[],
  unitSystem: UnitSystem,
  swim = false
): ShapeSegment[] {
  const segments: ShapeSegment[] = [];

  const push = (node: RunWorkoutEditorNode) => {
    if (segments.length >= SHAPE_SEGMENT_LIMIT || node.nodeType === "repeat") return;
    const target = node.target;
    /* Per set, times the sets — the weighting the reader's strength bar
       uses, so a row's line and the chart it opens agree. */
    const perSet =
      target.type === "time"
        ? target.seconds
        : target.type === "distance"
          ? target.meters / 3
          : target.type === "reps"
            ? target.count * 4
            : 120;
    const weight = perSet * Math.max(1, node.sets ?? 1);
    segments.push({
      kind: node.kind,
      share: Math.max(weight, 1),
      label: `${node.name} · ${targetLabel(node, unitSystem, swim)}`
    });
  };

  for (const node of nodes) {
    if (node.nodeType === "repeat") {
      for (let round = 0; round < node.repeat; round += 1) {
        for (const step of node.steps) push(step);
      }
    } else {
      push(node);
    }
  }

  const total = segments.reduce((sum, segment) => sum + segment.share, 0) || 1;
  return segments.map((segment) => ({ ...segment, share: (segment.share / total) * 100 }));
}

/*
 * The calendar's structure bar sizes its segments by flex-grow and floors the
 * tiny ones, so a 20-second recovery between reps never collapses to nothing.
 * The row's line borrows the rule outright — the two bars should read as one
 * idea, one drawn a few pixels high.
 */
function combGrow(segments: ShapeSegment[]): number[] {
  const largest = Math.max(0, ...segments.map((segment) => segment.share));
  if (largest <= 0) return segments.map(() => 1);
  const floor = largest * 0.035;
  return segments.map((segment) => Math.max(segment.share, floor));
}

/*
 * Past this many steps the gapped segments stop fitting the row's width, so
 * the line closes up into a striped band instead of overflowing. A 20 × 30s
 * set genuinely looks like that.
 */
const COMB_DENSE_AT = 30;

/**
 * What one `/training/program/detail` answer is worth to a row: its session
 * shape. The figures beside it — `exerciseNum` and `totalSets` — come off the
 * list itself, so neither waits on this.
 */
interface WorkoutDetail {
  shape: ShapeSegment[];
}

function workoutDetail(
  document: WorkoutEditorDocument,
  unitSystem: UnitSystem
): WorkoutDetail {
  const swim = document.draft.sport === "swim";
  return { shape: workoutShape(document.draft.nodes, unitSystem, swim) };
}

export function WorkoutWorkspace({
  api,
  workouts,
  onRefresh,
  onMessage,
  onError
}: WorkoutWorkspaceProps) {
  const { unitSystem } = useUnitSystem();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useSelectionPreference(
    WORKOUT_SCOPE_PREFERENCE
  );
  const [activeId, setActiveId] = useState<string | null>(workouts[0]?.id ?? null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [previewDocument, setPreviewDocument] = useState<WorkoutEditorDocument | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState(tomorrow);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const scheduleRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrainingLibraryWorkout | null>(null);
  const [creating, setCreating] = useState(false);
  const [prompting, setPrompting] = useState<"duplicate" | "tags" | null>(null);
  /** What the detail said, per workout id. Present means "asked and answered". */
  const [details, setDetails] = useState<Record<string, WorkoutDetail>>({});
  const [shapeQueue, setShapeQueue] = useState<string[]>([]);
  const requestedShapes = useRef(new Set<string>());
  const shapeBusy = useRef(false);
  const shapeObserver = useRef<IntersectionObserver | null>(null);

  /*
   * COROS's movement catalog for the selected workout's sport. A strength
   * step's own `exerciseName` is a localization key — the live library answers
   * `T1041` for a bench press — so without this every exercise in a session
   * reads as its step kind, which is the same word nine times. The hook holds
   * one request per sport for the life of the window and answers every other
   * sport with an empty catalog rather than a request.
   */
  const exerciseCatalog = useWorkoutExerciseCatalog(
    api,
    workoutSportFromType(workouts.find((workout) => workout.id === activeId)?.sportType)
  );

  const scopes = useMemo(() => {
    const options = [{ id: "all", label: "All" }];
    if (workouts.some((workout) => workout.favorite)) {
      options.push({ id: "favorite", label: "Favorites" });
    }
    const sports = [...new Set(workouts.map((workout) => workout.sportType))]
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right);
    for (const sportType of sports) {
      options.push({
        id: `sport:${sportType}`,
        label: formatWorkoutSport(workoutSportFromType(sportType) ?? "run")
      });
    }
    if (workouts.some((workout) => UNSETTLED_SYNC.has(workout.syncState))) {
      options.push({ id: "unsettled", label: "Needs attention" });
    }
    return options;
  }, [workouts]);

  const scopeAvailable = scopes.some((option) => option.id === scope);
  useEffect(() => {
    if (!scopeAvailable) setScope("all");
  }, [scopeAvailable, setScope]);

  /*
   * The schedule panel is folded again by reading another workout. It hangs
   * off the dock rather than off the workout, so nothing else takes it down —
   * and a date chosen for one session standing open over the next one is an
   * offer to schedule the wrong thing.
   */
  useEffect(() => {
    setScheduleOpen(false);
  }, [activeId]);

  /*
   * Open, it is dismissed by a press outside it or by Escape.
   *
   * Escape is taken in the capture phase for the reason `OptionGroup` takes
   * it there: the reader sits inside a screen whose modals close on Escape
   * from their own `document` listener, and two listeners on one node are not
   * separated by `stopPropagation()`.
   */
  useEffect(() => {
    if (!scheduleOpen) return;
    /* Opened, the keyboard lands on the day that is already chosen, so the
       grid can be walked from where the decision starts. */
    scheduleRef.current
      ?.querySelector<HTMLButtonElement>(".tl-daypick-day.is-selected")
      ?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!scheduleRef.current?.contains(event.target as Node)) setScheduleOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setScheduleOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [scheduleOpen]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = workouts.filter((workout) => {
      if (needle && !`${workout.name} ${workout.tags.join(" ")}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (scope === "favorite") return workout.favorite;
      if (scope === "unsettled") return UNSETTLED_SYNC.has(workout.syncState);
      if (scope.startsWith("sport:")) return String(workout.sportType) === scope.slice(6);
      return true;
    });

    /*
     * One order — favourites first, then by name — and no control to change it.
     *
     * `Name`, `Duration` and `Training load` stood in a dropdown here, and two
     * of the three could not order anything: the detail a figure sort reads
     * arrives a few rows at a time, as tiles scroll into view, so the list
     * re-ordered itself under the reader while it was being read — and a
     * library the athlete had not scrolled through yet sorted by the list
     * row's figures, which `/training/program/query` answers with `0` for
     * every workout it holds. Name and the favourite flag are the keys every
     * row carries in its first paint. See `libraryOrder.ts`.
     */
    return matching.sort(compareFavoriteThenName);
  }, [workouts, query, scope]);

  /*
   * The observer is built on the first tile that mounts rather than in an
   * effect, so the tiles already on screen at first paint are watched too.
   */
  const observeTile = useCallback((node: HTMLLIElement | null) => {
    if (!node) return;
    if (!shapeObserver.current) {
      shapeObserver.current = new IntersectionObserver(
        (entries, observer) => {
          const seen: string[] = [];
          for (const entry of entries) {
            const id = entry.isIntersecting ? (entry.target as HTMLElement).dataset.workoutId : null;
            if (!id || requestedShapes.current.has(id)) continue;
            requestedShapes.current.add(id);
            seen.push(id);
            observer.unobserve(entry.target);
          }
          if (seen.length) setShapeQueue((current) => [...current, ...seen]);
        },
        { rootMargin: SHAPE_PREFETCH_MARGIN }
      );
    }
    shapeObserver.current.observe(node);
  }, []);

  useEffect(
    () => () => {
      shapeObserver.current?.disconnect();
      shapeObserver.current = null;
    },
    []
  );

  /*
   * One batch in flight at a time; finishing it trims the queue, and the
   * shorter queue re-runs this.
   *
   * **Nothing here may be abandoned on cleanup, and that is the whole point.**
   * This used to hold a `cancelled` flag that its cleanup raised, which
   * deadlocked the moment the observer saw a second tile — which is to say
   * immediately, every time, because a screen of tiles reports in more than
   * one callback:
   *
   *   1. queue grows        → deps change → cleanup raises `cancelled`
   *   2. effect re-runs     → `shapeBusy` is still true → returns at once
   *   3. the batch settles  → `cancelled`, so its shapes are thrown away and
   *                           the queue is never trimmed
   *   4. `shapeBusy` is false, the queue is full, and no state changed —
   *      so nothing ever runs again
   *
   * Every tile then drew its load bar instead of its shape for the life of
   * the window, and the only thing that filled one in was opening that
   * workout, because the reader writes its own shape on the way past. It
   * typechecks, throws nothing, and looks like a design decision.
   *
   * A `setShapes` after unmount is a no-op in React 18, so there is nothing
   * to protect against here that is worth a stall.
   */
  useEffect(() => {
    if (shapeBusy.current || !shapeQueue.length) return;
    shapeBusy.current = true;
    const batch = shapeQueue.slice(0, SHAPE_BATCH);

    void Promise.all(
      batch.map(async (id) => {
        let detail: WorkoutDetail = { shape: [] };
        try {
          detail = workoutDetail(
            await api.getWorkoutForEdit({ kind: "library", programId: id }, unitSystem),
            unitSystem
          );
        } catch {
          /* A row that cannot read its detail draws no line. */
        }
        setDetails((current) => ({ ...current, [id]: detail }));
      })
    ).finally(() => {
      shapeBusy.current = false;
      /* By id, not by count: the observer appends while a batch is in flight,
         so the queue this trims is not the one the batch was taken from. */
      setShapeQueue((current) => current.filter((id) => !batch.includes(id)));
    });
  }, [api, shapeQueue, unitSystem]);

  /*
   * An edit rewrites one workout's steps. Queue that id directly rather than
   * waiting on the observer — the tile is already on screen and will not cross
   * the viewport edge again to announce itself.
   */
  const redrawShape = useCallback((id: string) => {
    setDetails((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    requestedShapes.current.add(id);
    setShapeQueue((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  const active = workouts.find((workout) => workout.id === activeId);

  /*
   * One object per workout being edited, not one per render. The editor loads
   * its document in an effect keyed on this ref, and a literal written into
   * the JSX was a new object every time this screen rendered — which it does
   * a few seconds after the editor opens, when the next batch of row shapes
   * lands. Each of those threw the draft away and loaded it again: a flash
   * back to the skeleton, and any edit made in the meantime gone.
   */
  const editRef = useMemo(
    () => (editId ? { kind: "library" as const, programId: editId } : null),
    [editId]
  );

  useEffect(() => {
    if (!activeId) {
      setPreviewDocument(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewDocument(null);
    /* Claimed before the request, not after it: the tile observer runs while
       this is in flight, and would otherwise queue the same workout for a
       shape this call is already fetching — one duplicate COROS request per
       mount, for whichever workout the reader opens with. */
    requestedShapes.current.add(activeId);
    void api
      .getWorkoutForEdit({ kind: "library", programId: activeId }, unitSystem)
      .then(async (document) => {
        if (cancelled) return;
        setPreviewDocument(document);
        /* The reader just paid for this workout's detail; its row reads it free. */
        setDetails((current) => ({
          ...current,
          [activeId]: workoutDetail(document, unitSystem)
        }));
        /*
         * `previewWorkoutEdit` stood here — a second COROS request per
         * selection, whose whole job was to fill a four-figure strip above
         * the steps. The shared view computes every one of those from the
         * draft that has already arrived, so selecting a workout costs one
         * request now instead of two.
         */
      })
      .catch((cause: unknown) => {
        if (!cancelled) onError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, activeId, onError, unitSystem]);

  const updateMetadata = async (ids: string[], patch: Parameters<CorosLinkApi["updateWorkoutMetadata"]>[1]) => {
    setBusy("metadata");
    try {
      await api.updateWorkoutMetadata(ids, patch);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const schedule = async () => {
    if (!active || !scheduleDate) return;
    setBusy("schedule");
    try {
      const happenDay = scheduleDate;
      await api.scheduleLibraryWorkout(active.id, happenDay);
      onMessage(`Scheduled "${active.name}" on ${formatHappenDayLabel(happenDay)}.`);
      /* Folded again on the way out: the date has been spent, and a panel
         left standing open reads as though nothing happened. It stays open
         on a failure, where the date is still the thing being decided. */
      setScheduleOpen(false);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (name: string) => {
    if (!active || !name.trim()) return;
    setPrompting(null);
    setBusy("duplicate");
    try {
      const result = await api.duplicateLibraryWorkout(
        active.id,
        name.trim(),
        active.sportType
      );
      onMessage(`Created "${result.name}" in the workout library.`);
      await onRefresh();
      setActiveId(result.id);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  /* Tags are the reader's: they act on the workout on screen. */
  const saveTags = (value: string) => {
    setPrompting(null);
    if (!activeId) return;
    void updateMetadata([activeId], { tags: parseTagInput(value) });
  };

  const deleteConfirmed = async () => {
    if (!pendingDelete || busy === "delete") return;
    setBusy("delete");
    try {
      await api.deleteTrainingLibraryWorkouts({ programIds: [pendingDelete.id], confirmed: true });
      onMessage(`Deleted "${pendingDelete.name}" from COROS.`);
      setPendingDelete(null);
      setActiveId(null);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tl-panel tl-workouts">
      <div className="tl-split">
        <section className="tl-catalog" aria-label={`${filtered.length} workouts`}>
          {/*
           * The list's own header, not the screen's. It stood above the split,
           * spanning both panes, which put the chips and the search over the
           * reader as well — controls that narrow a list, laid out over the
           * thing the list opens. The census that used to head the column
           * ("Workout / Total") is gone with it, and so is the sort: a
           * dropdown over `Name`, `Duration` and `Training load` offered two
           * orders COROS has no figures for. What narrows the list is here —
           * the scope chips and the search; what the list is in is one order,
           * by name.
           */}
          <div className="tl-filters">
            <OptionGroup
              label="Filter workouts"
              className="tl-chips"
              /* The header has one line to give, and the sports in it grow
                 with the library — so the chips fold to the chosen one and
                 open in place. */
              mode="collapsible"
              value={scope}
              options={scopes.map((option) => ({
                value: option.id,
                label: option.label
              }))}
              onChange={setScope}
            />
            <div className="tl-filters-tail">
              <CollapsibleSearch
                value={query}
                onChange={setQuery}
                label="Search workouts"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            /*
             * Two empties, and they are different screens: a filter that matched
             * nothing, and a library with nothing in it. The second one told an
             * athlete with no COROS workouts to clear a search they never typed,
             * and never mentioned that they could build one — which the button
             * standing in the corner of this column now does.
             */
            <div className="tl-empty">
              <h3>{workouts.length ? "No workouts match" : "No workouts yet"}</h3>
              <p>
                {workouts.length
                  ? "Clear the search or choose another filter."
                  : "Build your first structured workout here, or refresh to pull the ones already in your COROS library."}
              </p>
              {workouts.length ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setQuery("");
                    setScope("all");
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {/*
               * Three labels, because there are now three figures to name and
               * two of them are numbers in a column. The head this replaces
               * said "Workout / Total", where `Total` stood over the COROS
               * volume string — the one figure the program list gets wrong —
               * so it named a column that was lying. Labels, not controls:
               * the list is in name order and there is nothing to change it
               * to — a clickable heading would offer the two orders the sort
               * dropdown was removed for offering.
               *
               * **A sibling of the scrolling list, not the first thing inside
               * it.** Sticky inside the scroller it stayed put, but the
               * scrollbar is the scroller's own and ran the full height — a
               * thumb sliding past a row that does not move. Out here the
               * scrollbar starts under it; `.tl-catalog > .tl-index-head`
               * reserves the same gutter so the columns still line up.
               */}
              <div className="tl-index-head tl-workout-row">
                <span className="tl-column-label">Workout</span>
                <span className="tl-column-label is-numeric">Exercises</span>
                <span className="tl-column-label is-numeric">Sets</span>
              </div>

              <div className="tl-index">
                <ul role="list">
                  {filtered.slice(0, visibleCount).map((workout) => {
                    const sport = workoutSportFromType(workout.sportType);
                    const tags = workout.tags.slice(0, 2);
                    const shape = details[workout.id]?.shape;

                    return (
                      <li
                        className={`tl-workout-row tl-row${activeId === workout.id ? " is-active" : ""}`}
                        key={workout.id}
                        ref={observeTile}
                        data-workout-id={workout.id}
                        data-accent={sport ?? "other"}
                        style={sportAccentStyle(sport)}
                      >
                        <button type="button" className="tl-row-open" onClick={() => setActiveId(workout.id)}>
                          <span className="tl-row-name">
                            {workout.favorite ? (
                              <Heart size={12} fill="currentColor" strokeWidth={0} aria-label="Favorite" />
                            ) : null}
                            {/* The name is its own box so it can end in an
                                ellipsis: `text-overflow` acts on a block's own
                                inline content, and the text of a flex container
                                is an anonymous flex item — so the rules on the
                                row clipped a long name flat instead. */}
                            <span className="tl-row-name-text">{workout.name}</span>
                          </span>
                          <span className="tl-row-sub">
                            <SportBadge sport={sport ?? "run"} compact />
                            {tags.map((tag, index) => (
                              <em key={index}>{tag}</em>
                            ))}
                            {UNSETTLED_SYNC.has(workout.syncState) ? (
                              <i className="tl-flag">{workout.syncState}</i>
                            ) : null}
                          </span>
                          {/*
                           * The session's shape, a few pixels high: an overview
                           * of how the work is laid out, not the chart the
                           * reader draws. It waits on the detail, which the row
                           * asks for as it scrolls into view, so the slot is
                           * always there — a line that appeared on some rows
                           * and not others would move every row under it.
                           */}
                          <span
                            className="tl-row-shape"
                            data-dense={shape && shape.length > COMB_DENSE_AT ? "true" : undefined}
                            {...(shape?.length
                              ? {
                                  role: "img",
                                  "aria-label": `Workout structure: ${shape
                                    .map((segment) => segment.label)
                                    .join(", ")}`
                                }
                              : { "aria-hidden": true })}
                          >
                            {shape?.length
                              ? combGrow(shape).map((grow, index) => (
                                  <i
                                    key={index}
                                    className={`is-${shape[index]!.kind}`}
                                    style={{ flexGrow: grow }}
                                  />
                                ))
                              : null}
                          </span>
                        </button>
                        {/*
                         * How many movements, and how many sets they come to.
                         *
                         * `exerciseNum` and `totalSets` are the only figures
                         * besides `estimatedTime` that COROS fills in on a
                         * library row, so both are on screen in the first paint
                         * with nothing fetched. The row showed the COROS volume
                         * alone before, which that endpoint reports as
                         * "1 set(s)" for an hour's run. Load is not here: COROS
                         * only computes it for a step with an intensity target,
                         * so it would be a dash down most libraries.
                         */}
                        <span className={`tl-fig${workout.exerciseCount ? "" : " is-nil"}`}>
                          {workout.exerciseCount ?? "—"}
                        </span>
                        <span className={`tl-fig${workout.setCount ? "" : " is-nil"}`}>
                          {workout.setCount ?? "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {visibleCount < filtered.length ? (
                  <button
                    type="button"
                    className="tl-load-more"
                    onClick={() => setVisibleCount((value) => value + 60)}
                  >
                    Show 60 more of {filtered.length}
                  </button>
                ) : null}
              </div>
            </>
          )}

          {/*
           * Floating in the column's own corner, over the list rather than in
           * a row above it. Making a workout is the one thing this screen is
           * for that is not reading one, and it kept the control row a size
           * wider than the controls in it. The scroll area carries the height
           * of this button as bottom padding, so the last row can be scrolled
           * clear of it — see `.tl-catalog > :is(.tl-grid, .tl-index)`.
           */}
          <button
            type="button"
            className="tl-catalog-new primary-button"
            onClick={() => setCreating(true)}
          >
            <Plus size={15} aria-hidden="true" /> New workout
          </button>
        </section>

        <aside className="tl-reader" aria-live="polite">
          {!active ? (
            <div className="tl-empty">
              <h3>Pick a workout</h3>
              <p>Its full step structure appears here.</p>
            </div>
          ) : (
            <>
              <div className="tl-reader-scroll">
                {previewLoading ? (
                  <p className="tl-reader-loading">
                    <LoaderCircle className="is-spinning" size={16} /> Loading the full structure
                  </p>
                ) : previewDocument ? (
                  /*
                   * The Calendar's own workout view, not a second one built from
                   * the same payload. This pane used to draw its own hero, its
                   * own four-metric list and its own step list off the same
                   * `WorkoutEditorDocument` — the drift `WorkoutStructure`
                   * exists to prevent, one level up, between two surfaces that
                   * never show each other.
                   *
                   * Everything this screen knows about the workout that the
                   * Calendar does not — that it is a favourite and what the
                   * athlete has tagged it — rides in the hero's slots. They
                   * were blocks stacked under the steps, which is a long way
                   * from the name they are about.
                   */
                  <WorkoutReadOnlyBody
                    draft={previewDocument.draft}
                    context={previewDocument.context}
                    exercisesById={exerciseCatalog.byId}
                    title={active.name}
                    heroAside={
                      <button
                        type="button"
                        className={`tl-reader-favorite${active.favorite ? " is-active" : ""}`}
                        aria-label={active.favorite ? "Remove from favorites" : "Add to favorites"}
                        onClick={() => void updateMetadata([active.id], { favorite: !active.favorite })}
                      >
                        <Heart size={16} fill={active.favorite ? "currentColor" : "none"} />
                      </button>
                    }
                    {...(active.tags.length
                      ? {
                          subtitleAside: (
                            <ul className="tl-reader-tags" aria-label="Workout tags">
                              {active.tags.slice(0, 8).map((tag) => (
                                <li key={tag}>{tag}</li>
                              ))}
                              {active.tags.length > 8 ? (
                                <li>+{active.tags.length - 8} more</li>
                              ) : null}
                            </ul>
                          )
                        }
                      : {})}
                  />
                ) : (
                  <p className="tl-reader-loading">
                    This workout has no structure stored on COROS.
                  </p>
                )}
              </div>

              <footer className="tl-reader-dock">
                {/* Everything you can do to this workout, in one row.
                    Scheduling had a row of its own above it — a heading, an
                    icon, a date field and a button standing open across the
                    dock for a decision that is made once and then not again,
                    while the four buttons below it shared the line they were
                    already on. It is a button here like the rest, and the date
                    comes out only when it is asked for. */}
                <div className="tl-reader-actions">
                  {/*
                   * Scheduling leads the row, folded until it is reached for —
                   * the same shape as the list's search: a control you only
                   * open once you have decided to use it. The panel opens
                   * upward, because the dock is the bottom edge of the reader
                   * and there is nothing below it.
                   */}
                  <div className="tl-schedule-pop" ref={scheduleRef}>
                    <button
                      type="button"
                      className="primary-button"
                      aria-haspopup="dialog"
                      aria-expanded={scheduleOpen}
                      onClick={() => setScheduleOpen((open) => !open)}
                    >
                      <CalendarPlus size={14} /> Schedule
                    </button>
                    {scheduleOpen ? (
                      <form
                        className="tl-schedule-pop-panel"
                        role="dialog"
                        aria-label={`Schedule ${active.name}`}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void schedule();
                        }}
                      >
                        <MonthDayPicker
                          label="Schedule date"
                          value={scheduleDate}
                          min={tomorrow()}
                          onChange={setScheduleDate}
                        />
                        <p className="tl-schedule-pop-day">
                          {formatHappenDayLabel(scheduleDate)}
                        </p>
                        <button
                          type="submit"
                          className="primary-button"
                          disabled={!scheduleDate || busy === "schedule"}
                        >
                          {busy === "schedule" ? "Scheduling" : "Schedule"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="ghost-button tl-reader-edit"
                    disabled={!previewDocument?.canEdit}
                    onClick={() => setEditId(active.id)}
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setPrompting("tags")}>
                    <Tag size={14} /> Tags
                  </button>
                  {/* A copy of this workout, in this workout's sport. The sport
                      picker beside it offered to change that on the way
                      through, which is a second decision bolted to a button
                      whose job is "make me another one of these". Changing
                      sport belongs in the editor, where every other property
                      of a workout is changed. */}
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busy === "duplicate"}
                    onClick={() => setPrompting("duplicate")}
                  >
                    <Copy size={14} /> Duplicate
                  </button>
                  <button
                    type="button"
                    className="ghost-button danger"
                    onClick={() => setPendingDelete(active)}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </footer>
            </>
          )}
        </aside>
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}" from COROS?`}
          description="This removes the workout from your COROS library and cannot be undone. Sessions already on your calendar or in a plan are copies of their own, and stay as they are."
          confirmLabel="Delete workout"
          danger
          busy={busy === "delete" ? { target: "confirm", label: "Deleting…" } : undefined}
          onConfirm={() => void deleteConfirmed()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}

      {editId && editRef ? (
        /* The builder Create workout opens, read from COROS — so a workout is
           edited in the form it was written in, not a second editor beside it. */
        <WorkoutBuilderModal
          api={api}
          source={{ kind: "library", editRef }}
          heading={{ title: "Edit library workout" }}
          confirmDiscard={({ keep, discard }) => (
            <ConfirmDialog
              title="Discard unsaved changes?"
              description="Your edits have not been sent to COROS. Closing the workout throws them away."
              confirmLabel="Discard changes"
              cancelLabel="Keep editing"
              danger
              onConfirm={discard}
              onCancel={keep}
            />
          )}
          onClose={() => setEditId(null)}
          onSaved={(result) => {
            redrawShape(editId);
            setEditId(null);
            onMessage(result.verified ? "Workout saved and verified." : (result.warning ?? "Workout saved."));
            void onRefresh();
          }}
          onError={(message) => message && onError(message)}
        />
      ) : null}

      {creating ? (
        <AddWorkoutModal
          api={api}
          dateKey={tomorrow()}
          sportTypes={[]}
          libraryOnly
          onClose={() => setCreating(false)}
          onScheduled={(message) => {
            setCreating(false);
            onMessage(message);
            void onRefresh();
          }}
          onError={(message) => message && onError(message)}
        />
      ) : null}

      {prompting === "duplicate" && active ? (
        <PromptDialog
          title="Name the duplicate"
          description={`A copy of "${active.name}" is created in your COROS workout library.`}
          label="Name for the duplicate"
          initialValue={`${active.name} Copy`}
          confirmLabel="Duplicate"
          onConfirm={(name) => void duplicate(name)}
          onCancel={() => setPrompting(null)}
        />
      ) : null}

      {prompting === "tags" && active ? (
        <PromptDialog
          title="Tag this workout"
          description={`Tags are local labels you can search and filter by. Separate them with commas; each one is held to ${TAG_MAX_LENGTH} characters.`}
          label="Tags, separated by commas"
          initialValue={active.tags.join(", ")}
          placeholder="tempo, threshold, race week"
          sanitize={clampTagInput}
          confirmLabel="Save tags"
          onConfirm={saveTags}
          onCancel={() => setPrompting(null)}
        />
      ) : null}
    </div>
  );
}
