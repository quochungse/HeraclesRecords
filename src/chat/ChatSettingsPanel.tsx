import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, ChevronRight, Loader2, TriangleAlert, X } from "lucide-react";
import type {
  ChatSettings,
  CoachAnalysisPause,
  CoachAnalysisSpend
} from "../../electron/types";
import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "../../electron/types";
import {
  DEFAULT_COMPACT_CONTEXT,
  MAX_CONTEXT_LIMIT,
  MIN_CONTEXT_GAP,
  MIN_CONTEXT_KEEP,
  normalizeContextWindow
} from "../../electron/chatContextCompaction";
import type { CorosLinkApi } from "../coroslink-api";
import { formatTokens } from "./analyses/analysisLabels";

export function ChatSettingsPanel({
  api,
  chatSettings,
  coachModelsSummary,
  onOpenCoachModels,
  onUpdateChatSettings
}: {
  api: CorosLinkApi | undefined;
  chatSettings: ChatSettings;
  /** One line describing what is connected, or null while it is being read. */
  coachModelsSummary: string | null;
  onOpenCoachModels: () => void;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => void;
}) {
  const savedCustomInstructions = chatSettings.customInstructions ?? "";
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState(
    savedCustomInstructions
  );

  useEffect(() => {
    setCustomInstructionsDraft(savedCustomInstructions);
  }, [savedCustomInstructions]);

  const commitCustomInstructions = () => {
    const next = customInstructionsDraft.trim();
    if (next === savedCustomInstructions) return;
    onUpdateChatSettings({ customInstructions: next });
  };

  const compactContext = chatSettings.compactContext ?? DEFAULT_COMPACT_CONTEXT;
  const compactEnabled = compactContext.enabled !== false;
  // Held as text so a half-typed number is not clamped out from under the
  // cursor: "1" on the way to "120" is a valid keystroke and an invalid window.
  const [limitDraft, setLimitDraft] = useState(String(compactContext.limit));
  const [keepDraft, setKeepDraft] = useState(String(compactContext.keep));

  useEffect(() => {
    setLimitDraft(String(compactContext.limit));
    setKeepDraft(String(compactContext.keep));
  }, [compactContext.limit, compactContext.keep]);

  const commitWindow = () => {
    // The same normaliser the store uses, so what the box snaps back to is
    // exactly what was saved rather than a second opinion about it.
    const next = normalizeContextWindow({
      limit: Number(limitDraft),
      keep: Number(keepDraft)
    });
    setLimitDraft(String(next.limit));
    setKeepDraft(String(next.keep));
    if (next.limit === compactContext.limit && next.keep === compactContext.keep) {
      return;
    }
    onUpdateChatSettings({ compactContext: { ...compactContext, ...next } });
  };

  const [baseInstructionsOpen, setBaseInstructionsOpen] = useState(false);
  const [baseInstructions, setBaseInstructions] = useState<string | null>(null);
  const [baseInstructionsError, setBaseInstructionsError] = useState<string | null>(
    null
  );

  const openBaseInstructions = async () => {
    setBaseInstructionsOpen(true);
    if (baseInstructions !== null) return;
    if (!api) {
      setBaseInstructionsError("Could not load the base coach instructions.");
      return;
    }
    setBaseInstructionsError(null);
    try {
      setBaseInstructions(await api.getBaseCoachInstructions());
    } catch {
      setBaseInstructionsError("Could not load the base coach instructions.");
    }
  };

  return (
    <div className="chat-settings-panel">
      <button
        className="settings-nav-row chat-settings-nav-row"
        type="button"
        onClick={onOpenCoachModels}
      >
        <span className="settings-nav-row-icon" aria-hidden="true">
          <BrainCircuit size={22} strokeWidth={1.9} />
        </span>
        <span className="settings-nav-row-copy">
          <strong>Coach Models</strong>
          <span>{coachModelsSummary ?? "Checking connections…"}</span>
        </span>
        <ChevronRight
          className="settings-storage-link-chevron"
          size={20}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      <section className="chat-settings-section">
        <h3>Display</h3>
        <label className="chat-local-tools">
          <input
            type="checkbox"
            checked={chatSettings.visualizationsEnabled === true}
            onChange={(event) =>
              onUpdateChatSettings({
                visualizationsEnabled: event.target.checked
              })
            }
          />
          <span>Show charts and activity visuals in chat</span>
        </label>
        <p className="chat-settings-copy">
          When off, heart rate trends, zone summaries, and activity charts are
          hidden. The coach still responds with text.
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>Coach instructions</h3>
        <p className="chat-settings-copy">
          Extra preferences appended to every coaching prompt — for example your
          goal race, training days, equipment, or preferred tone.
        </p>
        <p className="chat-settings-copy">
          Your custom instructions will be used in conjunction with the{" "}
          <button
            type="button"
            className="chat-inline-link"
            onClick={() => void openBaseInstructions()}
          >
            Base Coach instructions
          </button>
          .
        </p>
        <label className="chat-local-field">
          <span>Custom instructions</span>
          <textarea
            className="chat-custom-instructions"
            rows={5}
            maxLength={MAX_CUSTOM_COACH_INSTRUCTIONS}
            placeholder="e.g. I race a marathon in October, I can only run Tue/Thu/Sat, and I have no gym access."
            value={customInstructionsDraft}
            onChange={(event) => setCustomInstructionsDraft(event.target.value)}
            onBlur={commitCustomInstructions}
            onKeyDown={(event) => {
              // Escape closes the settings modal via a document listener
              // before blur can fire; save the draft first.
              if (event.key === "Escape") commitCustomInstructions();
            }}
          />
        </label>
        <p className="chat-settings-copy">
          {customInstructionsDraft.length}/{MAX_CUSTOM_COACH_INSTRUCTIONS} characters.
          Saved when you click outside the box.
        </p>
        {baseInstructionsOpen ? (
          <BaseCoachInstructionsDialog
            instructions={baseInstructions}
            error={baseInstructionsError}
            onClose={() => setBaseInstructionsOpen(false)}
          />
        ) : null}
      </section>

      <section className="chat-settings-section">
        <h3>Compact context</h3>
        <p className="chat-settings-copy">
          A conversation grows with every turn, and every turn sends the whole
          thing. Past a point the older turns are summarised into a running note
          and only the recent ones go over in full, so a year-old thread still
          costs about what a new one does. This trims what is sent — never the
          transcript, which stays complete on disk and on screen.
        </p>
        <p className="chat-settings-copy">
          The same window applies to your own messages and to scheduled coach
          runs, and the summary lives on the conversation, so whichever of the
          two rolls it, both use it.
        </p>
        <label className="chat-local-tools">
          <input
            type="checkbox"
            checked={compactEnabled}
            onChange={(event) =>
              onUpdateChatSettings({
                compactContext: {
                  ...compactContext,
                  enabled: event.target.checked
                }
              })
            }
          />
          <span>Compact long conversations automatically</span>
        </label>
        <div className="chat-compact-fields">
          <label className="chat-local-field">
            <span>Compact after</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_CONTEXT_KEEP + MIN_CONTEXT_GAP}
              max={MAX_CONTEXT_LIMIT}
              step={1}
              disabled={!compactEnabled}
              value={limitDraft}
              onChange={(event) => setLimitDraft(event.target.value)}
              onBlur={commitWindow}
              onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Enter") commitWindow();
              }}
            />
          </label>
          <label className="chat-local-field">
            <span>Keep in full</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_CONTEXT_KEEP}
              max={MAX_CONTEXT_LIMIT - MIN_CONTEXT_GAP}
              step={1}
              disabled={!compactEnabled}
              value={keepDraft}
              onChange={(event) => setKeepDraft(event.target.value)}
              onBlur={commitWindow}
              onKeyDown={(event) => {
                if (event.key === "Escape" || event.key === "Enter") commitWindow();
              }}
            />
          </label>
        </div>
        <p className="chat-settings-copy">
          Entries, not messages — a chart or a plan card counts as one. Once the
          conversation runs {compactContext.limit} entries past what the summary
          already covers, everything but the last {compactContext.keep} is folded
          into it. That leaves roughly{" "}
          {Math.max(1, Math.round((compactContext.limit - compactContext.keep) / 2))}{" "}
          exchanges between one summariser call and the next; a smaller gap
          between the two numbers means summarising more often, and a summary of
          a summary keeps less each time.
        </p>
        <p className="chat-settings-copy">
          Between {MIN_CONTEXT_KEEP + MIN_CONTEXT_GAP} and {MAX_CONTEXT_LIMIT},
          and &ldquo;compact after&rdquo; must stay at least {MIN_CONTEXT_GAP}{" "}
          above &ldquo;keep in full&rdquo;. Out-of-range values are pulled back
          into it when you click away. Compact one conversation right now from
          its &ldquo;⋯&rdquo; menu in the sidebar.
        </p>
      </section>

      <AnalysesSettingsSection api={api} />
    </div>
  );
}

