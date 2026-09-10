import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, Trash2 } from "lucide-react";
import type { CorosLinkApi } from "../../coroslink-api";
import type {
  ChatProvider,
  CoachAnalysis,
  CoachAnalysisInput,
  CoachAnalysisRun
} from "../../../electron/types";
import { AnalysisDefinitionForm } from "./AnalysisDefinitionForm";
import { TriggerForm, type TriggerDraft } from "./TriggerForm";
import { useAnalysesTitle } from "./analysesTitle";
import { DeleteAnalysisDialog } from "./DeleteAnalysisDialog";
import {
  formatDuration,
  formatRunTokens,
  formatTimeAgo,
  runStatusLabel,
  skipReasonLabel
} from "./analysisLabels";

/**
 * One analysis: what it says, when it runs, and what it has done.
 *
 * Two tabs, where there were three. "Where it runs" is gone with the model
 * that needed it — an analysis lives in the conversation it was written in and
 * cannot be moved, so a tab listing one row that can never change said nothing
 * a person would open a tab for.
 */
type Tab = "settings" | "runs";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "settings", label: "Settings" },
  { id: "runs", label: "Run log" }
];

type Draft = Omit<CoachAnalysisInput, "sessionId">;

/**
 * The fields this screen edits. `enabled` is deliberately left out: the switch
 * lives on the conversation's own row, and sending a stale copy of it back
 * with a save would silently flip it.
 */
function toInput(analysis: CoachAnalysis): Draft {
  return {
    name: analysis.name,
    playbook: analysis.playbook,
    runtime: analysis.runtime,
    ...(analysis.role ? { role: analysis.role } : {}),
    ...(analysis.presetId ? { presetId: analysis.presetId } : {})
  };
}

function toTriggerDraft(analysis: CoachAnalysis): TriggerDraft {
  return {
    trigger: analysis.trigger,
    conditions: analysis.conditions,
    deviceOnly: analysis.deviceOnly
  };
}

/**
 * A stable serialisation for telling an edited form from an untouched one.
 * Key order and empty optional fields are normalized away: typing into Role
 * and clearing it again leaves `role: ""` where the stored value simply has no
 * role, which a plain JSON compare would report as a change.
 */
function fingerprint(input: Draft, trigger: TriggerDraft): string {
  const trimmed = (value: string | undefined) => value?.trim() || undefined;
  return JSON.stringify({
    name: trimmed(input.name),
    role: trimmed(input.role),
    playbook: trimmed(input.playbook),
    presetId: trimmed(input.presetId),
    runtime: {
      provider: input.runtime?.provider ?? null,
      model: trimmed(input.runtime?.model) ?? null,
      effort: input.runtime?.effort ?? null
    },
    trigger: trigger.trigger,
    conditions: {
      cooldownMin: trigger.conditions.cooldownMin,
      maxRunsPerDay: trigger.conditions.maxRunsPerDay,
      quietHours: trigger.conditions.quietHours ?? null
    },
    deviceOnly: trigger.deviceOnly
  });
}

