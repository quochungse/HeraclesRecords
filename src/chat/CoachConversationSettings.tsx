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
  otherServersWithheldNote,
  SOURCES,
  anySourceWithheld
} from "../training-library/planGeneratorModel";
import type { GeneratorRuntime } from "../training-library/planGeneratorRuntime";
import { messageRecord, t } from "../i18n/core";
import { useI18n } from "../i18n/useI18n";
import "../training-library/trainingLibrary.css";

type SourceKey = keyof TrainingPlanDataSources;
/** The athlete's data, and the web — which is not the athlete's and is switched beside it. */
type PermissionKey = SourceKey | "web";

/** The chips' short names; the generator's longer label and detail are the tooltip. */
const PERMISSION_LABELS = messageRecord<SourceKey>({
  activities: "chat.source.activities",
  sleep: "chat.source.sleep",
  zones: "chat.source.zones"
});

function permissionOptions(): OptionGroupOption<PermissionKey>[] {
    return [
    ...SOURCES.map((source) => ({
      value: source.value,
      label: PERMISSION_LABELS[source.value],
      title: `${source.label}: ${source.detail}`
    })),
    {
      value: "web",
      label: t("chat.perm.web"),
      title: t("chat.perm.webTitle")
  }
  ];
}

/** What switching the web on means with this provider, in one sentence. */
function webSearchNote(provider: ChatProvider): string {
  switch (provider) {
    case "local":
      return t("chat.perm.web.local");
    case "claude-api":
      return t("chat.perm.web.claudeApi");
    case "openrouter":
      return t("chat.perm.web.openrouter");
    case "claude-code":
      return t("chat.perm.web.claudeCode");
    case "chatgpt":
      return t("chat.perm.web.chatgpt");
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
  useI18n();
  const { sources } = conversation;
  const web = conversation.web === true;
  return (
    <>
      <p className="tl-eyebrow">{t("chat.perm.title")}</p>
      <OptionChips<PermissionKey>
        label={t("chat.perm.label")}
        appearance="tiles"
        options={permissionOptions()}
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
        <p className="plan-generator-sheet-note">{otherServersWithheldNote()}</p>
      ) : null}
      {web || provider === "local" ? (
        <p className="plan-generator-sheet-note">{webSearchNote(provider)}</p>
      ) : null}
    </>
  );
}
