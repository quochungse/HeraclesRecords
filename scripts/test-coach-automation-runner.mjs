import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

// The runner pulls in electron and the better-sqlite3 native binding through
// chatService/database at require time, neither of which loads under plain
// node. Every real collaborator is injected per call, so the stubs are only
// needed to get the module loaded.
const fakeElectron = {
  BrowserWindow: Object.assign(class {}, { getAllWindows: () => [] }),
  app: { getPath: () => "/tmp", on: () => {}, whenReady: () => Promise.resolve() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: () => {} }
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === "electron") return fakeElectron;
  if (request === "better-sqlite3") return class FakeDatabase {};
  return originalLoad.call(this, request, ...rest);
};

const {
  AUTOMATION_BACKOFF_STEPS_MS,
  isOverBudget,
  startOfLocalMonth,
  AUTOMATION_CONTEXT_KEEP,
  AUTOMATION_CONTEXT_LIMIT,
  buildRollingSummaryTurn,
  planTranscriptContext,
  summaryContextMessage,
  checkProviderAuth,
  getAutomationPause,
  resumeAutomations,
  AUTOMATION_OUTPUT_CONTRACT,
  AUTOMATION_DEFAULT_EFFORT,
  NOTHING_TO_REPORT,
  cancelAutomationRun,
  resolveAutomationRuntime,
  SESSION_BURST_PER_HOUR,
  expandTriggerToQueue,
  isWithinQuietHours,
  MULTI_ACTIVITY_MAX_PER_TRIGGER,
  parseAutomationOutput,
  renderAutomationTemplate,
  resetAutomationQueueForTests,
  runAutomationNow,
  runAutomationTrigger
} = require(path.join(repoRoot, "dist-electron", "coachAutomationService.js"));

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// --- output contract (5.5) --------------------------------------------------
// Line 1 is the headline, with no label to find: the contract stopped asking
// for one, so nothing has to be taken back out of the athlete's transcript.
assert.deepEqual(parseAutomationOutput("Load is ramping fast.\nMore detail."), {
  silent: false,
  summary: "Load is ramping fast."
});
assert.equal(
  parseAutomationOutput("**Bolded by the model**\n- detail").summary,
  "Bolded by the model",
  "emphasis is stripped from the badge, not from the conversation"
);
assert.equal(
  parseAutomationOutput(`${"x".repeat(300)}\nmore`).summary.length,
  140,
  "the summary is capped for the badge"
);
assert.deepEqual(parseAutomationOutput("Just some prose.\nSecond line."), {
  silent: false,
  summary: "Just some prose."
});

// Rule 2 tells the model what the first line is *for*, so the first line is
// simply read. No list of markdown constructs to skip — the single guard is
// that a line with no letters in it is not a sentence.
assert.equal(
  parseAutomationOutput("**Load is flat.**\n- Sleep is short.").summary,
  "Load is flat.",
  "markup is trimmed off both ends"
);
assert.equal(
  parseAutomationOutput("# Week in review\nLoad is flat.").summary,
  "Week in review"
);
assert.equal(
  parseAutomationOutput("---\n\n***\n\nRamp is steady.").summary,
  "Ramp is steady.",
  "a line with no letters is not a sentence, whatever syntax produced it"
);
assert.equal(
  parseAutomationOutput("| 33 | 412 |\nRamp is steady.").summary,
  "Ramp is steady.",
  "and that covers a numeric table row without naming tables"
);
// The trade-off this buys simplicity with: a model that ignores rule 2 and
// opens with a labelled table gets a poor row rather than a rescued one. The
// prompt is where that is prevented, not the parser.
assert.equal(
  parseAutomationOutput("| Week | Load |\n| --- | --- |\n\nRamp is steady.").summary,
  "| Week | Load |"
);
// Nothing but markup: something beats an empty row.
assert.equal(parseAutomationOutput("---").summary, "");

// The contract must stay additive, and must explain rather than enumerate.
assert.doesNotMatch(AUTOMATION_OUTPUT_CONTRACT, /observation|recommended action/i);
assert.doesNotMatch(
  AUTOMATION_OUTPUT_CONTRACT,
  /no heading|no bullet|no table/i,
  "prohibitions only teach the model about the cases someone thought of"
);
assert.match(AUTOMATION_OUTPUT_CONTRACT, /do\s*\n?not replace it/i);
assert.match(
  AUTOMATION_OUTPUT_CONTRACT,
  /shows that line on its own/i,
  "rule 2 gives the reason, which is what generalises"
);

// The silent marker is still a marker: it is what keeps a run that found
// nothing out of the athlete's conversation.
assert.deepEqual(parseAutomationOutput(NOTHING_TO_REPORT), { silent: true });
assert.deepEqual(parseAutomationOutput(`  ${NOTHING_TO_REPORT}\n`), { silent: true });
assert.deepEqual(
  parseAutomationOutput(`Nothing stands out.\n${NOTHING_TO_REPORT}`),
  { silent: true },
  "the marker still counts when the model adds preamble"
);
assert.deepEqual(parseAutomationOutput("`NOTHING_TO_REPORT`"), { silent: true });
assert.deepEqual(parseAutomationOutput(""), { silent: true });
assert.deepEqual(parseAutomationOutput("   \n  "), { silent: true });
// A sentence merely mentioning the marker is a real report, not silence.
assert.equal(
  parseAutomationOutput("I would have said NOTHING_TO_REPORT but load spiked.").silent,
  false
);
assert.match(AUTOMATION_OUTPUT_CONTRACT, new RegExp(NOTHING_TO_REPORT));

// --- the marker never reaches the athlete ----------------------------------
// It decides silent-vs-success and is not prose. The runner keeps it out of the
// transcript by persisting a one-line trace instead of anything the model
// wrote; the window has to keep it out of the live bubble too, where it arrives
// split across chunks. That second half lives in JSX, so it is asserted at the
// source level — the same trick test-ipc-surface.mjs uses for invariants
// TypeScript cannot see.
{
  const chatView = fs.readFileSync(
    path.join(repoRoot, "src", "chat", "ChatView.tsx"),
    "utf8"
  );
  assert.match(
    chatView,
    /NOTHING_TO_REPORT\.startsWith\(liveAutomation\.text\.trim\(\)\)/,
    "the live bubble must hold its text back while it could still be the marker"
  );
  assert.doesNotMatch(
    chatView,
    /content=\{liveAutomation\.text\}/,
    "the live bubble must render the guarded text, never the raw stream"
  );
  // The transcript trace replaced the toast that used to explain the bubble
  // disappearing. Both saying it would say it twice.
  assert.doesNotMatch(
    chatView,
    /found nothing new to report/,
    "the silent-run toast is retired by the transcript entry"
  );
  assert.match(
    chatView,
    /run\.status !== "success" && run\.status !== "silent"/,
    "a silent run must reload the transcript, like an answer does"
  );

  // The renderer rebuilds entries field by field in both directions. A missing
  // *branch* is a compile error, because the union has one; a missing *field*
  // is not, and would silently drop the timestamp on every reload.
  const chatTypes = fs.readFileSync(
    path.join(repoRoot, "src", "chat", "chatTypes.ts"),
    "utf8"
  );
  assert.equal(
    (
      chatTypes.match(
        /kind: "automationSilent",\s*automation: entry\.automation,\s*at: entry\.at/g
      ) ?? []
    ).length,
    2,
    "both chatTypes converters must carry the trace's marker and its timestamp"
  );

  // 5.6b: the window saves its whole timeline, so it has to tell the store how
  // much of the row that array accounts for. Without it, a save issued in the
  // moment between a run landing and the reload arriving deletes the answer.
  assert.match(
    chatView,
    /saveChatSession\(sessionId, persisted, \{ knownEntryCount \}\)/,
    "the window must declare what its array is based on when it saves"
  );
  // Advanced before the call, not in the reply: handlers run in send order, so
  // an earlier save's answer arriving late must not roll the base backwards.
  assert.match(
    chatView,
    /persistedBaseRef\.current = persisted\.length;\s*\n\s*void api/,
    "the base must advance at send time, not when the save replies"
  );
  assert.equal(
    (chatView.match(/persistedBaseRef\.current = entries\.length;/g) ?? []).length,
    2,
    "both paths that read the conversation from disk must re-base on it"
  );
  // A save waiting on the debounce holds the copy the reload is replacing. If
  // it fired afterwards it would write that copy back with a base that no
  // longer covers the run's entries, which is the loss the merge exists to
  // prevent — so the reload cancels it.
  assert.match(
    chatView,
    /if \(persistTimeoutRef\.current\) \{\s*\n\s*clearTimeout\(persistTimeoutRef\.current\);\s*\n\s*persistTimeoutRef\.current = null;\s*\n\s*\}\s*\n\s*persistedBaseRef\.current = entries\.length;/,
    "reloading the transcript must cancel a save still waiting on the debounce"
  );
}

// --- template rendering (2.5) ----------------------------------------------
assert.equal(
  renderAutomationTemplate("{{rule.name}} · {{activity.name}} · {{date}}", {
    rule: { name: "Debrief" },
    activity: { name: "Long run" },
    date: "2026-08-21"
  }),
  "Debrief · Long run · 2026-08-21"
);
assert.equal(
  renderAutomationTemplate("{{ week.range }} / {{activity.sport}}", {
    week: { range: "2026-08-16..2026-08-22" }
  }),
  "2026-08-16..2026-08-22 /",
  "an unknown variable collapses to nothing"
);
assert.equal(renderAutomationTemplate("{{nope}}", {}), "");

// --- quiet hours (4) --------------------------------------------------------
const at = (hh, mm) => new Date(2026, 7, 21, hh, mm, 0);
assert.equal(isWithinQuietHours(at(12, 0), undefined), false);
assert.equal(isWithinQuietHours(at(23, 0), { start: "22:00", end: "06:30" }), true);
assert.equal(isWithinQuietHours(at(3, 0), { start: "22:00", end: "06:30" }), true, "wraps midnight");
assert.equal(isWithinQuietHours(at(6, 30), { start: "22:00", end: "06:30" }), false, "end is exclusive");
assert.equal(isWithinQuietHours(at(12, 0), { start: "22:00", end: "06:30" }), false);
assert.equal(isWithinQuietHours(at(13, 0), { start: "09:00", end: "17:00" }), true);
assert.equal(isWithinQuietHours(at(13, 0), { start: "9am", end: "5pm" }), false, "junk is not a window");

// ---------------------------------------------------------------------------
// A world the runner can be driven against
// ---------------------------------------------------------------------------

