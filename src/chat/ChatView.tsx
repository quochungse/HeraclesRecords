import {
  forwardRef,
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
  BookOpen,
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Database,
  ExternalLink,
  FileDown,
  FileText,
  Info,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Zap
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorosLinkApi } from "../coroslink-api";
import { showToast } from "../toast";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  POUNDS_PER_KILOGRAM,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  speedUnit,
  weightUnit,
  type UnitSystem
} from "../units/units";
import type {
  AnthropicApiConnectionTest,
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
  LocalChatConnectionTest,
  LocalChatDiscovery,
  OpenRouterConnectionTest,
  McpServerConfig,
  McpServerStatus,
  PersistedChatEntry,
  PlanDraftPreview,
  PlanDraftPreviewEntry,
  PlanWorkoutEntryInput,
  TrainingPlanDocument,
  TrainingPlanDestination,
  TrainingHubExportResult,
  UploadPlanResult,
  WorkoutIntensityInput,
  WorkoutDeletePreview,
  DeleteWorkoutResult
} from "../../electron/types";
import { NOTHING_TO_REPORT } from "../../electron/types";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { trainingPlanFromCoachDraftPreview } from "../../electron/trainingPlanDomain";
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
import { CoachCreationModal } from "./CoachCreationModal";
import {
  DEFAULT_COMPACT_CONTEXT,
  summaryContextMessage,
  toWireMessages
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
  upsertWorkoutDeleteEntry,
  isChatVisualEntry,
  type ChatEntry,
  type SourceInfo
} from "./chatTypes";
import { formatTurnCost, formatTurnCostDetail } from "./turnCost";

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
  onReviewPlan?: (plan: TrainingPlanDocument) => void;
  /** Fires when a coach request is in progress (streaming or exporting). */
  onActivityChange?: (active: boolean) => void;
  /** Text preloaded into the composer (e.g. "Ask Coach" from the calendar). */
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
  /**
   * True while the Coach view is the visible one. The panel stays mounted when
   * the athlete navigates away, so anything that should happen "on opening
   * Coach" keys on this rather than on mount.
   */
  active?: boolean;
}

function canonicalPlanDistanceMeters(source: PlanWorkoutEntryInput): number {
  if (source.distance_km && source.distance_km > 0) {
    return source.distance_km * 1_000;
  }
  let total = 0;
  for (const step of source.steps ?? []) {
    if ("repeat" in step) {
      total += step.repeat * step.steps.reduce(
        (sum, child) => sum + (child.target_distance_meters ?? 0),
        0
      );
    } else {
      total += step.target_distance_meters ?? 0;
    }
  }
  return total;
}

function formatPlanSourceVolume(
  source: PlanWorkoutEntryInput,
  unitSystem: UnitSystem
): string | undefined {
  const meters = canonicalPlanDistanceMeters(source);
  if (meters <= 0) return undefined;
  return formatDistanceValue(meters, unitSystem, {
    swim: source.sport === "swim"
  });
}

type PlanSourceNode = NonNullable<PlanWorkoutEntryInput["steps"]>[number];
type PlanSourceRepeat = Extract<PlanSourceNode, { repeat: number }>;
type PlanSourceStep = Exclude<PlanSourceNode, { repeat: number }>;

function isPlanSourceRepeat(step: PlanSourceNode): step is PlanSourceRepeat {
  return "repeat" in step;
}

function formatPlanDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes)
    ? `${minutes} min`
    : `${minutes.toFixed(1)} min`;
}

function formatPlanStepTarget(
  step: PlanSourceStep,
  sport: PlanWorkoutEntryInput["sport"],
  unitSystem: UnitSystem
): string {
  if (step.target_distance_meters) {
    return formatDistanceValue(step.target_distance_meters, unitSystem, {
      swim: sport === "swim"
    });
  }
  if (step.target_elevation_gain_meters) {
    return `${formatElevationValue(step.target_elevation_gain_meters, unitSystem)} gain`;
  }
  if (step.target_duration_seconds) {
    return formatPlanDuration(step.target_duration_seconds);
  }
  if (step.target_reps) return `${step.target_reps} reps`;
  if (step.target_routes) {
    return `${step.target_routes} ${step.target_routes === 1 ? "route" : "routes"}`;
  }
  if (step.target_hr_recovery_bpm) {
    return `to ${step.target_hr_recovery_bpm} bpm`;
  }
  if (step.send_off_seconds) return `${formatPlanDuration(step.send_off_seconds)} send-off`;
  if (step.target_load) return `${step.target_load} TL`;
  return "Open";
}

function formatPlanSourceSteps(
  source: PlanWorkoutEntryInput,
  unitSystem: UnitSystem
): string | undefined {
  const formatStep = (
    step: NonNullable<PlanWorkoutEntryInput["steps"]>[number]
  ): string => {
    if (isPlanSourceRepeat(step)) {
      return `${step.repeat}x (${step.steps.map((child) => formatStep(child)).join(", ")})`;
    }
    const target = formatPlanStepTarget(step, source.sport, unitSystem);
    const intensity = step.intensity
      ? formatPlanIntensity(step.intensity, unitSystem)
      : step.pace
        ? formatLegacyPlanPace(step.pace, unitSystem)
        : undefined;
    return `${step.kind ?? "training"} ${target}${intensity ? ` @ ${intensity}` : ""}`;
  };
  return source.steps?.length
    ? source.steps.map(formatStep).join(" → ")
    : undefined;
}

function isStrengthExerciseStep(step: PlanSourceStep): boolean {
  return step.kind === "training" || step.kind === "interval";
}

function strengthStepTitle(step: PlanSourceStep): string {
  if (step.exercise_name?.trim()) return step.exercise_name.trim();
  if (step.name?.trim()) return step.name.trim();
  if (step.kind === "warmup") return "Warm-up";
  if (step.kind === "cooldown") return "Cooldown";
  if (step.kind === "rest") return "Recovery";
  return "Strength exercise";
}

function strengthStepMarker(step: PlanSourceStep, exerciseNumber?: number): string {
  if (exerciseNumber !== undefined) return String(exerciseNumber);
  if (step.kind === "warmup") return "W";
  if (step.kind === "cooldown") return "C";
  if (step.kind === "rest") return "R";
  return "S";
}

function countStrengthExercises(steps: readonly PlanSourceNode[]): number {
  return steps.reduce((count, step) => {
    if (isPlanSourceRepeat(step)) {
      return count + step.steps.filter(isStrengthExerciseStep).length;
    }
    return count + (isStrengthExerciseStep(step) ? 1 : 0);
  }, 0);
}

