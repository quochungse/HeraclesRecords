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

  // Open shows the canvas beside the conversation (P1.4), read with the
  // Library reader's own week cards, from the same document.
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", ".chat-canvas.is-artifact .plan-week-card"), "the canvas opens on the plan");
  assert.equal(await harness("count", ".chat-canvas .plan-week-card"), 3, "every week, an undated plan's too");
  assert.equal(
    await page(`document.querySelector(".chat-canvas .chat-creation-figures dd")?.textContent`),
    "3",
    "the figures are the card's"
  );
  assert.equal(
    await harness("exists", '.chat-canvas-foot [data-action="saveAsPlan"]'),
    await harness("exists", '.chat-creation-card [data-action="saveAsPlan"]'),
    "and so are the buttons"
  );
  assert.equal(await harness("exists", ".chat-creation-card"), true, "the card stays whole while the canvas is open");
  // A session opens inside the canvas, and Escape steps back out of it.
  await harness("click", ".chat-canvas .plan-entry.is-openable");
  await waitFor(() => harness("exists", ".chat-canvas .plan-session"), "a session opens in place");
  await page(`document.querySelector(".chat-canvas .plan-session").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await waitFor(async () => !(await harness("exists", ".chat-canvas .plan-session")), "Escape steps back to the weeks");
  assert.equal(await harness("exists", ".chat-canvas.is-artifact"), true, "without closing the canvas");

  // Removed before it is saved, the card's draft goes too (P0.8).
  await harness("click", ".chat-canvas-foot .chat-creation-modal-remove");
  await harness("click", ".chat-canvas-foot .chat-local-action.is-danger");
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
    upload.args.slice(2, 5),
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
  const VERSIONED = {
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
      { artifactId: "plan-1", draftId: "plan-1-v2", version: 2, author: "athlete", createdAt: 2, parentDraftId: "plan-1", changeSummary: "Long run to Sunday" }
    ],
    restorePlanVersion: {
      preview: { ...PREVIEW, draftId: "plan-1-v3" },
      artifactId: "plan-1",
      fromVersion: 2,
      toVersion: 3,
      changes: ["Moved Long: week 1 Sun → week 1 Sat"]
    }
  };
  await harness("mount", "ChatView", {}, VERSIONED);
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
  // The canvas lists every version, and an older one is read, not saved:
  // its one button makes it the newest again (P1.4).
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", ".chat-canvas-bar"), "the canvas offers the versions");
  await harness("click", '.chat-canvas-bar [role="radio"]:nth-child(2)');
  await waitFor(() => harness("exists", ".chat-canvas-version"), "the versions are listed");
  assert.equal(await harness("count", ".chat-canvas-version"), 2);
  assert.match((await harness("text", ".chat-canvas-versions > li:first-child")) ?? "", /v2.*You.*Newest.*Long run to Sunday/s);
  await harness("click", ".chat-canvas-versions > li:last-child .chat-canvas-version");
  await waitFor(() => harness("exists", ".chat-canvas-older"), "the older version is shown");
  assert.match((await harness("text", ".chat-canvas-older")) ?? "", /v1 · replaced by v2 from you/);
  assert.equal(await harness("exists", '.chat-canvas-foot [data-action="saveAsPlan"]'), false, "with nothing to save");
  await harness("click", '.chat-canvas-foot [data-action="restore"]');
  await waitFor(() => harness("callCount", "restorePlanVersion"), "Restore asks for the version");
  assert.equal((await harness("calls", "restorePlanVersion"))[0].args[0], "plan-1");
  await waitFor(() => harness("exists", ".chat-plan-event-row"), "and a line says where it happened");
  assert.match((await harness("text", ".chat-plan-event-row")) ?? "", /Restored by you · Moved Long/);
  const afterRestore = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.deepEqual(
    afterRestore.slice(-2).map((entry) => entry.kind),
    ["planEvent", "planDraft"],
    "the event, then the new version's card"
  );

  // Removed, a creation goes whole: the older version does not unfold in its place.
  await harness("mount", "ChatView", {}, VERSIONED);
  await waitFor(() => harness("exists", ".chat-version-row"), "the conversation is open again");
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", ".chat-canvas-foot"), "the newest version opens");
  await harness("click", ".chat-canvas-foot .chat-creation-modal-remove");
  await harness("click", ".chat-canvas-foot .chat-local-action.is-danger");
  await waitFor(() => harness("callCount", "removePlanDraft"), "its drafts are let go");
  assert.deepEqual((await harness("calls", "removePlanDraft")).at(-1).args, ["plan-1-v2"]);
  await waitFor(
    async () => !(await harness("exists", ".chat-creation-card")) && !(await harness("exists", ".chat-version-row")),
    "neither version is drawn"
  );
  const afterRemove = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.deepEqual(
    afterRemove.filter((entry) => entry.kind === "planDraft").map((entry) => Boolean(entry.draft.removedAt)),
    [true, true],
    "both cards are marked removed"
  );

  // -------------------------------------------------------------------------
  // An edit saved from the editor is the next version; one begun on a version
  // since replaced asks first (P1.5)
  // -------------------------------------------------------------------------
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    listTrainingLibraryWorkouts: [],
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1 }
    ],
    editPlanDraft: {
      kind: "conflict",
      newest: { draftId: "plan-1-coach", version: 2, author: "coach" }
    }
  });
  await waitFor(() => harness("exists", '.chat-creation-card [data-action="edit"]'), "the card offers Edit");
  await harness("click", '.chat-creation-card [data-action="edit"]');
  await waitFor(() => harness("exists", ".tl-plan-modal .plan-editor-name"), "the plan editor opens");
  assert.equal(
    await harness("exists", '.chat-creation-card [data-action="continueEditing"]'),
    true,
    "while it is open, the card's way on is back into it"
  );
  await harness("setValue", ".tl-plan-modal .plan-editor-name", "Hanoi Half base, mine");
  await settle();
  await page(`[...document.querySelectorAll(".tl-plan-modal button.primary-button")].find((button) => button.textContent.includes("Save changes")).click()`);
  await waitFor(() => harness("callCount", "editPlanDraft"), "the edit is saved");
  assert.deepEqual((await harness("calls", "editPlanDraft"))[0].args.slice(0, 1), ["plan-1"]);
  assert.equal((await harness("calls", "editPlanDraft"))[0].args[3], false, "not over a newer version, unasked");
  await waitFor(
    async () => /changed while you were editing/.test((await page(`document.body.textContent`)) ?? ""),
    "a newer version is found, and the athlete is asked"
  );
  await harness("setScript", {
    editPlanDraft: {
      kind: "written",
      preview: { ...PREVIEW, draftId: "plan-1-v3", name: "Hanoi Half base, mine", editedAt: 9 },
      artifactId: "plan-1",
      fromVersion: 2,
      toVersion: 3,
      changes: ['Renamed to "Hanoi Half base, mine"']
    },
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1 },
      { artifactId: "plan-1", draftId: "plan-1-coach", version: 2, author: "coach", createdAt: 2 },
      { artifactId: "plan-1", draftId: "plan-1-v3", version: 3, author: "athlete", createdAt: 3 }
    ],
    restorePlanVersion: {
      kind: "written",
      preview: { ...PREVIEW, draftId: "plan-1-v4" },
      artifactId: "plan-1",
      fromVersion: 3,
      toVersion: 4,
      changes: ['Renamed to "Hanoi Half base"']
    }
  });
  await page(`[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Replace with my edit").click()`);
  await waitFor(async () => (await harness("callCount", "editPlanDraft")) === 2, "Replace saves again");
  assert.equal((await harness("calls", "editPlanDraft"))[1].args[3], true, "this time over the newer version");
  await waitFor(async () => !(await harness("exists", ".tl-plan-modal")), "the editor closes");
  await waitFor(() => harness("exists", ".chat-plan-event-row"), "the edit leaves a line where it was made");
  assert.match((await harness("text", ".chat-plan-event-row")) ?? "", /Edited by you · Renamed to "Hanoi Half base, mine"/);
  const afterEdit = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.deepEqual(
    afterEdit.slice(-2).map((entry) => [entry.kind, entry.event?.toVersion ?? entry.draft?.draftId]),
    [["planEvent", 3], ["planDraft", "plan-1-v3"]],
    "then the new version's card; the coach's card is left as it was"
  );
  assert.equal(
    afterEdit.find((entry) => entry.kind === "planDraft" && entry.draft.draftId === "plan-1")?.draft.editedAt,
    undefined,
    "no edit is written into the coach's version"
  );
  // Undo restores the version the edit replaced, which is Coach's version 2.
  await waitFor(() => harness("exists", ".chat-plan-event-undo"), "the line offers Undo");
  await harness("click", ".chat-plan-event-undo");
  await waitFor(() => harness("callCount", "restorePlanVersion"), "Undo restores");
  assert.equal((await harness("calls", "restorePlanVersion"))[0].args[0], "plan-1-coach");
  await waitFor(
    async () => (await harness("count", ".chat-plan-event-row")) === 2,
    "and says so on a line of its own"
  );

  // -------------------------------------------------------------------------
  // A plan on COROS is changed by a version that updates it (P1.6)
  // -------------------------------------------------------------------------
  const SAVED_V1 = {
    ...PREVIEW,
    uploadedAt: 3,
    uploadResult: { workoutsScheduled: 0, workoutsCreated: 9, destination: "nativePlan", planId: "coros:900" }
  };
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [
      TRANSCRIPT[0],
      TRANSCRIPT[1],
      { kind: "planDraft", draft: SAVED_V1 },
      { kind: "planDraft", draft: { ...PREVIEW, draftId: "plan-1-v2" } }
    ],
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1, uploadedAt: 3, remotePlanId: "coros:900" },
      { artifactId: "plan-1", draftId: "plan-1-v2", version: 2, author: "coach", createdAt: 4, parentDraftId: "plan-1" }
    ],
    uploadTrainingPlanDraft: {
      planName: PREVIEW.name,
      workoutsCreated: 0,
      workoutsScheduled: 0,
      entries: [],
      destination: "nativePlan",
      planId: "coros:900",
      conflict: { currentVersion: 3, expectedVersion: 2 }
    }
  });
  await waitFor(
    () => harness("exists", '.chat-creation-card [data-action="updatePlan"]'),
    "the new version leads with updating the plan"
  );
  assert.match((await harness("text", ".chat-creation-card .chat-creation-status")) ?? "", /Changes not on COROS/);
  assert.equal(await harness("exists", '.chat-creation-card [data-action="saveAsPlan"]'), false, "not a second plan");
  await harness("click", '.chat-creation-card [data-action="updatePlan"]');
  await waitFor(
    async () => /This plan changed on COROS/.test((await page(`document.body.textContent`)) ?? ""),
    "COROS changed meanwhile, so the athlete is asked"
  );
  await harness("setScript", {
    uploadTrainingPlanDraft: {
      planName: PREVIEW.name,
      workoutsCreated: 9,
      workoutsScheduled: 0,
      entries: [],
      destination: "nativePlan",
      planId: "coros:900"
    }
  });
  await page(`[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Replace with my edit").click()`);
  await waitFor(async () => (await harness("callCount", "uploadTrainingPlanDraft")) === 2, "saved again");
  assert.deepEqual((await harness("calls", "uploadTrainingPlanDraft"))[1].args.at(-1), { overwrite: true });
  await waitFor(() => harness("exists", ".chat-creation-card .chat-plan-success"), "the version is on COROS");
  assert.equal(
    await harness("exists", '.chat-creation-card [data-action="edit"]'),
    true,
    "and it can still be changed, by a next version"
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