function createWorld(overrides = {}) {
  const state = {
    now: new Date("2026-08-21T09:00:00.000Z"),
    automations: new Map(),
    bindings: new Map(),
    runs: [],
    sessions: new Map(), // id -> { title, entries }
    updates: [],
    streamCalls: [],
    corosResult: { ok: true },
    /**
     * Credentials on disk, which is a *different* fact from "a reconnect would
     * work". Collapsing the two into one field hid the case where they differ:
     * the gate finds no credentials and holds, and only the run's own reconnect
     * discovers COROS is reachable again.
     */
    corosOnDisk: true,
    // Guard rail 3's verdict for whatever provider a run asks about.
    providerAuth: { ok: true },
    /** Section 10's pause, and every write to it in order. */
    pause: null,
    pauseWrites: [],
    /** 12 (item 6): the month's ceiling and what the run log says was spent. */
    budget: null,
    monthToDateTokens: 0,
    /** How often each half of the budget check was asked. */
    budgetReads: 0,
    spendReads: 0,
    /** What the collector reports the turn cost; null is a silent provider. */
    usage: { inputTokens: 120, outputTokens: 45 },
    // What the scripted collector reports back for the next run.
    outcome: { text: "Load is ramping fast.\nEase off Thursday.", entries: null },
    concurrent: 0,
    maxConcurrent: 0,
    sessionOrder: [],
    activities: [],
    /** 5.7: sessionId -> { summary, through }, and every roll asked for. */
    summaries: new Map(),
    contextWindow: { limit: AUTOMATION_CONTEXT_LIMIT, keep: AUTOMATION_CONTEXT_KEEP },
    summaryWrites: [],
    rolls: [],
    /** What the summariser comes back with; null is a roll that failed. */
    rollResult: "Rolled summary.",
    /** What that roll cost. A roll is a provider turn and 13 counts it. */
    rollUsage: undefined,
    cancelledRunIds: []
  };

  let sessionSeq = 0;
  let runSeq = 0;

  const deps = {
    now: () => state.now,
    getAutomation: (id) => state.automations.get(id) ?? null,
    listBindings: (automationId) =>
      [...state.bindings.values()]
        .filter((binding) => binding.automationId === automationId)
        .map((binding) => ({ ...binding })),
    getBinding: (id) => {
      const binding = state.bindings.get(id);
      return binding ? { ...binding } : null;
    },
    setBindingSchedule: (bindingId, schedule) => {
      const binding = state.bindings.get(bindingId);
      if (!binding) return;
      if (schedule.lastRunAt !== undefined) binding.lastRunAt = schedule.lastRunAt;
      if (schedule.nextRunAt !== undefined) binding.nextRunAt = schedule.nextRunAt;
      if (schedule.lastActivityAt !== undefined) {
        binding.lastActivityAt = schedule.lastActivityAt ?? undefined;
      }
      if (schedule.backoffUntil !== undefined) {
        binding.backoffUntil = schedule.backoffUntil ?? undefined;
      }
      // Level 0 reads back as absent, the way the real row does: the store only
      // surfaces a level above zero, and a fake that kept the 0 would let
      // `applyBackoff` see a streak where the database shows none.
      if (schedule.backoffLevel !== undefined) {
        binding.backoffLevel = schedule.backoffLevel || undefined;
      }
    },
    setBindingSession: (bindingId, sessionId) => {
      state.bindings.get(bindingId).sessionId = sessionId;
    },
    setBindingEnabled: (bindingId, enabled) => {
      state.bindings.get(bindingId).enabled = enabled;
    },
    listRuns: (filter) =>
      state.runs.filter((run) => {
        if (filter.bindingId && run.bindingId !== filter.bindingId) return false;
        if (filter.sessionId && run.sessionId !== filter.sessionId) return false;
        if (filter.since && run.startedAt < filter.since) return false;
        if (filter.statuses && !filter.statuses.includes(run.status)) return false;
        return true;
      }),
    listActivitiesAfter: (after, limit) =>
      state.activities
        .filter(
          (row) =>
            row.start_time !== null &&
            (after === undefined || row.start_time > after)
        )
        .sort((left, right) => left.start_time - right.start_time)
        .slice(-limit)
        .map((row) => ({ ...row })),
    recordRun: (input) => {
      runSeq += 1;
      const run = {
        ...input,
        id: input.id ?? `run-${runSeq}`,
        startedAt: input.startedAt ?? state.now.toISOString()
      };
      state.runs.push(run);
      return { ...run };
    },
    updateRun: (id, patch) => {
      const run = state.runs.find((entry) => entry.id === id);
      if (!run) return null;
      Object.assign(run, patch);
      return { ...run };
    },
    getSessionEntries: (sessionId) => {
      const session = state.sessions.get(sessionId);
      return session ? [...session.entries] : undefined;
    },
    getSessionSummary: (sessionId) =>
      state.summaries.get(sessionId) ?? { through: 0 },
    // The window is a chat setting now, shared with the interactive coach, and
    // the default dep reads it out of SQLite. Injected here for the same reason
    // getChatProvider is: this suite has no database.
    getContextWindow: () => ({ ...state.contextWindow }),
    setSessionSummary: (sessionId, summary, through) => {
      state.summaries.set(sessionId, { summary, through });
      state.summaryWrites.push({ sessionId, summary, through });
    },
    rollSummary: async (previous, entries, runtime) => {
      state.rolls.push({ previous, count: entries.length, runtime });
      return {
        summary: state.rollResult,
        ...(state.rollUsage ? { usage: state.rollUsage } : {})
      };
    },
    createSession: () => {
      sessionSeq += 1;
      const id = `session-new-${sessionSeq}`;
      state.sessions.set(id, { title: "New chat", entries: [] });
      return id;
    },
    saveSession: (sessionId, entries) => {
      state.sessions.get(sessionId).entries = entries;
    },
    setSessionTitle: (sessionId, title) => {
      state.sessions.get(sessionId).title = title;
    },
    getChatProvider: () => "claude-code",
    checkProviderAuth: () => state.providerAuth,
    ensureCorosSession: async () => state.corosResult,
    corosAuthenticated: () => state.corosOnDisk,
    getBudget: () => {
      state.budgetReads += 1;
      return state.budget;
    },
    getMonthToDateTokens: () => {
      state.spendReads += 1;
      return state.monthToDateTokens;
    },
    getPause: () => state.pause,
    setPause: (pause) => {
      state.pause = pause;
      state.pauseWrites.push(pause);
    },
    createCollector: (marker) => {
      const outcome = state.outcome;
      const entries =
        outcome.entries ??
        (outcome.text
          ? [{ kind: "message", role: "assistant", content: outcome.text }]
          : []);
      return {
        emit: () => {},
        entries: () => entries.map((entry) => ({ ...entry })),
        finished: () => true,
        cancelled: () => outcome.cancelled === true,
        error: () => outcome.error,
        authError: () => outcome.authError === true,
        text: () => outcome.text ?? "",
        usage: () => state.usage ?? undefined,
        marker
      };
    },
    streamChat: async (sink, runId, messages, options) => {
      state.concurrent += 1;
      state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
      state.streamCalls.push({ runId, messages, options });
      if (state.outcome.throws) {
        state.concurrent -= 1;
        throw new Error(state.outcome.throws);
      }
      // Yield so a second run would interleave here if the queue let it.
      await new Promise((resolve) => setImmediate(resolve));
      state.concurrent -= 1;
    },
    emitRunUpdate: (run) => {
      state.updates.push({ id: run.id, status: run.status });
    },
    cancelRun: (runId) => {
      state.cancelledRunIds.push(runId);
    },
    idleTimeoutMs: 60_000,
    ...overrides
  };

  state.deps = deps;
  return state;
}

function addAutomation(world, id, patch = {}) {
  const automation = {
    id,
    name: `Automation ${id}`,
    playbook: "Summarise yesterday for {{date}}.",
    enabled: true,
    trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:30" },
    conditions: { cooldownMin: 120, maxRunsPerDay: 3 },
    runtime: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch
  };
  world.automations.set(id, automation);
  return automation;
}

function addBinding(world, id, patch = {}) {
  const binding = {
    id,
    automationId: "a1",
    mode: "existing",
    sessionId: "s1",
    enabled: true,
    sortOrder: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...patch
  };
  world.bindings.set(id, binding);
  return binding;
}

const RUNNER_NOW_EPOCH = Math.floor(Date.parse("2026-08-21T09:00:00.000Z") / 1000);

/** `daysAgo` is measured from the world clock, so the fixtures read as dates. */
function addActivity(world, id, daysAgo, patch = {}) {
  const row = {
    activity_id: id,
    name: `Activity ${id}`,
    sport_type: 100,
    sport_name: "Run",
    start_time: RUNNER_NOW_EPOCH - Math.round(daysAgo * 86_400),
    duration: 3600,
    distance: 12000,
    ...patch
  };
  world.activities.push(row);
  return row;
}

function addSession(world, id, entries = []) {
  world.sessions.set(id, { title: "Existing chat", entries });
}

// ---------------------------------------------------------------------------
// 2.3 fan-out and ordering
// ---------------------------------------------------------------------------

{
  const world = createWorld();
  addAutomation(world, "a1");
  addSession(world, "sA");
  addSession(world, "sB");
  addBinding(world, "b-late", { sessionId: "sB", sortOrder: 0 });
  addBinding(world, "b-second", { sessionId: "sA", sortOrder: 5 });
  addBinding(world, "b-first", { sessionId: "sA", sortOrder: 1 });
  addBinding(world, "b-off", { sessionId: "sB", sortOrder: 9, enabled: false });

  const queue = expandTriggerToQueue(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.deepEqual(
    queue.map((entry) => entry.binding.id),
    ["b-first", "b-second", "b-late"],
    "ordered by session then sort_order; the disabled binding is not queued"
  );

  // A disabled automation fans out to nothing at all.
  world.automations.get("a1").enabled = false;
  assert.deepEqual(expandTriggerToQueue({ automationId: "a1", kind: "schedule" }, world.deps), []);
  world.automations.get("a1").enabled = true;
  assert.deepEqual(expandTriggerToQueue({ automationId: "missing", kind: "schedule" }, world.deps), []);

  // bindingIds narrows the fan-out (manual run against one place).
  assert.deepEqual(
    expandTriggerToQueue(
      { automationId: "a1", kind: "manual", bindingIds: ["b-second"] },
      world.deps
    ).map((entry) => entry.binding.id),
    ["b-second"]
  );
}

// ---------------------------------------------------------------------------
// Serialization: same-conversation runs never overlap
// ---------------------------------------------------------------------------

{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: { cooldownMin: 0, maxRunsPerDay: 9 } });
  addSession(world, "sA");
  addBinding(world, "b1", { sessionId: "sA", sortOrder: 0 });
  addBinding(world, "b2", { sessionId: "sA", sortOrder: 1 });
  addBinding(world, "b3", { sessionId: "sA", sortOrder: 2 });

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(runs.length, 3);
  assert.equal(world.maxConcurrent, 1, "runs against one conversation are serialized");
  assert.deepEqual(
    world.streamCalls.map((call) => call.runId),
    runs.map((run) => run.id),
    "and execute in sort_order"
  );
  // Each later run sees the earlier one's message in its context (2.3).
  assert.ok(
    world.streamCalls[2].messages.length > world.streamCalls[0].messages.length,
    "a later coach sees what the earlier one wrote"
  );
}

// ---------------------------------------------------------------------------
// The happy path: options, persistence and attribution
// ---------------------------------------------------------------------------

{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    name: "Morning briefing",
    role: "Strict marathon coach",
    runtime: { model: "claude-opus-5", effort: "low" }
  });
  addSession(world, "s1", [
    { kind: "message", role: "user", content: "Hi" },
    { kind: "message", role: "assistant", content: "Hello" }
  ]);
  addBinding(world, "b1", { sessionId: "s1" });

  const [run] = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );

  assert.equal(run.status, "success");
  assert.equal(run.summary, "Load is ramping fast.");
  assert.equal(run.sessionId, "s1");
  assert.equal(run.model, "claude-opus-5");
  assert.equal(run.effort, "low");
  assert.ok(run.finishedAt);

  // streamChat is told this is a read-only run carrying the automation's role.
  const call = world.streamCalls[0];
  assert.equal(call.runId, run.id);
  assert.equal(call.options.toolPolicy, "read-only");
  assert.equal(call.options.roleInstructions, "Strict marathon coach");
  assert.deepEqual(call.options.runtime, { model: "claude-opus-5", effort: "low" });

  // Section 7: an explicit effort is honoured as written.
  assert.equal(AUTOMATION_DEFAULT_EFFORT, "low");

  // The conversation's history is replayed, then the rendered playbook.
  assert.equal(call.messages.length, 3);
  assert.deepEqual(call.messages.slice(0, 2), [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" }
  ]);
  const playbook = call.messages[2];
  assert.equal(playbook.role, "user");
  assert.match(playbook.content, /Summarise yesterday for 2026-08-21\./);
  assert.ok(playbook.content.endsWith(AUTOMATION_OUTPUT_CONTRACT));

  // Persistence: existing entries, the synthetic user turn, then the answer.
  const saved = world.sessions.get("s1").entries;
  assert.equal(saved.length, 4);
  assert.deepEqual(saved.slice(0, 2), [
    { kind: "message", role: "user", content: "Hi" },
    { kind: "message", role: "assistant", content: "Hello" }
  ]);
  const marker = {
    runId: run.id,
    automationId: "a1",
    bindingId: "b1",
    name: "Morning briefing",
    triggerLabel: "Daily at 07:30"
  };
  assert.equal(saved[2].role, "user");
  assert.equal(saved[2].content, playbook.content);
  assert.deepEqual(saved[2].automation, marker, "the synthetic turn is attributed");
  assert.equal(saved[3].role, "assistant");
  assert.deepEqual(saved[3].automation, marker, "so is the answer");

  // The binding's clock advanced, and the renderer saw start then finish.
  assert.equal(world.bindings.get("b1").lastRunAt, world.now.toISOString());
  assert.deepEqual(world.updates, [
    { id: run.id, status: "running" },
    { id: run.id, status: "success" }
  ]);
}

// ---------------------------------------------------------------------------
// NOTHING_TO_REPORT
// ---------------------------------------------------------------------------

{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { text: NOTHING_TO_REPORT };
  addAutomation(world, "a1");
  addSession(world, "s1", [{ kind: "message", role: "user", content: "Hi" }]);
  addBinding(world, "b1", { sessionId: "s1" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.status, "silent");
  assert.equal(run.summary, undefined, "a silent run carries no badge text");

  // Nothing the model wrote is persisted — the answer was a control token. What
  // lands is the trace of 5.5, so the conversation records that the coach ran.
  const entries = world.sessions.get("s1").entries;
  assert.equal(entries.length, 2, "the athlete's turn is kept, one trace is added");
  assert.deepEqual(entries[0], { kind: "message", role: "user", content: "Hi" });
  assert.equal(entries[1].kind, "automationSilent");
  assert.equal(entries[1].at, world.now.getTime(), "the trace records when it looked");
  assert.equal(entries[1].automation.runId, run.id);
  assert.equal(entries[1].automation.name, world.automations.get("a1").name);
  assert.equal(
    JSON.stringify(entries).includes(NOTHING_TO_REPORT),
    false,
    "and the marker itself never reaches the transcript"
  );

  assert.equal(world.runs.length, 1, "the run is still logged");
  assert.equal(world.bindings.get("b1").lastRunAt, world.now.toISOString());
}

// The trace appends to the conversation as it stands now, not to the snapshot
// taken before the stream — same hazard as a reported answer has.
{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { text: NOTHING_TO_REPORT };
  addAutomation(world, "a1");
  addSession(world, "s1", [{ kind: "message", role: "user", content: "before" }]);
  addBinding(world, "b1", { sessionId: "s1" });

  const original = world.deps.streamChat;
  world.deps.streamChat = async (...args) => {
    world.sessions.get("s1").entries.push({
      kind: "message",
      role: "user",
      content: "typed mid-run"
    });
    return original(...args);
  };

  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.deepEqual(
    world.sessions.get("s1").entries.map((entry) => entry.content ?? entry.kind),
    ["before", "typed mid-run", "automationSilent"],
    "the athlete's turn is not deleted by the trace's append"
  );
}

// --- section 7: silence means `low`, whatever the trigger ------------------
// The editor renders `runtime.effort ?? "low"`, so a definition saved without
// touching that control showed `low`. Before this default it then ran at the
// interactive chat's effort, and the run log recorded nothing at all.
{
  for (const trigger of [
    { kind: "activity", sportTypes: [] },
    { kind: "schedule", cadence: "daily", timeOfDay: "07:00" },
    { kind: "schedule", cadence: "weekly", dayOfWeek: 0, timeOfDay: "18:00" },
    { kind: "manual" }
  ]) {
    resetAutomationQueueForTests();
    const world = createWorld();
    addAutomation(world, "a1", { trigger, runtime: { model: "claude-opus-5" } });
    addSession(world, "s1");
    addBinding(world, "b1", { sessionId: "s1" });
    // Ignored by every trigger but the activity one, which otherwise has
    // nothing to analyse and skips before it reaches the provider.
    addActivity(world, "t1", 1);

    const [run] = await runAutomationTrigger(
      { automationId: "a1", kind: "manual", bypassGuards: true },
      world.deps
    );
    const label = `${trigger.kind}/${trigger.cadence ?? "-"}`;
    assert.equal(run.status, "success", label);
    assert.deepEqual(
      world.streamCalls[0].options.runtime,
      { model: "claude-opus-5", effort: AUTOMATION_DEFAULT_EFFORT },
      `${label}: the run must use the default, not the chat's effort`
    );
    assert.equal(
      run.effort,
      AUTOMATION_DEFAULT_EFFORT,
      `${label}: and the run log must record what it actually used`
    );
    // The definition is untouched: the default is resolved at run time, so the
    // athlete's blank stays blank and follows the default if it ever changes.
    assert.equal(world.automations.get("a1").runtime.effort, undefined, label);
  }

  // resolveAutomationRuntime is the one place that decision lives.
  assert.deepEqual(
    resolveAutomationRuntime({ runtime: {} }),
    { effort: AUTOMATION_DEFAULT_EFFORT }
  );
  assert.deepEqual(
    resolveAutomationRuntime({ runtime: { effort: "high", model: "m" } }),
    { effort: "high", model: "m" },
    "an explicit effort is never overridden"
  );
}

// ---------------------------------------------------------------------------
// Session resolution (2.1 / 2.4)
// ---------------------------------------------------------------------------

{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { name: "Debrief" });
  addBinding(world, "b1", {
    mode: "per-run",
    sessionId: null,
    titleTemplate: "{{rule.name}} · {{activity.name}}"
  });

  const [run] = await runAutomationTrigger(
    {
      automationId: "a1",
      kind: "activity",
      payload: { activityName: "Long run", activitySport: "run" }
    },
    world.deps
  );
  assert.equal(run.status, "success");
  const created = world.sessions.get(run.sessionId);
  assert.equal(created.title, "Debrief · Long run");
  assert.equal(created.entries.length, 2, "a fresh conversation holds only this run");
  assert.equal(
    world.bindings.get("b1").sessionId,
    null,
    "a per-run binding never adopts the conversation it created"
  );
  assert.deepEqual(run.triggerPayload, { activityName: "Long run", activitySport: "run" });
}

