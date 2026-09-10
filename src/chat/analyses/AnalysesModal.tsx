import { useCallback, useEffect, useState } from "react";
import { X, Zap } from "lucide-react";
import type { ChatProvider } from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import { AnalysisCreate } from "./AnalysisCreate";
import { AnalysisDetailView } from "./AnalysisDetail";
import { AnalysesTitleProvider } from "./analysesTitle";

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
  api: CorosLinkApi | undefined;
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
  // Clicking the backdrop — or tapping Escape — while writing one must not
  // discard it; the header's X and the screen's own Cancel stay as the
  // deliberate ways out.
  const [editing, setEditing] = useState(false);
  /** Set by whichever screen is open, so it names itself up here. */
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editing) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [target, editing, onClose]);

  // Reset when the modal is dismissed, so reopening never starts out guarded.
  useEffect(() => {
    if (!target) {
      setEditing(false);
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
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-settings-modal-body coach-analyses-modal-body">
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
                {...(onOpenConversation ? { onOpenConversation } : {})}
              />
            )}
          </AnalysesTitleProvider>
        </div>
      </section>
    </div>
  );
}
