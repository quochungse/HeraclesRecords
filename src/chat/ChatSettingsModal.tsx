import { useEffect, useState } from "react";
import { Settings2, X } from "lucide-react";
import type { ChatSettings } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { CoachModelsModal } from "../settings/CoachModelsModal";
import { ChatSettingsPanel } from "./ChatSettingsPanel";
import {
  coachModelsSummaryLine,
  summarizeCoachModels,
  type CoachModelsSummary
} from "./CoachModelsPanel";

export function ChatSettingsModal({
  api,
  open,
  chatSettings,
  onClose,
  onUpdateChatSettings
}: {
  api: CorosLinkApi | undefined;
  open: boolean;
  chatSettings: ChatSettings;
  onClose: () => void;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => void;
}) {
  const [coachModelsOpen, setCoachModelsOpen] = useState(false);
  const [coachModels, setCoachModels] = useState<CoachModelsSummary | null>(
    null
  );
  const [coachRefreshVersion, setCoachRefreshVersion] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    // Escape belongs to whichever dialog is on top. Both listen on the
    // document, so one calling stopPropagation would not spare the other —
    // this one stands down while the models dialog is open.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !coachModelsOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, coachModelsOpen, onClose]);

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
      onClick={onClose}
    >
      <section
        className="panel chat-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-settings-modal-header">
          <div className="chat-settings-modal-title">
            <Settings2 size={16} aria-hidden="true" />
            <h2 id="chat-settings-title">Settings</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-settings-modal-body">
          <ChatSettingsPanel
            api={api}
            chatSettings={chatSettings}
            coachModelsSummary={coachModelsSummaryLine(coachModels)}
            onOpenCoachModels={() => setCoachModelsOpen(true)}
            onUpdateChatSettings={onUpdateChatSettings}
          />
        </div>
      </section>

      <CoachModelsModal
        api={api}
        open={coachModelsOpen}
        onClose={() => setCoachModelsOpen(false)}
        onChange={() => setCoachRefreshVersion((version) => version + 1)}
      />
    </div>
  );
}