{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { name: "Daily briefing" });
  // The athlete deleted the conversation this dedicated binding wrote into.
  addBinding(world, "b1", { mode: "dedicated", sessionId: "s-gone" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.status, "success");
  assert.notEqual(run.sessionId, "s-gone");
  assert.equal(world.sessions.get(run.sessionId).title, "Daily briefing");
  assert.equal(
    world.bindings.get("b1").sessionId,
    run.sessionId,
    "the dedicated binding is repointed at the conversation it rebuilt"
  );
  assert.equal(world.bindings.get("b1").enabled, true);
}

{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1");
  addBinding(world, "b1", { mode: "existing", sessionId: "s-gone" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.status, "skipped");
  assert.equal(run.skipReason, "missing-session");
  assert.equal(
    world.bindings.get("b1").enabled,
    false,
    "an existing binding is disabled for the athlete to re-point"
  );
  assert.equal(world.streamCalls.length, 0, "no model call was made");
}

// ---------------------------------------------------------------------------
// Guard rails (4), in order
// ---------------------------------------------------------------------------

async function runWith(configure) {
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1" });
  configure(world);
  const [run] = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule", ...(world.event ?? {}) },
    world.deps
  );
  return { world, run };
}

// 1. the automation was switched off between queue and run
{
  const { world, run } = await runWith((w) => {
    const original = w.deps.getAutomation;
    let calls = 0;
    w.deps.getAutomation = (id) => {
      calls += 1;
      const automation = original(id);
      // First call is the fan-out; the re-check inside the run sees it off.
      return calls > 1 ? { ...automation, enabled: false } : automation;
    };
  });
  assert.equal(run.status, "skipped");
  assert.equal(run.skipReason, "disabled");
  assert.equal(world.streamCalls.length, 0);
}

// 3. provider not authenticated
{
  const { run } = await runWith((w) => {
    w.providerAuth = { ok: false, reason: "ChatGPT is not signed in." };
  });
  assert.equal(run.skipReason, "no-auth");
  assert.equal(run.sessionId, "s1", "the resolved session is still recorded");
}

// 4. COROS unusable / 2FA
{
  const offline = await runWith((w) => {
    w.corosResult = { ok: false, twoFactorRequired: false };
  });
  assert.equal(offline.run.skipReason, "offline");

  const twoFactor = await runWith((w) => {
    w.corosResult = { ok: false, twoFactorRequired: true };
  });
  assert.equal(twoFactor.run.skipReason, "two-factor-required");
  assert.equal(twoFactor.world.streamCalls.length, 0);
}

// 5. quiet hours
{
  const { run } = await runWith((w) => {
    w.automations.get("a1").conditions.quietHours = { start: "00:00", end: "23:59" };
  });
  assert.equal(run.skipReason, "quiet-hours");
}

// 6. cooldown
{
  const { run } = await runWith((w) => {
    w.bindings.get("b1").lastRunAt = new Date(
      w.now.getTime() - 30 * 60_000
    ).toISOString();
  });
  assert.equal(run.skipReason, "cooldown", "30min since the last run, cooldown is 120min");

  const elapsed = await runWith((w) => {
    w.bindings.get("b1").lastRunAt = new Date(
      w.now.getTime() - 180 * 60_000
    ).toISOString();
  });
  assert.equal(elapsed.run.status, "success", "past the cooldown it runs");
}

// 7. maxRunsPerDay
{
  const { run } = await runWith((w) => {
    for (let index = 0; index < 3; index += 1) {
      w.runs.push({
        id: `earlier-${index}`,
        automationId: "a1",
        bindingId: "b1",
        status: "success",
        triggerKind: "schedule",
        sessionId: "s1",
        startedAt: new Date(w.now.getTime() - 60_000 * (index + 1)).toISOString()
      });
    }
  });
  assert.equal(run.skipReason, "budget");
}

// A skipped run does not consume the daily budget.
{
  const { run } = await runWith((w) => {
    for (let index = 0; index < 5; index += 1) {
      w.runs.push({
        id: `skipped-${index}`,
        automationId: "a1",
        bindingId: "b1",
        status: "skipped",
        triggerKind: "schedule",
        sessionId: "s1",
        startedAt: new Date(w.now.getTime() - 60_000).toISOString()
      });
    }
  });
  assert.equal(run.status, "success");
}

// 8. conversation burst guard (2.3)
{
  const { run } = await runWith((w) => {
    w.automations.get("a1").conditions.maxRunsPerDay = 50;
    for (let index = 0; index < SESSION_BURST_PER_HOUR; index += 1) {
      w.runs.push({
        id: `other-${index}`,
        automationId: "other",
        bindingId: `other-b${index}`,
        status: "success",
        triggerKind: "schedule",
        sessionId: "s1",
        startedAt: new Date(w.now.getTime() - 60_000).toISOString()
      });
    }
  });
  assert.equal(run.skipReason, "burst", "five automation messages an hour is the cap");
}

// A run older than an hour does not count toward the burst guard.
{
  const { run } = await runWith((w) => {
    w.automations.get("a1").conditions.maxRunsPerDay = 50;
    for (let index = 0; index < SESSION_BURST_PER_HOUR; index += 1) {
      w.runs.push({
        id: `stale-${index}`,
        automationId: "other",
        bindingId: `other-b${index}`,
        status: "success",
        triggerKind: "schedule",
        sessionId: "s1",
        startedAt: new Date(w.now.getTime() - 3 * 3_600_000).toISOString()
      });
    }
  });
  assert.equal(run.status, "success");
}

// ---------------------------------------------------------------------------
// A skipped run must not leave an empty conversation behind
// ---------------------------------------------------------------------------
// Guard rail 2 only *checks* that a target is resolvable; the conversation is
// created after every guard passes. Creating it up front would litter the
// sidebar with an empty thread on every cooldown or offline skip, and the
// activity watcher polls every 15 minutes.

for (const [label, configure] of [
  ["not signed in", (w) => { w.providerAuth = { ok: false, reason: "ChatGPT is not signed in." }; }],
  ["COROS offline", (w) => { w.corosResult = { ok: false, twoFactorRequired: false }; }],
  ["quiet hours", (w) => {
    w.automations.get("a1").conditions.quietHours = { start: "00:00", end: "23:59" };
  }],
  ["cooldown", (w) => {
    w.bindings.get("b1").lastRunAt = new Date(w.now.getTime() - 60_000).toISOString();
  }]
]) {
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { name: "Debrief" });
  addBinding(world, "b1", {
    mode: "per-run",
    sessionId: null,
    titleTemplate: "{{rule.name}} · {{date}}"
  });
  configure(world);

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.equal(run.status, "skipped", `${label}: expected a skip`);
  assert.equal(
    world.sessions.size,
    0,
    `${label}: a skipped per-run binding created a conversation anyway`
  );
  assert.equal(run.sessionId, undefined, `${label}: skip recorded a session that was never made`);
}

// A dedicated binding whose conversation was deleted does not rebuild it just
// to skip: the rebuild happens on a run that actually reaches the provider.
{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.providerAuth = { ok: false, reason: "ChatGPT is not signed in." };
  addAutomation(world, "a1");
  addBinding(world, "b1", { mode: "dedicated", sessionId: "s-gone" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.skipReason, "no-auth");
  assert.equal(world.sessions.size, 0, "the conversation was rebuilt for a skipped run");
  assert.equal(world.bindings.get("b1").sessionId, "s-gone", "and the binding was repointed");
}

// The burst guard cannot fire for a conversation that does not exist yet.
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    conditions: { cooldownMin: 0, maxRunsPerDay: 50 }
  });
  addBinding(world, "b1", { mode: "per-run", sessionId: null });
  for (let index = 0; index < SESSION_BURST_PER_HOUR + 2; index += 1) {
    world.runs.push({
      id: `busy-${index}`,
      automationId: "other",
      bindingId: `other-${index}`,
      status: "success",
      triggerKind: "activity",
      sessionId: "some-other-session",
      startedAt: world.now.toISOString()
    });
  }
  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.equal(run.status, "success");
}

// ---------------------------------------------------------------------------
// One binding failing must not starve the rest of the fan-out
// ---------------------------------------------------------------------------

{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    conditions: { cooldownMin: 0, maxRunsPerDay: 9 }
  });
  addSession(world, "sA");
  addSession(world, "sB");
  addSession(world, "sC");
  addBinding(world, "b1", { sessionId: "sA", sortOrder: 0 });
  addBinding(world, "b2", { sessionId: "sB", sortOrder: 0 });
  addBinding(world, "b3", { sessionId: "sC", sortOrder: 0 });

  // An unexpected store failure on the middle binding, not a stream error.
  // Keyed by conversation rather than by call count: a run reads its
  // transcript both before and after the stream.
  const realGetEntries = world.deps.getSessionEntries;
  world.deps.getSessionEntries = (sessionId) => {
    if (sessionId === "sB") throw new Error("database is locked");
    return realGetEntries(sessionId);
  };

  const runs = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(runs.length, 3, "every binding still produced a run record");
  assert.deepEqual(
    runs.map((run) => run.status),
    ["success", "failed", "success"],
    "the failure is isolated to its own binding"
  );
  assert.equal(runs[1].error, "database is locked");
  assert.equal(world.streamCalls.length, 2, "the surviving bindings still reached the provider");
}

// ---------------------------------------------------------------------------
// 3.4 "Run now" bypasses the rate guards but still logs a run
// ---------------------------------------------------------------------------

{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    conditions: {
      cooldownMin: 120,
      maxRunsPerDay: 1,
      quietHours: { start: "00:00", end: "23:59" }
    }
  });
  addSession(world, "s1");
  addBinding(world, "b1", {
    sessionId: "s1",
    lastRunAt: new Date(world.now.getTime() - 60_000).toISOString()
  });
  world.runs.push({
    id: "earlier",
    automationId: "a1",
    bindingId: "b1",
    status: "success",
    triggerKind: "schedule",
    sessionId: "s1",
    startedAt: world.now.toISOString()
  });

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(run.status, "success");
  assert.equal(run.triggerKind, "manual");

  // It also reaches a binding the athlete has switched off, which is how they
  // try a rule out before enabling it.
  resetAutomationQueueForTests();
  const offWorld = createWorld();
  addAutomation(offWorld, "a1", { enabled: false });
  addSession(offWorld, "s1");
  addBinding(offWorld, "b1", { sessionId: "s1", enabled: false });
  const [offRun] = await runAutomationNow("a1", undefined, offWorld.deps);
  assert.equal(offRun.status, "success");
}

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { throws: "Claude Code is not installed." };
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.status, "failed");
  assert.equal(run.error, "Claude Code is not installed.");
  assert.ok(run.finishedAt);
  assert.deepEqual(world.sessions.get("s1").entries, [], "nothing is persisted");
  assert.deepEqual(world.updates.map((update) => update.status), ["running", "failed"]);
}

{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { error: "Claude is not authenticated.", authError: true };
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.status, "skipped");
  assert.equal(run.skipReason, "no-auth", "an auth failure mid-stream is a skip, not a failure");
  assert.equal(run.error, "Claude is not authenticated.");
}

{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { error: "The model exploded.", authError: false };
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.status, "failed");
  assert.equal(run.error, "The model exploded.");
}

{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { cancelled: true, text: "half a th" };
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.status, "cancelled");
  assert.deepEqual(world.sessions.get("s1").entries, []);
}

// The run log and the conversation take different things from the same answer:
// the log lifts the headline, the conversation keeps the answer verbatim. The
// runner asks for no label, so it has nothing to edit out on the way in.
{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = {
    text: "**Load is ramping fast.**\n- Volume up 22%.\n- Sleep is short."
  };
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1" });

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(run.summary, "Load is ramping fast.", "the log lifts the headline");

  const saved = world.sessions.get("s1").entries;
  assert.equal(
    saved[saved.length - 1].content,
    world.outcome.text,
    "the answer reaches the athlete exactly as the model wrote it"
  );
  assert.doesNotMatch(AUTOMATION_OUTPUT_CONTRACT, /TLDR/);
}

