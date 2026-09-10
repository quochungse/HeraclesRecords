// The renderer, executed rather than grepped (section 11, phase 3 item 2).
//
// Every phase-2 UAT bug was renderer wiring that type-checked, and the cover it
// had was a regex over the source. A regex proves the code is present; three of
// those assertions passed against genuinely broken code until they were
// mutated, because the regex matched a *different* call site or asserted a
// query existed without asserting where its answer went.
//
// This suite mounts the real components in a real Chromium — Electron's, which
// the repo already depends on and already runs `coach-analysis-sql` under, so
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

/**
 * One analysis, in one conversation. It defaults to an auto one because most
 * of these cases are about something that runs on its own;
 * `analysis("a1", "X", { trigger: null })` is the manual case.
 */
const analysis = (id, name, patch = {}) => ({
  id,
  sessionId: "s1",
  name,
  playbook: "Summarise yesterday.",
  enabled: true,
  runtime: {},
  trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:30" },
  conditions: { cooldownMin: 0, maxRunsPerDay: 3 },
  deviceOnly: false,
  sortOrder: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...patch
});

const summary = (auto, patch = {}) => ({ analysis: auto, ...patch });

/**
 * What ChatView needs on screen before it can be asked about analyses at
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
  listCoachAnalysisSessionAttention: [],
  listCoachAnalysesForSession: []
};

const run = (id, patch = {}) => ({
  id,
  analysisId: "a1",
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
  // 3.4: Run now runs the one analysis it was pressed on
  // -------------------------------------------------------------------------
  // There used to be a picker here, because one definition could be attached
  // to several conversations and "run it now" had to ask which. An analysis
  // is one place now, so the question has one answer and the button does what
  // it says.
  {
    await harness(
      "mount",
      "ConversationAnalyses",
      { sessionId: "s1" },
      {
        listCoachAnalysesForSession: [
          summary(analysis("a1", "Post-run debrief"))
        ],
        listCoachAnalysisRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the chip renders"
    );
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      () => harness("exists", ".chat-coaches-row"),
      "the popover lists the analysis"
    );

    await harness("click", '[aria-label="Run now"]');
    await waitFor(
      () => harness("callCount", "runCoachAnalysisNow"),
      "it runs straight away"
    );
    assert.equal(
      await harness("exists", ".coach-analysis-dialog"),
      false,
      "and does not ask a question with one answer"
    );
    const [straight] = await harness("calls", "runCoachAnalysisNow");
    assert.deepEqual(
      straight.args,
      ["a1"],
      "the analysis id, and nothing to narrow it with"
    );
    await assertQuietConsole("run now");
  }

  // -------------------------------------------------------------------------
  // 9.3: the popover is the way in, and the way to each analysis
  // -------------------------------------------------------------------------
  // Creating is the only entry point, and it happens here. The ⚡ mark in the
  // sidebar is derived from what a conversation holds, so a popover that
  // changes that and says nothing leaves the mark where it was until restart.
  {
    await harness(
      "mount",
      "ConversationAnalyses",
      { sessionId: "s1" },
      {
        listCoachAnalysesForSession: [
          summary(analysis("a1", "Post-run debrief"))
        ],
        listCoachAnalysisRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the chip renders"
    );
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      () => harness("exists", ".chat-coaches-create"),
      "the popover opens"
    );
    await harness("clearCalls");

    // Create: the button reaches the parent, which is what opens the screen.
    await harness("click", ".chat-coaches-create");
    await waitFor(
      () => harness("callCount", "prop:onCreateAnalysis"),
      "Create Auto Analysis has to reach the screen that hosts the form"
    );

    // And each row reaches that analysis's own detail screen, which is where
    // everything a popover cannot hold now lives.
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      () => harness("exists", ".chat-coaches-row"),
      "the popover reopens"
    );
    await harness("click", '[aria-label="Open Post-run debrief"]');
    const [opened] = await waitFor(
      async () => {
        const made = await harness("calls", "prop:onOpenAnalysis");
        return made.length ? made : null;
      },
      "the options entry point opens that analysis"
    );
    assert.deepEqual(opened.args, ["a1"]);

    // Switching one off is a change the sidebar's mark depends on.
    await harness("click", ".chat-coaches-pill");
    await waitFor(() => harness("exists", ".chat-coaches-row"), "reopened");
    await harness("click", ".chat-coaches-row-switch input");
    await waitFor(
      () => harness("callCount", "setCoachAnalysisEnabled"),
      "the switch reaches the store"
    );
    await waitFor(
      () => harness("callCount", "prop:onChanged"),
      "and the popover tells the screen around it, or the ⚡ mark never moves"
    );
    assert.ok(
      await harness("callCount", "listCoachAnalysesForSession"),
      "and re-reads its own rows"
    );
    await assertQuietConsole("the analyses popover");
  }

  // -------------------------------------------------------------------------
  // The popover following an edit made on the detail screen over it
  // -------------------------------------------------------------------------
  // Every row here is drawn from the analysis — its name, the trigger under
  // it, the switch that decides whether it reads as running — and the detail
  // screen sits on top of this popover's parent. Without the push, a rename
  // left the row showing the old name until something unrelated refreshed it.
  {
    await harness(
      "mount",
      "ConversationAnalyses",
      { sessionId: "s1" },
      {
        listCoachAnalysesForSession: [
          summary(analysis("a1", "Morning briefing"))
        ],
        listCoachAnalysisRuns: []
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

    // The athlete renames it from its own screen. No run happened, and
    // nothing else about this conversation changed.
    await harness("setScript", {
      listCoachAnalysesForSession: [
        summary(analysis("a1", "Evening debrief"))
      ]
    });
    await harness("emit", "onCoachAnalysisUpdate", {
      analysisId: "a1",
      sessionId: "s1",
      analysis: analysis("a1", "Evening debrief")
    });
    await waitFor(
      async () =>
        (await harness("text", ".chat-coaches-row-name"))?.includes(
          "Evening debrief"
        ) || null,
      "the row follows the edit without anything else forcing a re-read"
    );
    await assertQuietConsole("an edit reaching the popover");
  }

  // -------------------------------------------------------------------------
  // The master switch reaching the conversations the coach is attached to
  // -------------------------------------------------------------------------
  // A attachment runs only when its own switch and the analysis's are both on,
  // which is what the runner checks and what `listCoachAnalysisSessionAttention`
  // counts. Switching a coach off therefore moves the ⚡ mark on conversations
  // this window never touched — with no attachment update and no run to say so.
  {
    await harness("mount", "ChatView", {}, {
      ...CHAT_VIEW_BASE,
      listChatSessions: [session("s1", "Morning briefing")],
      listCoachAnalysisRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar"
    );

    await harness("clearCalls");
    await harness("emit", "onCoachAnalysisUpdate", {
      analysisId: "a1",
      analysis: analysis("a1", "Morning briefing", { enabled: false })
    });
    await waitFor(
      () => harness("callCount", "listCoachAnalysisSessionAttention"),
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
      listCoachAnalysisRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar"
    );

    await harness("clearCalls");
    await harness("emit", "onCoachAnalysisRunUpdate", run("r1", { sessionId: "s2" }));
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
      "onCoachAnalysisRunUpdate",
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
  // (`onCoachAnalysisRunUpdate` appearing three times) and called that a
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
      listCoachAnalysisRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar"
    );

    // s1 is the conversation ChatView opened on mount; the run landed in s2.
    await harness("clearCalls");
    await harness(
      "emit",
      "onCoachAnalysisRunUpdate",
      run("r1", { status: "success", sessionId: "s2", summary: "Load is ramping." })
    );
    await waitFor(
      () => harness("callCount", "listCoachAnalysisSessionAttention"),
      "a run into a conversation nobody is looking at must re-read the marks"
    );
    assert.equal(
      await harness("callCount", "markCoachAnalysisSessionSeen"),
      0,
      "and must not mark it read — that dot is the only thing that says it happened"
    );

    // The same run into the conversation that *is* open is the opposite: the
    // answer is already on screen, so it is read the moment it arrives.
    await harness("clearCalls");
    await harness(
      "emit",
      "onCoachAnalysisRunUpdate",
      run("r2", { status: "success", sessionId: "s1", summary: "Load is ramping." })
    );
    const [seen] = await waitFor(
      async () => {
        const made = await harness("calls", "markCoachAnalysisSessionSeen");
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
  // it landed, and the unread dot — the only thing that says an analysis ran
  // while nobody was watching — was cleared before it was ever drawn.
  {
    await harness("mount", "ChatView", { active: false }, {
      ...CHAT_VIEW_BASE,
      listChatSessions: [session("s1", "Morning briefing")],
      listCoachAnalysisRuns: []
    });
    await waitFor(
      () => harness("exists", ".chat-session-row"),
      "ChatView renders its sidebar even behind another view"
    );

    await harness("clearCalls");
    await harness(
      "emit",
      "onCoachAnalysisRunUpdate",
      run("r1", { status: "success", sessionId: "s1", summary: "Load is ramping." })
    );
    await waitFor(
      () => harness("callCount", "listCoachAnalysisSessionAttention"),
      "a run into a conversation nobody is looking at must re-read the marks"
    );
    assert.equal(
      await harness("callCount", "markCoachAnalysisSessionSeen"),
      0,
      "the conversation is open but off screen — marking it read loses the dot"
    );

    // Coming back to the Coach view *is* reading it: the answer is on screen by
    // then, so a dot left standing could never be cleared.
    await harness("clearCalls");
    await harness("setProps", { active: true });
    const [seenOnReturn] = await waitFor(
      async () => {
        const made = await harness("calls", "markCoachAnalysisSessionSeen");
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
  // Ported from a regex over `statuses: ["running"] ... showLiveAnalysis`.
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
        getCoachAnalysis: analysis("a1", "Post-run debrief"),
        // Only the second conversation is being written into. The first is the
        // one ChatView opens on mount, so a bubble on screen before the click
        // would be the query answering indiscriminately rather than per
        // conversation.
        __byArg: {
          listCoachAnalysisRuns: {
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
      await harness("exists", ".chat-analysis-attribution"),
      false,
      "the conversation opened on mount has no run in it"
    );

    // The athlete opens the other one: a run is already streaming into it.
    await harness("clickText", ".chat-session-row", "Post-run debrief");
    const attribution = await waitFor(
      () => harness("text", ".chat-analysis-attribution"),
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
    await harness("mount", "ChatSettingsPanel", {}, {
      getCoachAnalysisPause: held,
      resumeCoachAnalyses: null
    });

    const banner = await waitFor(
      () => harness("text", ".coach-analysis-banner"),
      "a pause that happened while the window was closed still has to show"
    );
    assert.match(banner, /Every analysis is paused/);
    assert.match(banner, /login code/, "and say what has to happen");

    await harness("clickText", ".coach-analysis-banner button", "Resume");
    await waitFor(
      () => harness("callCount", "resumeCoachAnalyses"),
      "Resume has to reach the main process, not just clear the banner"
    );
    await waitFor(
      async () => (await harness("exists", ".coach-analysis-banner")) === false,
      "and the banner goes with it"
    );
    await assertQuietConsole("the pause banner");

    // The other direction: the pause arrives by push while Settings is open,
    // which is what happens when a scheduled run trips it with the athlete
    // looking at this very screen.
    await harness("emit", "onCoachAnalysisPauseUpdate", held);
    await waitFor(
      () => harness("exists", ".coach-analysis-banner"),
      "a pause tripped while Settings is open must appear without a re-read"
    );
    await harness("emit", "onCoachAnalysisPauseUpdate", null);
    await waitFor(
      async () => (await harness("exists", ".coach-analysis-banner")) === false,
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
    await harness("mount", "ChatSettingsPanel", {}, {
      getCoachAnalysisPause: null,
      getCoachAnalysisSpend: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 412_000,
        outputTokens: 71_000,
        budget: 500_000,
        countedRuns: 12,
        providerRuns: 12
      },
      setCoachAnalysisBudget: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 412_000,
        outputTokens: 71_000,
        budget: 900_000,
        countedRuns: 12,
        providerRuns: 12
      }
    });

    const spend = await waitFor(
      () => harness("text", ".coach-analysis-spend"),
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
    await harness("setValue", ".coach-analysis-budget input", "900000");
    await harness("blur", ".coach-analysis-budget input");
    const [committed] = await waitFor(
      async () => {
        const made = await harness("calls", "setCoachAnalysisBudget");
        return made.length ? made : null;
      },
      "the typed ceiling has to reach the main process"
    );
    assert.deepEqual(committed.args, [900_000], "as a number, not as the typed string");
    await waitFor(
      async () => (await harness("value", ".coach-analysis-budget input")) === "900000",
      "and the field shows what came back"
    );
    await assertQuietConsole("the spend line");
  }

  // --- a total that is short of the truth says so ---------------------------
  {
    // A budget that read as comfortably under when nobody actually knows is
    // worse than no budget: it is a number the athlete would trust.
    await harness("mount", "ChatSettingsPanel", {}, {
      getCoachAnalysisSpend: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 1_000,
        outputTokens: 200,
        budget: null,
        countedRuns: 3,
        providerRuns: 7
      }
    });

    const spend = await waitFor(
      () => harness("text", ".coach-analysis-spend"),
      "Settings renders its spend line"
    );
    assert.match(spend, /4 runs not counted/, "and names how many it cannot see");
    assert.equal(
      await harness("value", ".coach-analysis-budget input"),
      "",
      "no ceiling shows as empty, not as zero"
    );
    await assertQuietConsole("an under-counted total");
  }

  // --- a budget pause says which of the two reasons it is -------------------
  {
    await harness("mount", "ChatSettingsPanel", {}, {
      getCoachAnalysisPause: {
        reason: "budget",
        since: "2026-09-20T07:30:00.000Z",
        runId: "r1"
      },
      getCoachAnalysisSpend: {
        monthStart: "2026-09-01T00:00:00.000Z",
        inputTokens: 500_000,
        outputTokens: 0,
        budget: 500_000,
        countedRuns: 20,
        providerRuns: 20
      }
    });

    const banner = await waitFor(
      () => harness("text", ".coach-analysis-banner"),
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
  // 9.1: what the scheduler books, on a timer, with nobody watching
  // -------------------------------------------------------------------------
  // The scheduler books a slot on its own tick and there is no run to carry
  // the news, so without the push a briefing created at lunchtime shows a
  // stale row until something unrelated refreshes it.
  {
    const booked = analysis("a1", "Morning briefing");
    await harness(
      "mount",
      "ConversationAnalyses",
      { sessionId: "s1" },
      {
        listCoachAnalysesForSession: [summary(booked)],
        listCoachAnalysisRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the chip renders"
    );
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      () => harness("exists", ".chat-coaches-row-meta"),
      "the popover lists the analysis"
    );
    assert.match(
      (await harness("text", ".chat-coaches-row-meta")) ?? "",
      /never run/,
      "fixture sanity: it has not run yet"
    );

    // 60 seconds later, in the main process, with this open: the tick books
    // the slot, stamps the clock and pushes.
    await harness("setScript", {
      listCoachAnalysesForSession: [
        summary(booked, { lastRun: run("r1", { status: "success" }) })
      ]
    });
    assert.equal(
      await harness("emit", "onCoachAnalysisUpdate", {
        analysisId: "a1",
        sessionId: "s1",
        analysis: { ...booked, nextRunAt: "2026-08-25T18:00:00.000Z" }
      }),
      1,
      "the row has to be listening for it"
    );

    await waitFor(
      async () =>
        !/never run/.test(
          (await harness("text", ".chat-coaches-row-meta")) ?? "never run"
        ) || null,
      "the row follows what the tick wrote"
    );
    await assertQuietConsole("the booked slot");
  }

  // -------------------------------------------------------------------------
  // 2.4: an analysis switched off while its own screen is open
  // -------------------------------------------------------------------------
  // Guard rail 2 switches off an analysis whose conversation the athlete
  // deleted, and the switch on the conversation's row does the same from the
  // other side. Its own screen read the analysis once, on mount, and went on
  // showing what it read.
  {
    const debrief = analysis("a1", "Post-run debrief");
    await harness(
      "mount",
      "AnalysisDetailView",
      { tab: "settings" },
      { getCoachAnalysis: debrief, listCoachAnalysisRuns: [] }
    );

    await waitFor(
      () => harness("exists", ".coach-analysis-tabpanel"),
      "the settings tab renders"
    );
    await harness("clearCalls");

    assert.equal(
      await harness("emit", "onCoachAnalysisUpdate", {
        analysisId: "a1",
        sessionId: "s1",
        analysis: { ...debrief, name: "Renamed elsewhere" }
      }),
      1,
      "the screen has to be listening"
    );
    await waitFor(
      async () =>
        (await harness("text", ".coach-analysis-tabs"))?.includes("Settings") ||
        null,
      "and stays on its feet"
    );

    // Narrower than a full refresh on purpose: re-reading the analysis would
    // throw away a playbook the athlete is part-way through typing.
    assert.equal(
      await harness("callCount", "getCoachAnalysis"),
      0,
      "the analysis is not re-read underneath an edit"
    );

    // Deleted from somewhere else: this screen is about something that no
    // longer exists, so it has to leave rather than sit on a 404.
    assert.equal(
      await harness("emit", "onCoachAnalysisUpdate", {
        analysisId: "a1",
        sessionId: "s1",
        analysis: null
      }),
      1
    );
    await waitFor(
      () => harness("callCount", "prop:onBack"),
      "a deleted analysis takes its own screen with it"
    );
    await assertQuietConsole("an analysis changing under its screen");
  }

  // --- and one belonging to a different analysis is not this screen's -------
  {
    // The negative half. A push that fires for everything passes every "did
    // it fire" test, and this screen is one of several on the same channel.
    await harness(
      "mount",
      "AnalysisDetailView",
      { tab: "settings" },
      {
        getCoachAnalysis: analysis("a1", "Post-run debrief"),
        listCoachAnalysisRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".coach-analysis-tabpanel"),
      "the settings tab renders"
    );
    await harness("clearCalls");

    await harness("emit", "onCoachAnalysisUpdate", {
      analysisId: "somebody-else",
      sessionId: "s9",
      analysis: null
    });
    await settle();
    assert.equal(
      await harness("callCount", "prop:onBack"),
      0,
      "another analysis being deleted must not close this one"
    );
    await assertQuietConsole("a push for another analysis");
  }

  // -------------------------------------------------------------------------
  // 10: the run flag has to outlast the gap inside a catch-up
  // -------------------------------------------------------------------------
  // A trigger can expand into a sequence of runs, serialised (5.4), so between
  // two of them there is a moment with no `running` row at all. A row reading
  // only the log would offer "Run now" in the middle of its own sequence, and
  // a second press would queue a second one. The flag is set on the click and
  // cleared when the whole thing has answered, and nowhere else.
  {
    await harness(
      "mount",
      "ConversationAnalyses",
      { sessionId: "s1" },
      {
        listCoachAnalysesForSession: [
          summary(analysis("a1", "Post-run debrief"))
        ],
        listCoachAnalysisRuns: [],
        // The sequence is still going when the driver comes back.
        runCoachAnalysisNow: "__pending"
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the chip renders"
    );
    await harness("click", ".chat-coaches-pill");
    await waitFor(
      () => harness("exists", '[aria-label="Run now"]'),
      "the popover lists the analysis"
    );

    await harness("click", '[aria-label="Run now"]');
    await waitFor(
      () => harness("callCount", "runCoachAnalysisNow"),
      "the sequence started"
    );

    // The first step finished. The second has not started: no `running` row
    // exists anywhere, which is exactly the gap.
    await harness(
      "emit",
      "onCoachAnalysisRunUpdate",
      run("run-1", { status: "success", finishedAt: "2026-08-25T09:00:04.000Z" })
    );
    await settle();
    assert.equal(
      await harness("exists", '[aria-label="Run now"][disabled]'),
      true,
      "the row still says a run is going, with no `running` row to read it from"
    );

    // The sequence answers. Now, and only now, the row offers again.
    await harness("resolvePending", "runCoachAnalysisNow", []);
    await waitFor(
      async () =>
        (await harness("exists", '[aria-label="Run now"][disabled]')) === false,
      "and once the whole sequence has answered, it offers again"
    );
    await assertQuietConsole("the run flag across a sequence");
  }

  // --- a burst of pushes must not spin the popover -------------------------
  {
    // One tick can stamp several analyses in one conversation. That is five
    // pushes in a row into a screen whose refresh sets state another effect
    // watches — the shape of the infinite render loop phase 1's second review
    // found, which announced itself only in the console.
    await harness(
      "mount",
      "ConversationAnalyses",
      { sessionId: "s1" },
      {
        listCoachAnalysesForSession: [
          summary(analysis("a1", "Morning briefing"))
        ],
        listCoachAnalysisRuns: []
      }
    );
    await waitFor(
      () => harness("exists", ".chat-coaches-pill"),
      "the chip renders"
    );
    await harness("clearCalls");

    for (const id of ["a1", "a2", "a3", "a4", "a5"]) {
      await harness("emit", "onCoachAnalysisUpdate", {
        analysisId: id,
        sessionId: "s1",
        analysis: analysis(id, "Morning briefing", {
          nextRunAt: "2026-08-25T18:00:00.000Z"
        })
      });
    }
    await settle();

    // Five pushes, five reads, and then it stops. A count that kept climbing
    // after the page settled is the loop this is here to catch.
    const settledReads = await harness("callCount", "listCoachAnalysesForSession");
    await settle();
    assert.equal(
      await harness("callCount", "listCoachAnalysesForSession"),
      settledReads,
      "the popover settles rather than re-reading itself in a loop"
    );
    assert.ok(
      settledReads <= 5,
      `one read per push at most, saw ${settledReads}`
    );
    await assertQuietConsole("a burst of pushes");
  }

  // --- and the switch reports itself too ----------------------------------
  {
    // Found by mutating the suite rather than by reading it: cutting the
    // report out of the popover's shared mutation wrapper left the whole
    // renderer suite green. The ⚡ mark is derived from what a conversation
    // holds, so an analysis paused here and not reported leaves the mark
    // where it was until the app restarts.
    await harness(
      "mount",
      "ConversationAnalyses",
      { sessionId: "s1" },
      {
        listCoachAnalysesForSession: [
          summary(analysis("a1", "Morning briefing"))
        ],
        listCoachAnalysisRuns: [],
        setCoachAnalysisEnabled: analysis("a1", "Morning briefing", {
          enabled: false
        })
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
      () => harness("callCount", "setCoachAnalysisEnabled"),
      "the analysis is paused"
    );
    await waitFor(
      () => harness("callCount", "prop:onChanged"),
      "and the screen around it is told, or the ⚡ mark never moves"
    );
    await assertQuietConsole("pausing an analysis from the popover");
  }

  console.log("coach analysis renderer tests passed");
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);
