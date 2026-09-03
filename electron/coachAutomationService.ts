import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import {
  cancelChat,
  createCollectorSink,
  getChatAuthStatus,
  getChatSettings,
  streamChat
} from "./chatService";
import type { ChatStreamCollectorSink, ChatStreamSink } from "./chatService";
import {
  chatSessionExists,
  createChatSession,
  getChatSession,
  saveChatSession,
  setChatSessionTitle
} from "./chatHistoryStore";
import {
  getCoachAutomation,
  getCoachAutomationBinding,
  listCoachAutomationBindings,
  listCoachAutomationRuns,
  recordCoachAutomationRun,
  setCoachAutomationBindingEnabled,
  setCoachAutomationBindingSchedule,
  setCoachAutomationBindingSession,
  getCoachAutomationBudget,
  getCoachAutomationPause,
  setCoachAutomationBudget,
  setCoachAutomationPause,
  updateCoachAutomationRun
} from "./coachAutomationStore";
import {
  getChatSessionCoachSummaryRow,
  listCoachActivityRowsAfter,
  setChatSessionCoachSummaryRow,
  sumCoachAutomationTokensSince
} from "./database";
import type { CoachUnseenActivityRow as CoachActivityRow } from "./database";
import { getTrainingHubStatus, reconnectTrainingHub } from "./trainingHubService";
import { corosSportName } from "./corosSportTypes";
import { AUTOMATION_DEFAULT_EFFORT, NOTHING_TO_REPORT } from "./types";
import type {
  AnthropicEffort,
  AutomationRuntime,
  ClaudeCodeConnectionState,
  AutomationTriggerKind,
  ChatEntryAutomationMarker,
  ChatMessage,
  ChatProvider,
  ChatTokenUsage,
  CoachAutomation,
  CoachAutomationBinding,
  CoachAutomationPause,
  CoachAutomationRun,
  CoachAutomationRunQuery,
  CoachAutomationSpend,
  CoachAutomationUpdate,
  PersistedChatEntry,
  ProviderAuthVerdict
} from "./types";

// ---------------------------------------------------------------------------
// Output contract (5.5)
// ---------------------------------------------------------------------------

const SUMMARY_MAX = 140;

/**
 * Appended to every playbook by the runner, not editable per automation.
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

export interface AutomationOutput {
  /** The model found nothing worth reporting; the run is logged, not shown. */
  silent: boolean;
  /** The headline, for the badge and (phase 2) the notification body. */
  summary?: string;
}

