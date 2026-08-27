import crypto from "node:crypto";
import {
  countCoachAutomationBindingRows,
  deleteCoachAutomationBindingRow,
  deleteCoachAutomationBindingRowsForAutomation,
  deleteCoachAutomationRow,
  getCoachAutomationBindingRow,
  getCoachAutomationRow,
  insertCoachAutomationBindingRow,
  insertCoachAutomationRow,
  listCoachAutomationBindingRows,
  listCoachAutomationBindingRowsForSession,
  listCoachAutomationRows,
  listCoachAutomationRunRows,
  getCoachAutomationRunRow,
  insertCoachAutomationRunRow,
  updateCoachAutomationRunRow,
  updateCoachAutomationBindingRow,
  updateCoachAutomationRow,
  deleteSettings,
  getSetting,
  setSetting
} from "./database";
import type {
  AutomationBindingMode,
  AutomationConditions,
  AutomationRuntime,
  AutomationTrigger,
  AutomationTriggerKind,
  ChatProvider,
  CoachAutomation,
  CoachAutomationBinding,
  CoachAutomationBindingErrorCode,
  CoachAutomationBindingInput,
  CoachAutomationInput,
  CoachAutomationPause,
  CoachAutomationRun,
  CoachAutomationRunQuery,
  CoachAutomationRunStatus,
  CoachAutomationSessionAttention,
  CoachAutomationSessionDeletionReport,
  CoachAutomationSummary
} from "./types";
// The row shapes are owned by the module that writes the SQL, so the two
// cannot drift apart. Re-exported for callers that build rows for the fakes.
import type {
  CoachAutomationBindingRow,
  CoachAutomationRow,
  CoachAutomationRunRow
} from "./database";

export type {
  CoachAutomationBindingRow,
  CoachAutomationRow,
  CoachAutomationRunRow
};

export interface CoachAutomationDatabase {
  listAutomations(): CoachAutomationRow[];
  getAutomation(id: string): CoachAutomationRow | undefined;
  insertAutomation(row: CoachAutomationRow): void;
  updateAutomation(row: CoachAutomationRow): void;
  deleteAutomation(id: string): void;
  deleteBindingsForAutomation(automationId: string): void;
  countBindings(automationId: string): number;
  listBindings(automationId: string): CoachAutomationBindingRow[];
  listBindingsForSession(sessionId: string): CoachAutomationBindingRow[];
  getBinding(id: string): CoachAutomationBindingRow | undefined;
  insertBinding(row: CoachAutomationBindingRow): void;
  updateBinding(row: CoachAutomationBindingRow): void;
  deleteBinding(id: string): void;
  listRuns(filter: CoachAutomationRunQuery): CoachAutomationRunRow[];
  getRun(id: string): CoachAutomationRunRow | undefined;
  insertRun(row: CoachAutomationRunRow): void;
  updateRun(row: CoachAutomationRunRow): void;
  /** The one-flag pause of section 10, as stored JSON or undefined. */
  readPause(): string | undefined;
  writePause(value: string | null): void;
  /** The monthly token ceiling, as stored text or undefined for none. */
  readBudget(): string | undefined;
  writeBudget(value: string | null): void;
}

