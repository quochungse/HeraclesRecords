// Coach's proposal to the calendar, drawn under the answer that made it
// (P3.2–P3.3 of docs/coach-plan-canvas.md).
//
// Runs the real ChatView in Electron's Chromium against the harness stub.
// What is held:
//
//   * the card is read from its row through its anchor, so it is there after
//     a reload with the state its lines settled in;
//   * a line is applied on its own, and Apply all names how many are left;
//   * a proposal that arrives in a turn is drawn at once and anchored in the
//     saved transcript;
//   * a delete card from before change sets is drawn and offers nothing.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

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
  local: { baseUrl: "http://localhost:11434/v1", model: "", hasApiKey: false, toolsEnabled: true },
  openRouter: { model: "openrouter/auto", hasApiKey: false },
  sidebarOpen: true,
  visualizationsEnabled: true,
  customInstructions: ""
};

const SESSION = {
  id: "s1",
  title: "Ill this week",
  provider: "claude-code",
  createdAt: "2026-09-26T06:00:00.000Z",
  updatedAt: "2026-09-26T06:00:00.000Z"
};

const line = (lineId, op, label, status = "proposed", extra = {}) => ({ lineId, op, label, status, ...extra });
const SET = {
  changeSetId: "sc-1",
  sessionId: "s1",
  summary: "Rest while you are ill",
  lines: [
    line("l1", "move", 'Move "Long run" (Base block) from Sat 27 Sep to Sun 28 Sep'),
    line("l2", "replace", 'Replace "Tempo" on Thu 25 Sep with "Easy 30"'),
    line("l3", "remove", 'Remove "Strides" from Fri 26 Sep')
  ],
  createdAt: "2026-09-26T06:00:00.000Z",
  updatedAt: "2026-09-26T06:00:00.000Z"
};

const TRANSCRIPT = [
  { kind: "message", role: "user", content: "I'm ill this week, rearrange it" },
  { kind: "message", role: "assistant", content: "Here is a gentler week." },
  { kind: "scheduleChange", changeSetId: "sc-1" },
  {
    kind: "workoutDelete",
    preview: { requestId: "old-1", target: "scheduled", workoutName: "Old run", scheduleDate: "2026-09-01", summary: "Remove the old run" }
  }
];

const BASE_SCRIPT = {
  getChatAuthStatus: { signedIn: true },
  getChatSettings: CHAT_SETTINGS,
  getClaudeCodeStatus: { state: "connected" },
  getCorosMcpStatus: { connected: false },
  getMcpStatuses: [],
  listChatSessions: [SESSION],
  getChatSession: TRANSCRIPT,
  listCoachAnalysisSessionAttention: [],
  listCoachAnalysesForSession: [],
  getScheduleChanges: [SET],
  sendChat: null,
  compactChatContext: null
};

let win;

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return win.webContents
    .executeJavaScript(`window.__harness.${method}(${list})`, true)
    .catch((error) => {
      throw new Error(`harness ${method} failed: ${error.message}`);
    });
}

function page(expression) {
  return win.webContents.executeJavaScript(expression, true);
}

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