// A run takes as long as the provider does. Anything the athlete said in that
// conversation meanwhile has to survive the automation's append.
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1");
  addSession(world, "s1", [{ kind: "message", role: "user", content: "before" }]);
  addBinding(world, "b1", { sessionId: "s1" });

  const original = world.deps.streamChat;
  world.deps.streamChat = async (...args) => {
    // The athlete types while the model is still answering.
    world.sessions.get("s1").entries.push({
      kind: "message",
      role: "user",
      content: "typed mid-run"
    });
    return original(...args);
  };

  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.deepEqual(
    world.sessions.get("s1").entries.map((entry) => entry.content),
    [
      "before",
      "typed mid-run",
      world.streamCalls[0].messages[world.streamCalls[0].messages.length - 1].content,
      // The label the runner asked for is stripped on the way in; the run log
      // keeps it, the conversation does not.
      "Load is ramping fast.\nEase off Thursday."
    ],
    "the athlete's turn is not deleted by the automation's append"
  );
}

// A binding whose run fails still had its clock advanced, so a broken
// automation cannot hammer the provider every tick.
{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { error: "boom" };
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1" });
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(world.bindings.get("b1").lastRunAt, world.now.toISOString());
}


// ---------------------------------------------------------------------------
// Activity selection: what a binding still owes an opinion on
// ---------------------------------------------------------------------------

const ACTIVITY_TRIGGER = { kind: "activity", sportTypes: [] };
const NO_LIMITS = { cooldownMin: 0, maxRunsPerDay: 9 };

/** Which activity each run analysed, in the order the runs happened. */
const analysedIds = (world) =>
  world.runs
    .filter((run) => run.triggerPayload?.activityIds)
    .map((run) => run.triggerPayload.activityIds[0]);

// --- multiActivity off: only the newest match, however many piled up --------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "t3", 5);
  addActivity(world, "t4", 4);
  addActivity(world, "t5", 3);

  const runs = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.equal(runs.length, 1, "one trigger, one run");
  assert.deepEqual(analysedIds(world), ["t5"], "the newest match, not the backlog");
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 3 * 86_400,
    "the watermark still jumps to the newest, so the skipped ones stay skipped"
  );
}

// --- multiActivity on: one run per pending activity, oldest first -----------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    conditions: NO_LIMITS
  });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "t3", 5);
  addActivity(world, "t4", 4);
  addActivity(world, "t5", 3);

  const runs = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.equal(runs.length, 3);
  assert.deepEqual(analysedIds(world), ["t3", "t4", "t5"], "chronological, not newest-first");
  assert.ok(
    runs.every((run) => run.status === "success"),
    "each pending activity gets its own answer"
  );

  // Each turn names its own subject, or the three answers would be
  // interchangeable — the playbook itself is identical across them.
  const focus = world.streamCalls.map(
    (call) => call.messages[call.messages.length - 1].content
  );
  assert.match(focus[0], /activity id t3/);
  assert.match(focus[1], /activity id t4/);
  assert.match(focus[2], /activity id t5/);

  assert.equal(world.bindings.get("b1").lastActivityAt, RUNNER_NOW_EPOCH - 3 * 86_400);

  // Nothing new since: the same trigger a second time does nothing at all.
  const again = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.deepEqual(again, [], "an automatic trigger with nothing to say stays silent");
  assert.equal(world.runs.length, 3, "and logs no non-event");
}

// --- a backlog past the cap keeps its *newest* entries -----------------------
{
  // R5. 3.2: "a longer backlog analyses only its most recent entries, because
  // replaying a month in one burst costs real provider spend and buries the
  // answer the athlete wanted." Which end the cap takes from is the whole of
  // that sentence, and every multiActivity fixture until now held ten or fewer
  // activities — where `slice(-10)` and `slice(0, 10)` are the same list. The
  // mutation that swapped them went undetected until this fixture ran twelve.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    // A `per-run` binding, which is the mode 9.1's post-activity debrief uses
    // and the only one where a twelve-deep backlog is reachable: the burst
    // guard counts per conversation, and this one writes into a new one each
    // time. The daily cap is lifted past the sequence for the same reason —
    // what is under test is which end of the backlog the cap takes from.
    conditions: { cooldownMin: 0, maxRunsPerDay: 24 }
  });
  addBinding(world, "b1", {
    mode: "per-run",
    sessionId: null,
    lastActivityAt: RUNNER_NOW_EPOCH - 30 * 86_400
  });
  // Oldest first, so `act-1` is the one furthest back.
  for (let index = 1; index <= 12; index += 1) {
    addActivity(world, `act-${index}`, 13 - index);
  }

  await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);

  const analysed = analysedIds(world);
  assert.equal(analysed.length, MULTI_ACTIVITY_MAX_PER_TRIGGER, "the cap holds");
  assert.deepEqual(
    analysed,
    ["act-3", "act-4", "act-5", "act-6", "act-7", "act-8", "act-9", "act-10", "act-11", "act-12"],
    "the ten most recent, oldest first — not the ten oldest"
  );
  assert.equal(
    analysed.includes("act-1"),
    false,
    "and the two the cap dropped are gone for good: the watermark jumped past them"
  );
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 1 * 86_400,
    "which is what the watermark landing on the newest says"
  );
}

// --- two triggers racing off the same watermark -----------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "t5", 3);

  // The 15-minute poll and a "Run now" seconds apart: both plan their runs
  // before either has moved the watermark.
  const [first, second] = await Promise.all([
    runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps),
    runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps)
  ]);

  const runs = [...first, ...second];
  assert.deepEqual(
    runs.map((run) => run.status).sort(),
    ["skipped", "success"],
    "the same activity is analysed once, not twice into the same conversation"
  );
  assert.equal(
    runs.find((run) => run.status === "skipped").skipReason,
    "no-activity"
  );
  assert.equal(world.streamCalls.length, 1, "and the provider was billed once");
}

// --- never analysed: the attach time is the floor ---------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    conditions: NO_LIMITS
  });
  addSession(world, "s1");
  // Attached two days ago; the older activities predate it.
  addBinding(world, "b1", {
    sessionId: "s1",
    createdAt: new Date((RUNNER_NOW_EPOCH - 2 * 86_400) * 1000).toISOString()
  });
  addActivity(world, "before-attach", 5);
  addActivity(world, "after-attach", 1);

  await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.deepEqual(
    analysedIds(world),
    ["after-attach"],
    "attaching a coach today does not replay the back catalogue"
  );
}

// --- "Run now" on a binding that never analysed anything --------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", {
    sessionId: "s1",
    createdAt: new Date((RUNNER_NOW_EPOCH - 60) * 1000).toISOString()
  });
  // Every activity predates the attach, so the automatic floor would find none.
  addActivity(world, "older", 5);
  addActivity(world, "newest", 3);

  const runs = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(runs.length, 1);
  assert.deepEqual(
    analysedIds(world),
    ["newest"],
    "3.4: a coach attached five minutes ago still has something to answer about"
  );
}

// --- "Run now" with a watermark and nothing new -----------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addActivity(world, "already-done", 3);
  addBinding(world, "b1", {
    sessionId: "s1",
    lastActivityAt: RUNNER_NOW_EPOCH - 3 * 86_400
  });

  const runs = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "skipped");
  assert.equal(
    runs[0].skipReason,
    "no-activity",
    "the button has to say something, so the refusal is recorded"
  );
  assert.equal(world.streamCalls.length, 0, "and no provider call was made");
}

// --- the cooldown gates the reaction, not the catch-up ----------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    conditions: { cooldownMin: 120, maxRunsPerDay: 9 }
  });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "t3", 5);
  addActivity(world, "t4", 4);
  addActivity(world, "t5", 3);

  const runs = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.deepEqual(
    runs.map((run) => run.status),
    ["success", "success", "success"],
    "run 1 sets lastRunAt, but a two-hour cooldown must not strand the backlog"
  );
}

// --- the daily cap stops the sequence, and the leftovers are not lost -------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    conditions: { cooldownMin: 0, maxRunsPerDay: 2 }
  });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "t3", 5);
  addActivity(world, "t4", 4);
  addActivity(world, "t5", 3);
  // A fourth pending activity: without the break, the cap would log its
  // refusal once for t5 and again for t6.
  addActivity(world, "t6", 2);

  const runs = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.deepEqual(runs.map((run) => run.status), ["success", "success", "skipped"]);
  assert.equal(runs[2].skipReason, "budget");
  assert.deepEqual(analysedIds(world), ["t3", "t4", "t5"]);
  assert.equal(
    world.runs.length,
    3,
    "the refusal is logged once, not once per pending activity"
  );
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 4 * 86_400,
    "the watermark stops at t4, so t5 rides along with the next trigger"
  );
}

// --- the sport/duration filters still apply to the selection ---------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    trigger: { kind: "activity", sportTypes: [100], multiActivity: true, minDurationSec: 1800 },
    conditions: NO_LIMITS
  });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "swim", 5, { sport_type: 200, sport_name: "Swim" });
  addActivity(world, "short-run", 4, { duration: 600 });
  addActivity(world, "long-run", 3);

  await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.deepEqual(analysedIds(world), ["long-run"]);
}

// --- a failed run leaves the watermark alone, so the activity comes back ----
{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { error: "provider exploded" };
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "t5", 3);

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.equal(run.status, "failed");
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 8 * 86_400,
    "a failure must not silently consume the activity"
  );
}

// --- a silent run still consumed the activity -------------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  world.outcome = { text: NOTHING_TO_REPORT };
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "t5", 3);

  const [run] = await runAutomationTrigger({ automationId: "a1", kind: "activity" }, world.deps);
  assert.equal(run.status, "silent");
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 3 * 86_400,
    "the model looked and had nothing to say; that is still an answer"
  );
}

// ---------------------------------------------------------------------------
// A provider that goes silent
// ---------------------------------------------------------------------------

const HUNG = Symbol("hung");

/**
 * Every assertion here is about a promise settling at all, so a regression
 * would otherwise show up as a test run that hangs rather than one that fails.
 */
async function withDeadline(work, ms, what) {
  const result = await Promise.race([
    work,
    new Promise((resolve) => setTimeout(() => resolve(HUNG), ms))
  ]);
  assert.notEqual(result, HUNG, what);
  return result;
}

// --- the run is given up on rather than left open ---------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld({
    idleTimeoutMs: 20,
    // Never settles, and never emits: the shape of an MCP connect or a provider
    // fetch that has stopped answering. Neither carries a deadline of its own.
    streamChat: () => new Promise(() => {})
  });
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1");

  const [run] = await withDeadline(
    runAutomationNow("a1", undefined, world.deps),
    2_000,
    "a run whose provider went quiet has to end by itself"
  );
  assert.equal(run.status, "failed");
  assert.match(run.error, /stopped responding/);
  assert.deepEqual(
    world.cancelledRunIds,
    [run.id],
    "the stream is aborted on the way out, so a provider that does watch the signal stops"
  );
}

// --- a stream that keeps talking is never given up on -----------------------
{
  resetAutomationQueueForTests();
  const world = createWorld({
    idleTimeoutMs: 40,
    // Six times the window in total, but never quiet for a whole one: a long
    // tool-using run must not be mistaken for a dead one.
    streamChat: async (sink) => {
      for (let tick = 0; tick < 12; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        sink.emit("chat:streamToken", { delta: "." });
      }
    }
  });
  addAutomation(world, "a1");
  addSession(world, "s1");
  addBinding(world, "b1");

  const [run] = await withDeadline(
    runAutomationNow("a1", undefined, world.deps),
    2_000,
    "a talkative run has to finish"
  );
  assert.equal(run.status, "success");
}

// --- and it does not wedge the runs behind it -------------------------------
{
  resetAutomationQueueForTests();
  const stalled = createWorld({
    idleTimeoutMs: 20,
    streamChat: () => new Promise(() => {})
  });
  addAutomation(stalled, "a1");
  addSession(stalled, "s1");
  addBinding(stalled, "b1");

  const healthy = createWorld();
  addAutomation(healthy, "a2");
  addSession(healthy, "s1");
  addBinding(healthy, "b2", { automationId: "a2" });

  // Queued behind the stall, on the process-wide queue of 5.4. Without a bound
  // on the run in front of it this never resolves, which is what an athlete
  // sees as a "Run now" button that spins with nothing behind it.
  const first = runAutomationNow("a1", undefined, stalled.deps);
  const [behind] = await withDeadline(
    runAutomationNow("a2", undefined, healthy.deps),
    2_000,
    "one stalled run must not hold every later run for the life of the process"
  );
  assert.equal(behind.status, "success");
  await first;
}


// ---------------------------------------------------------------------------
// Per-binding backoff after a failure (10)
// ---------------------------------------------------------------------------

const MINUTE = 60_000;

assert.deepEqual(
  AUTOMATION_BACKOFF_STEPS_MS,
  [5 * MINUTE, 15 * MINUTE, 60 * MINUTE],
  "section 10's steps, and the last one is the ceiling"
);

/** How far ahead of the world clock a binding is held off, in minutes. */
const backoffMinutes = (world, bindingId = "b1") => {
  const binding = world.bindings.get(bindingId);
  return binding.backoffUntil
    ? Math.round((Date.parse(binding.backoffUntil) - world.now.getTime()) / MINUTE)
    : null;
};

/** Waits for something the runner does on its own clock, not on this one. */
async function waitFor(read, what) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return assert.fail(what);
}

