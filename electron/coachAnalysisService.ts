import { BrowserWindow } from "electron";
import {
  cancelChat,
  createCollectorSink,
  createIdleWatchdog,
  getChatAuthStatus,
  getChatSettings,
  streamChat
} from "./chatService";
import type { ChatStreamCollectorSink, ChatStreamSink } from "./chatService";
import {
  applyTranscriptContext,
  summaryContextMessage,
  toWireMessages,
  type ContextWindow,
  type StoredTranscriptSummary
} from "./chatContextCompaction";
import {
  getContextWindow,
  readSessionSummary,
  rollTranscriptSummary,
  writeSessionSummary
} from "./chatContextService";
import {
  chatSessionExists,
  createChatSession,
  getChatSession,
  saveChatSession,
  setChatSessionTitle
} from "./chatHistoryStore";
import {
  getCoachAnalysis,
  listCoachAnalysisRuns,
  recordCoachAnalysisRun,
  setCoachAnalysisEnabled,
  setCoachAnalysisSchedule,
  getCoachAnalysisBudget,
  getCoachAnalysisPause,
  setCoachAnalysisBudget,
  setCoachAnalysisPause,
  updateCoachAnalysisRun
} from "./coachAnalysisStore";
import {
  listCoachActivityRowsAfter,
  sumCoachAnalysisTokensSince
} from "./database";
import type { CoachUnseenActivityRow as CoachActivityRow } from "./database";
import { getTrainingHubStatus, reconnectTrainingHub } from "./trainingHubService";
import { corosSportName } from "./corosSportTypes";
import { runExclusively } from "./sync/automationLease";
import { ANALYSIS_DEFAULT_EFFORT, NOTHING_TO_REPORT } from "./types";
import type {
  AnthropicEffort,
  AnalysisRuntime,
  ClaudeCodeConnectionState,
  AnalysisTriggerKind,
  ChatEntryAnalysisMarker,
  ChatMessage,
  ChatProvider,
  ChatTokenUsage,
  CoachAnalysis,
  AnalysisTrigger,
  CoachAnalysisPause,
  CoachAnalysisRun,
  CoachAnalysisRunQuery,
  CoachAnalysisSpend,
  CoachAnalysisUpdate,
  PersistedChatEntry,
  ProviderAuthVerdict
} from "./types";

// ---------------------------------------------------------------------------
// Output contract (5.5)
// ---------------------------------------------------------------------------

const SUMMARY_MAX = 140;

/**
 * Appended to every playbook by the runner, not editable per analysis.
 *
 * It asks for the two things the app cannot work without — an opening sentence
 * to put in the run log, and a way to say "nothing happened" — and nothing
 * else. An earlier version also dictated "up to 3 observations" and "at most 1
 * recommended action"; that is editorial taste, not machinery, and it quietly
 * overruled the athlete's own playbook, because it came last in the prompt. A
 * playbook asking for a week-by-week table could not get one.
 *
 * Rule 2 gives the reason rather than a list of prohibitions. A model told what
 * a line is *for* places it correctly in cases nobody enumerated; a model given
 * "no heading, no bullet, no table" only learns about the three cases someone
 * thought of.
 */
export const AUTOMATION_OUTPUT_CONTRACT = [
  "---",
  "Two house rules from the app. They sit on top of the playbook above and do",
  "not replace it — the playbook decides what to look at, how long to be, and",
  "how the answer is laid out.",
  "",
  `1. If nothing is materially different from recent history, reply with exactly ${NOTHING_TO_REPORT} and nothing else.`,
  `2. Otherwise make the very first line one plain sentence saying what you found, under ${SUMMARY_MAX} characters. The app shows that line on its own, away from the rest of the answer, so it has to make sense with no context around it. Everything after that line belongs to the playbook — length, structure, tables, whatever it asked for.`
].join("\n");

export { NOTHING_TO_REPORT };

export interface AnalysisOutput {
  /** The model found nothing worth reporting; the run is logged, not shown. */
  silent: boolean;
  /** The headline, for the badge and (phase 2) the notification body. */
  summary?: string;
}