async function settle() {
  for (let pass = 0; pass < 6; pass += 1) {
    await page("new Promise((resolve) => setTimeout(resolve, 60))");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const lineStates = () =>
  page(`[...document.querySelectorAll(".chat-change-line")].map((row) => [row.dataset.status, row.querySelector(".chat-change-line-status")?.textContent ?? ""])`);

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 1100, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // A proposal read through its anchor, every line open.
  await harness("mount", "ChatView", {}, BASE_SCRIPT);
  await waitFor(() => harness("exists", ".chat-change-card"), "the proposal is drawn from its row");
  assert.deepEqual((await harness("calls", "getScheduleChanges"))[0].args[0], ["sc-1"]);
  assert.equal(await harness("text", ".chat-change-card h4"), "Rest while you are ill");
  assert.equal(await harness("text", ".chat-change-card .chat-plan-card-summary"), "3 changes, none applied yet");
  assert.equal(await harness("count", ".chat-change-line"), 3);
  assert.equal(await harness("text", ".chat-change-card .chat-plan-upload"), "Apply all 3");
  assert.equal(
    await page(`[...document.querySelectorAll(".chat-change-apply")].map((button) => button.textContent).join("|")`),
    "Apply|Apply|Remove",
    "a removal says what it does"
  );

  // The legacy delete card is drawn and can do nothing.
  assert.equal(await harness("exists", ".chat-delete-card"), true);
  assert.match(await harness("text", ".chat-delete-expired"), /can no longer delete anything/);
  assert.equal(await harness("exists", ".chat-delete-card button"), false);

  // One line applied.
  await harness("setScript", {
    applyScheduleChange: {
      ...SET,
      lines: [{ ...SET.lines[0], status: "applied" }, SET.lines[1], SET.lines[2]]
    }
  });
  await harness("clickNth", ".chat-change-apply", 0);
  await waitFor(async () => (await lineStates())[0][0] === "applied", "the first line is applied");
  assert.deepEqual((await harness("calls", "applyScheduleChange"))[0].args, ["sc-1", "l1"]);
  assert.equal(await harness("text", ".chat-change-card .chat-plan-card-summary"), "1 applied · 2 to decide");
  assert.equal(await harness("text", ".chat-change-card .chat-plan-upload"), "Apply all 2");
  assert.equal(await harness("count", ".chat-change-apply"), 2, "an applied line has no buttons");

  // The rest at once: one stale, one applied — each line says how it ended.
  await harness("setScript", {
    applyScheduleChange: {
      ...SET,
      lines: [
        { ...SET.lines[0], status: "applied" },
        { ...SET.lines[1], status: "stale", reason: "The session on 2026-09-25 is now \"Hills\", not \"Tempo\"." },
        { ...SET.lines[2], status: "applied" }
      ]
    }
  });
  await harness("clearCalls");
  await harness("click", ".chat-change-card .chat-plan-upload");
  await waitFor(async () => (await lineStates())[2][0] === "applied", "the rest are settled");
  assert.equal((await harness("calls", "applyScheduleChange"))[0].args[1], undefined, "Apply all names no line");
  assert.deepEqual(await lineStates(), [
    ["applied", "Applied"],
    ["stale", 'Out of date — The session on 2026-09-25 is now "Hills", not "Tempo".'],
    ["applied", "Removed"]
  ]);
  assert.equal(await harness("exists", ".chat-change-card .chat-plan-upload"), false, "nothing left to apply");

  // A refusal is said, and the set is read again for what did land.
  await harness("mount", "ChatView", {}, { ...BASE_SCRIPT, applyScheduleChange: { __reject: "COROS is away" } });
  await waitFor(() => harness("exists", ".chat-change-card"), "drawn again");
  await harness("clearCalls");
  await harness("clickNth", ".chat-change-apply", 1);
  await waitFor(() => harness("callCount", "getScheduleChanges"), "the row is read again after a failure");

  // A failed line may be tried again — unless part of it landed.
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getScheduleChanges: [
      {
        ...SET,
        lines: [
          { ...SET.lines[0], status: "failed", reason: "COROS is away." },
          { ...SET.lines[1], status: "failed", reason: "The new workout was added, but the old one could not be removed.", retry: false },
          SET.lines[2]
        ]
      }
    ],
    applyScheduleChange: { ...SET, lines: [{ ...SET.lines[0], status: "applied" }, { ...SET.lines[1], status: "failed", retry: false }, SET.lines[2]] }
  });
  await waitFor(() => harness("exists", ".chat-change-card"), "drawn with its failures");
  assert.equal(
    await page(`[...document.querySelectorAll(".chat-change-line")].map((row) => [...row.querySelectorAll("button")].map((button) => button.textContent).join("+")).join("|")`),
    "Try again||Remove+Dismiss",
    "Try again only where nothing landed"
  );
  await harness("clearCalls");
  await harness("clickText", ".chat-change-line button", "Try again");
  await waitFor(async () => (await lineStates())[0][0] === "applied", "the retried line is applied");
  assert.deepEqual((await harness("calls", "applyScheduleChange"))[0].args, ["sc-1", "l1"]);

  // Dismiss one line.
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    dismissScheduleChange: { ...SET, lines: [SET.lines[0], SET.lines[1], { ...SET.lines[2], status: "dismissed" }] }
  });
  await waitFor(() => harness("exists", ".chat-change-card"), "drawn again");
  await harness("clickNth", ".chat-change-dismiss", 2);
  await waitFor(async () => (await lineStates())[2][0] === "dismissed", "the line is dismissed");
  assert.deepEqual((await harness("calls", "dismissScheduleChange"))[0].args, ["sc-1", "l3"]);

  // A proposal that arrives in a turn is drawn at once and saved as an anchor.
  await harness("mount", "ChatView", {}, { ...BASE_SCRIPT, getChatSession: TRANSCRIPT.slice(0, 2), getScheduleChanges: [] });
  await waitFor(() => harness("exists", ".chat-composer textarea, textarea"), "the composer is up");
  await harness("setValue", "textarea", "Move my long run");
  await harness("keyDown", "textarea", "Enter");
  const sent = await waitFor(async () => (await harness("calls", "sendChat"))[0], "the question is sent");
  const requestId = sent.args[0];
  await harness("emit", "onChatStreamStart", { requestId });
  await harness("emit", "onChatStreamInfo", {
    requestId,
    kind: "scheduleChange",
    changeSet: { ...SET, changeSetId: "sc-2", summary: "Long run to Sunday", lines: [SET.lines[0]] }
  });
  await waitFor(async () => (await harness("text", ".chat-change-card h4")) === "Long run to Sunday", "drawn as it arrives");
  assert.equal(await harness("exists", ".chat-change-card .chat-plan-upload"), false, "one line needs no Apply all");
  await harness("emit", "onChatStreamDone", { requestId, fullText: "Moved to Sunday, if you apply it." });
  await settle();
  const saved = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.ok(
    saved.some((entry) => entry.kind === "scheduleChange" && entry.changeSetId === "sc-2" && Object.keys(entry).length === 2),
    "the transcript keeps an anchor, not the set"
  );

  // P3.5: the calendar points at a session, and the chip rides in front of the question.
  const REF = { scope: "session", day: "20260927", planId: "R1", idInPlan: "5", label: "Sat 27 Sep · Long run" };
  await harness("mount", "ChatView", { pendingPrompt: { prompt: "How should I approach it?", scheduleRefs: [REF] } }, {
    ...BASE_SCRIPT,
    getChatSession: TRANSCRIPT.slice(0, 2),
    getScheduleChanges: []
  });
  await waitFor(() => harness("exists", "[aria-label=\"Asking about the calendar\"] .chat-ref-chip"), "the chip waits by the composer");
  assert.match(await harness("text", "[aria-label=\"Asking about the calendar\"] .chat-ref-chip"), /Sat 27 Sep · Long run/);
  assert.equal(await harness("value", "textarea"), "How should I approach it?", "the question is the athlete's to finish");
  await harness("keyDown", "textarea", "Enter");
  const asked = await waitFor(async () => (await harness("calls", "sendChat"))[0], "the question is sent");
  const wire = asked.args[1];
  assert.match(
    wire.at(-1).content,
    /^\[The athlete is asking about the session Sat 27 Sep · Long run \(plan_id R1, id_in_plan 5, on 20260927\)\. Read what you need with list_scheduled_workouts, get_training_plan or get_activity_detail\.\]\n\nHow should I approach it\?$/,
    "the ref is folded into the question, with the ids the tools take"
  );
  await waitFor(() => harness("exists", ".chat-refs-row"), "the question shows what it was about");
  assert.equal(await harness("exists", "[aria-label=\"Asking about the calendar\"]"), false, "the chip went with the question");
  const savedRefs = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  const at = savedRefs.findIndex((entry) => entry.kind === "scheduleRefs");
  assert.ok(at >= 0, "the refs are saved as an anchor");
  assert.deepEqual(savedRefs[at].refs, [REF]);
  assert.equal(savedRefs[at + 1]?.content, "How should I approach it?", "just before the question");

  // P3.5: any COROS plan's session is asked about from the Library reader — not only Coach's plans.
  const run = (id, week, day, title, idInPlan) => ({
    id,
    weekIndex: week,
    dayIndex: day,
    sortOrder: 0,
    title,
    workout: { key: id, name: title, sport: "run", steps: [{ kind: "training", target_type: "time", target_duration_seconds: 1800 }] },
    ...(idInPlan ? { idInPlan } : {})
  });
  const LIBRARY_PLAN = {
    id: "coros:T1",
    remoteId: "T1",
    remoteVersion: 1,
    name: "Base block",
    description: "",
    sportMix: ["run"],
    weekCount: 2,
    weekStages: [],
    entries: [run("e1", 0, 1, "Easy", "1"), run("e2", 1, 3, "Tempo", "4")],
    calendar: "unscheduled",
    tags: [],
    favorite: false,
    archived: false,
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
  await harness("mount", "PlanReader", { plan: LIBRARY_PLAN, askAboutSessions: true, width: 1000, height: 900 });
  await waitFor(() => harness("exists", ".plan-entry"), "the reader draws its sessions");
  await page(`[...document.querySelectorAll(".plan-entry")].find((row) => row.textContent.includes("Tempo")).click()`);
  await waitFor(() => harness("exists", ".plan-session-ask"), "the open session offers Ask Coach");
  await harness("click", ".plan-session-ask");
  const [ask] = await harness("calls", "prop:onAskCoachAboutSession");
  assert.equal(ask.args[1].idInPlan, "4");
  assert.equal(ask.args[2], "Tempo · Week 2 · Thu · Base block");
  await harness("mount", "PlanReader", { plan: LIBRARY_PLAN, width: 1000, height: 900 });
  await waitFor(() => harness("exists", ".plan-entry"), "drawn again, with nowhere to ask");
  await page(`[...document.querySelectorAll(".plan-entry")].find((row) => row.textContent.includes("Tempo")).click()`);
  await waitFor(() => harness("exists", ".plan-session"), "the session opens");
  assert.equal(await harness("exists", ".plan-session-ask"), false, "no button without somewhere to send it");

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors.filter((text) => !/act\(|ReactDOMTestUtils|COROS is away/.test(text)), []);
  console.log("schedule change renderer tests passed");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