// --- 5m, 15m, 60m, and the dead provider is not called in between -----------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1");
  world.outcome.throws = "the provider hung up";

  const fire = async () => {
    const [run] = await runAutomationTrigger(
      { automationId: "a1", kind: "schedule" },
      world.deps
    );
    return run;
  };

  assert.equal((await fire()).status, "failed");
  assert.equal(backoffMinutes(world), 5, "the first failure is worth five minutes");
  assert.equal(world.bindings.get("b1").backoffLevel, 1);

  // Enforced in the runner, not in the scheduler: the schedule trigger fires as
  // usual and is declined here, with a reason on the row for the athlete.
  world.now = new Date(world.now.getTime() + 4 * MINUTE);
  const early = await fire();
  assert.equal(early.status, "skipped");
  assert.equal(early.skipReason, "backoff");
  assert.equal(world.streamCalls.length, 1, "and the dead provider is left alone");

  // A declined run is not a failure and not a success, so it neither escalates
  // the backoff nor clears it — the second of those would be a guard rail that
  // switched itself off the first time it did anything.
  assert.equal(world.bindings.get("b1").backoffLevel, 1);
  assert.equal(backoffMinutes(world), 1);

  world.now = new Date(world.now.getTime() + MINUTE);
  assert.equal((await fire()).status, "failed", "the window closed, so it tries again");
  assert.equal(backoffMinutes(world), 15, "and the second failure is worth fifteen");

  world.now = new Date(world.now.getTime() + 15 * MINUTE);
  await fire();
  assert.equal(backoffMinutes(world), 60);

  world.now = new Date(world.now.getTime() + 60 * MINUTE);
  await fire();
  assert.equal(backoffMinutes(world), 60, "an hour is the ceiling, not a step on the way up");
  assert.equal(world.bindings.get("b1").backoffLevel, 3);
}

// --- a timed-out run backs off exactly as a thrown one does -----------------
{
  // The two paths of section 10 that leave `lastRunAt` and the watermark where
  // they were. They have to be indistinguishable here, or the backoff covers
  // only half of what made "give up on a run that has gone quiet" safe.
  const backoffTrace = async (streamChat) => {
    resetAutomationQueueForTests();
    const world = createWorld({ idleTimeoutMs: 20, streamChat });
    addAutomation(world, "a1", { conditions: NO_LIMITS });
    addSession(world, "s1");
    addBinding(world, "b1");

    const trace = [];
    for (const wait of [0, 5, 15]) {
      world.now = new Date(world.now.getTime() + wait * MINUTE);
      const [run] = await withDeadline(
        runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps),
        2_000,
        "a run that never ends has to end by itself"
      );
      trace.push({
        status: run.status,
        level: world.bindings.get("b1").backoffLevel,
        minutes: backoffMinutes(world)
      });
    }
    return trace;
  };

  const thrown = await backoffTrace(async () => {
    throw new Error("the provider hung up");
  });
  assert.deepEqual(thrown, [
    { status: "failed", level: 1, minutes: 5 },
    { status: "failed", level: 2, minutes: 15 },
    { status: "failed", level: 3, minutes: 60 }
  ]);

  const timedOut = await backoffTrace(() => new Promise(() => {}));
  assert.deepEqual(
    timedOut,
    thrown,
    "a run given up on backs off exactly as a run that threw does"
  );
}

// --- reset on any non-failure ----------------------------------------------
{
  const afterRun = async (outcome) => {
    resetAutomationQueueForTests();
    const world = createWorld();
    addAutomation(world, "a1", { conditions: NO_LIMITS });
    addSession(world, "s1");
    addBinding(world, "b1", {
      backoffLevel: 2,
      // Already expired, so the guard lets this run through — it is the run's
      // outcome being tested, not the guard.
      backoffUntil: new Date(world.now.getTime() - MINUTE).toISOString()
    });
    Object.assign(world.outcome, outcome);
    const [run] = await runAutomationTrigger(
      { automationId: "a1", kind: "schedule" },
      world.deps
    );
    return { status: run.status, binding: world.bindings.get("b1") };
  };

  for (const [expected, outcome] of [
    ["success", {}],
    ["silent", { text: NOTHING_TO_REPORT }],
    ["cancelled", { cancelled: true }]
  ]) {
    const { status, binding } = await afterRun(outcome);
    assert.equal(status, expected);
    assert.equal(binding.backoffLevel, undefined, `a ${expected} run clears the streak`);
    assert.equal(binding.backoffUntil, undefined);
  }
}

// --- the one skip that reaches the end of a run does not clear the streak ---
{
  // `no-auth` is the only skip decided after the provider has answered, so it
  // is the only one that goes through the same exit as a success. Section 10
  // already promises no retry storm for it; clearing a streak of real failures
  // on the way past would start one.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", {
    backoffLevel: 2,
    backoffUntil: new Date(world.now.getTime() - MINUTE).toISOString()
  });
  Object.assign(world.outcome, { error: "Sign in to continue.", authError: true });

  const [run] = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(run.status, "skipped");
  assert.equal(run.skipReason, "no-auth");
  assert.equal(world.bindings.get("b1").backoffLevel, 2, "the streak is left alone");
}

// --- "Run now" overrules it, like every other rate guard (3.4) --------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", {
    backoffLevel: 3,
    backoffUntil: new Date(world.now.getTime() + 60 * MINUTE).toISOString()
  });

  const [automatic] = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(automatic.skipReason, "backoff");

  // The athlete has just fixed whatever was broken and wants to know whether it
  // worked. An hour of silence is the wrong answer to that.
  const [manual] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(manual.status, "success");
  assert.equal(
    world.bindings.get("b1").backoffLevel,
    undefined,
    "and the answer it got clears the streak"
  );
}

// --- a failure part-way through a catch-up sequence stops the sequence ------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    conditions: NO_LIMITS
  });
  addSession(world, "s1");
  addBinding(world, "b1", {
    sessionId: "s1",
    lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400
  });
  addActivity(world, "t1", 5);
  addActivity(world, "t2", 4);
  addActivity(world, "t3", 3);
  world.outcome.throws = "the provider hung up";

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "activity" },
    world.deps
  );
  // Unlike the cooldown, the backoff is checked at every step of a sequence:
  // a failure part-way through is exactly the storm being prevented.
  assert.deepEqual(runs.map((run) => run.status), ["failed", "skipped"]);
  assert.equal(runs[1].skipReason, "backoff");
  assert.equal(world.streamCalls.length, 1, "the second activity is not attempted");
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 8 * 86_400,
    "and all three are still owed once the backoff expires"
  );
}

// --- a run that blows up before it reaches the provider backs off too -------
{
  resetAutomationQueueForTests();
  const world = createWorld({
    getSessionEntries: () => {
      throw new Error("the transcript could not be read");
    }
  });
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1");

  const [run] = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(run.status, "failed");
  assert.equal(
    backoffMinutes(world),
    5,
    "the fan-out's own catch records a failure, so it has to back off like one"
  );
}

// --- a healthy binding does not rewrite its own row on every run ------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1");

  const writes = [];
  const stamp = world.deps.setBindingSchedule;
  world.deps.setBindingSchedule = (bindingId, schedule) => {
    writes.push(schedule);
    stamp(bindingId, schedule);
  };

  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(writes.length, "the run still stamps its clock");
  assert.ok(
    writes.every(
      (write) => write.backoffLevel === undefined && write.backoffUntil === undefined
    ),
    "an automation that has never failed has no streak to clear"
  );
}

// ---------------------------------------------------------------------------
// Stop ends a trigger, not one run of it (10)
// ---------------------------------------------------------------------------

// --- one press stops a three-place fan-out ---------------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld({
    // The athlete presses Stop on the run they can see. Two more conversations
    // are queued behind it, and before the token each needed its own press —
    // aimed at runs that did not exist yet, so there was nothing to aim at.
    //
    // This run then finishes normally: the abort raced the provider and lost.
    // Nothing about the run itself says Stop was pressed, so the token is the
    // only thing that can stop the two behind it.
    streamChat: async (_sink, runId) => {
      world.streamCalls.push({ runId });
      cancelAutomationRun(runId, world.deps);
    }
  });
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addSession(world, "s2");
  addSession(world, "s3");
  addBinding(world, "b1", { sessionId: "s1" });
  addBinding(world, "b2", { sessionId: "s2" });
  addBinding(world, "b3", { sessionId: "s3" });

  const runs = await withDeadline(
    runAutomationNow("a1", undefined, world.deps),
    2_000,
    "a cancelled fan-out still has to return"
  );
  assert.deepEqual(runs.map((run) => run.status), ["success"]);
  assert.equal(world.streamCalls.length, 1, "the other two conversations are never asked");
  assert.equal(world.runs.length, 1, "and no run is logged for them either");
  assert.deepEqual(
    world.cancelledRunIds,
    [runs[0].id],
    "the run's own stream is still aborted, exactly once"
  );
}

// --- Stop landing while a run was still getting itself ready ---------------
{
  // The token was clear when this step started, so the check at the top of it
  // saw nothing; by the time there was a provider to call, the athlete had
  // already pressed Stop on the step before it.
  resetAutomationQueueForTests();
  let ready = () => undefined;
  const gettingReady = new Promise((resolve) => {
    ready = resolve;
  });
  let release = () => undefined;
  const world = createWorld({
    ensureCorosSession: async () => {
      if (world.streamCalls.length === 1) {
        ready();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return { ok: true };
    },
    streamChat: async (_sink, runId) => {
      world.streamCalls.push({ runId });
    }
  });
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    conditions: NO_LIMITS
  });
  addSession(world, "s1");
  addBinding(world, "b1", {
    sessionId: "s1",
    lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400
  });
  addActivity(world, "t1", 5);
  addActivity(world, "t2", 4);

  const fanOut = runAutomationNow("a1", undefined, world.deps);
  await gettingReady;
  cancelAutomationRun(world.runs[0].id, world.deps);
  release();

  const runs = await withDeadline(fanOut, 2_000, "a cancelled step still has to return");
  assert.deepEqual(runs.map((run) => run.status), ["success", "cancelled"]);
  assert.equal(world.streamCalls.length, 1, "the second run never reaches the provider");
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 5 * 86_400,
    "and the activity it was cancelled over is still owed"
  );
}

// --- and the run queued behind a stall -------------------------------------
{
  resetAutomationQueueForTests();
  let release = () => undefined;
  const world = createWorld({
    // Long enough that the idle bound is not what ends this: the point is that
    // Stop ends it, rather than three minutes of nothing followed by a run
    // nobody wanted.
    idleTimeoutMs: 10_000,
    streamChat: (_sink, runId) =>
      new Promise((resolve) => {
        world.streamCalls.push({ runId });
        release = resolve;
      }),
    // Aborting is what lets a stalled stream go, which is what really happens.
    cancelRun: (runId) => {
      world.cancelledRunIds.push(runId);
      world.outcome.cancelled = true;
      release();
    }
  });
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addSession(world, "s2");
  addBinding(world, "b1", { sessionId: "s1" });
  addBinding(world, "b2", { sessionId: "s2" });

  const fanOut = runAutomationNow("a1", undefined, world.deps);
  const stalled = await waitFor(() => world.runs[0], "the first run has to start");
  cancelAutomationRun(stalled.id, world.deps);

  const runs = await withDeadline(fanOut, 2_000, "Stop has to end the fan-out");
  assert.deepEqual(runs.map((run) => run.status), ["cancelled"]);
  assert.equal(world.streamCalls.length, 1, "the run behind the stall never starts");
}

// --- the token, not the run's status, is what ends a sequence ---------------
{
  // This run finishes normally — the abort raced the provider and lost — and
  // the two activities behind it are dropped all the same. Nothing about the
  // run itself says the athlete pressed Stop, so the sequence has only the
  // token to go on.
  resetAutomationQueueForTests();
  const world = createWorld({
    streamChat: async (_sink, runId) => {
      world.streamCalls.push({ runId });
      cancelAutomationRun(runId, world.deps);
    }
  });
  addAutomation(world, "a1", {
    trigger: { ...ACTIVITY_TRIGGER, multiActivity: true },
    conditions: NO_LIMITS
  });
  addSession(world, "s1");
  addBinding(world, "b1", {
    sessionId: "s1",
    lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400
  });
  addActivity(world, "t1", 5);
  addActivity(world, "t2", 4);
  addActivity(world, "t3", 3);

  const runs = await withDeadline(
    runAutomationNow("a1", undefined, world.deps),
    2_000,
    "a cancelled sequence still has to return"
  );
  assert.deepEqual(runs.map((run) => run.status), ["success"]);
  assert.deepEqual(analysedIds(world), ["t1"], "the two behind it are dropped, not run");
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 5 * 86_400,
    "and what the model did look at is not thrown away"
  );
}

// --- a Stop no live trigger owns still reaches the abort map ----------------
{
  resetAutomationQueueForTests();
  const world = createWorld({
    streamChat: async (_sink, runId) => {
      world.streamCalls.push({ runId });
      if (world.streamCalls.length === 1) {
        // Somebody else's run, or one this trigger has already let go of — a
        // stream left settling in its own time after a timeout outlives the
        // fan-out that started it.
        cancelAutomationRun("run-from-another-life", world.deps);
      }
    }
  });
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addSession(world, "s2");
  addBinding(world, "b1", { sessionId: "s1" });
  addBinding(world, "b2", { sessionId: "s2" });

  const runs = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(runs.length, 2, "an unrelated Stop does not end a live trigger");
  assert.deepEqual(world.cancelledRunIds, ["run-from-another-life"]);
}


// ---------------------------------------------------------------------------
// Guard rail 3, for every provider (10)
// ---------------------------------------------------------------------------

const SIGNED_IN = {
  chatgptSignedIn: true,
  claudeCodeState: "connected",
  anthropicHasApiKey: true,
  localModel: "qwen3:8b"
};

