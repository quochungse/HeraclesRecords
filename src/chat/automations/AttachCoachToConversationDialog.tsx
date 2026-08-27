import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X, Zap } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type {
  CoachAutomationBindingView,
  CoachAutomationSummary
} from "../../../electron/types";
import { describeTrigger } from "./automationLabels";

/** Section 2.2: a conversation runs at most five automations. */
const MAX_PER_SESSION = 5;

/**
 * Picking a coach to add to the open conversation. Kept as its own screen
 * rather than a list inside the Manage popover: the popover is about what is
 * already running here, and stacking every available automation underneath it
 * buries that.
 */
export function AttachCoachToConversationDialog({
  api,
  sessionId,
  attached,
  onClose,
  onAttached
}: {
  api: CorosLinkApi | undefined;
  sessionId: string;
  attached: CoachAutomationBindingView[];
  onClose: () => void;
  onAttached: () => void | Promise<void>;
}) {
  const [automations, setAutomations] = useState<CoachAutomationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .listCoachAutomations()
      .then((list) => {
        if (!cancelled) setAutomations(list);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const attachedIds = useMemo(
    () => new Set(attached.map((binding) => binding.automationId)),
    [attached]
  );
  const full = attached.length >= MAX_PER_SESSION;

  const attach = async (automationId: string) => {
    if (!api) return;
    setBusyId(automationId);
    setError(null);
    try {
      const result = await api.attachCoachAutomation({
        automationId,
        mode: "existing",
        sessionId
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onAttached();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="coach-automation-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attach-coach-title"
      onClick={onClose}
    >
      <section
        className="panel coach-automation-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="coach-automation-dialog-header">
          <h3 id="attach-coach-title">Attach an automation coach</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {error ? <p className="coach-automation-error">{error}</p> : null}

        <div className="coach-automation-dialog-body">
          {full ? (
            <p className="chat-settings-copy">
              This conversation already runs {MAX_PER_SESSION} automations, the
              maximum. Detach one before adding another.
            </p>
          ) : null}

          {loading ? (
            <p className="chat-settings-copy">
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />{" "}
              Loading automations…
            </p>
          ) : automations.length === 0 ? (
            <p className="chat-settings-copy">
              No automations yet. Create one from Manage automations first.
            </p>
          ) : (
            <ul className="coach-automation-session-list">
              {automations.map((summary) => {
                const { automation } = summary;
                const already = attachedIds.has(automation.id);
                const busy = busyId === automation.id;
                const disabled = already || full || busy || !api;
                // The reason is spelled out beside the row, so a row that
                // cannot be used never reads as a broken button.
                const reason = already
                  ? "Already running here"
                  : full
                    ? "Conversation is full"
                    : !automation.enabled
                      ? "Switched off"
                      : describeTrigger(automation.trigger);

                return (
                  <li key={automation.id}>
                    <button
                      type="button"
                      className="coach-automation-session-row"
                      data-disabled={disabled ? "true" : undefined}
                      disabled={disabled}
                      onClick={() => void attach(automation.id)}
                    >
                      <span className="coach-automation-session-title">
                        {busy ? (
                          <Loader2
                            className="chat-spinner"
                            size={13}
                            aria-hidden="true"
                          />
                        ) : (
                          <Zap size={13} aria-hidden="true" />
                        )}{" "}
                        {automation.name}
                      </span>
                      <span className="coach-automation-session-meta">
                        {reason}
                        {!disabled ? (
                          <Plus size={13} aria-hidden="true" />
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