/**
 * The two things about analyses that are not about any one analysis: what they
 * have cost this month, and whether they are all held.
 *
 * They live in Settings because that is what they are — feature-wide
 * preferences with no conversation to belong to. They used to sit at the top
 * of a screen that listed every analysis the athlete had; that screen went
 * when an analysis became something that lives in one conversation, and these
 * two would otherwise have gone with it.
 */
function AnalysesSettingsSection({ api }: { api: CorosLinkApi | undefined }) {
  const [pause, setPause] = useState<CoachAnalysisPause | null>(null);
  const [spend, setSpend] = useState<CoachAnalysisSpend | null>(null);
  const [resuming, setResuming] = useState(false);
  /** Held while the field is focused so typing is not fought by a re-render. */
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const [nextPause, nextSpend] = await Promise.all([
          api.getCoachAnalysisPause(),
          api.getCoachAnalysisSpend()
        ]);
        if (cancelled) return;
        setPause(nextPause);
        setSpend(nextSpend);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // The trip usually happens with no window open at all — a scheduled run
  // finding COROS asking for a login code at 07:30 — so this panel follows the
  // push rather than only reading once on mount.
  useEffect(() => {
    if (!api?.onCoachAnalysisPauseUpdate) return;
    return api.onCoachAnalysisPauseUpdate((next) => setPause(next));
  }, [api]);

  const commitBudget = async (raw: string) => {
    if (!api) return;
    setBudgetDraft(null);
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return;
    try {
      setSpend(await api.setCoachAnalysisBudget(parsed));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const resume = async () => {
    if (!api) return;
    setResuming(true);
    setError(null);
    try {
      setPause(await api.resumeCoachAnalyses());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setResuming(false);
    }
  };

  return (
    <section className="chat-settings-section">
      <h3>Analyses</h3>
      <p className="chat-settings-copy">
        An analysis runs on its own inside the conversation it was written in —
        create one from the Analyses control in a conversation&rsquo;s header.
        What is here applies to all of them at once.
      </p>

      {error ? <p className="coach-analysis-error">{error}</p> : null}

      {pause ? (
        <p className="coach-analysis-banner" role="status">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <strong>Every analysis is paused.</strong>{" "}
            {pause.reason === "budget" ? (
              <>
                This month&rsquo;s token budget ran out, so they stopped rather
                than spending past a number you set. They start again on the
                1st — or now, if you raise the budget below.
              </>
            ) : (
              <>
                COROS asked for a login code and no analysis can supply one, so
                they stopped rather than filling the run log with the same skip
                every fifteen minutes. Sign in to COROS, then resume.
              </>
            )}
          </span>
          <button
            type="button"
            className="chat-local-action"
            disabled={!api || resuming}
            onClick={() => void resume()}
          >
            {resuming ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : null}
            Resume
          </button>
        </p>
      ) : null}

      {spend ? (
        <p className="coach-analysis-spend">
          <span>
            <strong>
              {formatTokens(spend.inputTokens + spend.outputTokens)}
            </strong>{" "}
            tokens this month
            {/* A total that is short of the truth has to say so, or a budget
                reads as comfortably under when nobody actually knows. */}
            {spend.providerRuns > spend.countedRuns ? (
              <>
                {" · "}
                <span title="Some providers do not report what a turn cost.">
                  {spend.providerRuns - spend.countedRuns} run
                  {spend.providerRuns - spend.countedRuns === 1 ? "" : "s"} not
                  counted
                </span>
              </>
            ) : null}
          </span>
          <label className="chat-local-field coach-analysis-budget">
            {/* The unit is in the label rather than after the field: the
                placeholder reads "none", and a suffix would leave the
                unset state saying "none tokens". */}
            <span>Monthly budget (tokens)</span>
            <input
              type="number"
              min={0}
              step={1000}
              placeholder="none"
              disabled={!api}
              value={
                budgetDraft ??
                (spend.budget === null ? "" : String(spend.budget))
              }
              onChange={(event) => setBudgetDraft(event.target.value)}
              onBlur={(event) => void commitBudget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        </p>
      ) : null}
    </section>
  );
}

function BaseCoachInstructionsDialog({
  instructions,
  error,
  onClose
}: {
  instructions: string | null;
  error: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    // Capture phase so Escape closes this dialog without also closing the
    // settings modal, which listens on document in the bubble phase.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="chat-base-instructions-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-base-instructions-title"
      onClick={onClose}
    >
      <div
        className="panel chat-base-instructions-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-base-instructions-header">
          <h4 id="chat-base-instructions-title">Base Coach instructions</h4>
          <button
            type="button"
            className="icon-button"
            aria-label="Close base coach instructions"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-base-instructions-body">
          {error ? (
            <p className="chat-settings-copy">{error}</p>
          ) : instructions === null ? (
            <p className="chat-settings-copy">
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />{" "}
              Loading…
            </p>
          ) : (
            <pre>{instructions}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