// Each provider is asked about its own credential and nothing else. This is
// the whole point of widening the pre-flight: an automation may override the
// provider (decision 2), so a signed-out ChatGPT must not hold back a rule
// running on Claude Code, and never did — it simply used to be invisible.
for (const [provider, broken, expected] of [
  ["chatgpt", { chatgptSignedIn: false }, /ChatGPT/],
  ["claude-code", { claudeCodeState: "sign-in-required" }, /Claude Code.*signed in/],
  ["claude-code", { claudeCodeState: "not-installed" }, /CLI is not installed/],
  ["claude-api", { anthropicHasApiKey: false }, /Anthropic API key/],
  ["local", { localModel: "   " }, /local model/]
]) {
  assert.deepEqual(
    checkProviderAuth(provider, SIGNED_IN),
    { ok: true },
    `${provider} is usable when everything is in place`
  );

  const verdict = checkProviderAuth(provider, { ...SIGNED_IN, ...broken });
  assert.equal(verdict.ok, false, `${provider} must decline on ${Object.keys(broken)[0]}`);
  assert.match(
    verdict.reason,
    expected,
    "and say which thing is missing, or the athlete opens the wrong screen"
  );

  // The other three are unaffected by it. Before this, the answer for all of
  // them was a flat `true`, so nothing could be.
  for (const other of ["chatgpt", "claude-code", "claude-api", "local"]) {
    if (other === provider) continue;
    assert.deepEqual(
      checkProviderAuth(other, { ...SIGNED_IN, ...broken }),
      { ok: true },
      `${other} must not be held back by ${provider}'s problem`
    );
  }
}

// The states that decline are the ones that are unambiguous *and* stable. A
// fresh install whose Coach view nobody has opened has no recorded state at
// all, and holding every automation on a machine where nothing is wrong is a
// worse answer than letting the stream report it.
for (const state of [undefined, "connecting", "connection-failed", "usage-limit-reached"]) {
  assert.deepEqual(
    checkProviderAuth("claude-code", { ...SIGNED_IN, claudeCodeState: state }),
    { ok: true },
    `a "${state}" CLI is not a pre-flight refusal`
  );
}

// --- the verdict's reason rides along on the row ---------------------------
{
  const { run } = await runWith((w) => {
    w.providerAuth = { ok: false, reason: "No Anthropic API key is stored." };
  });
  assert.equal(run.skipReason, "no-auth");
  assert.equal(
    run.error,
    "No Anthropic API key is stored.",
    "a run log that cannot tell a missing key from a missing CLI sends the athlete to the wrong screen"
  );
}

// ---------------------------------------------------------------------------
// Pausing every automation on a 2FA demand (10)
// ---------------------------------------------------------------------------

const TWO_FACTOR = { ok: false, twoFactorRequired: true };

/** An automation attached in three places, so a fan-out has somewhere to go. */
function threePlaceWorld(configure = () => undefined) {
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  for (const [index, id] of ["b1", "b2", "b3"].entries()) {
    addSession(world, `s${index + 1}`);
    addBinding(world, id, { sessionId: `s${index + 1}` });
  }
  configure(world);
  // COROS asking for a login code means there is nothing usable on disk either.
  if (world.corosResult.twoFactorRequired) {
    world.corosOnDisk = false;
  }
  return world;
}

// --- one row, not one per binding, and then silence ------------------------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld((w) => {
    w.corosResult = TWO_FACTOR;
  });

  const first = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.deepEqual(
    first.map((run) => run.skipReason),
    ["two-factor-required"],
    "every remaining place gets the same answer, so the log carries it once"
  );
  assert.equal(world.pause.reason, "two-factor-required");
  assert.equal(
    world.pause.runId,
    first[0].id,
    "the pause points at the row that explains it"
  );

  // And the next fifteen minutes, and the fifteen after that.
  world.now = new Date(world.now.getTime() + 15 * MINUTE);
  const later = await runAutomationTrigger(
    { automationId: "a1", kind: "activity" },
    world.deps
  );
  assert.deepEqual(later, [], "a held trigger produces no runs");
  assert.equal(
    world.runs.length,
    1,
    "and logs nothing — the run log filling with the same skip is what this stops"
  );
}

// --- a manual run is the athlete asking, so it still goes through ----------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld((w) => {
    w.corosResult = TWO_FACTOR;
  });
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  world.runs.length = 0;

  // Still locked: the athlete gets the one skip that says so, rather than a
  // button that silently does nothing.
  const [again] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(again.skipReason, "two-factor-required");
  assert.ok(world.pause, "and it stays paused");

  // Now reachable — but through a *reconnect*, with nothing yet on disk for the
  // gate to see. The gate therefore still holds, and the only thing that can
  // lift the pause is the run's own COROS check coming back usable. This is the
  // case a fake that collapsed the two facts into one could not tell apart.
  world.corosResult = { ok: true };
  assert.equal(world.corosOnDisk, false, "nothing the gate can read has changed");
  const [fixed] = await runAutomationNow("a1", ["b1"], world.deps);
  assert.equal(fixed.status, "success");
  assert.equal(world.pause, null, "a COROS session that answers clears the pause");
}

// --- the cause disappearing is not a second way to resume ------------------
{
  // The athlete signs in to COROS from the settings screen, which knows nothing
  // about automations. Nothing would ever ask again, because the gate is what
  // stops the asking — so the gate is where the pause has to notice.
  resetAutomationQueueForTests();
  const world = threePlaceWorld((w) => {
    w.corosResult = TWO_FACTOR;
  });
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(world.pause);

  world.corosResult = { ok: true };
  world.corosOnDisk = true;
  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(world.pause, null, "the pause lifts itself once its cause is gone");
  assert.deepEqual(
    runs.map((run) => run.status),
    ["success", "success", "success"],
    "and the whole fan-out runs again"
  );
}

// --- Resume clears it, and promises nothing else ---------------------------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld((w) => {
    w.corosResult = TWO_FACTOR;
  });
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(getAutomationPause(world.deps), "the banner reads the flag it shows");

  assert.equal(resumeAutomations(world.deps), null);
  assert.equal(getAutomationPause(world.deps), null);

  // Resume means "try again", not "fixed": COROS is still asking, so the next
  // trigger re-trips it rather than quietly declining forever.
  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.deepEqual(runs.map((run) => run.skipReason), ["two-factor-required"]);
  assert.ok(world.pause, "and the pause is back, because the reason is");
}

// --- an offline COROS is not a 2FA demand ----------------------------------
{
  // The two arrive on the same path and only one of them is unanswerable by
  // retrying. Pausing everything for a flaky network would be a feature that
  // switches the app off every time a train goes into a tunnel.
  resetAutomationQueueForTests();
  const world = threePlaceWorld((w) => {
    w.corosResult = { ok: false, twoFactorRequired: false };
  });

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.deepEqual(
    runs.map((run) => run.skipReason),
    ["offline", "offline", "offline"],
    "an offline skip is per binding and the fan-out carries on"
  );
  assert.equal(world.pause, null, "and nothing is paused");
}


// ---------------------------------------------------------------------------
// Context trimming (5.7)
// ---------------------------------------------------------------------------

assert.equal(AUTOMATION_CONTEXT_LIMIT, 60);
assert.equal(AUTOMATION_CONTEXT_KEEP, 20);
assert.ok(
  AUTOMATION_CONTEXT_KEEP < AUTOMATION_CONTEXT_LIMIT,
  "the gap between them is how many runs happen between two rolls"
);

/** `count` message entries, numbered so a slice can be identified on sight. */
const transcript = (count, offset = 0) =>
  Array.from({ length: count }, (_unused, index) => ({
    kind: "message",
    role: index % 2 === 0 ? "user" : "assistant",
    content: `entry ${index + offset}`
  }));

const contentsOf = (entries) => entries.map((entry) => entry.content);

// --- under the limit, everything goes ---------------------------------------
{
  const entries = transcript(AUTOMATION_CONTEXT_LIMIT);
  const plan = planTranscriptContext(entries, { through: 0 });
  assert.equal(plan.summary, undefined);
  assert.equal(plan.tail.length, AUTOMATION_CONTEXT_LIMIT, "exactly at the limit is under it");
  assert.deepEqual(plan.toSummarise, [], "and nothing has to be summarised");
  assert.equal(plan.through, 0);
}

// --- one past it rolls, and keeps exactly the tail --------------------------
{
  const entries = transcript(AUTOMATION_CONTEXT_LIMIT + 1);
  const plan = planTranscriptContext(entries, { through: 0 });
  assert.equal(plan.tail.length, AUTOMATION_CONTEXT_KEEP);
  assert.deepEqual(
    contentsOf(plan.tail),
    contentsOf(entries.slice(-AUTOMATION_CONTEXT_KEEP)),
    "the tail is the most recent entries, not the oldest"
  );
  assert.deepEqual(
    contentsOf(plan.toSummarise),
    contentsOf(entries.slice(0, entries.length - AUTOMATION_CONTEXT_KEEP)),
    "and everything in front of it is folded in — nothing is dropped"
  );
  assert.equal(plan.through, entries.length - AUTOMATION_CONTEXT_KEEP);
  assert.equal(
    plan.toSummarise.length + plan.tail.length,
    entries.length,
    "the two halves account for the whole transcript"
  );
}

// --- the count is measured from the summary, not from the start -------------
{
  // This is the difference between a rolling summary and a fixed window. A
  // conversation of 200 entries whose summary already covers 180 has 20 live
  // entries and needs no roll at all — where a fixed window would re-roll on
  // every run, paying a model call each time and compressing a compression.
  const entries = transcript(200);
  const settled = planTranscriptContext(entries, { summary: "So far.", through: 180 });
  assert.deepEqual(settled.toSummarise, [], "20 live entries is nothing to do");
  assert.equal(settled.summary, "So far.");
  assert.equal(settled.tail.length, 20);

  // The case that tells the two readings apart. 100 entries is well past the
  // limit; 50 of them past the summary is not. A count taken from the start
  // would roll here — and go on rolling on every run for the life of the
  // conversation, which is the cost this is supposed to avoid.
  const midway = planTranscriptContext(transcript(100), {
    summary: "So far.",
    through: 50
  });
  assert.deepEqual(midway.toSummarise, [], "a long conversation is not a reason to roll");
  assert.equal(midway.through, 50, "the summary stays where it is");
  assert.equal(
    midway.tail.length,
    50,
    "and the live stretch goes in full, however long the whole thread is"
  );

  // It rolls again only once the live stretch has grown past the limit, which
  // is `LIMIT - KEEP` runs' worth of entries later.
  const grown = planTranscriptContext(transcript(241), {
    summary: "So far.",
    through: 180
  });
  assert.equal(grown.through, 241 - AUTOMATION_CONTEXT_KEEP);
  assert.equal(
    grown.toSummarise.length,
    grown.through - 180,
    "and folds in everything between the old summary and the new tail"
  );
}

// --- a summary that outlived its transcript is abandoned --------------------
{
  // It should not happen: the window's saves merge rather than truncate (5.6b)
  // and a deleted conversation takes its row with it. But a summary claiming to
  // cover entries nobody can see is the one failure here that cannot be noticed
  // by reading the answer, so it is not trusted.
  const plan = planTranscriptContext(transcript(5), {
    summary: "About a conversation that is gone.",
    through: 90
  });
  assert.equal(plan.summary, undefined, "the stale summary is dropped, not sent");
  assert.equal(plan.through, 0);
  assert.deepEqual(contentsOf(plan.tail), contentsOf(transcript(5)));

  const negative = planTranscriptContext(transcript(5), { through: -1 });
  assert.equal(negative.through, 0);
  assert.equal(negative.tail.length, 5);
}

// --- what the summary looks like on the wire --------------------------------
{
  const message = summaryContextMessage("Marathon in October. Calf grumbling.");
  assert.equal(message.role, "user", "one shape that reads the same to four providers");
  assert.match(message.content, /summarised/i);
  assert.match(message.content, /Marathon in October/);
  assert.match(
    message.content,
    /recent turns in full/i,
    "the model has to know where the compression stops"
  );

  // The roll's own turn carries the previous summary when there is one, and
  // says so — a model handed two blocks of text with no labels merges them.
  const first = buildRollingSummaryTurn(undefined, transcript(2));
  assert.doesNotMatch(first, /Running summary/);
  assert.match(first, /opening turns/i);

  const later = buildRollingSummaryTurn("Marathon in October.", transcript(2));
  assert.match(later, /Running summary/);
  assert.match(later, /Marathon in October\./);
  assert.match(later, /Newer turns/);
  assert.match(later, /Athlete: entry 0/, "the turns are attributed, not run together");
  assert.match(later, /Coach: entry 1/);
  assert.match(
    later,
    /only record of these turns/i,
    "and the model is told what it is for, which is what makes it keep the right things"
  );
}

// ---------------------------------------------------------------------------
// Trimming, in a run
// ---------------------------------------------------------------------------

/** The messages the last run put on the wire. */
const lastWire = (world) =>
  world.streamCalls[world.streamCalls.length - 1].messages;

// --- a short conversation is untouched --------------------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(4));
  addBinding(world, "b1");

  await runAutomationNow("a1", undefined, world.deps);
  assert.deepEqual(world.rolls, [], "nothing to summarise");
  assert.deepEqual(
    lastWire(world).map((message) => message.content).slice(0, 4),
    contentsOf(transcript(4)),
    "and the whole transcript goes as it always did"
  );
}

// --- a long one is rolled, stored, and sent as summary + tail ---------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");

  await runAutomationNow("a1", undefined, world.deps);

  assert.equal(world.rolls.length, 1);
  assert.equal(world.rolls[0].previous, undefined, "the first roll has nothing to build on");
  assert.equal(world.rolls[0].count, 100 - AUTOMATION_CONTEXT_KEEP);

  assert.deepEqual(world.summaryWrites, [
    { sessionId: "s1", summary: "Rolled summary.", through: 80 }
  ]);

  const wire = lastWire(world);
  assert.match(wire[0].content, /Rolled summary\./, "the summary leads");
  assert.deepEqual(
    wire.slice(1, 1 + AUTOMATION_CONTEXT_KEEP).map((message) => message.content),
    contentsOf(transcript(100).slice(-AUTOMATION_CONTEXT_KEEP)),
    "then the recent turns, in order"
  );
  assert.equal(
    wire.length,
    1 + AUTOMATION_CONTEXT_KEEP + 1,
    "and the playbook — a year-old thread costs one turn's worth of context"
  );
}

