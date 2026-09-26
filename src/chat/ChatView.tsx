import {
  Suspense,
  forwardRef,
  lazy,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import {
  Cloud,
  Database,
  ExternalLink,
  FileDown,
  FileText,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  User,
  X,
  Zap
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorosLinkApi } from "../coroslink-api";
import { showToast } from "../toast";
import { useUnitSystem } from "../units/UnitSystemProvider";
import type {
  AnthropicEffort,
  ChatAuthStatus,
  ChatContextCompaction,
  ChatContextInspection,
  ChatProvider,
  ChatSessionSummary,
  ChatSettings,
  ChatTokenUsage,
  ChatEntryAnalysisMarker,
  ClaudeCodeStatus,
  CoachAnalysisRun,
  CoachAnalysisSessionAttention,
  CoachInputChoice,
  CoachInputPrompt,
  McpServerConfig,
  McpServerStatus,
  PersistedChatEntry,
  PlanArtifactVersion,
  PlanBrief,
  PlanBriefRequest,
  ChatPipelineStep,
  TrainingPlanOutline,
  CoachOpenRequest,
  ConversationSettings,
  PlanCalendarState,
  PlanDraftPreview,
  PlanRef,
  PlanCorosSync,
  PlanDraftSaveOptions,
  PlanVersionWritten,
  PlanDraftPreviewEntry,
  TrainingPlanDestination,
  TrainingPlanDocument,
  TrainingHubExportResult,
  UploadPlanResult,
  WorkoutDeletePreview,
  ScheduleChangeSet
} from "../../electron/types";
import { NOTHING_TO_REPORT } from "../../electron/types";
import { sportTheme } from "../training-library/sportTheme";
import { ActivityVisualCard } from "./ActivityVisualCard";
import { FitnessTrendCard } from "./FitnessTrendCard";
import { HrZoneCard } from "./HrZoneCard";
import { supportsReasoningEffort } from "../../electron/chatModels";
import { ChatSettingsModal } from "./ChatSettingsModal";
import { McpSessionPrompt } from "./McpSessionPrompt";
import { ConversationAnalyses } from "./analyses/ConversationAnalyses";
import { AnalysesModal } from "./analyses/AnalysesModal";
import type { AnalysesModalTarget } from "./analyses/AnalysesModal";
import { CoachCreationCard } from "./CoachCreationCard";
import { CoachBriefCard } from "./CoachBriefCard";
import { CoachScheduleChangeCard } from "./CoachScheduleChangeCard";
import { scheduleChangeIds } from "./scheduleChangeModel";
import { CoachOutlineCard } from "./CoachOutlineCard";
import { CoachStepTrail, stepRunEvent, type StepRun } from "./CoachStepTrail";
import { EMPTY_NOTES } from "../training-library/runTrail";
import { briefOpenProblems, briefTitle } from "./planBriefModel";
import { remoteErrorMessage } from "./remoteError";
import { latestOutlineAnchors, outlineStepText } from "./planOutlineModel";
import { ConfirmDialog } from "../training-library/ConfirmDialog";
import { createPortal } from "react-dom";
import { firstPlanMonday } from "../../electron/trainingPlanGeneration";
import { creationCalendar, localDayKey } from "./creationCalendar";
import { refinementChips } from "./creationChoices";
import { COACH_PROVIDER_LABELS, coachProviderReadiness } from "./CoachModelsPanel";
import {
  creationVersions,
  isLatestVersion,
  isOnCoros,
  supersededLine,
  withDocumentSources
} from "./creationVersions";
import {
  DEFAULT_COMPACT_CONTEXT,
  summaryContextMessage,
  toWireMessages,
  withCreationIndex
} from "../../electron/chatContextCompaction";
import { ClaudeAuthScopeToggle } from "./ClaudeAuthScopeToggle";
import { ClaudeCodeLoginCard } from "./ClaudeCodeLoginCard";
import { ChatSidebar } from "./ChatSidebar";
import { detectAndAdoptLocalServer } from "./localModelDetection";
import { ContextHistoryDialog } from "./ContextHistoryDialog";
import { EffortSwitch } from "./EffortSwitch";
import { ModelSwitch } from "./ModelSwitch";
import { ProviderSwitch } from "./ProviderSwitch";
import {
  fromPersistedEntries,
  toPersistedEntries,
  upsertActivityVisualEntry,
  upsertCoachPromptEntry,
  upsertFitnessTrendEntry,
  upsertHrZoneEntry,
  upsertPlanDraftEntry,
  isChatVisualEntry,
  settleTurnEntries,
  type ChatEntry,
  type SourceInfo
} from "./chatTypes";
import { formatTurnCost, formatTurnCostDetail } from "./turnCost";
import {
  groupChatToolsBySource,
  type ChatToolSource
} from "../../electron/chatToolSources";

/* "Edit plan first": the plan editor and the library's stylesheet, loaded
   only when a coach plan is opened in it. */
const CoachPlanEditor = lazy(() => import("./CoachPlanEditor"));
/* "Edit" on a coach's one-off workout: the workout builder, loaded when used. */
const CoachWorkoutEditor = lazy(() => import("./CoachWorkoutEditor"));
const CoachCanvas = lazy(() => import("./CoachCanvas"));
const CorosConflictDialog = lazy(() => import("./CorosConflictDialog"));
const CoachCalendarDialog = lazy(() => import("./CoachCalendarDialog"));
const CoachConversationSettings = lazy(() => import("./CoachConversationSettings"));
const CoachBriefEditor = lazy(() => import("./CoachBriefEditor"));
const CoachOutlineEditor = lazy(() => import("./CoachOutlineEditor"));

/** What a conversation AI Plan opened is called until its brief has a goal (P2.5). */
const NEW_PLAN_TITLE = "New plan";

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: "chatgpt",
  chatgpt: {},
  anthropic: {
    model: "claude-opus-5",
    effort: "high",
    hasApiKey: false
  },
  claudeCode: {
    useAppScopedAuth: true,
    effort: "high",
    permissions: {
      recentActivities: true,
      trainingMetrics: true,
      upcomingWorkouts: true,
      sleepData: false,
      fullActivityFiles: false
    }
  },
  openRouter: {
    model: "openrouter/auto",
    hasApiKey: false
  },
  local: {
    baseUrl: "http://localhost:11434/v1",
    model: "",
    hasApiKey: false,
    toolsEnabled: true
  },
  sidebarOpen: true,
  visualizationsEnabled: false,
  customInstructions: "",
  compactContext: DEFAULT_COMPACT_CONTEXT
};

const CHAT_MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const CHAT_MARKDOWN_COMPONENTS: Components = {
  // Render links in the user's browser, not inside the app window.
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
};

const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  streaming = false
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className={`chat-markdown${streaming ? " chat-markdown-streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={CHAT_MARKDOWN_REMARK_PLUGINS}
        components={CHAT_MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

const ThinkingDisclosure = memo(function ThinkingDisclosure({
  content,
  live = false
}: {
  content: string;
  live?: boolean;
}) {
  return (
    <details className={`chat-thinking${live ? " chat-thinking-live" : ""}`}>
      <summary>
        <span>Thinking</span>
        {live ? <small><i aria-hidden="true" />Live</small> : null}
      </summary>
      <div className="chat-thinking-text">
        <AssistantMarkdown content={content} />
      </div>
    </details>
  );
});

function CoachInputCard({
  prompt,
  disabled,
  onChoose,
  onCustom
}: {
  prompt: CoachInputPrompt;
  disabled: boolean;
  onChoose: (choice: CoachInputChoice) => void;
  onCustom: () => void;
}) {
  const answered = prompt.answeredAt !== undefined;
  return (
    <section
      className={`chat-coach-prompt${answered ? " is-answered" : ""}`}
      aria-labelledby={`coach-prompt-${prompt.promptId}`}
    >
      <header className="chat-coach-prompt-header">
        <span className="chat-coach-prompt-status">
          <MessageCircle size={14} aria-hidden="true" />
          {answered ? "Answered" : "Waiting for your answer"}
        </span>
        <h4 id={`coach-prompt-${prompt.promptId}`}>{prompt.question}</h4>
      </header>
      <div className="chat-coach-prompt-choices" role="group" aria-label="Answer choices">
        {prompt.choices.map((choice, index) => {
          const selected = prompt.selectedChoiceId === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              className={`chat-coach-prompt-choice${selected ? " is-selected" : ""}`}
              onClick={() => onChoose(choice)}
              disabled={disabled || answered}
            >
              <span>
                {choice.label}
                {!answered && index === 0 ? <em>Recommended</em> : null}
              </span>
              {choice.description ? <small>{choice.description}</small> : null}
            </button>
          );
        })}
      </div>
      {!answered && prompt.allowCustom ? (
        <button
          type="button"
          className="chat-coach-prompt-custom"
          onClick={onCustom}
          disabled={disabled}
        >
          Type another answer
        </button>
      ) : null}
    </section>
  );
}

/**
 * An analysis run streaming into the conversation that is open. Deliberately
 * separate from the athlete's own streaming state: theirs is persisted as their
 * turn when it ends, while a run's text is already being written to disk by the
 * main process, and merging the two would save it twice.
 */
interface LiveAnalysisRun {
  runId: string;
  name: string;
  text: string;
}

interface ChatViewProps {
  api: CorosLinkApi | undefined;
  onError: (message: string | null) => void;
  onPlanUploaded?: () => void;
  /** Fires when a coach request is in progress (streaming or exporting). */
  onActivityChange?: (active: boolean) => void;
  /**
   * Text preloaded into the composer (e.g. "Ask Coach" from the calendar), or
   * a Coach plan to ask about in the conversation it came from (P1.7).
   */
  pendingPrompt?: string | CoachOpenRequest | null;
  onPendingPromptConsumed?: () => void;
  /**
   * True while the Coach view is the visible one. The panel stays mounted when
   * the athlete navigates away, so anything that should happen "on opening
   * Coach" keys on this rather than on mount.
   */
  active?: boolean;
}

/** The sources a conversation can share, in the order its strip names them. */
const SHARED_SOURCE_LABELS: readonly ["activities" | "sleep" | "zones", string][] = [
  ["activities", "Activities"],
  ["sleep", "Sleep"],
  ["zones", "Zones"]
];

/** Inline style hook that tints a row/chip with the sport's own colour. */
function planSportStyle(sport: PlanDraftPreviewEntry["sport"]): CSSProperties {
  return { "--chat-plan-sport": sportTheme(sport).color } as CSSProperties;
}

function deleteTargetLabel(target: WorkoutDeletePreview["target"]): string {
  if (target === "scheduled") return "Calendar";
  if (target === "library") return "Library";
  return "Calendar and library";
}

/**
 * A delete card from before change sets (P3.2). Its request lived in the
 * memory of the process that staged it, so nothing can be applied from it
 * any more; it stays drawn because it is part of the conversation.
 */
function DeletePreviewCard({ preview }: { preview: WorkoutDeletePreview }) {
  return (
    <div className="chat-plan-card chat-delete-card">
      <div className="chat-plan-card-header">
        <h4>Delete workout</h4>
        <span className="chat-plan-card-summary">{preview.summary}</span>
      </div>
      <dl className="chat-delete-details">
        <div>
          <dt>Target</dt>
          <dd>{deleteTargetLabel(preview.target)}</dd>
        </div>
        {preview.workoutName ? (
          <div>
            <dt>Workout</dt>
            <dd>{preview.workoutName}</dd>
          </div>
        ) : null}
        {preview.scheduleDate ? (
          <div>
            <dt>Date</dt>
            <dd>{preview.scheduleDate}</dd>
          </div>
        ) : null}
      </dl>
      <p className="chat-delete-expired">This card is from an earlier version and can no longer delete anything. Ask Coach again.</p>
    </div>
  );
}

const SOURCE_ICONS: Record<ChatToolSource, typeof Database> = {
  db: Database,
  coros: Cloud,
  mcp: Plug
};

/**
 * Where the answer's data came from: one pill per source — DB for this
 * machine's own store, Coros for the Training Hub API, MCP for a connected MCP
 * server — each naming the tools that read from it. `mcpUsed`/`mcpTools` are
 * the stored names from when every tool was labelled MCP; the grouping is done
 * here, by name, so old transcripts read correctly too.
 */
function SourceBadge({ source }: { source: SourceInfo }) {
  const groups = source.mcpUsed ? groupChatToolsBySource(source.mcpTools) : [];
  const failure = source.mcpUsed ? source.mcpError : undefined;
  if (groups.length > 0 || failure) {
    return (
      <div className="chat-sources">
        {groups.map((group) => {
          const Icon = SOURCE_ICONS[group.source];
          return (
            <div
              key={group.source}
              className={`chat-source chat-source-tool chat-source-${group.source}`}
            >
              <Icon size={12} aria-hidden="true" />
              {`${group.label} · ${group.tools.join(", ")}`}
            </div>
          );
        })}
        {failure ? (
          <div className="chat-source chat-source-error" title={failure}>
            Tool failed
          </div>
        ) : null}
      </div>
    );
  }
  if (source.snapshotIncluded) {
    return (
      <div className="chat-source chat-source-snapshot">
        <FileText size={12} aria-hidden="true" />
        Training snapshot
        {source.mcpEnabled ? " · MCP not called" : ""}
      </div>
    );
  }
  return (
    <div className="chat-source chat-source-none">
      <FileText size={12} aria-hidden="true" />
      No COROS data
    </div>
  );
}

/**
 * What the answer above cost, bottom-right under the bubble.
 *
 * Drawn only when a provider actually reported: an absent count means nobody
 * said, and a footer reading "0 Tokens" there would be a claim the app cannot
 * make. Every answer written before this shipped has no count either, so old
 * conversations stay as they were rather than growing a row of zeroes.
 */
/**
 * A transcript row that decides once, when it mounts, whether to play the
 * entrance animation.
 *
 * `chat-row-enter` starts from `opacity: 0` and fills backwards, so a row is
 * invisible until the animation runs — and it only runs while the window is
 * producing frames. When a turn settles, the streaming bubble is swapped for
 * rows built from the transcript, so an answer the athlete had just watched
 * arrive in full was re-mounted and faded in again from nothing: a blink on
 * every turn (measured over CDP at `opacity: 0` 100 ms after the end) and, on
 * a GNOME Wayland window that had stopped getting frames, the whole new turn
 * left invisible until a scroll or a click produced one. Rows the settle mounts
 * are therefore drawn as they are.
 *
 * Held in state rather than computed per render: changing an element's
 * `animation` restarts it, so a row that lost its marker on the next reload
 * would blink after all.
 */
function ChatRow({
  settled,
  className,
  children,
  ...rest
}: {
  settled: boolean;
  className: string;
  children: ReactNode;
  "data-chat-entry-index"?: number;
}) {
  const [inPlace] = useState(settled);
  return (
    <div className={inPlace ? `${className} is-settled` : className} {...rest}>
      {children}
    </div>
  );
}

function TurnCostFooter({
  usage,
  model
}: {
  usage?: ChatTokenUsage;
  model?: string;
}) {
  if (!usage) return null;
  return (
    <div className="chat-turn-cost" title={formatTurnCostDetail(usage)}>
      {formatTurnCost(usage, model)}
    </div>
  );
}

function isLatestActivityFileRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(download|export|save|get|grab)\b/.test(normalized) &&
    /\b(latest|last|most recent|newest|recent)\b/.test(normalized) &&
    /\b(activity|workout|run|ride)\b/.test(normalized) &&
    /\b(file|fit|original)\b/.test(normalized)
  );
}

function formatLatestActivityExportMessage(
  result: TrainingHubExportResult
): string {
  const formatLabel = result.formatLabel ?? "FIT";
  const activityName = result.activityName ? ` "${result.activityName}"` : "";
  if (!result.saved || !result.filePath) {
    return `No file saved. The latest activity ${formatLabel} export was cancelled.`;
  }
  return `Saved the latest activity ${formatLabel} file${activityName} to:\n\n\`${result.filePath}\``;
}

interface ChatComposerHandle {
  focus: () => void;
  setDraft: (value: string) => void;
}

interface ChatComposerProps {
  providerControls: ReactNode;
  initialDraft: string;
  apiAvailable: boolean;
  streaming: boolean;
  exportingLatestActivity: boolean;
  waitingForCoachAnswer: boolean;
  isLocalProvider: boolean;
  localModelConfigured: boolean;
  onDraftChange: (value: string) => void;
  onNewChat: () => void;
  onSend: (message: string) => Promise<boolean>;
  onStop: () => void;
}

const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    {
      providerControls,
      initialDraft,
      apiAvailable,
      streaming,
      exportingLatestActivity,
      waitingForCoachAnswer,
      isLocalProvider,
      localModelConfigured,
      onDraftChange,
      onNewChat,
      onSend,
      onStop
    },
    ref
  ) {
    const [draft, setDraft] = useState(initialDraft);
    const draftRef = useRef(initialDraft);
    const submittingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const trimmedDraft = draft.trim();
    const latestActivityFileRequest = isLatestActivityFileRequest(trimmedDraft);
    const localProviderBlocked =
      isLocalProvider &&
      !localModelConfigured &&
      !latestActivityFileRequest;

    const updateDraft = useCallback(
      (value: string) => {
        draftRef.current = value;
        setDraft(value);
        onDraftChange(value);
      },
      [onDraftChange]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        setDraft: updateDraft
      }),
      [updateDraft]
    );

    const submitDraft = async () => {
      if (
        !apiAvailable ||
        !trimmedDraft ||
        exportingLatestActivity ||
        localProviderBlocked ||
        submittingRef.current
      ) {
        return;
      }

      const submittedDraft = draft;
      submittingRef.current = true;
      updateDraft("");
      try {
        const accepted = await onSend(trimmedDraft);
        if (!accepted && !draftRef.current) {
          updateDraft(submittedDraft);
        }
      } finally {
        submittingRef.current = false;
      }
    };

    return (
      <div className="chat-composer">
        <div className="chat-composer-toolbar">
          {providerControls}
          <button
            type="button"
            className="chat-new-chat chat-composer-new-chat"
            onClick={onNewChat}
            disabled={!apiAvailable || streaming || exportingLatestActivity}
            aria-label="Start a new chat"
            title="Start a new chat"
          >
            <Plus size={14} aria-hidden="true" />
            <span>New chat</span>
          </button>
        </div>
        <div className="chat-composer-inner">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submitDraft();
              }
            }}
            placeholder={
              waitingForCoachAnswer
                ? "Type another answer…"
                : "Ask your coach…"
            }
            rows={1}
            disabled={exportingLatestActivity}
          />
          {streaming ? (
            <button
              type="button"
              className="chat-send chat-stop"
              onClick={onStop}
              title="Stop"
            >
              <Square size={15} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="chat-send"
              onClick={() => void submitDraft()}
              disabled={
                !apiAvailable ||
                !trimmedDraft ||
                exportingLatestActivity ||
                localProviderBlocked
              }
              title={
                localProviderBlocked ? "Enter a local model first" : "Send"
              }
            >
              <Send size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="chat-disclaimer">
          Coach can make mistakes. Verify important training decisions.
        </p>
      </div>
    );
  }
);

