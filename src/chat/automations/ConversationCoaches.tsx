import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Plus, Trash2, Zap } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type {
  CoachAutomationBindingView,
  CoachAutomationSummary
} from "../../../electron/types";
import { describeTrigger, formatTimeAgo } from "./automationLabels";
import { AttachCoachToConversationDialog } from "./AttachCoachToConversationDialog";
import { announceRunNow } from "./runNow";

/** Section 2.2: a conversation runs at most five automations. */
const MAX_PER_SESSION = 5;

/**
 * The coaches attached to the open conversation, plus the popover to manage
 * them. This is the second entry point into the binding model and the one most
 * athletes will use, so it mirrors the settings screen rather than replacing it.
 */
export function ConversationCoaches({
  api,
  sessionId,
  refreshVersion = 0,
  onChanged,
  onManageAutomations
}: {
  api: CorosLinkApi | undefined;
  sessionId: string | null;
  /** Bumped by the Automations screen so the chips follow what it changed. */
  refreshVersion?: number;
  /**
   * Attaching, detaching or switching a coach off changes which conversations
   * a coach speaks into, and that is what the sidebar's ⚡ mark is (9.3). This
   * popover is the entry point most athletes use, and it was the only one with
   * no way to say it had changed anything, so the mark did not move until the
   * app was restarted.
   */
  onChanged?: () => void;
  onManageAutomations: () => void;
}) {
  const [bindings, setBindings] = useState<CoachAutomationBindingView[]>([]);
  const [automations, setAutomations] = useState<CoachAutomationSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Covers the gap between the click and the run having a record of its own. */
  const [startingId, setStartingId] = useState<string | null>(null);
  /**
   * Binding id → the run in flight for it, re-derived on every refresh rather
   * than accumulated from the pushes. Accumulating looked cheaper and was
   * wrong twice over: the terminal update for a `per-run` binding names the
   * conversation the run *created*, not this one, so the entry was never
   * cleared; and switching conversations and back left the map holding runs
   * that had finished while the athlete was elsewhere. Runs are serialised
   * process-wide (5.4), so the query it replaces reads at most one row.
   */
  const [inFlightRuns, setInFlightRuns] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!api || !sessionId) {
      setBindings([]);
      return;
    }
    try {
      // The chips need the automation's name, which a binding does not carry.
      const [attached, all, running] = await Promise.all([
        api.listCoachAutomationsForSession(sessionId),
        api.listCoachAutomations(),
        api.listCoachAutomationRuns({ statuses: ["running"] })
      ]);
      setBindings(attached);
      setAutomations(all);
      setInFlightRuns(
        Object.fromEntries(running.map((run) => [run.bindingId, run.id]))
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    // refreshVersion is not read in the body: it is here purely so the
    // Automations screen can force a re-read by bumping it.
  }, [api, sessionId, refreshVersion]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Runs finish in the main process even with this view closed, so the chips
  // follow the push rather than polling.
  useEffect(() => {
    if (!api?.onCoachAutomationRunUpdate) return;
    return api.onCoachAutomationRunUpdate((run) => {
      // Deliberately unfiltered. A `per-run` binding attached *here* runs into
      // a conversation of its own, so filtering on this one's session id threw
      // away every update about the rows on screen. Runs are rare enough that
      // one extra read costs nothing next to being wrong.
      setStartingId((current) => (current === run.bindingId ? null : current));
      void refresh();
    });
  }, [api, refresh]);

  // A binding can change with no run behind it: guard rail 2 breaks one whose
  // conversation the athlete deleted, and a `dedicated` binding adopts the
  // conversation it just rebuilt. Both are rows in this popover.
  useEffect(() => {
    if (!api?.onCoachAutomationBindingUpdate) return;
    return api.onCoachAutomationBindingUpdate(() => {
      void refresh();
    });
  }, [api, refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const withBusy = async (id: string, work: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await work();
      await refresh();
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Not `withBusy`: a run resolves only once it has finished, and this popover
   * is closed long before that. Anchoring the button to the promise left the
   * spinner up the next time the athlete opened it, on a run that had ended.
   */
  const startRun = async (binding: CoachAutomationBindingView) => {
    if (!api) return;
    setStartingId(binding.id);
    setError(null);
    try {
      announceRunNow(
        await api.runCoachAutomationNow(binding.automationId, [binding.id])
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStartingId((current) => (current === binding.id ? null : current));
      await refresh();
    }
  };

  /**
    * The way out of a run that is taking longer than the athlete wants to wait.
    * It ends the whole trigger, not this conversation's share of it (10) — the
    * same run is on its way to wherever else the coach is attached, and this
    * popover cannot see those rows to stop them one by one.
    */
  const stopRun = async (runId: string) => {
    if (!api) return;
    setError(null);
    try {
      await api.cancelCoachAutomationRun(runId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const move = (binding: CoachAutomationBindingView, delta: number) => {
    if (!api || !sessionId) return;
    const ordered = [...bindings].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((entry) => entry.id === binding.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    void withBusy(binding.id, () =>
      api.reorderCoachAutomationBindings(
        sessionId,
        ordered.map((entry) => entry.id)
      )
    );
  };

  if (!sessionId) return null;

  const sorted = [...bindings].sort((a, b) => a.sortOrder - b.sortOrder);
  const automationOf = (automationId: string) =>
    automations.find((entry) => entry.automation.id === automationId)?.automation;
  /**
   * A binding only runs when its own switch AND the automation's master switch
   * are on, which is what the runner checks. The UI has to show the same thing
   * or an athlete reads "on" beside a coach that will never fire.
   */
  const isLive = (binding: CoachAutomationBindingView) =>
    binding.enabled && automationOf(binding.automationId)?.enabled !== false;
  const liveCount = bindings.filter((binding) => isLive(binding)).length;

  return (
    <div className="chat-coaches" ref={containerRef}>
      {/* A single chip, whatever is attached: five separate chips crowded the
          header and told the athlete nothing they could not get by opening it. */}
      <button
        type="button"
        className="chat-coaches-pill"
        data-empty={bindings.length === 0 ? "true" : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title={
          liveCount
            ? `${liveCount} automation${liveCount === 1 ? "" : "s"} run in this conversation`
            : "No automations run in this conversation"
        }
      >
        <Zap size={13} aria-hidden="true" />
        Automation Coaches
        {liveCount ? (
          <span className="chat-coaches-count">{liveCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="chat-coaches-panel" role="dialog" aria-label="Manage coaches">
          <div className="chat-coaches-panel-head">
            <strong>Coaches in this conversation</strong>
            <span>
              {liveCount}/{MAX_PER_SESSION}
            </span>
          </div>

          {error ? <p className="coach-automation-error">{error}</p> : null}

          {bindings.length === 0 ? (
            <p className="chat-coaches-empty">
              No automation writes into this conversation yet.
            </p>
          ) : (
            <ul className="chat-coaches-list">
              {sorted.map((binding, index, all) => {
                  const summary = automations.find(
                    (entry) => entry.automation.id === binding.automationId
                  );
                  const busy = busyId === binding.id;
                  const inFlight = inFlightRuns[binding.id] ?? null;
                  const starting = startingId === binding.id;
                  const name = summary?.automation.name ?? "Automation";
                  const masterOff = summary?.automation.enabled === false;
                  const live = isLive(binding);
                  return (
                    <li
                      key={binding.id}
                      className="chat-coaches-row"
                      data-off={live ? undefined : "true"}
                    >
                      <label
                        className="coach-automation-switch chat-coaches-row-switch"
                        title={
                          masterOff
                            ? `${name} is switched off everywhere. Turn it on from Manage automations.`
                            : live
                              ? "Running here"
                              : "Paused here"
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label={
                            live
                              ? `Pause ${name} in this conversation`
                              : `Resume ${name} in this conversation`
                          }
                          checked={live}
                          disabled={busy || !api || masterOff}
                          onChange={(event) =>
                            void withBusy(binding.id, () =>
                              (api as CorosLinkApi).setCoachAutomationBindingEnabled(
                                binding.id,
                                event.target.checked
                              )
                            )
                          }
                        />
                      </label>
                      <div className="chat-coaches-row-main">
                        <span className="chat-coaches-row-name">
                          <Zap size={12} aria-hidden="true" />
                          {summary?.automation.name ?? "Automation"}
                        </span>
                        <span className="chat-coaches-row-meta">
                          {summary
                            ? describeTrigger(summary.automation.trigger)
                            : "—"}
                          {binding.lastRunAt
                            ? ` · last run ${formatTimeAgo(binding.lastRunAt)}`
                            : " · never run"}
                        </span>
                      </div>
                      <div className="chat-coaches-row-actions">
                        {/* Order only matters once several coaches share the
                            conversation: they run sequentially in it. */}
                        {all.length > 1 ? (
                          <>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Run earlier"
                              disabled={busy || index === 0}
                              onClick={() => move(binding, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Run later"
                              disabled={busy || index === all.length - 1}
                              onClick={() => move(binding, 1)}
                            >
                              ↓
                            </button>
                          </>
                        ) : null}
                        {inFlight ? (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Stop — here and everywhere else this run's automation is going"
                            title="Stop — here and everywhere else this run's automation is going"
                            disabled={!api}
                            onClick={() => void stopRun(inFlight)}
                          >
                            <Loader2
                              className="chat-spinner"
                              size={14}
                              aria-hidden="true"
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Run now here"
                            title="Run now here"
                            disabled={busy || starting || !api}
                            onClick={() => void startRun(binding)}
                          >
                            {starting ? (
                              <Loader2
                                className="chat-spinner"
                                size={14}
                                aria-hidden="true"
                              />
                            ) : (
                              <Play size={14} aria-hidden="true" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Detach"
                          title="Detach — this conversation is kept"
                          disabled={busy || !api}
                          onClick={() =>
                            void withBusy(binding.id, () =>
                              (api as CorosLinkApi).detachCoachAutomation(binding.id)
                            )
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}

          <div className="chat-coaches-panel-foot">
            <button
              type="button"
              className="chat-coaches-attach"
              disabled={busyId !== null || !api}
              onClick={() => setAttachOpen(true)}
            >
              <Plus size={13} aria-hidden="true" /> Attach Automation Coach
            </button>
            <button
              type="button"
              className="chat-coaches-manage"
              onClick={() => {
                setOpen(false);
                onManageAutomations();
              }}
            >
              Manage automations
            </button>
          </div>
        </div>
      ) : null}

      {attachOpen && sessionId ? (
        <AttachCoachToConversationDialog
          api={api}
          sessionId={sessionId}
          attached={bindings}
          onClose={() => setAttachOpen(false)}
          onAttached={async () => {
            await refresh();
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
