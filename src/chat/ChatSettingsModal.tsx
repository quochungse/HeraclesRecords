import { useEffect, useMemo, useState } from "react";
import { Loader2, Settings2, X } from "lucide-react";
import type { ChatSettings, CoachAnalysisSpend } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { CoachModelsModal } from "../settings/CoachModelsModal";
import { ChatSettingsPanel } from "./ChatSettingsPanel";
import {
  coachModelsSummaryLine,
  summarizeCoachModels,
  type CoachModelsSummary
} from "./CoachModelsPanel";

/** The settings this dialog edits; everything else is saved elsewhere. */
type DraftKey = "visualizationsEnabled" | "inlineSuggestions" | "coachStyle" | "customInstructions" | "compactContext";
type SettingsDraft = Partial<Pick<ChatSettings, DraftKey>>;

/** `customInstructions` is stored trimmed, and an empty one is no instructions. */
function normalizeDraftValue<K extends DraftKey>(key: K, value: ChatSettings[K]): unknown {
  if (key === "customInstructions") return (value as string | undefined)?.trim() ?? "";
  return value;
}

/** The draft's keys that differ from what is saved: what Save would write. */
export function settingsDraftChanges(saved: ChatSettings, draft: SettingsDraft): SettingsDraft {
  const changes: SettingsDraft = {};
  for (const key of Object.keys(draft) as DraftKey[]) {
    const next = normalizeDraftValue(key, draft[key] as ChatSettings[typeof key]);
    const current = normalizeDraftValue(key, saved[key]);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      (changes as Record<string, unknown>)[key] = next;
    }
  }
  return changes;
}

/**
 * Coach's settings, edited as a draft and written on Save.
 *
 * Every control used to save the moment it changed, and the instructions box
 * when it lost focus — so a half-written instruction went into the next turn's
 * prompt, a style tried and not liked went out to every machine through sync
 * before it could be taken back, and there was no way back at all. Now the
 * dialog holds the edits, Discard throws them away, and closing with edits
 * held asks first. The Coach Models row opens a dialog that saves on its own,
 * and Resume is an action, not a setting; neither waits for Save.
 */
export function ChatSettingsModal({
  api,
  open,
  chatSettings,
  onClose,
  onSaveChatSettings,
  onCoachModelsChange
}: {
  api: CorosLinkApi | undefined;
  open: boolean;
  chatSettings: ChatSettings;
  onClose: () => void;
  /** Writes the changed settings; rejects when they could not be saved. */
  onSaveChatSettings: (patch: Partial<ChatSettings>) => Promise<void>;
  /**
   * The models dialog saved something or read a list again. Coach holds its
   * own copy of the settings — the composer's AI chip and every picker read
   * the lists from it — so it has to hear this, not only the summary here.
   */
  onCoachModelsChange?: () => void;
}) {
  const [coachModelsOpen, setCoachModelsOpen] = useState(false);
  const [coachModels, setCoachModels] = useState<CoachModelsSummary | null>(
    null
  );
  const [coachRefreshVersion, setCoachRefreshVersion] = useState(0);
  const [draft, setDraft] = useState<SettingsDraft>({});
  /** The monthly budget as edited; `undefined` while it is the saved one. */
  const [pendingBudget, setPendingBudget] = useState<number | null | undefined>(undefined);
  /** What the last Save's budget write answered, for the spend line to show. */
  const [savedSpend, setSavedSpend] = useState<CoachAnalysisSpend | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  // Every opening starts from what is saved.
  useEffect(() => {
    if (!open) return;
    setDraft({});
    setPendingBudget(undefined);
    setSaveError(null);
    setConfirmingClose(false);
  }, [open]);

  const changes = useMemo(() => settingsDraftChanges(chatSettings, draft), [chatSettings, draft]);
  const dirty = Object.keys(changes).length > 0 || pendingBudget !== undefined;
  const shownSettings = useMemo(() => ({ ...chatSettings, ...draft }), [chatSettings, draft]);

  const discard = () => {
    setDraft({});
    setPendingBudget(undefined);
    setSaveError(null);
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (Object.keys(changes).length > 0) await onSaveChatSettings(changes);
      if (pendingBudget !== undefined && api) {
        setSavedSpend(await api.setCoachAnalysisBudget(pendingBudget));
      }
      setDraft({});
      setPendingBudget(undefined);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not save Coach settings.");
    } finally {
      setSaving(false);
    }
  };

  /** Close, or ask first when there are edits a close would throw away. */
  const requestClose = () => {
    if (dirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    // Escape belongs to whichever dialog is on top. Both listen on the
    // document, so one calling stopPropagation would not spare the other —
    // this one stands down while the models dialog is open, and steps back
    // from the discard question before it closes anything.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || coachModelsOpen) return;
      if (confirmingClose) {
        setConfirmingClose(false);
        return;
      }
      requestClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    if (!open || !api) {
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const [chatSettings, authStatus, claudeStatus] = await Promise.all([
          api.getChatSettings(),
          api.getChatAuthStatus(),
          api.getClaudeCodeStatus()
        ]);
        if (!cancelled) {
          setCoachModels(
            summarizeCoachModels(chatSettings, authStatus, claudeStatus)
          );
        }
      } catch {
        if (!cancelled) setCoachModels(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, open, coachRefreshVersion]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="chat-settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-settings-title"
      onClick={requestClose}
    >
      <section
        className="panel chat-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-settings-modal-header">
          <div className="chat-settings-modal-title">
            <Settings2 size={16} aria-hidden="true" />
            {/* Coach's own, as the gear that opens it says: the app has a
                Settings screen of its own, and this is not it. */}
            <h2 id="chat-settings-title">Coach settings</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            onClick={requestClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-settings-modal-body">
          <ChatSettingsPanel
            api={api}
            chatSettings={shownSettings}
            coachModelsSummary={coachModelsSummaryLine(coachModels)}
            onOpenCoachModels={() => setCoachModelsOpen(true)}
            onUpdateChatSettings={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            pendingBudget={pendingBudget}
            onPendingBudgetChange={setPendingBudget}
            savedSpend={savedSpend}
          />
        </div>
        <footer className="app-modal-footer chat-settings-modal-footer">
          {confirmingClose ? (
            <>
              <span className="chat-settings-footer-status" role="alert">
                Discard your unsaved changes?
              </span>
              <button
                type="button"
                className="secondary-button"
                autoFocus
                onClick={() => setConfirmingClose(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="secondary-button chat-settings-discard-close"
                onClick={() => {
                  discard();
                  onClose();
                }}
              >
                Discard and close
              </button>
            </>
          ) : (
            <>
              <span className="chat-settings-footer-status" role="status">
                {saveError ?? (dirty ? "Unsaved changes" : "All changes saved")}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={!dirty || saving}
                onClick={discard}
              >
                Discard
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : null}
                Save
              </button>
            </>
          )}
        </footer>
      </section>

      <CoachModelsModal
        api={api}
        open={coachModelsOpen}
        onClose={() => setCoachModelsOpen(false)}
        onChange={() => {
          setCoachRefreshVersion((version) => version + 1);
          onCoachModelsChange?.();
        }}
      />
    </div>
  );
}
