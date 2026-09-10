import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Play, Plus, Trash2, Zap } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type { CoachAnalysisSummary } from "../../../electron/types";
import { describeTrigger, formatTimeAgo } from "./analysisLabels";
import { announceRunNow } from "./runNow";

/** Section 2.2: the sixth analysis in one conversation is refused. */
const MAX_PER_SESSION = 5;

/**
 * The analyses of the open conversation, and the only place they are made.
 *
 * This used to be one of two entry points, mirroring a settings screen that
 * listed every analysis the athlete had. That screen is gone: an analysis
 * belongs to one conversation, so a list spanning all of them was a list of
 * things that had nothing to do with each other. What is left is here, beside
 * the conversation the analyses actually speak into.
 */
export function ConversationAnalyses({
  api,
  sessionId,
  refreshVersion = 0,
  onChanged,
  onCreateAnalysis,
  onOpenAnalysis
}: {
  api: CorosLinkApi | undefined;
  sessionId: string | null;
  /** Bumped by the detail screen so the rows follow what it changed. */
  refreshVersion?: number;
  /**
   * Creating, deleting or switching one off changes whether this conversation
   * has an analysis in it, and that is what the sidebar's ⚡ mark is (9.3).
   */
  onChanged?: () => void;
  /** Opens the create screen for this conversation. */
  onCreateAnalysis: () => void;
  /** Opens one analysis's own detail and settings screen. */
  onOpenAnalysis: (analysisId: string) => void;
}) {
  const [summaries, setSummaries] = useState<CoachAnalysisSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Covers the gap between the click and the run having a record of its own. */
  const [startingId, setStartingId] = useState<string | null>(null);
  /**
   * Analysis id → the run in flight for it, re-derived on every refresh rather
   * than accumulated from the pushes. Accumulating looked cheaper and was
   * wrong: switching conversations and back left the map holding runs that had
   * finished while the athlete was elsewhere. Runs are serialised
   * process-wide (5.4), so the query it replaces reads at most one row.
   */
  const [inFlightRuns, setInFlightRuns] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!api || !sessionId) {
      setSummaries([]);
      return;
    }
    try {
      const [rows, running] = await Promise.all([
        api.listCoachAnalysesForSession(sessionId),
        api.listCoachAnalysisRuns({ statuses: ["running"] })
      ]);
      setSummaries(rows);
      setInFlightRuns(
        Object.fromEntries(running.map((run) => [run.analysisId, run.id]))
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    // refreshVersion is not read in the body: it is here purely so the detail
    // screen can force a re-read by bumping it.
  }, [api, sessionId, refreshVersion]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Runs finish in the main process even with this view closed, so the rows
  // follow the push rather than polling.
  useEffect(() => {
    if (!api?.onCoachAnalysisRunUpdate) return;
    return api.onCoachAnalysisRunUpdate(() => {
      // Deliberately *not* clearing `startingId` here. A trigger can expand
      // into a sequence of runs, serialised (5.4), so between two of them
      // there is a moment with no `running` row at all — and a row that
      // cleared the flag on the first terminal update would offer Run now in
      // the middle of its own sequence. `startRun`'s `finally` is what clears
      // it, because that is what "the whole thing has answered" means.
      void refresh();
    });
  }, [api, refresh]);

  /**
   * An analysis can change with no run behind it: a slot booked by the
   * scheduler, guard rail 2 switching off one whose conversation is gone, or
   * an edit made on the detail screen over this popover.
   */
  useEffect(() => {
    if (!api?.onCoachAnalysisUpdate) return;
    return api.onCoachAnalysisUpdate((update) => {
      if (sessionId && update.sessionId !== sessionId) return;
      void refresh();
    });
  }, [api, refresh, sessionId]);

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
  const startRun = async (analysisId: string) => {
    if (!api) return;
    setStartingId(analysisId);
    setError(null);
    try {
      announceRunNow(await api.runCoachAnalysisNow(analysisId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStartingId((current) => (current === analysisId ? null : current));
      await refresh();
    }
  };

  const stopRun = async (runId: string) => {
    if (!api) return;
    setError(null);
    try {
      await api.cancelCoachAnalysisRun(runId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (!sessionId) return null;

  const sorted = [...summaries].sort(
    (a, b) => a.analysis.sortOrder - b.analysis.sortOrder
  );
  const liveCount = summaries.filter((row) => row.analysis.enabled).length;
  const full = summaries.length >= MAX_PER_SESSION;

  return (
    <div className="chat-coaches" ref={containerRef}>
      {/* A single chip, whatever is in the conversation: five separate chips
          crowded the header and told the athlete nothing they could not get
          by opening it. */}
      <button
        type="button"
        className="chat-coaches-pill"
        data-empty={summaries.length === 0 ? "true" : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title={
          liveCount
            ? `${liveCount} analysis${liveCount === 1 ? "" : "es"} in this conversation`
            : "No analyses in this conversation"
        }
      >
        <Zap size={13} aria-hidden="true" />
        Analyses
        {liveCount ? (
          <span className="chat-coaches-count">{liveCount}</span>
        ) : null}
      </button>

      {open ? (
        <div
          className="chat-coaches-panel"
          role="dialog"
          aria-label="Analyses in this conversation"
        >
          <div className="chat-coaches-panel-head">
            <strong>Analyses in this conversation</strong>
            <span>
              {liveCount}/{MAX_PER_SESSION}
            </span>
          </div>

          {error ? <p className="coach-analysis-error">{error}</p> : null}

          {summaries.length === 0 ? (
            <p className="chat-coaches-empty">
              Nothing runs here yet. An analysis reads your training and writes
              what it finds into this conversation — on a schedule, after an
              activity, or whenever you ask.
            </p>
          ) : (
            <ul className="chat-coaches-list">
              {sorted.map(({ analysis, lastRun }) => {
                const busy = busyId === analysis.id;
                const inFlight = inFlightRuns[analysis.id] ?? null;
                const starting = startingId === analysis.id;
                return (
                  <li
                    key={analysis.id}
                    className="chat-coaches-row"
                    data-off={analysis.enabled ? undefined : "true"}
                  >
                    <label
                      className="coach-analysis-switch chat-coaches-row-switch"
                      title={analysis.enabled ? "Running" : "Paused"}
                    >
                      <input
                        type="checkbox"
                        aria-label={
                          analysis.enabled
                            ? `Pause ${analysis.name}`
                            : `Resume ${analysis.name}`
                        }
                        checked={analysis.enabled}
                        disabled={busy || !api}
                        onChange={(event) =>
                          void withBusy(analysis.id, () =>
                            (api as CorosLinkApi).setCoachAnalysisEnabled(
                              analysis.id,
                              event.target.checked
                            )
                          )
                        }
                      />
                    </label>
                    <div className="chat-coaches-row-main">
                      <span className="chat-coaches-row-name">
                        <Zap size={12} aria-hidden="true" />
                        {analysis.name}
                      </span>
                      <span className="chat-coaches-row-meta">
                        {describeTrigger(analysis.trigger)}
                        {analysis.deviceOnly ? " · this device only" : ""}
                        {lastRun
                          ? ` · last run ${formatTimeAgo(lastRun.startedAt)}`
                          : " · never run"}
                      </span>
                    </div>
                    <div className="chat-coaches-row-actions">
                      {inFlight ? (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Stop this run"
                          title="Stop this run"
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
                          aria-label="Run now"
                          title="Run now"
                          disabled={busy || starting || !api}
                          onClick={() => void startRun(analysis.id)}
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
                      {/* The way into everything else this row cannot hold:
                          the playbook, the trigger, the run log. A popover is
                          the wrong shape for any of them. */}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Open ${analysis.name}`}
                        title="Details and settings"
                        onClick={() => {
                          setOpen(false);
                          onOpenAnalysis(analysis.id);
                        }}
                      >
                        <MoreHorizontal size={14} aria-hidden="true" />
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
              disabled={busyId !== null || !api || full}
              title={
                full
                  ? `A conversation can run at most ${MAX_PER_SESSION} analyses.`
                  : undefined
              }
              onClick={() => {
                setOpen(false);
                onCreateAnalysis();
              }}
            >
              <Plus size={13} aria-hidden="true" /> Create Auto Analysis
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