/** Markup trimmed off both ends, so a run-log row is not full of asterisks. */
function trimMarkup(line: string): string {
  return line.replace(/^[\s>#*_`+-]+/, "").replace(/[\s*_`]+$/, "");
}

export function parseAnalysisOutput(text: string): AnalysisOutput {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { silent: true };
  }
  // Accept the marker on its own line anywhere in the answer: models routinely
  // wrap it in a sentence of preamble, and treating that as a real finding
  // would badge the athlete with an empty report.
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
  // Strip wrapper punctuation from the ends only — the marker's own
  // underscores must survive.
  const unwrap = (line: string): string =>
    line.replace(/^[*_`\s>-]+/, "").replace(/[*_`\s.]+$/, "");
  if (lines.some((line) => unwrap(line) === NOTHING_TO_REPORT)) {
    return { silent: true };
  }

  // Rule 2 puts the summary on the first line and says what it is for, so the
  // first line is simply read. The one guard is general rather than a list of
  // markdown constructs to skip: a line with no letters in it is not a
  // sentence, whatever syntax produced it.
  const line = lines.find((candidate) => /\p{L}/u.test(candidate)) ?? lines[0];
  return { silent: false, summary: trimMarkup(line).slice(0, SUMMARY_MAX) };
}

// ---------------------------------------------------------------------------
// Model and effort (section 7)
// ---------------------------------------------------------------------------

// Re-exported so callers that already talk to the runner do not need a second
// import for the one constant behind its decision.
export { ANALYSIS_DEFAULT_EFFORT };

/** The runtime a run actually uses, with section 7's default filled in. */
export function resolveAnalysisRuntime(
  analysis: CoachAnalysis
): AnalysisRuntime {
  return analysis.runtime.effort
    ? analysis.runtime
    : { ...analysis.runtime, effort: ANALYSIS_DEFAULT_EFFORT };
}

// ---------------------------------------------------------------------------
// Template rendering (2.5)
// ---------------------------------------------------------------------------

export interface AnalysisTemplateVars {
  rule?: { name?: string };
  date?: string;
  activity?: { name?: string; sport?: string };
  week?: { range?: string };
}

/** Renders `{{rule.name}}`-style variables; unknown ones collapse to "". */
export function renderAnalysisTemplate(
  template: string,
  vars: AnalysisTemplateVars
): string {
  const lookup: Record<string, string | undefined> = {
    "rule.name": vars.rule?.name,
    date: vars.date,
    "activity.name": vars.activity?.name,
    "activity.sport": vars.activity?.sport,
    "week.range": vars.week?.range
  };
  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => lookup[key] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function weekRange(now: Date): string {
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${isoDate(start)}..${isoDate(end)}`;
}

/**
 * The chip under an analysis's name in a transcript. Takes the trigger rather
 * than the analysis, because the analysis no longer has one — the analysis
 * does, and a manual analysis has none at all.
 */
function triggerLabel(trigger: AnalysisTrigger | null): string {
  if (!trigger) {
    return "Manual";
  }
  if (trigger.kind === "schedule") {
    return trigger.cadence === "weekly"
      ? `Weekly at ${trigger.timeOfDay}`
      : `Daily at ${trigger.timeOfDay}`;
  }
  if (trigger.kind === "activity") {
    if (!trigger.sportTypes.length) return "After any activity";
    const names = trigger.sportTypes.map((type) => corosSportName(type) ?? `sport ${type}`);
    return `After ${names.join(", ")}`;
  }
  if (trigger.kind === "threshold") {
    return `When ${trigger.metric} crosses ${trigger.value}`;
  }
  return "Manual";
}

// ---------------------------------------------------------------------------
// Which activities a analysis still owes an opinion on
// ---------------------------------------------------------------------------

/**
 * How far back one trigger will scan for candidates. Sport/duration/distance
 * filtering happens after the scan, so this has to be comfortably wider than
 * the fan-out cap or a rule that only fires on runs would lose a run buried
 * under a week of swims.
 */
const ACTIVITY_SCAN_LIMIT = 200;

/**
 * Ceiling on one catch-up sequence. A backlog longer than this analyses only
 * its most recent entries: replaying a month of history in one burst costs
 * real provider spend and buries the answer the athlete actually wanted.
 */
export const MULTI_ACTIVITY_MAX_PER_TRIGGER = 10;

/**
 * 3.2 step 3: an activity trigger fires only for the sports it names, and only
 * above its duration/distance floors. An empty `sportTypes` means every sport.
 */
export function activityMatchesTrigger(
  activity: CoachActivityRow,
  trigger: AnalysisTrigger | null
): boolean {
  if (!trigger || trigger.kind !== "activity") {
    return false;
  }
  if (trigger.sportTypes.length && !trigger.sportTypes.includes(activity.sport_type)) {
    return false;
  }
  if (
    trigger.minDurationSec !== undefined &&
    (activity.duration ?? 0) < trigger.minDurationSec
  ) {
    return false;
  }
  if (
    trigger.minDistanceM !== undefined &&
    (activity.distance ?? 0) < trigger.minDistanceM
  ) {
    return false;
  }
  return true;
}

/** The attach moment, in the epoch seconds `start_time` is stored in. */
function createdEpochSeconds(analysis: CoachAnalysis): number {
  const parsed = Date.parse(analysis.createdAt);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/**
 * What an activity-driven analysis should analyse on this trigger, oldest
 * first.
 *
 * The watermark is per analysis, and now so is the trigger: two
 * conversations attached a week apart legitimately owe answers on different
 * activities, and may not even be watching the same sports. The
 * analysis-wide `coach_seen_at` stamp only decides *when* the watcher fires.
 *
 * - Never analysed anything → the attach time is the floor, so attaching an
 *   analysis today does not replay the athlete's back catalogue.
 * - "Run now" on an analysis that never analysed anything → the newest
 *   matching activity, ignoring that floor. The athlete asked for an answer
 *   now, and an analysis attached five minutes ago would otherwise have
 *   nothing to say.
 * - `multiActivity` off → only the newest match, however many piled up.
 */
function selectActivitiesForAnalysis(
  analysis: CoachAnalysis,
  event: AnalysisTriggerEvent,
  deps: CoachAnalysisRunnerDeps
): CoachActivityRow[] {
  const trigger = analysis.trigger;
  if (!trigger || trigger.kind !== "activity") {
    return [];
  }

  const manualFirstRun =
    event.kind === "manual" && analysis.lastActivityAt === undefined;
  const floor = manualFirstRun
    ? undefined
    : analysis.lastActivityAt ?? createdEpochSeconds(analysis);

  const matched = deps
    .listActivitiesAfter(floor, ACTIVITY_SCAN_LIMIT)
    .filter((activity) => activityMatchesTrigger(activity, trigger));
  if (!matched.length) {
    return [];
  }
  if (!trigger.multiActivity || manualFirstRun) {
    return [matched[matched.length - 1]];
  }
  return matched.slice(-MULTI_ACTIVITY_MAX_PER_TRIGGER);
}

// ---------------------------------------------------------------------------
// Guard rails (4)
// ---------------------------------------------------------------------------

export type AnalysisSkipReason =
  | "disabled"
  | "missing-session"
  | "no-auth"
  | "offline"
  | "two-factor-required"
  | "quiet-hours"
  | "cooldown"
  | "budget"
  | "burst"
  /** Held off after a failed run, until this analysis's backoff expires (10). */
  | "backoff"
  /** Activity-driven, but nothing new to analyse since this analysis's watermark. */
  | "no-activity"
  /** Schedule-driven: the slot came due more than a day ago (3.1). */
  | "stale-slot"
  /** Another device holds the lease for this analysis and is running it.
   *  Normal for two machines out of three once analyses sync, and not a
   *  failure — the run happens, just not here. */
  | "another-device";

/** 2.3: at most this many analysis messages land in one conversation per hour. */
export const SESSION_BURST_PER_HOUR = 5;

/**
 * Section 10's per-analysis backoff: how long a analysis is held off after its
 * first, second and third consecutive failure. The last step is also the
 * ceiling — a provider that has been dead for three hours is not more dead at
 * four, and an hour is already long enough that the athlete notices the silence
 * rather than the retries.
 *
 * The reason it exists at all is that a `failed` run deliberately leaves
 * `lastRunAt` and the activity watermark where they were, so the work is not
 * lost. Nothing else then slows the retry down: an activity trigger against a
 * dead provider would re-offer the same activity on every 15-minute poll,
 * forever.
 */
export const AUTOMATION_BACKOFF_STEPS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];

function minutesToMs(minutes: number): number {
  return minutes * 60_000;
}

function localMinutes(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
}

/**
 * Local wall-clock "HH:mm" as minutes since midnight, or null if malformed.
 * Exported for the scheduler, which reads the same two shapes of time — a
 * trigger's `timeOfDay` and a quiet window's edges.
 */
export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Quiet hours may wrap midnight, so "22:00".."06:30" is one window. */
export function isWithinQuietHours(
  now: Date,
  quietHours?: { start: string; end: string }
): boolean {
  if (!quietHours) return false;
  const start = parseTimeOfDay(quietHours.start);
  const end = parseTimeOfDay(quietHours.end);
  if (start === null || end === null || start === end) return false;
  const minute = localMinutes(now);
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function startOfLocalDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * The athlete's month, on their wall clock, as the ISO stamp a run row is
 * compared against. A budget is something a person plans around, so it rolls
 * over when their calendar says so rather than at UTC midnight on the 1st.
 */
export function startOfLocalMonth(now: Date): string {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * 13: whether the analyses have spent their month's allowance.
 *
 * `>=` rather than `>`: a budget of 500k means five hundred thousand tokens are
 * what the athlete agreed to, and the run that would take them past it has not
 * been paid for. A ceiling that lets one more run through every time is not a
 * ceiling.
 */
export function isOverBudget(spent: number, budget: number | null): boolean {
  return budget !== null && budget > 0 && spent >= budget;
}

/**
 * The same question, asked of the deps — and asked in the order that matters.
 *
 * The ceiling is read first because the total is a SUM over the whole run log
 * and no ceiling is the default: without this, every athlete who never set a
 * budget pays for that scan on every run to discard the answer.
 */
/**
 * 13: what a run cost is the sum of every provider turn it took, and the
 * rolling summariser (5.7) is one of those turns. Undefined stays undefined —
 * "nobody reported" is a different fact from "it was free", and adding a
 * reported number to an unreported one must not quietly invent the missing
 * half as zero. Two unknowns are still one unknown; one known and one unknown
 * is the known part, which is the best the run log can honestly claim.
 */
function addTokenUsage(
  left: ChatTokenUsage | undefined,
  right: ChatTokenUsage | undefined
): ChatTokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens
  };
}

function overBudget(deps: CoachAnalysisRunnerDeps): boolean {
  const budget = deps.getBudget();
  if (budget === null || budget <= 0) {
    return false;
  }
  return isOverBudget(deps.getMonthToDateTokens(), budget);
}

// ---------------------------------------------------------------------------
// Guard rail 3: can this provider be asked at all?
// ---------------------------------------------------------------------------

/**
 * Everything the pre-flight reads, so the decision itself is pure and can be
 * driven through every provider without a chat service behind it.
 *
 * Every field is a **local** read — a stored OAuth token, the CLI state the app
 * recorded last time it looked, a key in the keychain, a configured model. None
 * of it is a network call, and that is a rule rather than an accident: a
 * pre-flight that reached out would be a second way for a run to hang, on the
 * one path that already learned what that costs (the idle bound).
 */
export interface ProviderAuthInputs {
  chatgptSignedIn: boolean;
  /** What the app recorded the last time it inspected the CLI; may be unseen. */
  claudeCodeState?: ClaudeCodeConnectionState;
  anthropicHasApiKey: boolean;
  localModel: string;
}

/**
 * Guard rail 3, for every provider rather than only ChatGPT.
 *
 * The states that decline are the ones that are both **unambiguous and
 * stable**: a CLI that is not installed or not signed in will still not be
 * either in fifteen minutes. Everything else is allowed through and left to the
 * stream, which reports auth failure the way it always did — `connecting` is in
 * flight, `connection-failed` may be a network that has since come back, and a
 * `claude-code` state the app has *never* recorded is the shape of a fresh
 * install whose Coach view nobody has opened yet. Declining on unknown would
 * hold every analysis on a machine where nothing is actually wrong.
 */
export function checkProviderAuth(
  provider: ChatProvider,
  inputs: ProviderAuthInputs
): ProviderAuthVerdict {
  if (provider === "chatgpt") {
    return inputs.chatgptSignedIn
      ? { ok: true }
      : { ok: false, reason: "ChatGPT is not signed in." };
  }
  if (provider === "claude-code") {
    if (inputs.claudeCodeState === "sign-in-required") {
      return { ok: false, reason: "Claude Code is not signed in." };
    }
    if (inputs.claudeCodeState === "not-installed") {
      return { ok: false, reason: "The Claude Code CLI is not installed." };
    }
    return { ok: true };
  }
  if (provider === "claude-api") {
    return inputs.anthropicHasApiKey
      ? { ok: true }
      : { ok: false, reason: "No Anthropic API key is stored." };
  }
  // A local server needs no sign-in, but with no model chosen there is nothing
  // to ask. That is the same class of answer — this run cannot start — and the
  // athlete fixes it in the same place.
  return inputs.localModel.trim()
    ? { ok: true }
    : { ok: false, reason: "No local model is configured." };
}

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

export interface CoachAnalysisRunnerDeps {
  now(): Date;
  /** Re-read at run time: a queued analysis's snapshot goes stale behind it. */
  getAnalysis(id: string): CoachAnalysis | null;
  setAnalysisSchedule(
    analysisId: string,
    schedule: {
      lastRunAt?: string | null;
      nextRunAt?: string | null;
      lastActivityAt?: number | null;
      backoffUntil?: string | null;
      backoffLevel?: number | null;
    }
  ): void;
  setAnalysisEnabled(analysisId: string, enabled: boolean): void;
  listRuns(filter: CoachAnalysisRunQuery): CoachAnalysisRun[];
  /** Activities newer than a analysis's watermark, oldest first. */
  listActivitiesAfter(
    afterEpochSeconds: number | undefined,
    limit: number
  ): CoachActivityRow[];
  recordRun(input: Omit<CoachAnalysisRun, "id" | "startedAt">): CoachAnalysisRun;
  updateRun(
    id: string,
    patch: Partial<Omit<CoachAnalysisRun, "id" | "analysisId" | "analysisId">>
  ): CoachAnalysisRun | null;
  /** Undefined when the conversation no longer exists (2.4). */
  getSessionEntries(sessionId: string): PersistedChatEntry[] | undefined;
  /** 5.7: the conversation's rolling summary and what it covers. */
  getSessionSummary(sessionId: string): StoredTranscriptSummary;
  setSessionSummary(sessionId: string, summary: string, through: number): void;
  /**
   * 5.7: the window the athlete configured, shared with the interactive chat.
   *
   * A seam rather than a direct `getChatSettings()` for the reason every other
   * seam here is one: the default reads SQLite, and no suite has a database.
   */
  getContextWindow(): ContextWindow;
  /**
   * 5.7: folds entries into the running summary. A null `summary` means it
   * could not — a roll is best-effort, and the run it is preparing for still
   * has to happen.
   *
   * `usage` comes back separately because a roll is a full provider turn and
   * 13 counts every one of them. It is reported whether or not the roll
   * produced anything: a summariser that spent its tokens and then declined
   * still spent them, and a budget that could not see the one feature built to
   * make long conversations affordable would under-report exactly where it
   * matters most.
   */
  rollSummary(
    previous: string | undefined,
    entries: PersistedChatEntry[],
    runtime: AnalysisRuntime
  ): Promise<{ summary: string | null; usage?: ChatTokenUsage }>;
  createSession(provider: ChatProvider): string;
  saveSession(sessionId: string, entries: PersistedChatEntry[]): void;
  setSessionTitle(sessionId: string, title: string): void;
  getChatProvider(): ChatProvider;
  /** Guard rail 3, per provider (see `checkProviderAuth`). */
  checkProviderAuth(provider: ChatProvider): ProviderAuthVerdict;
  ensureCorosSession(): Promise<
    { ok: true } | { ok: false; twoFactorRequired: boolean }
  >;
  /** Whether COROS credentials are on disk — a local read, never a request. */
  corosAuthenticated(): boolean;
  getPause(): CoachAnalysisPause | null;
  setPause(pause: CoachAnalysisPause | null): void;
  /** 13: the monthly ceiling in tokens, or null for none. */
  getBudget(): number | null;
  /** Tokens spent by analyses since the start of the current local month. */
  getMonthToDateTokens(): number;
  createCollector(marker: ChatEntryAnalysisMarker): ChatStreamCollectorSink;
  streamChat(
    sink: ChatStreamSink,
    runId: string,
    messages: ChatMessage[],
    options: {
      runtime?: CoachAnalysis["runtime"];
      toolPolicy: "read-only";
      roleInstructions?: string;
    }
  ): Promise<void>;
  emitRunUpdate(run: CoachAnalysisRun): void;
  /** Aborts an in-flight stream by run id; the same seam "Cancel" uses. */
  cancelRun(runId: string): void;
  /** How long a run may emit nothing before it is given up on. */
  idleTimeoutMs: number;
}

/**
 * A run update from outside the runner. The scheduler's `stale-slot` skips
 * never reach `runOneBinding`, so they need their own way onto the wire.
 */
export function emitAnalysisRunUpdate(run: CoachAnalysisRun): void {
  emitToAnyWindow("analysis:runUpdate", run);
}

/**
 * Section 10's pause, on the wire. Like a run update it may happen with no
 * window open at all — the trip is a scheduled run finding COROS locked at
 * 07:30 — so the banner reads the flag on mount and follows this afterwards.
 */
export function emitAnalysisPauseUpdate(pause: CoachAnalysisPause | null): void {
  emitToAnyWindow("analysis:pauseUpdate", pause);
}

/**
 * An analysis that changed, on the wire.
 *
 * Every surface that renders one — the row in the conversation header, the
 * detail screen — has to follow an edit made somewhere else, and none of them
 * asked. Until this existed the surfaces kept up through `analysesVersion`, a
 * counter local to ChatView's tree, so anything that counter did not reach
 * went on showing the old name and the old trigger until something unrelated
 * refreshed it.
 *
 * Deliberately *not* emitted for the clocks nothing renders — `last_run_at`,
 * the activity watermark, the backoff pair, `threshold_firing`. A push per
 * analysis per run for state no surface shows is the kind of chatter that
 * makes the next reviewer distrust the ones that matter. `next_run_at` is the
 * exception: a card says when it next fires, so booking a slot announces
 * itself.
 */
export function emitAnalysisUpdate(update: CoachAnalysisUpdate): void {
  emitToAnyWindow("analysis:changed", update);
}

/** The same push, from a caller holding the analysis rather than the event. */
export function emitAnalysisChanged(analysis: CoachAnalysis | null): void {
  if (!analysis) return;
  emitAnalysisUpdate({
    analysisId: analysis.id,
    sessionId: analysis.sessionId,
    analysis
  });
}

/**
 * Emits to whatever window exists *at emit time*. A run may start, continue or
 * finish with no window at all, so a reference is never captured up front.
 */
function emitToAnyWindow(channel: string, payload: unknown): void {
  const target = BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed()
  );
  target?.webContents.send(channel, payload);
}

function createDefaultDeps(): CoachAnalysisRunnerDeps {
  return {
    now: () => new Date(),
    getAnalysis: (id) => getCoachAnalysis(id),
    setAnalysisSchedule: (analysisId, schedule) => {
      setCoachAnalysisSchedule(analysisId, schedule);
    },
    setAnalysisEnabled: (analysisId, enabled) => {
      // Guard rail 2 breaking an analysis whose conversation is gone. The run
      // log says so on the next push; without this the row one tab away goes
      // on showing the toggle on and no broken marker.
      emitAnalysisChanged(setCoachAnalysisEnabled(analysisId, enabled));
    },
    listRuns: (filter) => listCoachAnalysisRuns(filter),
    listActivitiesAfter: (after, limit) => listCoachActivityRowsAfter(after, limit),
    recordRun: (input) => recordCoachAnalysisRun(input),
    updateRun: (id, patch) => updateCoachAnalysisRun(id, patch),
    getSessionEntries: (sessionId) => {
      // getChatSession returns [] both for "empty" and "gone", so an empty
      // transcript is confirmed against the session list instead.
      if (!chatSessionExists(sessionId)) return undefined;
      return getChatSession(sessionId);
    },
    getSessionSummary: (sessionId) => readSessionSummary(sessionId),
    setSessionSummary: (sessionId, summary, through) => {
      writeSessionSummary(sessionId, summary, through);
    },
    getContextWindow: () => getContextWindow(),
    rollSummary: (previous, entries, runtime) =>
      // The run's own provider and model (decision 2), not the interactive
      // chat's. A roll is a turn taken on this analysis's behalf: its cost
      // lands on this run's row (13), guard rail 3 pre-flighted *this* provider
      // and no other, and an analysis pointed at a second provider must not
      // quietly spend on the first.
      rollTranscriptSummary(previous, entries, {
        runtime,
        idleTimeoutMs: AUTOMATION_IDLE_TIMEOUT_MS
      }),
    createSession: (provider) => createChatSession(provider).id,
    saveSession: (sessionId, entries) => {
      saveChatSession(sessionId, entries);
    },
    setSessionTitle: (sessionId, title) => {
      setChatSessionTitle(sessionId, title);
    },
    getChatProvider: () => getChatSettings().provider,
    checkProviderAuth: (provider) => {
      const settings = getChatSettings();
      return checkProviderAuth(provider, {
        chatgptSignedIn: getChatAuthStatus().signedIn,
        ...(settings.claudeCode.lastConnectionStatus
          ? { claudeCodeState: settings.claudeCode.lastConnectionStatus }
          : {}),
        anthropicHasApiKey: settings.anthropic.hasApiKey,
        localModel: settings.local.model
      });
    },
    ensureCorosSession: async () => {
      if (getTrainingHubStatus().authenticated) {
        return { ok: true };
      }
      try {
        const result = await reconnectTrainingHub();
        if (result.twoFactorRequired) {
          return { ok: false, twoFactorRequired: true };
        }
        return result.status.authenticated
          ? { ok: true }
          : { ok: false, twoFactorRequired: false };
      } catch {
        return { ok: false, twoFactorRequired: false };
      }
    },
    corosAuthenticated: () => getTrainingHubStatus().authenticated,
    getBudget: () => getCoachAnalysisBudget(),
    getMonthToDateTokens: () => {
      const totals = sumCoachAnalysisTokensSince(startOfLocalMonth(new Date()));
      return totals.inputTokens + totals.outputTokens;
    },
    getPause: () => getCoachAnalysisPause(),
    setPause: (pause) => {
      setCoachAnalysisPause(pause);
      emitAnalysisPauseUpdate(pause);
    },
    createCollector: (marker) => createCollectorSink(marker),
    streamChat: (sink, runId, messages, options) =>
      streamChat(sink, runId, messages, options),
    emitRunUpdate: (run) => emitAnalysisRunUpdate(run),
    cancelRun: (runId) => cancelChat(runId),
    idleTimeoutMs: AUTOMATION_IDLE_TIMEOUT_MS
  };
}

let defaultDeps: CoachAnalysisRunnerDeps | null = null;
function resolveDeps(
  deps?: Partial<CoachAnalysisRunnerDeps>
): CoachAnalysisRunnerDeps {
  defaultDeps ??= createDefaultDeps();
  return deps ? { ...defaultDeps, ...deps } : defaultDeps;
}

// ---------------------------------------------------------------------------
// Trigger expansion and the run queue
// ---------------------------------------------------------------------------

export interface AnalysisTriggerEvent {
  analysisId: string;
  kind: AnalysisTriggerKind;
  payload?: Record<string, unknown>;
  /**
   * 3.4: a manual run bypasses cooldown, quiet hours and the daily cap, so the
   * athlete can build confidence in an analysis before enabling it.
   */
  bypassGuards?: boolean;
}

interface QueuedRun {
  analysis: CoachAnalysis;
  event: AnalysisTriggerEvent;
  /** The single activity this run analyses; absent for non-activity triggers. */
  activity?: CoachActivityRow;
  /** Position in a multi-activity catch-up sequence; 0 is the first run. */
  sequenceIndex: number;
}

/**
 * A trigger produces runs for **one** analysis, because an analysis is one
 * place.
 *
 * There used to be a fan-out here: a definition was attached to several
 * conversations and one trigger produced a run in each, ordered by session so
 * same-conversation runs stayed serialized. An analysis belongs to one
 * conversation now, so the list is at most one long before the activity
 * expansion below turns it into a catch-up sequence.
 *
 * The trigger kind is still checked. A schedule tick must not run an analysis
 * whose trigger is an activity filter, and the tick reads the analyses in one
 * pass rather than one query per kind. A manual run is exempt, as it is from
 * the guard rails: "run this one now" is the athlete asking, and a manual
 * analysis has no trigger to match.
 */
export function expandTriggerToQueue(
  event: AnalysisTriggerEvent,
  deps?: Partial<CoachAnalysisRunnerDeps>
): QueuedRun[] {
  const resolved = resolveDeps(deps);
  const analysis = resolved.getAnalysis(event.analysisId);
  if (!analysis || (!analysis.enabled && !event.bypassGuards)) {
    return [];
  }
  if (event.kind !== "manual" && analysis.trigger?.kind !== event.kind) {
    return [];
  }
  return [{ analysis, event, sequenceIndex: 0 }];
}

// One run at a time process-wide (5.4). The provider is the bottleneck anyway,
// and it makes the same-conversation serialization requirement automatic.
let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queueTail.then(task, task);
  queueTail = result.catch(() => undefined);
  return result;
}

// ---------------------------------------------------------------------------
// Cancelling a whole trigger (10)
// ---------------------------------------------------------------------------

/**
 * One fan-out's worth of "stop".
 *
 * Stop reaches the provider through the abort map, which is keyed by run id, so
 * on its own it ends exactly one run — and a trigger fans out to one run per
 * place (2.3), awaited in turn. Stopping a three-place fan-out therefore took
 * three presses, and the presses in between had nothing to aim at: the runs
 * they were meant to stop had not started, so they had no id yet.
 *
 * The token is the thing the fan-out is stopped by. `runAnalysisTrigger`
 * checks it between the steps of its plan, and every run it produces is claimed
 * by it, so Stop on any one of those runs finds the whole trigger — including
 * the run sitting in the process-wide queue behind a stall.
 */
interface TriggerCancellation {
  cancelled(): boolean;
  /** Ends the fan-out and aborts whatever it has in flight. */
  cancel(): void;
  /** Records a run as this fan-out's, so Stop on it reaches the token. */
  claim(runId: string): void;
  owns(runId: string): boolean;
}

/** Fan-outs in flight right now, so a Stop on one run can find its trigger. */
const liveTriggers = new Set<TriggerCancellation>();

function createTriggerCancellation(
  deps: CoachAnalysisRunnerDeps
): TriggerCancellation {
  const runIds = new Set<string>();
  let stopped = false;
  return {
    cancelled: () => stopped,
    cancel: () => {
      stopped = true;
      // Whatever is streaming right now is one of these; the rest have already
      // finished, and aborting a finished run is a no-op on the abort map.
      for (const runId of runIds) {
        deps.cancelRun(runId);
      }
    },
    claim: (runId) => {
      runIds.add(runId);
    },
    owns: (runId) => runIds.has(runId)
  };
}

/**
 * The Stop control, from any of the three surfaces (10). The athlete pressed it
 * on one run, but what they meant is "stop this" — so the trigger that produced
 * the run is ended, not just the stream it happens to be on.
 */
export function cancelAnalysisRun(
  runId: string,
  deps?: Partial<CoachAnalysisRunnerDeps>
): void {
  let owned = false;
  for (const token of liveTriggers) {
    if (token.owns(runId)) {
      owned = true;
      token.cancel();
    }
  }
  // No live trigger owns it: a stream left settling in its own time after a
  // timeout outlives the fan-out that started it, and is still worth aborting.
  if (!owned) {
    resolveDeps(deps).cancelRun(runId);
  }
}

// ---------------------------------------------------------------------------
// Running one analysis
// ---------------------------------------------------------------------------

function skip(
  queued: QueuedRun,
  reason: AnalysisSkipReason,
  deps: CoachAnalysisRunnerDeps,
  sessionId?: string,
  /** The reason in words, where the code alone would not say enough. */
  error?: string
): CoachAnalysisRun {
  const startedAt = deps.now().toISOString();
  const run = deps.recordRun({
    analysisId: queued.analysis.id,
    status: "skipped",
    triggerKind: queued.event.kind,
    skipReason: reason,
    finishedAt: startedAt,
    ...(queued.event.payload ? { triggerPayload: queued.event.payload } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(error ? { error } : {})
  });
  deps.emitRunUpdate(run);
  return run;
}

/** Guard rails 5-8, in the order section 4 fixes. */
function checkRateGuards(
  queued: QueuedRun,
  sessionId: string | null,
  deps: CoachAnalysisRunnerDeps
): AnalysisSkipReason | null {
  const { analysis, event } = queued;
  const now = deps.now();
  const conditions = analysis.conditions;

  if (event.bypassGuards) {
    return null;
  }

  // Guard rail 4b — the month's ceiling — is *not* here. It reads the same
  // `budget` skip code as the daily cap below, and folding the two into one
  // return value meant the runner could not tell them apart: exhausting one
  // analysis's three runs for the day raised the app-wide pause and held every
  // other analysis the athlete has. It is its own branch in `runOneBinding`,
  // which is also where section 4 numbers it.

  // Backoff comes first because it outlives the others and explains more: a
  // analysis that is both inside quiet hours and backed off is backed off for a
  // reason the athlete can act on, and the run log should say so.
  //
  // Unlike the cooldown below, this is checked at every step of a catch-up
  // sequence rather than only the first. A failure part-way through a sequence
  // is exactly the storm being prevented, and a `skipped` run ends the sequence
  // (see `runAnalysisTrigger`), so the leftovers ride along with the trigger
  // after the backoff expires.
  if (analysis.backoffUntil && now.getTime() < Date.parse(analysis.backoffUntil)) {
    return "backoff";
  }

  if (isWithinQuietHours(now, conditions.quietHours)) {
    return "quiet-hours";
  }

  // The cooldown governs how often a analysis may *react*, not how fast it may
  // work through the backlog that one reaction uncovered — so it is checked
  // once, on the first run of a multi-activity catch-up sequence.
  if (analysis.lastRunAt && queued.sequenceIndex === 0) {
    const elapsed = now.getTime() - new Date(analysis.lastRunAt).getTime();
    if (elapsed < minutesToMs(conditions.cooldownMin)) {
      return "cooldown";
    }
  }

  const today = deps.listRuns({
    analysisId: analysis.id,
    since: startOfLocalDay(now).toISOString(),
    statuses: ["success", "silent", "failed"]
  });
  if (today.length >= conditions.maxRunsPerDay) {
    return "budget";
  }

  if (sessionId) {
    // Both statuses that write to the transcript, which is what 2.3 is counting
    // — "five analysis messages per conversation per hour". A silent run is
    // not nothing: it persists 5.5's trace, it took a full provider turn to
    // decide it had nothing to say, and five coaches concluding that in the
    // same hour is exactly the wall of chips the guard exists to stop. It is
    // also the same pair 9.3 counts for the unread dot, for the same reason.
    const lastHour = deps.listRuns({
      sessionId,
      since: new Date(now.getTime() - 3_600_000).toISOString(),
      statuses: ["success", "silent"]
    });
    if (lastHour.length >= SESSION_BURST_PER_HOUR) {
      return "burst";
    }
  }

  return null;
}

/**
 * Section 10's backoff, applied to whatever the run turned out to be.
 *
 * A failure steps the analysis through `AUTOMATION_BACKOFF_STEPS_MS` and stays
 * on the last one; anything that reached the provider and did not fail clears
 * the streak. A *skip* does neither, and that is deliberate rather than an
 * omission: a skip never got as far as the provider, so it says nothing about
 * whether the provider is alive — and a `backoff` skip clearing the backoff
 * would be a guard rail that switches itself off on its first use.
 *
 * `analysis` is the row as it stood when the run started, which is the right
 * base: runs are serialised process-wide (5.4), so nothing else can have
 * touched this analysis's streak in between.
 */
function applyBackoff(
  analysis: CoachAnalysis,
  status: CoachAnalysisRun["status"] | undefined,
  deps: CoachAnalysisRunnerDeps
): void {
  if (status === "failed") {
    const level = Math.min(
      (analysis.backoffLevel ?? 0) + 1,
      AUTOMATION_BACKOFF_STEPS_MS.length
    );
    deps.setAnalysisSchedule(analysis.id, {
      backoffLevel: level,
      backoffUntil: new Date(
        deps.now().getTime() + AUTOMATION_BACKOFF_STEPS_MS[level - 1]
      ).toISOString()
    });
    return;
  }
  if (status !== "success" && status !== "silent" && status !== "cancelled") {
    return;
  }
  // Nothing is written for a analysis that had no streak to clear: a healthy
  // analysis must not rewrite its own row on every run.
  if (analysis.backoffLevel === undefined && analysis.backoffUntil === undefined) {
    return;
  }
  deps.setAnalysisSchedule(analysis.id, { backoffLevel: 0, backoffUntil: null });
}

/**
 * Where a run will write.
 *
 * This used to be resolved in two halves — check the target at guard rail 2,
 * create the conversation only after every other guard had passed — because a
 * `per-run` analysis that made its conversation up front left an empty thread
 * behind on every cooldown, quiet-hour or offline skip, and the activity
 * watcher polls every 15 minutes. Nothing creates a conversation any more: an
 * analysis names one the athlete opened, so the target either exists or the
 * run does not happen. The two halves collapse into one read.
 */
type SessionTarget = {
  sessionId: string;
  entries: PersistedChatEntry[];
};

/**
 * Guard rail 2. The conversation an analysis names is normally deleted
 * *with* the analysis (`applyAnalysisSessionDeleted`), so reaching this with
 * nothing there means the two got out of step — a merge from another machine
 * that carried the analysis but not the deletion, most likely. The
 * analysis is switched off rather than removed: a delete on a read that
 * might be a race is the one mistake with no way back.
 */
function checkSessionTarget(
  queued: QueuedRun,
  deps: CoachAnalysisRunnerDeps
): { ok: true; target: SessionTarget } | { ok: false; reason: AnalysisSkipReason } {
  const { analysis } = queued;

  const entries = analysis.sessionId
    ? deps.getSessionEntries(analysis.sessionId)
    : undefined;
  if (entries) {
    return {
      ok: true,
      target: { sessionId: analysis.sessionId, entries }
    };
  }

  deps.setAnalysisEnabled(analysis.id, false);
  return { ok: false, reason: "missing-session" };
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Context trimming (5.7)
// ---------------------------------------------------------------------------

/**
 * 5.7 shipped as analysis-only and is no longer: the interactive chat rolls
 * the same summary, through the same window, on the same conversation row. The
 * mechanism moved to [chatContextCompaction.ts](./chatContextCompaction.ts) and
 * the numbers moved to chat settings; these two are what an athlete who has
 * never opened that section gets, and what the suites here still assert.
 */
export {
  DEFAULT_CONTEXT_LIMIT as AUTOMATION_CONTEXT_LIMIT,
  DEFAULT_CONTEXT_KEEP as AUTOMATION_CONTEXT_KEEP,
  buildRollingSummaryTurn,
  planTranscriptContext,
  summaryContextMessage,
  toWireMessages,
  type StoredTranscriptSummary,
  type TranscriptContextPlan
} from "./chatContextCompaction";

/** The 2.5 variables, resolved once from the run's own trigger payload. */
function templateVars(
  queued: QueuedRun,
  deps: CoachAnalysisRunnerDeps
): AnalysisTemplateVars {
  const now = deps.now();
  return {
    rule: { name: queued.analysis.name },
    date: isoDate(now),
    week: { range: weekRange(now) },
    activity: {
      name: asText(queued.event.payload?.activityName),
      sport: asText(queued.event.payload?.activitySport)
    }
  };
}

/** "Long run · Run · 2026-08-21", for the run's focus line. */
function describeActivity(activity: CoachActivityRow): string {
  const parts: string[] = [asText(activity.name) ?? "Untitled activity"];
  const sport = asText(activity.sport_name);
  if (sport) {
    parts.push(sport);
  }
  if (activity.start_time) {
    parts.push(new Date(activity.start_time * 1000).toISOString().slice(0, 10));
  }
  return parts.join(" · ");
}

function buildPlaybookTurn(
  queued: QueuedRun,
  deps: CoachAnalysisRunnerDeps
): string {
  const body = renderAnalysisTemplate(
    queued.analysis.playbook,
    templateVars(queued, deps)
  );
  // A catch-up sequence sends the same playbook once per activity, so each run
  // has to name its own subject or the three answers would be interchangeable.
  const focus = queued.activity
    ? `\n\nAnalyse this activity specifically: ${describeActivity(queued.activity)}` +
      ` (activity id ${queued.activity.activity_id}).`
    : "";
  return `${body}${focus}\n\n${AUTOMATION_OUTPUT_CONTRACT}`;
}

/**
 * A run is bounded by silence rather than by wall clock. A playbook that walks
 * a month of activities through several tool rounds is legitimately slow; a
 * provider that has stopped answering emits nothing at all, and the tee sink
 * sees every token, tool call and status line, so it is the one place that can
 * tell the two apart.
 *
 * The bound matters beyond the run that trips it. Runs are serialised
 * process-wide (5.4), so a `streamChat` that never settles wedges every later
 * run and every later "Run now" for the life of the process — the athlete sees
 * a button that spins with nothing behind it. Neither the MCP connect nor the
 * provider fetch on this path carries a deadline of its own, so the runner
 * keeps one.
 */
export const AUTOMATION_IDLE_TIMEOUT_MS = 3 * 60_000;

/**
 * Returns null when the fan-out was stopped before this run began — including
 * while it waited its turn in the process-wide queue behind a stall (5.4).
 * Nothing was recorded, so there is nothing to log: a run log full of rows for
 * runs that never happened is not what Stop means.
 */
async function runOneBinding(
  queued: QueuedRun,
  deps?: Partial<CoachAnalysisRunnerDeps>,
  cancellation?: TriggerCancellation
): Promise<CoachAnalysisRun | null> {
  const resolved = resolveDeps(deps);
  const { event } = queued;

  if (cancellation?.cancelled()) {
    return null;
  }

  // The analysis was snapshotted when the trigger was expanded, and a catch-up
  // sequence writes to it between runs (its clock, its activity watermark), so
  // every guard below has to read the row as it stands now.
  const analysis = resolved.getAnalysis(queued.analysis.id) ?? queued.analysis;
  const step: QueuedRun = { ...queued, analysis };

  // 1. Still switched on — it may have flipped between queue and run.
  if (!event.bypassGuards && !analysis.enabled) {
    return skip(step, "disabled", resolved);
  }

  // 2. Target conversation resolvable — checked now, created below.
  const checked = checkSessionTarget(step, resolved);
  if (!checked.ok) {
    return skip(step, checked.reason, resolved);
  }
  const knownSessionId = checked.target.sessionId;

  // 2b. This activity is still owed. Two triggers can fan out from the same
  // watermark before either runs — a poll and a "Run now" seconds apart — and
  // the plan is built outside the run queue. The analysis was re-read above, so
  // the check costs nothing and stops the same activity being analysed twice
  // into the same conversation.
  if (
    step.activity?.start_time != null &&
    analysis.lastActivityAt !== undefined &&
    step.activity.start_time <= analysis.lastActivityAt
  ) {
    return skip(step, "no-activity", resolved, knownSessionId);
  }

  // 3. Chat provider usable, for every provider rather than only ChatGPT.
  // The verdict's reason rides along on the row: "not signed in" is the common
  // case but not the only one, and a run log that cannot tell a missing API key
  // from a missing CLI sends the athlete to the wrong screen.
  const provider = analysis.runtime.provider ?? resolved.getChatProvider();
  const auth = resolved.checkProviderAuth(provider);
  if (!auth.ok) {
    return skip(step, "no-auth", resolved, knownSessionId, auth.reason);
  }

  // 4. COROS session usable.
  const coros = await resolved.ensureCorosSession();
  if (!coros.ok) {
    if (!coros.twoFactorRequired) {
      return skip(step, "offline", resolved, knownSessionId);
    }
    // One skip explains it, and the pause is what stops the next fifteen from
    // repeating it (10). *Every* analysis is held, not this analysis: what has
    // to happen is one login code, and no analysis can supply it.
    const held = skip(step, "two-factor-required", resolved, knownSessionId);
    resolved.setPause({
      reason: "two-factor-required",
      since: resolved.now().toISOString(),
      runId: held.id
    });
    return held;
  }

  // COROS answered, so whatever was locking *it* is unlocked. A pause that
  // outlives its cause is worse than no pause at all: it is a feature that has
  // quietly switched itself off and has nothing to say about it.
  //
  // Only its own cause, though. A budget pause is about the athlete's money and
  // a working COROS session says nothing about it — and this line is reachable
  // with one up, because "Run now" bypasses the gate that would otherwise have
  // held this run (13). Clearing it here would take the banner down and let one
  // more unattended run through before guard rail 4b put it back.
  if (resolved.getPause()?.reason === "two-factor-required") {
    resolved.setPause(null);
  }

  // 4b. The month's allowance (13). Its own branch rather than one more rate
  // guard, because it is the only refusal here that is not a fact about this
  // analysis: it is one fact about every analysis the athlete has, so it
  // raises the pause the same way section 10's 2FA demand does, and one skip
  // per analysis per poll until the 1st is the run log that already learned not
  // to fill.
  if (!event.bypassGuards && overBudget(resolved)) {
    const declined = skip(
      step,
      "budget",
      resolved,
      knownSessionId,
      "This month's token budget is spent."
    );
    resolved.setPause({
      reason: "budget",
      since: resolved.now().toISOString(),
      runId: declined.id
    });
    return declined;
  }

  // 5-8. Rate guards. A conversation that does not exist yet cannot be busy,
  // so the burst guard only applies to one the analysis already writes into.
  //
  // Guard 7 shares the `budget` code with 4b above and nothing else: it is this
  // analysis's own three-runs-a-day, it clears at midnight without the athlete
  // doing anything, and it says nothing about the other analyses. The reason
  // in words is what keeps the run log able to tell the two apart.
  const rateSkip = checkRateGuards(step, knownSessionId ?? null, resolved);
  if (rateSkip) {
    return skip(
      step,
      rateSkip,
      resolved,
      knownSessionId,
      rateSkip === "budget"
        ? `This analysis has already run ${analysis.conditions.maxRunsPerDay} times here today.`
        : undefined
    );
  }

  const session = checked.target;

  // 5.7: a year-old briefing thread must still cost one turn. Done here, while
  // the run is still being prepared, so the mid-preparation Stop check below
  // covers the window a roll opens — a roll is itself a model call.
  const context = await applyTranscriptContext({
    entries: session.entries,
    stored: resolved.getSessionSummary(session.sessionId),
    window: resolved.getContextWindow(),
    roll: (previous, toSummarise) =>
      resolved.rollSummary(
        previous,
        toSummarise,
        resolveAnalysisRuntime(analysis)
      ),
    store: (rolled, through) =>
      resolved.setSessionSummary(session.sessionId, rolled, through)
  });
  const summary = context.summary;
  const tail = context.tail;
  // A roll is a provider turn on this run's behalf, so its tokens belong to
  // this run's row (13). Held here because the roll happens before the row
  // exists, and folded into whatever the run ends up recording — including the
  // exits that never reach the model, which is exactly when a roll that has
  // already spent would otherwise vanish from the month's total.
  const rollUsage: ChatTokenUsage | undefined = context.usage;
  /** What to record on a run that ended here, roll included. */
  const costOf = (streamUsage: ChatTokenUsage | undefined) => {
    const total = addTokenUsage(rollUsage, streamUsage);
    return total
      ? { inputTokens: total.inputTokens, outputTokens: total.outputTokens }
      : {};
  };

  // Section 7's default is resolved once, here, so the run log records what the
  // run actually used rather than what the definition happened to leave blank.
  const runtime = resolveAnalysisRuntime(analysis);
  const startedAt = resolved.now().toISOString();
  let run = resolved.recordRun({
    analysisId: analysis.id,
    status: "running",
    triggerKind: event.kind,
    sessionId: session.sessionId,
    ...(runtime.model ? { model: runtime.model } : {}),
    ...(runtime.effort ? { effort: runtime.effort } : {}),
    ...(event.payload ? { triggerPayload: event.payload } : {}),
    startedAt
  } as Omit<CoachAnalysisRun, "id" | "startedAt">);
  // The run now has an id, which is the only thing Stop can aim at. Claiming it
  // is what turns a Stop on this run into a Stop on the whole trigger.
  cancellation?.claim(run.id);
  resolved.emitRunUpdate(run);

  // `automationId` is the marker's *stored* key name, not a rename that was
  // missed: every transcript entry an athlete already has spells it that way,
  // and renaming it would cost historical runs their attribution.
  //
  // `bindingId` is deliberately absent. It named the attachment, which no
  // longer exists — writing the analysis id into it as well would be a second
  // copy of the same value that the next reader has to work out is redundant.
  // Entries that already carry one still parse; see `ChatEntryAnalysisMarker`.
  const marker: ChatEntryAnalysisMarker = {
    runId: run.id,
    automationId: analysis.id,
    name: analysis.name,
    triggerLabel: triggerLabel(analysis.trigger)
  };

  const playbook = buildPlaybookTurn(step, resolved);
  const collector = resolved.createCollector(marker);
  const watchdog = createIdleWatchdog(resolved.idleTimeoutMs);
  const sink = createTeeSink(collector, watchdog.touch);

  const finish = (
    patch: Partial<Omit<CoachAnalysisRun, "id" | "analysisId" | "analysisId">>,
    /**
     * False for the one exit taken before the provider was ever called. The
     * backoff is a claim about the provider, and a run that did not reach it
     * has nothing to say either way — least of all "it is healthy again".
     */
    reachedProvider = true
  ): CoachAnalysisRun => {
    // Every other way out of this run goes through here, which is what makes
    // the backoff cover the timeout as well as the throw — the two paths
    // section 10 says must behave alike, and the two that leave the other
    // clocks alone.
    if (reachedProvider) {
      applyBackoff(analysis, patch.status, resolved);
    }
    const finished =
      resolved.updateRun(run.id, {
        ...patch,
        finishedAt: resolved.now().toISOString()
      }) ?? run;
    resolved.emitRunUpdate(finished);
    return finished;
  };

  // Stop may have landed while the COROS check above was in flight. The run row
  // exists by now, so it is finished rather than dropped — but nothing was ever
  // asked of the provider, so this must not clear a backoff streak: an athlete
  // pressing Stop would otherwise reset the hold on a analysis that is failing.
  if (cancellation?.cancelled()) {
    // Nothing was asked of the model, but a roll on the way in may already have
    // spent — and it is spent whether or not this run got anywhere.
    return finish({ status: "cancelled", ...costOf(undefined) }, false);
  }

  let timedOut = false;
  try {
    const streaming = resolved.streamChat(
      sink,
      run.id,
      [
        ...(summary ? [summaryContextMessage(summary)] : []),
        ...toWireMessages(tail),
        { role: "user", content: playbook }
      ],
      {
        runtime,
        toolPolicy: "read-only",
        ...(analysis.role ? { roleInstructions: analysis.role } : {})
      }
    );
    // Nothing awaits the stream once the watchdog has won the race, so a
    // rejection arriving after that would be an unhandled one. Attaching a
    // handler here does not consume it: the race still sees the rejection.
    streaming.catch(() => undefined);
    await Promise.race([
      streaming,
      watchdog.expired.then(() => {
        timedOut = true;
      })
    ]);
  } catch (error) {
    return finish({
      status: "failed",
      error: error instanceof Error ? error.message : "Analysis run failed.",
      ...costOf(collector.usage())
    });
  } finally {
    watchdog.stop();
  }

  if (timedOut) {
    // Abort what can be aborted, and stop waiting on what cannot: a stall
    // inside a call that never looks at the signal would otherwise hold the
    // run queue behind it. The stream is left to settle in its own time.
    resolved.cancelRun(run.id);
    return finish({
      status: "failed",
      error: `The provider stopped responding — nothing arrived for ${Math.max(
        1,
        Math.round(resolved.idleTimeoutMs / 60_000)
      )} minutes.`,
      ...costOf(collector.usage())
    });
  }

  // The analysis's own clock advances for every attempt that reached the
  // provider, so a failing analysis still respects its cooldown.
  resolved.setAnalysisSchedule(analysis.id, {
    lastRunAt: resolved.now().toISOString()
  });

  if (collector.error()) {
    // A failed turn is not a refund: whatever its completed rounds spent comes
    // back on `chat:streamError`, and the roll above is added to it (13).
    const errorCost = costOf(collector.usage());
    return finish(
      collector.authError()
        ? {
            status: "skipped",
            skipReason: "no-auth",
            error: collector.error(),
            ...errorCost
          }
        : { status: "failed", error: collector.error(), ...errorCost }
    );
  }
  // Recorded before the status branches below, so every way out of a run that
  // reached the provider carries what it cost — a failed or cancelled run spent
  // tokens too, and a budget that forgave those would be a budget a broken
  // provider could run through for free.
  const cost = costOf(collector.usage());

  if (collector.cancelled()) {
    return finish({ status: "cancelled", ...cost });
  }

  // The analysis's watermark moves only once the model has actually looked at
  // the activity *and* what it said is on disk. A failed or cancelled run
  // leaves it where it was, so the activity comes back with the next trigger
  // instead of being lost — and so does a run whose persistence threw, which
  // is why this is called after the save rather than before it. Moving it
  // first meant a throw in the store recorded "analysed" for an answer that
  // was never written, and the activity was gone for good.
  const advanceWatermark = (): void => {
    if (step.activity?.start_time) {
      resolved.setAnalysisSchedule(analysis.id, {
        lastActivityAt: step.activity.start_time
      });
    }
  };

  // Re-read rather than reuse the snapshot taken before the stream: a run takes
  // as long as the provider does, and the athlete may well have said something
  // in that conversation meanwhile. Appending to the stale copy would delete
  // their turn.
  const readBack = (): PersistedChatEntry[] =>
    resolved.getSessionEntries(session.sessionId) ?? session.entries;

  // Landing the answer is the last thing that can go wrong, and it used to be
  // the one thing that did not go through `finish`. A throw here — the store,
  // the conversation vanishing under it, anything — escaped to the fan-out's
  // own handler, which recorded a *second* row as `failed` and left this one
  // saying `running` until the next launch reconciled it. Meanwhile the
  // watermark had already moved, so the activity was gone for good.
  try {
    const output = parseAnalysisOutput(collector.text());
    if (output.silent) {
      // The answer itself is a control token the athlete must never read, so
      // nothing the model wrote is persisted. What lands instead is a one-line
      // trace saying the coach looked (5.5): a conversation that keeps no
      // record of a run reads as a broken analysis rather than as a
      // considered "no".
      resolved.saveSession(session.sessionId, [
        ...readBack(),
        {
          kind: "automationSilent",
          automation: marker,
          at: resolved.now().getTime()
        }
      ]);
      advanceWatermark();
      return finish({ status: "silent", ...cost });
    }

    const produced = collector.entries().map((entry) =>
      entry.kind === "message" ? { ...entry, automation: marker } : entry
    );
    const existing = readBack();
    // 5.6: the synthetic user turn carries the playbook and the same marker, so
    // the UI can render it as a chip rather than an athlete bubble.
    resolved.saveSession(session.sessionId, [
      ...existing,
      { kind: "message", role: "user", content: playbook, automation: marker },
      ...produced
    ]);
    advanceWatermark();

    return finish({
      status: "success",
      ...cost,
      ...(output.summary ? { summary: output.summary } : {})
    });
  } catch (error) {
    // One row, `failed`, and the watermark left where it was — so the activity
    // comes back with the next trigger rather than being recorded as analysed
    // by a run whose answer nobody can read. The backoff applies exactly as it
    // does to a provider that threw: this run reached the model, so the streak
    // is a claim it is entitled to make.
    return finish({
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "The run could not be written to its conversation.",
      ...cost
    });
  }
}

/**
 * The tee sink of 5.2: the collector always, plus the window when one exists,
 * so an open Coach view streams live while persistence happens in main either
 * way. It never wires `bindAbort` — closing the window must not abort a run.
 * Every event also counts as a sign of life for the run's idle watchdog.
 */
function createTeeSink(
  collector: ChatStreamCollectorSink,
  onActivity: () => void
): ChatStreamSink {
  return {
    emit(channel, payload) {
      onActivity();
      collector.emit(channel, payload);
      emitToAnyWindow(channel, payload);
    }
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * One analysis's share of a trigger, expanded into the runs it actually owes.
 * A non-activity trigger is a single run, unchanged; an activity trigger turns
 * into one run per pending activity, oldest first, each naming its own subject.
 */
function planAnalysisRuns(
  queued: QueuedRun,
  deps: CoachAnalysisRunnerDeps
): QueuedRun[] {
  const trigger = queued.analysis.trigger;
  if (!trigger || trigger.kind !== "activity") {
    return [queued];
  }
  return selectActivitiesForAnalysis(queued.analysis, queued.event, deps).map(
    (activity, index) => ({
      ...queued,
      activity,
      sequenceIndex: index,
      event: {
        ...queued.event,
        payload: {
          ...queued.event.payload,
          activityIds: [activity.activity_id],
          activityCount: 1,
          ...(activity.name ? { activityName: activity.name } : {}),
          ...(activity.sport_name ? { activitySport: activity.sport_name } : {}),
          ...(activity.start_time
            ? { activityStartTime: activity.start_time }
            : {})
        }
      }
    })
  );
}

/**
 * Section 10's pause, read at the gate rather than as a guard rail.
 *
 * The other guard rails record a `skipped` run each, which is right for them —
 * a cooldown or a quiet hour is a fact about *that* analysis and the log is
 * where the athlete reads it. This one is not: it is the same fact about all of
 * them, and recording it per analysis per poll is precisely the run log full of
 * identical `two-factor-required` rows that the pause exists to stop. So a held
 * trigger produces no runs and logs nothing. The one row that *did* get
 * recorded — the run that tripped it — is what the banner points at.
 */
function pauseHolds(
  event: AnalysisTriggerEvent,
  deps: CoachAnalysisRunnerDeps
): boolean {
  const pause = deps.getPause();
  if (!pause) {
    return false;
  }
  // Each reason lifts itself once its own cause is gone, which is the cause
  // disappearing rather than a second way to resume.
  if (pause.reason === "budget") {
    // The month rolled over, or the athlete raised the ceiling. Either way the
    // number that stopped everything is no longer the number.
    if (!overBudget(deps)) {
      deps.setPause(null);
      return false;
    }
    return !event.bypassGuards;
  }
  // The athlete may have signed in to COROS the ordinary way, from a settings
  // screen this banner does not own.
  if (deps.corosAuthenticated()) {
    deps.setPause(null);
    return false;
  }
  // A manual run is the athlete asking directly, and the way they find out
  // whether the fix took. It goes through, and either clears the pause or
  // records the one skip that says it is still there.
  return !event.bypassGuards;
}

/**
 * Fans a trigger out and runs every resulting analysis, one at a time.
 *
 * The whole fan-out is one cancellable unit (10). Stop on any run this produces
 * ends the rest of it, which is what the athlete meant by pressing it, and what
 * three separate presses used to be needed for.
 */
export async function runAnalysisTrigger(
  event: AnalysisTriggerEvent,
  deps?: Partial<CoachAnalysisRunnerDeps>
): Promise<CoachAnalysisRun[]> {
  const resolved = resolveDeps(deps);
  if (pauseHolds(event, resolved)) {
    return [];
  }
  const cancellation = createTriggerCancellation(resolved);
  liveTriggers.add(cancellation);
  const runs: CoachAnalysisRun[] = [];
  let stopped = false;
  try {
    for (const queued of expandTriggerToQueue(event, deps)) {
      // A shortcut, not the guard: the token is read at the top of every step
      // (see `runOneBinding`), which is what covers a step already queued
      // behind a stall. This only stops the fan-out queueing one dead step per
      // remaining analysis on the way out.
      if (stopped) {
        break;
      }
      const plan = planAnalysisRuns(queued, resolved);

      if (!plan.length) {
        // Activity-driven, with nothing new since this analysis's watermark. A
        // manual run records the skip so the UI can say so out loud; the
        // 15-minute poll stays quiet rather than filling the log with
        // non-events.
        if (event.kind === "manual") {
          runs.push(
            skip(queued, "no-activity", resolved, queued.analysis.sessionId ?? undefined)
          );
        }
        continue;
      }

      for (const step of plan) {
        let run: CoachAnalysisRun | null;
        try {
          // The lease is taken inside `enqueue`, not around it: acquiring it
          // before the step reaches the front of the queue would hold the lock
          // across the wait and keep the other machines idle for no reason.
          const outcome = await enqueue(() =>
            runExclusively(step.analysis.id, () =>
              runOneBinding(step, deps, cancellation)
            )
          );
          if (!outcome.ran) {
            // Another machine is running it. Recorded so the log says where the
            // work went rather than showing an unexplained gap.
            runs.push(
              skip(
                queued,
                "another-device",
                resolved,
                queued.analysis.sessionId ?? undefined,
                `Running on ${outcome.holder ?? "another device"}.`
              )
            );
            continue;
          }
          run = outcome.result;
        } catch (error) {
          // One analysis blowing up must not starve the rest of the fan-out, and
          // the failure still has to be visible in the run log — and count
          // against the analysis's backoff, like any other failure.
          const failedAt = resolved.now().toISOString();
          run = resolved.recordRun({
            analysisId: step.analysis.id,
            status: "failed",
            triggerKind: event.kind,
            error: error instanceof Error ? error.message : "Analysis run failed.",
            finishedAt: failedAt
          } as Omit<CoachAnalysisRun, "id" | "startedAt">);
          applyBackoff(
            resolved.getAnalysis(step.analysis.id) ?? step.analysis,
            "failed",
            resolved
          );
          resolved.emitRunUpdate(run);
          runs.push(run);
          break;
        }
        // Stop ended the trigger while this step waited its turn in the queue.
        if (!run) {
          stopped = true;
          break;
        }
        runs.push(run);
        // Stop, arriving through some other route than the token — the athlete
        // cancelling the chat request itself. It still means this fan-out.
        if (run.status === "cancelled") {
          stopped = true;
          break;
        }
        // COROS asked for a login code, or the month's allowance is gone.
        // Every remaining place in this fan-out would get the same answer, and
        // the pause this run just set means the next poll will not even ask —
        // so the log carries the one row that explains it rather than one per
        // analysis.
        //
        // Asked of the pause rather than of the skip code: guard 7's daily cap
        // records `budget` too, and it is a fact about one analysis that must
        // not silence the other places this trigger was going to reach. The
        // pause naming *this* run is the only thing that means "and everything
        // after it would say the same".
        if (resolved.getPause()?.runId === run.id) {
          stopped = true;
          break;
        }
        // A refusal applies to the whole catch-up sequence — the daily cap,
        // quiet hours or the backoff will not have changed by the next activity
        // in the list — so stop rather than logging the same skip once per
        // pending activity. The watermark stays put, and the leftovers ride
        // along with the next trigger.
        if (run.status === "skipped") {
          break;
        }
      }
    }
  } finally {
    liveTriggers.delete(cancellation);
  }
  return runs;
}


export function getAnalysisSpend(): CoachAnalysisSpend {
  const monthStart = startOfLocalMonth(new Date());
  const totals = sumCoachAnalysisTokensSince(monthStart);
  return {
    monthStart,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    budget: getCoachAnalysisBudget(),
    countedRuns: totals.countedRuns,
    providerRuns: totals.providerRuns
  };
}

/**
 * Setting the ceiling is also the way back from a budget pause: raising it (or
 * clearing it) removes the reason, and the gate notices on the next trigger.
 * Lowering it below what is already spent pauses at the next trigger instead.
 */
export function setAnalysisBudget(budget: number | null): CoachAnalysisSpend {
  setCoachAnalysisBudget(budget);
  return getAnalysisSpend();
}

/** What the banner reads on mount, before any push has happened. */
export function getAnalysisPause(
  deps?: Partial<CoachAnalysisRunnerDeps>
): CoachAnalysisPause | null {
  return resolveDeps(deps).getPause();
}

/**
 * Section 10's single way to resume. It clears the flag and nothing else — it
 * does not assert that COROS is reachable, because it cannot: the next trigger
 * asks, and re-trips the pause if the answer is still a login code. "Resume"
 * therefore means *try again*, which is the only thing a button here can
 * honestly promise.
 */
export function resumeAnalyses(
  deps?: Partial<CoachAnalysisRunnerDeps>
): CoachAnalysisPause | null {
  resolveDeps(deps).setPause(null);
  return null;
}

/** 3.4 "Run now": bypasses cooldown, quiet hours and the daily cap. */
export function runAnalysisNow(
  analysisId: string,
  deps?: Partial<CoachAnalysisRunnerDeps>
): Promise<CoachAnalysisRun[]> {
  return runAnalysisTrigger(
    { analysisId, kind: "manual", bypassGuards: true },
    deps
  );
}

/** Test seam: resets the process-wide queue and live tokens between scenarios. */
export function resetAnalysisQueueForTests(): void {
  queueTail = Promise.resolve();
  liveTriggers.clear();
}
