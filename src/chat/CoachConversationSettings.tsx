import { createPortal } from "react-dom";
import type {
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  ConversationSettings,
  TrainingPlanDataSources
} from "../../electron/types";
import { OptionChips, type OptionGroupOption } from "../components/OptionGroup";
import { GeneratorProviderPanel } from "../training-library/GeneratorProviderPanel";
import {
  OTHER_SERVERS_WITHHELD_NOTE,
  SOURCES,
  anySourceWithheld
} from "../training-library/planGeneratorModel";
import type { GeneratorRuntime } from "../training-library/planGeneratorRuntime";
import "../training-library/trainingLibrary.css";

type SourceKey = keyof TrainingPlanDataSources;
/** The athlete's data, and the web — which is not the athlete's and is switched beside it. */
type PermissionKey = SourceKey | "web";

/** The chips' short names; the generator's longer label and detail are the tooltip. */
const PERMISSION_LABELS: Record<SourceKey, string> = {
  activities: "Activities",
  sleep: "Sleep",
  zones: "Zones"
};

const PERMISSION_OPTIONS: readonly OptionGroupOption<PermissionKey>[] = [
  ...SOURCES.map((source) => ({
    value: source.value,
    label: PERMISSION_LABELS[source.value],
    title: `${source.label}: ${source.detail}`
  })),
  {
    value: "web",
    label: "Web",
    title: "Web: search the internet for races, events and anything else your data does not hold"
  }
];

/** What switching the web on means with this provider, in one sentence. */
function webSearchNote(provider: ChatProvider): string {
  switch (provider) {
    case "local":
      return "A local model cannot search the web, so Coach answers here without it.";
    case "claude-api":
      return "Coach searches when a question needs it, never in an analysis; each search is billed to your Anthropic account.";
    case "openrouter":
      return "Coach searches when a question needs it, never in an analysis; each search is billed to your OpenRouter credit.";
    case "claude-code":
      return "Coach searches through your Claude subscription when a question needs it, never in an analysis.";
    case "chatgpt":
      return "Coach searches through your ChatGPT subscription when a question needs it, never in an analysis.";
  }
}

/**
 * "AI for this conversation", as the composer's AI chip opens it (UAT after
 * R3): which AI answers here, and — with a conversation open — what Coach may
 * read in it (P2.0). A source switched off is withheld from every tool that
 * reads it and from the snapshot, not merely left out of the prompt.
 * `onChange` takes the whole runtime; the caller decides whether it is the
 * conversation's or, with none open yet, Coach's.
 *
 * Loaded when first opened, with the library's stylesheet its sheet is drawn by.
 */
export function ConversationAiSheet({
  chatSettings,
  runtime,
  readiness,
  claudeStatus,
  conversation,
  onChange,
  onConversationChange,
  onClose,
  onOpenCoachSettings
}: {
  chatSettings: ChatSettings;
  runtime: GeneratorRuntime;
  readiness: Partial<Record<ChatProvider, boolean>>;
  claudeStatus: ClaudeCodeStatus | null;
  /** The open conversation's settings; absent with none open, and Permissions is not drawn. */
  conversation?: ConversationSettings;
  onChange: (next: GeneratorRuntime) => void;
  onConversationChange: (next: ConversationSettings) => void;
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
      >
        {conversation ? (
          <Permissions conversation={conversation} provider={runtime.provider} onChange={onConversationChange} />
        ) : null}
      </GeneratorProviderPanel>
    </div>,
    document.body
  );
}

/** What Coach may read in the conversation, and whether it may search the web. */
function Permissions({
  conversation,
  provider,
  onChange
}: {
  conversation: ConversationSettings;
  provider: ChatProvider;
  onChange: (next: ConversationSettings) => void;
}) {
  const { sources } = conversation;
  const web = conversation.web === true;
  return (
    <>
      <p className="tl-eyebrow">Permissions</p>
      <OptionChips<PermissionKey>
        label="What Coach may read"
        appearance="tiles"
        options={PERMISSION_OPTIONS}
        values={[
          ...SOURCES.filter((source) => sources[source.value]).map((source) => source.value),
          ...(web ? ["web" as const] : [])
        ]}
        onToggle={(value) =>
          onChange(
            value === "web"
              ? { ...conversation, web: !web }
              : { ...conversation, sources: { ...sources, [value]: !sources[value] } }
          )
        }
      />
      {anySourceWithheld(sources) ? (
        <p className="plan-generator-sheet-note">{OTHER_SERVERS_WITHHELD_NOTE}</p>
      ) : null}
      {web || provider === "local" ? (
        <p className="plan-generator-sheet-note">{webSearchNote(provider)}</p>
      ) : null}
    </>
  );
}
