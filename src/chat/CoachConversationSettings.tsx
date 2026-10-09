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

/** The chips' short names; the generator's longer label and detail are the tooltip. */
const PERMISSION_LABELS: Record<SourceKey, string> = {
  activities: "Activities",
  sleep: "Sleep",
  zones: "Zones"
};

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
  onChange,
  onSourcesChange,
  onClose,
  onOpenCoachSettings
}: {
  chatSettings: ChatSettings;
  runtime: GeneratorRuntime;
  readiness: Partial<Record<ChatProvider, boolean>>;
  claudeStatus: ClaudeCodeStatus | null;
  /** The open conversation's sources; absent with none open, and the section is not drawn. */
  sources?: TrainingPlanDataSources;
  onChange: (next: GeneratorRuntime) => void;
  onSourcesChange?: (next: TrainingPlanDataSources) => void;
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
            <OptionChips<SourceKey>
              label="What Coach may read"
              appearance="tiles"
              options={SOURCES.map((source) => ({
                value: source.value,
                label: PERMISSION_LABELS[source.value],
                title: `${source.label}: ${source.detail}`
              }))}
              values={SOURCES.filter((source) => sources[source.value]).map((source) => source.value)}
              onToggle={(value) => onSourcesChange({ ...sources, [value]: !sources[value] })}
            />
            {anySourceWithheld(sources) ? (
              <p className="plan-generator-sheet-note">{OTHER_SERVERS_WITHHELD_NOTE}</p>
            ) : null}
          </>
        ) : null}
      </GeneratorProviderPanel>
    </div>,
    document.body
  );
}
