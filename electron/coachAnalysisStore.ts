import crypto from "node:crypto";
import {
  countCoachAnalysisRowsForSession,
  deleteAnalysisLocalTriggerRow,
  deleteCoachAnalysisRow,
  deleteCoachAnalysisRowsForSession,
  getAnalysisLocalTriggerRow,
  getCoachAnalysisRow,
  getCoachAnalysisRunRow,
  insertCoachAnalysisRow,
  insertCoachAnalysisRunRow,
  listCoachAnalysisRows,
  listCoachAnalysisRowsForSession,
  listCoachAnalysisRunRows,
  updateCoachAnalysisRow,
  updateCoachAnalysisRunRow,
  upsertAnalysisLocalTriggerRow,
  deleteSettings,
  getSetting,
  setSetting
} from "./database";
import type {
  AnalysisConditions,
  AnalysisRuntime,
  AnalysisTrigger,
  AnalysisTriggerKind,
  ChatProvider,
  CoachAnalysis,
  CoachAnalysisErrorCode,
  CoachAnalysisInput,
  CoachAnalysisPatch,
  CoachAnalysisPause,
  CoachAnalysisRun,
  CoachAnalysisRunQuery,
  CoachAnalysisRunStatus,
  CoachAnalysisSessionAttention,
  CoachAnalysisSummary
} from "./types";
import { DEFAULT_ANALYSIS_CONDITIONS } from "./types";
// The row shapes are owned by the module that writes the SQL, so the two
// cannot drift apart. Re-exported for callers that build rows for the fakes.
import type {
  AnalysisLocalTriggerRow,
  CoachAnalysisRow,
  CoachAnalysisRunRow
} from "./database";

export type { AnalysisLocalTriggerRow, CoachAnalysisRow, CoachAnalysisRunRow };

export { DEFAULT_ANALYSIS_CONDITIONS };

/**
 * Every row read and write the analysis feature makes, as one injectable seam.
 *
 * `localTrigger*` is the device-only half. It is a separate set of members
 * rather than three more columns on an analysis row because the two are
 * governed differently: an analysis row is `personal` tier and travels, a
 * local trigger is `device` tier and cannot. Keeping them apart in the seam is
 * what makes a suite able to assert that a device-only trigger never reached
 * anything that publishes.
 */
export interface CoachAnalysisDatabase {
  listAnalyses(): CoachAnalysisRow[];
  listAnalysesForSession(sessionId: string): CoachAnalysisRow[];
  countAnalysesForSession(sessionId: string): number;
  getAnalysis(id: string): CoachAnalysisRow | undefined;
  insertAnalysis(row: CoachAnalysisRow): void;
  updateAnalysis(row: CoachAnalysisRow): void;
  deleteAnalysis(id: string): void;
  deleteAnalysesForSession(sessionId: string): string[];
  getLocalTrigger(analysisId: string): AnalysisLocalTriggerRow | undefined;
  upsertLocalTrigger(row: AnalysisLocalTriggerRow): void;
  deleteLocalTrigger(analysisId: string): void;
  listRuns(filter: CoachAnalysisRunQuery): CoachAnalysisRunRow[];
  getRun(id: string): CoachAnalysisRunRow | undefined;
  insertRun(row: CoachAnalysisRunRow): void;
  updateRun(row: CoachAnalysisRunRow): void;
  /** The one-flag pause of section 10, as stored JSON or undefined. */
  readPause(): string | undefined;
  writePause(value: string | null): void;
  /** The monthly token ceiling, as stored text or undefined for none. */
  readBudget(): string | undefined;
  writeBudget(value: string | null): void;
}

function createSqliteAnalysisDatabase(): CoachAnalysisDatabase {
  return {
    listAnalyses: () => listCoachAnalysisRows(),
    listAnalysesForSession: (sessionId) =>
      listCoachAnalysisRowsForSession(sessionId),
    countAnalysesForSession: (sessionId) =>
      countCoachAnalysisRowsForSession(sessionId),
    getAnalysis: (id) => getCoachAnalysisRow(id),
    insertAnalysis: (row) => insertCoachAnalysisRow(row),
    updateAnalysis: (row) => updateCoachAnalysisRow(row),
    deleteAnalysis: (id) => deleteCoachAnalysisRow(id),
    deleteAnalysesForSession: (sessionId) =>
      deleteCoachAnalysisRowsForSession(sessionId),
    getLocalTrigger: (analysisId) => getAnalysisLocalTriggerRow(analysisId),
    upsertLocalTrigger: (row) => upsertAnalysisLocalTriggerRow(row),
    deleteLocalTrigger: (analysisId) =>
      deleteAnalysisLocalTriggerRow(analysisId),
    listRuns: (filter) => listCoachAnalysisRunRows(filter),
    getRun: (id) => getCoachAnalysisRunRow(id),
    insertRun: (row) => insertCoachAnalysisRunRow(row),
    updateRun: (row) => updateCoachAnalysisRunRow(row),
    readPause: () => getSetting(PAUSE_SETTING),
    writePause: (value) => {
      if (value === null) {
        deleteSettings([PAUSE_SETTING]);
        return;
      }
      setSetting(PAUSE_SETTING, value);
    },
    readBudget: () => getSetting(BUDGET_SETTING),
    writeBudget: (value) => {
      if (value === null) {
        deleteSettings([BUDGET_SETTING]);
        return;
      }
      setSetting(BUDGET_SETTING, value);
    }
  };
}

