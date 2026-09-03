// The renderer, executed rather than grepped (section 11, phase 3 item 2).
//
// Every phase-2 UAT bug was renderer wiring that type-checked, and the cover it
// had was a regex over the source. A regex proves the code is present; three of
// those assertions passed against genuinely broken code until they were
// mutated, because the regex matched a *different* call site or asserted a
// query existed without asserting where its answer went.
//
// This suite mounts the real components in a real Chromium — Electron's, which
// the repo already depends on and already runs `coach-automation-sql` under, so
// it costs no new dependency — against a stubbed `CorosLinkApi`. It drives them
// through the DOM and asserts here, in node, so a failure reads like every
// other suite.
//
// What stays a source assertion is what is genuinely about source: the
// ipc-surface pair (a preload/main contract, not a behaviour) and the marker
// held back from the live bubble.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Headless CI and containers have no usable sandbox, and this window never
// loads anything but a local file the repo built a moment ago.
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_SETTINGS = {
  provider: "claude-code",
  chatgpt: {},
  anthropic: { model: "claude-opus-5", effort: "high", hasApiKey: false },
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
  local: {
    baseUrl: "http://localhost:11434/v1",
    model: "",
    hasApiKey: false,
    toolsEnabled: true
  },
  sidebarOpen: true,
  visualizationsEnabled: false,
  customInstructions: ""
};

const session = (id, title) => ({
  id,
  provider: "claude-code",
  title,
  preview: "",
  updatedAt: "2026-08-25T09:00:00.000Z",
  createdAt: "2026-08-25T08:00:00.000Z",
  messageCount: 0
});

const automation = (id, name, patch = {}) => ({
  id,
  name,
  playbook: "Summarise yesterday.",
  enabled: true,
  trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:30" },
  conditions: { batchWindowMin: 0, cooldownMin: 0, maxRunsPerDay: 3 },
  runtime: {},
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...patch
});

const binding = (id, patch = {}) => ({
  id,
  automationId: "a1",
  mode: "existing",
  sessionId: "s1",
  enabled: true,
  sortOrder: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...patch
});

const summary = (auto, patch = {}) => ({
  automation: auto,
  bindingCount: 1,
  enabledBindingCount: 1,
  ...patch
});

/**
 * What ChatView needs on screen before it can be asked about automations at
 * all. None of it is what these tests are about; it is here so each test's own
 * script says only what that test changed.
 */
const CHAT_VIEW_BASE = {
  getChatAuthStatus: { signedIn: true },
  getChatSettings: CHAT_SETTINGS,
  getClaudeCodeStatus: { state: "connected" },
  getCorosMcpStatus: { connected: false },
  getMcpStatuses: [],
  getChatSession: [],
  listCoachAutomationSessionAttention: [],
  listCoachAutomationsForSession: [],
  listCoachAutomations: []
};

const run = (id, patch = {}) => ({
  id,
  automationId: "a1",
  bindingId: "b1",
  status: "running",
  triggerKind: "manual",
  startedAt: "2026-08-25T09:00:00.000Z",
  ...patch
});

// ---------------------------------------------------------------------------
// Driving the page
// ---------------------------------------------------------------------------

let win;

/** One command on `window.__harness`, arguments crossing as JSON. */
function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return win.webContents.executeJavaScript(`window.__harness.${method}(${list})`, true);
}

/**
 * React settles on its own clock, not on the driver's, and every read is an
 * IPC round trip anyway — so nothing here sleeps for a fixed time. It polls
 * until the claim is true, which is also what makes a failure say *what* never
 * became true rather than "expected 1, got 0".
 */
