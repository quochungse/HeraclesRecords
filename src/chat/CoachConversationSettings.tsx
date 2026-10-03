import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, X } from "lucide-react";
import type {
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  ConversationSettings
} from "../../electron/types";
import { GeneratorProviderPanel } from "../training-library/GeneratorProviderPanel";
import {
  OTHER_SERVERS_WITHHELD_NOTE,
  SOURCES,
  anySourceWithheld
} from "../training-library/planGeneratorModel";
import {
  requestRuntime,
  runtimeFromSettings,
  runtimeModelOptions,
  runtimeSummary,
  type GeneratorRuntime
} from "../training-library/planGeneratorRuntime";
import { COACH_PROVIDER_LABELS } from "./CoachModelsPanel";
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
  /* Moving between this sheet and the AI sheet swaps what is on the scrim,
     not the scrim: without `data-swapped` each move faded the backdrop in
     again from nothing, which read as the screen flashing (UAT). */
  const [swapped, setSwapped] = useState(false);
  const sheet: ReactNode = (
    <div className="coach-sheet" data-swapped={swapped || undefined}>
      <ConversationSettingsSheet {...rest} onSwap={() => setSwapped(true)} />
    </div>
  );
  return portal ? createPortal(sheet, document.body) : sheet;
}

/**
 * "AI for this conversation" on its own, as the composer's AI chip opens it
 * (UAT after R3): the chip states the AI in one line and this is where it is
 * changed. `onChange` takes the whole runtime; the caller decides whether it
 * is the conversation's or, with none open yet, Coach's.
 */
export function ConversationAiSheet({
  chatSettings,
  runtime,
  readiness,
  claudeStatus,
  onChange,
  onClose,
  onOpenCoachSettings
}: {
  chatSettings: ChatSettings;
  runtime: GeneratorRuntime;
  readiness: Partial<Record<ChatProvider, boolean>>;
  claudeStatus: ClaudeCodeStatus | null;
  onChange: (next: GeneratorRuntime) => void;
  onClose: () => void;
  onOpenCoachSettings: () => void;
}) {
  return createPortal(
    <div className="coach-sheet">
      <GeneratorProviderPanel
        subject="conversation"
        settings={chatSettings}
        readiness={readiness}
        claudeStatus={claudeStatus}
        runtime={runtime}
        onChange={onChange}
        onDone={onClose}
        onOpenCoach={onOpenCoachSettings}
      />
    </div>,
    document.body
  );
}

interface SettingsProps {
  chatSettings: ChatSettings;
  conversation: ConversationSettings;
  /** The provider the conversation was started with, which an absent one means (Q1). */
  baseProvider?: ChatProvider;
  readiness: Partial<Record<ChatProvider, boolean>>;
  claudeStatus: ClaudeCodeStatus | null;
  onChange: (next: ConversationSettings) => void;
  onClose: () => void;
  onOpenCoachSettings: () => void;
}

function ConversationSettingsSheet({
  onSwap,
  chatSettings,
  conversation,
  baseProvider,
  readiness,
  claudeStatus,
  onChange,
  onClose,
  onOpenCoachSettings
}: SettingsProps & { onSwap: () => void }) {
  const [choosingAi, setChoosingAiState] = useState(false);
  const setChoosingAi = (next: boolean) => {
    onSwap();
    setChoosingAiState(next);
  };
  const runtime: GeneratorRuntime = {
    ...runtimeFromSettings(chatSettings, conversation.runtime?.provider ?? baseProvider ?? chatSettings.provider),
    ...(conversation.runtime?.model ? { model: conversation.runtime.model } : {}),
    ...(conversation.runtime?.effort ? { effort: conversation.runtime.effort } : {})
  };
  /* The AI as it stands, not only a way to change it (UAT): what answers,
     with which model and effort, whether it is set up, and whether it is
     Coach's default or this conversation's own. */
  const ready = readiness[runtime.provider];
  const ownChoice = requestRuntime(runtime, chatSettings, chatSettings.provider) !== undefined;

  if (choosingAi) {
    return (
      <GeneratorProviderPanel
        subject="conversation"
        settings={chatSettings}
        readiness={readiness}
        claudeStatus={claudeStatus}
        runtime={runtime}
        onChange={(next) => {
          const override = requestRuntime(next, chatSettings, baseProvider ?? chatSettings.provider);
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
          {anySourceWithheld(conversation.sources) ? (
            <p className="plan-generator-sheet-note">{OTHER_SERVERS_WITHHELD_NOTE}</p>
          ) : null}
          <p className="tl-eyebrow">AI</p>
          <div className="coach-conversation-ai">
            <span>
              <strong>{COACH_PROVIDER_LABELS[runtime.provider]}</strong>
              <small className="coach-conversation-ai-model">
                {runtimeSummary(runtime, runtimeModelOptions(runtime.provider, chatSettings, claudeStatus))}
              </small>
              <small>{ownChoice ? "Chosen for this conversation" : "Coach’s default"}</small>
            </span>
            <span
              className={`plan-generator-provider-tag${ready === true ? " is-ready" : ready === false ? " is-blocked" : ""}`}
            >
              {ready === undefined ? (
                <LoaderCircle className="is-spinning" size={11} aria-hidden="true" />
              ) : ready ? (
                <Check size={11} aria-hidden="true" />
              ) : null}
              {ready === undefined ? "Checking" : ready ? "Connected" : "Not set up"}
            </span>
            <button type="button" className="ghost-button" data-action="chooseAi" onClick={() => setChoosingAi(true)}>
              Change
            </button>
          </div>
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