export function ChatView({
  api,
  onError,
  onPlanUploaded,
  onActivityChange,
  pendingPrompt,
  onPendingPromptConsumed,
  active = true
}: ChatViewProps) {
  const { unitSystem } = useUnitSystem();
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [chatSettings, setChatSettings] =
    useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus | null>(null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  /** Which analysis screen the modal is showing, if any. */
  const [analysisTarget, setAnalysisTarget] =
    useState<AnalysesModalTarget | null>(null);
  const [analysesVersion, setAnalysesVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [timeline, setTimeline] = useState<ChatEntry[]>([]);
  /**
   * How many stored entries this window's timeline accounts for (5.6b). A run
   * writing from the main process appends past that point, and the store keeps
   * whatever lies beyond it rather than letting this window's copy — taken
   * before the run — delete the coach's answer.
   *
   * Zero means "nothing is known about the row", which keeps everything.
   */
  const persistedBaseRef = useRef(0);
  /**
   * 9.3: which conversations a coach speaks into, and which of them have said
   * something the athlete has not read. Keyed by session id.
   */
  const [sessionAttention, setSessionAttention] = useState<
    Map<string, CoachAnalysisSessionAttention>
  >(new Map());
  const [streaming, setStreaming] = useState(false);
  /** A pipeline step's turn while it runs, and its trail (P2.3). */
  const [stepRun, setStepRun] = useState<StepRun | null>(null);
  const advanceStep = (requestId: string, event: Parameters<typeof stepRunEvent>[1]) =>
    setStepRun((current) => (current?.requestId === requestId ? stepRunEvent(current, event) : current));
  useEffect(() => {
    if (!streaming) setStepRun(null);
  }, [streaming]);
  /** A summariser turn is running ahead of the athlete's own. */
  const [compacting, setCompacting] = useState(false);
  /** Read by Stop, which fires from a handler the state has not reached. */
  const compactingRef = useRef(false);
  /** The conversation the menu's "Compact context" is working on, if any. */
  const [compactingSessionId, setCompactingSessionId] = useState<string | null>(
    null
  );
  /**
   * Dev builds only: the conversation whose context is being inspected. Held as
   * the whole request rather than a boolean so a second open of a different row
   * cannot render the first one's answer under the second one's title.
   */
  const [contextInspection, setContextInspection] = useState<{
    sessionId: string;
    title: string;
    result: ChatContextInspection | null;
    error: string | null;
  } | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [exportingLatestActivity, setExportingLatestActivity] = useState(false);
  const [currentSource, setCurrentSource] = useState<SourceInfo | null>(null);
  const [mcpPrompt, setMcpPrompt] = useState<McpServerStatus[]>([]);
  const [mcpPromptBusy, setMcpPromptBusy] = useState(false);
  /**
   * The Creations panel starts closed and opens itself when the coach makes
   * something new — the one moment there is news in it. Every other time it is
   * a column of titles taken out of the conversation's width, so the athlete
   * opens it when they want it.
   */
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  /** The creation the popup is showing. null is closed. */
  const [openCreationId, setOpenCreationId] = useState<string | null>(null);
  const [highlightedChatEntryIndex, setHighlightedChatEntryIndex] = useState<
    number | null
  >(null);
  const [uploadingDraftId, setUploadingDraftId] = useState<string | null>(null);
  /** An update COROS refused because the plan changed there meanwhile. */
  const [corosConflict, setCorosConflict] = useState<{ draftId: string; name: string } | null>(null);
  /**
   * Each plan card's document, by draft and edit: the weeks and days the card
   * draws come from what the draft becomes, not from its dates. `null` is a
   * read that failed, kept so it is not retried on every render.
   */
  const [planDocuments, setPlanDocuments] = useState<
    Record<string, TrainingPlanDocument | null>
  >({});
  const planDocumentKeys = timeline.flatMap((entry) =>
    entry.kind === "planDraft" && !entry.draft.removedAt
      ? [`${entry.draft.draftId}:${entry.draft.editedAt ?? 0}`]
      : []
  );
  const missingPlanDocuments = planDocumentKeys
    .filter((key) => !(key in planDocuments))
    .join(",");
  useEffect(() => {
    if (!api || !missingPlanDocuments) return;
    // Marked before the read lands, so the next render does not ask again; the
    // answer replaces the mark whenever it arrives.
    for (const key of missingPlanDocuments.split(",")) {
      const draftId = key.slice(0, key.lastIndexOf(":"));
      setPlanDocuments((current) => (key in current ? current : { ...current, [key]: null }));
      void api
        .getPlanDraftDocument(draftId)
        .then((document) => {
          setPlanDocuments((current) => ({ ...current, [key]: document ?? null }));
        })
        .catch(() => undefined);
    }
  }, [api, missingPlanDocuments]);
  /**
   * Every version of the creations in this conversation. Re-read whenever a
   * card is added, edited or saved, which is when a version can appear.
   */
  const [artifactVersions, setArtifactVersions] = useState<PlanArtifactVersion[]>([]);
  const artifactKey = timeline
    .flatMap((entry) =>
      entry.kind === "planDraft"
        ? [`${entry.draft.draftId}:${entry.draft.editedAt ?? 0}:${entry.draft.uploadedAt ?? 0}`]
        : []
    )
    .join(",");
  useEffect(() => {
    if (!api || !artifactKey) {
      setArtifactVersions([]);
      return;
    }
    let live = true;
    void api
      .getPlanArtifacts(artifactKey.split(",").map((key) => key.split(":")[0]))
      .then((versions) => {
        if (live) setArtifactVersions(Array.isArray(versions) ? versions : []);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, artifactKey]);
  const versionIndex = creationVersions(artifactVersions);
  /**
   * Where each creation on COROS stands on the calendar, from this machine's
   * plan cache (P1.6). Read again when a card changes or a plan is added.
   */
  const [calendarStates, setCalendarStates] = useState<PlanCalendarState[]>([]);
  const [calendarRead, setCalendarRead] = useState(0);
  useEffect(() => {
    if (!api || !artifactKey) {
      setCalendarStates([]);
      return;
    }
    let live = true;
    void api
      .getPlanCalendarState(artifactKey.split(",").map((key) => key.split(":")[0]))
      .then((states) => {
        if (live) setCalendarStates(Array.isArray(states) ? states : []);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, artifactKey, calendarRead]);
  const calendarOf = (draftId: string) => {
    const artifactId = versionIndex.get(draftId)?.artifactId ?? draftId;
    return creationCalendar(
      calendarStates.find((state) => state.artifactId === artifactId),
      localDayKey()
    );
  };
  /** The version the calendar dialog is open for. */
  const [calendarFor, setCalendarFor] = useState<string | null>(null);
  /**
   * The briefs behind the conversation's brief cards (P2.1), by artifact.
   * `null` is a read that found nothing, kept so it is not asked again.
   */
  const [planBriefs, setPlanBriefs] = useState<Record<string, PlanBrief | null>>({});
  const missingBriefs = [
    ...new Set(timeline.flatMap((entry) => (entry.kind === "planBrief" ? [entry.artifactId] : [])))
  ]
    .filter((artifactId) => !(artifactId in planBriefs))
    .join(",");
  useEffect(() => {
    if (!api || !missingBriefs) return;
    const ids = missingBriefs.split(",");
    setPlanBriefs((current) => ({ ...Object.fromEntries(ids.map((id) => [id, null])), ...current }));
    void api
      .getPlanBriefs(ids)
      .then((briefs) =>
        setPlanBriefs((current) => ({ ...current, ...Object.fromEntries(briefs.map((brief) => [brief.artifactId, brief])) }))
      )
      .catch(() => undefined);
  }, [api, missingBriefs]);
  const missingChangeSets = scheduleChangeIds(timeline)
    .filter((changeSetId) => !(changeSetId in scheduleChanges))
    .join(",");
  useEffect(() => {
    if (!api || !missingChangeSets) return;
    const ids = missingChangeSets.split(",");
    setScheduleChanges((current) => ({ ...Object.fromEntries(ids.map((id) => [id, null])), ...current }));
    void api
      .getScheduleChanges(ids)
      .then((sets) =>
        setScheduleChanges((current) => ({ ...current, ...Object.fromEntries(sets.map((set) => [set.changeSetId, set])) }))
      )
      .catch(() => undefined);
  }, [api, missingChangeSets]);
  /** The anchor each outline's card is drawn at: its latest (P2.2). */
  const outlineAnchors = latestOutlineAnchors(timeline);
  /** The brief whose screen is open, and how its save is going. */
  const [editingBriefId, setEditingBriefId] = useState<string | null>(null);
  const [briefSave, setBriefSave] = useState<{ saving: boolean; error?: string }>({ saving: false });
  /** The earliest Monday a plan may start on, for reading a brief's dates. */
  const briefMonday = firstPlanMonday();
  const saveBrief = async (artifactId: string, request: PlanBriefRequest) => {
    if (!api) return;
    setBriefSave({ saving: true });
    try {
      const before = planBriefs[artifactId];
      const saved = await api.updatePlanBrief(artifactId, request);
      setPlanBriefs((current) => ({ ...current, [artifactId]: saved }));
      // A conversation AI Plan opened is named after the goal once it has one (P2.5).
      const sessionId = activeSessionIdRef.current;
      const title = sessions.find((session) => session.id === sessionId)?.title;
      if (sessionId && title === NEW_PLAN_TITLE && saved.request.goal.trim()) {
        void api
          .renameChatSession(sessionId, briefTitle(saved.request))
          .then((summary) => {
            if (summary) setSessions((current) => current.map((session) => (session.id === summary.id ? summary : session)));
          })
          .catch(() => undefined);
      }
      setBriefSave({ saving: false });
      setEditingBriefId(null);
      // The outline was drawn from the brief as it was (P2.2): ask, as the
      // generator asks when a source is switched under a drawn outline.
      if (saved.outline && JSON.stringify(before?.request) !== JSON.stringify(saved.request)) {
        setRedrawAsk(artifactId);
      }
    } catch (caught) {
      setBriefSave({ saving: false, error: remoteErrorMessage(caught, "The brief was not saved.") });
    }
  };
  /** A brief changed under its outline: whether to have it redrawn (P2.2). */
  const [redrawAsk, setRedrawAsk] = useState<string | null>(null);
  /** The outline whose Adjust screen is open, and how its save is going (P2.2). */
  const [editingOutlineId, setEditingOutlineId] = useState<string | null>(null);
  const [outlineSave, setOutlineSave] = useState<{ saving: boolean; error?: string }>({ saving: false });
  const saveOutline = async (artifactId: string, outline: TrainingPlanOutline) => {
    if (!api) return;
    setOutlineSave({ saving: true });
    try {
      const saved = await api.updatePlanOutline(artifactId, outline);
      setPlanBriefs((current) => ({ ...current, [artifactId]: saved }));
      setOutlineSave({ saving: false });
      setEditingOutlineId(null);
    } catch (caught) {
      setOutlineSave({ saving: false, error: remoteErrorMessage(caught, "The outline was not saved.") });
    }
  };
  /**
   * What this conversation reads and which AI answers it (P2.0), read when
   * the conversation opens; a turn reads it again in the main process.
   */
  const [conversationSettings, setConversationSettingsState] = useState<ConversationSettings | null>(null);
  /** Raised when a pull merged another machine's settings for a conversation, to read them again. */
  const [conversationSettingsVersion, setConversationSettingsVersion] = useState(0);
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false);
  useEffect(() => {
    setConversationSettingsState(null);
    if (!api || !activeSessionId) return;
    let live = true;
    void api
      .getConversationSettings(activeSessionId)
      .then((settings) => {
        if (live) setConversationSettingsState(settings);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, activeSessionId, conversationSettingsVersion]);
  const conversationSettingsWriteRef = useRef(0);
  const updateConversationSettings = (next: ConversationSettings) => {
    setConversationSettingsState(next);
    // Only the last write's answer, and only for the conversation still open:
    // two quick switches would otherwise settle on the first one's reply.
    const write = ++conversationSettingsWriteRef.current;
    void api
      ?.setConversationSettings(next)
      .then((saved) => {
        if (write === conversationSettingsWriteRef.current && saved.sessionId === activeSessionIdRef.current) {
          setConversationSettingsState(saved);
        }
      })
      .catch(() => undefined);
  };
  /* The coach's plan open in the editor, by draft id — "Edit plan first". */
  const [editingPlanDraftId, setEditingPlanDraftId] = useState<string | null>(null);
  const [editingWorkoutDraftId, setEditingWorkoutDraftId] = useState<string | null>(null);
  const [uploadedPlans, setUploadedPlans] = useState<
    Record<string, UploadPlanResult>
  >({});
  /**
   * The change sets behind the conversation's proposal cards (P3.2), by id.
   * `null` is a read that found nothing, kept so it is not asked again.
   */
  const [scheduleChanges, setScheduleChanges] = useState<Record<string, ScheduleChangeSet | null>>({});
  /** The line being applied (`"*"` for a whole set), by set. */
  const [applyingChange, setApplyingChange] = useState<{ changeSetId: string; lineId: string } | null>(null);
  // An analysis run writing into the conversation that is open right now.
  const [liveAnalysis, setLiveAnalysis] = useState<LiveAnalysisRun | null>(
    null
  );
  // House rule 1 asks a run with nothing to say to answer with the marker and
  // nothing else, so a run heading for silence has no other text in flight.
  // What has arrived is held back while it could still be that marker: it is a
  // control token, and the athlete watching the bubble must never read it.
  const liveAnalysisText =
    liveAnalysis && !NOTHING_TO_REPORT.startsWith(liveAnalysis.text.trim())
      ? liveAnalysis.text
      : "";

  // Ref so the push-event handlers filter on the current request without
  // being recreated (and re-subscribed) on every keystroke.
  const activeRequestIdRef = useRef<string | null>(null);
  /** The timeline's length when the running turn was sent: what comes after is the turn's. */
  const turnStartRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(null);
  /**
   * A turn of the athlete's own is in the air, so the timeline on screen is
   * ahead of the row: their message and the tokens streaming under it are not
   * saved yet. Read from an IPC handler, hence a ref.
   */
  const chatBusyRef = useRef(false);
  /** A conversation a sync pull rewrote while `chatBusyRef` was up, waiting for
   *  the turn to end before it is re-read. */
  const syncReloadPendingRef = useRef<string | null>(null);
  /**
   * Saves this window has started and not yet heard back about, and the one
   * still sitting on the debounce.
   *
   * Both exist so a re-read can wait for them. A reload reads the row and puts
   * what it finds on screen, so reading it before this window's own writes have
   * landed shows a transcript that is missing them — see `flushPendingSave`.
   */
  const inFlightSavesRef = useRef(new Set<Promise<unknown>>());
  const pendingSaveRef = useRef<(() => void) | null>(null);
  // Accumulates source info across the current stream's info events.
  const sourceRef = useRef<SourceInfo | null>(null);
  const thinkingRef = useRef("");
  /**
   * The answer text streamed so far this turn, readable from an IPC handler.
   * `streamingText` is state, so the error handler would see whatever it held
   * when the subscription was made — and the error handler is the one place
   * that needs it: a turn that fails after writing its answer must keep it.
   */
  const streamedTextRef = useRef("");
  /**
   * The entries a turn's settle put on screen, by identity — see `ChatRow`.
   * Identity rather than a flag raised around the commit: React flushes the
   * last token render's pending effects before rendering the settle, so a flag
   * lowered by an effect can be down again before the rows it was for mount.
   * A WeakSet because every reload replaces the entry objects, and a row only
   * asks once, when it mounts.
   */
  const settledEntriesRef = useRef(new WeakSet<ChatEntry>());
  const markSettled = (prev: ChatEntry[], next: ChatEntry[]) => {
    const before = new Set(prev);
    for (const entry of next) {
      if (!before.has(entry)) settledEntriesRef.current.add(entry);
    }
  };
  // Interaction cards are appended after the assistant's final text so the
  // question and its choices stay in a natural reading order.
  const pendingCoachPromptsRef = useRef<CoachInputPrompt[]>([]);
  // Kept only while a paused Coach turn is resuming, so a failed/cancelled
  // request can restore the question instead of silently losing it.
  const resumedCoachPromptRef = useRef<CoachInputPrompt | null>(null);
  // Same reason as activeRequestIdRef: the push handlers have to recognise the
  // analysis's stream without re-subscribing.
  const liveAnalysisRef = useRef<LiveAnalysisRun | null>(null);
  // Whether the Coach panel is the view on screen. The panel stays mounted once
  // it has been opened, so "the conversation is open" is not the same question
  // as "the athlete can see it" -- and only the second one means read.
  const viewActiveRef = useRef(active);
  const autoDetectLocalRef = useRef(false);
  const claudePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which conversation `seenPlanDraftIdsRef` is describing. */
  const planPanelSessionRef = useRef<string | null>(null);
  const seenPlanDraftIdsRef = useRef<Set<string>>(new Set());
  const chatHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const composerDraftRef = useRef("");
  const composerRef = useRef<ChatComposerHandle>(null);
  const handleComposerDraftChange = useCallback((value: string) => {
    composerDraftRef.current = value;
  }, []);

  useEffect(() => {
    if (!pendingPrompt || !composerRef.current) {
      return;
    }
    onPendingPromptConsumed?.();
    if (typeof pendingPrompt === "string") {
      composerRef.current?.setDraft(pendingPrompt);
      // Focus after the coach panel becomes visible.
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    void openAsked(pendingPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingPrompt,
    checkingAuth,
    authStatus?.signedIn,
    claudeStatus?.state,
    chatSettings.provider
  ]);

  /**
   * What the athlete pointed at, waiting beside the composer until the next
   * question goes (P1.7). Sent as a `planRefs` entry just before it.
   */
  const [pendingRefs, setPendingRefs] = useState<PlanRef[]>([]);
  const refKey = (ref: PlanRef) =>
    `${ref.draftId}|${ref.scope}|${ref.weekIndex ?? ""}|${ref.sessionKey ?? ""}`;
  const addRef = (ref: PlanRef) => {
    setPendingRefs((current) =>
      current.some((item) => refKey(item) === refKey(ref)) ? current : [...current, ref].slice(-3)
    );
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  /**
   * Coach opened from the Library about a plan it wrote: the conversation that
   * wrote it, with the plan beside the composer. A conversation deleted since
   * took the plan's drafts with it, so a new one starts from the plan's name.
   */
  const openAsked = async (request: CoachOpenRequest) => {
    if (!api) return;
    if (request.newPlan) {
      await startPlanConversation();
      return;
    }
    const sessionId = request.draftId
      ? await api.findChatSessionForDraft(request.draftId).catch(() => null)
      : null;
    if (sessionId) {
      if (sessionId !== activeSessionIdRef.current) await loadSession(sessionId);
      setPendingRefs(request.refs ?? []);
    } else if (request.draftId) {
      await handleNewChat();
      setPendingRefs([]);
      const name = request.refs?.[0]?.name;
      if (name) composerRef.current?.setDraft(`About my plan "${name}": `);
    }
    if (request.prompt) composerRef.current?.setDraft(request.prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  /**
   * AI Plan (P2.5): a new conversation named "New plan" that opens on a blank
   * brief — the generator's defaults, no model asked. It takes Coach's
   * settings, as any new conversation does, and is named after the goal once
   * the brief has one.
   */
  const startPlanConversation = async () => {
    if (!api) return;
    if (streaming || exportingLatestActivity) {
      // The request is already consumed, so dropping it would lose the click.
      onError("Coach is still answering. Press AI Plan again when it has finished.");
      return;
    }
    onError(null);
    try {
      const created = await api.createChatSession(chatSettings.provider);
      const brief = await api.createPlanBrief(created.id);
      const titled = (await api.renameChatSession(created.id, NEW_PLAN_TITLE).catch(() => null)) ?? created;
      setSessions((current) => [titled, ...current]);
      setActiveSessionId(created.id);
      persistedBaseRef.current = 0;
      resetEphemeralChatState();
      setPlanBriefs((current) => ({ ...current, [brief.artifactId]: brief }));
      const entries: ChatEntry[] = [{ kind: "planBrief", artifactId: brief.artifactId }];
      setTimeline(entries);
      persistHistory(created.id, entries, true);
    } catch (caught) {
      onError(remoteErrorMessage(caught, "Could not start a plan."));
    }
  };

  const resetEphemeralChatState = () => {
    // A reference belongs to the conversation it was picked in.
    setPendingRefs([]);
    setUploadedPlans({});
    pendingCoachPromptsRef.current = [];
    resumedCoachPromptRef.current = null;
  };

  const persistHistory = (
    sessionId: string | null,
    entries: ChatEntry[],
    immediate = false
  ) => {
    if (!api || !sessionId) return;
    const run = () => {
      pendingSaveRef.current = null;
      const persisted = toPersistedEntries(entries);
      const knownEntryCount = persistedBaseRef.current;
      // Advanced at send time, not on the reply. Handlers run in send order, so
      // the row ends up holding this array; waiting for the reply would let an
      // earlier save's answer roll the base backwards.
      persistedBaseRef.current = persisted.length;
      const saved: Promise<void> = api
        .saveChatSession(sessionId, persisted, { knownEntryCount })
        .then((summary) => {
          if (!summary) return;
          setSessions((current) => {
            const index = current.findIndex((session) => session.id === summary.id);
            if (index < 0) {
              return [summary, ...current];
            }
            const next = [...current];
            next[index] = summary;
            next.sort(
              (left, right) =>
                new Date(right.updatedAt).getTime() -
                new Date(left.updatedAt).getTime()
            );
            return next;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          inFlightSavesRef.current.delete(saved);
        });
      inFlightSavesRef.current.add(saved);
    };
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    pendingSaveRef.current = run;
    if (immediate) {
      run();
      return;
    }
    persistTimeoutRef.current = setTimeout(run, 300);
  };

  /**
   * Everything this window has to say about the open conversation, on disk.
   *
   * Anything that re-reads the row has to go through here first. Between the
   * end of a turn and the save landing there is a window — a debounce plus an
   * IPC round trip — in which the row still holds the transcript as it was
   * *before* the turn: the athlete's question is saved at send time, the answer
   * and the charts only at the end. A read taken inside that window comes back
   * without the turn, and `reloadTranscript` then puts that on screen.
   *
   * That is the bug this exists for, and it was reached by a sync pull rather
   * than by anything the athlete did: the pull defers its re-read to the end of
   * the turn (`syncReloadPendingRef`), which lands it precisely inside the
   * window. The answer and its charts came off the screen a moment after
   * arriving, and reopening the app did not bring them back — the reload also
   * cancelled the pending save that held them, so the only copy was dropped.
   */
  const flushPendingSave = async (): Promise<void> => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
      pendingSaveRef.current?.();
    }
    if (inFlightSavesRef.current.size > 0) {
      await Promise.allSettled([...inFlightSavesRef.current]);
    }
  };

  const refreshSessionAttention = useCallback(async () => {
    if (!api) return;
    try {
      const rows = await api.listCoachAnalysisSessionAttention();
      setSessionAttention(new Map(rows.map((row) => [row.sessionId, row])));
    } catch {
      // A conversation list without its marks is still a conversation list.
    }
  }, [api]);

  /**
   * Opening a conversation is what reading it means (9.3). Only re-reads the
   * marks when something actually cleared, so switching between conversations
   * with nothing unread costs one call rather than two.
   */
  const markSessionRead = useCallback(
    async (sessionId: string) => {
      if (!api) return;
      try {
        if ((await api.markCoachAnalysisSessionSeen(sessionId)) > 0) {
          await refreshSessionAttention();
        }
      } catch {
        // The dot is a hint, not state the athlete can lose work over.
      }
    },
    [api, refreshSessionAttention]
  );

  const loadSession = async (sessionId: string) => {
    if (!api) return;
    try {
      // The conversation being left may still owe the row a save, and that
      // save carries `persistedBaseRef` — which is about to start describing a
      // different conversation. Letting it land afterwards would file one
      // transcript's length against another's row.
      await flushPendingSave();
      const entries = await api.getChatSession(sessionId);
      persistedBaseRef.current = entries.length;
      setTimeline(fromPersistedEntries(entries));
      resetEphemeralChatState();
      setActiveSessionId(sessionId);
      void markSessionRead(sessionId);
    } catch {
      // Nothing was read, so nothing is known about the row: a save from here
      // must not be taken as authority to shorten it.
      persistedBaseRef.current = 0;
      setTimeline([]);
      resetEphemeralChatState();
    }
  };

  /**
   * Re-reads the open conversation from disk. An analysis run persists in the
   * main process, behind this window's back, so the transcript on screen is the
   * only copy that does not know about it — and the next thing the athlete
   * types would save that stale copy straight over the coach's answer.
   */
  const reloadTranscript = async (sessionId: string) => {
    if (!api) return;
    try {
      // Before the read, never after: the row is about to become what is on
      // screen, so anything this window has not written yet would be read as
      // never having existed. Flushing rather than cancelling is what keeps
      // both copies — the save carries the base it was built with, so 5.6b's
      // merge still holds back the tail an analysis run appended, which is
      // what the cancel here used to be protecting.
      await flushPendingSave();
      const entries = await api.getChatSession(sessionId);
      // The athlete may have switched conversations while this was in flight.
      if (activeSessionIdRef.current !== sessionId) return;
      persistedBaseRef.current = entries.length;
      setTimeline(fromPersistedEntries(entries));
    } catch {
      // Keep what is on screen rather than blanking a readable transcript.
    }
  };

  /**
   * A run log row names the conversation the coach wrote into, and reading what
   * it said is the obvious next thing to do — so the row opens it, from behind
   * the modal that is covering it.
   *
   * The list is re-read first rather than searched as it stands: a `per-run`
   * conversation may be newer than anything this window has heard of, and one
   * from an old run may have been deleted since. Loading a session id no row
   * exists for would leave the sidebar with nothing selected and the composer
   * writing into a conversation that is not there.
   */
  const openRunConversation = async (sessionId: string) => {
    if (!api) return;
    const listed = await refreshSessions(chatSettings.provider);
    if (!listed.some((session) => session.id === sessionId)) {
      onError("That conversation is no longer here — it may have been deleted.");
      return;
    }
    onError(null);
    setAnalysisTarget(null);
    setAnalysesVersion((value) => value + 1);
    await loadSession(sessionId);
  };

  const refreshSessions = useCallback(
    async (provider: ChatProvider) => {
      if (!api) return [];
      const listed = await api.listChatSessions(provider);
      setSessions(listed);
      return listed;
    },
    [api]
  );

  const ensureActiveSession = async (provider: ChatProvider) => {
    if (!api) return null;
    const listed = await refreshSessions(provider);
    if (listed.length > 0) {
      await loadSession(listed[0].id);
      return listed[0].id;
    }
    const created = await api.createChatSession(provider);
    setSessions([created]);
    setActiveSessionId(created.id);
    persistedBaseRef.current = 0;
    setTimeline([]);
    resetEphemeralChatState();
    return created.id;
  };

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Attaching or detaching a coach changes which conversations carry the mark,
  // so the list re-reads on the same version counter the header chips use.
  useEffect(() => {
    void refreshSessionAttention();
  }, [refreshSessionAttention, analysesVersion]);

  /**
   * The ⚡ mark is "an analysis speaks here", and its switch is what makes it
   * live — `listCoachAnalysisSessionAttention` skips a disabled one. Switching
   * one off therefore moves the mark on a conversation this window may not
   * even have open, with no run to say so.
   */
  useEffect(() => {
    if (!api?.onCoachAnalysisUpdate) return;
    return api.onCoachAnalysisUpdate(() => {
      void refreshSessionAttention();
    });
  }, [api, refreshSessionAttention]);

  /**
   * A run reaches into the conversation list from outside this window: every
   * run bumps whatever it wrote into to the top (9.3), and the conversation it
   * wrote into may be one this window has never opened.
   *
   * The sidebar renders from a list this window read once, on mount and on a
   * provider change, so none of that was visible until the app was restarted:
   * a conversation the window had never heard of was simply not in the array,
   * and the reorder had nothing to reorder. The `running` update carries the
   * session id too — the conversation exists before the model is asked
   * anything — so a new one appears while the run is still going, which is the
   * only way the athlete can open it and watch the answer arrive.
   */
  useEffect(() => {
    if (!api?.onCoachAnalysisRunUpdate) return;
    // The provider on screen, not the run's: an analysis may run on one of
    // its own (decision 2), and that conversation belongs to that provider's
    // list rather than this one.
    const provider = chatSettings.provider;
    return api.onCoachAnalysisRunUpdate((run) => {
      if (!run.sessionId) return;
      void refreshSessions(provider).catch(() => undefined);
    });
  }, [api, chatSettings.provider, refreshSessions]);

  /**
   * 9.3: a run into a conversation the athlete is *not* looking at is exactly
   * what the unread dot is for. The live-view subscription below ignores those,
   * so this one watches every run.
   */
  useEffect(() => {
    if (!api?.onCoachAnalysisRunUpdate) return;
    return api.onCoachAnalysisRunUpdate((run) => {
      // Still working: nothing has landed in any conversation yet.
      if (run.status === "running") return;
      if (
        run.sessionId &&
        run.sessionId === activeSessionIdRef.current &&
        viewActiveRef.current
      ) {
        // The conversation is open *and* on screen, and the reload has already
        // put the answer in it, so it is read the moment it arrives. With the
        // Coach panel behind another view this branch would mark a run read
        // that the athlete never saw, and the dot the run exists to raise would
        // be cleared before it was ever drawn.
        void markSessionRead(run.sessionId);
        return;
      }
      void refreshSessionAttention();
    });
  }, [api, markSessionRead, refreshSessionAttention]);

  useEffect(() => {
    liveAnalysisRef.current = liveAnalysis;
  }, [liveAnalysis]);

  /**
   * Coming back to the Coach view is reading whatever landed while it was
   * hidden -- the transcript is already on screen with the answer in it, so a
   * dot on the row the athlete is looking at would never clear.
   */
  useEffect(() => {
    viewActiveRef.current = active;
    if (active && activeSessionId) {
      void markSessionRead(activeSessionId);
    }
  }, [active, activeSessionId, markSessionRead]);

  /**
   * The run record carries ids, not the coach's name, so the chip is worth one
   * lookup: an athlete watching a bubble needs to know which of their coaches
   * is speaking.
   */
  const showLiveAnalysis = useCallback(
    (run: CoachAnalysisRun) => {
      setLiveAnalysis({ runId: run.id, name: "Analysis coach", text: "" });
      void api
        ?.getCoachAnalysis(run.analysisId)
        .then((analysis) => {
          if (!analysis) return;
          setLiveAnalysis((current) =>
            current?.runId === run.id
              ? { ...current, name: analysis.name }
              : current
          );
        })
        .catch(() => undefined);
    },
    [api]
  );

  /**
   * Switching conversations drops whatever was streaming into the old one; the
   * run keeps going in the main process and its output is on disk either way.
   *
   * And it picks up whatever is streaming into the new one. The subscription
   * below only ever hears about a run while its conversation is already open,
   * so opening one mid-run — a conversation jumping to the top of the sidebar
   * is exactly what invites the athlete to do that — showed an empty
   * transcript with nothing to say why. The text
   * already streamed is gone, but the bubble says who is working and the tokens
   * from here on land in it.
   */
  useEffect(() => {
    setLiveAnalysis(null);
    if (!api || !activeSessionId) return;
    let cancelled = false;
    void api
      .listCoachAnalysisRuns({
        sessionId: activeSessionId,
        statuses: ["running"],
        limit: 1
      })
      .then((runs) => {
        if (cancelled || !runs.length) return;
        showLiveAnalysis(runs[0]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, activeSessionId, showLiveAnalysis]);

  /**
   * A run that targets the conversation on screen has to show up in it as it
   * happens — an analysis the athlete triggered and then cannot see reads as
   * a button that did nothing.
   */
  useEffect(() => {
    if (!api?.onCoachAnalysisRunUpdate) return;
    return api.onCoachAnalysisRunUpdate((run) => {
      if (!run.sessionId || run.sessionId !== activeSessionIdRef.current) return;

      if (run.status === "running") {
        showLiveAnalysis(run);
        return;
      }

      if (liveAnalysisRef.current?.runId === run.id) {
        setLiveAnalysis(null);
      }

      // A skip never reached the model and adds nothing. A silent run does add
      // something now — the one-line trace saying the coach looked (5.5) — so
      // it reloads on the same path as an answer, and the trace is what
      // explains the live bubble disappearing.
      if (run.status !== "success" && run.status !== "silent") return;
      // Reloaded straight away even mid-turn. Waiting for the athlete's turn to
      // end is worse than useless: their turn persists the whole timeline, so
      // the copy on screen — which predates the run — would be written over the
      // coach's answer before the deferred reload ever got to see it.
      void reloadTranscript(run.sessionId);
    });
  }, [api, showLiveAnalysis]);

  /**
   * A conversation written on another machine.
   *
   * Sync merges `chat_sessions` rows straight into SQLite, behind this window's
   * back — the same shape of change an analysis run makes, arriving from a
   * different direction. Nothing here noticed: the sidebar rendered the list it
   * read on mount and the transcript its copy from `loadSession`, so a
   * conversation held or extended on the other computer only appeared after a
   * restart, which is what the Sync panel's "Restart to see everything" was
   * apologising for.
   *
   * `tables`, not the count: a pull carrying nothing but preferences must not
   * cost the sidebar a query, and a pull carrying a coach's schedule must not
   * cost it a transcript re-read.
   */
  useEffect(() => {
    if (!api?.onSyncChanged) return;
    // The provider on screen, for the reason the run-update subscription gives:
    // the list belongs to a provider, and a merged conversation of another
    // provider's is not in it.
    const provider = chatSettings.provider;
    return api.onSyncChanged((change) => {
      if (change.tables.includes("coach_analyses")) {
        // Which conversations carry the ⚡ mark is a fact about the analyses,
        // so a merged one moves it on conversations this window never touched.
        // `coach_analyses` is the only table of the feature that travels: a
        // private trigger is `device` tier and a run is `derived`, so neither
        // arrives here. Same counter creating and deleting bumps.
        setAnalysesVersion((value) => value + 1);
      }

      // A brief or an outline written on another machine (P2.1–P2.2): the
      // cards read them through `planBriefs`, which is let go so they are
      // read again; a conversation's settings likewise (P2.0).
      if (change.tables.includes("chat_plan_artifacts")) setPlanBriefs({});
      // A proposal applied or dismissed on the other machine (P3.2).
      if (change.tables.includes("chat_schedule_changes")) setScheduleChanges({});
      if (change.tables.includes("chat_conversation_settings")) {
        setConversationSettingsVersion((value) => value + 1);
      }

      if (!change.tables.includes("chat_sessions")) return;
      void refreshSessions(provider).catch(() => undefined);

      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      // Mid-turn the copy on screen is the newer one — the athlete's message
      // and the tokens under it are not in the row yet — so replacing it would
      // take their own words off the screen. `foreignTail` keeps the merged
      // entries safe in the row meanwhile (5.6b), so this only has to wait for
      // the turn to end.
      if (chatBusyRef.current) {
        syncReloadPendingRef.current = sessionId;
        return;
      }
      void reloadTranscript(sessionId);
    });
  }, [api, chatSettings.provider, refreshSessions]);

  // Load sign-in/provider state on mount.
  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setCheckingAuth(false);
      return;
    }
    void Promise.allSettled([
      api.getChatAuthStatus(),
      api.getChatSettings(),
      api.getClaudeCodeStatus()
    ])
      .then(async ([authResult, settingsResult, claudeResult]) => {
        if (cancelled) return;
        setAuthStatus(
          authResult.status === "fulfilled"
            ? authResult.value
            : { signedIn: false }
        );
        const settings =
          settingsResult.status === "fulfilled"
            ? settingsResult.value
            : DEFAULT_CHAT_SETTINGS;
        setChatSettings(settings);
        if (claudeResult.status === "fulfilled") {
          setClaudeStatus(claudeResult.value);
        }
        await ensureActiveSession(settings.provider);
      })
      .finally(() => {
        if (!cancelled) setCheckingAuth(false);
      });
    return () => {
      cancelled = true;
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      if (claudePollTimerRef.current) {
        clearTimeout(claudePollTimerRef.current);
        claudePollTimerRef.current = null;
      }
      if (chatHighlightTimeoutRef.current) {
        clearTimeout(chatHighlightTimeoutRef.current);
        chatHighlightTimeoutRef.current = null;
      }
    };
  }, [api]);

  useEffect(() => {
    if (!api || checkingAuth || streaming || !activeSessionId) return;
    persistHistory(activeSessionId, timeline);
  }, [api, checkingAuth, streaming, timeline, activeSessionId]);

  useEffect(() => {
    onActivityChange?.(streaming || exportingLatestActivity);
  }, [streaming, exportingLatestActivity, onActivityChange]);

  // The turn is over, so a reload a pull had to hold back can happen now.
  useEffect(() => {
    chatBusyRef.current = streaming || exportingLatestActivity;
    if (chatBusyRef.current) return;
    const sessionId = syncReloadPendingRef.current;
    syncReloadPendingRef.current = null;
    if (!sessionId || sessionId !== activeSessionIdRef.current) return;
    void reloadTranscript(sessionId);
    // `reloadTranscript` reads refs and setters only, so the closure this
    // captures is as good as a fresh one — the same reason the run-update
    // subscription above can hold on to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, exportingLatestActivity]);

  // Provider settings and the Claude account are edited in Settings now, under
  // Connections, so re-read them whenever Coach comes back to the front. This
  // panel stays mounted once opened; without this the provider picker would
  // still show whatever was configured the first time it was shown.
  useEffect(() => {
    if (!api || !active || checkingAuth) return;
    let cancelled = false;

    void (async () => {
      const [settings, claude] = await Promise.allSettled([
        api.getChatSettings(),
        api.getClaudeCodeStatus()
      ]);
      if (cancelled) return;
      if (settings.status === "fulfilled") setChatSettings(settings.value);
      if (claude.status === "fulfilled") setClaudeStatus(claude.value);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, api, checkingAuth]);

  // Ask about dead MCP sessions here rather than at launch: nothing opens an
  // OAuth window on the athlete's behalf any more, so this is the one place
  // the question gets asked, and only for the view whose tools need it.
  //
  // Keyed on `active`, not on mount: the Coach panel stays mounted once it has
  // been opened, so a mount effect would fire once per app run and "Later"
  // could never come back.
  useEffect(() => {
    if (!api || !active) return;
    let cancelled = false;

    void (async () => {
      // Let the silent reconnect settle before calling a session dead, so a
      // slow restore is not reported as a failure.
      const [statuses, servers] = await Promise.all([
        api.ensureMcpConnected().catch(() => null),
        api.listMcpServers().catch(() => [] as McpServerConfig[])
      ]);
      if (cancelled || !statuses) return;

      // authType "none" servers have nothing to authorize, so a failure there
      // is a network problem and "Authorize" would be a dead end.
      const authRequired = new Set(
        servers
          .filter((server) => server.authType !== "none")
          .map((server) => server.id)
      );
      // `authenticated` means credentials are on disk, so it is the record
      // that this server was connected at some point. Requiring it keeps the
      // prompt to sessions that broke, and stays silent about servers that
      // were registered but never connected — those are not a fault to report.
      const broken = statuses.filter(
        (status) =>
          status.enabled &&
          status.authenticated &&
          !status.connected &&
          authRequired.has(status.id)
      );

      if (broken.length > 0) {
        setMcpPrompt(broken);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, active]);

  // Skip: drop the stored session, and nothing else.
  //
  // That is enough to settle the question. The prompt only fires for servers
  // whose credentials are on disk, so clearing them takes this server out of
  // the set and it stops being asked about. The server stays enabled and
  // reconnectable from the MCP panel.
  const handleMcpPromptSkip = useCallback(async () => {
    if (!api || mcpPrompt.length === 0) return;
    setMcpPromptBusy(true);
    try {
      await Promise.all(
        mcpPrompt.map(async (server) => {
          try {
            await api.disconnectMcpServer(server.id);
          } catch (caught) {
            onError(
              caught instanceof Error
                ? caught.message
                : `${server.name} session could not be cleared.`
            );
          }
        })
      );
    } finally {
      setMcpPrompt([]);
      setMcpPromptBusy(false);
    }
  }, [api, mcpPrompt, onError]);

  // Later: touch nothing. The effect above re-runs the next time Coach becomes
  // the active view, so the question comes back on its own.
  const handleMcpPromptLater = useCallback(() => {
    setMcpPrompt([]);
  }, []);

  const handleMcpPromptAuthorize = useCallback(async () => {
    if (!api || mcpPrompt.length === 0) return;
    const targets = mcpPrompt;
    setMcpPromptBusy(true);
    setMcpPrompt([]);
    try {
      for (const server of targets) {
        // Sequential on purpose: each authorization opens its own modal window
        // and they share one loopback callback port, so two at once collide.
        try {
          await api.connectMcpServer(server.id);
        } catch (caught) {
          onError(
            caught instanceof Error
              ? caught.message
              : `${server.name} connection failed.`
          );
        }
      }
    } finally {
      setMcpPromptBusy(false);
    }
  }, [api, mcpPrompt, onError]);

  // Subscribe once to the streaming push channels.
  useEffect(() => {
    if (!api) return;
    const restoreResumedCoachPrompt = () => {
      const originalPrompt = resumedCoachPromptRef.current;
      resumedCoachPromptRef.current = null;
      if (!originalPrompt) return;
      setTimeline((prev) => {
        const next = prev.map((entry): ChatEntry =>
          entry.kind === "coachPrompt" &&
          entry.prompt.promptId === originalPrompt.promptId
            ? { ...entry, prompt: originalPrompt }
            : entry
        );
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
    };
    const finishStreaming = (done: {
      fullText: string;
      finishReason?: string;
      usage?: ChatTokenUsage;
      model?: string;
    }) => {
      const { fullText: finalText, finishReason, usage, model } = done;
      activeRequestIdRef.current = null;
      streamedTextRef.current = "";
      setStreaming(false);
      setStreamingText("");
      setThinkingText("");
      setActiveTool(null);
      const source = sourceRef.current ?? undefined;
      const reasoningSummary = thinkingRef.current.trim() || undefined;
      thinkingRef.current = "";
      const coachPrompts = pendingCoachPromptsRef.current;
      pendingCoachPromptsRef.current = [];
      setCurrentSource(null);
      sourceRef.current = null;
      if (finishReason === "cancelled") {
        restoreResumedCoachPrompt();
        // A card the turn produced before Stop is on screen and has a draft
        // behind it; unsaved, it dropped out of the conversation on reload
        // while its draft stayed.
        setTimeline((prev) => {
          if (prev.length > turnStartRef.current) {
            persistHistory(activeSessionIdRef.current, prev, true);
          }
          return prev;
        });
        return;
      }
      resumedCoachPromptRef.current = null;
      if (finalText || coachPrompts.length > 0) {
        setTimeline((prev) => {
          const closing: ChatEntry[] = [];
          if (source?.mcpError) {
            closing.push({ kind: "toolNotice", message: source.mcpError });
          }
          if (finalText) {
            closing.push({
              kind: "message",
              role: "assistant",
              content: finalText,
              source,
              reasoningSummary,
              // Stored on the entry, not held in a ref beside the timeline: the
              // footer has to survive the reload that `persistHistory` below is
              // preparing for, and a cost the athlete can only see until they
              // switch conversations is not one they can act on.
              ...(usage ? { usage } : {}),
              ...(model ? { model } : {})
            });
          }
          let next = settleTurnEntries(prev, turnStartRef.current, closing);
          for (const prompt of coachPrompts) {
            next = upsertCoachPromptEntry(next, prompt);
          }
          markSettled(prev, next);
          persistHistory(activeSessionIdRef.current, next, true);
          return next;
        });
      }
    };

    const unsubscribers = [
      api.onChatStreamStart((payload) => {
        if (payload.requestId === liveAnalysisRef.current?.runId) {
          setLiveAnalysis((current) =>
            current?.runId === payload.requestId ? { ...current, text: "" } : current
          );
          return;
        }
        if (payload.requestId !== activeRequestIdRef.current) return;
        streamedTextRef.current = "";
        setStreamingText("");
        setThinkingText("");
        thinkingRef.current = "";
        setActiveTool(null);
        pendingCoachPromptsRef.current = [];
      }),
      api.onChatStreamToken((payload) => {
        // A run's tokens must never touch the athlete's own streaming state:
        // that state gets persisted as their turn when the stream ends, and the
        // runner has already written the same text from the main process.
        if (payload.requestId === liveAnalysisRef.current?.runId) {
          setLiveAnalysis((current) =>
            current?.runId === payload.requestId
              ? { ...current, text: current.text + payload.delta }
              : current
          );
          return;
        }
        if (payload.requestId !== activeRequestIdRef.current) return;
        setActiveTool(null);
        advanceStep(payload.requestId, { kind: "text", delta: payload.delta });
        streamedTextRef.current += payload.delta;
        setStreamingText((prev) => prev + payload.delta);
      }),
      api.onChatStreamInfo((payload) => {
        // Cards (plan drafts, charts) belong to whoever asked for them; an
        // analysis's transcript is reloaded from disk when its run ends.
        if (payload.requestId === liveAnalysisRef.current?.runId) return;
        if (payload.requestId !== activeRequestIdRef.current) return;
        if (payload.kind === "context" && payload.snapshotIncluded) {
          advanceStep(payload.requestId, { kind: "snapshot" });
        } else if (payload.kind === "thinking") {
          advanceStep(payload.requestId, { kind: "thinking", delta: payload.delta });
        } else if (payload.kind === "mcp" && payload.status === "call") {
          advanceStep(payload.requestId, { kind: "call", tool: payload.tool });
        } else if (payload.kind === "planDraft" || payload.kind === "planOutline") {
          advanceStep(payload.requestId, { kind: "passed" });
        }
        if (payload.kind === "context") {
          sourceRef.current = {
            snapshotIncluded: payload.snapshotIncluded,
            mcpEnabled: payload.mcpEnabled,
            mcpUsed: false,
            mcpTools: []
          };
          setCurrentSource(sourceRef.current);
        } else if (payload.kind === "planDraft") {
          setTimeline((prev) => upsertPlanDraftEntry(prev, payload.draft));
        } else if (payload.kind === "planEvent") {
          setTimeline((prev) => [...prev, { kind: "planEvent", event: payload.event }]);
        } else if (payload.kind === "planBrief") {
          const brief = payload.brief;
          setPlanBriefs((current) => ({ ...current, [brief.artifactId]: brief }));
          // Filling in a brief already on screen changes its card, not the timeline.
          setTimeline((prev) =>
            prev.some((entry) => entry.kind === "planBrief" && entry.artifactId === brief.artifactId)
              ? prev
              : [...prev, { kind: "planBrief", artifactId: brief.artifactId }]
          );
        } else if (payload.kind === "planOutline") {
          const brief = payload.brief;
          const outlineVersion = brief.outline?.version;
          setPlanBriefs((current) => ({ ...current, [brief.artifactId]: brief }));
          if (outlineVersion !== undefined) {
            // A turn whose outline is accepted twice rewrites its version, not its anchor.
            setTimeline((prev) =>
              prev.some(
                (entry) =>
                  entry.kind === "planOutline" &&
                  entry.artifactId === brief.artifactId &&
                  entry.outlineVersion === outlineVersion
              )
                ? prev
                : [...prev, { kind: "planOutline", artifactId: brief.artifactId, outlineVersion }]
            );
          }
        } else if (payload.kind === "scheduleChange") {
          const changeSet = payload.changeSet;
          setScheduleChanges((current) => ({ ...current, [changeSet.changeSetId]: changeSet }));
          setTimeline((prev) =>
            prev.some((entry) => entry.kind === "scheduleChange" && entry.changeSetId === changeSet.changeSetId)
              ? prev
              : [...prev, { kind: "scheduleChange", changeSetId: changeSet.changeSetId }]
          );
        } else if (payload.kind === "activityVisual") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertActivityVisualEntry(prev, payload.preview));
          }
        } else if (payload.kind === "fitnessTrend") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertFitnessTrendEntry(prev, payload.preview));
          }
        } else if (payload.kind === "hrZoneSummary") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertHrZoneEntry(prev, payload.preview));
          }
        } else if (payload.kind === "coachPrompt") {
          pendingCoachPromptsRef.current = [
            ...pendingCoachPromptsRef.current.filter(
              (prompt) => prompt.promptId !== payload.prompt.promptId
            ),
            payload.prompt
          ];
        } else if (payload.kind === "thinking") {
          thinkingRef.current += payload.delta;
          setThinkingText(thinkingRef.current);
        } else if (payload.kind === "mcp") {
          setActiveTool(payload.status === "call" ? payload.tool ?? null : null);
          const base: SourceInfo = sourceRef.current ?? {
            snapshotIncluded: false,
            mcpEnabled: true,
            mcpUsed: false,
            mcpTools: []
          };
          sourceRef.current = {
            ...base,
            mcpUsed: true,
            mcpTools: payload.tool
              ? [...base.mcpTools, payload.tool]
              : base.mcpTools,
            mcpError:
              /fail|error/i.test(payload.status) || payload.message
                ? payload.message ?? payload.status
                : base.mcpError
          };
          setCurrentSource(sourceRef.current);
        }
      }),
      api.onChatStreamDone((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        finishStreaming(payload);
        // A turn is the only thing that reveals Claude Code's default model, and
        // the main process saves it behind this window's back.
        if (
          chatSettings.provider === "claude-code" &&
          !chatSettings.claudeCode.defaultModel
        ) {
          void api
            .getChatSettings()
            .then(setChatSettings)
            .catch(() => undefined);
        }
      }),
      api.onChatStreamError((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        activeRequestIdRef.current = null;
        // What the turn already put in front of the athlete, taken before the
        // resets below clear it.
        const partialText = streamedTextRef.current.trim();
        streamedTextRef.current = "";
        const coachPrompts = pendingCoachPromptsRef.current;
        pendingCoachPromptsRef.current = [];
        const source = sourceRef.current ?? undefined;
        const reasoningSummary = thinkingRef.current.trim() || undefined;
        setStreaming(false);
        setStreamingText("");
        setThinkingText("");
        thinkingRef.current = "";
        setActiveTool(null);
        setCurrentSource(null);
        sourceRef.current = null;
        if (partialText || coachPrompts.length > 0) {
          // A failure that lands after the answer is not a failed answer. This
          // used to throw the whole turn away: the streamed text, the question
          // card the coach had just asked, and — through the restore below —
          // the athlete's choice on the previous card, which went back to
          // unanswered. It was persisted that way, so the answer the athlete
          // had watched arrive in full was gone for good, and the reset card
          // read as the coach asking its next question. Claude Code's turn
          // cap is reached exactly there, on the round after a question.
          //
          // So what was produced is kept, the card the athlete answered stays
          // answered because the coach acted on it, and a notice under the
          // answer says it was cut short — the banner alone is gone by the
          // next reload, and the athlete should not take a truncated answer
          // for a finished one.
          resumedCoachPromptRef.current = null;
          setTimeline((prev) => {
            let next = settleTurnEntries(
              prev,
              turnStartRef.current,
              partialText
                ? [
                    {
                      kind: "message",
                      role: "assistant",
                      content: partialText,
                      source,
                      reasoningSummary,
                      ...(payload.usage ? { usage: payload.usage } : {}),
                      ...(payload.model ? { model: payload.model } : {})
                    }
                  ]
                : []
            );
            for (const prompt of coachPrompts) {
              next = upsertCoachPromptEntry(next, prompt);
            }
            next.push({
              kind: "toolNotice",
              message: `Coach stopped before finishing: ${payload.message}`
            });
            markSettled(prev, next);
            persistHistory(activeSessionIdRef.current, next, true);
            return next;
          });
        } else {
          // Nothing reached the athlete, so the turn is simply undone: the
          // card goes back to waiting for an answer they can give again.
          restoreResumedCoachPrompt();
        }
        onError(payload.message);
        if (payload.authError) {
          setAuthStatus({ signedIn: false });
        }
        if (chatSettings.provider === "claude-code") {
          void api
            .getClaudeCodeStatus()
            .then(setClaudeStatus)
            .catch(() => undefined);
        }
      })
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [
    api,
    chatSettings.provider,
    chatSettings.claudeCode.defaultModel,
    chatSettings.visualizationsEnabled,
    onError
  ]);

  // Keep the transcript scrolled to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [
    timeline,
    streamingText,
    thinkingText,
    liveAnalysis,
    exportingLatestActivity
  ]);

  const handleSignIn = async () => {
    if (!api) return;
    setSigningIn(true);
    onError(null);
    try {
      const status = await api.loginChat();
      setAuthStatus(status);
      if (chatSettings.provider === "chatgpt") {
        await ensureActiveSession("chatgpt");
      }
    } catch (caught) {
      onError(remoteErrorMessage(caught, "ChatGPT sign-in failed."));
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!api) return;
    if (activeRequestIdRef.current) {
      void api.cancelChat(activeRequestIdRef.current);
      activeRequestIdRef.current = null;
      setStreaming(false);
      setStreamingText("");
    }
    const status = await api.logoutChat();
    setAuthStatus(status);
  };

  const refreshClaudeCodeStatus = async () => {
    if (!api || checkingClaude) return null;
    setCheckingClaude(true);
    onError(null);
    try {
      const status = await api.getClaudeCodeStatus();
      setClaudeStatus(status);
      return status;
    } catch (caught) {
      onError(
        remoteErrorMessage(caught, "Claude Code detection failed.")
      );
      return null;
    } finally {
      setCheckingClaude(false);
    }
  };

  const pollClaudeCodeStatus = (attempt = 0) => {
    if (!api || attempt >= 40) return;
    if (claudePollTimerRef.current) {
      clearTimeout(claudePollTimerRef.current);
    }
    claudePollTimerRef.current = setTimeout(() => {
      void api
        .getClaudeCodeStatus()
        .then((status) => {
          setClaudeStatus(status);
          if (status.state === "connecting" || status.state === "sign-in-required") {
            pollClaudeCodeStatus(attempt + 1);
          }
        })
        .catch(() => pollClaudeCodeStatus(attempt + 1));
    }, 1500);
  };

  const handleClaudeSignedIn = (status: ClaudeCodeStatus) => {
    setClaudeStatus(status);
    if (status.state === "connecting" || status.state === "sign-in-required") {
      pollClaudeCodeStatus();
    }
  };



  const handleUpdateClaudeCode = async (
    patch: Partial<ChatSettings["claudeCode"]>
  ) => {
    const nextClaudeCode = {
      ...chatSettings.claudeCode,
      ...patch,
      permissions: {
        ...chatSettings.claudeCode.permissions,
        ...(patch.permissions ?? {})
      }
    };
    const nextSettings = { ...chatSettings, claudeCode: nextClaudeCode };
    setChatSettings(nextSettings);
    // Only a different binary or credential store can invalidate the
    // connection. Clearing the status for a model, effort or permission change
    // made showClaudeGate true and dropped the athlete out of the conversation.
    const invalidatesConnection =
      patch.executablePath !== undefined ||
      patch.useAppScopedAuth !== undefined;
    if (invalidatesConnection) {
      setClaudeStatus(null);
    }
    if (!api) return;
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
      // Switching credential stores can flip the sign-in state, so re-read it
      // instead of leaving the caller staring at a cleared status.
      if (invalidatesConnection) {
        setClaudeStatus(await api.getClaudeCodeStatus());
      }
    } catch (caught) {
      onError(
        remoteErrorMessage(caught, "Could not save Claude settings.")
      );
    }
  };





  const handleNewChat = async () => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      const created = await api.createChatSession(chatSettings.provider);
      setSessions((current) => [created, ...current]);
      setActiveSessionId(created.id);
      persistedBaseRef.current = 0;
      setTimeline([]);
      resetEphemeralChatState();
    } catch (caught) {
      onError(remoteErrorMessage(caught, "Could not start a new chat."));
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity || sessionId === activeSessionId) {
      return;
    }
    onError(null);
    await loadSession(sessionId);
  };

  const handleTogglePinSession = async (sessionId: string, pinned: boolean) => {
    if (!api) return;
    onError(null);
    try {
      const summary = await api.setChatSessionPinned(sessionId, pinned);
      if (!summary) return;
      setSessions((current) =>
        current.map((session) =>
          session.id === summary.id ? summary : session
        )
      );
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : pinned
            ? "Could not pin chat."
            : "Could not unpin chat."
      );
    }
  };

  const handleRenameSession = async (sessionId: string, title: string) => {
    if (!api) return;
    onError(null);
    try {
      const summary = await api.renameChatSession(sessionId, title);
      if (!summary) return;
      setSessions((current) =>
        current.map((session) =>
          session.id === summary.id ? summary : session
        )
      );
    } catch (caught) {
      onError(
        remoteErrorMessage(caught, "Could not rename chat.")
      );
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      await api.deleteChatSession(sessionId);
      const listed = await refreshSessions(chatSettings.provider);
      if (sessionId === activeSessionId) {
        if (listed.length > 0) {
          await loadSession(listed[0].id);
        } else {
          const created = await api.createChatSession(chatSettings.provider);
          setSessions([created]);
          setActiveSessionId(created.id);
          persistedBaseRef.current = 0;
          setTimeline([]);
          resetEphemeralChatState();
        }
      }
    } catch (caught) {
      onError(remoteErrorMessage(caught, "Could not delete chat."));
    }
  };

  const handleProviderChange = async (provider: ChatProvider) => {
    if (!api || provider === chatSettings.provider) return;
    const nextSettings: ChatSettings = { ...chatSettings, provider };
    setChatSettings(nextSettings);
    onError(null);
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
      await ensureActiveSession(provider);
      if (provider === "claude-code") {
        const status = await api.getClaudeCodeStatus();
        setClaudeStatus(status);
      }
    } catch (caught) {
      onError(remoteErrorMessage(caught, "Provider change failed."));
    }
  };

  const handleEffortChange = async (effort: AnthropicEffort) => {
    if (!api || !supportsReasoningEffort(chatSettings.provider)) return;
    const nextSettings: ChatSettings =
      chatSettings.provider === "claude-api"
        ? { ...chatSettings, anthropic: { ...chatSettings.anthropic, effort } }
        : { ...chatSettings, claudeCode: { ...chatSettings.claudeCode, effort } };

    setChatSettings(nextSettings);
    setSavingSettings(true);
    onError(null);
    try {
      setChatSettings(await api.saveChatSettings(nextSettings));
    } catch (caught) {
      onError(
        remoteErrorMessage(caught, "Could not save the reasoning effort.")
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleModelChange = async (model: string) => {
    if (!api || chatSettings.provider === "local") return;
    const normalizedModel = model.trim() || undefined;
    const nextSettings: ChatSettings =
      chatSettings.provider === "claude-api"
        ? {
            ...chatSettings,
            anthropic: {
              ...chatSettings.anthropic,
              model: model.trim() || chatSettings.anthropic.model
            }
          }
        : chatSettings.provider === "claude-code"
          ? {
              ...chatSettings,
              claudeCode: {
                ...chatSettings.claudeCode,
                model: normalizedModel
              }
            }
          : chatSettings.provider === "openrouter"
            ? {
                ...chatSettings,
                openRouter: {
                  ...chatSettings.openRouter,
                  model: normalizedModel ?? "openrouter/auto"
                }
              }
            : {
                ...chatSettings,
                chatgpt: {
                  ...chatSettings.chatgpt,
                  model: normalizedModel
                }
              };

    setChatSettings(nextSettings);
    setSavingSettings(true);
    onError(null);
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
    } catch (caught) {
      onError(
        remoteErrorMessage(caught, "Could not save the selected model.")
      );
    } finally {
      setSavingSettings(false);
    }
  };






  const handleUpdateChatSettings = async (patch: Partial<ChatSettings>) => {
    const nextSettings = { ...chatSettings, ...patch };
    setChatSettings(nextSettings);
    if (!api) return;
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
    } catch {
      // keep local state even if persistence fails
    }
  };




  // First run on the local provider with no model chosen: pick one silently so
  // Coach is usable without a trip to Settings. The Coach Models dialog runs the
  // same routine from its Detect button — a failure here stays quiet, because
  // nothing the athlete did caused it.
  useEffect(() => {
    if (
      !api ||
      checkingAuth ||
      chatSettings.provider !== "local" ||
      chatSettings.local.model.trim() ||
      autoDetectLocalRef.current
    ) {
      return;
    }
    autoDetectLocalRef.current = true;
    void detectAndAdoptLocalServer(api, chatSettings, "")
      .then((result) => {
        if (result.settings) setChatSettings(result.settings);
      })
      .catch(() => undefined);
  }, [api, checkingAuth, chatSettings, chatSettings.provider, chatSettings.local.model]);


  /**
   * Rolls the conversation's summary forward when the window says it is time,
   * ahead of the athlete's own turn.
   *
   * Best-effort in every direction. No session yet (the very first turn), no
   * bridge, or a summariser that declined all answer the same way: send the
   * conversation whole. The one thing this must never do is fail the turn the
   * athlete is waiting on — a trimmed context is an optimisation, and an
   * optimisation that eats messages is a bug with a good excuse.
   */
  const compactBeforeSend = async (
    sessionId: string | null,
    entries: PersistedChatEntry[]
  ): Promise<ChatContextCompaction | null> => {
    if (!api || !sessionId) return null;
    compactingRef.current = true;
    setCompacting(true);
    try {
      return await api.compactChatContext(sessionId, entries);
    } catch {
      return null;
    } finally {
      compactingRef.current = false;
      setCompacting(false);
    }
  };

  /**
   * "Compact context" from the conversation menu: roll now rather than waiting
   * for the window to fill. Runs on the athlete's request, so it works even
   * with the automatic pass switched off in settings.
   *
   * The transcript on screen and on disk is untouched either way — this only
   * ever changes what the next turn sends.
   */
  const handleCompactSession = async (sessionId: string) => {
    if (!api || compactingSessionId) return;
    setCompactingSessionId(sessionId);
    try {
      const result = await api.compactChatContext(
        sessionId,
        // The open conversation's live timeline may hold turns the debounced
        // save has not written yet; any other one is only on disk.
        sessionId === activeSessionIdRef.current
          ? toPersistedEntries(timeline)
          : undefined,
        { force: true }
      );
      // All three outcomes go to the one toast stack, including the two that
      // are not failures. Compaction changes nothing on screen, so every
      // outcome is equally invisible and needs saying — and a second surface
      // just for the benign ones would mean an athlete watching the wrong
      // corner of the window for half of them.
      if (result.failed) {
        showToast(
          result.failureReason
            ? `Nothing was compacted: ${result.failureReason}. The conversation is unchanged.`
            : "The summariser did not answer, so nothing was compacted. The conversation is unchanged.",
          "error"
        );
      } else if (!result.rolled) {
        showToast(
          "This conversation is already short enough — nothing to compact.",
          "error"
        );
      } else {
        showToast(
          `Compacted. The next message sends a summary plus the last ${result.tailLength} ${
            result.tailLength === 1 ? "entry" : "entries"
          } in full.`
        );
      }
    } catch (caught) {
      showToast(
        remoteErrorMessage(caught, "Could not compact this conversation."),
        "error"
      );
    } finally {
      setCompactingSessionId(null);
    }
  };

  /**
   * Dev builds only: "Show context history".
   *
   * Reads what the next turn in this conversation would send. The main process
   * plans without rolling, so opening this changes nothing and costs nothing —
   * which is the only way a debug view of the context can be trusted to be
   * showing the context it would have had anyway.
   */
  const handleShowSessionContext = async (sessionId: string) => {
    if (!api) return;
    const title =
      sessions.find((session) => session.id === sessionId)?.title ??
      "This conversation";
    setContextInspection({ sessionId, title, result: null, error: null });
    try {
      const result = await api.inspectChatContext(
        sessionId,
        // Same reasoning as the compact action: the open conversation may hold
        // turns the debounced save has not written yet.
        sessionId === activeSessionIdRef.current
          ? toPersistedEntries(timeline)
          : undefined
      );
      setContextInspection((current) =>
        current?.sessionId === sessionId ? { ...current, result } : current
      );
    } catch (caught) {
      const message =
        remoteErrorMessage(caught, "Could not read the context.");
      setContextInspection((current) =>
        current?.sessionId === sessionId ? { ...current, error: message } : current
      );
    }
  };

  const sendMessage = async (
    trimmed: string,
    answeredPrompt?: { promptId: string; choiceId: string },
    /** What the question is about, when a chip says so rather than the composer. */
    aboutRefs?: PlanRef[],
    /** A step of the plan pipeline (P2.2): the words shown, the step's turn sent. */
    pipeline?: ChatPipelineStep
  ): Promise<boolean> => {
    if (!api || !trimmed || streaming || exportingLatestActivity) return false;
    if (isLatestActivityFileRequest(trimmed)) {
      await handleLatestActivityFileRequest(trimmed);
      return true;
    }
    // The AI this conversation answers with (P2.0), which may not be Coach's:
    // a key missing for Coach's provider must not block a conversation that
    // uses another, and one missing for the conversation's must.
    const turnProvider = conversationSettings?.runtime?.provider ?? chatSettings.provider;
    if (
      turnProvider === "openrouter" &&
      !chatSettings.openRouter.hasApiKey
    ) {
      onError("Add an OpenRouter API key in Settings, under Connections.");
      return false;
    }
    if (
      turnProvider === "local" &&
      !(conversationSettings?.runtime?.model?.trim() || chatSettings.local.model.trim())
    ) {
      onError("Enter a local model before starting the coach.");
      return false;
    }
    if (
      turnProvider === "claude-api" &&
      !chatSettings.anthropic.hasApiKey
    ) {
      onError(
        "Save an Anthropic API key in Settings, under Connections, before starting the coach."
      );
      return false;
    }
    let answeredPromptIndex = pipeline
      ? -1
      : answeredPrompt
      ? timeline.findIndex(
          (entry) =>
            entry.kind === "coachPrompt" &&
            entry.prompt.promptId === answeredPrompt.promptId &&
            entry.prompt.answeredAt === undefined
        )
      : -1;
    if (answeredPromptIndex < 0 && !pipeline) {
      for (let index = timeline.length - 1; index >= 0; index -= 1) {
        const entry = timeline[index];
        if (entry.kind === "coachPrompt" && entry.prompt.answeredAt === undefined) {
          answeredPromptIndex = index;
          break;
        }
      }
    }
    const promptEntry =
      answeredPromptIndex >= 0 ? timeline[answeredPromptIndex] : undefined;
    const originalPrompt =
      promptEntry?.kind === "coachPrompt" ? promptEntry.prompt : null;
    const answeredTimeline = timeline.map((entry, index): ChatEntry =>
      index === answeredPromptIndex && entry.kind === "coachPrompt"
        ? {
            ...entry,
            prompt: {
              ...entry.prompt,
              answer: trimmed,
              answeredAt: Date.now(),
              selectedChoiceId:
                answeredPrompt?.promptId === entry.prompt.promptId
                  ? answeredPrompt.choiceId
                  : undefined
            }
          }
        : entry
    );
    const refs = originalPrompt ? [] : aboutRefs ?? pendingRefs;
    const nextEntries: ChatEntry[] = originalPrompt
      ? answeredTimeline
      : [
          ...answeredTimeline,
          ...(refs.length ? [{ kind: "planRefs" as const, refs }] : []),
          { kind: "message", role: "user", content: trimmed }
        ];
    if (refs.length && !aboutRefs) setPendingRefs([]);
    const requestId = crypto.randomUUID();

    activeRequestIdRef.current = requestId;
    setStepRun(pipeline ? { requestId, step: pipeline.step, notes: EMPTY_NOTES, attempts: 0 } : null);
    turnStartRef.current = nextEntries.length;
    resumedCoachPromptRef.current = originalPrompt;
    sourceRef.current = null;
    setCurrentSource(null);
    setTimeline(nextEntries);
    // Keep the unanswered card durable until the resumed turn completes. If
    // the app closes mid-request, reloading the session can safely offer it
    // again instead of leaving an answered-but-incomplete invisible entry.
    if (!originalPrompt) {
      persistHistory(activeSessionIdRef.current, nextEntries, true);
    }
    setStreaming(true);
    setStreamingText("");
    onError(null);

    // The entries the main process counts are the persisted ones, so the wire
    // transcript is built from that array rather than from the timeline: a
    // `tailStart` measured in one and sliced from the other would cut the
    // conversation at a boundary that does not exist in it.
    const persisted = toPersistedEntries(nextEntries);
    // A pipeline step carries only its recent messages (P2.4), so compacting
    // before it would pay a summariser call for a summary it never sends.
    const context = pipeline
      ? null
      : await compactBeforeSend(activeSessionIdRef.current, persisted);
    // Stop landed while the summariser was running. Nothing has reached a
    // provider, and the athlete's turn is already in the transcript.
    if (activeRequestIdRef.current !== requestId) return true;
    // Every version the conversation's cards belong to, read now rather than
    // from state: the list on screen may still be on its way, and the index is
    // what tells the coach which draft_id is the newest.
    const creationIds = persisted.flatMap((entry) =>
      entry.kind === "planDraft" && !entry.draft.removedAt ? [entry.draft.draftId] : []
    );
    const versions = creationIds.length
      ? await api.getPlanArtifacts(creationIds).catch(() => artifactVersions)
      : [];
    const briefIds = [
      ...new Set(persisted.flatMap((entry) => (entry.kind === "planBrief" ? [entry.artifactId] : [])))
    ];
    const briefs = briefIds.length ? await api.getPlanBriefs(briefIds).catch(() => []) : [];
    if (activeRequestIdRef.current !== requestId) return true;
    const wireMessages = withCreationIndex(
      [
        ...(context?.summary ? [summaryContextMessage(context.summary)] : []),
        ...toWireMessages(persisted.slice(context?.tailStart ?? 0))
      ],
      persisted,
      Array.isArray(versions) ? versions : [],
      Array.isArray(briefs) ? briefs : []
    );
    try {
      await api.sendChat(requestId, wireMessages, unitSystem, activeSessionIdRef.current ?? undefined, pipeline);
    } catch (caught) {
      activeRequestIdRef.current = null;
      setStreaming(false);
      if (originalPrompt) {
        resumedCoachPromptRef.current = null;
        const restoredEntries = timeline.map((entry): ChatEntry =>
          entry.kind === "coachPrompt" &&
          entry.prompt.promptId === originalPrompt.promptId
            ? { ...entry, prompt: originalPrompt }
            : entry
        );
        setTimeline(restoredEntries);
        persistHistory(activeSessionIdRef.current, restoredEntries, true);
      } else if (pipeline) {
        // A step the main process refused before anything streamed (P2.2):
        // its words would sit in the conversation unanswered, and go to the
        // model on every later turn, so the step is taken back.
        setTimeline(timeline);
        persistHistory(activeSessionIdRef.current, timeline, true);
      }
      onError(remoteErrorMessage(caught, "Chat request failed."));
    }
    return true;
  };

  /** "Draw the outline", or a redraw with the athlete's note, as a turn of the conversation (P2.2). */
  const drawOutline = (artifactId: string, note?: string) =>
    sendMessage(outlineStepText(note), undefined, [], {
      step: "outline",
      artifactId,
      ...(note?.trim() ? { note: note.trim() } : {})
    });

  /** "Write the sessions" to the brief's outline, as a turn of the conversation (P2.3). */
  const writeSessions = (artifactId: string) =>
    sendMessage("Write the sessions", undefined, [], { step: "sessions", artifactId });
  /** Whether a brief's sessions are written: it has a version, and is a plan from then on. */
  const briefIsPlan = (artifactId: string) => artifactVersions.some((version) => version.artifactId === artifactId);

  const handleCoachPromptChoice = async (
    prompt: CoachInputPrompt,
    choice: CoachInputChoice
  ) => {
    await sendMessage(choice.response, {
      promptId: prompt.promptId,
      choiceId: choice.id
    });
  };

  const handleCustomCoachAnswer = () => {
    composerRef.current?.focus();
  };

  const handleStop = () => {
    if (!api || !activeRequestIdRef.current) return;
    void api.cancelChat(activeRequestIdRef.current);
    // A turn still being compacted has not reached a provider, so there is no
    // stream for the cancel above to find and no `chat:streamError` coming to
    // clear the spinner. The summariser turn itself runs under its own request
    // id and its own idle bound, and finishes on its own.
    if (compactingRef.current) {
      compactingRef.current = false;
      activeRequestIdRef.current = null;
      setCompacting(false);
      setStreaming(false);
    }
  };

  const handleUploadPlanDraft = async (
    draftId: string,
    destination: TrainingPlanDestination,
    scheduleDate?: string,
    keepInLibrary?: boolean,
    options?: PlanDraftSaveOptions
  ): Promise<UploadPlanResult | undefined> => {
    if (!api || uploadingDraftId) return undefined;
    setUploadingDraftId(draftId);
    setCorosConflict(null);
    onError(null);
    try {
      const result = await api.uploadTrainingPlanDraft(
        draftId,
        unitSystem,
        destination,
        scheduleDate,
        keepInLibrary,
        options
      );
      // The plan changed on COROS since this version was made: nothing was
      // written, and the athlete says which one stands (P1.6).
      if (result.conflict) {
        setCorosConflict({ draftId, name: result.planName });
        return result;
      }
      const scheduledDates = new Map(
        result.entries.flatMap((entry) => {
          if (!entry.date) return [];
          const normalized = entry.date.replace(/-/g, "");
          if (!/^\d{8}$/.test(normalized)) return [];
          return [[
            entry.key,
            `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
          ] as const];
        })
      );
      setUploadedPlans((prev) => ({ ...prev, [draftId]: result }));
      setTimeline((prev) => {
        const next = prev.map((entry) =>
          entry.kind === "planDraft" && entry.draft.draftId === draftId
            ? {
                ...entry,
                draft: {
                  ...entry.draft,
                  uploadedAt: Date.now(),
                  entries: entry.draft.entries.map((draftEntry) => {
                    const scheduledDate = scheduledDates.get(draftEntry.key);
                    const clearDate =
                      destination === "workoutLibrary" &&
                      entry.draft.artifactType === "workout";
                    return {
                      ...draftEntry,
                      scheduleDate: clearDate
                        ? undefined
                        : scheduledDate ?? draftEntry.scheduleDate,
                      source: draftEntry.source
                        ? {
                            ...draftEntry.source,
                            schedule_date: clearDate
                              ? undefined
                              : scheduledDate?.replace(/-/g, "") ??
                                draftEntry.source.schedule_date
                          }
                        : undefined
                    };
                  }),
                  uploadResult: {
                    workoutsScheduled: result.workoutsScheduled,
                    workoutsCreated: result.workoutsCreated,
                    destination: result.destination,
                    ...(result.planId ? { planId: result.planId } : {})
                  }
                }
              }
            : entry
        );
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
      onPlanUploaded?.();
    } catch (caught) {
      onError(
        remoteErrorMessage(caught, "Failed to save the workout or plan to COROS.")
      );
    } finally {
      setUploadingDraftId(null);
    }
  };

  /**
   * Take a creation out of the conversation.
   *
   * A mark on the draft, not a splice: the entry keeps its place in the
   * transcript so the array the window saves is the same length the row holds
   * — a shorter one is what `foreignTail` reads as a foreign append and undoes.
   * Whatever was already uploaded to COROS or saved to the library is left
   * alone; this removes the card, not the workout.
   */
  const handleRemovePlanDraft = (draftId: string) => {
    setOpenCreationId((current) => (current === draftId ? null : current));
    // A creation is removed whole: every version's card, or the one before
    // the newest would unfold in its place.
    const versionIds = new Set([
      draftId,
      ...(versionIndex.get(draftId)?.siblings.map((version) => version.draftId) ?? [])
    ]);
    const removed = planDrafts.filter((draft) => versionIds.has(draft.draftId));
    const saved = removed.some(
      (draft) => draft.uploadedAt || draft.uploadResult || uploadedPlans[draft.draftId]
    ) || (versionIndex.get(draftId)?.siblings.some((version) => version.uploadedAt) ?? false);
    // Unsaved, the drafts go too; saved, they stay, because the plan on COROS
    // names one. The cards are marked either way.
    if (api && removed.length > 0 && !saved) {
      void api.removePlanDraft(draftId).catch(() => undefined);
    }
    setTimeline((prev) => {
      const next = prev.map((entry): ChatEntry =>
        entry.kind === "planDraft" && versionIds.has(entry.draft.draftId) && !entry.draft.removedAt
          ? { ...entry, draft: { ...entry.draft, removedAt: Date.now() } }
          : entry
      );
      persistHistory(activeSessionIdRef.current, next, true);
      return next;
    });
  };

  /*
   * The edit replaces the card in place: same draft id, same position in the
   * transcript, so the array the window saves is the length the row holds and
   * the card's identity for sync is kept (`...entry.draft` first). `editedAt`
   * is what shows the coach this version on the next turn.
   */
  /*
   * A version the athlete made — an edit saved from the editor, or an older
   * version restored — goes at the end of the conversation, where it was made:
   * a line saying what happened, which is also how the coach is told once
   * rather than handed the whole plan on every turn after (P1.3), and then
   * the new version's card, under which the one it replaced folds away.
   */
  const appendVersion = (
    written: PlanVersionWritten,
    action: "edited" | "restored" | "imported" | "removedOnCoros",
    /** The conversation the write was asked from; a card never lands in another. */
    sessionId: string | null = activeSessionIdRef.current
  ) => {
    // An answer that arrives after the athlete moved to another conversation
    // belongs to the one it was asked from, which is no longer on screen: the
    // version is in the store, and the canvas lists it there.
    if (!sessionId || activeSessionIdRef.current !== sessionId) return;
    const event: ChatEntry = {
      kind: "planEvent",
      event: {
        eventId: crypto.randomUUID(),
        artifactId: written.artifactId,
        draftId: written.preview.draftId,
        action,
        author: action === "imported" || action === "removedOnCoros" ? "coros" : "athlete",
        name: written.preview.name,
        artifactType: written.preview.artifactType === "workout" ? "workout" : "plan",
        fromVersion: written.fromVersion,
        toVersion: written.toVersion,
        ...(written.changes.length ? { changes: written.changes } : {}),
        at: Date.now()
      }
    };
    setTimeline((prev) => {
      // Two asks can share one read against COROS (the canvas opening while
      // an edit begins), and so one version: its card goes in once.
      if (prev.some((entry) => entry.kind === "planDraft" && entry.draft.draftId === written.preview.draftId)) {
        return prev;
      }
      const next: ChatEntry[] = [...prev, event, { kind: "planDraft", draft: written.preview }];
      persistHistory(sessionId, next, true);
      return next;
    });
  };

  const handlePlanDraftEdited = (written: PlanVersionWritten) => {
    setEditingPlanDraftId(null);
    setEditingWorkoutDraftId(null);
    appendVersion(written, "edited");
  };

  const handleScrollToPlanChat = (draftId: string) => {
    const planIndex = timeline.findIndex(
      (entry) => entry.kind === "planDraft" && entry.draft.draftId === draftId
    );
    if (planIndex < 0) return;

    // The card itself: it is drawn in the conversation, under its answer.
    const targetIndex = planIndex;

    const transcript = scrollRef.current;
    const target = transcript?.querySelector<HTMLElement>(
      `[data-chat-entry-index="${targetIndex}"]`
    );
    if (!transcript || !target) return;

    const transcriptRect = transcript.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop =
      transcript.scrollTop +
      targetRect.top -
      transcriptRect.top -
      Math.max(24, (transcript.clientHeight - targetRect.height) / 2);

    transcript.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    setHighlightedChatEntryIndex(targetIndex);
    if (chatHighlightTimeoutRef.current) {
      clearTimeout(chatHighlightTimeoutRef.current);
    }
    chatHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedChatEntryIndex(null);
      chatHighlightTimeoutRef.current = null;
    }, 1800);
  };

  const settleScheduleChange = async (changeSetId: string, lineId: string | undefined, apply: boolean) => {
    if (!api || applyingChange) return;
    setApplyingChange({ changeSetId, lineId: lineId ?? "*" });
    onError(null);
    try {
      const set = apply
        ? await api.applyScheduleChange(changeSetId, lineId)
        : await api.dismissScheduleChange(changeSetId, lineId);
      setScheduleChanges((current) => ({ ...current, [changeSetId]: set }));
      if (apply) onPlanUploaded?.();
    } catch (caught) {
      onError(remoteErrorMessage(caught, apply ? "The change was not applied." : "The change was not dismissed."));
      // What COROS did before the failure is in the row: read it again.
      void api
        .getScheduleChanges([changeSetId])
        .then(([set]) => {
          if (set) setScheduleChanges((current) => ({ ...current, [changeSetId]: set }));
        })
        .catch(() => undefined);
    } finally {
      setApplyingChange(null);
    }
  };

  const handleLatestActivityFileRequest = async (trimmed: string) => {
    if (!api) return;

    const nextEntries: ChatEntry[] = [
      ...timeline,
      { kind: "message", role: "user", content: trimmed }
    ];
    setTimeline(nextEntries);
    persistHistory(activeSessionIdRef.current, nextEntries, true);
    setExportingLatestActivity(true);
    onError(null);

    try {
      const result = await api.exportLatestTrainingHubActivityFile(4);
      setTimeline((prev) => {
        const next: ChatEntry[] = [
          ...prev,
          {
            kind: "message",
            role: "assistant",
            content: formatLatestActivityExportMessage(result)
          }
        ];
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
    } catch (caught) {
      const message =
        remoteErrorMessage(caught, "Latest activity FIT export failed.");
      onError(message);
      setTimeline((prev) => {
        const next: ChatEntry[] = [
          ...prev,
          {
            kind: "message",
            role: "assistant",
            content: `I couldn't download the latest activity FIT file: ${message}`
          }
        ];
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
    } finally {
      setExportingLatestActivity(false);
    }
  };

  const isLocalProvider = chatSettings.provider === "local";
  const isClaudeProvider = chatSettings.provider === "claude-code";
  const isOpenRouterProvider = chatSettings.provider === "openrouter";
  const isClaudeApiProvider = chatSettings.provider === "claude-api";
  const isChatGptProvider = chatSettings.provider === "chatgpt";
  const localModelConfigured = chatSettings.local.model.trim().length > 0;
  const isBusy = streaming || exportingLatestActivity;
  const waitingForCoachAnswer = [...timeline]
    .reverse()
    .some(
      (entry) =>
        entry.kind === "coachPrompt" && entry.prompt.answeredAt === undefined
    );
  const showLoginGate = isChatGptProvider && !authStatus?.signedIn;
  const showClaudeGate =
    isClaudeProvider && claudeStatus?.state !== "connected";
  const showOpenRouterGate =
    isOpenRouterProvider && !chatSettings.openRouter.hasApiKey;
  const showAnthropicKeyGate =
    isClaudeApiProvider && !chatSettings.anthropic.hasApiKey;
  // A removed creation keeps its transcript entry — see `PlanDraftPreview.
  // removedAt` for why it cannot simply be spliced out — so every reader
  // filters here, and nothing downstream has to remember to.
  const planDrafts = timeline.flatMap((entry) =>
    entry.kind === "planDraft" && !entry.draft.removedAt ? [entry.draft] : []
  );
  /** What the Creations list shows: each creation once, as its newest version. */
  const listedCreations = planDrafts.filter((draft) =>
    isLatestVersion(versionIndex, draft.draftId)
  );
  /* The transcript's preview is light; the steps a card reviews or edits come
     from the draft's document. */
  const documentOf = (draft: PlanDraftPreview) =>
    planDocuments[`${draft.draftId}:${draft.editedAt ?? 0}`];
  const withSources = (draft: PlanDraftPreview) => withDocumentSources(draft, documentOf(draft));
  const documentForDraft = (draftId: string) => {
    const card = planDrafts.find((draft) => draft.draftId === draftId);
    return card ? documentOf(card) : undefined;
  };
  /* The one way into a creation's editor, from the card or the canvas. A
     workout's editor needs its steps, which only the document has. */
  const openCreationEditor = async (draftId: string) => {
    const draft = planDrafts.find((item) => item.draftId === draftId);
    if (!draft) return;
    if (draft.artifactType === "workout" && !documentOf(draft)) return;
    onError(null);
    if (draft.artifactType === "workout") {
      setEditingWorkoutDraftId(draftId);
      return;
    }
    // A plan on COROS is read against COROS first (D12): an edit made in the
    // Library comes in as the newest version, and the editor opens on that.
    let target = draftId;
    const sessionId = activeSessionIdRef.current;
    if (api && isOnCoros(versionIndex.get(draftId))) {
      const sync = await api
        .syncPlanFromCoros(draftId, unitSystem)
        .catch((): PlanCorosSync => ({ kind: "current" }));
      // Moved to another conversation while COROS answered: no editor opens there.
      if (activeSessionIdRef.current !== sessionId) return;
      if (sync.kind !== "current") {
        appendVersion(sync.written, sync.kind, sessionId);
        target = sync.written.preview.draftId;
      }
    }
    setEditingPlanDraftId(target);
  };
  /*
   * Opening a creation on COROS in the canvas asks the plan cache whether
   * COROS has moved on — no request — and brings a newer COROS version in.
   */
  const openCreation = (draftId: string) => {
    setOpenCreationId(draftId);
    if (!api || !isOnCoros(versionIndex.get(draftId))) return;
    const sessionId = activeSessionIdRef.current;
    void api
      .syncPlanFromCoros(draftId, unitSystem, true)
      .then((sync) => {
        if (sync.kind !== "current") appendVersion(sync.written, sync.kind, sessionId);
      })
      .catch(() => undefined);
  };
  /* An older version made the newest again: a new card, and a line saying
     so where it happened, as an edit leaves one. */
  const handleRestoreVersion = async (draftId: string) => {
    if (!api) return;
    onError(null);
    const sessionId = activeSessionIdRef.current;
    try {
      appendVersion(await api.restorePlanVersion(draftId, unitSystem), "restored", sessionId);
    } catch (caught) {
      onError(remoteErrorMessage(caught, "Could not restore that version."));
    }
  };
  const editingWorkoutDraft =
    editingWorkoutDraftId === null
      ? null
      : planDrafts.find((draft) => draft.draftId === editingWorkoutDraftId) ?? null;
  const editingWorkout = editingWorkoutDraft ? withSources(editingWorkoutDraft) : null;

  /**
   * Opening the panel is reserved for news, so this has to tell a creation
   * that just arrived from one that was already in the transcript when the
   * conversation was opened. Ids seen for this session are what separates
   * them; switching conversations adopts whatever is there and closes up,
   * because scrolling back through an old chat is not the coach proposing
   * anything.
   */
  const planDraftIdKey = planDrafts.map((draft) => draft.draftId).join("|");
  useEffect(() => {
    const ids = planDrafts.map((draft) => draft.draftId);
    if (planPanelSessionRef.current !== activeSessionId) {
      planPanelSessionRef.current = activeSessionId;
      seenPlanDraftIdsRef.current = new Set(ids);
      setPlanPanelOpen(false);
      setOpenCreationId(null);
      return;
    }
    const fresh = ids.filter((id) => !seenPlanDraftIdsRef.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seenPlanDraftIdsRef.current.add(id);
    setPlanPanelOpen(true);
    // `planDrafts` is rebuilt on every render; the id list is what actually
    // changes, and re-running on the array identity would reopen the panel on
    // every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, planDraftIdKey]);

  const providerSwitch = (
    <ProviderSwitch
      provider={chatSettings.provider}
      disabled={savingSettings || isBusy}
      onChange={(provider) => void handleProviderChange(provider)}
    />
  );
  const selectedModel =
    chatSettings.provider === "claude-api"
      ? chatSettings.anthropic.model
      : chatSettings.provider === "claude-code"
        ? chatSettings.claudeCode.model ?? ""
        : chatSettings.provider === "openrouter"
          ? chatSettings.openRouter.model
          : chatSettings.chatgpt.model ?? "";
  const selectedEffort =
    chatSettings.provider === "claude-api"
      ? chatSettings.anthropic.effort
      : chatSettings.claudeCode.effort;
  const providerControls = (
    <div className="chat-provider-controls">
      {providerSwitch}
      <ModelSwitch
        provider={chatSettings.provider}
        model={selectedModel}
        defaultModel={
          chatSettings.provider === "claude-code"
            ? (claudeStatus?.defaultModel ??
              chatSettings.claudeCode.defaultModel)
            : undefined
        }
        availableModels={
          chatSettings.provider === "claude-code"
            ? (claudeStatus?.availableModels ??
              chatSettings.claudeCode.availableModels)
            : undefined
        }
        disabled={savingSettings || isBusy}
        onChange={(model) => void handleModelChange(model)}
      />
      <EffortSwitch
        provider={chatSettings.provider}
        effort={selectedEffort}
        disabled={savingSettings || isBusy}
        onChange={(effort) => void handleEffortChange(effort)}
      />
    </div>
  );

  const conversationSidebarOpen = chatSettings.sidebarOpen !== false;
  const sidebarProps = {
    open: conversationSidebarOpen,
    overlay: false,
    sessions,
    activeSessionId,
    busy: isBusy,
    attention: sessionAttention,
    compactingSessionId,
    onClose: () => void handleUpdateChatSettings({ sidebarOpen: false }),
    onOpen: () => void handleUpdateChatSettings({ sidebarOpen: true }),
    onNewChat: () => void handleNewChat(),
    onSelectSession: (sessionId: string) => void handleSelectSession(sessionId),
    onTogglePinSession: (sessionId: string, pinned: boolean) =>
      void handleTogglePinSession(sessionId, pinned),
    onRenameSession: (sessionId: string, title: string) =>
      void handleRenameSession(sessionId, title),
    onCompactSession: (sessionId: string) => void handleCompactSession(sessionId),
    onShowSessionContext: (sessionId: string) =>
      void handleShowSessionContext(sessionId),
    onDeleteSession: (sessionId: string) => void handleDeleteSession(sessionId)
  };

  /**
   * Dev builds only, and portaled, so where it sits in the tree does not
   * matter — but it has to sit in *every* branch below, because the sidebar
   * that opens it renders in the sign-in gates too.
   */
  const contextHistoryDialog = contextInspection ? (
    <ContextHistoryDialog
      title={contextInspection.title}
      inspection={contextInspection.result}
      error={contextInspection.error}
      onClose={() => setContextInspection(null)}
    />
  ) : null;

  const settingsModalProps = {
    api,
    open: settingsOpen,
    chatSettings,
    onClose: () => setSettingsOpen(false),
    onUpdateChatSettings: (patch: Partial<ChatSettings>) =>
      void handleUpdateChatSettings(patch)
  };

  if (checkingAuth) {
    return (
      <div className="chat-view chat-view-centered">
        <Loader2 className="chat-spinner" size={22} aria-hidden="true" />
      </div>
    );
  }

  if (showAnthropicKeyGate) {
    return (
      <div className="chat-view chat-view-login">
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel chat-claude-login-panel">
              <KeyRound size={32} aria-hidden="true" />
              <h2>Claude API key</h2>
              <p>
                Coach with Claude straight from the Anthropic API using your own
                key, billed per token to your Anthropic account. The key is
                stored encrypted on this computer and never leaves it except to
                call Anthropic.
              </p>
              <div className="chat-login-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setSettingsOpen(true)}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  Add API key
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void api?.openAnthropicKeyGuide()}
                  disabled={!api}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  Get a key
                </button>
              </div>
              <p className="chat-login-note">
                Already have a subscription instead? Switch to Claude
                subscription below to use Claude Code on this computer.
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerControls}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      {contextHistoryDialog}
        {contextHistoryDialog}
      </div>
    );
  }

  if (showClaudeGate) {
    const notInstalled = claudeStatus?.state === "not-installed";
    return (
      <div className="chat-view chat-view-login">
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel chat-claude-login-panel">
              <Terminal size={32} aria-hidden="true" />
              <div className="chat-login-title-row">
                <h2>Claude Code</h2>
                <span className="chat-beta-badge">Beta</span>
              </div>
              <p>
                Coach with your Claude subscription through the Claude Code CLI
                on this computer.
              </p>
              <ClaudeAuthScopeToggle
                appScoped={chatSettings.claudeCode.useAppScopedAuth !== false}
                disabled={checkingClaude}
                onChange={(next) =>
                  void handleUpdateClaudeCode({ useAppScopedAuth: next })
                }
              />
              <p className="chat-login-note">
                {chatSettings.claudeCode.useAppScopedAuth !== false
                  ? "Signing in here creates credentials that belong to Heracles Records alone. Any Claude account you use elsewhere on this computer — including in a terminal — is left alone."
                  : "Heracles Records will use the machine-wide Claude login in your home folder, shared with your terminal. Signing in here replaces that login."}
              </p>
              <div className="chat-login-actions">
                {notInstalled ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void api?.openClaudeCodeSetupGuide()}
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    Install Claude Code
                  </button>
                ) : (
                  <ClaudeCodeLoginCard
                    api={api}
                    onSignedIn={handleClaudeSignedIn}
                    onError={onError}
                  />
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshClaudeCodeStatus()}
                  disabled={checkingClaude || !api}
                >
                  {checkingClaude ? (
                    <Loader2
                      className="chat-spinner"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw size={16} aria-hidden="true" />
                  )}
                  Check again
                </button>
              </div>
              <p className="chat-login-note">
                {claudeStatus?.message ?? "Checking for Claude Code…"}
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerControls}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      {contextHistoryDialog}
        {contextHistoryDialog}
      </div>
    );
  }

  if (showOpenRouterGate) {
    return (
      <div className="chat-view chat-view-login">
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel chat-openrouter-login-panel">
              <Network size={32} aria-hidden="true" />
              <div className="chat-login-title-row">
                <h2>Connect OpenRouter</h2>
                <span className="chat-beta-badge">BYOK</span>
              </div>
              <p>
                Use your OpenRouter API key and model credits for COROS-aware
                coaching, workout drafting, and activity tools.
              </p>
              <div className="chat-login-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setSettingsOpen(true)}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  Add API key
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void api?.openOpenRouterKeys()}
                  disabled={!api}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  Get a key from OpenRouter
                </button>
              </div>
              <p className="chat-login-note">
                Your key is encrypted in local app storage and is never added to
                the chat transcript.
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerControls}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      {contextHistoryDialog}
        {contextHistoryDialog}
      </div>
    );
  }

  if (showLoginGate) {
    return (
      <div
        className={["chat-view", "chat-view-login"]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel">
              <MessageCircle size={32} aria-hidden="true" />
              <h2>Your training coach</h2>
              <p>
                Sign in with your ChatGPT account to chat with a coach that knows your
                COROS activities, recovery, and upcoming workouts.
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleSignIn()}
                disabled={signingIn || !api}
              >
                {signingIn ? (
                  <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
                ) : null}
                Sign in with ChatGPT
              </button>
              <p className="chat-login-note">
                Or switch to Local model below to chat without signing in.
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerControls}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      {contextHistoryDialog}
        {contextHistoryDialog}
      </div>
    );
  }

/**
 * `\u26a1 <name> \u00b7 <triggerLabel>` — a conversation can host up to five
 * analyses, so every entry a run produced says which coach spoke.
 */
function AnalysisAttribution({
  marker
}: {
  marker: ChatEntryAnalysisMarker;
}) {
  return (
    <span className="chat-analysis-attribution">
      <Zap size={12} aria-hidden="true" />
      {marker.name}
      <span className="chat-analysis-attribution-trigger">
        · {marker.triggerLabel}
      </span>
    </span>
  );
}

/**
 * The playbook turn a run sent on the athlete's behalf. Collapsed to a chip by
 * default — it is machinery, not conversation — but openable, because an
 * athlete judging an analysis's answer needs to see what it was asked.
 */
function AnalysisPromptChip({
  marker,
  prompt,
  index,
  highlighted
}: {
  marker: ChatEntryAnalysisMarker;
  prompt: string;
  index: number;
  highlighted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`chat-row chat-row-analysis${
        highlighted ? " is-chat-jump-target" : ""
      }`}
      data-chat-entry-index={index}
    >
      <button
        type="button"
        className="chat-analysis-chip"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Zap size={12} aria-hidden="true" />
        {marker.name}
        <span className="chat-analysis-chip-trigger">· {marker.triggerLabel}</span>
      </button>
      {expanded ? <pre className="chat-analysis-prompt">{prompt}</pre> : null}
    </div>
  );
}

/**
 * When the coach looked. Absolute, not relative: a transcript entry is read
 * long after it was written, and "2h ago" becomes a lie the moment the
 * conversation is reopened.
 */
function formatLookedAt(at: number): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) {
    return "";
  }
  const time = when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
  if (when.toDateString() === new Date().toDateString()) {
    return time;
  }
  const day = when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
  return `${day}, ${time}`;
}

/**
 * 5.5: an analysis looked and had nothing to say. One line, the same pill as
 * the playbook chip, but nothing to open — the whole point is that there is no
 * content behind it.
 */
function AnalysisSilentChip({
  marker,
  at,
  index,
  highlighted
}: {
  marker: ChatEntryAnalysisMarker;
  at: number;
  index: number;
  highlighted: boolean;
}) {
  return (
    <div
      className={`chat-row chat-row-analysis${
        highlighted ? " is-chat-jump-target" : ""
      }`}
      data-chat-entry-index={index}
    >
      <span className="chat-analysis-chip chat-analysis-chip-static">
        <Zap size={12} aria-hidden="true" />
        {marker.name} looked, nothing new
        <span className="chat-analysis-chip-trigger">
          · {formatLookedAt(at)}
        </span>
      </span>
    </div>
  );
}

  /* The running turn's bubble sits where the turn began, above the cards it
     produces as it runs, so its answer reads before them — as it will once
     settled (`settleTurnEntries`). One array with keys, so nothing remounts. */
  const streamingRow = streaming ? (
    <div key="streaming-turn" className="chat-row chat-row-assistant">
      <div className="chat-avatar chat-avatar-assistant">
        <Sparkles size={16} aria-hidden="true" />
      </div>
      <div className="chat-bubble chat-bubble-streaming">
        {stepRun && stepRun.requestId === activeRequestIdRef.current ? <CoachStepTrail run={stepRun} /> : null}
        {streamingText ? (
          <>
            {thinkingText ? (
              <ThinkingDisclosure content={thinkingText} live />
            ) : null}
            <AssistantMarkdown content={streamingText} streaming />
          </>
        ) : (
          <div className="chat-stream-pending">
            {activeTool || !thinkingText ? (
              <span className="chat-stream-status">
                {compacting
                  ? "Compacting the conversation…"
                  : activeTool
                    ? `Using ${activeTool.replace(/_/g, " ")}…`
                    : resumedCoachPromptRef.current
                      ? "Resuming plan…"
                      : "Working on it…"}
              </span>
            ) : null}
            {thinkingText ? (
              <ThinkingDisclosure content={thinkingText} live />
            ) : null}
          </div>
        )}
        {currentSource ? <SourceBadge source={currentSource} /> : null}
      </div>
    </div>
  ) : null;
  const withStreamingRow = (rows: ReactNode[]): ReactNode[] => {
    if (!streamingRow) return rows;
    const at = Math.min(Math.max(0, turnStartRef.current), rows.length);
    return [...rows.slice(0, at), streamingRow, ...rows.slice(at)];
  };

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-header-title">
          <span>Training Coach</span>
        </div>
        <div className="chat-header-end">
          <button
            type="button"
            className="chat-settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <Settings2 size={16} aria-hidden="true" />
            Settings
          </button>
          <ConversationAnalyses
            api={api}
            sessionId={activeSessionId}
            refreshVersion={analysesVersion}
            onChanged={() => setAnalysesVersion((value) => value + 1)}
            onCreateAnalysis={() => {
              if (!activeSessionId) return;
              setAnalysisTarget({ kind: "create", sessionId: activeSessionId });
            }}
            onOpenAnalysis={(analysisId) =>
              setAnalysisTarget({ kind: "detail", analysisId })
            }
          />
          {listedCreations.length > 0 ? (
            <button
              type="button"
              className="chat-creations-pill"
              aria-expanded={planPanelOpen}
              aria-controls="chat-creations-panel"
              onClick={() => setPlanPanelOpen((open) => !open)}
              title={
                planPanelOpen ? "Hide Coach creations" : "Show Coach creations"
              }
            >
              {planPanelOpen ? (
                <PanelRightClose size={13} aria-hidden="true" />
              ) : (
                <PanelRightOpen size={13} aria-hidden="true" />
              )}
              Creations
              <span className="chat-creations-count">{listedCreations.length}</span>
            </button>
          ) : null}
          {isChatGptProvider ? (
            <button
              type="button"
              className="chat-signout"
              onClick={() => void handleSignOut()}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      <div className="chat-layout">
        <ChatSidebar {...sidebarProps} />
        <div className="chat-main">
          {conversationSettings ? (
            <button
              type="button"
              className="chat-conversation-settings"
              data-action="conversationSettings"
              onClick={() => setConversationSettingsOpen(true)}
              title="What Coach reads here, and which AI answers"
            >
              <span>
                Reads:{" "}
                {SHARED_SOURCE_LABELS.filter(([key]) => conversationSettings.sources[key])
                  .map(([, label]) => label)
                  .join(" · ") || "nothing of yours"}
              </span>
              <span>
                AI:{" "}
                {conversationSettings.runtime
                  ? [
                      COACH_PROVIDER_LABELS[conversationSettings.runtime.provider ?? chatSettings.provider],
                      conversationSettings.runtime.model,
                      conversationSettings.runtime.effort
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Coach's settings"}
              </span>
            </button>
          ) : null}
          <div className="chat-transcript" ref={scrollRef}>
        <div className="chat-thread">
          {timeline.length === 0 && !streaming ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <Sparkles size={28} aria-hidden="true" />
              </div>
              <h3>How can I help with your training?</h3>
              <div className="chat-suggestions">
                {[
                  "How was my latest activity?",
                  "Break down my latest workout by lap",
                  "Create one workout for today and save it to my Workout Library",
                  "Build a balanced week from my recent training",
                  "Schedule bike intervals for Saturday",
                  "Add strength around my endurance sessions",
                  "Am I recovered enough for a hard session?",
                  "Download my latest activity FIT file"
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chat-suggestion"
                    onClick={() => {
                      composerRef.current?.setDraft(suggestion);
                      composerRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {withStreamingRow(timeline.map((entry, index) => {
            if (!chatSettings.visualizationsEnabled && isChatVisualEntry(entry)) {
              return null;
            }

            if (entry.kind === "toolNotice") {
              return (
                <ChatRow
                  key={`tool-notice-${index}`}
                  settled={settledEntriesRef.current.has(entry)}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-tool-notice">
                    {entry.message}
                  </div>
                </ChatRow>
              );
            }

            if (entry.kind === "coachPrompt") {
              if (entry.prompt.answeredAt !== undefined) {
                // Kept as one line rather than dropped: the question and what
                // was chosen are part of how the plan came to be, and the coach
                // reads them on every turn anyway.
                const chosen = entry.prompt.choices.find(
                  (choice) => choice.id === entry.prompt.selectedChoiceId
                );
                return (
                  <div
                    key={entry.prompt.promptId}
                    className="chat-row chat-row-assistant chat-asked-row"
                    data-chat-entry-index={index}
                  >
                    <span className="chat-asked-kicker">Asked</span>
                    <span className="chat-asked-question">{entry.prompt.question}</span>
                    <span className="chat-asked-answer">
                      {chosen?.label ?? entry.prompt.answer ?? ""}
                    </span>
                  </div>
                );
              }
              return (
                <ChatRow
                  key={entry.prompt.promptId}
                  settled={settledEntriesRef.current.has(entry)}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <MessageCircle size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-coach-prompt">
                    <CoachInputCard
                      prompt={entry.prompt}
                      disabled={streaming || exportingLatestActivity}
                      onChoose={(choice) =>
                        void handleCoachPromptChoice(entry.prompt, choice)
                      }
                      onCustom={handleCustomCoachAnswer}
                    />
                  </div>
                </ChatRow>
              );
            }

            if (entry.kind === "planRefs") {
              return (
                <div
                  key={`refs#${index}`}
                  className="chat-row chat-row-user chat-refs-row"
                  data-chat-entry-index={index}
                >
                  <span className="chat-asked-kicker">About</span>
                  {entry.refs.map((ref) => (
                    <span key={refKey(ref)} className="chat-ref-chip">
                      {ref.name}
                      {ref.scope === "plan" ? "" : ` · ${ref.label}`}
                    </span>
                  ))}
                </div>
              );
            }

            if (entry.kind === "planBrief") {
              const brief = planBriefs[entry.artifactId];
              if (!brief) return null;
              return (
                <div
                  key={`brief:${entry.artifactId}#${index}`}
                  className="chat-row chat-row-assistant"
                  data-chat-entry-index={index}
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <CoachBriefCard
                      brief={brief}
                      firstMonday={briefMonday}
                      sources={conversationSettings?.sources}
                      editing={editingBriefId === brief.artifactId}
                      onEdit={
                        briefIsPlan(brief.artifactId)
                          ? undefined
                          : () => {
                              setBriefSave({ saving: false });
                              setEditingBriefId(brief.artifactId);
                            }
                      }
                      onDrawOutline={
                        brief.outline || briefOpenProblems(brief.request, conversationSettings?.sources).length
                          ? undefined
                          : () => void drawOutline(brief.artifactId)
                      }
                      busy={streaming}
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "planOutline") {
              const brief = planBriefs[entry.artifactId];
              if (!brief?.outline) return null;
              if (outlineAnchors.get(entry.artifactId) !== index) {
                // Redrawn below: the artifact keeps one outline, the latest card draws it.
                return (
                  <div
                    key={`outline:${entry.artifactId}:${entry.outlineVersion}#${index}`}
                    className="chat-row chat-row-assistant chat-asked-row chat-plan-event-row"
                    data-chat-entry-index={index}
                  >
                    <span className="chat-asked-kicker">Outline</span>
                    <span className="chat-asked-question">v{entry.outlineVersion}</span>
                    <span className="chat-version-note">Redrawn below</span>
                  </div>
                );
              }
              const outlined = brief as PlanBrief & { outline: NonNullable<PlanBrief["outline"]> };
              return (
                <div
                  key={`outline:${entry.artifactId}#${index}`}
                  className="chat-row chat-row-assistant"
                  data-chat-entry-index={index}
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <CoachOutlineCard
                      brief={outlined}
                      busy={streaming}
                      editing={editingOutlineId === brief.artifactId}
                      written={briefIsPlan(brief.artifactId)}
                      blocked={briefOpenProblems(brief.request, conversationSettings?.sources)[0]}
                      onWriteSessions={() => void writeSessions(brief.artifactId)}
                      onAdjust={() => {
                        setOutlineSave({ saving: false });
                        setEditingOutlineId(brief.artifactId);
                      }}
                      onRedraw={(note) => void drawOutline(brief.artifactId, note)}
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "planEvent") {
              // A line where it happened, as the coach reads it; the card
              // below it already shows what the creation is now.
              const event = entry.event;
              const what = event.artifactType === "workout" ? "Workout" : "Plan";
              // Undo is a restore of the version this one replaced, offered
              // only while it is still the newest: after that, undoing it
              // would also undo whatever came since.
              const eventVersion = versionIndex.get(event.draftId);
              const undoTo =
                api &&
                event.author === "athlete" &&
                event.fromVersion &&
                eventVersion?.latest &&
                !eventVersion.siblings.some((version) => version.uploadedAt)
                  ? eventVersion.siblings.filter((version) => version.version === event.fromVersion).at(-1)
                      ?.draftId
                  : undefined;
              const verb =
                event.action === "edited"
                  ? "Edited by you"
                  : event.action === "restored"
                    ? "Restored by you"
                    : event.action === "imported"
                      ? "Changed in the Library"
                      : "Deleted on COROS";
              return (
                <div
                  key={`${event.eventId}#${index}`}
                  className="chat-row chat-row-assistant chat-asked-row chat-plan-event-row"
                  data-chat-entry-index={index}
                >
                  <span className="chat-asked-kicker">{what}</span>
                  <span className="chat-asked-question">{event.name}</span>
                  <span className="chat-version-note">
                    {verb}
                    {event.changes?.length ? ` · ${event.changes.join(" · ")}` : ""}
                  </span>
                  {undoTo ? (
                    <button
                      type="button"
                      className="chat-local-action chat-plan-event-undo"
                      onClick={() => void handleRestoreVersion(undoTo)}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              );
            }

            if (entry.kind === "planDraft") {
              // Removed by the athlete: the entry stays so the saved array
              // keeps its length, but nothing draws it.
              if (entry.draft.removedAt) {
                return null;
              }
              const draft = entry.draft;
              const versionInfo = versionIndex.get(draft.draftId);
              // An older version folds to a line: the newest one below it is
              // the card with buttons, and two full copies of one plan read as
              // two plans.
              if (versionInfo && !versionInfo.latest) {
                return (
                  <div
                    key={`${draft.draftId}#${index}`}
                    className="chat-row chat-row-assistant chat-asked-row chat-version-row"
                    data-chat-entry-index={index}
                  >
                    <span className="chat-asked-kicker">
                      {draft.artifactType === "workout" ? "Workout" : "Plan"}
                    </span>
                    <span className="chat-asked-question">{draft.name}</span>
                    <span className="chat-version-note">{supersededLine(versionInfo)}</span>
                  </div>
                );
              }
              const documentKey = `${draft.draftId}:${draft.editedAt ?? 0}`;
              // One copy at every window width, and nothing measured: the
              // copy that used to live here was chosen by a width test, and
              // that test also decided whether the Creations button existed.
              return (
                <div
                  key={`${draft.draftId}#${index}`}
                  className="chat-row chat-row-assistant"
                  data-chat-entry-index={index}
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <CoachCreationCard
                      draft={draft}
                      version={versionInfo?.version}
                      editing={draft.draftId === editingPlanDraftId || draft.draftId === editingWorkoutDraftId}
                      document={planDocuments[documentKey] ?? undefined}
                      uploading={uploadingDraftId === draft.draftId}
                      uploaded={uploadedPlans[draft.draftId]}
                      onUpload={(destination, scheduleDate, keepInLibrary, options) =>
                        void handleUploadPlanDraft(
                          draft.draftId,
                          destination,
                          scheduleDate,
                          keepInLibrary,
                          options
                        )
                      }
                      onCoros={isOnCoros(versionInfo)}
                      refinements={refinementChips(
                        draft,
                        versionInfo?.siblings.find((item) => item.draftId === draft.draftId)?.refinements
                      )}
                      onRefine={
                        api && !streaming
                          ? (text) =>
                              void sendMessage(text, undefined, [
                                {
                                  artifactId: versionInfo?.artifactId ?? draft.draftId,
                                  draftId: draft.draftId,
                                  ...(versionInfo ? { version: versionInfo.version } : {}),
                                  name: draft.name,
                                  artifactType: draft.artifactType === "workout" ? "workout" : "plan",
                                  scope: "plan",
                                  label: draft.artifactType === "workout" ? "the whole workout" : "the whole plan"
                                }
                              ])
                          : undefined
                      }
                      calendar={calendarOf(draft.draftId)}
                      onCalendar={api ? () => setCalendarFor(draft.draftId) : undefined}
                      onEdit={
                        api && (draft.artifactType !== "workout" || documentOf(draft))
                          ? () => void openCreationEditor(draft.draftId)
                          : undefined
                      }
                      onOpen={() => {
                        openCreation(draft.draftId);
                      }}
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "workoutDelete") {
              return (
                <div
                  key={entry.preview.requestId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <DeletePreviewCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "scheduleChange") {
              const changeSet = scheduleChanges[entry.changeSetId];
              if (!changeSet) return null;
              const busyLine = applyingChange?.changeSetId === entry.changeSetId ? applyingChange.lineId : null;
              return (
                <div key={`scheduleChange:${entry.changeSetId}`} className="chat-row chat-row-assistant">
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <CoachScheduleChangeCard
                      changeSet={changeSet}
                      busyLine={busyLine}
                      disabled={Boolean(applyingChange) || streaming}
                      onApply={(lineId) => void settleScheduleChange(entry.changeSetId, lineId, true)}
                      onDismiss={(lineId) => void settleScheduleChange(entry.changeSetId, lineId, false)}
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "activityVisual") {
              return (
                // Position as well as id. A `previewId` is unique by
                // construction and duplicates are always a bug elsewhere — but
                // this list also renders rows merged in from another machine,
                // and React's answer to a repeated key is to drop or duplicate
                // the row rather than to show what the transcript holds. The
                // id still carries identity across an in-place upsert, which is
                // what it is here for.
                <div
                  key={`${entry.preview.previewId}#${index}`}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <ActivityVisualCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "fitnessTrend") {
              return (
                <div
                  key={`${entry.preview.previewId}#${index}`}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <FitnessTrendCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "hrZoneSummary") {
              return (
                <div
                  key={`${entry.preview.previewId}#${index}`}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <HrZoneCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "automationSilent") {
              return (
                <AnalysisSilentChip
                  key={`analysis-silent-${index}`}
                  marker={entry.automation}
                  at={entry.at}
                  index={index}
                  highlighted={highlightedChatEntryIndex === index}
                />
              );
            }

            if (entry.kind === "opaque") {
              return null;
            }

            // 5.6: the synthetic user turn an analysis sends is stored with
            // role "user", but it was never typed by the athlete — showing it as
            // their bubble would misattribute the playbook to them.
            if (entry.automation && entry.role === "user") {
              return (
                <AnalysisPromptChip
                  key={`message-${index}`}
                  marker={entry.automation}
                  prompt={entry.content}
                  index={index}
                  highlighted={highlightedChatEntryIndex === index}
                />
              );
            }

            return (
              <ChatRow
                key={`message-${index}`}
                settled={settledEntriesRef.current.has(entry)}
                className={`chat-row chat-row-${entry.role}${
                  highlightedChatEntryIndex === index
                    ? " is-chat-jump-target"
                    : ""
                }`}
                data-chat-entry-index={index}
              >
                <div className={`chat-avatar chat-avatar-${entry.role}`}>
                  {entry.role === "assistant" ? (
                    <Sparkles size={16} aria-hidden="true" />
                  ) : (
                    <User size={16} aria-hidden="true" />
                  )}
                </div>
                <div className="chat-bubble">
                  {entry.automation ? (
                    <AnalysisAttribution marker={entry.automation} />
                  ) : null}
                  {entry.role === "assistant" ? (
                    <>
                      {entry.reasoningSummary ? (
                        <ThinkingDisclosure content={entry.reasoningSummary} />
                      ) : null}
                      <AssistantMarkdown content={entry.content} />
                      {entry.source ? (
                        <SourceBadge source={entry.source} />
                      ) : null}
                      <TurnCostFooter
                        usage={entry.usage}
                        model={entry.model}
                      />
                    </>
                  ) : (
                    entry.content
                  )}
                </div>
              </ChatRow>
            );
          }))}

          {/* Same avatar and bubble as the persisted answer this becomes, so
              the reload at the end of the run does not make the row jump. */}
          {liveAnalysis ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble chat-bubble-streaming">
                <span className="chat-analysis-attribution">
                  <Zap size={12} aria-hidden="true" />
                  {liveAnalysis.name}
                  <span className="chat-analysis-attribution-trigger">
                    · running now
                  </span>
                </span>
                {liveAnalysisText ? (
                  <AssistantMarkdown content={liveAnalysisText} streaming />
                ) : (
                  <div className="chat-stream-pending">
                    <span className="chat-stream-status">
                      Reading your training…
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {exportingLatestActivity ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <FileDown size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble">Preparing latest activity FIT export…</div>
            </div>
          ) : null}
        </div>
      </div>

          {pendingRefs.length ? (
            <div className="chat-refs-pending" aria-label="Asking about">
              <span className="chat-asked-kicker">Asking about</span>
              {pendingRefs.map((ref) => (
                <span key={refKey(ref)} className="chat-ref-chip">
                  {ref.name}
                  {ref.scope === "plan" ? "" : ` · ${ref.label}`}
                  <button
                    type="button"
                    className="chat-ref-remove"
                    aria-label={`Stop asking about ${ref.scope === "plan" ? ref.name : ref.label}`}
                    onClick={() =>
                      setPendingRefs((current) => current.filter((item) => refKey(item) !== refKey(ref)))
                    }
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <ChatComposer
            ref={composerRef}
            providerControls={providerControls}
            initialDraft={composerDraftRef.current}
            apiAvailable={Boolean(api)}
            streaming={streaming}
            exportingLatestActivity={exportingLatestActivity}
            waitingForCoachAnswer={waitingForCoachAnswer}
            isLocalProvider={isLocalProvider}
            localModelConfigured={localModelConfigured}
            onDraftChange={handleComposerDraftChange}
            onNewChat={() => void handleNewChat()}
            onSend={sendMessage}
            onStop={handleStop}
          />
        </div>
        {(planPanelOpen || openCreationId) && listedCreations.length > 0 ? (
          <Suspense fallback={null}>
            <CoachCanvas
              api={api}
              artifactId={openCreationId}
              creations={listedCreations}
              cards={planDrafts}
              versionIndex={versionIndex}
              documentFor={documentForDraft}
              uploadingDraftId={uploadingDraftId}
              editingDraftId={editingPlanDraftId ?? editingWorkoutDraftId}
              planSportStyle={planSportStyle}
              onOpen={(draftId) => openCreation(draftId)}
              onBack={() => {
                setOpenCreationId(null);
                setPlanPanelOpen(true);
              }}
              onClose={() => {
                setOpenCreationId(null);
                setPlanPanelOpen(false);
              }}
              onUpload={(draftId, destination, scheduleDate, keepInLibrary, options) =>
                void handleUploadPlanDraft(draftId, destination, scheduleDate, keepInLibrary, options)
              }
              onEdit={api ? (draftId) => void openCreationEditor(draftId) : undefined}
              onRestore={api ? (draftId) => void handleRestoreVersion(draftId) : undefined}
              onRemove={(draftId) => {
                handleRemovePlanDraft(draftId);
                setOpenCreationId(null);
              }}
              onViewInChat={(draftId) => handleScrollToPlanChat(draftId)}
              onCalendar={api ? (draftId) => setCalendarFor(draftId) : undefined}
              calendarOf={calendarOf}
              onAsk={addRef}
            />
          </Suspense>
        ) : null}
      </div>
      <ChatSettingsModal {...settingsModalProps} />
      {contextHistoryDialog}
      <McpSessionPrompt
        servers={mcpPrompt}
        busy={mcpPromptBusy}
        onSkip={() => void handleMcpPromptSkip()}
        onLater={handleMcpPromptLater}
        onAuthorize={() => void handleMcpPromptAuthorize()}
      />
      {editingBriefId && planBriefs[editingBriefId] && conversationSettings ? (
        <Suspense fallback={null}>
          <CoachBriefEditor
            brief={planBriefs[editingBriefId]!}
            firstMonday={briefMonday}
            sources={conversationSettings.sources}
            saving={briefSave.saving}
            error={briefSave.error}
            onSourcesChange={(sources) => updateConversationSettings({ ...conversationSettings, sources })}
            onSave={(request) => void saveBrief(editingBriefId, request)}
            onClose={() => setEditingBriefId(null)}
          />
        </Suspense>
      ) : null}
      {editingOutlineId && planBriefs[editingOutlineId]?.outline ? (
        <Suspense fallback={null}>
          <CoachOutlineEditor
            brief={planBriefs[editingOutlineId] as PlanBrief & { outline: NonNullable<PlanBrief["outline"]> }}
            saving={outlineSave.saving}
            error={outlineSave.error}
            onSave={(outline) => void saveOutline(editingOutlineId, outline)}
            onClose={() => setEditingOutlineId(null)}
          />
        </Suspense>
      ) : null}
      {redrawAsk && planBriefs[redrawAsk]?.outline
        ? createPortal(
            <ConfirmDialog
              title="Redraw the outline?"
              description="The outline was drawn from the brief as it was. Coach can draw it again from the brief as it is now; keeping it leaves the outline as it stands, with anything that no longer fits listed on its card."
              cancelLabel="Keep the outline"
              confirmLabel="Redraw the outline"
              onConfirm={() => {
                const artifactId = redrawAsk;
                setRedrawAsk(null);
                void drawOutline(artifactId);
              }}
              onCancel={() => setRedrawAsk(null)}
            />,
            document.body
          )
        : null}
      {conversationSettingsOpen && conversationSettings ? (
        <Suspense fallback={null}>
          <CoachConversationSettings
            portal
            chatSettings={chatSettings}
            conversation={conversationSettings}
            readiness={coachProviderReadiness(chatSettings, authStatus, claudeStatus)}
            claudeStatus={claudeStatus}
            onChange={updateConversationSettings}
            onClose={() => setConversationSettingsOpen(false)}
            onOpenCoachSettings={() => {
              setConversationSettingsOpen(false);
              setSettingsOpen(true);
            }}
          />
        </Suspense>
      ) : null}
      {api && calendarFor ? (
        <Suspense fallback={null}>
          <CoachCalendarDialog
            api={api}
            draftId={calendarFor}
            saved={Boolean(
              planDrafts.find((draft) => draft.draftId === calendarFor)?.uploadedAt ||
                planDrafts.find((draft) => draft.draftId === calendarFor)?.uploadResult ||
                uploadedPlans[calendarFor]
            )}
            onSave={async () => {
              const result = await handleUploadPlanDraft(calendarFor, "nativePlan");
              return Boolean(result && !result.conflict);
            }}
            onClose={() => setCalendarFor(null)}
            onAdded={() => {
              setCalendarFor(null);
              setCalendarRead((value) => value + 1);
            }}
            onError={onError}
          />
        </Suspense>
      ) : null}
      {corosConflict ? (
        <Suspense fallback={null}>
          <CorosConflictDialog
            name={corosConflict.name}
            onOverwrite={() =>
              void handleUploadPlanDraft(corosConflict.draftId, "nativePlan", undefined, undefined, { overwrite: true })
            }
            onSaveAsNew={() =>
              void handleUploadPlanDraft(corosConflict.draftId, "nativePlan", undefined, undefined, { asNew: true })
            }
            onCancel={() => setCorosConflict(null)}
          />
        </Suspense>
      ) : null}
      {api && editingPlanDraftId ? (
        <Suspense fallback={null}>
          <CoachPlanEditor
            api={api}
            draftId={editingPlanDraftId}
            onSaved={handlePlanDraftEdited}
            onClose={() => setEditingPlanDraftId(null)}
            onError={onError}
          />
        </Suspense>
      ) : null}
      {api && editingWorkout?.entries[0]?.source ? (
        <Suspense fallback={null}>
          <CoachWorkoutEditor
            api={api}
            draft={editingWorkout}
            workout={editingWorkout.entries[0].source}
            onSaved={handlePlanDraftEdited}
            onClose={() => setEditingWorkoutDraftId(null)}
            onError={onError}
          />
        </Suspense>
      ) : null}
      <AnalysesModal
        api={api}
        target={analysisTarget}
        provider={chatSettings.provider}
        onChanged={() => setAnalysesVersion((value) => value + 1)}
        onClose={() => {
          setAnalysisTarget(null);
          // Catch-all: anything the modal changed is reflected on close, even
          // a path that forgot to report itself.
          setAnalysesVersion((value) => value + 1);
        }}
        onOpenConversation={(sessionId) => void openRunConversation(sessionId)}
      />
    </div>
  );
}