async function waitFor(read, what, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (last) return last;
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for: ${what} (last saw ${JSON.stringify(last)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * The negative half of a claim. A wire that fires for everything passes every
 * "did it fire" test, so the tests that matter are the ones that say when it
 * must not — and those need a settled page rather than a poll that would
 * happily return early.
 */
async function settle() {
  // Timers only, never `requestAnimationFrame`. The window is never shown, so
  // it never composites, so rAF never fires — a settle built on it waits
  // forever rather than failing, which is the worst way for a test to be wrong.
  for (let pass = 0; pass < 5; pass += 1) {
    await win.webContents.executeJavaScript(
      "new Promise((resolve) => setTimeout(resolve, 0))",
      true
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Nothing the page shouted while the test was busy reading the DOM. */
async function assertQuietConsole(what) {
  const errors = await harness("consoleErrors");
  // React logs the same act() advice for anything driven from outside its own
  // scheduler, which is exactly what this harness does on purpose.
  const real = errors.filter((line) => !/not wrapped in act/i.test(line));
  assert.deepEqual(real, [], `${what} must not log to the console`);
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1200,
    webPreferences: { backgroundThrottling: false }
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));

  assert.equal(
    await win.webContents.executeJavaScript("typeof window.__harness", true),
    "object",
    "the harness page has to be built before it can be driven"
  );
  assert.equal(
    await harness("dev"),
    true,
    "the harness must run React's development build, or its warnings are gone"
  );

  // -------------------------------------------------------------------------
  // 3.4: the run-now picker's threshold
  // -------------------------------------------------------------------------
  // Ported from a regex over `if (summary.bindingCount > 1)`. The regex could
  // not tell that the branch runs, that the dialog appears, or that the
  // athlete's choice reaches the runner — and the last of those is the whole
  // point of asking.
  {
    await harness(
      "mount",
      "CoachAutomationsPanel",
      {},
      { listCoachAutomations: [summary(automation("a1", "Post-run debrief"))] }
    );
    await waitFor(
      () => harness("exists", ".coach-automation-card-actions"),
      "the panel renders its cards"
    );

    await harness("clickText", "button", "Run now");
    await waitFor(
      () => harness("callCount", "runCoachAutomationNow"),
      "one place runs straight away"
    );
    assert.equal(
      await harness("exists", ".coach-automation-dialog"),
      false,
      "and does not ask a question with one answer"
    );
    const [straight] = await harness("calls", "runCoachAutomationNow");
    assert.deepEqual(
      straight.args,
      ["a1", undefined],
      "with no binding list, so the runner fans out to every place"
    );

    // Two places is a real choice: one model call and one conversation each.
    await harness(
      "mount",
      "CoachAutomationsPanel",
      {},
      {
        listCoachAutomations: [
          summary(automation("a1", "Post-run debrief"), {
            bindingCount: 2,
            enabledBindingCount: 1
          })
        ],
        getCoachAutomation: {
          automation: automation("a1", "Post-run debrief"),
          bindings: [
            binding("b1", { sessionId: "s1" }),
            binding("b2", { sessionId: "s2", enabled: false })
          ]
        }
      }
    );
    await waitFor(
      () => harness("exists", ".coach-automation-card-actions"),
      "the panel renders its cards"
    );
    await harness("clickText", "button", "Run now");
    await waitFor(
      () => harness("exists", ".coach-automation-dialog"),
      "several places ask which"
    );
    assert.equal(
      await harness("callCount", "runCoachAutomationNow"),
      0,
      "and nothing runs until it is answered"
    );

    // The default is every *live* place, not every place: a paused binding is
    // listed so "run it anyway" stays possible, but never ticked.
    await waitFor(
      () => harness("clickText", ".coach-automation-confirm-actions button", "Run in"),
      "the dialog offers to run"
    );
    const [picked] = await waitFor(
      async () => {
        const made = await harness("calls", "runCoachAutomationNow");
        return made.length ? made : null;
      },
      "the answer reaches the runner"
    );
    assert.deepEqual(
      picked.args,
      ["a1", ["b1"]],
      "the paused place is offered, unticked — the default is every live one"
    );
    await assertQuietConsole("the run-now picker");
  }

  // -------------------------------------------------------------------------
  // 9.3: the popover reporting an attach
  // -------------------------------------------------------------------------
  // Ported from a regex over `onAttached={async () => { await refresh(); ... }`.
  // The ⚡ mark in the sidebar is derived from the bindings, so a popover that
  // changes them and says nothing leaves the mark where it was until restart.
  {
    await harness(
      "mount",
      "ConversationCoaches",
      { sessionId: "s1" },
      {
        listCoachAutomationsForSession: [],
        listCoachAutomations: [summary(automation("a1", "Post-run debrief"))],
        listCoachAutomationRuns: [],
        attachCoachAutomation: { ok: true, binding: binding("b1") }
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the chip renders"
    );
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      () => harness("exists", ".chat-coaches-attach"),
      "the popover opens"
    );

    // From here the athlete is attaching, and the parent has heard nothing yet.
    await harness("clearCalls");
    await harness("click", ".chat-coaches-attach");
    await waitFor(
      () => harness("exists", ".coach-automation-dialog"),
      "the attach dialog opens"
    );
    await harness("clickText", ".coach-automation-session-row", "Post-run debrief");

    await waitFor(
      () => harness("callCount", "attachCoachAutomation"),
      "the coach is attached"
    );
    await waitFor(
      () => harness("callCount", "prop:onChanged"),
      "and the popover has to tell the screen around it, or the ⚡ mark never moves"
    );
    assert.ok(
      await harness("callCount", "listCoachAutomationsForSession"),
      "and re-read its own rows, or the new coach is not in the list it just changed"
    );
    await assertQuietConsole("the attach popover");
  }

  // -------------------------------------------------------------------------
  // The popover following an edit to the coach it is already showing
  // -------------------------------------------------------------------------
  // Every row here is drawn from the definition — the coach's name, the trigger
  // under it, the master switch that decides whether it reads "Running here" —
  // and a definition change carried no push at all. `refreshVersion` covers an
  // edit made through the Automations modal the parent owns and nothing else,
  // so a rename left every conversation the coach is attached to showing the
  // old name. Detaching and re-attaching was the way out, because that emits a
  // binding update and a binding update forces a re-read.
  {
    await harness(
      "mount",
      "ConversationCoaches",
      { sessionId: "s1" },
      {
        listCoachAutomationsForSession: [binding("b1")],
        listCoachAutomations: [summary(automation("a1", "Morning briefing"))],
        listCoachAutomationRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the chip renders"
    );
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      async () =>
        (await harness("text", ".chat-coaches-row-name"))?.includes(
          "Morning briefing"
        ) || null,
      "the attached coach is named in the popover"
    );

    // The athlete renames the coach somewhere else. Nothing about this
    // conversation's bindings changed, and no run happened.
    await harness("setScript", {
      listCoachAutomations: [summary(automation("a1", "Evening debrief"))]
    });
    await harness("emit", "onCoachAutomationUpdate", {
      automationId: "a1",
      automation: automation("a1", "Evening debrief")
    });
    await waitFor(
      async () =>
        (await harness("text", ".chat-coaches-row-name"))?.includes(
          "Evening debrief"
        ) || null,
      "the row follows the edit without the athlete detaching and re-attaching"
    );
    await assertQuietConsole("an edit reaching the popover");
  }

  // -------------------------------------------------------------------------
  // The master switch reaching the conversations the coach is attached to
  // -------------------------------------------------------------------------
  // A binding runs only when its own switch and the automation's are both on,
  // which is what the runner checks and what `listCoachAutomationSessionAttention`
  // counts. Switching a coach off therefore moves the ⚡ mark on conversations
  // this window never touched — with no binding update and no run to say so.
  {
    await harness("mount", "ChatView", {}, {
      ...CHAT_VIEW_BASE,
      listChatSessions: [session("s1", "Morning briefing")],
      listCoachAutomationRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar"
    );

    await harness("clearCalls");
    await harness("emit", "onCoachAutomationUpdate", {
      automationId: "a1",
      automation: automation("a1", "Morning briefing", { enabled: false })
    });
    await waitFor(
      () => harness("callCount", "listCoachAutomationSessionAttention"),
      "switching a coach off has to re-read the marks it just changed"
    );
    await assertQuietConsole("a definition change reaching the attention marks");
  }

  // -------------------------------------------------------------------------
  // 9.3: a run reaching into the conversation list
  // -------------------------------------------------------------------------
  // Ported from a regex over `if (!run.sessionId) return; void refreshSessions`.
  // The regex matched the guard and the call; it could not tell they were the
  // same listener, nor that the guard is what stops every skip in a fan-out
  // re-reading the list for nothing.
  {
    await harness("mount", "ChatView", {}, {
      ...CHAT_VIEW_BASE,
      listChatSessions: [session("s1", "Morning briefing")],
      listCoachAutomationRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar"
    );

    await harness("clearCalls");
    await harness("emit", "onCoachAutomationRunUpdate", run("r1", { sessionId: "s2" }));
    await waitFor(
      () => harness("callCount", "listChatSessions"),
      "a run that reaches into the conversation list must make the sidebar re-read it"
    );

    // The other half of the wire, and the half a regex cannot see: a run with
    // no conversation touched nothing, so it must not cost a re-read. A fan-out
    // declining across five paused places is five of these.
    await harness("clearCalls");
    await harness(
      "emit",
      "onCoachAutomationRunUpdate",
      run("r2", { status: "skipped", skipReason: "cooldown" })
    );
    await settle();
    assert.equal(
      await harness("callCount", "listChatSessions"),
      0,
      "a run with no conversation has nothing for the list to re-read"
    );
    await assertQuietConsole("a run update reaching ChatView");
  }

  // -------------------------------------------------------------------------
  // 9.3: a run into a conversation nobody is looking at
  // -------------------------------------------------------------------------
  // Ported from the weakest regex in the block — one that *counted call sites*
  // (`onCoachAutomationRunUpdate` appearing three times) and called that a
  // claim about behaviour. What it was reaching for is this: the live-view
  // subscription ignores runs into conversations that are not open, which is
  // exactly the case the unread dot exists for, so something else has to watch
  // them. The counting version passes if all three listeners do the same thing.
  {
    await harness("mount", "ChatView", {}, {
      ...CHAT_VIEW_BASE,
      listChatSessions: [
        session("s1", "Morning briefing"),
        session("s2", "Post-run debrief")
      ],
      listCoachAutomationRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar"
    );

    // s1 is the conversation ChatView opened on mount; the run landed in s2.
    await harness("clearCalls");
    await harness(
      "emit",
      "onCoachAutomationRunUpdate",
      run("r1", { status: "success", sessionId: "s2", summary: "Load is ramping." })
    );
    await waitFor(
      () => harness("callCount", "listCoachAutomationSessionAttention"),
      "a run into a conversation nobody is looking at must re-read the marks"
    );
    assert.equal(
      await harness("callCount", "markCoachAutomationSessionSeen"),
      0,
      "and must not mark it read — that dot is the only thing that says it happened"
    );

    // The same run into the conversation that *is* open is the opposite: the
    // answer is already on screen, so it is read the moment it arrives.
    await harness("clearCalls");
    await harness(
      "emit",
      "onCoachAutomationRunUpdate",
      run("r2", { status: "success", sessionId: "s1", summary: "Load is ramping." })
    );
    const [seen] = await waitFor(
      async () => {
        const made = await harness("calls", "markCoachAutomationSessionSeen");
        return made.length ? made : null;
      },
      "a run into the open conversation is read on arrival"
    );
    assert.deepEqual(seen.args, ["s1"]);
    await assertQuietConsole("a run update reaching the attention marks");
  }

  // -------------------------------------------------------------------------
  // 9.3: a run into the open conversation while the Coach view is not on screen
  // -------------------------------------------------------------------------
  // The Coach panel stays mounted once it has been opened, so a conversation
  // stays "open" long after the athlete has walked away to Overview. Reading
  // that as "the athlete is looking at it" marked an auto run read the instant
  // it landed, and the unread dot — the only thing that says an automation ran
  // while nobody was watching — was cleared before it was ever drawn.
  {
    await harness("mount", "ChatView", { active: false }, {
      ...CHAT_VIEW_BASE,
      listChatSessions: [session("s1", "Morning briefing")],
      listCoachAutomationRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar even behind another view"
    );

    await harness("clearCalls");
    await harness(
      "emit",
      "onCoachAutomationRunUpdate",
      run("r1", { status: "success", sessionId: "s1", summary: "Load is ramping." })
    );
    await waitFor(
      () => harness("callCount", "listCoachAutomationSessionAttention"),
      "a run into a conversation nobody is looking at must re-read the marks"
    );
    assert.equal(
      await harness("callCount", "markCoachAutomationSessionSeen"),
      0,
      "the conversation is open but off screen — marking it read loses the dot"
    );

    // Coming back to the Coach view *is* reading it: the answer is on screen by
    // then, so a dot left standing could never be cleared.
    await harness("clearCalls");
    await harness("setProps", { active: true });
    const [seenOnReturn] = await waitFor(
      async () => {
        const made = await harness("calls", "markCoachAutomationSessionSeen");
        return made.length ? made : null;
      },
      "returning to the Coach view reads what landed while it was hidden"
    );
    assert.deepEqual(seenOnReturn.args, ["s1"]);
    await assertQuietConsole("a run landing behind another view");
  }

  // -------------------------------------------------------------------------
  // 5.6b: the live bubble re-establishing on a conversation opened mid-run
  // -------------------------------------------------------------------------
  // Ported from a regex over `statuses: ["running"] ... showLiveAutomation`.
  // That one asserted a query existed and that a call site existed within 200
  // characters of it — not that opening a conversation runs the query, and not
  // that the answer reaches the screen.
  {
    await harness(
      "mount",
      "ChatView",
      {},
      {
        ...CHAT_VIEW_BASE,
        listChatSessions: [
          session("s1", "Morning briefing"),
          session("s2", "Post-run debrief")
        ],
        getCoachAutomation: {
          automation: automation("a1", "Post-run debrief"),
          bindings: []
        },
        // Only the second conversation is being written into. The first is the
        // one ChatView opens on mount, so a bubble on screen before the click
        // would be the query answering indiscriminately rather than per
        // conversation.
        __byArg: {
          listCoachAutomationRuns: {
            [JSON.stringify({
              sessionId: "s2",
              statuses: ["running"],
              limit: 1
            })]: [run("r1", { sessionId: "s2" })],
            "*": []
          }
        }
      }
    );
    await waitFor(
      () => harness("count", ".chat-session-row"),
      "ChatView renders both conversations"
    );
    await settle();
    assert.equal(
      await harness("exists", ".chat-automation-attribution"),
      false,
      "the conversation opened on mount has no run in it"
    );

    // The athlete opens the other one, which a `per-run` binding invites: its
    // conversation appears in the sidebar the moment the run starts.
    await harness("clickText", ".chat-session-row", "Post-run debrief");
    const attribution = await waitFor(
      () => harness("text", ".chat-automation-attribution"),
      "opening a conversation mid-run must pick up the run already streaming into it"
    );
    // And it names the coach: the run record carries ids, so the chip is worth
    // the one lookup that turns them into something the athlete recognises.
    assert.match(
      attribution,
      /Post-run debrief/,
      "and say which coach is speaking, not just that something is"
    );
    await assertQuietConsole("opening a conversation mid-run");
  }

  // -------------------------------------------------------------------------
  // 10: the pause banner and its single way to resume
  // -------------------------------------------------------------------------
  // The trip happens with no window open — a 07:30 briefing finding COROS
  // asking for a login code — so the banner has to read the flag on mount and
  // follow the push afterwards. Neither half is visible to a regex.
  {
    const held = {
      reason: "two-factor-required",
      since: "2026-08-25T07:30:00.000Z",
      runId: "r1"
    };
    await harness("mount", "CoachAutomationsPanel", {}, {
      listCoachAutomations: [summary(automation("a1", "Post-run debrief"))],
      getCoachAutomationPause: held,
      resumeCoachAutomations: null
    });

    const banner = await waitFor(
      () => harness("text", ".coach-automation-banner"),
      "a pause that happened while the window was closed still has to show"
    );
    assert.match(banner, /Every automation is paused/);
    assert.match(banner, /login code/, "and say what has to happen");

    await harness("clickText", ".coach-automation-banner button", "Resume");
    await waitFor(
      () => harness("callCount", "resumeCoachAutomations"),
      "Resume has to reach the main process, not just clear the banner"
    );
    await waitFor(
      async () => (await harness("exists", ".coach-automation-banner")) === false,
      "and the banner goes with it"
    );
    await assertQuietConsole("the pause banner");

    // The other direction: the pause arrives by push while the panel is open,
    // which is what happens when a scheduled run trips it with the athlete
    // looking at this very screen.
    await harness("emit", "onCoachAutomationPauseUpdate", held);
    await waitFor(
      () => harness("exists", ".coach-automation-banner"),
      "a pause tripped while the panel is open must appear without a re-read"
    );
    await harness("emit", "onCoachAutomationPauseUpdate", null);
    await waitFor(
      async () => (await harness("exists", ".coach-automation-banner")) === false,
      "and clearing it from elsewhere must take the banner away"
    );
    await assertQuietConsole("a pause arriving by push");
  }

  // -------------------------------------------------------------------------
  // 12 (item 6): the number, and the ceiling that stops the spending
  // -------------------------------------------------------------------------
  // "There is no number anywhere saying what that costs" was the whole of the
  // item. A regex could say the field exists; it could not say the athlete's
  // typed ceiling reaches the main process, which is the half that matters.
  {
    await harness("mount", "CoachAutomationsPanel", {}, {
      listCoachAutomations: [summary(automation("a1", "Post-run debrief"))],
      getCoachAutomationPause: null,
      getCoachAutomationSpend: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 412_000,
        outputTokens: 71_000,
        budget: 500_000,
        countedRuns: 12,
        providerRuns: 12
      },
      setCoachAutomationBudget: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 412_000,
        outputTokens: 71_000,
        budget: 900_000,
        countedRuns: 12,
        providerRuns: 12
      }
    });

    const spend = await waitFor(
      () => harness("text", ".coach-automation-spend"),
      "the panel has to say what the month has cost"
    );
    assert.match(spend, /483k/, "rounded, because nobody budgets to the token");
    assert.match(spend, /tokens this month/);
    assert.doesNotMatch(
      spend,
      /not counted/,
      "and says nothing about uncounted runs when every run was counted"
    );

    // The ceiling reaches the main process, and what comes back is what the
    // field then shows — not the string the athlete typed.
    await harness("setValue", ".coach-automation-budget input", "900000");
    await harness("blur", ".coach-automation-budget input");
    const [committed] = await waitFor(
      async () => {
        const made = await harness("calls", "setCoachAutomationBudget");
        return made.length ? made : null;
      },
      "the typed ceiling has to reach the main process"
    );
    assert.deepEqual(committed.args, [900_000], "as a number, not as the typed string");
    await waitFor(
      async () => (await harness("value", ".coach-automation-budget input")) === "900000",
      "and the field shows what came back"
    );
    await assertQuietConsole("the spend line");
  }

  // --- a total that is short of the truth says so ---------------------------
  {
    // A budget that read as comfortably under when nobody actually knows is
    // worse than no budget: it is a number the athlete would trust.
    await harness("mount", "CoachAutomationsPanel", {}, {
      listCoachAutomations: [summary(automation("a1", "Post-run debrief"))],
      getCoachAutomationSpend: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 1_000,
        outputTokens: 200,
        budget: null,
        countedRuns: 3,
        providerRuns: 7
      }
    });

    const spend = await waitFor(
      () => harness("text", ".coach-automation-spend"),
      "the panel renders its spend line"
    );
    assert.match(spend, /4 runs not counted/, "and names how many it cannot see");
    assert.equal(
      await harness("value", ".coach-automation-budget input"),
      "",
      "no ceiling shows as empty, not as zero"
    );
    await assertQuietConsole("an under-counted total");
  }

  // --- a budget pause says which of the two reasons it is -------------------
  {
    await harness("mount", "CoachAutomationsPanel", {}, {
      listCoachAutomations: [summary(automation("a1", "Post-run debrief"))],
      getCoachAutomationPause: {
        reason: "budget",
        since: "2026-09-20T07:30:00.000Z",
        runId: "r1"
      },
      getCoachAutomationSpend: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 500_000,
        outputTokens: 0,
        budget: 500_000,
        countedRuns: 20,
        providerRuns: 20
      }
    });

    const banner = await waitFor(
      () => harness("text", ".coach-automation-banner"),
      "a budget pause has to explain itself"
    );
    assert.match(banner, /token budget ran out/);
    assert.doesNotMatch(
      banner,
      /login code/,
      "and must not offer the 2FA advice for a problem that is not 2FA"
    );
    await assertQuietConsole("the budget banner");
  }

  // -------------------------------------------------------------------------
  // 9.1: the slot the scheduler books, on a timer, with nobody watching
  // -------------------------------------------------------------------------
  // "A schedule automation carries when it next fires on the trigger line...
  // It fires with nobody watching, so the card is the only place the athlete
  // can check it without opening anything." The scheduler books that slot on
  // its own tick and there was no run to carry the news, so a briefing created
  // at lunchtime showed no next-run line at all until something unrelated
  // refreshed the screen. It is the first thing an athlete does with a schedule
  // automation and the one question the card exists to answer.
  {
    const booked = automation("a1", "Morning briefing");
    await harness(
      "mount",
      "CoachAutomationsPanel",
      {},
      {
        listCoachAutomations: [summary(booked)],
        getCoachAutomationPause: null,
        getCoachAutomationSpend: {
          monthStart: "2026-08-01T00:00:00.000Z",
          inputTokens: 0,
          outputTokens: 0,
          budget: null,
          countedRuns: 0,
          providerRuns: 0
        }
      }
    );

    await waitFor(
      () => harness("exists", ".coach-automation-card-trigger"),
      "the card renders"
    );
    const before = await harness("text", ".coach-automation-card-trigger");
    assert.doesNotMatch(
      before ?? "",
      / · next /,
      "fixture sanity: no slot has been booked yet"
    );

    // 60 seconds later, in the main process, with this screen open: the
    // scheduler's tick books the slot and pushes.
    await harness("setScript", {
      listCoachAutomations: [
        summary(booked, { nextRunAt: "2026-08-25T18:00:00.000Z" })
      ]
    });
    assert.equal(
      await harness("emit", "onCoachAutomationBindingUpdate", binding("b1", {
        nextRunAt: "2026-08-25T18:00:00.000Z"
      })),
      1,
      "the card has to be listening for it"
    );

    await waitFor(
      async () =>
        / · next /.test((await harness("text", ".coach-automation-card-trigger")) ?? ""),
      "the card says when it next fires"
    );
    await assertQuietConsole("the booked slot");
  }

  // -------------------------------------------------------------------------
  // 2.4: a binding broken while its own tab is open
  // -------------------------------------------------------------------------
  // Guard rail 2 disables an `existing` binding whose conversation the athlete
  // deleted, and a `dedicated` one adopts the conversation it rebuilt. The run
  // log tab hears about both on the run push; the rows a tab away read their
  // bindings once, on mount, and went on showing the toggle on and no broken
  // marker — half of each row live and half from mount.
  {
    const detail = (bindings) => ({
      automation: automation("a1", "Post-run debrief"),
      bindings
    });
    await harness(
      "mount",
      "CoachAutomationDetail",
      { tab: "bindings" },
      {
        __byArg: {
          listCoachAutomationBindings: {
            "*": [
              binding("b1", {
                enabled: false,
                sessionMissing: true,
                sessionTitle: "Tuesday intervals"
              })
            ]
          }
        },
        getCoachAutomation: detail([
          binding("b1", { sessionTitle: "Tuesday intervals" })
        ]),
        listCoachAutomationRuns: []
      }
    );

    await waitFor(
      () => harness("exists", ".coach-automation-binding-row"),
      "the where-it-runs tab renders"
    );
    assert.equal(
      await harness("count", '.coach-automation-binding-row[data-broken="true"]'),
      0,
      "fixture sanity: the row starts healthy"
    );
    await harness("clearCalls");

    assert.equal(
      await harness(
        "emit",
        "onCoachAutomationBindingUpdate",
        binding("b1", { enabled: false })
      ),
      1,
      "the tab has to be listening"
    );

    await waitFor(
      async () =>
        (await harness(
          "count",
          '.coach-automation-binding-row[data-broken="true"]'
        )) === 1,
      "the row goes broken without a reload"
    );
    assert.equal(
      await harness("count", '.coach-automation-binding-row[data-off="true"]'),
      1,
      "and greyed, which is 9.2's own word for it"
    );

    // Narrower than a full refresh on purpose: re-reading the definition would
    // throw away a playbook the athlete is part-way through typing.
    assert.equal(
      await harness("callCount", "getCoachAutomation"),
      0,
      "the definition is not re-read underneath an edit"
    );
    await assertQuietConsole("the broken binding row");
  }

  // --- and a binding belonging to a different coach is not this tab's --------
  {
    // The negative half. A push that fires for everything passes every "did it
    // fire" test, and this screen is one of several open on the same channel.
    await harness(
      "mount",
      "CoachAutomationDetail",
      { tab: "bindings" },
      {
        __byArg: { listCoachAutomationBindings: { "*": [binding("b1")] } },
        getCoachAutomation: {
          automation: automation("a1", "Post-run debrief"),
          bindings: [binding("b1")]
        },
        listCoachAutomationRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".coach-automation-binding-row"),
      "the tab renders"
    );
    await harness("clearCalls");

    await harness(
      "emit",
      "onCoachAutomationBindingUpdate",
      binding("b9", { automationId: "a2" })
    );
    await settle();
    assert.equal(
      await harness("callCount", "listCoachAutomationBindings"),
      0,
      "another coach's binding is not this screen's business"
    );
  }

  // -------------------------------------------------------------------------
  // The same news, on the conversation side
  // -------------------------------------------------------------------------
  {
    // The popover renders the same rows from the other direction, and an
    // athlete who never opens the Automations screen sees only this one.
    await harness(
      "mount",
      "ConversationCoaches",
      {},
      {
        listCoachAutomationsForSession: [binding("b1", { sessionTitle: "Daily" })],
        listCoachAutomations: [summary(automation("a1", "Morning briefing"))],
        listCoachAutomationRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the header chip renders"
    );
    await harness("clearCalls");

    assert.equal(
      await harness("emit", "onCoachAutomationBindingUpdate", binding("b1")),
      1,
      "the popover listens too"
    );
    await waitFor(
      () => harness("callCount", "listCoachAutomationsForSession"),
      "and re-reads its rows"
    );
    await assertQuietConsole("the popover's binding update");
  }

  // -------------------------------------------------------------------------
  // 10: the card's run flag has to outlast the gap inside its own fan-out
  // -------------------------------------------------------------------------
  // Ported from the weakest assertion left in the repo — a *call-site count*
  // (`setStartingId` appearing exactly twice), which is the pattern section 11
  // names as the one worth deleting first. It cannot say what the flag is for,
  // and it fails just as loudly for a correct third call site as for a wrong
  // one.
  //
  // What it was reaching for: a trigger fans out to one run per place and they
  // are serialised (5.4), so between two of them there is a moment with no
  // `running` row at all. A card reading only the log would offer "Run now" in
  // the middle of its own fan-out — and a second press would queue a second
  // one. The flag is set on the click and cleared when the whole fan-out has
  // answered, and nowhere else.
  {
    const fanning = automation("a1", "Post-run debrief");
    await harness(
      "mount",
      "CoachAutomationsPanel",
      {},
      {
        listCoachAutomations: [summary(fanning)],
        getCoachAutomationPause: null,
        getCoachAutomationSpend: {
          monthStart: "2026-08-01T00:00:00.000Z",
          inputTokens: 0,
          outputTokens: 0,
          budget: null,
          countedRuns: 0,
          providerRuns: 0
        },
        // The fan-out is still going when the driver comes back.
        runCoachAutomationNow: "__pending"
      }
    );
    await waitFor(
      () => harness("exists", ".coach-automation-card-actions"),
      "the card renders"
    );

    assert.equal(
      await harness("clickText", ".coach-automation-card-actions button", "Run now"),
      true,
      "one place, so it runs straight away rather than asking which"
    );
    await waitFor(
      () => harness("callCount", "runCoachAutomationNow"),
      "the fan-out started"
    );

    // The first place finished. The second has not started: no `running` row
    // exists anywhere, which is exactly the gap.
    await harness(
      "emit",
      "onCoachAutomationRunUpdate",
      run("run-1", { status: "success", finishedAt: "2026-08-25T09:00:04.000Z" })
    );
    await settle();
    assert.equal(
      await harness("exists", '.coach-automation-card-actions button[aria-busy="true"]'),
      true,
      "the card still says a run is going, with no `running` row to read it from"
    );
    assert.equal(
      await harness("count", ".coach-automation-card-actions button:not([disabled])"),
      1,
      "and the only button left alive is Manage — not a second Run now"
    );

    // The fan-out answers. Now, and only now, the card offers again.
    await harness("resolvePending", "runCoachAutomationNow", []);
    await waitFor(
      async () =>
        (await harness(
          "exists",
          '.coach-automation-card-actions button[aria-busy="true"]'
        )) === false,
      "and once the whole fan-out has answered, it offers again"
    );
    assert.equal(
      await harness("count", ".coach-automation-card-actions button:not([disabled])"),
      2,
      "both actions are live again"
    );
    await assertQuietConsole("the run flag across a fan-out");
  }

  // --- a tick that books several slots at once ------------------------------
  {
    // The scheduler books on its own tick, and one tick can seed every binding
    // of an automation the athlete just attached in five places. That is five
    // pushes in a row into a screen whose refresh sets state that another
    // effect watches — the shape of the infinite render loop phase 1's second
    // review found, which announced itself only in the console.
    const booked = automation("a1", "Morning briefing");
    await harness(
      "mount",
      "CoachAutomationsPanel",
      {},
      {
        listCoachAutomations: [
          summary(booked, { bindingCount: 5, enabledBindingCount: 5 })
        ],
        getCoachAutomationPause: null,
        getCoachAutomationSpend: {
          monthStart: "2026-08-01T00:00:00.000Z",
          inputTokens: 0,
          outputTokens: 0,
          budget: null,
          countedRuns: 0,
          providerRuns: 0
        }
      }
    );
    await waitFor(
      () => harness("exists", ".coach-automation-card-trigger"),
      "the card renders"
    );
    await harness("clearCalls");

    for (const id of ["b1", "b2", "b3", "b4", "b5"]) {
      await harness("emit", "onCoachAutomationBindingUpdate", binding(id, {
        nextRunAt: "2026-08-25T18:00:00.000Z"
      }));
    }
    await settle();

    // Five pushes, five reads, and then it stops. A count that kept climbing
    // after the page settled is the loop this is here to catch.
    const settledReads = await harness("callCount", "listCoachAutomations");
    await settle();
    assert.equal(
      await harness("callCount", "listCoachAutomations"),
      settledReads,
      "the panel settles rather than re-reading itself in a loop"
    );
    assert.ok(
      settledReads <= 5,
      `one read per push at most, saw ${settledReads}`
    );
    await assertQuietConsole("a burst of booked slots");
  }

  // --- and every other way the popover changes a binding says so too --------
  {
    // Found by mutating the suite rather than by reading it: cutting the report
    // out of the popover's shared mutation wrapper — the switch, the reorder,
    // the detach — left the whole renderer suite green. The attach path had a
    // test and these three had only a regex in the bindings suite, which is the
    // kind of claim section 11 says belongs in the harness now that there is
    // one. The ⚡ mark is derived from the bindings, so a place paused here and
    // not reported leaves the mark where it was until the app restarts.
    await harness(
      "mount",
      "ConversationCoaches",
      {},
      {
        listCoachAutomationsForSession: [binding("b1", { sessionTitle: "Daily" })],
        listCoachAutomations: [summary(automation("a1", "Morning briefing"))],
        listCoachAutomationRuns: [],
        setCoachAutomationBindingEnabled: binding("b1", { enabled: false })
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the header chip renders"
    );
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      () => harness("exists", ".chat-coaches-row-switch input"),
      "the popover opens with a row in it"
    );
    await harness("clearCalls");

    await harness("click", ".chat-coaches-row-switch input");
    await waitFor(
      () => harness("callCount", "setCoachAutomationBindingEnabled"),
      "the place is paused"
    );
    await waitFor(
      () => harness("callCount", "prop:onChanged"),
      "and the screen around it is told, or the ⚡ mark never moves"
    );
    await assertQuietConsole("pausing a place from the popover");
  }

  console.log("coach automation renderer tests passed");
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);
