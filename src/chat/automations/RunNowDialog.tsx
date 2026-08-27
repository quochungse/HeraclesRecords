import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Play, Sparkles, X } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type { CoachAutomationBindingView } from "../../../electron/types";
import { bindingModeLabel } from "./automationLabels";

/**
 * 3.4: a manual run from the automation screen picks which of the coach's
 * places to run in, defaulting to every live one. The card runs straight away
 * when there is only one place, so this opens only where the choice is real —
 * running everywhere is one model call and one conversation per place, which is
 * not something to spend on a mis-click.
 *
 * Paused places are listed rather than hidden, unticked. A manual run bypasses
 * the guard rails on purpose, so "run this one now even though it is paused" is
 * something the athlete can mean — but never by default.
 */
export function RunNowDialog({
  api,
  automationId,
  automationName,
  onClose,
  onRun
}: {
  api: CorosLinkApi | undefined;
  automationId: string;
  automationName: string;
  onClose: () => void;
  /** The chosen places. Starting the run and reporting it stay with the card. */
  onRun: (bindingIds: string[]) => void;
}) {
  const [bindings, setBindings] = useState<CoachAutomationBindingView[] | null>(
    null
  );
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .getCoachAutomation(automationId)
      .then((detail) => {
        if (cancelled || !detail) return;
        setBindings(detail.bindings);
        setChosen(
          new Set(
            detail.bindings
              .filter((binding) => binding.enabled)
              .map((binding) => binding.id)
          )
        );
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api, automationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggle = (bindingId: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(bindingId)) next.add(bindingId);
      return next;
    });
  };

  return (
    <div
      className="coach-automation-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-now-title"
      onClick={onClose}
    >
      <section
        className="panel coach-automation-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="coach-automation-dialog-header">
          <h3 id="run-now-title">Where should “{automationName}” run?</h3>
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
          {bindings === null ? (
            <p className="chat-settings-copy">
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />{" "}
              Loading…
            </p>
          ) : (
            <>
              <p className="chat-settings-copy">
                It runs in {bindings.length} places, and each one is its own
                model call with its own answer.
              </p>
              <ul className="coach-automation-session-list">
                {bindings.map((binding) => (
                  <li key={binding.id}>
                    <label className="coach-automation-session-row coach-automation-run-choice">
                      <input
                        type="checkbox"
                        checked={chosen.has(binding.id)}
                        onChange={() => toggle(binding.id)}
                      />
                      <span className="coach-automation-session-title">
                        {binding.mode === "per-run" ? (
                          <Sparkles size={13} aria-hidden="true" />
                        ) : (
                          <MessageSquare size={13} aria-hidden="true" />
                        )}
                        {bindingModeLabel(binding)}
                      </span>
                      <span className="coach-automation-session-meta">
                        {binding.sessionMissing
                          ? "conversation already deleted"
                          : !binding.enabled
                            ? "paused"
                            : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="coach-automation-confirm-actions">
          <button type="button" className="chat-local-action" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="chat-local-action"
            disabled={!api || chosen.size === 0}
            onClick={() => onRun([...chosen])}
          >
            <Play size={14} aria-hidden="true" />
            Run in {chosen.size} place{chosen.size === 1 ? "" : "s"}
          </button>
        </div>
      </section>
    </div>
  );
}