// --- the window is a setting, and the runner uses the one it is handed ------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(30));
  addBinding(world, "b1");
  // Below the shipped 60, so a runner still reading the constant would send
  // this transcript whole and roll nothing — the fixture is on the side where
  // the two readings disagree.
  world.contextWindow = { limit: 20, keep: 6 };

  await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.rolls.length, 1, "a narrower window rolls sooner");
  assert.equal(world.rolls[0].count, 30 - 6);
  assert.equal(world.summaryWrites[0].through, 24);
  assert.equal(
    lastWire(world).length,
    1 + 6 + 1,
    "summary + the configured tail + the playbook"
  );
}

// --- a wider window than the transcript rolls nothing -----------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");
  // Above the shipped 60: the same 100-entry transcript that rolls by default
  // must now go whole, which no constant-reading runner could do.
  world.contextWindow = { limit: 200, keep: 20 };

  await runAutomationNow("a1", undefined, world.deps);
  assert.deepEqual(world.rolls, [], "a wider window defers the roll");
  assert.equal(lastWire(world).length, 100 + 1, "and the whole transcript goes");
}

// --- the next run reuses it rather than rolling again -----------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");
  world.summaries.set("s1", { summary: "Already rolled.", through: 80 });

  await runAutomationNow("a1", undefined, world.deps);
  assert.deepEqual(world.rolls, [], "20 live entries needs no model call at all");
  assert.deepEqual(world.summaryWrites, [], "and writes nothing");
  assert.match(lastWire(world)[0].content, /Already rolled\./);
}

// --- a roll that builds on the last one carries it forward ------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(150));
  addBinding(world, "b1");
  world.summaries.set("s1", { summary: "Marathon in October.", through: 80 });

  await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.rolls.length, 1);
  assert.equal(
    world.rolls[0].previous,
    "Marathon in October.",
    "a rolling summary rolls — it is not rewritten from the tail alone"
  );
  assert.equal(world.rolls[0].count, 150 - AUTOMATION_CONTEXT_KEEP - 80);
  assert.equal(world.summaryWrites[0].through, 130);
}

// --- a roll that fails costs more, and loses nothing ------------------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");
  world.rollResult = null;

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(run.status, "success", "a summary that could not be written is not a failed run");
  assert.deepEqual(world.summaryWrites, [], "and nothing is stored that was not written");

  const wire = lastWire(world);
  assert.equal(
    wire.length,
    100 + 1,
    "the run falls back to the whole transcript rather than dropping the middle"
  );
  assert.deepEqual(
    wire.map((message) => message.content).slice(0, 100),
    contentsOf(transcript(100))
  );

  // And it rolls again next time rather than giving up on the conversation.
  world.rollResult = "Second time lucky.";
  await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.summaryWrites.length, 1);
}

// --- a per-run binding never reaches the limit ------------------------------
{
  // 5.7 is about `dedicated` and `existing` bindings. A `per-run` binding gets
  // a conversation of its own every time, so it is covered by the same count
  // rather than by a mode check — there is nothing there to trim.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addBinding(world, "b1", { mode: "per-run", sessionId: null });

  await runAutomationNow("a1", undefined, world.deps);
  assert.deepEqual(world.rolls, []);
  assert.equal(lastWire(world).length, 1, "a fresh conversation is just the playbook");
}


// ---------------------------------------------------------------------------
// Cost: what a run spent, and the month's ceiling (12, phase 3 item 6)
// ---------------------------------------------------------------------------

// --- the month is the athlete's, on their wall clock ------------------------
{
  const start = new Date(startOfLocalMonth(new Date(2026, 7, 21, 9, 30)));
  assert.equal(start.getDate(), 1);
  assert.equal(start.getMonth(), 7);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);

  // A budget is something a person plans around, so it rolls over when their
  // calendar says so. The first instant of the month is inside it.
  assert.equal(
    startOfLocalMonth(new Date(2026, 7, 1, 0, 0, 0)),
    start.toISOString(),
    "the 1st belongs to its own month"
  );
}

// --- the ceiling is a ceiling ----------------------------------------------
{
  assert.equal(isOverBudget(0, null), false, "no ceiling is not a ceiling of zero");
  assert.equal(isOverBudget(1_000_000, null), false);
  assert.equal(isOverBudget(499_999, 500_000), false);
  assert.equal(
    isOverBudget(500_000, 500_000),
    true,
    "500k means 500k is what was agreed — the run that would pass it is not paid for"
  );
  assert.equal(isOverBudget(500_001, 500_000), true);
  assert.equal(isOverBudget(10, 0), false, "a budget of zero reads as no budget, not as a stop");
}

// --- a run records what it cost, whatever it turned into --------------------
{
  for (const [label, configure, expected] of [
    ["success", () => undefined, "success"],
    ["silent", (w) => { w.outcome = { text: NOTHING_TO_REPORT }; }, "silent"],
    ["cancelled", (w) => { w.outcome = { ...w.outcome, cancelled: true }; }, "cancelled"],
    [
      "failed",
      (w) => { w.outcome = { ...w.outcome, error: "the provider fell over" }; },
      "failed"
    ]
  ]) {
    resetAutomationQueueForTests();
    const world = createWorld();
    addAutomation(world, "a1", { conditions: NO_LIMITS });
    addSession(world, "s1");
    addBinding(world, "b1");
    configure(world);

    const [run] = await runAutomationNow("a1", undefined, world.deps);
    assert.equal(run.status, expected, `${label}: fixture sanity`);
    // A failed or cancelled run spent tokens too. A budget that forgave those
    // is a budget a broken provider can run through for nothing.
    assert.equal(run.inputTokens, 120, `${label} must carry what it cost`);
    assert.equal(run.outputTokens, 45);
  }
}

// --- a provider that reports nothing leaves it unknown, not zero ------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1");
  world.usage = null;

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(run.status, "success");
  assert.equal(
    run.inputTokens,
    undefined,
    "\"nobody told us\" is a different fact from \"it was free\""
  );
  assert.equal(run.outputTokens, undefined);
}

// --- a run that never reached the provider has nothing to record ------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1");
  world.corosResult = { ok: false, twoFactorRequired: false };

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(run.skipReason, "offline");
  assert.equal(run.inputTokens, undefined, "a skip costs nothing and claims nothing");
}

// --- over the ceiling: one row, then everything is held ---------------------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.budget = 500_000;
  world.monthToDateTokens = 500_000;

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.deepEqual(
    runs.map((run) => run.skipReason),
    ["budget"],
    "every remaining place would get the same answer, so the log carries it once"
  );
  assert.equal(world.streamCalls.length, 0, "and nothing is sent to a provider");
  assert.equal(world.pause.reason, "budget");
  assert.equal(world.pause.runId, runs[0].id, "the pause points at the row that explains it");

  // And the fifteen minutes after that, and the fifteen after those.
  const later = await runAutomationTrigger(
    { automationId: "a1", kind: "activity" },
    world.deps
  );
  assert.deepEqual(later, [], "a held trigger produces no runs");
  assert.equal(world.runs.length, 1, "and logs nothing");
}

// --- raising the ceiling lifts it, without a second control -----------------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.budget = 500_000;
  world.monthToDateTokens = 500_000;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(world.pause);

  world.budget = 900_000;
  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(world.pause, null, "the number that stopped everything is no longer the number");
  assert.equal(runs.length, 3, "and the whole fan-out runs again");
}

// --- and so does the month rolling over -------------------------------------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.budget = 500_000;
  world.monthToDateTokens = 500_000;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(world.pause);

  // The 1st: the month-to-date total is a fresh month's.
  world.monthToDateTokens = 0;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(world.pause, null, "a budget pause does not outlive its month");
}

// --- clearing the ceiling lifts it too --------------------------------------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.budget = 500_000;
  world.monthToDateTokens = 900_000;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(world.pause);

  world.budget = null;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(world.pause, null, "no ceiling is not a ceiling of zero here either");
}

// --- "Run now" is the athlete spending their own money on purpose -----------
{
  // Every other rate guard yields to 3.4's bypass, and this one is no different:
  // the athlete pressing the button while over budget has been told the number
  // and pressed it anyway. A ceiling that also refused them would be a ceiling
  // on their own decisions rather than on unattended spend.
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.budget = 500_000;
  world.monthToDateTokens = 500_000;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(world.pause);

  const [run] = await runAutomationNow("a1", ["b1"], world.deps);
  assert.equal(run.status, "success");
  assert.equal(run.inputTokens, 120, "and it is counted like any other run");
}

// --- a ceiling nobody set costs nothing to check ----------------------------
{
  // The total is a SUM over the whole run log and no ceiling is the default, so
  // reading it first would make every athlete who never set a budget pay for
  // that scan on every run — to discard the answer.
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.monthToDateTokens = 50_000_000;

  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(world.budgetReads >= 3, "fixture sanity: every run asked about the ceiling");
  assert.equal(world.spendReads, 0, "and none of them totalled up the run log");

  // With a ceiling set, the total is what decides, so of course it is read.
  world.budget = 500_000;
  world.monthToDateTokens = 0;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.ok(world.spendReads > 0, "a ceiling that exists is compared against something");
}

// --- an unset budget never stops anything -----------------------------------
{
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.monthToDateTokens = 50_000_000;

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(runs.length, 3, "a number nobody chose must not pause anybody's coaches");
  assert.equal(world.pause, null);
}


// ---------------------------------------------------------------------------
// Where two phase-3 features meet
// ---------------------------------------------------------------------------
// Each of these is one feature reaching into another's state. Neither suite
// that owns the halves would notice, because each half is correct on its own.

// --- a working COROS session must not clear a *budget* pause ---------------
{
  // Reachable: a budget pause holds the gate, "Run now" bypasses the gate, and
  // the run then passes the COROS check. Clearing there took the banner down
  // and let one more unattended run through before guard rail 4b put it back.
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.budget = 500_000;
  world.monthToDateTokens = 500_000;
  await runAutomationTrigger({ automationId: "a1", kind: "schedule" }, world.deps);
  assert.equal(world.pause.reason, "budget", "fixture sanity: paused on the ceiling");

  const [manual] = await runAutomationNow("a1", ["b1"], world.deps);
  assert.equal(manual.status, "success", "the athlete's own button still runs");
  assert.equal(
    world.pause?.reason,
    "budget",
    "and a COROS session that answered says nothing about the athlete's money"
  );

  // The 2FA pause it is modelled on still lifts on the same path.
  world.pause = { reason: "two-factor-required", since: world.now.toISOString() };
  await runAutomationNow("a1", ["b1"], world.deps);
  assert.equal(world.pause, null, "which is the pause a COROS session *does* answer");
}

// --- Stop before the provider must not clear a backoff streak --------------
{
  // The backoff is a claim about the provider. A run cancelled while it was
  // still being prepared never asked the provider anything, so it cannot report
  // one healthy — an athlete pressing Stop would otherwise reset the hold on a
  // binding that is failing, and the storm starts again.
  // Two places, because the window only opens for a run the token has something
  // to be cancelled *by*: the first place produces the id Stop is pressed on,
  // and the second is the one still getting itself ready when it lands.
  resetAutomationQueueForTests();
  let corosChecks = 0;
  const world = createWorld({
    ensureCorosSession: async () => {
      corosChecks += 1;
      if (corosChecks === 2) {
        cancelAutomationRun(world.runs[0].id, world.deps);
      }
      return { ok: true };
    }
  });
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addSession(world, "s2");
  addBinding(world, "b1", { sessionId: "s1" });
  addBinding(world, "b2", {
    sessionId: "s2",
    backoffLevel: 2,
    backoffUntil: new Date(world.now.getTime() - MINUTE).toISOString()
  });

  const runs = await withDeadline(
    runAutomationNow("a1", undefined, world.deps),
    2_000,
    "a cancelled run still has to return"
  );
  assert.deepEqual(runs.map((run) => run.status), ["success", "cancelled"]);
  assert.equal(
    world.streamCalls.length,
    1,
    "fixture sanity: the second run never reached the provider"
  );
  assert.equal(
    world.bindings.get("b2").backoffLevel,
    2,
    "so its streak survives — a Stop is not a provider reporting itself healthy"
  );
  // And the one that *did* reach the provider cleared its own, as it should.
  assert.equal(world.bindings.get("b1").backoffLevel, undefined);
}

Module._load = originalLoad;

// --- the roll's tokens belong to the run that asked for it ------------------
{
  // 5.7 is the one feature built to make a long conversation affordable, and it
  // pays for that with a provider turn of its own. Reading only the run's own
  // stream left that turn outside 13's month-to-date total, so the budget
  // under-reported by exactly the thing whose whole purpose is cost.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");
  world.rollUsage = { inputTokens: 4_000, outputTokens: 300 };

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.rolls.length, 1, "fixture sanity: the transcript needed a roll");
  assert.equal(run.status, "success");
  assert.equal(run.inputTokens, 4_000 + 120, "the roll is summed into the run's cost");
  assert.equal(run.outputTokens, 300 + 45);
}

// --- a roll that spent and then declined still spent ------------------------
{
  // Best-effort means the run carries on, not that the tokens came back.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");
  world.rollResult = null;
  world.rollUsage = { inputTokens: 4_000, outputTokens: 12 };

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.deepEqual(world.summaryWrites, [], "fixture sanity: the roll produced nothing");
  assert.equal(run.inputTokens, 4_000 + 120, "and is still on the bill");
}

