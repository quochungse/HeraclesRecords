import { createPortal } from "react-dom";
import type {
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  TrainingPlanDataSources
} from "../../electron/types";
import { OptionChips } from "../components/OptionGroup";
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

const WEB_TITLE = "Web: search the internet for races, events and anything else your data does not hold";

/** What switching the web on means with this provider, in one sentence. */
export function webSearchNote(provider: ChatProvider): string {
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
  sources,
  web = true,
  onChange,
  onSourcesChange,
  onWebChange,
  onClose,
  onOpenCoachSettings
}: {
  chatSettings: ChatSettings;
  runtime: GeneratorRuntime;
  readiness: Partial<Record<ChatProvider, boolean>>;
  claudeStatus: ClaudeCodeStatus | null;
  /** The open conversation's sources; absent with none open, and the section is not drawn. */
  sources?: TrainingPlanDataSources;
  /** Whether Coach may search the web in the open conversation. */
  web?: boolean;
  onChange: (next: GeneratorRuntime) => void;
  onSourcesChange?: (next: TrainingPlanDataSources) => void;
  onWebChange?: (next: boolean) => void;
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
        {sources && onSourcesChange ? (
          <>
            <p className="tl-eyebrow">Permissions</p>
            <OptionChips<PermissionKey>
              label="What Coach may read"
              appearance="tiles"
              options={[
                ...SOURCES.map((source) => ({
                  value: source.value,
                  label: PERMISSION_LABELS[source.value],
                  title: `${source.label}: ${source.detail}`
                })),
                ...(onWebChange ? [{ value: "web" as const, label: "Web", title: WEB_TITLE }] : [])
              ]}
              values={[
                ...SOURCES.filter((source) => sources[source.value]).map((source) => source.value),
                ...(onWebChange && web ? ["web" as const] : [])
              ]}
              onToggle={(value) =>
                value === "web"
                  ? onWebChange?.(!web)
                  : onSourcesChange({ ...sources, [value]: !sources[value] })
              }
            />
            {anySourceWithheld(sources) ? (
              <p className="plan-generator-sheet-note">{OTHER_SERVERS_WITHHELD_NOTE}</p>
            ) : null}
            {onWebChange && (web || runtime.provider === "local") ? (
              <p className="plan-generator-sheet-note">{webSearchNote(runtime.provider)}</p>
            ) : null}
          </>
        ) : null}
      </GeneratorProviderPanel>
    </div>,
    document.body
  );
}