function createSqliteAutomationDatabase(): CoachAutomationDatabase {
  return {
    listAutomations: () => listCoachAutomationRows(),
    getAutomation: (id) => getCoachAutomationRow(id),
    insertAutomation: (row) => insertCoachAutomationRow(row),
    updateAutomation: (row) => updateCoachAutomationRow(row),
    deleteAutomation: (id) => deleteCoachAutomationRow(id),
    deleteBindingsForAutomation: (automationId) =>
      deleteCoachAutomationBindingRowsForAutomation(automationId),
    countBindings: (automationId) =>
      countCoachAutomationBindingRows(automationId),
    listBindings: (automationId) => listCoachAutomationBindingRows(automationId),
    listBindingsForSession: (sessionId) =>
      listCoachAutomationBindingRowsForSession(sessionId),
    getBinding: (id) => getCoachAutomationBindingRow(id),
    insertBinding: (row) => insertCoachAutomationBindingRow(row),
    updateBinding: (row) => updateCoachAutomationBindingRow(row),
    deleteBinding: (id) => deleteCoachAutomationBindingRow(id),
    listRuns: (filter) => listCoachAutomationRunRows(filter),
    getRun: (id) => getCoachAutomationRunRow(id),
    insertRun: (row) => insertCoachAutomationRunRow(row),
    updateRun: (row) => updateCoachAutomationRunRow(row),
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
 * Section 10's pause is one row in `app_settings`, not a column per binding.
 * The cause is one thing the athlete fixes once — COROS is asking for a login
 * code — so a per-binding flag would be five copies of the same fact, each of
 * which could disagree with the others.
 */
const PAUSE_SETTING = "coachAutomation.pause";

export function getCoachAutomationPause(
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationPause | null {
  const raw = database.readPause();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CoachAutomationPause>;
    // A half-written row reads as "not paused". The alternative — trusting a
    // shape nobody checked — is a feature that holds every automation forever
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

export function getCoachAutomationBudget(
  database: CoachAutomationDatabase = defaultDatabase
): number | null {
  const raw = database.readBudget();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function setCoachAutomationBudget(
  budget: number | null,
  database: CoachAutomationDatabase = defaultDatabase
): number | null {
  const next =
    budget !== null && Number.isFinite(budget) && budget > 0
      ? Math.floor(budget)
      : null;
  database.writeBudget(next === null ? null : String(next));
  return next;
}

export function setCoachAutomationPause(
  pause: CoachAutomationPause | null,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationPause | null {
  database.writePause(pause ? JSON.stringify(pause) : null);
  return pause;
}

const defaultDatabase = createSqliteAutomationDatabase();

export const DEFAULT_AUTOMATION_CONDITIONS: AutomationConditions = {
  batchWindowMin: 20,
  cooldownMin: 120,
  maxRunsPerDay: 3
};

const AUTOMATION_NAME_MAX = 80;
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
    throw new Error(`Automation ${label} is required.`);
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
): AutomationConditions["quietHours"] {
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
export function normalizeAutomationTrigger(value: unknown): AutomationTrigger {
  if (!isRecord(value)) {
    return { kind: "manual" };
  }

  if (value.kind === "schedule") {
    if (!isTimeOfDay(value.timeOfDay)) {
      return { kind: "manual" };
    }
    const cadence = value.cadence === "weekly" ? "weekly" : "daily";
    const trigger: AutomationTrigger = {
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
    const trigger: AutomationTrigger = { kind: "activity", sportTypes };
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
        AutomationTrigger,
        { kind: "threshold" }
      >["metric"],
      value: value.value
    };
  }

  return { kind: "manual" };
}

export function normalizeAutomationConditions(
  value: unknown,
  base: AutomationConditions = DEFAULT_AUTOMATION_CONDITIONS
): AutomationConditions {
  if (!isRecord(value)) {
    return { ...base };
  }

  const conditions: AutomationConditions = {
    batchWindowMin: clampInt(value.batchWindowMin, base.batchWindowMin, 0, 720),
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

export function normalizeAutomationRuntime(value: unknown): AutomationRuntime {
  if (!isRecord(value)) {
    return {};
  }

  const runtime: AutomationRuntime = {};
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
    runtime.effort = value.effort as AutomationRuntime["effort"];
  }
  return runtime;
}

function toAutomation(row: CoachAutomationRow): CoachAutomation {
  const automation: CoachAutomation = {
    id: row.id,
    name: row.name,
    playbook: row.playbook,
    enabled: row.enabled === 1,
    trigger: normalizeAutomationTrigger(parseJson(row.trigger_json)),
    conditions: normalizeAutomationConditions(parseJson(row.conditions_json)),
    runtime: normalizeAutomationRuntime(parseJson(row.runtime_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  const role = optionalText(row.role);
  if (role) {
    automation.role = role;
  }
  const presetId = optionalText(row.preset_id);
  if (presetId) {
    automation.presetId = presetId;
  }
  return automation;
}

function toRow(automation: CoachAutomation): CoachAutomationRow {
  return {
    id: automation.id,
    name: automation.name,
    role: automation.role ?? null,
    playbook: automation.playbook,
    enabled: automation.enabled ? 1 : 0,
    preset_id: automation.presetId ?? null,
    trigger_json: JSON.stringify(automation.trigger),
    conditions_json: JSON.stringify(automation.conditions),
    runtime_json: JSON.stringify(automation.runtime),
    created_at: automation.createdAt,
    updated_at: automation.updatedAt
  };
}

/**
 * Rejects a trigger the caller meant to be real but that did not survive
 * normalization — silently downgrading a half-filled schedule to "manual"
 * would leave the athlete with an automation that never fires.
 */
function validateIncomingTrigger(value: unknown): AutomationTrigger {
  const trigger = normalizeAutomationTrigger(value);
  if (
    isRecord(value) &&
    typeof value.kind === "string" &&
    value.kind !== "manual" &&
    trigger.kind === "manual"
  ) {
    throw new Error(`Automation trigger "${value.kind}" is incomplete.`);
  }
  return trigger;
}

export function listCoachAutomations(
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomation[] {
  return database.listAutomations().map((row) => toAutomation(row));
}

export function getCoachAutomation(
  id: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomation | null {
  const row = database.getAutomation(id);
  return row ? toAutomation(row) : null;
}

export function createCoachAutomation(
  input: CoachAutomationInput,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomation {
  const now = new Date().toISOString();
  const automation: CoachAutomation = {
    id: crypto.randomUUID(),
    name: requireText(input.name, "name", AUTOMATION_NAME_MAX),
    playbook: requireText(input.playbook, "playbook"),
    enabled: input.enabled !== false,
    trigger: validateIncomingTrigger(input.trigger),
    conditions: normalizeAutomationConditions(input.conditions),
    runtime: normalizeAutomationRuntime(input.runtime),
    createdAt: now,
    updatedAt: now
  };
  const role = optionalText(input.role);
  if (role) {
    automation.role = role;
  }
  const presetId = optionalText(input.presetId);
  if (presetId) {
    automation.presetId = presetId;
  }

  database.insertAutomation(toRow(automation));
  const row = database.getAutomation(automation.id);
  if (!row) {
    throw new Error("Failed to create coach automation.");
  }
  return toAutomation(row);
}

export function updateCoachAutomation(
  id: string,
  patch: Partial<CoachAutomationInput>,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomation | null {
  const row = database.getAutomation(id);
  if (!row) {
    return null;
  }

  const current = toAutomation(row);
  const next: CoachAutomation = {
    ...current,
    name:
      patch.name === undefined
        ? current.name
        : requireText(patch.name, "name", AUTOMATION_NAME_MAX),
    playbook:
      patch.playbook === undefined
        ? current.playbook
        : requireText(patch.playbook, "playbook"),
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled,
    trigger:
      patch.trigger === undefined
        ? current.trigger
        : validateIncomingTrigger(patch.trigger),
    // Conditions patch over what is stored, so a UI that only sends the field
    // it changed does not reset the other guard rails to their defaults.
    conditions:
      patch.conditions === undefined
        ? current.conditions
        : normalizeAutomationConditions(patch.conditions, current.conditions),
    runtime:
      patch.runtime === undefined
        ? current.runtime
        : normalizeAutomationRuntime(patch.runtime),
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

  database.updateAutomation(toRow(next));

  // A changed trigger invalidates every slot the scheduler already booked
  // (3.1): moving a daily briefing from 07:00 to 21:00 must not fire once more
  // at 07:00 first. Clearing the stamp makes the next tick re-seed it from the
  // new trigger. Both triggers come out of the same builder, so comparing them
  // as JSON compares values, not key order.
  //
  // The threshold firing state (3.3) is invalidated by the same edit and for
  // the same reason: it records whether the *old* condition held, and a rule
  // moved from "ramp over 30%" to "over 5%" would compare today's answer
  // against a question nobody is asking any more. Clearing it back to "never
  // evaluated" makes the next tick re-seed — so an edit, like an attach, is
  // silent rather than firing on history.
  if (
    patch.trigger !== undefined &&
    JSON.stringify(next.trigger) !== JSON.stringify(current.trigger)
  ) {
    for (const binding of database.listBindings(id)) {
      if (binding.next_run_at !== null || binding.threshold_firing !== null) {
        database.updateBinding({
          ...binding,
          next_run_at: null,
          threshold_firing: null
        });
      }
    }
  }

  const nextRow = database.getAutomation(id);
  return nextRow ? toAutomation(nextRow) : null;
}

export function setCoachAutomationEnabled(
  id: string,
  enabled: boolean,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomation | null {
  return updateCoachAutomation(id, { enabled }, database);
}

/**
 * Deletes the definition and every place it was attached. Conversations are
 * untouched — they are the athlete's chat history, not the automation's.
 */
export function deleteCoachAutomation(
  id: string,
  database: CoachAutomationDatabase = defaultDatabase
): void {
  database.deleteBindingsForAutomation(id);
  database.deleteAutomation(id);
}

/** Bindings attached to a definition, for the list screen's cost hint. */
export function countCoachAutomationBindings(
  id: string,
  database: CoachAutomationDatabase = defaultDatabase
): number {
  return database.countBindings(id);
}

// --- Bindings ---------------------------------------------------------------

/** Section 2.2: the sixth automation on one conversation is refused. */
export const MAX_BINDINGS_PER_SESSION = 5;

const BINDING_MODES = new Set<AutomationBindingMode>([
  "per-run",
  "dedicated",
  "existing"
]);

/**
 * Attach failures are expected, not exceptional — the UI has to explain each
 * one — so they carry a stable code instead of only a message.
 */
export class CoachAutomationBindingError extends Error {
  readonly code: CoachAutomationBindingErrorCode;

  constructor(code: CoachAutomationBindingErrorCode, message: string) {
    super(message);
    this.name = "CoachAutomationBindingError";
    this.code = code;
  }
}

function toBinding(row: CoachAutomationBindingRow): CoachAutomationBinding {
  const binding: CoachAutomationBinding = {
    id: row.id,
    automationId: row.automation_id,
    mode: BINDING_MODES.has(row.mode as AutomationBindingMode)
      ? (row.mode as AutomationBindingMode)
      : "existing",
    // `per-run` owns no conversation (2.1), and the type says so. A row that
    // carries one anyway is contradicting its own mode — the attach path
    // refuses that combination, so it can only come from a hand edit or a
    // migration — and every reader already behaves as though the id were not
    // there. Reading it as null is what stops the two disagreeing.
    sessionId: row.mode === "per-run" ? null : row.session_id,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  };
  const titleTemplate = optionalText(row.title_template);
  if (titleTemplate) {
    binding.titleTemplate = titleTemplate;
  }
  const lastRunAt = optionalText(row.last_run_at);
  if (lastRunAt) {
    binding.lastRunAt = lastRunAt;
  }
  const nextRunAt = optionalText(row.next_run_at);
  if (nextRunAt) {
    binding.nextRunAt = nextRunAt;
  }
  // A watermark is a `start_time` in epoch seconds, so zero and below are not
  // watermarks — they are what a hand edit or a bad write leaves behind. The
  // safe reading is *never analysed*, which puts the attach time back in front
  // (3.2); trusting a zero would replay the athlete's whole history instead,
  // which is the one thing that floor exists to prevent.
  if (
    typeof row.last_activity_at === "number" &&
    Number.isFinite(row.last_activity_at) &&
    row.last_activity_at > 0
  ) {
    binding.lastActivityAt = row.last_activity_at;
  }
  // 3.3: NULL means this binding has never been evaluated, which is a
  // different thing from "the condition was false" — it is what stops a
  // binding attached today firing on a condition that has held all week.
  // Exactly 0 or 1, or it is the NULL case. Reading anything else as `false`
  // would claim the condition *was* evaluated and did not hold — so the next
  // tick would see a transition and announce a condition that may have held all
  // week, which is precisely what the NULL is there to stop.
  if (row.threshold_firing === 0 || row.threshold_firing === 1) {
    binding.thresholdFiring = row.threshold_firing === 1;
  }
  const backoffUntil = optionalText(row.backoff_until);
  if (backoffUntil) {
    binding.backoffUntil = backoffUntil;
  }
  // Level 0 is the same statement as "no level", and a row that says neither is
  // one written before the columns existed — all three read as healthy.
  if (typeof row.backoff_level === "number" && row.backoff_level > 0) {
    binding.backoffLevel = row.backoff_level;
  }
  return binding;
}

function toBindingRow(
  binding: CoachAutomationBinding
): CoachAutomationBindingRow {
  return {
    id: binding.id,
    automation_id: binding.automationId,
    mode: binding.mode,
    session_id: binding.sessionId,
    title_template: binding.titleTemplate ?? null,
    enabled: binding.enabled ? 1 : 0,
    sort_order: binding.sortOrder,
    last_run_at: binding.lastRunAt ?? null,
    next_run_at: binding.nextRunAt ?? null,
    last_activity_at: binding.lastActivityAt ?? null,
    backoff_until: binding.backoffUntil ?? null,
    backoff_level: binding.backoffLevel ?? 0,
    threshold_firing:
      binding.thresholdFiring === undefined ? null : binding.thresholdFiring ? 1 : 0,
    created_at: binding.createdAt
  };
}

function normalizeBindingMode(value: unknown): AutomationBindingMode {
  if (
    typeof value === "string" &&
    BINDING_MODES.has(value as AutomationBindingMode)
  ) {
    return value as AutomationBindingMode;
  }
  throw new Error(`Unknown automation binding mode: ${String(value)}`);
}

/**
 * Every place a definition is active, in run order. Includes the "per-run"
 * binding, which has no conversation of its own.
 */
export function listCoachAutomationBindings(
  automationId: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding[] {
  return database.listBindings(automationId).map((row) => toBinding(row));
}

/**
 * The automations attached to one conversation, in `sort_order` — which is the
 * order runs against that conversation must execute in (2.3).
 */
export function listCoachAutomationBindingsForSession(
  sessionId: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding[] {
  return database
    .listBindingsForSession(sessionId)
    .map((row) => toBinding(row));
}

export function getCoachAutomationBinding(
  id: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding | null {
  const row = database.getBinding(id);
  return row ? toBinding(row) : null;
}

/**
 * Attaches a definition to one place it should run. Enforces the three
 * constraints from 2.2 in the store rather than leaning on the unique indexes,
 * so the caller gets a code it can turn into a sentence instead of a
 * SQLITE_CONSTRAINT.
 */
export function attachCoachAutomation(
  input: CoachAutomationBindingInput,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding {
  const mode = normalizeBindingMode(input.mode);
  const sessionId = optionalText(input.sessionId) ?? null;

  if (!database.getAutomation(input.automationId)) {
    throw new CoachAutomationBindingError(
      "AUTOMATION_NOT_FOUND",
      "That automation no longer exists."
    );
  }

  if (mode === "per-run") {
    if (sessionId) {
      throw new CoachAutomationBindingError(
        "BINDING_SESSION_NOT_ALLOWED",
        "A per-run binding creates its own conversation and cannot target one."
      );
    }
    const existingPerRun = database
      .listBindings(input.automationId)
      .some((row) => row.session_id === null);
    if (existingPerRun) {
      throw new CoachAutomationBindingError(
        "BINDING_PER_RUN_EXISTS",
        "This automation already starts a new conversation on every run."
      );
    }
  } else if (!sessionId) {
    throw new CoachAutomationBindingError(
      "BINDING_SESSION_REQUIRED",
      `A "${mode}" binding needs a conversation to write into.`
    );
  }

  let sortOrder = 0;
  if (sessionId) {
    const siblings = database.listBindingsForSession(sessionId);
    if (siblings.some((row) => row.automation_id === input.automationId)) {
      throw new CoachAutomationBindingError(
        "BINDING_DUPLICATE",
        "This automation is already attached to that conversation."
      );
    }
    if (siblings.length >= MAX_BINDINGS_PER_SESSION) {
      throw new CoachAutomationBindingError(
        "BINDING_LIMIT_REACHED",
        `A conversation can run at most ${MAX_BINDINGS_PER_SESSION} automations.`
      );
    }
    sortOrder = siblings.reduce(
      (highest, row) => Math.max(highest, row.sort_order + 1),
      0
    );
  }

  const binding: CoachAutomationBinding = {
    id: crypto.randomUUID(),
    automationId: input.automationId,
    mode,
    sessionId,
    enabled: input.enabled !== false,
    sortOrder,
    createdAt: new Date().toISOString()
  };
  // A title template only means something when the binding makes the
  // conversation itself.
  const titleTemplate = mode === "per-run" ? optionalText(input.titleTemplate) : undefined;
  if (titleTemplate) {
    binding.titleTemplate = titleTemplate;
  }

  database.insertBinding(toBindingRow(binding));
  const row = database.getBinding(binding.id);
  if (!row) {
    throw new Error("Failed to attach coach automation.");
  }
  return toBinding(row);
}

/**
 * Removes one attachment point. The conversation is kept, and so is the run
 * history — run rows carry `automation_id` and stay readable (2.4).
 */
export function detachCoachAutomation(
  bindingId: string,
  database: CoachAutomationDatabase = defaultDatabase
): void {
  database.deleteBinding(bindingId);
}

export function setCoachAutomationBindingEnabled(
  bindingId: string,
  enabled: boolean,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding | null {
  const row = database.getBinding(bindingId);
  if (!row) {
    return null;
  }
  database.updateBinding({ ...row, enabled: enabled ? 1 : 0 });
  const nextRow = database.getBinding(bindingId);
  return nextRow ? toBinding(nextRow) : null;
}

/**
 * Rewrites `sort_order` for one conversation, which is the order its
 * automations run in. Ids not belonging to the conversation are ignored;
 * bindings the caller left out keep their relative order behind the ones it
 * listed, so a stale UI list cannot drop a binding out of the rotation.
 */
export function reorderCoachAutomationBindings(
  sessionId: string,
  bindingIds: string[],
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding[] {
  const rows = database.listBindingsForSession(sessionId);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const ordered: CoachAutomationBindingRow[] = [];
  const seen = new Set<string>();
  for (const id of bindingIds) {
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
      database.updateBinding({ ...row, sort_order: index });
    }
  });

  return listCoachAutomationBindingsForSession(sessionId, database);
}

/**
 * Repoints a binding at another conversation — used both when the athlete
 * fixes a broken `existing` binding and when a `dedicated` binding rebuilds
 * its conversation after the athlete deleted it. Re-enables the binding,
 * since a repoint is the fix for having been disabled.
 */
export function setCoachAutomationBindingSession(
  bindingId: string,
  sessionId: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding | null {
  const row = database.getBinding(bindingId);
  if (!row) {
    return null;
  }
  if (row.mode === "per-run") {
    throw new CoachAutomationBindingError(
      "BINDING_SESSION_NOT_ALLOWED",
      "A per-run binding creates its own conversation and cannot target one."
    );
  }

  const target = optionalText(sessionId);
  if (!target) {
    throw new CoachAutomationBindingError(
      "BINDING_SESSION_REQUIRED",
      `A "${row.mode}" binding needs a conversation to write into.`
    );
  }

  if (target !== row.session_id) {
    const siblings = database.listBindingsForSession(target);
    if (siblings.some((entry) => entry.automation_id === row.automation_id)) {
      throw new CoachAutomationBindingError(
        "BINDING_DUPLICATE",
        "This automation is already attached to that conversation."
      );
    }
    if (siblings.length >= MAX_BINDINGS_PER_SESSION) {
      throw new CoachAutomationBindingError(
        "BINDING_LIMIT_REACHED",
        `A conversation can run at most ${MAX_BINDINGS_PER_SESSION} automations.`
      );
    }
    const sortOrder = siblings.reduce(
      (highest, entry) => Math.max(highest, entry.sort_order + 1),
      0
    );
    database.updateBinding({
      ...row,
      session_id: target,
      sort_order: sortOrder,
      enabled: 1
    });
  } else {
    database.updateBinding({ ...row, enabled: 1 });
  }

  const nextRow = database.getBinding(bindingId);
  return nextRow ? toBinding(nextRow) : null;
}

/**
 * Stamps the clocks a binding keeps for itself: the scheduler's last/next slots
 * (3.1), the activity watermark (3.2) and the failure backoff (10). Every key
 * is optional and an absent one is left alone, so a caller that only knows one
 * of them never has to read the row first.
 */
export function setCoachAutomationBindingSchedule(
  bindingId: string,
  schedule: {
    lastRunAt?: string | null;
    nextRunAt?: string | null;
    lastActivityAt?: number | null;
    backoffUntil?: string | null;
    backoffLevel?: number | null;
    /** 3.3: null resets a binding to "never evaluated". */
    thresholdFiring?: boolean | null;
  },
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding | null {
  const row = database.getBinding(bindingId);
  if (!row) {
    return null;
  }
  database.updateBinding({
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
  const nextRow = database.getBinding(bindingId);
  return nextRow ? toBinding(nextRow) : null;
}

/**
 * Section 2.4, the two conversation-deleted rows. An `existing` binding is
 * disabled — only the athlete knows which thread it should point at now — while
 * a `dedicated` binding stays enabled and is reported as needing a fresh
 * conversation, which the runner creates on the next run.
 *
 * The stale `session_id` is deliberately left in place on `dedicated`
 * bindings: clearing it would make the row look like a `per-run` binding to
 * `idx_binding_unique_per_run` and could collide with a real one.
 */
export function applyCoachAutomationSessionDeleted(
  sessionId: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationSessionDeletionReport {
  const report: CoachAutomationSessionDeletionReport = {
    disabled: [],
    needsSession: []
  };

  for (const row of database.listBindingsForSession(sessionId)) {
    if (row.mode === "dedicated") {
      report.needsSession.push(toBinding(row));
      continue;
    }
    if (row.enabled === 1) {
      database.updateBinding({ ...row, enabled: 0 });
    }
    const nextRow = database.getBinding(row.id);
    report.disabled.push(toBinding(nextRow ?? { ...row, enabled: 0 }));
  }

  return report;
}

/**
 * Bindings that should actually run right now: enabled, on an enabled
 * definition. Section 2.4's "automation disabled → all bindings stop" lives
 * here rather than in a write, so re-enabling a definition brings its bindings
 * back exactly as they were.
 */
export function listActiveCoachAutomationBindings(
  automationId: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationBinding[] {
  const automation = getCoachAutomation(automationId, database);
  if (!automation || !automation.enabled) {
    return [];
  }
  return listCoachAutomationBindings(automationId, database).filter(
    (binding) => binding.enabled
  );
}

/** Automations attached to one conversation, for the "5 max" UI affordance. */
export function countCoachAutomationBindingsForSession(
  sessionId: string,
  database: CoachAutomationDatabase = defaultDatabase
): number {
  return database.listBindingsForSession(sessionId).length;
}

// --- Runs -------------------------------------------------------------------

const RUN_STATUSES = new Set<CoachAutomationRunStatus>([
  "running",
  "success",
  "silent",
  "skipped",
  "failed",
  "cancelled"
]);

const RUN_TRIGGER_KINDS = new Set<AutomationTriggerKind>([
  "schedule",
  "activity",
  "threshold",
  "manual"
]);

function toRun(row: CoachAutomationRunRow): CoachAutomationRun {
  const run: CoachAutomationRun = {
    id: row.id,
    automationId: row.automation_id,
    bindingId: row.binding_id,
    status: RUN_STATUSES.has(row.status as CoachAutomationRunStatus)
      ? (row.status as CoachAutomationRunStatus)
      : "failed",
    triggerKind: RUN_TRIGGER_KINDS.has(row.trigger_kind as AutomationTriggerKind)
      ? (row.trigger_kind as AutomationTriggerKind)
      : "manual",
    startedAt: row.started_at
  };

  const payload = parseJson(row.trigger_payload_json);
  if (isRecord(payload)) {
    run.triggerPayload = payload;
  }
  const optionals: Array<[keyof CoachAutomationRun, string | null]> = [
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

function toRunRow(run: CoachAutomationRun): CoachAutomationRunRow {
  return {
    id: run.id,
    automation_id: run.automationId,
    binding_id: run.bindingId,
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

export type CoachAutomationRunInput = Omit<CoachAutomationRun, "id" | "startedAt"> &
  Partial<Pick<CoachAutomationRun, "id" | "startedAt">>;

/**
 * Every run is logged, including the silent and skipped ones. An automation
 * that quietly does nothing is otherwise indistinguishable from a broken one.
 */
export function recordCoachAutomationRun(
  input: CoachAutomationRunInput,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationRun {
  const run: CoachAutomationRun = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    startedAt: input.startedAt ?? new Date().toISOString()
  };
  database.insertRun(toRunRow(run));
  const row = database.getRun(run.id);
  if (!row) {
    throw new Error("Failed to record coach automation run.");
  }
  return toRun(row);
}

export function updateCoachAutomationRun(
  id: string,
  patch: Partial<Omit<CoachAutomationRun, "id" | "automationId" | "bindingId">>,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationRun | null {
  const row = database.getRun(id);
  if (!row) {
    return null;
  }
  database.updateRun(toRunRow({ ...toRun(row), ...patch }));
  const nextRow = database.getRun(id);
  return nextRow ? toRun(nextRow) : null;
}

export function getCoachAutomationRun(
  id: string,
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationRun | null {
  const row = database.getRun(id);
  return row ? toRun(row) : null;
}

export function listCoachAutomationRuns(
  filter: CoachAutomationRunQuery = {},
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationRun[] {
  return database.listRuns(filter).map((row) => toRun(row));
}

/**
 * Section 10: a run that was in flight when the app quit stays `running`
 * forever, because nothing is left to finish it. Reconciled once at startup so
 * the run log never shows a spinner for a process that no longer exists.
 */
export function cancelStaleCoachAutomationRuns(
  database: CoachAutomationDatabase = defaultDatabase
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
export function markCoachAutomationRunsSeen(
  ids: string[],
  database: CoachAutomationDatabase = defaultDatabase
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
const ATTENTION_STATUSES: CoachAutomationRunStatus[] = ["success", "silent"];

/**
 * What the conversation list needs to know, in one pass: which conversations a
 * coach can speak into, and which of them have said something unread.
 */
export function listCoachAutomationSessionAttention(
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationSessionAttention[] {
  const attention = new Map<string, CoachAutomationSessionAttention>();
  const entry = (sessionId: string): CoachAutomationSessionAttention => {
    const existing = attention.get(sessionId);
    if (existing) {
      return existing;
    }
    const created = { sessionId, attached: false, unread: 0 };
    attention.set(sessionId, created);
    return created;
  };

  for (const automation of listCoachAutomations(database)) {
    if (!automation.enabled) {
      continue;
    }
    for (const binding of listCoachAutomationBindings(automation.id, database)) {
      // A "per-run" binding has no conversation of its own to mark, and a
      // binding switched off is not going to speak.
      if (binding.enabled && binding.sessionId) {
        entry(binding.sessionId).attached = true;
      }
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
export function markCoachAutomationSessionSeen(
  sessionId: string,
  database: CoachAutomationDatabase = defaultDatabase
): number {
  const unread = database.listRuns({
    sessionId,
    statuses: ATTENTION_STATUSES,
    unseenOnly: true
  });
  return markCoachAutomationRunsSeen(
    unread.map((row) => row.id),
    database
  );
}

/**
 * The list screen's projection: how many places each definition runs in (the
 * cost hint from 2.3), what it last did, and when it next will.
 */
export function listCoachAutomationSummaries(
  database: CoachAutomationDatabase = defaultDatabase
): CoachAutomationSummary[] {
  return listCoachAutomations(database).map((automation) => {
    const bindings = listCoachAutomationBindings(automation.id, database);
    const [lastRun] = listCoachAutomationRuns(
      { automationId: automation.id, limit: 1 },
      database
    );
    const nextRunAt = bindings
      .map((binding) => binding.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0];

    const summary: CoachAutomationSummary = {
      automation,
      bindingCount: bindings.length,
      enabledBindingCount: bindings.filter((binding) => binding.enabled).length
    };
    if (lastRun) {
      summary.lastRun = lastRun;
    }
    if (nextRunAt) {
      summary.nextRunAt = nextRunAt;
    }
    return summary;
  });
}
