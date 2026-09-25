import { AnimatePresence, motion } from "motion/react";
import { MessageCircle, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  TrainingHubActivityDetail,
  TrainingHubSportType
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ActivityDetailPanel } from "../training/components/ActivityDetailPanel";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
import { formatHappenDayLabel } from "../training/formatters";
import { scheduledWorkoutKey, type CalendarSelection } from "./calendarTypes";
import { PlanStatusBlock } from "./PlanStatusBlock";
import { ScheduledWorkoutDetail } from "./ScheduledWorkoutDetail";
import { scheduledWorkoutSport } from "../training/workoutSport";

interface DayDetailPanelProps {
  api: CorosLinkApi;
  selection: CalendarSelection | null;
  sportTypes: TrainingHubSportType[];
  deleting: boolean;
  onClose: () => void;
  /** Settles once the removal has been answered, whichever way. */
  onDelete: (selection: Extract<CalendarSelection, { kind: "scheduled" }>) => Promise<void>;
  onAskCoach: (selection: CalendarSelection) => void;
  onEdit: (selection: Extract<CalendarSelection, { kind: "scheduled" }>) => void;
  /** Re-reads the range after a manual plan-status change. */
  onReload: () => void;
  onError: (message: string | null) => void;
}
export function DayDetailPanel({
  api,
  selection,
  sportTypes,
  deleting,
  onClose,
  onDelete,
  onAskCoach,
  onEdit,
  onReload,
  onError
}: DayDetailPanelProps) {
  const [detail, setDetail] = useState<TrainingHubActivityDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const removeButtonRef = useRef<HTMLButtonElement | null>(null);
  /* Read by the panel's Escape listener, which is registered once per opening
     and so cannot see this render's state. */
  const confirmDeleteRef = useRef(confirmDelete);
  confirmDeleteRef.current = confirmDelete;

  const activity = selection?.kind === "activity" ? selection.activity : null;

  /* What is on screen, as one string. `confirmDelete` is an open question about
     a destructive action, so it has to be cleared by anything that changes what
     "Remove" would remove — the detail fetch's own effect keys on the activity
     id, which does not move when one scheduled workout replaces another. */
  /* The workout editor writes COROS program sports 1-9 and nothing else, which
     was spelled as that numeric range twice in the markup. Ask the capability
     table the editor itself is built from. */
  const editableSport =
    selection?.kind === "scheduled"
      ? scheduledWorkoutSport(selection.entry.sportType)
      : undefined;

  /* The pairing this day already computed, for the entry on screen. */
  const planPair =
    selection?.kind === "scheduled"
      ? selection.day.pairs.find(
          (pair) =>
            scheduledWorkoutKey(pair.scheduled) === scheduledWorkoutKey(selection.entry)
        )
      : undefined;

  const selectionKey = selection
    ? selection.kind === "scheduled"
      ? `scheduled:${scheduledWorkoutKey(selection.entry)}`
      : `activity:${selection.activity.activityId}`
    : "";

  useEffect(() => {
    setConfirmDelete(false);
  }, [selectionKey]);

  /* Escape closes, like every other dialog in the app, and focus goes back to
     whatever opened the panel — a chip in the grid — instead of being left at
     the top of a page the athlete cannot see. */
  useEffect(() => {
    if (!selection) {
      return;
    }
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      /* The removal question answers its own Escape. Both listeners sit on
         `document` in the capture phase, and this one was registered first, so
         it hears the key first — without this the one press would close the
         question and the panel under it. */
      if (event.key === "Escape" && !confirmDeleteRef.current) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      window.cancelAnimationFrame(frame);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
    // The panel is one surface for the whole time a selection is open; re-running
    // this per selection would bounce focus on every chip click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(selection)]);

  useEffect(() => {
    setDetail(null);
    if (!activity) {
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void api
      .getTrainingHubActivityDetail(activity.activityId, activity.sportType, activity)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          onError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.activityId]);

  const removal =
    confirmDelete && selection?.kind === "scheduled" ? selection : null;

  return (
    <>
      <AnimatePresence>
        {selection ? (
          <>
            <motion.div
              className="calendar-detail-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.aside
              ref={panelRef}
              className="calendar-detail-panel"
              role="dialog"
              aria-modal="true"
              aria-label={
                selection.kind === "scheduled"
                  ? selection.entry.name
                  : (selection.activity.name ??
                    selection.activity.sportName ??
                    "Activity")
              }
              tabIndex={-1}
              initial={{ x: "104%" }}
              animate={{ x: 0 }}
              exit={{ x: "104%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              <header className="calendar-detail-header">
                <div>
                  <p className="eyebrow">
                    {formatHappenDayLabel(
                      selection.kind === "scheduled"
                        ? selection.entry.happenDay
                        : selection.day.dateKey
                    )}
                  </p>
                  <h3>
                    {selection.kind === "scheduled"
                      ? selection.entry.name
                      : selection.activity.name ??
                        selection.activity.sportName ??
                        "Activity"}
                  </h3>
                </div>
                <div className="calendar-detail-actions">
                  <button
                    type="button"
                    className="ghost-button calendar-detail-action"
                    onClick={() => onAskCoach(selection)}
                    title="Ask Coach"
                  >
                    <MessageCircle size={15} aria-hidden="true" />
                    Ask Coach
                  </button>
                  {selection.kind === "scheduled" && !selection.day.isPast ? (
                    <button
                      type="button"
                      className="ghost-button calendar-detail-action"
                      disabled={!editableSport}
                      onClick={() => onEdit(selection)}
                      title={
                        editableSport
                          ? "Edit this scheduled occurrence"
                          : "This COROS sport is not supported by the workout editor"
                      }
                    >
                      <Pencil size={15} aria-hidden="true" />
                      Edit
                    </button>
                  ) : null}
                  {selection.kind === "scheduled" && !selection.day.isPast ? (
                    <button
                      ref={removeButtonRef}
                      type="button"
                      className="ghost-button calendar-detail-action"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      {deleting ? "Removing…" : "Remove"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button calendar-detail-action"
                    onClick={onClose}
                    aria-label="Close details"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <div className="calendar-detail-body">
                {selection.kind === "scheduled" ? (
                  <>
                    {planPair ? (
                      <PlanStatusBlock
                        api={api}
                        day={selection.day}
                        pair={planPair}
                        onChanged={onReload}
                        onError={onError}
                      />
                    ) : null}
                    <ScheduledWorkoutDetail
                      entry={selection.entry}
                      sportTypes={sportTypes}
                      api={api}
                    />
                  </>
                ) : (
                  <ActivityDetailPanel
                    embedded
                    api={api}
                    detail={detail}
                    listActivity={selection.activity}
                    sportTypes={sportTypes}
                    /*
                     * This pane fetches its own detail, so it reports its own
                     * state. The `busy` string it used to pass was free text and
                     * never matched the `training-detail:<id>` key the panel
                     * compares against, so the loader never appeared here.
                     */
                    detailRequest={
                      loadingDetail
                        ? {
                            activityId: selection.activity.activityId,
                            status: "pending"
                          }
                        : null
                    }
                  />
                )}
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
      {/* Outside the presence, so a removal that lands does not leave the
          question drawn over the panel's exit; portalled to <body> to clear the
          shell's stacking context, as the plan editor is. */}
      {removal
        ? createPortal(
            <ConfirmDialog
              title={`Remove "${removal.entry.name}" from the calendar?`}
              description={`It comes off ${formatHappenDayLabel(removal.entry.happenDay)} in your COROS calendar. A workout in your library stays as it is — the calendar holds a copy of its own.`}
              confirmLabel="Remove from calendar"
              danger
              busy={deleting ? { target: "confirm", label: "Removing…" } : undefined}
              onConfirm={() => {
                void onDelete(removal).then(() => setConfirmDelete(false));
              }}
              onCancel={() => {
                setConfirmDelete(false);
                removeButtonRef.current?.focus();
              }}
            />,
            document.body
          )
        : null}
    </>
  );
}