/**
 * Section 10's pause is one row in `app_settings`, not a column per analysis.
 * The cause is one thing the athlete fixes once — COROS is asking for a login
 * code — so a per-analysis flag would be five copies of the same fact, each of
 * which could disagree with the others.
 */
// The setting keys keep their pre-rename spelling for the same reason the
// tables do: this one is `preference` tier, so it is already sitting in other
// machines' vaults under this name.
const PAUSE_SETTING = "coachAutomation.pause";

export function getCoachAnalysisPause(
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisPause | null {
  const raw = database.readPause();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CoachAnalysisPause>;
    // A half-written row reads as "not paused". The alternative — trusting a
    // shape nobody checked — is a feature that holds every analysis forever
    // on the strength of a string somebody once put in a settings table.
    const since = optionalText(parsed.since);
    if (
      (parsed.reason !== "two-factor-required" && parsed.reason !== "budget") ||
      !since
    ) {
      return null;
    }
    const runId = optionalText(parsed.runId);
    return {
      reason: parsed.reason,
      since,
      ...(runId ? { runId } : {})
    };
  } catch {
    return null;
  }
}

/**
 * section 13: the athlete's monthly ceiling in tokens, or null for no
 * ceiling — which is the default, because a number nobody chose is a number
 * that pauses their coaches at an arbitrary moment.
 */
const BUDGET_SETTING = "coachAutomation.monthlyTokenBudget";

