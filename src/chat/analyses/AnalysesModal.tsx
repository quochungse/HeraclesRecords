import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Zap } from "lucide-react";
import type { ChatProvider } from "../../../electron/types";
import type { HeraclesRecordsApi } from "../../heraclesrecords-api";
import { AnalysisCreate } from "./AnalysisCreate";
import { AnalysisDetailView } from "./AnalysisDetail";
import { AnalysesTitleProvider } from "./analysesTitle";
import { ConfirmDialog } from "../../training-library/ConfirmDialog";
// The confirmation's chrome is the library's `tl-dialog`, as Coach settings'
// is.
import "../../training-library/trainingLibrary.css";

/**
 * The full-screen host for one analysis — either the one being written, or the
 * one being looked at.
 *
 * There is no list inside it any more, because there is no list to show: an
 * analysis belongs to one conversation, and the conversation's own header
 * already lists them. What is left is the thing a popover cannot hold — a
 * playbook is paragraphs, and a trigger is a form — so the modal became a
 * detail host rather than a management screen.
 */
export type AnalysesModalTarget =
  | { kind: "create"; sessionId: string }
  | { kind: "detail"; analysisId: string };

export function AnalysesModal({
  api,
  target,
  provider,
  onClose,
  onChanged,
  onOpenConversation
}: {
  api: HeraclesRecordsApi | undefined;
  /** null is closed. */
  target: AnalysesModalTarget | null;
  provider: ChatProvider;
  onClose: () => void;
  /** Fired after any change, so the conversation header stays in step. */
  onChanged?: () => void;
  /** Opens the conversation a run wrote into, from the run log. */
  onOpenConversation?: (sessionId: string) => void;
}) {
  // An analysis is a paragraph of coaching instructions plus a trigger.
  // Clicking the backdrop while it holds edits does nothing — a stray click is
  // not a decision — and the deliberate ways out (the X, Escape, the detail's
  // Discard) ask first, as Coach settings does; a yes closes.
  const [editing, setEditing] = useState(false);
  /** The discard question is on screen. */
  const [confirming, setConfirming] = useState(false);
  /** Set by whichever screen is open, so it names itself up here. */
  const [title, setTitle] = useState<string | null>(null);

  const requestClose = useCallback(() => {
    if (editing) {
      setConfirming(true);
      return;
    }
    onClose();
  }, [editing, onClose]);

  useEffect(() => {
    if (!target) return;
    // The question takes Escape itself, in the capture phase.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirming) requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [target, confirming, requestClose]);

  // Reset when the modal is dismissed, so reopening never starts out guarded.
  useEffect(() => {
    if (!target) {
      setEditing(false);
      setConfirming(false);
      setTitle(null);
    }
  }, [target]);

  const handleEditingChange = useCallback((value: boolean) => {
    setEditing(value);
  }, []);

  if (!target) return null;

  return (
    <div
      className="chat-settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coach-analyses-title"
      onClick={editing ? undefined : onClose}
    >
      <section
        className="panel chat-settings-modal coach-analyses-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-settings-modal-header">
          {/* No back arrow beside the title. The modal holds one screen, so
              back and close were always the same move, and offering both put
              two ways out in one header. The X is the one that stays. */}
          <div className="chat-settings-modal-title">
            <Zap size={16} aria-hidden="true" />
            <h2 id="coach-analyses-title">{title ?? "Analysis"}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close analysis"
            onClick={requestClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div
          className={
            target.kind === "detail"
              ? "chat-settings-modal-body coach-analyses-modal-body is-detail"
              : "chat-settings-modal-body coach-analyses-modal-body"
          }
        >
          <AnalysesTitleProvider value={setTitle}>
            {target.kind === "create" ? (
              <AnalysisCreate
                api={api}
                provider={provider}
                sessionId={target.sessionId}
                onCancel={onClose}
                onCreated={async () => {
                  await onChanged?.();
                  onClose();
                }}
              />
            ) : (
              <AnalysisDetailView
                api={api}
                provider={provider}
                analysisId={target.analysisId}
                onBack={onClose}
                onChanged={() => onChanged?.()}
                onEditingChange={handleEditingChange}
                onDiscard={() => setConfirming(true)}
                {...(onOpenConversation ? { onOpenConversation } : {})}
              />
            )}
          </AnalysesTitleProvider>
        </div>
        {/* Portalled, so no ancestor's stacking holds it under the sheet;
            still inside the section in React's tree, whose stopPropagation
            keeps its clicks from reaching the backdrop. */}
        {confirming
          ? createPortal(
              <ConfirmDialog
                title="Discard unsaved changes?"
                description="Your edits to this analysis have not been saved. Discarding them closes the analysis."
                confirmLabel="Discard changes"
                cancelLabel="Keep editing"
                danger
                onConfirm={() => {
                  setConfirming(false);
                  onClose();
                }}
                onCancel={() => setConfirming(false)}
              />,
              document.body
            )
          : null}
      </section>
    </div>
  );
}
