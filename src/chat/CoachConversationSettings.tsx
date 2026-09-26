import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type {
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  ConversationSettings
} from "../../electron/types";
import { GeneratorProviderPanel } from "../training-library/GeneratorProviderPanel";
import { SOURCES } from "../training-library/planGeneratorModel";
import {
  requestRuntime,
  runtimeFromSettings,
  type GeneratorRuntime
} from "../training-library/planGeneratorRuntime";
import "../training-library/trainingLibrary.css";

/**
 * What one conversation reads, and which AI answers it (docs/coach-plan-canvas.md,
 * P2.0, D13/D14) — for every turn in it, and for the analyses running in it.
 * The switches and the AI sheet are the plan generator's own: a source switched
 * off is withheld from every tool that reads it and from the snapshot, not
 * merely left out of the prompt, and the AI sends only what differs from
 * Coach's settings.
 *
 * Loaded when first opened, with the library's stylesheet its sheets are drawn by.
 */
export default function CoachConversationSettings(props: SettingsProps & { portal?: boolean }) {
  const { portal, ...rest } = props;
  const sheet: ReactNode = (
    <div className="coach-conversation-sheet">
      <ConversationSettingsSheet {...rest} />
    </div>
  );
  return portal ? createPortal(sheet, document.body) : sheet;
}

interface SettingsProps {
  chatSettings: ChatSettings;
  conversation: ConversationSettings;
  readiness: Partial<Record<ChatProvider, boolean>>;
  claudeStatus: ClaudeCodeStatus | null;
  onChange: (next: ConversationSettings) => void;
  onClose: () => void;
  onOpenCoachSettings: () => void;
}

function ConversationSettingsSheet({
  chatSettings,
  conversation,
  readiness,
  claudeStatus,
  onChange,
  onClose,
  onOpenCoachSettings
}: SettingsProps) {
  const [choosingAi, setChoosingAi] = useState(false);
  const runtime: GeneratorRuntime = {
    ...runtimeFromSettings(chatSettings, conversation.runtime?.provider ?? chatSettings.provider),
    ...(conversation.runtime?.model ? { model: conversation.runtime.model } : {}),
    ...(conversation.runtime?.effort ? { effort: conversation.runtime.effort } : {})
  };

  if (choosingAi) {
    return (
      <GeneratorProviderPanel
        subject="conversation"
        settings={chatSettings}
        readiness={readiness}
        claudeStatus={claudeStatus}
        runtime={runtime}
        onChange={(next) => {
          const override = requestRuntime(next, chatSettings);
          const { runtime: _previous, ...rest } = conversation;
          onChange(override ? { ...rest, runtime: override } : rest);
        }}
        onDone={() => setChoosingAi(false)}
        onOpenCoach={onOpenCoachSettings}
      />
    );
  }

  return (
    <div className="plan-generator-sheet-layer">
      <button type="button" className="plan-generator-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="plan-generator-sheet" role="dialog" aria-modal="true" aria-labelledby="coach-conversation-settings-title">
        <header>
          <div>
            <h3 id="coach-conversation-settings-title">This conversation</h3>
            <p>What Coach may read here, and which AI answers — for every turn in it and the analyses that run in it.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="plan-generator-sheet-body">
          <p className="tl-eyebrow">What Coach reads</p>
          <ul className="plan-generator-sources">
            {SOURCES.map((source) => {
              const on = conversation.sources[source.value];
              return (
                <li key={source.value}>
                  <span>
                    <strong id={`coach-conversation-source-${source.value}`}>{source.label}</strong>
                    <small>{on ? source.detail : "Not shared in this conversation"}</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="plan-generator-source"
                    aria-checked={on}
                    aria-labelledby={`coach-conversation-source-${source.value}`}
                    onClick={() =>
                      onChange({ ...conversation, sources: { ...conversation.sources, [source.value]: !on } })
                    }
                  >
                    <span />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="tl-eyebrow">AI</p>
          <button type="button" className="ghost-button" data-action="chooseAi" onClick={() => setChoosingAi(true)}>
            {conversation.runtime ? "Change the AI for this conversation" : "Use a different AI here"}
          </button>
        </div>
        <footer>
          <button type="button" className="primary-button" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