/** Markup trimmed off both ends, so a run-log row is not full of asterisks. */
function trimMarkup(line: string): string {
  return line.replace(/^[\s>#*_`+-]+/, "").replace(/[\s*_`]+$/, "");
}

export function parseAutomationOutput(text: string): AutomationOutput {
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
export { AUTOMATION_DEFAULT_EFFORT };

/** The runtime a run actually uses, with section 7's default filled in. */
export function resolveAutomationRuntime(
  automation: CoachAutomation
): AutomationRuntime {
  return automation.runtime.effort
    ? automation.runtime
    : { ...automation.runtime, effort: AUTOMATION_DEFAULT_EFFORT };
}

// ---------------------------------------------------------------------------
// Template rendering (2.5)
// ---------------------------------------------------------------------------

export interface AutomationTemplateVars {
  rule?: { name?: string };
  date?: string;
  activity?: { name?: string; sport?: string };
  week?: { range?: string };
}

/** Renders `{{rule.name}}`-style variables; unknown ones collapse to "". */
export function renderAutomationTemplate(
  template: string,
  vars: AutomationTemplateVars
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

function triggerLabel(automation: CoachAutomation): string {
  const trigger = automation.trigger;
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
// Which activities a binding still owes an opinion on
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
 * 3.2 step 3: an activity automation fires only for the sports it names, and
 * only above its duration/distance floors. An empty `sportTypes` means every
 * sport.
 */
export function activityMatchesAutomation(
  activity: CoachActivityRow,
  automation: CoachAutomation
): boolean {
  const trigger = automation.trigger;
  if (trigger.kind !== "activity") {
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
function attachEpochSeconds(binding: CoachAutomationBinding): number {
  const parsed = Date.parse(binding.createdAt);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/**
 * What an activity-driven binding should analyse on this trigger, oldest
 * first.
 *
 * The watermark is per binding, not per automation: two conversations attached
 * a week apart legitimately owe answers on different activities, and the
 * automation-wide `coach_seen_at` stamp only decides *when* the watcher fires.
 *
 * - Never analysed anything → the attach time is the floor, so attaching a
 *   coach today does not replay the athlete's back catalogue.
 * - "Run now" on a binding that never analysed anything → the newest matching
 *   activity, ignoring that floor. The athlete asked for an answer now, and a
 *   coach attached five minutes ago would otherwise have nothing to say.
 * - `multiActivity` off → only the newest match, however many piled up.
 */
function selectActivitiesForBinding(
  automation: CoachAutomation,
  binding: CoachAutomationBinding,
  event: AutomationTriggerEvent,
  deps: CoachAutomationRunnerDeps
): CoachActivityRow[] {
  const trigger = automation.trigger;
  if (trigger.kind !== "activity") {
    return [];
  }

  const manualFirstRun =
    event.kind === "manual" && binding.lastActivityAt === undefined;
  const floor = manualFirstRun
    ? undefined
    : binding.lastActivityAt ?? attachEpochSeconds(binding);

  const matched = deps
    .listActivitiesAfter(floor, ACTIVITY_SCAN_LIMIT)
    .filter((activity) => activityMatchesAutomation(activity, automation));
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

export type AutomationSkipReason =
  | "disabled"
  | "missing-session"
  | "no-auth"
  | "offline"
  | "two-factor-required"
  | "quiet-hours"
  | "cooldown"
  | "budget"
  | "burst"
  | "batch-window"
  /** Held off after a failed run, until this binding's backoff expires (10). */
  | "backoff"
  /** Activity-driven, but nothing new to analyse since this binding's watermark. */
  | "no-activity"
  /** Schedule-driven: the slot came due more than a day ago (3.1). */
  | "stale-slot";

/** 2.3: at most this many automation messages land in one conversation per hour. */
export const SESSION_BURST_PER_HOUR = 5;

/**
 * Section 10's per-binding backoff: how long a binding is held off after its
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
 * 13: whether the automations have spent their month's allowance.
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

function overBudget(deps: CoachAutomationRunnerDeps): boolean {
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
 * hold every automation on a machine where nothing is actually wrong.
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

export interface CoachAutomationRunnerDeps {
  now(): Date;
  getAutomation(id: string): CoachAutomation | null;
  listBindings(automationId: string): CoachAutomationBinding[];
  /** Re-read at run time: a queued binding's snapshot goes stale behind it. */
  getBinding(id: string): CoachAutomationBinding | null;
  setBindingSchedule(
    bindingId: string,
    schedule: {
      lastRunAt?: string | null;
      nextRunAt?: string | null;
      lastActivityAt?: number | null;
      backoffUntil?: string | null;
      backoffLevel?: number | null;
    }
  ): void;
  setBindingSession(bindingId: string, sessionId: string): void;
  setBindingEnabled(bindingId: string, enabled: boolean): void;
  listRuns(filter: CoachAutomationRunQuery): CoachAutomationRun[];
  /** Activities newer than a binding's watermark, oldest first. */
  listActivitiesAfter(
    afterEpochSeconds: number | undefined,
    limit: number
  ): CoachActivityRow[];
  recordRun(input: Omit<CoachAutomationRun, "id" | "startedAt">): CoachAutomationRun;
  updateRun(
    id: string,
    patch: Partial<Omit<CoachAutomationRun, "id" | "automationId" | "bindingId">>
  ): CoachAutomationRun | null;
  /** Undefined when the conversation no longer exists (2.4). */
  getSessionEntries(sessionId: string): PersistedChatEntry[] | undefined;
  /** 5.7: the conversation's rolling summary and what it covers. */
  getSessionSummary(sessionId: string): StoredTranscriptSummary;
  setSessionSummary(sessionId: string, summary: string, through: number): void;
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
    runtime: AutomationRuntime
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
  getPause(): CoachAutomationPause | null;
  setPause(pause: CoachAutomationPause | null): void;
  /** 13: the monthly ceiling in tokens, or null for none. */
  getBudget(): number | null;
  /** Tokens spent by automations since the start of the current local month. */
  getMonthToDateTokens(): number;
  createCollector(marker: ChatEntryAutomationMarker): ChatStreamCollectorSink;
  streamChat(
    sink: ChatStreamSink,
    runId: string,
    messages: ChatMessage[],
    options: {
      runtime?: CoachAutomation["runtime"];
      toolPolicy: "read-only";
      roleInstructions?: string;
    }
  ): Promise<void>;
  emitRunUpdate(run: CoachAutomationRun): void;
  /** Aborts an in-flight stream by run id; the same seam "Cancel" uses. */
  cancelRun(runId: string): void;
  /** How long a run may emit nothing before it is given up on. */
  idleTimeoutMs: number;
}

/**
 * A run update from outside the runner. The scheduler's `stale-slot` skips
 * never reach `runOneBinding`, so they need their own way onto the wire.
 */
export function emitAutomationRunUpdate(run: CoachAutomationRun): void {
  emitToAnyWindow("coachAutomation:runUpdate", run);
}

/**
 * Section 10's pause, on the wire. Like a run update it may happen with no
 * window open at all — the trip is a scheduled run finding COROS locked at
 * 07:30 — so the banner reads the flag on mount and follows this afterwards.
 */
export function emitAutomationPauseUpdate(pause: CoachAutomationPause | null): void {
  emitToAnyWindow("coachAutomation:pauseUpdate", pause);
}

/**
 * A binding whose *rendered* state changed, with no run to carry the news.
 *
 * Three writers had no wire at all. The scheduler books a slot on a timer, and
 * 9.1's "next fires in 9h" line is the one question the card exists to answer —
 * so a briefing created at lunchtime showed nothing until something unrelated
 * refreshed the screen. Guard rail 2 disables a binding whose conversation the
 * athlete deleted, and a `dedicated` binding adopts the conversation it just
 * rebuilt; both are rendered by the "where it runs" rows, which read once on
 * mount.
 *
 * Deliberately *not* emitted for the clocks nothing renders — `last_run_at`,
 * the activity watermark, the backoff pair, `threshold_firing`. A push per
 * binding per run for state no surface shows is the kind of chatter that makes
 * the next reviewer distrust the ones that matter.
 */
export function emitAutomationBindingUpdate(
  binding: CoachAutomationBinding | null
): void {
  if (!binding) return;
  emitToAnyWindow("coachAutomation:bindingUpdate", binding);
}

/**
 * A definition that changed, with no run and no binding to carry the news.
 *
 * Every automation surface renders the definition — the name on a chip, the
 * trigger under it, the master switch that decides whether a binding is live —
 * and until now nothing put a definition change on the wire. The surfaces kept
 * up through `automationsVersion`, a counter local to ChatView's tree, so a
 * surface that counter does not reach went on showing the old name and the old
 * trigger until something unrelated refreshed it. Detaching and re-attaching
 * was the athlete's way out, because a binding update *does* have a wire.
 *
 * Emitted on the two edits and the delete, not on the clocks: `last_run_at` and
 * the watermarks live on the binding and already have their own rule.
 */
export function emitAutomationUpdate(update: CoachAutomationUpdate): void {
  emitToAnyWindow("coachAutomation:automationUpdate", update);
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

function createDefaultDeps(): CoachAutomationRunnerDeps {
  return {
    now: () => new Date(),
    getAutomation: (id) => getCoachAutomation(id),
    listBindings: (automationId) => listCoachAutomationBindings(automationId),
    getBinding: (id) => getCoachAutomationBinding(id),
    setBindingSchedule: (bindingId, schedule) => {
      setCoachAutomationBindingSchedule(bindingId, schedule);
    },
    setBindingSession: (bindingId, sessionId) => {
      // A `dedicated` binding adopting its rebuilt conversation (2.4): the row
      // that names it is on screen and has no other way to hear.
      emitAutomationBindingUpdate(
        setCoachAutomationBindingSession(bindingId, sessionId)
      );
    },
    setBindingEnabled: (bindingId, enabled) => {
      // Guard rail 2 breaking a binding whose conversation is gone. The run log
      // says so on the next push; without this the row one tab away goes on
      // showing the toggle on and no broken marker.
      emitAutomationBindingUpdate(
        setCoachAutomationBindingEnabled(bindingId, enabled)
      );
    },
    listRuns: (filter) => listCoachAutomationRuns(filter),
    listActivitiesAfter: (after, limit) => listCoachActivityRowsAfter(after, limit),
    recordRun: (input) => recordCoachAutomationRun(input),
    updateRun: (id, patch) => updateCoachAutomationRun(id, patch),
    getSessionEntries: (sessionId) => {
      // getChatSession returns [] both for "empty" and "gone", so an empty
      // transcript is confirmed against the session list instead.
      if (!chatSessionExists(sessionId)) return undefined;
      return getChatSession(sessionId);
    },
    getSessionSummary: (sessionId) => {
      const row = getChatSessionCoachSummaryRow(sessionId);
      const summary = row?.coach_summary?.trim();
      return {
        ...(summary ? { summary } : {}),
        through:
          typeof row?.coach_summary_through === "number" &&
          Number.isFinite(row.coach_summary_through)
            ? row.coach_summary_through
            : 0
      };
    },
    setSessionSummary: (sessionId, summary, through) => {
      setChatSessionCoachSummaryRow(sessionId, summary, through);
    },
    rollSummary: async (previous, entries, runtime) => {
      // Its own request id, not the run's: this happens while the run is being
      // prepared and has no row yet, so there is nothing for Stop to aim at.
      // The bound below is what ends it either way.
      const requestId = `coach-summary-${randomUUID()}`;
      const collector = createCollectorSink();
      const watchdog = createIdleWatchdog(AUTOMATION_IDLE_TIMEOUT_MS);
      const sink: ChatStreamSink = {
        emit(channel, payload) {
          watchdog.touch();
          collector.emit(channel, payload);
        }
      };
      // Whatever the roll spent goes back with it on every exit, including the
      // ones that produce nothing. A roll is a full provider turn (13) and the
      // caller folds it into the run it was preparing for.
      const spent = () => {
        const usage = collector.usage();
        return usage ? { usage } : {};
      };
      try {
        const streaming = streamChat(
          sink,
          requestId,
          [{ role: "user", content: buildRollingSummaryTurn(previous, entries) }],
          {
            // Nothing to look up: it is compressing text it was handed, and a
            // tool round-trip here is both slower and a way to wander off.
            toolPolicy: "none",
            // The run's own provider and model (decision 2), not the
            // interactive chat's. A roll is a turn taken on this automation's
            // behalf: its cost lands on this run's row (13), guard rail 3
            // pre-flighted *this* provider and no other, and an automation
            // pointed at a second provider must not quietly spend on the first.
            //
            // Effort is the one thing that does not inherit. It is cost rather
            // than capability (7), and a summariser compressing text it was
            // handed has nothing to think harder about — so a coach set to
            // `high` gets a `high` answer and a `low` summary.
            runtime: { ...runtime, effort: AUTOMATION_DEFAULT_EFFORT }
          }
        );
        streaming.catch(() => undefined);
        let timedOut = false;
        await Promise.race([
          streaming,
          watchdog.expired.then(() => {
            timedOut = true;
          })
        ]);
        if (timedOut) {
          cancelChat(requestId);
          return { summary: null, ...spent() };
        }
        if (collector.error() || collector.cancelled()) {
          return { summary: null, ...spent() };
        }
        return { summary: collector.text().trim() || null, ...spent() };
      } catch {
        return { summary: null, ...spent() };
      } finally {
        watchdog.stop();
      }
    },
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
    getBudget: () => getCoachAutomationBudget(),
    getMonthToDateTokens: () => {
      const totals = sumCoachAutomationTokensSince(startOfLocalMonth(new Date()));
      return totals.inputTokens + totals.outputTokens;
    },
    getPause: () => getCoachAutomationPause(),
    setPause: (pause) => {
      setCoachAutomationPause(pause);
      emitAutomationPauseUpdate(pause);
    },
    createCollector: (marker) => createCollectorSink(marker),
    streamChat: (sink, runId, messages, options) =>
      streamChat(sink, runId, messages, options),
    emitRunUpdate: (run) => emitAutomationRunUpdate(run),
    cancelRun: (runId) => cancelChat(runId),
    idleTimeoutMs: AUTOMATION_IDLE_TIMEOUT_MS
  };
}

let defaultDeps: CoachAutomationRunnerDeps | null = null;
function resolveDeps(
  deps?: Partial<CoachAutomationRunnerDeps>
): CoachAutomationRunnerDeps {
  defaultDeps ??= createDefaultDeps();
  return deps ? { ...defaultDeps, ...deps } : defaultDeps;
}

// ---------------------------------------------------------------------------
// Trigger expansion and the run queue
// ---------------------------------------------------------------------------

export interface AutomationTriggerEvent {
  automationId: string;
  kind: AutomationTriggerKind;
  payload?: Record<string, unknown>;
  /** Restricts the fan-out; defaults to every enabled binding. */
  bindingIds?: string[];
  /**
   * 3.4: a manual run bypasses cooldown, quiet hours and the daily cap, so the
   * athlete can build confidence in a rule before enabling it.
   */
  bypassGuards?: boolean;
}

interface QueuedRun {
  binding: CoachAutomationBinding;
  automation: CoachAutomation;
  event: AutomationTriggerEvent;
  /** The single activity this run analyses; absent for non-activity triggers. */
  activity?: CoachActivityRow;
  /** Position in a multi-activity catch-up sequence; 0 is the first run. */
  sequenceIndex: number;
}

/**
 * 2.3: one trigger produces one run per enabled binding, not one run broadcast
 * to many conversations — each conversation carries different history, so the
 * answers legitimately differ. Ordering by session then `sort_order` keeps
 * same-conversation runs serialized and in the order the athlete chose.
 */
export function expandTriggerToQueue(
  event: AutomationTriggerEvent,
  deps?: Partial<CoachAutomationRunnerDeps>
): QueuedRun[] {
  const resolved = resolveDeps(deps);
  const automation = resolved.getAutomation(event.automationId);
  if (!automation || (!automation.enabled && !event.bypassGuards)) {
    return [];
  }

  const wanted = event.bindingIds ? new Set(event.bindingIds) : null;
  return resolved
    .listBindings(automation.id)
    .filter((binding) => binding.enabled || event.bypassGuards)
    .filter((binding) => !wanted || wanted.has(binding.id))
    .sort(
      (left, right) =>
        (left.sessionId ?? "").localeCompare(right.sessionId ?? "") ||
        left.sortOrder - right.sortOrder
    )
    .map((binding) => ({ binding, automation, event, sequenceIndex: 0 }));
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
 * The token is the thing the fan-out is stopped by. `runAutomationTrigger`
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
  deps: CoachAutomationRunnerDeps
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
export function cancelAutomationRun(
  runId: string,
  deps?: Partial<CoachAutomationRunnerDeps>
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
// Running one binding
// ---------------------------------------------------------------------------

function skip(
  queued: QueuedRun,
  reason: AutomationSkipReason,
  deps: CoachAutomationRunnerDeps,
  sessionId?: string,
  /** The reason in words, where the code alone would not say enough. */
  error?: string
): CoachAutomationRun {
  const startedAt = deps.now().toISOString();
  const run = deps.recordRun({
    automationId: queued.automation.id,
    bindingId: queued.binding.id,
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
  deps: CoachAutomationRunnerDeps
): AutomationSkipReason | null {
  const { automation, binding, event } = queued;
  const now = deps.now();

  if (event.bypassGuards) {
    return null;
  }

  // Guard rail 4b — the month's ceiling — is *not* here. It reads the same
  // `budget` skip code as the daily cap below, and folding the two into one
  // return value meant the runner could not tell them apart: exhausting one
  // binding's three runs for the day raised the app-wide pause and held every
  // other automation the athlete has. It is its own branch in `runOneBinding`,
  // which is also where section 4 numbers it.

  // Backoff comes first because it outlives the others and explains more: a
  // binding that is both inside quiet hours and backed off is backed off for a
  // reason the athlete can act on, and the run log should say so.
  //
  // Unlike the cooldown below, this is checked at every step of a catch-up
  // sequence rather than only the first. A failure part-way through a sequence
  // is exactly the storm being prevented, and a `skipped` run ends the sequence
  // (see `runAutomationTrigger`), so the leftovers ride along with the trigger
  // after the backoff expires.
  if (binding.backoffUntil && now.getTime() < Date.parse(binding.backoffUntil)) {
    return "backoff";
  }

  if (isWithinQuietHours(now, automation.conditions.quietHours)) {
    return "quiet-hours";
  }

  // The cooldown governs how often a binding may *react*, not how fast it may
  // work through the backlog that one reaction uncovered — so it is checked
  // once, on the first run of a multi-activity catch-up sequence.
  if (binding.lastRunAt && queued.sequenceIndex === 0) {
    const elapsed = now.getTime() - new Date(binding.lastRunAt).getTime();
    if (elapsed < minutesToMs(automation.conditions.cooldownMin)) {
      return "cooldown";
    }
  }

  const today = deps.listRuns({
    bindingId: binding.id,
    since: startOfLocalDay(now).toISOString(),
    statuses: ["success", "silent", "failed"]
  });
  if (today.length >= automation.conditions.maxRunsPerDay) {
    return "budget";
  }

  if (sessionId) {
    // Both statuses that write to the transcript, which is what 2.3 is counting
    // — "five automation messages per conversation per hour". A silent run is
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
 * A failure steps the binding through `AUTOMATION_BACKOFF_STEPS_MS` and stays
 * on the last one; anything that reached the provider and did not fail clears
 * the streak. A *skip* does neither, and that is deliberate rather than an
 * omission: a skip never got as far as the provider, so it says nothing about
 * whether the provider is alive — and a `backoff` skip clearing the backoff
 * would be a guard rail that switches itself off on its first use.
 *
 * `binding` is the row as it stood when the run started, which is the right
 * base: runs are serialised process-wide (5.4), so nothing else can have
 * touched this binding's streak in between.
 */
function applyBackoff(
  binding: CoachAutomationBinding,
  status: CoachAutomationRun["status"] | undefined,
  deps: CoachAutomationRunnerDeps
): void {
  if (status === "failed") {
    const level = Math.min(
      (binding.backoffLevel ?? 0) + 1,
      AUTOMATION_BACKOFF_STEPS_MS.length
    );
    deps.setBindingSchedule(binding.id, {
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
  // Nothing is written for a binding that had no streak to clear: a healthy
  // automation must not rewrite its own row on every run.
  if (binding.backoffLevel === undefined && binding.backoffUntil === undefined) {
    return;
  }
  deps.setBindingSchedule(binding.id, { backoffLevel: 0, backoffUntil: null });
}

/**
 * Where a run will write, resolved in two halves. Only the *check* happens at
 * guard rail 2; the conversation itself is created after every guard has
 * passed, because a `per-run` binding that creates its conversation up front
 * would leave an empty thread behind on every cooldown, quiet-hour or offline
 * skip — and the activity watcher polls every 15 minutes.
 */
type SessionTarget =
  | { kind: "existing"; sessionId: string; entries: PersistedChatEntry[] }
  /** A conversation this binding still has to create. */
  | { kind: "create" };

/**
 * Guard rail 2 / 2.4. A `dedicated` binding rebuilds its conversation when the
 * athlete deleted it; an `existing` one is disabled instead, because only the
 * athlete knows which thread it should point at now.
 */
function checkSessionTarget(
  queued: QueuedRun,
  deps: CoachAutomationRunnerDeps
): { ok: true; target: SessionTarget } | { ok: false; reason: AutomationSkipReason } {
  const { binding } = queued;

  if (binding.mode === "per-run") {
    return { ok: true, target: { kind: "create" } };
  }

  const entries = binding.sessionId
    ? deps.getSessionEntries(binding.sessionId)
    : undefined;
  if (entries) {
    return {
      ok: true,
      target: { kind: "existing", sessionId: binding.sessionId as string, entries }
    };
  }

  if (binding.mode === "dedicated") {
    return { ok: true, target: { kind: "create" } };
  }

  deps.setBindingEnabled(binding.id, false);
  return { ok: false, reason: "missing-session" };
}

/** Creates and names the conversation a "create" target asked for. */
function createTargetSession(
  queued: QueuedRun,
  deps: CoachAutomationRunnerDeps
): string {
  const { automation, binding } = queued;
  const provider = automation.runtime.provider ?? deps.getChatProvider();
  const sessionId = deps.createSession(provider);

  if (binding.mode === "per-run") {
    const vars = templateVars(queued, deps);
    const title = binding.titleTemplate
      ? renderAutomationTemplate(binding.titleTemplate, vars)
      : `${automation.name} · ${vars.date}`;
    if (title) {
      deps.setSessionTitle(sessionId, title);
    }
    return sessionId;
  }

  // A dedicated binding owns its conversation, so it adopts the rebuilt one.
  deps.setSessionTitle(sessionId, automation.name);
  deps.setBindingSession(binding.id, sessionId);
  return sessionId;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toWireMessages(entries: PersistedChatEntry[]): ChatMessage[] {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.content.trim()
      ? [{ role: entry.role, content: entry.content }]
      : []
  );
}

// ---------------------------------------------------------------------------
// Context trimming (5.7)
// ---------------------------------------------------------------------------

/**
 * 5.7: how far a transcript may run past what the summary already covers
 * before the runner rolls it forward.
 *
 * The count is measured from the summary, not from the start of the
 * conversation, and that is the difference between this and a fixed window. A
 * fixed "always send the last 20" would need the summary re-rolled on **every**
 * run, because every run adds two entries to the head. Rolling once every
 * `LIMIT - KEEP` runs instead is cheaper — a run is a model call and so is a
 * roll — and, more importantly, less lossy: a summary re-summarised forty times
 * a year is forty rounds of compression, and what survives is whatever
 * happened to be in the last one.
 */
export const AUTOMATION_CONTEXT_LIMIT = 60;

/** How many recent entries survive a roll and go to the model verbatim. */
export const AUTOMATION_CONTEXT_KEEP = 20;

/** What the runner has stored about a conversation's summary, if anything. */
export interface StoredTranscriptSummary {
  summary?: string;
  /** Entries at the head of the transcript the summary accounts for. */
  through: number;
}

export interface TranscriptContextPlan {
  /** Sent ahead of the tail, standing in for everything before it. */
  summary?: string;
  /** Sent verbatim. */
  tail: PersistedChatEntry[];
  /** Entries that have to be folded into the summary first; usually empty. */
  toSummarise: PersistedChatEntry[];
  /** What `through` becomes once they are folded in. */
  through: number;
}

/**
 * What of a transcript this run should send, and what has to be folded into the
 * summary first. Pure: the folding itself is a model call and belongs to the
 * caller.
 *
 * A `through` past the end of the transcript describes a conversation that is
 * no longer there, so the summary is abandoned rather than trusted. It should
 * not happen — the window's saves merge rather than truncate (5.6b), and a
 * deleted conversation takes its row with it — but a summary that claims to
 * cover entries nobody can see is the one failure here that cannot be noticed
 * by reading the result.
 */
export function planTranscriptContext(
  entries: PersistedChatEntry[],
  stored: StoredTranscriptSummary
): TranscriptContextPlan {
  // A count past the end describes a conversation that is no longer there, and
  // a summary with no count at all — or a count of zero — describes nothing: a
  // real roll only happens once the uncovered stretch passes LIMIT, so the
  // count it writes can never be less than `LIMIT - KEEP`. Either way the pair
  // is half-written, and 5.7 is explicit that the two are one fact. The safe
  // reading is *no summary*, the same way section 10 reads a half-written pause
  // as *not paused*: trusting it would send a summary of turns the model is
  // also about to read in full, and nothing downstream could notice.
  const valid =
    stored.through > 0 &&
    stored.through <= entries.length &&
    Boolean(stored.summary);
  const through = valid ? stored.through : 0;
  const summary = valid ? stored.summary : undefined;

  const live = entries.length - through;
  if (live <= AUTOMATION_CONTEXT_LIMIT) {
    return {
      ...(summary ? { summary } : {}),
      tail: entries.slice(through),
      toSummarise: [],
      through
    };
  }

  const nextThrough = entries.length - AUTOMATION_CONTEXT_KEEP;
  return {
    ...(summary ? { summary } : {}),
    tail: entries.slice(nextThrough),
    toSummarise: entries.slice(through, nextThrough),
    through: nextThrough
  };
}

/**
 * How the summary reaches the model. A plain user turn, labelled, rather than
 * anything provider-specific: it has to read the same way to four providers,
 * and it has to be obvious to the model that this is a compression of the
 * conversation rather than something the athlete just said.
 */
export function summaryContextMessage(summary: string): ChatMessage {
  return {
    role: "user",
    content: [
      "[Earlier in this conversation, summarised]",
      summary,
      "[End of summary. The messages that follow are the recent turns in full.]"
    ].join("\n\n")
  };
}

/** The turn that folds new entries into the running summary. */
export function buildRollingSummaryTurn(
  previous: string | undefined,
  entries: PersistedChatEntry[]
): string {
  const transcript = toWireMessages(entries)
    .map((message) => `${message.role === "user" ? "Athlete" : "Coach"}: ${message.content}`)
    .join("\n\n");
  return [
    previous
      ? "Here is the running summary of a coaching conversation so far, followed by the turns that have happened since it was written."
      : "Here are the opening turns of a coaching conversation.",
    ...(previous ? ["", "--- Running summary ---", previous] : []),
    "",
    "--- Newer turns ---",
    transcript,
    "",
    "Rewrite the running summary so it covers everything above, including the",
    "newer turns. It is the only record of these turns the coach will have on",
    "future runs, so keep what a coach would need: the athlete's goals, races,",
    "injuries and constraints, decisions taken, and how the training has",
    "actually gone. Drop pleasantries and anything already superseded. Write it",
    "as notes, not as a letter, and reply with the summary and nothing else."
  ].join("\n");
}

/** The 2.5 variables, resolved once from the run's own trigger payload. */
function templateVars(
  queued: QueuedRun,
  deps: CoachAutomationRunnerDeps
): AutomationTemplateVars {
  const now = deps.now();
  return {
    rule: { name: queued.automation.name },
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
  deps: CoachAutomationRunnerDeps
): string {
  const body = renderAutomationTemplate(
    queued.automation.playbook,
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

interface IdleWatchdog {
  /** Resolves — never rejects — once nothing has been emitted for the window. */
  readonly expired: Promise<void>;
  /** Called for every stream event: the run is alive, start the clock over. */
  touch(): void;
  stop(): void;
}

function createIdleWatchdog(timeoutMs: number): IdleWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fire: () => void = () => undefined;
  const expired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(fire, timeoutMs);
  };
  arm();
  return {
    expired,
    touch: arm,
    stop: () => clearTimeout(timer)
  };
}

/**
 * Returns null when the fan-out was stopped before this run began — including
 * while it waited its turn in the process-wide queue behind a stall (5.4).
 * Nothing was recorded, so there is nothing to log: a run log full of rows for
 * runs that never happened is not what Stop means.
 */
async function runOneBinding(
  queued: QueuedRun,
  deps?: Partial<CoachAutomationRunnerDeps>,
  cancellation?: TriggerCancellation
): Promise<CoachAutomationRun | null> {
  const resolved = resolveDeps(deps);
  const { automation, event } = queued;

  if (cancellation?.cancelled()) {
    return null;
  }

  // The binding was snapshotted when the trigger fanned out, and a catch-up
  // sequence writes to it between runs (its clock, its activity watermark), so
  // every guard below has to read the row as it stands now.
  const binding = resolved.getBinding(queued.binding.id) ?? queued.binding;
  const step: QueuedRun = { ...queued, binding };

  // 1. Both switches still on — they may have flipped between queue and run.
  const current = resolved.getAutomation(automation.id);
  if (!event.bypassGuards && (!current?.enabled || !binding.enabled)) {
    return skip(step, "disabled", resolved);
  }

  // 2. Target conversation resolvable — checked now, created below.
  const checked = checkSessionTarget(step, resolved);
  if (!checked.ok) {
    return skip(step, checked.reason, resolved);
  }
  const knownSessionId =
    checked.target.kind === "existing" ? checked.target.sessionId : undefined;

  // 2b. This activity is still owed. Two triggers can fan out from the same
  // watermark before either runs — a poll and a "Run now" seconds apart — and
  // the plan is built outside the run queue. The binding was re-read above, so
  // the check costs nothing and stops the same activity being analysed twice
  // into the same conversation.
  if (
    step.activity?.start_time != null &&
    binding.lastActivityAt !== undefined &&
    step.activity.start_time <= binding.lastActivityAt
  ) {
    return skip(step, "no-activity", resolved, knownSessionId);
  }

  // 3. Chat provider usable, for every provider rather than only ChatGPT.
  // The verdict's reason rides along on the row: "not signed in" is the common
  // case but not the only one, and a run log that cannot tell a missing API key
  // from a missing CLI sends the athlete to the wrong screen.
  const provider = automation.runtime.provider ?? resolved.getChatProvider();
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
    // repeating it (10). *Every* automation is held, not this binding: what has
    // to happen is one login code, and no binding can supply it.
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
  // binding: it is one fact about every automation the athlete has, so it
  // raises the pause the same way section 10's 2FA demand does, and one skip
  // per binding per poll until the 1st is the run log that already learned not
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
  // so the burst guard only applies to one the binding already writes into.
  //
  // Guard 7 shares the `budget` code with 4b above and nothing else: it is this
  // binding's own three-runs-a-day, it clears at midnight without the athlete
  // doing anything, and it says nothing about the other automations. The reason
  // in words is what keeps the run log able to tell the two apart.
  const rateSkip = checkRateGuards(step, knownSessionId ?? null, resolved);
  if (rateSkip) {
    return skip(
      step,
      rateSkip,
      resolved,
      knownSessionId,
      rateSkip === "budget"
        ? `This coach has already run ${automation.conditions.maxRunsPerDay} times here today.`
        : undefined
    );
  }

  // Every guard passed: only now is it worth putting a conversation on disk.
  const session =
    checked.target.kind === "existing"
      ? checked.target
      : {
          kind: "existing" as const,
          sessionId: createTargetSession(step, resolved),
          entries: [] as PersistedChatEntry[]
        };

  // 5.7: a year-old briefing thread must still cost one turn. Done here, while
  // the run is still being prepared, so the mid-preparation Stop check below
  // covers the window a roll opens — a roll is itself a model call.
  const stored = resolved.getSessionSummary(session.sessionId);
  const plan = planTranscriptContext(session.entries, stored);
  let summary = plan.summary;
  let tail = plan.tail;
  // A roll is a provider turn on this run's behalf, so its tokens belong to
  // this run's row (13). Held here because the roll happens before the row
  // exists, and folded into whatever the run ends up recording — including the
  // exits that never reach the model, which is exactly when a roll that has
  // already spent would otherwise vanish from the month's total.
  let rollUsage: ChatTokenUsage | undefined;
  if (plan.toSummarise.length) {
    const rolled = await resolved.rollSummary(
      plan.summary,
      plan.toSummarise,
      resolveAutomationRuntime(automation)
    );
    rollUsage = rolled.usage;
    if (rolled.summary) {
      summary = rolled.summary;
      resolved.setSessionSummary(session.sessionId, rolled.summary, plan.through);
    } else {
      // Best-effort, and a failure must neither fail the run nor drop the
      // middle of the conversation on the floor. The run sends what it would
      // have sent before the roll — everything the stored summary does not
      // already cover — which costs more this once and rolls again next time.
      tail = [...plan.toSummarise, ...plan.tail];
    }
  }
  /** What to record on a run that ended here, roll included. */
  const costOf = (streamUsage: ChatTokenUsage | undefined) => {
    const total = addTokenUsage(rollUsage, streamUsage);
    return total
      ? { inputTokens: total.inputTokens, outputTokens: total.outputTokens }
      : {};
  };

  // Section 7's default is resolved once, here, so the run log records what the
  // run actually used rather than what the definition happened to leave blank.
  const runtime = resolveAutomationRuntime(automation);
  const startedAt = resolved.now().toISOString();
  let run = resolved.recordRun({
    automationId: automation.id,
    bindingId: binding.id,
    status: "running",
    triggerKind: event.kind,
    sessionId: session.sessionId,
    ...(runtime.model ? { model: runtime.model } : {}),
    ...(runtime.effort ? { effort: runtime.effort } : {}),
    ...(event.payload ? { triggerPayload: event.payload } : {}),
    startedAt
  } as Omit<CoachAutomationRun, "id" | "startedAt">);
  // The run now has an id, which is the only thing Stop can aim at. Claiming it
  // is what turns a Stop on this run into a Stop on the whole trigger.
  cancellation?.claim(run.id);
  resolved.emitRunUpdate(run);

  const marker: ChatEntryAutomationMarker = {
    runId: run.id,
    automationId: automation.id,
    bindingId: binding.id,
    name: automation.name,
    triggerLabel: triggerLabel(automation)
  };

  const playbook = buildPlaybookTurn(step, resolved);
  const collector = resolved.createCollector(marker);
  const watchdog = createIdleWatchdog(resolved.idleTimeoutMs);
  const sink = createTeeSink(collector, watchdog.touch);

  const finish = (
    patch: Partial<Omit<CoachAutomationRun, "id" | "automationId" | "bindingId">>,
    /**
     * False for the one exit taken before the provider was ever called. The
     * backoff is a claim about the provider, and a run that did not reach it
     * has nothing to say either way — least of all "it is healthy again".
     */
    reachedProvider = true
  ): CoachAutomationRun => {
    // Every other way out of this run goes through here, which is what makes
    // the backoff cover the timeout as well as the throw — the two paths
    // section 10 says must behave alike, and the two that leave the other
    // clocks alone.
    if (reachedProvider) {
      applyBackoff(binding, patch.status, resolved);
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
  // pressing Stop would otherwise reset the hold on a binding that is failing.
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
        ...(automation.role ? { roleInstructions: automation.role } : {})
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
      error: error instanceof Error ? error.message : "Automation run failed.",
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

  // The binding's own clock advances for every attempt that reached the
  // provider, so a failing automation still respects its cooldown.
  resolved.setBindingSchedule(binding.id, {
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

  // The binding's watermark moves only once the model has actually looked at
  // the activity *and* what it said is on disk. A failed or cancelled run
  // leaves it where it was, so the activity comes back with the next trigger
  // instead of being lost — and so does a run whose persistence threw, which
  // is why this is called after the save rather than before it. Moving it
  // first meant a throw in the store recorded "analysed" for an answer that
  // was never written, and the activity was gone for good.
  const advanceWatermark = (): void => {
    if (step.activity?.start_time) {
      resolved.setBindingSchedule(binding.id, {
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
    const output = parseAutomationOutput(collector.text());
    if (output.silent) {
      // The answer itself is a control token the athlete must never read, so
      // nothing the model wrote is persisted. What lands instead is a one-line
      // trace saying the coach looked (5.5): a conversation that keeps no
      // record of a run reads as a broken automation rather than as a
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
 * One binding's share of a trigger, expanded into the runs it actually owes.
 * A non-activity trigger is a single run, unchanged; an activity trigger turns
 * into one run per pending activity, oldest first, each naming its own subject.
 */
function planBindingRuns(
  queued: QueuedRun,
  deps: CoachAutomationRunnerDeps
): QueuedRun[] {
  if (queued.automation.trigger.kind !== "activity") {
    return [queued];
  }
  return selectActivitiesForBinding(
    queued.automation,
    queued.binding,
    queued.event,
    deps
  ).map((activity, index) => ({
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
        ...(activity.start_time ? { activityStartTime: activity.start_time } : {})
      }
    }
  }));
}

/**
 * Section 10's pause, read at the gate rather than as a guard rail.
 *
 * The other guard rails record a `skipped` run each, which is right for them —
 * a cooldown or a quiet hour is a fact about *that* binding and the log is
 * where the athlete reads it. This one is not: it is the same fact about all of
 * them, and recording it per binding per poll is precisely the run log full of
 * identical `two-factor-required` rows that the pause exists to stop. So a held
 * trigger produces no runs and logs nothing. The one row that *did* get
 * recorded — the run that tripped it — is what the banner points at.
 */
function pauseHolds(
  event: AutomationTriggerEvent,
  deps: CoachAutomationRunnerDeps
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
 * Fans a trigger out and runs every resulting binding, one at a time.
 *
 * The whole fan-out is one cancellable unit (10). Stop on any run this produces
 * ends the rest of it, which is what the athlete meant by pressing it, and what
 * three separate presses used to be needed for.
 */
export async function runAutomationTrigger(
  event: AutomationTriggerEvent,
  deps?: Partial<CoachAutomationRunnerDeps>
): Promise<CoachAutomationRun[]> {
  const resolved = resolveDeps(deps);
  if (pauseHolds(event, resolved)) {
    return [];
  }
  const cancellation = createTriggerCancellation(resolved);
  liveTriggers.add(cancellation);
  const runs: CoachAutomationRun[] = [];
  let stopped = false;
  try {
    for (const queued of expandTriggerToQueue(event, deps)) {
      // A shortcut, not the guard: the token is read at the top of every step
      // (see `runOneBinding`), which is what covers a step already queued
      // behind a stall. This only stops the fan-out queueing one dead step per
      // remaining binding on the way out.
      if (stopped) {
        break;
      }
      const plan = planBindingRuns(queued, resolved);

      if (!plan.length) {
        // Activity-driven, with nothing new since this binding's watermark. A
        // manual run records the skip so the UI can say so out loud; the
        // 15-minute poll stays quiet rather than filling the log with
        // non-events.
        if (event.kind === "manual") {
          runs.push(
            skip(queued, "no-activity", resolved, queued.binding.sessionId ?? undefined)
          );
        }
        continue;
      }

      for (const step of plan) {
        let run: CoachAutomationRun | null;
        try {
          run = await enqueue(() => runOneBinding(step, deps, cancellation));
        } catch (error) {
          // One binding blowing up must not starve the rest of the fan-out, and
          // the failure still has to be visible in the run log — and count
          // against the binding's backoff, like any other failure.
          const failedAt = resolved.now().toISOString();
          run = resolved.recordRun({
            automationId: step.automation.id,
            bindingId: step.binding.id,
            status: "failed",
            triggerKind: event.kind,
            error: error instanceof Error ? error.message : "Automation run failed.",
            finishedAt: failedAt
          } as Omit<CoachAutomationRun, "id" | "startedAt">);
          applyBackoff(
            resolved.getBinding(step.binding.id) ?? step.binding,
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
        // binding.
        //
        // Asked of the pause rather than of the skip code: guard 7's daily cap
        // records `budget` too, and it is a fact about one binding that must
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


export function getAutomationSpend(): CoachAutomationSpend {
  const monthStart = startOfLocalMonth(new Date());
  const totals = sumCoachAutomationTokensSince(monthStart);
  return {
    monthStart,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    budget: getCoachAutomationBudget(),
    countedRuns: totals.countedRuns,
    providerRuns: totals.providerRuns
  };
}

/**
 * Setting the ceiling is also the way back from a budget pause: raising it (or
 * clearing it) removes the reason, and the gate notices on the next trigger.
 * Lowering it below what is already spent pauses at the next trigger instead.
 */
export function setAutomationBudget(budget: number | null): CoachAutomationSpend {
  setCoachAutomationBudget(budget);
  return getAutomationSpend();
}

/** What the banner reads on mount, before any push has happened. */
export function getAutomationPause(
  deps?: Partial<CoachAutomationRunnerDeps>
): CoachAutomationPause | null {
  return resolveDeps(deps).getPause();
}

/**
 * Section 10's single way to resume. It clears the flag and nothing else — it
 * does not assert that COROS is reachable, because it cannot: the next trigger
 * asks, and re-trips the pause if the answer is still a login code. "Resume"
 * therefore means *try again*, which is the only thing a button here can
 * honestly promise.
 */
export function resumeAutomations(
  deps?: Partial<CoachAutomationRunnerDeps>
): CoachAutomationPause | null {
  resolveDeps(deps).setPause(null);
  return null;
}

/** 3.4 "Run now": bypasses cooldown, quiet hours and the daily cap. */
export function runAutomationNow(
  automationId: string,
  bindingIds?: string[],
  deps?: Partial<CoachAutomationRunnerDeps>
): Promise<CoachAutomationRun[]> {
  return runAutomationTrigger(
    {
      automationId,
      kind: "manual",
      bypassGuards: true,
      ...(bindingIds ? { bindingIds } : {})
    },
    deps
  );
}

/** Test seam: resets the process-wide queue and live tokens between scenarios. */
export function resetAutomationQueueForTests(): void {
  queueTail = Promise.resolve();
  liveTriggers.clear();
}