function StrengthPlanStructure({
  source,
  unitSystem
}: {
  source: PlanWorkoutEntryInput;
  unitSystem: UnitSystem;
}) {
  const steps = source.steps ?? [];
  const exerciseCount = countStrengthExercises(steps);
  let exerciseNumber = 0;

  const renderStep = (step: PlanSourceStep, key: string) => {
    const exercise = isStrengthExerciseStep(step);
    const currentExerciseNumber = exercise ? ++exerciseNumber : undefined;
    const intensity = step.intensity
      ? formatPlanIntensity(step.intensity, unitSystem)
      : undefined;
    const setCount = step.sets && step.sets > 1 ? `${step.sets} sets` : undefined;
    const setRest = step.sets && step.sets > 1 && step.rest_value !== undefined
      ? `${formatPlanDuration(step.rest_value)} rest`
      : undefined;

    return (
      <li
        key={key}
        className={`chat-plan-strength-step is-${step.kind ?? "training"}`}
      >
        <span className="chat-plan-strength-marker" aria-hidden="true">
          {strengthStepMarker(step, currentExerciseNumber)}
        </span>
        <span className="chat-plan-strength-step-copy">
          <strong>{strengthStepTitle(step)}</strong>
        </span>
        <span className="chat-plan-strength-prescription">
          {setCount ? <span>{setCount}</span> : null}
          <strong>{formatPlanStepTarget(step, source.sport, unitSystem)}</strong>
          {intensity ? <span>{intensity}</span> : null}
          {setRest ? <span>{setRest}</span> : null}
        </span>
      </li>
    );
  };

  return (
    <section
      className="chat-plan-strength-structure"
      aria-label={`${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"} in strength session structure`}
    >
      <header className="chat-plan-strength-header">
        <strong>Session structure</strong>
        <span>
          {exerciseCount} {exerciseCount === 1 ? "exercise" : "exercises"}
        </span>
      </header>
      <ol className="chat-plan-strength-steps">
        {steps.map((step, index) => {
          if (!isPlanSourceRepeat(step)) {
            return renderStep(step, `step-${index}`);
          }
          return (
            <li key={`repeat-${index}`} className="chat-plan-strength-repeat">
              <div className="chat-plan-strength-repeat-header">
                <strong>{step.name?.trim() || "Repeat block"}</strong>
                <span>{step.repeat} rounds</span>
              </div>
              <ol>
                {step.steps.map((child, childIndex) =>
                  renderStep(child, `repeat-${index}-step-${childIndex}`)
                )}
              </ol>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function formatPlanPaceRange(
  lowSecondsPerKm: number,
  highSecondsPerKm: number,
  unitSystem: UnitSystem
): string {
  const clock = (value: number) => formatPaceValue(value, unitSystem).split(" ")[0];
  return `${clock(lowSecondsPerKm)}–${clock(highSecondsPerKm)}/${unitSystem === "imperial" ? "mi" : "km"}`;
}

function formatPlanIntensity(
  intensity: WorkoutIntensityInput,
  unitSystem: UnitSystem
): string | undefined {
  if (intensity.type === "none") return undefined;
  if (intensity.type === "pace" || intensity.type === "effortPace") {
    return formatPlanPaceRange(
      intensity.lowSecondsPerKm,
      intensity.highSecondsPerKm,
      unitSystem
    );
  }
  if (intensity.type === "speed") {
    const lowKmh = intensity.unit === "mph" ? intensity.low * 1.609344 : intensity.low;
    const highKmh = intensity.unit === "mph" ? intensity.high * 1.609344 : intensity.high;
    return `${kmhToDisplaySpeed(lowKmh, unitSystem).toFixed(1)}–${kmhToDisplaySpeed(highKmh, unitSystem).toFixed(1)} ${speedUnit(unitSystem)}`;
  }
  if (intensity.type === "weight") {
    if (intensity.mode === "bodyweight") return "Bodyweight";
    const kilograms = intensity.unit === "lb"
      ? intensity.value / POUNDS_PER_KILOGRAM
      : intensity.value;
    return `${kilogramsToDisplayWeight(kilograms, unitSystem).toFixed(1)} ${weightUnit(unitSystem)}`;
  }
  if (intensity.type === "heartRate") {
    return `${intensity.lowBpm}–${intensity.highBpm} bpm`;
  }
  if (intensity.type === "power" && !intensity.preset) {
    return `${intensity.lowWatts}–${intensity.highWatts} W`;
  }
  if (intensity.type === "cadence") {
    return `${intensity.low}–${intensity.high} ${intensity.unit}`;
  }
  if (intensity.type === "swimStroke") return intensity.stroke;
  if (intensity.type === "rpe") return `RPE ${intensity.value}`;
  return undefined;
}

function formatLegacyPlanPace(
  pace: string,
  unitSystem: UnitSystem
): string {
  const match = pace.trim().match(/^(\d+):([0-5]\d)(?:-(\d+):([0-5]\d))?\/(km|mi)$/i);
  if (!match) return pace;
  const sourceFactor = match[5]?.toLowerCase() === "mi" ? 1 / 1.609344 : 1;
  const low = (Number(match[1]) * 60 + Number(match[2])) * sourceFactor;
  const high = match[3]
    ? (Number(match[3]) * 60 + Number(match[4])) * sourceFactor
    : low;
  return formatPlanPaceRange(low, high, unitSystem);
}

const PLAN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function planDateFromSchedule(scheduleDate: string): Date | undefined {
  const match = scheduleDate.match(PLAN_DATE_RE);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Calendar-badge parts for a scheduled date: weekday / day number / month. */
function planDateParts(
  scheduleDate?: string
): { weekday: string; day: string; month: string } | undefined {
  if (!scheduleDate) return undefined;
  const date = planDateFromSchedule(scheduleDate);
  if (!date) return undefined;
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    day: String(date.getDate()),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date)
  };
}

/** One-line localized label, e.g. "Tue, Aug 4". Falls back to the raw value. */
function formatPlanDateLabel(scheduleDate: string): string {
  const date = planDateFromSchedule(scheduleDate);
  if (!date) return scheduleDate;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

function planEntryScheduleDate(entry: PlanDraftPreviewEntry): string | undefined {
  if (entry.scheduleDate) return entry.scheduleDate;
  const sourceDate = entry.source?.schedule_date;
  if (!sourceDate || !/^\d{8}$/.test(sourceDate)) return undefined;
  return `${sourceDate.slice(0, 4)}-${sourceDate.slice(4, 6)}-${sourceDate.slice(6, 8)}`;
}

function localPlanDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function planWeekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function formatPlanWeekRange(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const month = new Intl.DateTimeFormat(undefined, { month: "short" });
  if (start.getMonth() === end.getMonth()) {
    return `${month.format(start)} ${start.getDate()}-${end.getDate()}`;
  }
  return `${month.format(start)} ${start.getDate()}-${month.format(end)} ${end.getDate()}`;
}

interface PlanWeekGroup {
  id: string;
  label: string;
  dateRange: string;
  entries: PlanDraftPreviewEntry[];
}

function groupPlanEntriesByWeek(entries: PlanDraftPreviewEntry[]): PlanWeekGroup[] {
  const groups = new Map<string, { start: Date; entries: PlanDraftPreviewEntry[] }>();
  const unscheduled: PlanDraftPreviewEntry[] = [];
  const sortedEntries = [...entries].sort((left, right) => {
    const leftDate = planEntryScheduleDate(left) ?? "9999-99-99";
    const rightDate = planEntryScheduleDate(right) ?? "9999-99-99";
    return leftDate.localeCompare(rightDate);
  });

  for (const entry of sortedEntries) {
    const scheduleDate = planEntryScheduleDate(entry);
    const date = scheduleDate ? planDateFromSchedule(scheduleDate) : undefined;
    if (!date) {
      unscheduled.push(entry);
      continue;
    }
    const start = planWeekStart(date);
    const id = localPlanDateKey(start);
    const existing = groups.get(id);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(id, { start, entries: [entry] });
    }
  }

  const weeks = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, group], index) => ({
      id,
      label: `Week ${index + 1}`,
      dateRange: formatPlanWeekRange(group.start),
      entries: group.entries
    }));
  if (unscheduled.length > 0) {
    weeks.push({
      id: "unscheduled",
      label: "Unscheduled",
      dateRange: "No calendar date",
      entries: unscheduled
    });
  }
  return weeks;
}

/** Inline style hook that tints a row/chip with the sport's own colour. */
function planSportStyle(sport: PlanDraftPreviewEntry["sport"]): CSSProperties {
  return { "--chat-plan-sport": sportTheme(sport).color } as CSSProperties;
}

function WorkoutPreviewCard({
  draft,
  uploading,
  uploaded,
  onUpload
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: (
    destination: TrainingPlanDestination,
    scheduleDate?: string
  ) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const entry = draft.entries[0];
  const suggestedDate = entry ? planEntryScheduleDate(entry) : undefined;
  const today = localPlanDateKey(new Date());
  const [destination, setDestination] = useState<
    Extract<TrainingPlanDestination, "workoutLibrary" | "calendar">
  >(suggestedDate ? "calendar" : "workoutLibrary");
  const [scheduleDate, setScheduleDate] = useState(suggestedDate ?? today);
  const uploadedResult =
    uploaded ??
    (draft.uploadResult
      ? {
          planName: draft.name,
          workoutsCreated: draft.uploadResult.workoutsCreated,
          workoutsScheduled: draft.uploadResult.workoutsScheduled,
          entries: [],
          destination: draft.uploadResult.destination
        }
      : undefined);
  const isUploaded = Boolean(uploadedResult || draft.uploadedAt);
  const uploadedDestination =
    uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination;
  const calendarDateParts = destination === "calendar"
    ? planDateParts(scheduleDate)
    : undefined;
  const calendarDateInvalid =
    destination === "calendar" && (!scheduleDate || scheduleDate < today);
  const SportIcon = sportTheme(entry?.sport).icon;
  const hasStrengthStructure = Boolean(
    entry &&
      (entry.sport === "strength" || entry.sport === "hyrox") &&
      entry.source?.steps?.length
  );
  const volume = entry
    ? (entry.source
        ? formatPlanSourceVolume(entry.source, unitSystem)
        : undefined) ?? entry.volume ?? "Not set"
    : "Not set";
  const steps = entry
    ? (entry.source
        ? formatPlanSourceSteps(entry.source, unitSystem)
        : undefined) ?? entry.stepsSummary ?? "No structure provided"
    : "No structure provided";

  return (
    <div className="chat-plan-card chat-workout-card">
      <div className="chat-plan-card-header">
        <div className="chat-plan-card-title">
          <span className="chat-workout-card-kicker">One-off workout</span>
          <h4>{draft.name}</h4>
          <span className="chat-plan-card-summary">{draft.summary}</span>
        </div>
        {entry ? (
          <span
            className="chat-plan-sport-dot"
            style={planSportStyle(entry.sport)}
            title={formatWorkoutSport(entry.sport ?? "run")}
          >
            <SportIcon size={12} strokeWidth={2.2} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {entry ? (
        <ul className="chat-plan-entries chat-workout-entries">
          <li
            className={`chat-plan-entry${hasStrengthStructure ? " is-strength" : ""}`}
            style={planSportStyle(entry.sport)}
          >
            <span
              className={`chat-plan-entry-date${calendarDateParts ? "" : " is-undated"}`}
              title={
                destination === "calendar"
                  ? `Add to Calendar on ${scheduleDate}`
                  : "Save to Workout Library"
              }
            >
              {calendarDateParts ? (
                <>
                  <span className="chat-plan-entry-weekday">
                    {calendarDateParts.weekday}
                  </span>
                  <span className="chat-plan-entry-day">
                    {calendarDateParts.day}
                  </span>
                  <span className="chat-plan-entry-month">
                    {calendarDateParts.month}
                  </span>
                </>
              ) : (
                <Bookmark size={14} aria-hidden="true" />
              )}
            </span>
            <span className="chat-plan-entry-main">
              <span className="chat-plan-entry-name">{entry.name}</span>
              {hasStrengthStructure && entry.source ? (
                <StrengthPlanStructure
                  source={entry.source}
                  unitSystem={unitSystem}
                />
              ) : (
                <span className="chat-plan-entry-steps">{steps}</span>
              )}
            </span>
            <span className="chat-plan-entry-meta">
              {!hasStrengthStructure ? (
                <span className="chat-plan-entry-volume">{volume}</span>
              ) : null}
              <span className="chat-plan-entry-tags">
                <span className="chat-plan-entry-type">{entry.workoutType}</span>
                <span className="chat-plan-entry-sport">
                  <SportIcon size={11} strokeWidth={2.2} aria-hidden="true" />
                  {formatWorkoutSport(entry.sport ?? "run")}
                </span>
              </span>
            </span>
          </li>
        </ul>
      ) : (
        <div className="chat-plan-empty-week">
          <Bookmark size={16} aria-hidden="true" />
          <span>This workout does not contain any steps yet.</span>
        </div>
      )}
      {isUploaded ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {uploadedDestination === "calendar"
              ? `Added to your COROS Calendar on ${formatPlanDateLabel(scheduleDate)}.`
              : "Saved to your COROS Workout Library."}
          </span>
        </p>
      ) : (
        <>
          <fieldset className="chat-plan-confirmation" disabled={uploading}>
            <legend>Where should this workout go?</legend>
            <div className="chat-plan-destination-options">
              <label
                className={`chat-plan-destination-option${
                  destination === "workoutLibrary" ? " is-selected" : ""
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={`workout-destination-${draft.draftId}`}
                  value="workoutLibrary"
                  checked={destination === "workoutLibrary"}
                  onChange={() => setDestination("workoutLibrary")}
                />
                <span className="chat-plan-destination-icon">
                  <BookOpen size={16} aria-hidden="true" />
                </span>
                <span className="chat-plan-destination-copy">
                  <strong>Workout Library</strong>
                  <small>Save it as an unscheduled, reusable workout.</small>
                </span>
                <CircleCheck
                  className="chat-plan-destination-check"
                  size={16}
                  aria-hidden="true"
                />
              </label>
              <label
                className={`chat-plan-destination-option${
                  destination === "calendar" ? " is-selected" : ""
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={`workout-destination-${draft.draftId}`}
                  value="calendar"
                  checked={destination === "calendar"}
                  onChange={() => setDestination("calendar")}
                />
                <span className="chat-plan-destination-icon">
                  <CalendarDays size={16} aria-hidden="true" />
                </span>
                <span className="chat-plan-destination-copy">
                  <strong>Calendar</strong>
                  <small>Add this workout on the date you choose.</small>
                </span>
                <CircleCheck
                  className="chat-plan-destination-check"
                  size={16}
                  aria-hidden="true"
                />
              </label>
            </div>
            {destination === "calendar" ? (
              <label className="chat-workout-calendar-date">
                <span>Calendar date</span>
                <input
                  type="date"
                  value={scheduleDate}
                  min={today}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
              </label>
            ) : null}
            <p className="chat-plan-destination-summary" data-tone="ok">
              {destination === "calendar" ? (
                <CalendarDays size={13} aria-hidden="true" />
              ) : (
                <BookOpen size={13} aria-hidden="true" />
              )}
              <span>
                {destination === "calendar"
                  ? `This workout will be added to Calendar on ${formatPlanDateLabel(scheduleDate)}.`
                  : "This workout will be saved to your Workout Library without a calendar date."}
                {" "}It will remain a one-off workout, not a training plan.
              </span>
            </p>
          </fieldset>
          <div className="chat-plan-actions">
            <button
              type="button"
              className="chat-plan-upload"
              onClick={() => onUpload(
                destination,
                destination === "calendar" ? scheduleDate : undefined
              )}
              disabled={uploading || !entry || calendarDateInvalid}
            >
              {uploading ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                destination === "calendar" ? (
                  <CalendarDays size={14} aria-hidden="true" />
                ) : (
                  <Bookmark size={14} aria-hidden="true" />
                )
              )}
              {destination === "calendar" ? "Add to Calendar" : "Save to Library"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PlanPreviewCard({
  draft,
  uploading,
  uploaded,
  onUpload,
  onReview
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: (destination: TrainingPlanDestination) => void;
  onReview?: () => void;
}) {
  const { unitSystem } = useUnitSystem();
  const [destination, setDestination] = useState<
    Extract<TrainingPlanDestination, "localPlan" | "workoutLibrary" | "calendar">
  >("localPlan");
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const weekTabsRef = useRef<HTMLDivElement>(null);
  const uploadedResult =
    uploaded ??
    (draft.uploadResult
      ? {
          planName: draft.name,
          workoutsCreated: draft.uploadResult.workoutsCreated,
          workoutsScheduled: draft.uploadResult.workoutsScheduled,
          entries: []
        }
      : undefined);
  const isUploaded = Boolean(uploadedResult || draft.uploadedAt);
  const planWeeks = groupPlanEntriesByWeek(draft.entries);
  const scheduledWeekCount = planWeeks.filter(
    (week) => week.id !== "unscheduled"
  ).length;
  const selectedWeek =
    planWeeks.find((week) => week.id === selectedWeekId) ?? planWeeks[0];
  const selectedWeekIndex = selectedWeek
    ? planWeeks.findIndex((week) => week.id === selectedWeek.id)
    : -1;
  const sports = [
    ...new Set(draft.entries.map((entry) => formatWorkoutSport(entry.sport ?? "run")))
  ];
  const sportKinds = [...new Set(draft.entries.map((entry) => entry.sport))];
  const startDate = draft.entries
    .map(planEntryScheduleDate)
    .filter((date): date is string => Boolean(date))
    .sort()[0];
  const scheduledWorkoutCount = draft.entries.filter((entry) =>
    Boolean(planEntryScheduleDate(entry))
  ).length;
  const unscheduledWorkoutCount = draft.entries.length - scheduledWorkoutCount;
  const destinationLabel: Record<TrainingPlanDestination, string> = {
    workoutLibrary: "COROS Workout Library",
    calendar: "COROS Calendar",
    localPlan: "Heracles Records Training Library",
    nativePlan: "COROS Plan Library",
    localTemplate: "Local Heracles Records template",
    nativePlanAndCalendar: "COROS plan + Calendar"
  };

  useEffect(() => {
    setSelectedWeekId(null);
  }, [draft.draftId]);

  useEffect(() => {
    const activeTab = weekTabsRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    );
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedWeek?.id]);

  const selectAdjacentWeek = (offset: number) => {
    const nextWeek = planWeeks[selectedWeekIndex + offset];
    if (nextWeek) setSelectedWeekId(nextWeek.id);
  };

  return (
    <div className="chat-plan-card">
      <div className="chat-plan-card-header">
        <div className="chat-plan-card-title">
          <h4>{draft.name}</h4>
          <span className="chat-plan-card-summary">{draft.summary}</span>
        </div>
        {sportKinds.length > 0 ? (
          <span
            className="chat-plan-sports"
            role="img"
            aria-label={sports.join(", ")}
          >
            {sportKinds.slice(0, 4).map((sport, index) => {
              const SportIcon = sportTheme(sport).icon;
              return (
                <span
                  key={`${sport ?? "unknown"}-${index}`}
                  className="chat-plan-sport-dot"
                  style={planSportStyle(sport)}
                  title={sport ? formatWorkoutSport(sport) : "Workout"}
                >
                  <SportIcon size={10} strokeWidth={2.2} aria-hidden="true" />
                </span>
              );
            })}
          </span>
        ) : null}
      </div>
      <div className="chat-plan-overview" aria-label="Plan overview">
        <div className="chat-plan-overview-item">
          <span>Weeks</span>
          <strong>{scheduledWeekCount}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>Workouts</span>
          <strong>{draft.entries.length}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>Sports</span>
          <strong title={sports.join(", ")}>{sports.join(", ")}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>Starts</span>
          <strong>{startDate ? formatPlanDateLabel(startDate) : "Not set"}</strong>
        </div>
      </div>
      {selectedWeek ? (
        <section
          className="chat-plan-week"
          aria-labelledby={`chat-plan-week-${draft.draftId}-${selectedWeek.id}`}
        >
          <div className="chat-plan-week-header">
            <div>
              <span>{selectedWeek.label}</span>
              <h5 id={`chat-plan-week-${draft.draftId}-${selectedWeek.id}`}>
                {selectedWeek.dateRange}
              </h5>
              <small>
                {selectedWeek.entries.length}{" "}
                {selectedWeek.entries.length === 1 ? "workout" : "workouts"}
              </small>
            </div>
            {planWeeks.length > 1 ? (
              <div className="chat-plan-week-stepper" aria-label="Change week">
                <button
                  type="button"
                  onClick={() => selectAdjacentWeek(-1)}
                  disabled={selectedWeekIndex <= 0}
                  aria-label="Previous week"
                  title="Previous week"
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <span>{selectedWeekIndex + 1} of {planWeeks.length}</span>
                <button
                  type="button"
                  onClick={() => selectAdjacentWeek(1)}
                  disabled={selectedWeekIndex >= planWeeks.length - 1}
                  aria-label="Next week"
                  title="Next week"
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
          {planWeeks.length > 1 ? (
            <div
              ref={weekTabsRef}
              className="chat-plan-week-tabs"
              role="tablist"
              aria-label="Plan weeks"
            >
              {planWeeks.map((week) => (
                <button
                  key={week.id}
                  type="button"
                  role="tab"
                  aria-selected={week.id === selectedWeek.id}
                  className={week.id === selectedWeek.id ? "is-active" : ""}
                  onClick={() => setSelectedWeekId(week.id)}
                >
                  <strong>{week.label}</strong>
                  <span>{week.dateRange}</span>
                </button>
              ))}
            </div>
          ) : null}
          <ul className="chat-plan-entries">
            {selectedWeek.entries.map((entry) => {
              const SportIcon = sportTheme(entry.sport).icon;
              const scheduleDate = planEntryScheduleDate(entry);
              const dateParts = planDateParts(scheduleDate);
              const hasStrengthStructure =
                (entry.sport === "strength" || entry.sport === "hyrox") &&
                Boolean(entry.source?.steps?.length);
              const volume =
                (entry.source
                  ? formatPlanSourceVolume(entry.source, unitSystem)
                  : undefined) ?? entry.volume ?? "Not set";
              const steps =
                (entry.source
                  ? formatPlanSourceSteps(entry.source, unitSystem)
                  : undefined) ?? entry.stepsSummary ?? "No structure provided";
              return (
                <li
                  key={entry.key}
                  className={`chat-plan-entry${hasStrengthStructure ? " is-strength" : ""}`}
                  style={planSportStyle(entry.sport)}
                >
                  <span
                    className={`chat-plan-entry-date${dateParts ? "" : " is-undated"}`}
                    title={scheduleDate ?? "Saved to library only"}
                  >
                    {dateParts ? (
                      <>
                        <span className="chat-plan-entry-weekday">
                          {dateParts.weekday}
                        </span>
                        <span className="chat-plan-entry-day">{dateParts.day}</span>
                        <span className="chat-plan-entry-month">
                          {dateParts.month}
                        </span>
                      </>
                    ) : (
                      <Bookmark size={14} aria-hidden="true" />
                    )}
                  </span>
                  <span className="chat-plan-entry-main">
                    <span className="chat-plan-entry-name">{entry.name}</span>
                    {hasStrengthStructure && entry.source ? (
                      <StrengthPlanStructure
                        source={entry.source}
                        unitSystem={unitSystem}
                      />
                    ) : (
                      <span className="chat-plan-entry-steps">{steps}</span>
                    )}
                  </span>
                  <span className="chat-plan-entry-meta">
                    {!hasStrengthStructure ? (
                      <span className="chat-plan-entry-volume">{volume}</span>
                    ) : null}
                    <span className="chat-plan-entry-tags">
                      <span className="chat-plan-entry-type">
                        {entry.workoutType}
                      </span>
                      <span className="chat-plan-entry-sport">
                        <SportIcon size={11} strokeWidth={2.2} aria-hidden="true" />
                        {formatWorkoutSport(entry.sport ?? "run")}
                      </span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div className="chat-plan-empty-week">
          <Bookmark size={16} aria-hidden="true" />
          <span>This plan does not contain any workouts yet.</span>
        </div>
      )}
      {draft.conflicts.length > 0 ? (
        <details
          className="chat-plan-issues"
          data-tone="alert"
          open={draft.conflicts.length <= 3}
        >
          <summary>
            <span>
              <TriangleAlert size={13} aria-hidden="true" />
              <strong>
                {draft.conflicts.length}{" "}
                {draft.conflicts.length === 1
                  ? "scheduling conflict"
                  : "scheduling conflicts"}
              </strong>
            </span>
            <small>Review before saving</small>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <ul className="chat-plan-warnings">
            {draft.conflicts.map((item) => (
              <li key={item}>
                <TriangleAlert size={12} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {draft.warnings.length > 0 ? (
        <details
          className="chat-plan-issues"
          data-tone="note"
          open={draft.warnings.length <= 3}
        >
          <summary>
            <span>
              <Info size={13} aria-hidden="true" />
              <strong>
                {draft.warnings.length}{" "}
                {draft.warnings.length === 1 ? "plan note" : "plan notes"}
              </strong>
            </span>
            <small>Additional plan details</small>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <ul className="chat-plan-notes">
            {draft.warnings.map((item) => (
              <li key={item}>
                <Info size={12} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!isUploaded ? (
        <fieldset className="chat-plan-confirmation" disabled={uploading}>
          <legend>How should this plan be saved?</legend>
          <div className="chat-plan-destination-options">
            <label
              className={`chat-plan-destination-option is-primary${
                destination === "localPlan" ? " is-selected" : ""
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="localPlan"
                checked={destination === "localPlan"}
                onChange={() => setDestination("localPlan")}
              />
              <span className="chat-plan-destination-icon">
                <BookOpen size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>Training Plan</strong>
                <small>Keep these workouts together as one editable plan in Heracles Records.</small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
            <label
              className={`chat-plan-destination-option${
                destination === "workoutLibrary" ? " is-selected" : ""
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="workoutLibrary"
                checked={destination === "workoutLibrary"}
                onChange={() => setDestination("workoutLibrary")}
              />
              <span className="chat-plan-destination-icon">
                <Bookmark size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>Individual Workouts</strong>
                <small>Save each workout separately to the COROS Workout Library.</small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
            <label
              className={`chat-plan-destination-option${
                destination === "calendar" ? " is-selected" : ""
              }${unscheduledWorkoutCount > 0 ? " is-disabled" : ""}`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="calendar"
                checked={destination === "calendar"}
                onChange={() => setDestination("calendar")}
                disabled={unscheduledWorkoutCount > 0}
              />
              <span className="chat-plan-destination-icon">
                <CalendarDays size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>Calendar</strong>
                <small>
                  {unscheduledWorkoutCount > 0
                    ? `${unscheduledWorkoutCount} ${
                        unscheduledWorkoutCount === 1 ? "workout needs" : "workouts need"
                      } a date.`
                    : "Schedule workouts on the dates shown above."}
                </small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
          </div>
          <p
            className="chat-plan-destination-summary"
            data-tone={
              destination === "calendar" && draft.conflicts.length > 0
                ? "alert"
                : "ok"
            }
          >
            {destination === "calendar" && draft.conflicts.length > 0 ? (
              <TriangleAlert size={13} aria-hidden="true" />
            ) : (
              <CircleCheck size={13} aria-hidden="true" />
            )}
            <span>
              {destination === "localPlan"
                ? `This will be saved as one grouped plan with ${draft.entries.length} ${
                    draft.entries.length === 1 ? "workout" : "workouts"
                  } in your Heracles Records Training Library.`
                : destination === "calendar"
                  ? `${scheduledWorkoutCount} ${
                      scheduledWorkoutCount === 1 ? "workout" : "workouts"
                    } will be added to your COROS Calendar.${
                      draft.conflicts.length > 0
                        ? ` Review ${draft.conflicts.length} ${
                            draft.conflicts.length === 1 ? "conflict" : "conflicts"
                          } before adding.`
                        : " No scheduling conflicts."
                    }`
                  : `${draft.entries.length} ${
                      draft.entries.length === 1 ? "workout" : "workouts"
                    } will be saved individually to your COROS Workout Library. Dates will not be added to Calendar.`}
            </span>
          </p>
        </fieldset>
      ) : null}
      {uploadedResult || isUploaded ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {(uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination) === "localPlan"
              ? `Saved as a grouped plan in ${destinationLabel.localPlan}.`
              : `Saved to ${destinationLabel[uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination]}. ${
                  uploadedResult?.workoutsScheduled ?? draft.uploadResult?.workoutsScheduled ?? 0
                } scheduled, ${
                  uploadedResult?.workoutsCreated ?? draft.uploadResult?.workoutsCreated ?? 0
                } saved to library.`}
          </span>
        </p>
      ) : (
        <div className="chat-plan-actions">
          {onReview ? (
            <button
              type="button"
              className="chat-plan-review"
              onClick={onReview}
              disabled={uploading}
              title="Open this plan in the Training Library editor"
            >
              <BookOpen size={14} aria-hidden="true" />
              Edit plan first
            </button>
          ) : null}
          <button
            type="button"
            className="chat-plan-upload"
            onClick={() => onUpload(destination)}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : destination === "localPlan" ? (
              <BookOpen size={14} aria-hidden="true" />
            ) : destination === "calendar" ? (
              <CalendarDays size={14} aria-hidden="true" />
            ) : (
              <Bookmark size={14} aria-hidden="true" />
            )}
            {destination === "localPlan"
              ? "Save Plan"
              : destination === "calendar"
                ? "Add to Calendar"
                : "Save Workouts"}
          </button>
        </div>
      )}
    </div>
  );
}

function CoachDraftPreviewCard({
  draft,
  uploading,
  uploaded,
  onUpload,
  onReview
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: (
    destination: TrainingPlanDestination,
    scheduleDate?: string
  ) => void;
  onReview?: () => void;
}) {
  if (draft.artifactType === "workout") {
    return (
      <WorkoutPreviewCard
        draft={draft}
        uploading={uploading}
        uploaded={uploaded}
        onUpload={onUpload}
      />
    );
  }

  return (
    <PlanPreviewCard
      draft={draft}
      uploading={uploading}
      uploaded={uploaded}
      onUpload={onUpload}
      onReview={onReview}
    />
  );
}

function deleteTargetLabel(target: WorkoutDeletePreview["target"]): string {
  if (target === "scheduled") return "Calendar";
  if (target === "library") return "Library";
  return "Calendar and library";
}

function DeletePreviewCard({
  preview,
  deleting,
  deleted,
  onConfirm
}: {
  preview: WorkoutDeletePreview;
  deleting: boolean;
  deleted?: DeleteWorkoutResult;
  onConfirm: () => void;
}) {
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
      {deleted ? (
        <p className="chat-plan-success">{deleted.message}</p>
      ) : (
        <div className="chat-plan-actions">
          <button
            type="button"
            className="chat-delete-confirm"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : (
              <Trash2 size={14} aria-hidden="true" />
            )}
            Delete from COROS
          </button>
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: SourceInfo }) {
  if (source.mcpUsed) {
    const tools = source.mcpTools.filter(Boolean);
    return (
      <div className={`chat-source ${source.mcpError ? "chat-source-error" : "chat-source-mcp"}`}>
        <Database size={12} aria-hidden="true" />
        MCP
        {tools.length > 0 ? ` · ${[...new Set(tools)].join(", ")}` : ""}
        {source.mcpError ? " · failed" : ""}
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
  onReviewPlan,
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
  const [selectedPlanDraftId, setSelectedPlanDraftId] = useState<
    string | null
  >(null);
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
  const [uploadedPlans, setUploadedPlans] = useState<
    Record<string, UploadPlanResult>
  >({});
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(
    null
  );
  const [deletedWorkouts, setDeletedWorkouts] = useState<
    Record<string, DeleteWorkoutResult>
  >({});
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
    composerRef.current?.setDraft(pendingPrompt);
    onPendingPromptConsumed?.();
    // Focus after the coach panel becomes visible.
    requestAnimationFrame(() => composerRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingPrompt,
    checkingAuth,
    authStatus?.signedIn,
    claudeStatus?.state,
    chatSettings.provider
  ]);

  const resetEphemeralChatState = () => {
    setUploadedPlans({});
    setDeletedWorkouts({});
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
            ? { kind: "coachPrompt", prompt: originalPrompt }
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
        return;
      }
      resumedCoachPromptRef.current = null;
      if (finalText || coachPrompts.length > 0) {
        setTimeline((prev) => {
          let next: ChatEntry[] = [...prev];
          if (source?.mcpError) {
            next.push({ kind: "toolNotice", message: source.mcpError });
          }
          if (finalText) {
            next.push({
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
        streamedTextRef.current += payload.delta;
        setStreamingText((prev) => prev + payload.delta);
      }),
      api.onChatStreamInfo((payload) => {
        // Cards (plan drafts, charts) belong to whoever asked for them; an
        // analysis's transcript is reloaded from disk when its run ends.
        if (payload.requestId === liveAnalysisRef.current?.runId) return;
        if (payload.requestId !== activeRequestIdRef.current) return;
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
        } else if (payload.kind === "workoutDelete") {
          setTimeline((prev) =>
            upsertWorkoutDeleteEntry(prev, payload.preview)
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
            let next: ChatEntry[] = [...prev];
            if (partialText) {
              next.push({
                kind: "message",
                role: "assistant",
                content: partialText,
                source,
                reasoningSummary,
                ...(payload.usage ? { usage: payload.usage } : {})
              });
            }
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
      onError(caught instanceof Error ? caught.message : "ChatGPT sign-in failed.");
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
        caught instanceof Error
          ? caught.message
          : "Claude Code detection failed."
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
        caught instanceof Error
          ? caught.message
          : "Could not save Claude settings."
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
      onError(caught instanceof Error ? caught.message : "Could not start a new chat.");
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
        caught instanceof Error ? caught.message : "Could not rename chat."
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
      onError(caught instanceof Error ? caught.message : "Could not delete chat.");
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
      onError(caught instanceof Error ? caught.message : "Provider change failed.");
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
        caught instanceof Error
          ? caught.message
          : "Could not save the reasoning effort."
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
        caught instanceof Error
          ? caught.message
          : "Could not save the selected model."
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
        caught instanceof Error
          ? caught.message
          : "Could not compact this conversation.",
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
        caught instanceof Error ? caught.message : "Could not read the context.";
      setContextInspection((current) =>
        current?.sessionId === sessionId ? { ...current, error: message } : current
      );
    }
  };

  const sendMessage = async (
    trimmed: string,
    answeredPrompt?: { promptId: string; choiceId: string }
  ): Promise<boolean> => {
    if (!api || !trimmed || streaming || exportingLatestActivity) return false;
    if (isLatestActivityFileRequest(trimmed)) {
      await handleLatestActivityFileRequest(trimmed);
      return true;
    }
    if (
      chatSettings.provider === "openrouter" &&
      !chatSettings.openRouter.hasApiKey
    ) {
      onError("Add an OpenRouter API key in Settings, under Connections.");
      return false;
    }
    if (chatSettings.provider === "local" && !chatSettings.local.model.trim()) {
      onError("Enter a local model before starting the coach.");
      return false;
    }
    if (
      chatSettings.provider === "claude-api" &&
      !chatSettings.anthropic.hasApiKey
    ) {
      onError(
        "Save an Anthropic API key in Settings, under Connections, before starting the coach."
      );
      return false;
    }
    let answeredPromptIndex = answeredPrompt
      ? timeline.findIndex(
          (entry) =>
            entry.kind === "coachPrompt" &&
            entry.prompt.promptId === answeredPrompt.promptId &&
            entry.prompt.answeredAt === undefined
        )
      : -1;
    if (answeredPromptIndex < 0) {
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
            kind: "coachPrompt",
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
    const nextEntries: ChatEntry[] = originalPrompt
      ? answeredTimeline
      : [
          ...answeredTimeline,
          { kind: "message", role: "user", content: trimmed }
        ];
    const requestId = crypto.randomUUID();

    activeRequestIdRef.current = requestId;
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
    const context = await compactBeforeSend(
      activeSessionIdRef.current,
      persisted
    );
    // Stop landed while the summariser was running. Nothing has reached a
    // provider, and the athlete's turn is already in the transcript.
    if (activeRequestIdRef.current !== requestId) return true;
    const wireMessages = [
      ...(context?.summary ? [summaryContextMessage(context.summary)] : []),
      ...toWireMessages(persisted.slice(context?.tailStart ?? 0))
    ];
    try {
      await api.sendChat(requestId, wireMessages, unitSystem);
    } catch (caught) {
      activeRequestIdRef.current = null;
      setStreaming(false);
      if (originalPrompt) {
        resumedCoachPromptRef.current = null;
        const restoredEntries = timeline.map((entry): ChatEntry =>
          entry.kind === "coachPrompt" &&
          entry.prompt.promptId === originalPrompt.promptId
            ? { kind: "coachPrompt", prompt: originalPrompt }
            : entry
        );
        setTimeline(restoredEntries);
        persistHistory(activeSessionIdRef.current, restoredEntries, true);
      }
      onError(caught instanceof Error ? caught.message : "Chat request failed.");
    }
    return true;
  };

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
    scheduleDate?: string
  ) => {
    if (!api || uploadingDraftId) return;
    setUploadingDraftId(draftId);
    onError(null);
    try {
      const result = await api.uploadTrainingPlanDraft(
        draftId,
        unitSystem,
        destination,
        scheduleDate
      );
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
                kind: "planDraft" as const,
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
                    localPlanId: result.localPlanId,
                    groupedPlanCreated: result.groupedPlanCreated
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
        caught instanceof Error
          ? caught.message
          : "Failed to save the workout or plan to COROS."
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
    setTimeline((prev) => {
      const next = prev.map((entry): ChatEntry =>
        entry.kind === "planDraft" && entry.draft.draftId === draftId
          ? {
              kind: "planDraft",
              draft: { ...entry.draft, removedAt: Date.now() }
            }
          : entry
      );
      persistHistory(activeSessionIdRef.current, next, true);
      return next;
    });
  };

  const handleReviewPlanDraft = (draft: PlanDraftPreview) => {
    if (!onReviewPlan) return;
    try {
      onError(null);
      onReviewPlan(trainingPlanFromCoachDraftPreview(draft));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "The Coach plan could not be opened in the Training Library.");
    }
  };

  const handleScrollToPlanChat = (draftId: string) => {
    const planIndex = timeline.findIndex(
      (entry) => entry.kind === "planDraft" && entry.draft.draftId === draftId
    );
    if (planIndex < 0) return;

    let targetIndex = timeline.findIndex(
      (entry, index) =>
        index > planIndex &&
        entry.kind === "message" &&
        entry.role === "assistant"
    );
    if (targetIndex < 0) {
      for (let index = planIndex - 1; index >= 0; index -= 1) {
        const entry = timeline[index];
        if (entry.kind === "message" && entry.role === "assistant") {
          targetIndex = index;
          break;
        }
      }
    }
    if (targetIndex < 0) return;

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

  const handleConfirmWorkoutDelete = async (requestId: string) => {
    if (!api || deletingRequestId) return;
    setDeletingRequestId(requestId);
    onError(null);
    try {
      const result = await api.confirmWorkoutDelete(requestId);
      setDeletedWorkouts((prev) => ({ ...prev, [requestId]: result }));
      onPlanUploaded?.();
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Failed to delete workout from COROS."
      );
    } finally {
      setDeletingRequestId(null);
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
        caught instanceof Error
          ? caught.message
          : "Latest activity FIT export failed.";
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
  const openCreation =
    planDrafts.find((draft) => draft.draftId === openCreationId) ?? null;
  const trainingPlanDrafts = planDrafts.filter(
    (draft) => draft.artifactType !== "workout"
  );
  const openCreationKicker =
    openCreation === null
      ? ""
      : openCreation.artifactType === "workout"
        ? "One-off workout"
        : `Plan ${
            trainingPlanDrafts.findIndex(
              (draft) => draft.draftId === openCreation.draftId
            ) + 1
          } of ${trainingPlanDrafts.length}`;

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
      setSelectedPlanDraftId(ids.at(-1) ?? null);
      return;
    }
    const fresh = ids.filter((id) => !seenPlanDraftIdsRef.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seenPlanDraftIdsRef.current.add(id);
    setSelectedPlanDraftId(fresh[fresh.length - 1] ?? null);
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
          {planDrafts.length > 0 ? (
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
              <span className="chat-creations-count">{planDrafts.length}</span>
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

          {timeline.map((entry, index) => {
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
                return null;
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

            if (entry.kind === "planDraft") {
              // Removed by the athlete: the entry stays so the saved array
              // keeps its length, but nothing draws it.
              if (entry.draft.removedAt) {
                return null;
              }
              // Creations are read from the panel and the popup it opens, at
              // every window width. There used to be a second copy of the card
              // inline here for windows too narrow to hold the panel, and the
              // width test that chose between them also decided whether the
              // header's Creations button existed — so narrowing the window
              // took the button away and left the panel with no way back.
              return null;
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
                    <DeletePreviewCard
                      preview={entry.preview}
                      deleting={deletingRequestId === entry.preview.requestId}
                      deleted={deletedWorkouts[entry.preview.requestId]}
                      onConfirm={() =>
                        void handleConfirmWorkoutDelete(entry.preview.requestId)
                      }
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
          })}

          {streaming ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble chat-bubble-streaming">
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
          ) : null}

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
        {planPanelOpen && planDrafts.length > 0 ? (
          <aside
            id="chat-creations-panel"
            className="chat-plan-panel"
            aria-label="Coach creations"
          >
            <header className="chat-plan-list-header">
              <div>
                <span className="chat-plan-panel-icon">
                  <BookOpen size={15} aria-hidden="true" />
                </span>
                <div>
                  <strong>Coach creations</strong>
                  <span>Plans and one-off workouts</span>
                </div>
              </div>
              <div className="chat-plan-list-header-end">
                <strong className="chat-plan-list-count">
                  {planDrafts.length}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Hide Coach creations"
                  title="Hide Coach creations"
                  onClick={() => setPlanPanelOpen(false)}
                >
                  <PanelRightClose size={16} aria-hidden="true" />
                </button>
              </div>
            </header>
            <ol className="chat-plan-list">
              {planDrafts.map((draft, index) => {
                const saved = Boolean(
                  uploadedPlans[draft.draftId] ||
                    draft.uploadResult ||
                    draft.uploadedAt
                );
                const isWorkout = draft.artifactType === "workout";
                const planNumber = isWorkout
                  ? 0
                  : planDrafts
                      .slice(0, index + 1)
                      .filter((item) => item.artifactType !== "workout").length;
                const weeks = isWorkout
                  ? 0
                  : Math.max(
                      1,
                      groupPlanEntriesByWeek(draft.entries).filter(
                        (week) => week.id !== "unscheduled"
                      ).length
                    );
                const primarySport = draft.entries[0]?.sport;
                const SportIcon = sportTheme(primarySport).icon;
                const selected = draft.draftId === selectedPlanDraftId;

                return (
                  <li key={draft.draftId}>
                    <button
                      type="button"
                      className={`chat-plan-list-item${
                        selected ? " is-selected" : ""
                      }`}
                      onClick={() => {
                        setSelectedPlanDraftId(draft.draftId);
                        setOpenCreationId(draft.draftId);
                      }}
                      aria-haspopup="dialog"
                      aria-label={`Open ${draft.name || `${isWorkout ? "workout" : "plan"} ${index + 1}`}`}
                    >
                      <span
                        className="chat-plan-list-sport"
                        style={planSportStyle(primarySport)}
                      >
                        <SportIcon
                          size={15}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="chat-plan-list-copy">
                        <span className="chat-plan-list-kicker">
                          {isWorkout ? "One-off workout" : `Plan ${planNumber}`}
                        </span>
                        <strong>
                          {draft.name || (isWorkout ? "Untitled workout" : "Untitled plan")}
                        </strong>
                        <span className="chat-plan-list-meta">
                          <span>
                            {draft.entries.length}{" "}
                            {draft.entries.length === 1
                              ? "workout"
                              : "workouts"}
                          </span>
                          {!isWorkout ? (
                            <span>
                              {weeks} {weeks === 1 ? "week" : "weeks"}
                            </span>
                          ) : (
                            <span>Workout Library</span>
                          )}
                          <span data-status={saved ? "saved" : "draft"}>
                            {saved ? "Saved" : "Draft"}
                          </span>
                        </span>
                      </span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
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
      <CoachCreationModal
        draft={openCreation}
        kicker={openCreationKicker}
        onClose={() => setOpenCreationId(null)}
        onViewInChat={() => {
          if (!openCreation) return;
          setOpenCreationId(null);
          handleScrollToPlanChat(openCreation.draftId);
        }}
        onRemove={() => {
          if (!openCreation) return;
          handleRemovePlanDraft(openCreation.draftId);
        }}
      >
        {openCreation ? (
          <CoachDraftPreviewCard
            key={openCreation.draftId}
            draft={openCreation}
            uploading={uploadingDraftId === openCreation.draftId}
            uploaded={uploadedPlans[openCreation.draftId]}
            onUpload={(destination, scheduleDate) =>
              void handleUploadPlanDraft(
                openCreation.draftId,
                destination,
                scheduleDate
              )
            }
            onReview={
              onReviewPlan
                ? () => handleReviewPlanDraft(openCreation)
                : undefined
            }
          />
        ) : null}
      </CoachCreationModal>
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