export function AnalysisDetailView({
  api,
  provider,
  analysisId,
  initialTab = "settings",
  onBack,
  onChanged,
  onEditingChange,
  onOpenConversation
}: {
  api: CorosLinkApi | undefined;
  provider: ChatProvider;
  analysisId: string;
  initialTab?: Tab;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  /** Guards the modal's backdrop while there are unsaved edits. */
  onEditingChange?: (editing: boolean) => void;
  /**
   * Opens the conversation a run wrote into. The run log says what the
   * analysis found; reading it is the obvious next thing to do, and the answer
   * lives one screen away behind a modal covering it.
   */
  onOpenConversation?: (sessionId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [analysis, setAnalysis] = useState<CoachAnalysis | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [trigger, setTrigger] = useState<TriggerDraft | null>(null);
  /** The last-saved state, to tell an edited form from an untouched one. */
  const [saved, setSaved] = useState<string | null>(null);
  const [runs, setRuns] = useState<CoachAnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so `refresh` does not change identity when the parent
  // re-renders — the conversation behind this refreshes on every run update,
  // which would otherwise refetch this screen each time.
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const stored = await api.getCoachAnalysis(analysisId);
      if (!stored) {
        onBackRef.current();
        return;
      }
      setAnalysis(stored);
      const input = toInput(stored);
      const triggerDraft = toTriggerDraft(stored);
      setSaved(fingerprint(input, triggerDraft));
      setDraft((current) => current ?? input);
      setTrigger((current) => current ?? triggerDraft);
      setRuns(await api.listCoachAnalysisRuns({ analysisId, limit: 50 }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [api, analysisId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A run started from here finishes in the main process, so the screen
  // follows the push rather than polling for it.
  useEffect(() => {
    if (!api?.onCoachAnalysisRunUpdate) return;
    return api.onCoachAnalysisRunUpdate((run) => {
      if (run.analysisId !== analysisId) return;
      setRuns((previous) => [
        run,
        ...previous.filter((entry) => entry.id !== run.id)
      ]);
    });
  }, [api, analysisId]);

  /**
   * The analysis changing under this screen — switched off from the
   * conversation behind it, deleted from a second surface, or a slot booked by
   * the scheduler.
   *
   * `draft` is deliberately untouched: the athlete may be part-way through a
   * playbook, and nothing about someone else's edit justifies discarding what
   * they have typed. `saved` moves, which is what makes the form show itself
   * as edited against what is actually stored.
   */
  useEffect(() => {
    if (!api?.onCoachAnalysisUpdate) return;
    return api.onCoachAnalysisUpdate((update) => {
      if (update.analysisId !== analysisId) return;
      // Deleted: there is nothing left for this screen to be about.
      if (!update.analysis) {
        onBackRef.current();
        return;
      }
      setAnalysis(update.analysis);
      setSaved(
        fingerprint(toInput(update.analysis), toTriggerDraft(update.analysis))
      );
    });
  }, [api, analysisId]);

  const dirty =
    saved !== null &&
    draft !== null &&
    trigger !== null &&
    fingerprint(draft, trigger) !== saved;

  // The modal's backdrop stops dismissing while there is something to lose.
  useEffect(() => {
    onEditingChange?.(dirty);
    return () => onEditingChange?.(false);
  }, [dirty, onEditingChange]);

  const save = async () => {
    if (!api || !draft || !trigger) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateCoachAnalysis(analysisId, {
        ...draft,
        trigger: trigger.trigger,
        conditions: trigger.conditions,
        deviceOnly: trigger.deviceOnly
      });
      // The store clamps and normalizes, so show what was stored rather than
      // leaving the form displaying a value that was never accepted.
      if (result) {
        const input = toInput(result);
        const triggerDraft = toTriggerDraft(result);
        setDraft(input);
        setTrigger(triggerDraft);
        setSaved(fingerprint(input, triggerDraft));
      }
      await refresh();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
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

  useAnalysesTitle(analysis?.name ?? "Analysis");

  if (loading || !analysis || !draft || !trigger) {
    return (
      <div className="coach-analysis-detail">
        <p className="chat-settings-copy">
          <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> Loading…
        </p>
      </div>
    );
  }

  const complete = draft.name.trim().length > 0 && draft.playbook.trim().length > 0;
  const inFlight = runs.find((run) => run.status === "running") ?? null;

  return (
    <div className="coach-analysis-detail">
      <nav className="coach-analysis-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className="coach-analysis-tab"
            data-active={tab === entry.id ? "true" : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
        {/* No "Run now" here. It sits on the analysis's own row in the
            conversation, one click from where the answer will appear, and a
            second copy behind a modal only made it possible to start the same
            run twice. Stop stays: it is only ever offered while a run this
            screen is showing is in flight, and there is nothing to duplicate
            about ending it. */}
        {inFlight ? (
          <div className="coach-analysis-detail-actions">
            <button
              type="button"
              className="chat-local-action"
              disabled={!api}
              title="Stop this run"
              onClick={() => void stopRun(inFlight.id)}
            >
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              Stop
            </button>
          </div>
        ) : null}
      </nav>

      {error ? <p className="coach-analysis-error">{error}</p> : null}

      {tab === "settings" ? (
        <div className="coach-analysis-tabpanel">
          <AnalysisDefinitionForm
            draft={draft}
            provider={provider}
            disabled={saving}
            onChange={(patch) =>
              setDraft((current) => (current ? { ...current, ...patch } : current))
            }
          />

          <TriggerForm draft={trigger} disabled={saving} onChange={setTrigger} />

          <div className="coach-analysis-save-row">
            {/* The label and the enabled state must answer to the same
                condition. Driving the label off `dirty` alone left the button
                reading "Save changes" while still greyed out because the
                playbook was empty, with nothing on screen saying why. */}
            {!complete ? (
              <span className="coach-analysis-save-reason">
                A name and a playbook are required before this can be saved.
              </span>
            ) : null}
            <button
              type="button"
              className="primary-button"
              disabled={saving || !dirty || !complete}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : null}
              {dirty || !complete ? "Save changes" : "Saved"}
            </button>
          </div>

          <div className="coach-analysis-danger-zone">
            <div>
              <strong>Delete this analysis</strong>
              <p>
                The conversation and everything it already wrote there are kept.
              </p>
            </div>
            <button
              type="button"
              className="chat-local-action is-danger"
              disabled={saving || !api}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete
            </button>
          </div>
        </div>
      ) : null}

      {tab === "runs" ? (
        <div className="coach-analysis-tabpanel">
          {/* No filter. Every run belongs to this analysis and lands in the
              one conversation it lives in, so there was nothing left to
              filter by once "where it runs" became a single answer. */}
          {runs.length === 0 ? (
            <p className="chat-settings-copy">
              No runs yet. Every run is logged here, including the ones that
              found nothing to report.
            </p>
          ) : (
            <ul className="coach-analysis-run-list">
              {runs.map((run) => {
                // Whatever conversation the run names — a skip records the one
                // it would have written into, and that is still the place the
                // athlete would go to see why nothing arrived. Whether it
                // still exists is settled on the way out, not here.
                const opensInto = onOpenConversation ? run.sessionId : undefined;
                const runTokens = formatRunTokens(run);
                const body = (
                  <>
                    <span
                      className="coach-analysis-run-status"
                      data-status={run.status}
                    >
                      {runStatusLabel(run)}
                    </span>
                    <div className="coach-analysis-run-body">
                      <span className="coach-analysis-run-summary">
                        {run.summary ??
                          (run.skipReason
                            ? `Skipped — ${skipReasonLabel(run.skipReason)}`
                            : run.error ?? "—")}
                      </span>
                      <span className="coach-analysis-run-meta">
                        {formatTimeAgo(run.startedAt)} · {formatDuration(run)}
                        {run.model ? ` · ${run.model}` : ""}
                        {run.effort ? ` · effort ${run.effort}` : ""}
                        {/* 13. Absent rather than zero when the provider
                            reported nothing: a run whose cost nobody knows
                            must not read as a free one. */}
                        {runTokens ? ` · ${runTokens} tokens` : ""}
                      </span>
                    </div>
                    {opensInto ? (
                      <ChevronRight
                        className="coach-analysis-run-open-icon"
                        size={15}
                        aria-hidden="true"
                      />
                    ) : null}
                  </>
                );

                return (
                  <li key={run.id}>
                    {opensInto ? (
                      <button
                        type="button"
                        className="coach-analysis-run-row coach-analysis-run-open"
                        title="Open the conversation this run wrote into"
                        onClick={() => onOpenConversation?.(opensInto)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="coach-analysis-run-row">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {deleteOpen ? (
        <DeleteAnalysisDialog
          api={api}
          analysisId={analysisId}
          analysisName={analysis.name}
          onClose={() => setDeleteOpen(false)}
          onDeleted={async () => {
            setDeleteOpen(false);
            await onChanged();
            onBack();
          }}
        />
      ) : null}
    </div>
  );
}