export function getCoachAnalysisBudget(
  database: CoachAnalysisDatabase = defaultDatabase
): number | null {
  const raw = database.readBudget();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function setCoachAnalysisBudget(
  budget: number | null,
  database: CoachAnalysisDatabase = defaultDatabase
): number | null {
  const next =
    budget !== null && Number.isFinite(budget) && budget > 0
      ? Math.floor(budget)
      : null;
  database.writeBudget(next === null ? null : String(next));
  return next;
}

export function setCoachAnalysisPause(
  pause: CoachAnalysisPause | null,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisPause | null {
  database.writePause(pause ? JSON.stringify(pause) : null);
  return pause;
}

const defaultDatabase = createSqliteAnalysisDatabase();

const ANALYSIS_NAME_MAX = 80;
const THRESHOLD_METRICS = new Set([
  "acuteChronicRamp",
  "restingHrDrift",
  "planAdherence",
  "sleepDebt"
]);
const CHAT_PROVIDERS = new Set<ChatProvider>([
  "chatgpt",
  "claude-api",
  "claude-code",
  "local"
]);
const ANTHROPIC_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function requireText(value: unknown, label: string, max?: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Analysis ${label} is required.`);
  }
  const trimmed = value.trim();
  return max ? trimmed.slice(0, max) : trimmed;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.trim();
}

/** Clamps to a whole number inside [min, max], falling back on junk input. */
function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeQuietHours(
  value: unknown
): AnalysisConditions["quietHours"] {
  if (!isRecord(value)) {
    return undefined;
  }
  if (!isTimeOfDay(value.start) || !isTimeOfDay(value.end)) {
    return undefined;
  }
  return { start: value.start, end: value.end };
}

/**
 * Triggers are stored as opaque JSON, so a definition written by a newer build
 * (or hand-edited) can come back malformed. Anything unrecognised degrades to
 * "manual" rather than throwing, so one bad row cannot take the list screen
 * down; validation of *incoming* triggers happens on the same path, which is
 * why create/update reject junk before it is ever persisted.
 */
export function normalizeAnalysisTrigger(value: unknown): AnalysisTrigger {
  if (!isRecord(value)) {
    return { kind: "manual" };
  }

  if (value.kind === "schedule") {
    if (!isTimeOfDay(value.timeOfDay)) {
      return { kind: "manual" };
    }
    const cadence = value.cadence === "weekly" ? "weekly" : "daily";
    const trigger: AnalysisTrigger = {
      kind: "schedule",
      cadence,
      timeOfDay: value.timeOfDay
    };
    if (cadence === "weekly") {
      trigger.dayOfWeek = clampInt(value.dayOfWeek, 1, 0, 6);
    }
    return trigger;
  }

  if (value.kind === "activity") {
    const sportTypes = Array.isArray(value.sportTypes)
      ? value.sportTypes.filter(
          (entry): entry is number =>
            typeof entry === "number" && Number.isFinite(entry)
        )
      : [];
    const trigger: AnalysisTrigger = { kind: "activity", sportTypes };
    if (typeof value.minDurationSec === "number" && value.minDurationSec > 0) {
      trigger.minDurationSec = Math.round(value.minDurationSec);
    }
    if (typeof value.minDistanceM === "number" && value.minDistanceM > 0) {
      trigger.minDistanceM = Math.round(value.minDistanceM);
    }
    // Off is the documented default, so only an explicit true is persisted;
    // that keeps a definition written before this option existed on the
    // "newest activity only" behaviour it already had.
    if (value.multiActivity === true) {
      trigger.multiActivity = true;
    }
    return trigger;
  }

  if (value.kind === "threshold") {
    if (
      typeof value.metric !== "string" ||
      !THRESHOLD_METRICS.has(value.metric) ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value)
    ) {
      return { kind: "manual" };
    }
    return {
      kind: "threshold",
      metric: value.metric as Extract<
        AnalysisTrigger,
        { kind: "threshold" }
      >["metric"],
      value: value.value
    };
  }

  return { kind: "manual" };
}

export function normalizeAnalysisConditions(
  value: unknown,
  base: AnalysisConditions = DEFAULT_ANALYSIS_CONDITIONS
): AnalysisConditions {
  if (!isRecord(value)) {
    return { ...base };
  }

  const conditions: AnalysisConditions = {
    cooldownMin: clampInt(value.cooldownMin, base.cooldownMin, 0, 10_080),
    maxRunsPerDay: clampInt(value.maxRunsPerDay, base.maxRunsPerDay, 1, 24)
  };

  // An explicit null clears the window; an absent key keeps whatever the
  // caller was already using.
  const quietHours =
    value.quietHours === null
      ? undefined
      : normalizeQuietHours(value.quietHours) ?? base.quietHours;
  if (quietHours) {
    conditions.quietHours = quietHours;
  }
  return conditions;
}

export function normalizeAnalysisRuntime(value: unknown): AnalysisRuntime {
  if (!isRecord(value)) {
    return {};
  }

  const runtime: AnalysisRuntime = {};
  if (
    typeof value.provider === "string" &&
    CHAT_PROVIDERS.has(value.provider as ChatProvider)
  ) {
    runtime.provider = value.provider as ChatProvider;
  }
  const model = optionalText(value.model);
  if (model) {
    runtime.model = model;
  }
  if (typeof value.effort === "string" && ANTHROPIC_EFFORTS.has(value.effort)) {
    runtime.effort = value.effort as AnalysisRuntime["effort"];
  }
  return runtime;
}

/**
 * The trigger an analysis actually fires on, wherever it is stored.
 *
 * A device-only trigger is in `coach_analysis_local_triggers` and the row's
 * own `trigger_json` is NULL; a shared one is on the row. Reading through one
 * function is what keeps every caller — scheduler, watcher, runner, UI — from
 * having to know which, and what makes "this device only" a storage decision
 * rather than a second code path.
 */
function readTrigger(
  row: CoachAnalysisRow,
  database: CoachAnalysisDatabase
): { trigger: AnalysisTrigger | null; conditions: AnalysisConditions } {
  if (row.device_only === 1) {
    const local = database.getLocalTrigger(row.id);
    if (!local) {
      // The flag is on the row, which travels, and the trigger is in a table
      // that does not — so this is exactly what the *other* machine sees. It
      // is not damage: an analysis whose trigger belongs to another desk is a
      // manual one here, which is the whole point.
      return { trigger: null, conditions: { ...DEFAULT_ANALYSIS_CONDITIONS } };
    }
    return {
      trigger: normalizeAnalysisTrigger(parseJson(local.trigger_json)),
      conditions: normalizeAnalysisConditions(parseJson(local.conditions_json))
    };
  }
  const parsed = parseJson(row.trigger_json);
  if (parsed === undefined) {
    return { trigger: null, conditions: { ...DEFAULT_ANALYSIS_CONDITIONS } };
  }
  return {
    trigger: normalizeAnalysisTrigger(parsed),
    conditions: normalizeAnalysisConditions(parseJson(row.conditions_json))
  };
}

function toAnalysis(
  row: CoachAnalysisRow,
  database: CoachAnalysisDatabase
): CoachAnalysis {
  const { trigger, conditions } = readTrigger(row, database);
  const analysis: CoachAnalysis = {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    playbook: row.playbook,
    enabled: row.enabled === 1,
    runtime: normalizeAnalysisRuntime(parseJson(row.runtime_json)),
    trigger,
    conditions,
    deviceOnly: row.device_only === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  const role = optionalText(row.role);
  if (role) {
    analysis.role = role;
  }
  const presetId = optionalText(row.preset_id);
  if (presetId) {
    analysis.presetId = presetId;
  }
  const lastRunAt = optionalText(row.last_run_at);
  if (lastRunAt) {
    analysis.lastRunAt = lastRunAt;
  }
  const nextRunAt = optionalText(row.next_run_at);
  if (nextRunAt) {
    analysis.nextRunAt = nextRunAt;
  }
  // A watermark is a `start_time` in epoch seconds, so zero and below are not
  // watermarks — they are what a hand edit or a bad write leaves behind. The
  // safe reading is *never looked*, which puts the creation time back in front
  // (3.2); trusting a zero would replay the athlete's whole history instead,
  // which is the one thing that floor exists to prevent.
  if (
    typeof row.last_activity_at === "number" &&
    Number.isFinite(row.last_activity_at) &&
    row.last_activity_at > 0
  ) {
    analysis.lastActivityAt = row.last_activity_at;
  }
  // 3.3: NULL means never evaluated, which is a different thing from "the
  // condition was false" — it is what stops an analysis written today firing
  // on a condition that has held all week. Exactly 0 or 1, or it is the NULL
  // case. Reading anything else as `false` would claim the condition *was*
  // evaluated and did not hold — so the next tick would see a transition and
  // announce a condition that may have held all week, which is precisely what
  // the NULL is there to stop.
  if (row.threshold_firing === 0 || row.threshold_firing === 1) {
    analysis.thresholdFiring = row.threshold_firing === 1;
  }
  const backoffUntil = optionalText(row.backoff_until);
  if (backoffUntil) {
    analysis.backoffUntil = backoffUntil;
  }
  // Level 0 is the same statement as "no level".
  if (typeof row.backoff_level === "number" && row.backoff_level > 0) {
    analysis.backoffLevel = row.backoff_level;
  }
  return analysis;
}

function toRow(analysis: CoachAnalysis): CoachAnalysisRow {
  const shared = !analysis.deviceOnly && analysis.trigger !== null;
  return {
    id: analysis.id,
    session_id: analysis.sessionId,
    name: analysis.name,
    role: analysis.role ?? null,
    playbook: analysis.playbook,
    enabled: analysis.enabled ? 1 : 0,
    preset_id: analysis.presetId ?? null,
    runtime_json: JSON.stringify(analysis.runtime),
    trigger_json: shared ? JSON.stringify(analysis.trigger) : null,
    conditions_json: shared ? JSON.stringify(analysis.conditions) : null,
    device_only: analysis.deviceOnly ? 1 : 0,
    sort_order: analysis.sortOrder,
    last_run_at: analysis.lastRunAt ?? null,
    next_run_at: analysis.nextRunAt ?? null,
    last_activity_at: analysis.lastActivityAt ?? null,
    backoff_until: analysis.backoffUntil ?? null,
    backoff_level: analysis.backoffLevel ?? 0,
    threshold_firing:
      analysis.thresholdFiring === undefined
        ? null
        : analysis.thresholdFiring
          ? 1
          : 0,
    created_at: analysis.createdAt,
    updated_at: analysis.updatedAt
  };
}

/**
 * Writes an analysis, putting its trigger on whichever side of the fence it
 * belongs on and clearing the other side.
 *
 * Clearing the other side is the whole job. An athlete who turns "this device
 * only" **on** for a trigger that has already been published must not leave
 * the shared copy standing in the vault — the other machine would keep firing
 * a schedule this one just took private. Turning it **off** has the mirror
 * problem: the local row would shadow the shared one forever.
 */
function writeAnalysis(
  analysis: CoachAnalysis,
  database: CoachAnalysisDatabase,
  insert = false
): void {
  const row = toRow(analysis);
  if (insert) {
    database.insertAnalysis(row);
  } else {
    database.updateAnalysis(row);
  }
  if (analysis.deviceOnly && analysis.trigger) {
    database.upsertLocalTrigger({
      analysis_id: analysis.id,
      trigger_json: JSON.stringify(analysis.trigger),
      conditions_json: JSON.stringify(analysis.conditions),
      updated_at: analysis.updatedAt
    });
    return;
  }
  database.deleteLocalTrigger(analysis.id);
}

/**
 * Rejects a trigger the caller meant to be real but that did not survive
 * normalization — silently downgrading a half-filled schedule to "manual"
 * would leave the athlete with an auto analysis that never fires.
 */
function validateIncomingTrigger(value: unknown): AnalysisTrigger {
  const trigger = normalizeAnalysisTrigger(value);
  if (
    isRecord(value) &&
    typeof value.kind === "string" &&
    value.kind !== "manual" &&
    trigger.kind === "manual"
  ) {
    throw new Error(`Trigger "${value.kind}" is incomplete.`);
  }
  return trigger;
}

/** Section 2.2: the sixth analysis in one conversation is refused. */
export const MAX_ANALYSES_PER_SESSION = 5;

/**
 * Refusals are expected, not exceptional — the UI has to explain each one —
 * so they carry a stable code instead of only a message.
 */
export class CoachAnalysisError extends Error {
  readonly code: CoachAnalysisErrorCode;

  constructor(code: CoachAnalysisErrorCode, message: string) {
    super(message);
    this.name = "CoachAnalysisError";
    this.code = code;
  }
}

/** The analyses of one conversation, in the order they run in it (2.3). */
export function listCoachAnalysesForSession(
  sessionId: string,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis[] {
  return database
    .listAnalysesForSession(sessionId)
    .map((row) => toAnalysis(row, database));
}

export function countCoachAnalysesForSession(
  sessionId: string,
  database: CoachAnalysisDatabase = defaultDatabase
): number {
  return database.countAnalysesForSession(sessionId);
}

export function getCoachAnalysis(
  id: string,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis | null {
  const row = database.getAnalysis(id);
  return row ? toAnalysis(row, database) : null;
}

/**
 * Creates an analysis inside one conversation.
 *
 * There is no attach step and no definition to reuse. An analysis is written
 * where it will speak, which is also where the athlete can see what it will be
 * speaking about — and where "every morning at 07:00" finally has a place to
 * be every morning *in*.
 */
export function createCoachAnalysis(
  input: CoachAnalysisInput,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis {
  const sessionId = optionalText(input.sessionId);
  if (!sessionId) {
    throw new CoachAnalysisError(
      "ANALYSIS_SESSION_REQUIRED",
      "An analysis belongs to a conversation."
    );
  }

  const siblings = database.listAnalysesForSession(sessionId);
  if (siblings.length >= MAX_ANALYSES_PER_SESSION) {
    throw new CoachAnalysisError(
      "ANALYSIS_LIMIT_REACHED",
      `A conversation can run at most ${MAX_ANALYSES_PER_SESSION} analyses.`
    );
  }
  const sortOrder = siblings.reduce(
    (highest, row) => Math.max(highest, row.sort_order + 1),
    0
  );

  const now = new Date().toISOString();
  const trigger =
    input.trigger === undefined || input.trigger === null
      ? null
      : validateIncomingTrigger(input.trigger);
  const analysis: CoachAnalysis = {
    id: crypto.randomUUID(),
    sessionId,
    name: requireText(input.name, "name", ANALYSIS_NAME_MAX),
    playbook: requireText(input.playbook, "playbook"),
    enabled: input.enabled !== false,
    runtime: normalizeAnalysisRuntime(input.runtime),
    trigger,
    conditions: normalizeAnalysisConditions(input.conditions),
    // A manual analysis has nothing to keep on the machine, so the flag is
    // forced off rather than stored as a preference about a trigger that does
    // not exist. Setting a trigger later is where the athlete answers it.
    deviceOnly: trigger !== null && input.deviceOnly === true,
    sortOrder,
    createdAt: now,
    updatedAt: now
  };
  const role = optionalText(input.role);
  if (role) {
    analysis.role = role;
  }
  const presetId = optionalText(input.presetId);
  if (presetId) {
    analysis.presetId = presetId;
  }

  writeAnalysis(analysis, database, true);
  const row = database.getAnalysis(analysis.id);
  if (!row) {
    throw new Error("Failed to create analysis.");
  }
  return toAnalysis(row, database);
}

/**
 * Edits one analysis. `sessionId` is not patchable — an analysis cannot move
 * conversation, and a move would be a new analysis with a new run history.
 *
 * This is also where a manual analysis becomes an auto one and back:
 * `trigger: null` removes the trigger, any other value sets it.
 */
export function updateCoachAnalysis(
  id: string,
  patch: CoachAnalysisPatch,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis | null {
  const row = database.getAnalysis(id);
  if (!row) {
    return null;
  }
  const current = toAnalysis(row, database);

  const trigger =
    patch.trigger === undefined
      ? current.trigger
      : patch.trigger === null
        ? null
        : validateIncomingTrigger(patch.trigger);
  const conditions =
    patch.conditions === undefined
      ? current.conditions
      : normalizeAnalysisConditions(patch.conditions, current.conditions);
  const deviceOnly =
    trigger === null
      ? false
      : patch.deviceOnly === undefined
        ? current.deviceOnly
        : patch.deviceOnly;

  const next: CoachAnalysis = {
    ...current,
    name:
      patch.name === undefined
        ? current.name
        : requireText(patch.name, "name", ANALYSIS_NAME_MAX),
    playbook:
      patch.playbook === undefined
        ? current.playbook
        : requireText(patch.playbook, "playbook"),
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled,
    runtime:
      patch.runtime === undefined
        ? current.runtime
        : normalizeAnalysisRuntime(patch.runtime),
    trigger,
    conditions,
    deviceOnly,
    updatedAt: new Date().toISOString()
  };

  if ("role" in patch) {
    const role = optionalText(patch.role);
    if (role) {
      next.role = role;
    } else {
      delete next.role;
    }
  }
  if ("presetId" in patch) {
    const presetId = optionalText(patch.presetId);
    if (presetId) {
      next.presetId = presetId;
    } else {
      delete next.presetId;
    }
  }

  // A changed trigger invalidates the slot the scheduler already booked (3.1):
  // moving a daily briefing from 07:00 to 21:00 must not fire once more at
  // 07:00 first. Clearing the stamp makes the next tick re-seed it.
  //
  // The threshold firing state (3.3) is invalidated by the same edit and for
  // the same reason: it records whether the *old* condition held, and a rule
  // moved from "ramp over 30%" to "over 5%" would compare today's answer
  // against a question nobody is asking any more. Clearing it back to "never
  // evaluated" makes the next tick re-seed — so an edit, like a creation, is
  // silent rather than firing on history.
  //
  // Both triggers come out of the same builder, so comparing them as JSON
  // compares values, not key order. An edit that leaves the trigger alone —
  // a rewritten playbook, a renamed analysis — leaves both clocks standing.
  if (JSON.stringify(next.trigger) !== JSON.stringify(current.trigger)) {
    delete next.nextRunAt;
    delete next.thresholdFiring;
  }

  writeAnalysis(next, database);
  const nextRow = database.getAnalysis(id);
  return nextRow ? toAnalysis(nextRow, database) : null;
}

export function setCoachAnalysisEnabled(
  id: string,
  enabled: boolean,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis | null {
  return updateCoachAnalysis(id, { enabled }, database);
}

/**
 * Deletes one analysis. The conversation is kept, and so is the run history —
 * run rows carry `analysis_id` and stay readable (2.4).
 */
export function deleteCoachAnalysis(
  id: string,
  database: CoachAnalysisDatabase = defaultDatabase
): void {
  database.deleteLocalTrigger(id);
  database.deleteAnalysis(id);
}

/**
 * Rewrites `sort_order` for one conversation, which is the order its analyses
 * run in. Ids not belonging to the conversation are ignored; analyses the
 * caller left out keep their relative order behind the ones it listed, so a
 * stale UI list cannot drop one out of the rotation.
 */
export function reorderCoachAnalyses(
  sessionId: string,
  analysisIds: string[],
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis[] {
  const rows = database.listAnalysesForSession(sessionId);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const ordered: CoachAnalysisRow[] = [];
  const seen = new Set<string>();
  for (const id of analysisIds) {
    const row = byId.get(id);
    if (!row || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push(row);
  }
  for (const row of rows) {
    if (!seen.has(row.id)) {
      ordered.push(row);
    }
  }

  ordered.forEach((row, index) => {
    if (row.sort_order !== index) {
      database.updateAnalysis({ ...row, sort_order: index });
    }
  });

  return listCoachAnalysesForSession(sessionId, database);
}

/**
 * Stamps the clocks an analysis keeps for itself: the scheduler's last/next
 * slots (3.1), the activity watermark (3.2) and the failure backoff (10).
 * Every key is optional and an absent one is left alone, so a caller that only
 * knows one of them never has to read the row first.
 */
export function setCoachAnalysisSchedule(
  id: string,
  schedule: {
    lastRunAt?: string | null;
    nextRunAt?: string | null;
    lastActivityAt?: number | null;
    backoffUntil?: string | null;
    backoffLevel?: number | null;
    /** 3.3: null resets an analysis to "never evaluated". */
    thresholdFiring?: boolean | null;
  },
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis | null {
  const row = database.getAnalysis(id);
  if (!row) {
    return null;
  }
  database.updateAnalysis({
    ...row,
    last_run_at:
      schedule.lastRunAt === undefined
        ? row.last_run_at
        : optionalText(schedule.lastRunAt) ?? null,
    next_run_at:
      schedule.nextRunAt === undefined
        ? row.next_run_at
        : optionalText(schedule.nextRunAt) ?? null,
    last_activity_at:
      schedule.lastActivityAt === undefined
        ? row.last_activity_at
        : schedule.lastActivityAt,
    backoff_until:
      schedule.backoffUntil === undefined
        ? row.backoff_until
        : optionalText(schedule.backoffUntil) ?? null,
    backoff_level:
      schedule.backoffLevel === undefined
        ? row.backoff_level
        : schedule.backoffLevel ?? 0,
    threshold_firing:
      schedule.thresholdFiring === undefined
        ? row.threshold_firing
        : schedule.thresholdFiring === null
          ? null
          : schedule.thresholdFiring
            ? 1
            : 0
  });
  const nextRow = database.getAnalysis(id);
  return nextRow ? toAnalysis(nextRow, database) : null;
}

/**
 * A conversation was deleted, so everything written inside it goes too.
 *
 * This is now a plain consequence of ownership rather than a policy. An
 * analysis lives in one conversation and cannot be moved, so a deleted
 * conversation leaves nothing to re-point and nothing to disable — the rows
 * are removed and returned, so the caller can say which analyses stopped.
 */
export function applyAnalysisSessionDeleted(
  sessionId: string,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis[] {
  const removed = listCoachAnalysesForSession(sessionId, database);
  database.deleteAnalysesForSession(sessionId);
  for (const analysis of removed) {
    database.deleteLocalTrigger(analysis.id);
  }
  return removed;
}

/**
 * Every analysis carrying a real trigger and switched on, for the scheduler's
 * tick and the activity watcher's poll.
 *
 * One read of the analyses themselves: a shared trigger is on the row, so
 * there is nothing to join. Only a "this device only" analysis costs a second
 * lookup, because its trigger is deliberately in a table that does not travel.
 */
export function listTriggeredCoachAnalyses(
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysis[] {
  const out: CoachAnalysis[] = [];
  for (const row of database.listAnalyses()) {
    if (row.enabled !== 1) {
      continue;
    }
    const analysis = toAnalysis(row, database);
    if (!analysis.trigger || analysis.trigger.kind === "manual") {
      continue;
    }
    out.push(analysis);
  }
  return out;
}

// --- Runs -------------------------------------------------------------------

const RUN_STATUSES = new Set<CoachAnalysisRunStatus>([
  "running",
  "success",
  "silent",
  "skipped",
  "failed",
  "cancelled"
]);

const RUN_TRIGGER_KINDS = new Set<AnalysisTriggerKind>([
  "schedule",
  "activity",
  "threshold",
  "manual"
]);

function toRun(row: CoachAnalysisRunRow): CoachAnalysisRun {
  const run: CoachAnalysisRun = {
    id: row.id,
    analysisId: row.analysis_id,
    status: RUN_STATUSES.has(row.status as CoachAnalysisRunStatus)
      ? (row.status as CoachAnalysisRunStatus)
      : "failed",
    triggerKind: RUN_TRIGGER_KINDS.has(row.trigger_kind as AnalysisTriggerKind)
      ? (row.trigger_kind as AnalysisTriggerKind)
      : "manual",
    startedAt: row.started_at
  };

  const payload = parseJson(row.trigger_payload_json);
  if (isRecord(payload)) {
    run.triggerPayload = payload;
  }
  const optionals: Array<[keyof CoachAnalysisRun, string | null]> = [
    ["sessionId", row.session_id],
    ["summary", row.summary],
    ["model", row.model],
    ["effort", row.effort],
    ["error", row.error],
    ["skipReason", row.skip_reason],
    ["seenAt", row.seen_at],
    ["finishedAt", row.finished_at]
  ];
  for (const [key, value] of optionals) {
    const text = optionalText(value);
    if (text) {
      (run as unknown as Record<string, unknown>)[key] = text;
    }
  }
  // Zero is a real answer here — a cancelled run that never reached the model
  // genuinely cost nothing — so these are read on nullness, not truthiness.
  const cost = (value: number | null): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  // Negative is not a cost. It would subtract from the month's total, and a
  // budget that reads *under* the truth is the failure 13 calls worse than no
  // budget — a number the athlete would trust. Unreported is the honest answer.
  const inputTokens = cost(row.input_tokens);
  if (inputTokens !== undefined) {
    run.inputTokens = inputTokens;
  }
  const outputTokens = cost(row.output_tokens);
  if (outputTokens !== undefined) {
    run.outputTokens = outputTokens;
  }
  return run;
}

function toRunRow(run: CoachAnalysisRun): CoachAnalysisRunRow {
  return {
    id: run.id,
    analysis_id: run.analysisId,
    status: run.status,
    trigger_kind: run.triggerKind,
    trigger_payload_json: run.triggerPayload
      ? JSON.stringify(run.triggerPayload)
      : null,
    session_id: run.sessionId ?? null,
    summary: run.summary ?? null,
    model: run.model ?? null,
    effort: run.effort ?? null,
    error: run.error ?? null,
    skip_reason: run.skipReason ?? null,
    seen_at: run.seenAt ?? null,
    input_tokens: run.inputTokens ?? null,
    output_tokens: run.outputTokens ?? null,
    started_at: run.startedAt,
    finished_at: run.finishedAt ?? null
  };
}

export type CoachAnalysisRunInput = Omit<CoachAnalysisRun, "id" | "startedAt"> &
  Partial<Pick<CoachAnalysisRun, "id" | "startedAt">>;

/**
 * Every run is logged, including the silent and skipped ones. An analysis
 * that quietly does nothing is otherwise indistinguishable from a broken one.
 */
export function recordCoachAnalysisRun(
  input: CoachAnalysisRunInput,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisRun {
  const run: CoachAnalysisRun = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    startedAt: input.startedAt ?? new Date().toISOString()
  };
  database.insertRun(toRunRow(run));
  const row = database.getRun(run.id);
  if (!row) {
    throw new Error("Failed to record analysis run.");
  }
  return toRun(row);
}

export function updateCoachAnalysisRun(
  id: string,
  patch: Partial<Omit<CoachAnalysisRun, "id" | "analysisId">>,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisRun | null {
  const row = database.getRun(id);
  if (!row) {
    return null;
  }
  database.updateRun(toRunRow({ ...toRun(row), ...patch }));
  const nextRow = database.getRun(id);
  return nextRow ? toRun(nextRow) : null;
}

export function getCoachAnalysisRun(
  id: string,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisRun | null {
  const row = database.getRun(id);
  return row ? toRun(row) : null;
}

export function listCoachAnalysisRuns(
  filter: CoachAnalysisRunQuery = {},
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisRun[] {
  return database.listRuns(filter).map((row) => toRun(row));
}

/**
 * Section 10: a run that was in flight when the app quit stays `running`
 * forever, because nothing is left to finish it. Reconciled once at startup so
 * the run log never shows a spinner for a process that no longer exists.
 */
export function cancelStaleCoachAnalysisRuns(
  database: CoachAnalysisDatabase = defaultDatabase
): number {
  const stale = database.listRuns({ statuses: ["running"] });
  const finishedAt = new Date().toISOString();
  for (const row of stale) {
    database.updateRun({
      ...row,
      status: "cancelled",
      error: "The app closed while this run was in progress.",
      finished_at: finishedAt
    });
  }
  return stale.length;
}

/** Clears the unread badge for a set of runs. */
export function markCoachAnalysisRunsSeen(
  ids: string[],
  database: CoachAnalysisDatabase = defaultDatabase
): number {
  const seenAt = new Date().toISOString();
  let updated = 0;
  for (const id of ids) {
    const row = database.getRun(id);
    if (!row || row.seen_at) {
      continue;
    }
    database.updateRun({ ...row, seen_at: seenAt });
    updated += 1;
  }
  return updated;
}

/**
 * Runs that landed in a conversation and add up to something the athlete has
 * not looked at. Only `success` and `silent` count: those are the two that
 * write to the transcript, and so the two that bump the row to the top of the
 * conversation list (9.3). A skip or a failure wrote nothing, and belongs in
 * the run log rather than on a conversation.
 */
const ATTENTION_STATUSES: CoachAnalysisRunStatus[] = ["success", "silent"];

/**
 * What the conversation list needs to know, in one pass: which conversations a
 * coach can speak into, and which of them have said something unread.
 */
export function listCoachAnalysisSessionAttention(
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisSessionAttention[] {
  const attention = new Map<string, CoachAnalysisSessionAttention>();
  const entry = (sessionId: string): CoachAnalysisSessionAttention => {
    const existing = attention.get(sessionId);
    if (existing) {
      return existing;
    }
    const created = { sessionId, attached: false, unread: 0 };
    attention.set(sessionId, created);
    return created;
  };

  for (const row of database.listAnalyses()) {
    // A manual analysis still marks its conversation: the athlete can run it
    // from there, which is exactly what the mark announces — and most
    // analyses are manual, so a mark that required a trigger would leave the
    // sidebar almost blank.
    if (row.enabled === 1) {
      entry(row.session_id).attached = true;
    }
  }

  for (const row of database.listRuns({
    statuses: ATTENTION_STATUSES,
    unseenOnly: true
  })) {
    // A run whose conversation was deleted has nowhere to be unread.
    if (row.session_id) {
      entry(row.session_id).unread += 1;
    }
  }

  return [...attention.values()];
}

/**
 * Clears the unread mark for one conversation, which is what opening it means.
 * Scoped to the statuses that made it unread in the first place, so a skip the
 * athlete never saw is not quietly stamped as read.
 */
export function markCoachAnalysisSessionSeen(
  sessionId: string,
  database: CoachAnalysisDatabase = defaultDatabase
): number {
  const unread = database.listRuns({
    sessionId,
    statuses: ATTENTION_STATUSES,
    unseenOnly: true
  });
  return markCoachAnalysisRunsSeen(
    unread.map((row) => row.id),
    database
  );
}

/**
 * One conversation's analyses, each with what it last did.
 *
 * There is no list screen any more, so this is not a projection over the whole
 * feature — it is what the conversation header renders, and the run is the
 * only thing on that row the analysis itself does not carry.
 */
export function listCoachAnalysisSummariesForSession(
  sessionId: string,
  database: CoachAnalysisDatabase = defaultDatabase
): CoachAnalysisSummary[] {
  return listCoachAnalysesForSession(sessionId, database).map((analysis) => {
    const [lastRun] = listCoachAnalysisRuns(
      { analysisId: analysis.id, limit: 1 },
      database
    );
    return lastRun ? { analysis, lastRun } : { analysis };
  });
}