// --- a run that never reached the model still carries what its roll cost ----
{
  // The mid-preparation Stop of section 10. Nothing was asked of the provider,
  // but the roll on the way in already had its turn — and the exit that records
  // no cost at all is the one where the tokens vanish silently.
  resetAutomationQueueForTests();
  let rolls = 0;
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addSession(world, "s2", transcript(100));
  addBinding(world, "b1", { sessionId: "s1" });
  addBinding(world, "b2", { sessionId: "s2" });
  world.rollUsage = { inputTokens: 4_000, outputTokens: 300 };
  world.deps.rollSummary = async () => {
    rolls += 1;
    // Stop lands while this run is still getting itself ready: the roll has
    // spent, and the run has a row but will never reach the model.
    cancelAutomationRun(world.runs[0].id, world.deps);
    return { summary: "Rolled summary.", usage: world.rollUsage };
  };

  const runs = await withDeadline(
    runAutomationNow("a1", undefined, world.deps),
    2_000,
    "a cancelled run still has to return"
  );
  assert.equal(rolls, 1, "fixture sanity: the second place rolled before it was stopped");
  assert.deepEqual(runs.map((run) => run.status), ["success", "cancelled"]);
  assert.equal(
    world.streamCalls.length,
    1,
    "fixture sanity: the stopped run never reached the provider"
  );
  assert.equal(runs[1].inputTokens, 4_000, "the roll it already paid for is recorded");
  assert.equal(runs[1].outputTokens, 300);
}

// --- unreported stays unreported, even with a roll in front of it -----------
{
  // Adding a reported number to an unreported one must not invent the missing
  // half as zero: a total that is short of the truth has to say so (13).
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");
  world.usage = null;

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.rolls.length, 1, "fixture sanity: it rolled");
  assert.equal(
    run.inputTokens,
    undefined,
    "a roll nobody counted plus a turn nobody counted is still nobody counting"
  );
}

// --- the daily cap is one binding's business, not everybody's ---------------
{
  // Guard rail 7 records the same `budget` code as 4b, and the runner used to
  // raise the app-wide pause on either. So a coach that had already run its
  // three times today held *every* automation the athlete has — and stopped the
  // rest of its own fan-out on the way out.
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.automations.get("a1").conditions = {
    cooldownMin: 0,
    maxRunsPerDay: 1
  };
  // b1 has had its one run for the day; b2 and b3 have not.
  world.runs.push({
    id: "earlier",
    automationId: "a1",
    bindingId: "b1",
    status: "success",
    triggerKind: "schedule",
    startedAt: world.now.toISOString()
  });

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );

  assert.equal(runs[0].skipReason, "budget", "b1 has had its allowance");
  assert.match(
    runs[0].error,
    /already run 1 times? here today/,
    "and the row says which of the two `budget` means"
  );
  assert.equal(
    world.pause,
    null,
    "one binding's day is not one fact about every automation the athlete has"
  );
  assert.deepEqual(
    runs.map((run) => run.status),
    ["skipped", "success", "success"],
    "and the other places this trigger was going to reach still run"
  );
}

// --- the month's ceiling still does both ------------------------------------
{
  // The half that *is* one fact about everything: it pauses, and the fan-out
  // that hit it stops there rather than writing the same row per binding.
  resetAutomationQueueForTests();
  const world = threePlaceWorld();
  world.budget = 500_000;
  world.monthToDateTokens = 500_000;

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.deepEqual(runs.map((run) => run.skipReason), ["budget"], "one row explains it");
  assert.equal(world.pause.reason, "budget");
  assert.equal(world.pause.runId, runs[0].id, "and the banner points at it");
}

// --- the burst guard counts everything that lands in the conversation -------
{
  // 2.3 is counting what reaches the transcript, and a silent run reaches it:
  // 5.5's trace is persisted exactly the way an answer is, and it cost a full
  // provider turn to decide on. Counting only `success` let five coaches
  // conclude "nothing new" into one conversation every hour, for ever, at full
  // price — the burst the guard exists to stop, minus the words.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1");
  for (let index = 0; index < SESSION_BURST_PER_HOUR; index += 1) {
    world.runs.push({
      id: `silent-${index}`,
      automationId: "a1",
      bindingId: "b1",
      sessionId: "s1",
      status: "silent",
      triggerKind: "schedule",
      startedAt: new Date(world.now.getTime() - MINUTE).toISOString()
    });
  }

  const [run] = await runAutomationTrigger(
    { automationId: "a1", kind: "schedule" },
    world.deps
  );
  assert.equal(run.skipReason, "burst", "five traces in an hour is a full conversation");
  assert.equal(world.streamCalls.length, 0, "and nothing was spent finding that out");
}


// ---------------------------------------------------------------------------
// The trigger's own state, through every way a run can end (R2 step 3)
// ---------------------------------------------------------------------------

// --- landing the answer is the last thing that can fail --------------------
{
  // The watermark used to move *before* the transcript was written, and the
  // write was the one step outside the run's own error handling. So a throw
  // there recorded "analysed" for an answer nobody can read, left this row
  // saying `running` until the next launch reconciled it, and wrote a second
  // row as `failed` from the fan-out's handler. Three wrong facts from one
  // throw, and the activity was gone for good.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  const activity = addActivity(world, "act-1", 1);
  world.deps.saveSession = () => {
    throw new Error("the conversation went away under it");
  };

  const runs = await runAutomationTrigger(
    { automationId: "a1", kind: "activity" },
    world.deps
  );

  assert.equal(runs.length, 1, "one throw is one run, not two rows");
  assert.equal(runs[0].status, "failed");
  assert.match(runs[0].error, /went away under it/);
  assert.equal(
    world.runs.filter((run) => run.status === "running").length,
    0,
    "and nothing is left saying `running` for the next launch to reconcile"
  );
  assert.notEqual(
    world.bindings.get("b1").lastActivityAt,
    activity.start_time,
    "the activity was never written, so it is still owed"
  );
  // Which is the whole point: the next trigger picks it up again.
  world.deps.saveSession = (sessionId, entries) => {
    world.sessions.get(sessionId).entries = entries;
  };
  world.bindings.get("b1").backoffUntil = undefined;
  world.bindings.get("b1").backoffLevel = undefined;
  const [retry] = await runAutomationTrigger(
    { automationId: "a1", kind: "activity" },
    world.deps
  );
  assert.equal(retry.status, "success");
  assert.equal(world.bindings.get("b1").lastActivityAt, activity.start_time);
}

// --- a run that reached the model and then failed to land still backs off ---
{
  // It asked the provider, so the streak is a claim it is entitled to make —
  // and without it an activity trigger would re-offer the same activity on
  // every 15-minute poll into a store that keeps refusing it.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1");
  world.deps.saveSession = () => {
    throw new Error("nope");
  };

  await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.bindings.get("b1").backoffLevel, 1, "the first step of the backoff");
}

// --- a silent run that cannot land its trace is the same story -------------
{
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "act-1", 1);
  world.outcome = { text: NOTHING_TO_REPORT };
  world.deps.saveSession = () => {
    throw new Error("no trace either");
  };

  const [run] = await runAutomationTrigger(
    { automationId: "a1", kind: "activity" },
    world.deps
  );
  assert.equal(run.status, "failed", "a trace that never landed is not a silent run");
  assert.equal(
    world.bindings.get("b1").lastActivityAt,
    RUNNER_NOW_EPOCH - 8 * 86_400,
    "and the activity is still owed"
  );
}

// --- a binding detached mid-run leaves its clocks nowhere to be written ----
{
  // Detach deletes the row (2.4). The run in flight holds the old copy, so
  // every clock write it makes afterwards has no row to land on. It must not
  // throw its way out — the answer is already in the conversation, and a run
  // that wrote its answer and then crashed on bookkeeping is the worst of both.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { trigger: ACTIVITY_TRIGGER, conditions: NO_LIMITS });
  addSession(world, "s1");
  addBinding(world, "b1", { sessionId: "s1", lastActivityAt: RUNNER_NOW_EPOCH - 8 * 86_400 });
  addActivity(world, "act-1", 1);
  const original = world.deps.streamChat;
  world.deps.streamChat = async (...args) => {
    world.bindings.delete("b1");
    return original(...args);
  };

  const [run] = await runAutomationTrigger(
    { automationId: "a1", kind: "activity" },
    world.deps
  );
  assert.equal(run.status, "success", "the answer still lands where it was told to");
  assert.equal(world.sessions.get("s1").entries.length, 2, "playbook and answer");
}


// ---------------------------------------------------------------------------
// The conversation cluster (R2 step 4)
// ---------------------------------------------------------------------------

// --- the roll runs on the coach the athlete chose --------------------------
{
  // A roll is a provider turn taken on this automation's behalf: its cost lands
  // on this run's row (13), and guard rail 3 pre-flighted *this* provider and
  // no other. It used to go out with no runtime at all, so it silently spent on
  // whatever the interactive chat happened to be set to — an automation pointed
  // at a second provider had its summariser billed to the first, on a provider
  // nothing had checked was even usable.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", {
    conditions: NO_LIMITS,
    runtime: { provider: "claude-api", model: "claude-opus-5", effort: "high" }
  });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");

  await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.rolls.length, 1, "fixture sanity: it rolled");
  assert.equal(world.rolls[0].runtime.provider, "claude-api");
  assert.equal(world.rolls[0].runtime.model, "claude-opus-5");
  // Effort is the one thing that does not inherit: it is cost rather than
  // capability (7), and a summariser compressing text it was handed has nothing
  // to think harder about.
  assert.equal(
    world.rolls[0].runtime.effort,
    "high",
    "the runner hands the run's resolved runtime over unchanged"
  );
  assert.equal(
    world.streamCalls[0].options.runtime.provider,
    "claude-api",
    "and the run itself is on the same provider, which is the whole point"
  );
}

// --- a summary with no count describes nothing -----------------------------
{
  // 5.7: the pair is one fact and is always written together. A roll only
  // happens once the uncovered stretch passes LIMIT, so the count it writes can
  // never be below LIMIT - KEEP — a stored zero is a half-written row, and the
  // safe reading is *no summary*, the way section 10 reads a half-written pause
  // as *not paused*. Trusting it sends a summary of turns the model is also
  // about to read in full, and nothing downstream could notice.
  const entries = transcript(30);
  const plan = planTranscriptContext(entries, {
    summary: "Half a row.",
    through: 0
  });
  assert.equal(plan.summary, undefined, "a count of zero is not a count");
  assert.equal(plan.tail.length, 30, "so the whole transcript goes, once");
  assert.deepEqual(plan.toSummarise, []);
  assert.equal(plan.through, 0);

  // The honest pair is untouched.
  const good = planTranscriptContext(entries, { summary: "Real.", through: 10 });
  assert.equal(good.summary, "Real.");
  assert.equal(good.tail.length, 20);
}

// --- a roll racing the athlete's turn leaves the pair describing the truth --
{
  // The roll is a provider turn, so the athlete can type through it. Its count
  // is computed against the snapshot the run read, and committed minutes later
  // against a longer transcript — which is safe only because every other writer
  // appends: the entries the summary covers are the same entries they were.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addSession(world, "s1", transcript(100));
  addBinding(world, "b1");
  world.deps.rollSummary = async (previous, entries) => {
    world.rolls.push({ previous, count: entries.length });
    // The athlete says something while the summariser is thinking.
    world.sessions.get("s1").entries = [
      ...world.sessions.get("s1").entries,
      { kind: "message", role: "user", content: "Quick question." }
    ];
    return { summary: "Rolled summary." };
  };

  await runAutomationNow("a1", undefined, world.deps);
  assert.deepEqual(world.summaryWrites, [
    { sessionId: "s1", summary: "Rolled summary.", through: 80 }
  ]);
  const landed = world.sessions.get("s1").entries;
  assert.equal(
    landed.filter((entry) => entry.content === "Quick question.").length,
    1,
    "the athlete's turn survives the run's append, exactly once"
  );

  // And the pair still accounts for the whole transcript: nothing between the
  // summary's end and the tail's start, and nothing counted twice.
  const next = planTranscriptContext(landed, world.summaries.get("s1"));
  assert.equal(next.summary, "Rolled summary.");
  assert.equal(
    next.through + next.tail.length,
    landed.length,
    "summary + tail is the whole conversation, still"
  );
}

// --- a rebuilt conversation starts with no summary -------------------------
{
  // 2.4: a `dedicated` binding whose conversation the athlete deleted builds a
  // new one. The summary lived on the deleted row and went with it, so the new
  // conversation must not inherit a count describing a transcript that no
  // longer exists — 5.7 calls that the one failure nobody can notice by reading
  // the answer.
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addBinding(world, "b1", { mode: "dedicated", sessionId: "s-gone" });
  world.summaries.set("s-gone", { summary: "Stale.", through: 80 });

  const [run] = await runAutomationNow("a1", undefined, world.deps);
  assert.equal(run.status, "success");
  assert.notEqual(run.sessionId, "s-gone", "it rebuilt rather than wrote nowhere");
  assert.deepEqual(world.rolls, [], "an empty conversation has nothing to trim");
  assert.equal(
    world.summaries.get(run.sessionId),
    undefined,
    "and no summary followed it across"
  );
  assert.deepEqual(
    lastWire(world).map((message) => message.role),
    ["user"],
    "so the model gets the playbook and nothing standing in for a lost thread"
  );
}

// --- a per-run binding never trims, however many runs it has made ----------
{
  // Each run gets its own conversation, so the count that says "nothing to
  // trim" is the same count, every time — no special case needed (5.7).
  resetAutomationQueueForTests();
  const world = createWorld();
  addAutomation(world, "a1", { conditions: NO_LIMITS });
  addBinding(world, "b1", {
    mode: "per-run",
    sessionId: null,
    titleTemplate: "{{rule.name}} · {{date}}"
  });

  await runAutomationNow("a1", undefined, world.deps);
  await runAutomationNow("a1", undefined, world.deps);
  assert.equal(world.sessions.size, 2, "one conversation per run");
  assert.deepEqual(world.rolls, []);
  assert.deepEqual(world.summaryWrites, []);
}

console.log("coach automation runner tests passed");
