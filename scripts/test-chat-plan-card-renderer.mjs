// A coach's plan, drawn under the answer that proposed it
// (docs/coach-plan-canvas.md, P0.2).
//
// Runs the real ChatView in Electron's Chromium against the harness stub.
// Three things are held here, each of which went wrong once:
//
//   * the card is drawn exactly once, at every window width — the inline copy
//     that used to exist was chosen by a width test, and that test also
//     decided whether the Creations button existed;
//   * an undated plan reads as its weeks, off the document the draft becomes,
//     not as one "Unscheduled" pile with "0 weeks";
//   * a turn's answer sits above the cards the turn produced, while it streams
//     and once it has settled.
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
  sidebarOpen: true,
  visualizationsEnabled: true,
  customInstructions: ""
};

const SESSION = {
  id: "s1",
  title: "Hanoi Half",
  provider: "claude-code",
  createdAt: "2026-09-26T06:00:00.000Z",
  updatedAt: "2026-09-26T06:00:00.000Z"
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** Three weeks, three sessions each, undated — laid out by week and day. */
const LAYOUT = Array.from({ length: 9 }, (_, index) => ({
  key: `s${index + 1}`,
  week: Math.floor(index / 3),
  day: [1, 3, 5][index % 3],
  minutes: 40 + (index % 3) * 20 + Math.floor(index / 3) * 10
}));

const PREVIEW = {
  draftId: "plan-1",
  artifactType: "plan",
  name: "Hanoi Half base",
  summary: "3 weeks · 3 sessions a week · Run",
  entries: LAYOUT.map((item) => ({
    key: item.key,
    name: `Easy ${item.minutes}'`,
    sport: "run",
    saveToLibrary: false,
    workoutType: "easy",
    stepsSummary: `${item.minutes} min easy`
  })),
  conflicts: [],
  warnings: []
};

const DOCUMENT = {
  id: "draft:plan-1",
  name: PREVIEW.name,
  description: "",
  weekCount: 3,
  weekStages: [
    { weekIndex: 0, stage: 2 },
    { weekIndex: 1, stage: 2 },
    { weekIndex: 2, stage: 3 }
  ],
  entries: LAYOUT.map((item, index) => ({
    id: `entry:plan-1:${item.key}`,
    weekIndex: item.week,
    dayIndex: item.day,
    sortOrder: index,
    title: `Easy ${item.minutes}'`,
    workout: {
      key: item.key,
      name: `Easy ${item.minutes}'`,
      sport: "run",
      steps: [{ kind: "training", target_type: "time", target_duration_seconds: item.minutes * 60 }]
    }
  })),
  sportMix: ["run"],
  calendar: "unscheduled",
  tags: [],
  favorite: false,
  archived: false,
  updatedAt: "2026-09-26T06:00:00.000Z"
};

const TRANSCRIPT = [
  { kind: "message", role: "user", content: "Build me a base block" },
  { kind: "message", role: "assistant", content: "Three easy weeks to start." },
  { kind: "planDraft", draft: PREVIEW },
  {
    kind: "coachPrompt",
    prompt: {
      promptId: "q1",
      question: "Long run on Saturday or Sunday?",
      choices: [
        { id: "choice-1", label: "Saturday", response: "Saturday" },
        { id: "choice-2", label: "Sunday", response: "Sunday" }
      ],
      allowCustom: true,
      answer: "Saturday",
      selectedChoiceId: "choice-1",
      answeredAt: 1
    }
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
  getPlanDraftDocument: DOCUMENT,
  listCoachAnalysisSessionAttention: [],
  listCoachAnalysesForSession: [],
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

/** What the thread shows, top to bottom: one word per row. */
function threadOrder() {
  return page(`[...document.querySelectorAll(".chat-thread > .chat-row")].map((row) => {
    if (row.querySelector(".chat-bubble-streaming")) return "streaming";
    if (row.querySelector(".chat-creation-card")) return "card";
    if (row.querySelector(".chat-visual-card, .chat-plan-card")) return "visual";
    if (row.classList.contains("chat-row-user")) return "user";
    return "assistant";
  })`);
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1100,
    webPreferences: { backgroundThrottling: false }
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  await harness("mount", "ChatView", {}, BASE_SCRIPT);
  await waitFor(() => harness("exists", ".chat-creation-card"), "the plan card is drawn");
  await waitFor(
    () => harness("exists", ".chat-creation-card .plan-ridge"),
    "the card reads its plan document and draws the ridge"
  );

  // -------------------------------------------------------------------------
  // One copy, at every width
  // -------------------------------------------------------------------------
  // The root's width, not the window's: a hidden window ignores being resized.
  for (const width of [520, 900, 1400]) {
    await page(`document.getElementById("root").style.width = "${width}px"`);
    await settle();
    assert.equal(await harness("count", ".chat-creation-card"), 1, `one card at ${width}px`);
    assert.equal(
      await harness("exists", ".chat-creations-pill"),
      true,
      `the Creations button exists at ${width}px`
    );
  }
  await page(`document.getElementById("root").style.width = ""`);
  await settle();

  // -------------------------------------------------------------------------
  // An undated plan reads as its weeks
  // -------------------------------------------------------------------------
  const figures = await page(`[...document.querySelectorAll(".chat-creation-figures > div")].map(
    (item) => [item.querySelector("dt").textContent, item.querySelector("dd").textContent]
  )`);
  assert.deepEqual(Object.fromEntries(figures), {
    Weeks: "3",
    "Sessions a week": "3",
    "Peak week": "4 hr",
    Sports: "Run"
  });
  assert.equal(await harness("count", ".chat-creation-card .plan-ridge-week"), 3);
  assert.equal(
    await harness("text", ".chat-creation-week-label"),
    "Week 1",
    "the strip shows the plan's first week"
  );
  assert.equal(await harness("count", ".chat-creation-days > li"), 7);
  assert.equal(await harness("count", ".chat-creation-days > li.is-rest"), 4);

  // An undated plan is a programme: it saves to COROS as one plan first.
  assert.equal(
    await harness("text", '.chat-creation-card [data-action="saveAsPlan"]'),
    "Save to COROS"
  );
  assert.equal(await harness("exists", '.chat-creation-card [data-action="edit"]'), true);

  // Open shows the popup, whose weeks come from the same document.
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", ".chat-creation-modal"), "the popup opens");
  const popupWeeks = await page(
    `document.querySelector(".chat-creation-modal .chat-plan-overview-item strong")?.textContent`
  );
  assert.equal(popupWeeks, "3", "the popup no longer says 0 weeks for an undated plan");
  assert.equal(
    await harness("exists", ".chat-creation-modal fieldset"),
    false,
    "the destination fieldset is gone"
  );

  // Removed before it is saved, the card's draft goes too (P0.8).
  await harness("click", ".chat-creation-modal-remove");
  await harness("click", ".chat-creation-modal-footer .chat-local-action.is-danger");
  await waitFor(() => harness("callCount", "removePlanDraft"), "the unsaved draft is let go");
  assert.deepEqual((await harness("calls", "removePlanDraft"))[0].args, ["plan-1"]);
  await waitFor(async () => !(await harness("exists", ".chat-creation-card")), "the card leaves the conversation");
  await harness("mount", "ChatView", {}, BASE_SCRIPT);
  await waitFor(() => harness("exists", ".chat-creation-card"), "the plan card is drawn again");

  // -------------------------------------------------------------------------
  // An answered question stays in the conversation as one line (P0.3)
  // -------------------------------------------------------------------------
  assert.equal(await harness("count", ".chat-asked-row"), 1);
  assert.equal(await harness("text", ".chat-asked-question"), "Long run on Saturday or Sunday?");
  assert.equal(await harness("text", ".chat-asked-answer"), "Saturday");
  assert.equal(
    await harness("exists", ".chat-coach-prompt"),
    false,
    "an answered question is not offered again"
  );

  // -------------------------------------------------------------------------
  // A turn's answer sits above the cards it produced
  // -------------------------------------------------------------------------
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [TRANSCRIPT[0], TRANSCRIPT[1]]
  });
  await waitFor(() => harness("exists", ".chat-composer textarea"), "the composer is drawn");
  await waitFor(() => harness("callCount", "getChatSession"), "the conversation is open");

  await harness("setValue", ".chat-composer textarea", "Make it four weeks");
  await harness("click", ".chat-send");
  const sent = await waitFor(
    async () => (await harness("calls", "sendChat"))[0],
    "the turn reaches main"
  );
  const requestId = sent.args[0];
  await harness("emit", "onChatStreamStart", { requestId });
  await harness("emit", "onChatStreamInfo", {
    requestId,
    kind: "planDraft",
    draft: { ...PREVIEW, draftId: "plan-2", name: "Four weeks" }
  });
  await harness("emit", "onChatStreamToken", { requestId, delta: "Here is a four-week block." });
  await waitFor(() => harness("exists", ".chat-bubble-streaming"), "the answer is streaming");
  assert.deepEqual(
    (await threadOrder()).slice(-3),
    ["user", "streaming", "card"],
    "while it streams, the answer is above the card it produced"
  );

  await harness("emit", "onChatStreamDone", {
    requestId,
    fullText: "Here is a four-week block."
  });
  await waitFor(async () => !(await harness("exists", ".chat-bubble-streaming")), "the turn settles");
  assert.deepEqual(
    (await threadOrder()).slice(-3),
    ["user", "assistant", "card"],
    "once settled, the answer is still above the card"
  );
  await settle();
  const saved = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.deepEqual(
    saved.slice(-2).map((entry) => entry.kind),
    ["message", "planDraft"],
    "and it is saved in that order"
  );

  // -------------------------------------------------------------------------
  // A one-off workout: its suggested day leads, it can be kept in the library
  // too, and it can be edited before it is saved (P0.4, P0.5)
  // -------------------------------------------------------------------------
  const workout = {
    key: "recovery",
    name: "Recovery run",
    sport: "run",
    schedule_date: "20991002",
    steps: [{ kind: "training", target_type: "time", target_duration_seconds: 2100, intensity: { type: "none" } }]
  };
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [
      TRANSCRIPT[0],
      { kind: "message", role: "assistant", content: "Go easy tonight." },
      {
        kind: "planDraft",
        draft: {
          draftId: "workout-1",
          artifactType: "workout",
          name: "Recovery run",
          summary: "Run · 35 min · recovery",
          entries: [
            {
              key: "recovery",
              name: "Recovery run",
              sport: "run",
              scheduleDate: "2099-10-02",
              saveToLibrary: false,
              workoutType: "recovery",
              stepsSummary: "35 min easy"
            }
          ],
          conflicts: [],
          warnings: []
        }
      }
    ],
    // The transcript's preview is light (P1.1): the steps the builder edits
    // come from the draft's document, so this is the only place they are.
    getPlanDraftDocument: {
      ...DOCUMENT,
      id: "draft:workout-1",
      name: "Recovery run",
      weekCount: 1,
      weekStages: [],
      entries: [{ id: "entry:workout-1:recovery", weekIndex: 0, dayIndex: 4, sortOrder: 0, title: "Recovery run", workout }]
    },
    uploadTrainingPlanDraft: {
      planName: "Recovery run",
      workoutsCreated: 1,
      workoutsScheduled: 1,
      entries: [{ key: "recovery", date: "20991002" }],
      destination: "calendar"
    }
  });
  await waitFor(() => harness("exists", ".chat-creation-card"), "the workout card is drawn");
  assert.match(
    (await harness("text", '.chat-creation-card [data-action="scheduleWorkout"]')) ?? "",
    /^Schedule for /,
    "the day the coach suggested leads"
  );
  assert.equal(await harness("exists", ".chat-creation-keep input"), true, "and it can be kept in the library too");
  await harness("click", ".chat-creation-card [data-action=\"edit\"]");
  await waitFor(
    () => harness("exists", ".calendar-modal-builder"),
    "Edit opens the workout builder"
  );
  await harness("click", '.calendar-modal-builder [aria-label="Close"]');
  await settle();
  await page(`(() => { const box = document.querySelector(".chat-creation-keep input"); box.click(); return box.checked; })()`);
  await harness("click", '.chat-creation-card [data-action="scheduleWorkout"]');
  const upload = await waitFor(
    async () => (await harness("calls", "uploadTrainingPlanDraft"))[0],
    "the workout is saved"
  );
  assert.deepEqual(
    upload.args.slice(2),
    ["calendar", "2099-10-02", true],
    "on its day, and kept in the library as asked"
  );
  await waitFor(() => harness("exists", ".chat-creation-card .chat-plan-success"), "the card says where it went");
  assert.match(await harness("text", ".chat-creation-status"), /^On calendar /);

  // -------------------------------------------------------------------------
  // An older version folds to a line under the newest, which alone has buttons
  // and alone is listed among the creations (P1.1)
  // -------------------------------------------------------------------------
  const PREVIEW_V2 = { ...PREVIEW, draftId: "plan-1-v2", editedAt: 5 };
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [
      TRANSCRIPT[0],
      TRANSCRIPT[1],
      { kind: "planDraft", draft: PREVIEW },
      { kind: "message", role: "assistant", content: "Moved the long run to Sunday." },
      { kind: "planDraft", draft: PREVIEW_V2 }
    ],
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1 },
      { artifactId: "plan-1", draftId: "plan-1-v2", version: 2, author: "athlete", createdAt: 2 }
    ]
  });
  await waitFor(() => harness("exists", ".chat-version-row"), "the older version folds");
  assert.equal(await page(`document.querySelectorAll(".chat-creation-card").length`), 1, "one card is drawn whole");
  assert.match(
    (await harness("text", ".chat-version-row")) ?? "",
    /v1 · replaced by v2 from you/,
    "and the line says what replaced it"
  );
  assert.match(
    (await harness("text", ".chat-creation-card .chat-creation-kicker")) ?? "",
    /Training plan · v2/,
    "the card names its version"
  );

  // -------------------------------------------------------------------------
  // Stopped after it produced a card, the turn keeps the card (P0.8)
  // -------------------------------------------------------------------------
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [TRANSCRIPT[0], TRANSCRIPT[1]]
  });
  await waitFor(() => harness("callCount", "getChatSession"), "the conversation is open");
  await harness("setValue", ".chat-composer textarea", "Another block");
  await harness("click", ".chat-send");
  const stopped = await waitFor(
    async () => (await harness("calls", "sendChat"))[0],
    "the turn reaches main"
  );
  await harness("emit", "onChatStreamStart", { requestId: stopped.args[0] });
  await harness("emit", "onChatStreamInfo", {
    requestId: stopped.args[0],
    kind: "planDraft",
    draft: { ...PREVIEW, draftId: "plan-3", name: "Stopped block" }
  });
  await harness("emit", "onChatStreamDone", {
    requestId: stopped.args[0],
    fullText: "",
    finishReason: "cancelled"
  });
  await settle();
  const afterStop = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.ok(
    afterStop.some((entry) => entry.kind === "planDraft" && entry.draft.draftId === "plan-3"),
    "the card a stopped turn produced is saved with the conversation"
  );

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors.filter((line) => !/act\(|ReactDOMTestUtils/.test(line)), []);

  console.log("chat plan card renderer tests passed");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
