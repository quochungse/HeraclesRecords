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
  openRouter: { model: "openrouter/auto", hasApiKey: false },
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

  // Open shows the creation's details on a screen of their own (P1.4, UAT),
  // read with the Library reader's own week cards, from the same document —
  // and the column beside the conversation does not widen to hold them.
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", ".chat-canvas-dialog .plan-week-card"), "the details open on the plan");
  assert.equal(await harness("exists", "aside.chat-canvas .plan-week-card"), false, "not inside the canvas column");
  assert.equal(await page(`document.querySelector(".chat-canvas-dialog")?.getAttribute("role")`), "dialog");
  // Portalled out of `.chat-view`, it still has the chat's tokens: without them
  // the primary button's fill and border were voided, found in the running app.
  assert.notEqual(
    await page(`getComputedStyle(document.querySelector('.chat-canvas-dialog [data-action="saveAsPlan"]')).backgroundColor`),
    "rgba(0, 0, 0, 0)",
    "the details' primary button keeps the chat's fill"
  );
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
  assert.equal(await harness("exists", ".chat-canvas-dialog"), true, "without closing the details");
  // A second Escape closes the details, and opening them again finds the plan.
  await page(`document.querySelector(".chat-canvas-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await waitFor(async () => !(await harness("exists", ".chat-canvas-dialog")), "Escape closes the details");
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", ".chat-canvas-dialog .plan-week-card"), "the details open again");

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
  // A plan changed on COROS is read back when it is opened or edited (P1.6, D12)
  // -------------------------------------------------------------------------
  const IMPORTED = {
    kind: "imported",
    written: {
      kind: "written",
      preview: {
        ...PREVIEW,
        draftId: "plan-1-coros",
        name: "Hanoi Half base, as I run it",
        uploadedAt: 5,
        uploadResult: { workoutsScheduled: 0, workoutsCreated: 9, destination: "nativePlan", planId: "coros:900" }
      },
      artifactId: "plan-1",
      fromVersion: 1,
      toVersion: 2,
      changes: ['Renamed to "Hanoi Half base, as I run it"']
    }
  };
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    listTrainingLibraryWorkouts: [],
    getChatSession: [TRANSCRIPT[0], TRANSCRIPT[1], { kind: "planDraft", draft: SAVED_V1 }],
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1, uploadedAt: 3, remotePlanId: "coros:900" }
    ],
    syncPlanFromCoros: IMPORTED
  });
  await waitFor(() => harness("exists", ".chat-creation-card .chat-creation-open"), "the saved card is drawn");
  await settle();
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("callCount", "syncPlanFromCoros"), "opening asks whether COROS moved on");
  assert.equal((await harness("calls", "syncPlanFromCoros"))[0].args[2], true, "of the cache, at no cost");
  await waitFor(() => harness("exists", ".chat-plan-event-row"), "and COROS's version comes in, with a line");
  assert.match((await harness("text", ".chat-plan-event-row")) ?? "", /Changed in the Library · Renamed/);
  assert.equal(await harness("exists", ".chat-plan-event-undo"), false, "not the athlete's to undo");
  await waitFor(
    async () => /Hanoi Half base, as I run it/.test((await harness("text", ".chat-creation-card h3, .chat-creation-card .chat-creation-title")) ?? (await page(`[...document.querySelectorAll(".chat-creation-card")].at(-1)?.textContent`)) ?? ""),
    "COROS's version is the card"
  );
  assert.equal(
    await page(`[...document.querySelectorAll(".chat-creation-card")].at(-1).querySelector(".chat-creation-status")?.textContent`),
    "On COROS",
    "and it is saved there, with nothing to update"
  );

  await harness("setScript", { syncPlanFromCoros: { kind: "current" } });
  await harness("clearCalls");
  await harness("click", '.chat-creation-card [data-action="edit"]');
  await waitFor(() => harness("callCount", "syncPlanFromCoros"), "Edit reads COROS first");
  assert.equal((await harness("calls", "syncPlanFromCoros"))[0].args[2], undefined, "for real, not the cache");
  await waitFor(() => harness("exists", ".tl-plan-modal .plan-editor-name"), "then the editor opens");
  await page(`document.querySelector('.tl-plan-modal [aria-label="Close"], .tl-plan-modal .plan-editor-close')?.click()`);

  // Review of P1: an answer from COROS that lands after the athlete moved to
  // another conversation does not put its card there, and one version shared
  // by two asks is one card.
  const OTHER = { ...SESSION, id: "s2", title: "Other chat" };
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    listTrainingLibraryWorkouts: [],
    listChatSessions: [SESSION, OTHER],
    __byArg: {
      getChatSession: {
        '"s1"': [TRANSCRIPT[0], TRANSCRIPT[1], { kind: "planDraft", draft: SAVED_V1 }],
        '"s2"': [{ kind: "message", role: "user", content: "Something else" }]
      }
    },
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1, uploadedAt: 3, remotePlanId: "coros:900" }
    ],
    syncPlanFromCoros: "__pending"
  });
  await waitFor(() => harness("exists", ".chat-creation-card .chat-creation-open"), "the saved card is drawn");
  await settle();
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("callCount", "syncPlanFromCoros"), "opening asks COROS");
  await page(`[...document.querySelectorAll(".chat-session-row-title")].find((title) => title.textContent.includes("Other chat")).click()`);
  await waitFor(
    async () => /Something else/.test((await page(`document.querySelector(".chat-messages, .chat-timeline, main")?.textContent`)) ?? (await page(`document.body.textContent`))),
    "the other conversation is open"
  );
  await harness("clearCalls");
  await harness("resolvePending", "syncPlanFromCoros", IMPORTED);
  await settle();
  assert.equal(await harness("exists", ".chat-plan-event-row"), false, "no line for another conversation's creation here");
  assert.equal(
    (await harness("calls", "saveChatSession")).some((call) => JSON.stringify(call.args[1]).includes("plan-1-coros")),
    false,
    "and nothing of it saved into this one"
  );

  // -------------------------------------------------------------------------
  // A Coach plan goes on the calendar from the conversation, and says so (P1.6)
  // -------------------------------------------------------------------------
  const RUNNING = {
    ...DOCUMENT,
    id: "coros:905",
    remoteId: "905",
    calendar: "running",
    sourcePlanId: "900",
    startDate: "2099-01-05",
    entries: DOCUMENT.entries.map((entry, index) => ({ ...entry, idInPlan: String(index + 1) }))
  };
  const SAVED_ONLY = {
    ...BASE_SCRIPT,
    getChatSession: [TRANSCRIPT[0], TRANSCRIPT[1], { kind: "planDraft", draft: SAVED_V1 }],
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1, uploadedAt: 3, remotePlanId: "coros:900" }
    ],
    syncPlanFromCoros: { kind: "current" },
    getPlanCalendarState: [
      {
        artifactId: "plan-1",
        remotePlanId: "coros:900",
        running: RUNNING,
        matches: [{ schedulePlanId: "905", scheduleIdInPlan: "1", status: "upcoming" }]
      }
    ]
  };
  await harness("mount", "ChatView", {}, SAVED_ONLY);
  await waitFor(
    async () => (await harness("text", ".chat-creation-card .chat-creation-status")) === "On calendar",
    "a plan COROS is running reads as on the calendar"
  );
  assert.match((await harness("text", ".chat-creation-card .chat-plan-success")) ?? "", /On your COROS calendar · Starts .* · 1 session ahead\./);
  assert.equal(await harness("exists", '.chat-creation-card [data-action="addToCalendar"]'), false, "and is not offered again");

  // Saved, not running: added from the card, through the Library's dialog.
  await harness("mount", "ChatView", {}, {
    ...SAVED_ONLY,
    getPlanCalendarState: [{ artifactId: "plan-1", remotePlanId: "coros:900", matches: [] }],
    getPlanDraftDocument: { ...DOCUMENT, id: "coros:900", remoteId: "900" },
    previewTrainingPlanCalendar: {
      planId: "coros:900",
      startDay: "20990105",
      anchorDay: "20990105",
      entries: [],
      blockers: []
    }
  });
  await waitFor(() => harness("exists", '.chat-creation-card [data-action="addToCalendar"]'), "a saved plan offers the calendar");
  await harness("click", '.chat-creation-card [data-action="addToCalendar"]');
  await waitFor(() => harness("callCount", "previewTrainingPlanCalendar"), "the dialog reads what COROS will do");
  assert.equal((await harness("calls", "previewTrainingPlanCalendar"))[0].args[0], "coros:900");

  // Not saved: the dialog reads it through the chat, and saves it first.
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    previewTrainingPlanCalendar: { planId: "chat:plan-1", startDay: "20990105", anchorDay: "20990105", entries: [], blockers: [] }
  });
  await waitFor(() => harness("exists", '.chat-creation-card [data-action="addToCalendar"]'), "a programme offers the calendar too");
  await harness("click", '.chat-creation-card [data-action="addToCalendar"]');
  await waitFor(() => harness("callCount", "previewTrainingPlanCalendar"), "read before it is saved");
  assert.equal((await harness("calls", "previewTrainingPlanCalendar"))[0].args[0], "chat:plan-1");
  assert.equal(await harness("callCount", "uploadTrainingPlanDraft"), 0, "nothing saved until the day is picked");

  // -------------------------------------------------------------------------
  // Asking about a week goes with the question, as a line above it (P1.7)
  // -------------------------------------------------------------------------
  await harness("mount", "ChatView", {}, BASE_SCRIPT);
  await waitFor(() => harness("exists", ".chat-creation-card .chat-creation-open"), "the plan card is drawn");
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", ".chat-canvas .plan-week-ask"), "each week offers Ask Coach");
  await harness("click", ".chat-canvas .plan-week-card:nth-child(2) .plan-week-ask");
  await waitFor(() => harness("exists", ".chat-refs-pending .chat-ref-chip"), "the week waits beside the composer");
  assert.match((await harness("text", ".chat-refs-pending .chat-ref-chip")) ?? "", /Hanoi Half base · Week 2/);
  assert.equal(await harness("exists", ".chat-canvas-dialog"), false, "the details close onto the composer");
  await harness("click", ".chat-creation-open");
  await waitFor(() => harness("exists", '.chat-canvas-dialog [data-action="askPlan"]'), "the details open again");
  await harness("click", '.chat-canvas [data-action="askPlan"]');
  await waitFor(async () => (await harness("count", ".chat-refs-pending .chat-ref-chip")) === 2, "and the whole plan beside it");
  await harness("click", ".chat-refs-pending .chat-ref-chip:last-of-type .chat-ref-remove");
  await waitFor(async () => (await harness("count", ".chat-refs-pending .chat-ref-chip")) === 1, "a chip can be taken off");
  await harness("setValue", ".chat-composer textarea", "Is this week too much?");
  await harness("click", ".chat-send");
  const asked = await waitFor(
    async () => (await harness("calls", "sendChat"))[0],
    "the question is sent"
  );
  assert.match(asked.args[1].at(-1).content, /asking about the plan "Hanoi Half base" \(draft_id plan-1\) — Week 2/);
  assert.match(asked.args[1].at(-1).content, /Is this week too much\?$/);
  const afterAsk = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.deepEqual(
    afterAsk.slice(-2).map((entry) => entry.kind),
    ["planRefs", "message"],
    "the reference is kept just before the question"
  );
  assert.equal(await harness("exists", ".chat-refs-pending"), false, "and leaves the composer");
  await waitFor(() => harness("exists", ".chat-refs-row"), "it reads as a line above the question");

  // From the Library: the conversation the plan came from, with the plan beside the composer.
  await harness("mount", "ChatView", {
    pendingPrompt: {
      draftId: "plan-1",
      refs: [{ artifactId: "plan-1", draftId: "plan-1", name: "Hanoi Half base", artifactType: "plan", scope: "plan", label: "the whole plan" }]
    }
  }, { ...BASE_SCRIPT, findChatSessionForDraft: "s1" });
  await waitFor(() => harness("callCount", "findChatSessionForDraft"), "the conversation is looked for");
  assert.deepEqual((await harness("calls", "findChatSessionForDraft"))[0].args, ["plan-1"]);
  await waitFor(() => harness("exists", ".coach-ask-picker"), "the athlete picks where to ask");
  assert.match(
    (await harness("text", ".coach-ask-option:not(.is-new)")) ?? "",
    /Where this plan was made/,
    "the plan's own conversation leads the list"
  );
  await harness("click", ".coach-ask-option:not(.is-new)");
  await waitFor(() => harness("exists", ".chat-refs-pending .chat-ref-chip"), "and the plan waits to be asked about");

  // -------------------------------------------------------------------------
  // A follow-up under the card is a question about it (P1.8)
  // -------------------------------------------------------------------------
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getPlanArtifacts: [
      { artifactId: "plan-1", draftId: "plan-1", version: 1, author: "coach", createdAt: 1, refinements: ["Lighter week 3", "Add hills"] }
    ]
  });
  await waitFor(
    async () => (await harness("count", ".chat-creation-card .chat-refine-chip")) === 2,
    "Coach's own follow-ups, under its card"
  );
  await harness("click", ".chat-creation-card .chat-refine-chip:first-child");
  const refined = await waitFor(async () => (await harness("calls", "sendChat"))[0], "a press asks");
  assert.match(refined.args[1].at(-1).content, /asking about the plan "Hanoi Half base" v1 \(draft_id plan-1\) — the whole of it\.[\s\S]*Lighter week 3$/);
  const afterRefine = (await harness("calls", "saveChatSession")).at(-1)?.args[1] ?? [];
  assert.deepEqual(afterRefine.slice(-2).map((entry) => entry.kind), ["planRefs", "message"]);
  assert.equal(afterRefine.at(-1).content, "Lighter week 3", "in the chip's own words");

  // -------------------------------------------------------------------------
  // A conversation says what it reads and which AI answers, and turns take it (P2.0)
  // -------------------------------------------------------------------------
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getConversationSettings: { sessionId: "s1", sources: { activities: true, sleep: true, zones: true } },
    setConversationSettings: { sessionId: "s1", sources: { activities: true, sleep: false, zones: true } }
  });
  await waitFor(() => harness("exists", ".chat-conversation-settings"), "the conversation's line is drawn");
  assert.match((await harness("text", ".chat-conversation-settings")) ?? "", /Reads: Activities · Sleep · Zones\s*AI: Coach's settings/);
  await harness("click", ".chat-conversation-settings");
  await waitFor(() => harness("count", ".coach-sheet .plan-generator-source").then((n) => n === 3), "three sources to share or not");
  await harness("click", ".coach-sheet li:nth-child(2) .plan-generator-source");
  await waitFor(() => harness("callCount", "setConversationSettings"), "switching one off is kept");
  assert.deepEqual(
    (await harness("calls", "setConversationSettings"))[0].args[0],
    { sessionId: "s1", sources: { activities: true, sleep: false, zones: true } }
  );
  await waitFor(
    async () => /Reads: Activities · Zones/.test((await harness("text", ".chat-conversation-settings")) ?? ""),
    "and the line says so"
  );
  await page(`[...document.querySelectorAll(".coach-sheet button")].find((b) => b.textContent.trim() === "Done").click()`);
  await harness("setValue", ".chat-composer textarea", "How am I sleeping?");
  await harness("click", ".chat-send");
  const inConversation = await waitFor(async () => (await harness("calls", "sendChat"))[0], "the question goes");
  assert.equal(inConversation.args[3], "s1", "with the conversation it was asked in, whose settings the turn takes");

  // -------------------------------------------------------------------------
  // A brief: read on its card, changed on its own screen, listed for Coach (P2.1)
  // -------------------------------------------------------------------------
  const BRIEF = {
    artifactId: "brief-1",
    sessionId: "s1",
    request: {
      goalKind: "race",
      goal: "Hanoi Half",
      race: { date: "2031-05-18", distance: "Half" },
      sports: ["run"],
      difficulty: "custom",
      startDate: "2031-03-03",
      week: { mode: "days", days: [{ kind: "rest" }, { kind: "train", minutes: 60 }, { kind: "train", minutes: 60 }, { kind: "rest" }, { kind: "train", minutes: 60 }, { kind: "long", minutes: 120 }, { kind: "train", minutes: 60 }] }
    },
    origins: { goal: "chat", level: "data" },
    createdAt: "2026-09-26T06:00:00.000Z",
    updatedAt: "2026-09-26T06:00:00.000Z"
  };
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [
      { kind: "message", role: "user", content: "Plan me the Hanoi Half" },
      { kind: "message", role: "assistant", content: "Here is what I have so far." },
      { kind: "planBrief", artifactId: "brief-1" }
    ],
    getPlanBriefs: [BRIEF],
    getConversationSettings: { sessionId: "s1", sources: { activities: false, sleep: true, zones: true } },
    setConversationSettings: { sessionId: "s1", sources: { activities: true, sleep: true, zones: true } },
    updatePlanBrief: { ...BRIEF, request: { ...BRIEF.request, difficulty: "intermediate" }, origins: { goal: "chat" } }
  });
  await waitFor(() => harness("exists", ".chat-brief-card"), "the brief is drawn from its anchor");
  const briefText = (await harness("text", ".chat-brief-card")) ?? "";
  assert.match(briefText, /Plan brief[\s\S]*Hanoi Half/);
  assert.match(briefText, /from chat/, "a field Coach took from the conversation says so");
  assert.match(briefText, /from your data/, "and one it read from the data");
  assert.match(briefText, /Coach reads Sleep & HRV · Training zones in this conversation/);
  assert.match(
    (await harness("text", ".chat-brief-open")) ?? "",
    /can't judge your level without your recent activities/,
    "From my data without the activities is still open"
  );
  await harness("click", ".chat-brief-card .chat-plan-review");
  await waitFor(() => harness("exists", ".coach-sheet .plan-generator"), "Edit brief opens its own screen");
  assert.equal(await harness("count", ".coach-sheet .plan-generator-source"), 3, "beside the conversation's switches");
  await page(`[...document.querySelectorAll(".coach-sheet button")].find((b) => b.textContent.trim().startsWith("Intermediate")).click()`);
  await page(`[...document.querySelectorAll(".coach-sheet button")].find((b) => b.textContent.trim() === "Save brief").click()`);
  const savedBrief = await waitFor(async () => (await harness("calls", "updatePlanBrief"))[0], "the brief is saved");
  assert.equal(savedBrief.args[0], "brief-1");
  assert.equal(savedBrief.args[1].difficulty, "intermediate");
  assert.equal(savedBrief.args[1].sources, undefined, "the conversation's sources stay the conversation's");
  await waitFor(async () => !(await harness("exists", ".coach-sheet .plan-generator")), "and the screen closes");
  await waitFor(
    async () => !/from your data/.test((await harness("text", ".chat-brief-card")) ?? ""),
    "the level is the athlete's now"
  );
  await harness("setValue", ".chat-composer textarea", "Looks right");
  await harness("click", ".chat-send");
  const withBrief = await waitFor(async () => (await harness("calls", "sendChat"))[0], "the turn goes");
  assert.match(withBrief.args[1].at(-1).content, /- Brief · brief_id brief-1 · race \(Half\) "Hanoi Half" on 2031-05-18/);

  // -------------------------------------------------------------------------
  // An outline: asked for from the brief, read on its card, adjusted by hand,
  // redrawn with a note (P2.2)
  // -------------------------------------------------------------------------
  // On the real clock: the brief's own checks hold a plan to starting within a year.
  const soon = new Date();
  soon.setDate(soon.getDate() + ((8 - soon.getDay()) % 7 || 7));
  const soonMonday = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  const BASE_BRIEF = {
    ...BRIEF,
    artifactId: "brief-2",
    request: { ...BRIEF.request, goalKind: "base", goal: "", race: undefined, weeks: 8, difficulty: "intermediate", startDate: soonMonday },
    origins: {}
  };
  const OUTLINE = {
    summary: "Eight weeks of base, easing every fourth.",
    basis: "About four hours a week lately.",
    weeks: Array.from({ length: 8 }, (_, index) => ({
      stage: index < 6 ? 2 : 3,
      lighter: index === 3,
      hours: 4 + (index % 4) * 0.5,
      sessions: 5,
      focus: `Week ${index + 1} focus`,
      keySessions: index === 1 ? [{ dayIndex: 5, name: "Long run", sport: "run", minutes: 100 }] : []
    }))
  };
  const ALL_SOURCES = { sessionId: "s1", sources: { activities: true, sleep: true, zones: true } };

  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [
      { kind: "message", role: "user", content: "A base block" },
      { kind: "planBrief", artifactId: "brief-2" }
    ],
    getPlanBriefs: [BASE_BRIEF],
    getConversationSettings: ALL_SOURCES
  });
  await waitFor(() => harness("exists", ".chat-brief-card"), "the brief is drawn");
  await page(`[...document.querySelectorAll(".chat-brief-card button")].find((b) => b.textContent.trim() === "Draw the outline").click()`);
  const drawn = await waitFor(async () => (await harness("calls", "sendChat"))[0], "Draw the outline sends a turn");
  assert.deepEqual(drawn.args[4], { step: "outline", artifactId: "brief-2" }, "the step travels beside the words");
  assert.equal(await harness("callCount", "compactChatContext"), 0, "a step is not compacted first: it sends only its recent messages (P2.4)");
  assert.equal(drawn.args[1].at(-1).content.endsWith("Draw the outline"), true, "the words are what the athlete sees");
  await harness("emit", "onChatStreamStart", { requestId: drawn.args[0] });
  await harness("emit", "onChatStreamInfo", {
    requestId: drawn.args[0],
    kind: "planOutline",
    brief: { ...BASE_BRIEF, outline: { outline: OUTLINE, version: 1, author: "coach", updatedAt: "" } }
  });
  await harness("emit", "onChatStreamDone", { requestId: drawn.args[0], fullText: "Here is the shape.", finishReason: "stop" });
  await waitFor(() => harness("exists", ".chat-outline-card"), "the outline lands on its card");
  assert.equal(
    await page(`[...document.querySelectorAll(".chat-brief-card button")].some((b) => b.textContent.trim() === "Draw the outline")`),
    false,
    "the brief stops asking for an outline once it has one"
  );
  assert.equal(
    await page(`[...document.querySelectorAll(".chat-brief-card button")].some((b) => /Edit brief|Continue editing/.test(b.textContent))`),
    false,
    "nor offers to be edited: the outline is what changes from here (UAT)"
  );
  assert.equal(
    await page(`(() => { const row = [...document.querySelectorAll(".chat-outline-card .chat-plan-actions > button")]; const last = row.at(-1); return last?.textContent.trim() === "Write the sessions" && Boolean(last.querySelector("svg")); })()`),
    true,
    "the way on to the sessions ends the row, with an arrow (UAT)"
  );
  const outlineText = (await harness("text", ".chat-outline-card")) ?? "";
  assert.match(outlineText, /Plan outline[\s\S]*8 weeks · 4–5.5 h a week · 5 sessions/);
  assert.match(outlineText, /What Coach read: About four hours a week lately\./);
  assert.equal(await harness("count", ".chat-outline-bar"), 8, "a bar a week");
  assert.equal(await harness("count", ".chat-outline-bar.is-lighter"), 1);
  await page(`document.querySelectorAll(".chat-outline-bar")[1].click()`);
  await waitFor(
    async () => /Week 2 · Base[\s\S]*Long run/.test((await harness("text", ".chat-outline-week")) ?? ""),
    "picking a bar shows that week"
  );

  await page(`[...document.querySelectorAll(".chat-outline-card button")].find((b) => b.textContent.trim() === "Adjust outline").click()`);
  await waitFor(() => harness("exists", ".coach-sheet .chat-outline-editor"), "Adjust outline opens its own screen");
  assert.equal(await harness("count", ".chat-outline-editor-weeks > li"), 8);
  await page(`(() => { const input = document.querySelectorAll('.chat-outline-editor input[aria-label^="Sessions in week"]')[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "9"); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await waitFor(
    async () => /Week 1 has 9 sessions/.test((await harness("text", ".chat-outline-editor .plan-generator-footer-hint")) ?? ""),
    "the screen says what breaks the brief, as the tool would"
  );
  const saveDisabled = () =>
    page(`[...document.querySelectorAll(".chat-outline-editor button")].find((b) => b.textContent.trim() === "Save outline").disabled`);
  assert.equal(await saveDisabled(), true, "and will not save it");
  await page(`(() => { const input = document.querySelectorAll('.chat-outline-editor input[aria-label^="Sessions in week"]')[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "5"); input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await page(`document.querySelectorAll('.chat-outline-editor-lighter input')[5].click()`);
  await waitFor(async () => (await saveDisabled()) === false, "a change that fits can be saved");
  await harness("setScript", {
    updatePlanOutline: {
    ...BASE_BRIEF,
    outline: {
      outline: { ...OUTLINE, weeks: OUTLINE.weeks.map((week, index) => (index === 5 ? { ...week, lighter: true } : week)) },
      version: 2,
      author: "athlete",
      updatedAt: ""
    }
    }
  });
  await page(`[...document.querySelectorAll(".chat-outline-editor button")].find((b) => b.textContent.trim() === "Save outline").click()`);
  const adjusted = await waitFor(async () => (await harness("calls", "updatePlanOutline"))[0], "the adjustment is saved");
  assert.equal(adjusted.args[0], "brief-2");
  assert.equal(adjusted.args[1].weeks[5].lighter, true);
  assert.equal(adjusted.args[1].weeks[0].sessions, 5);
  await waitFor(async () => !(await harness("exists", ".coach-sheet .chat-outline-editor")), "and the screen closes");
  await waitFor(
    async () => /Adjusted by you · v2/.test((await harness("text", ".chat-outline-card")) ?? ""),
    "the card says whose outline it is now"
  );

  await harness("clearCalls");
  await page(`[...document.querySelectorAll(".chat-outline-card button")].find((b) => b.textContent.includes("Redraw with a note")).click()`);
  await waitFor(() => harness("exists", ".chat-outline-redraw input"), "the note opens under the card");
  await harness("setValue", ".chat-outline-redraw input", "travelling in week 6");
  await harness("click", ".chat-outline-redraw button[type=submit]");
  const redraw = await waitFor(async () => (await harness("calls", "sendChat"))[0], "a redraw is a turn too");
  assert.deepEqual(redraw.args[4], { step: "outline", artifactId: "brief-2", note: "travelling in week 6" });
  assert.equal(redraw.args[1].at(-1).content.endsWith("Redraw the outline: travelling in week 6"), true);
  await harness("emit", "onChatStreamStart", { requestId: redraw.args[0] });
  await harness("emit", "onChatStreamInfo", {
    requestId: redraw.args[0],
    kind: "planOutline",
    brief: { ...BASE_BRIEF, outline: { outline: OUTLINE, version: 3, author: "coach", updatedAt: "" } }
  });
  await harness("emit", "onChatStreamDone", { requestId: redraw.args[0], fullText: "Redrawn.", finishReason: "stop" });
  await waitFor(async () => /Redrawn below/.test((await harness("text", ".chat-plan-event-row")) ?? ""), "the earlier outline folds");
  assert.equal(await harness("count", ".chat-outline-card"), 1, "one card, at the latest anchor");
  assert.match((await harness("text", ".chat-outline-card")) ?? "", /Outline · v3/);

  // Write the sessions (P2.3): a turn whose trail shows in the running bubble,
  // and after which the brief and its outline are changed through the plan.
  await harness("clearCalls");
  await page(`[...document.querySelectorAll(".chat-outline-card button")].find((b) => b.textContent.trim() === "Write the sessions").click()`);
  const sessions = await waitFor(async () => (await harness("calls", "sendChat"))[0], "Write the sessions sends a turn");
  assert.deepEqual(sessions.args[4], { step: "sessions", artifactId: "brief-2" });
  assert.equal(sessions.args[1].at(-1).content.endsWith("Write the sessions"), true);
  await harness("emit", "onChatStreamStart", { requestId: sessions.args[0] });
  await harness("emit", "onChatStreamInfo", { requestId: sessions.args[0], kind: "mcp", tool: "get_training_zones", status: "call" });
  await harness("emit", "onChatStreamInfo", { requestId: sessions.args[0], kind: "mcp", tool: "draft_training_plan", status: "call" });
  await waitFor(
    async () => /Writing the sessions[\s\S]*Read your training zones[\s\S]*Handing the sessions to the check/.test((await harness("text", ".chat-step-trail")) ?? ""),
    "the running bubble shows what Coach has done, the latest still under way"
  );
  const WRITTEN = { ...PREVIEW, draftId: "brief-2-v1" };
  await harness("setScript", {
    getPlanArtifacts: [{ artifactId: "brief-2", draftId: "brief-2-v1", version: 1, author: "coach", createdAt: 1 }]
  });
  await harness("emit", "onChatStreamInfo", { requestId: sessions.args[0], kind: "planDraft", draft: WRITTEN });
  await waitFor(() => harness("exists", ".chat-creation-card"), "the plan's card lands while the step still runs");
  assert.equal(
    await page(`Boolean([...document.querySelectorAll(".chat-row")].at(-1)?.querySelector(".chat-step-trail"))`),
    true,
    "the step's progress stays under what it has produced, at the very end (UAT)"
  );
  assert.equal(await harness("exists", "aside.chat-canvas"), false, "a new creation does not pull the Creations list open (UAT)");
  await harness("emit", "onChatStreamDone", { requestId: sessions.args[0], fullText: "Written.", finishReason: "stop" });
  await waitFor(async () => !(await harness("exists", ".chat-step-trail")), "the trail goes with the turn");
  await waitFor(() => harness("exists", ".chat-creation-card[data-draft-id='brief-2-v1'], .chat-creation-card"), "the plan's card lands");
  await waitFor(
    async () => /sessions are written to this outline/.test((await harness("text", ".chat-outline-card")) ?? ""),
    "the outline hands over to the plan"
  );
  assert.equal(
    await page(`[...document.querySelectorAll(".chat-outline-card button, .chat-brief-card button")].some((b) => /Adjust outline|Redraw|Write the sessions|Edit brief/.test(b.textContent))`),
    false,
    "and neither the brief nor the outline offers a change the main process would refuse"
  );

  // -------------------------------------------------------------------------
  // Review of P2: a refused step is taken back, the error reads as a reason,
  // the conversation's own AI decides the key check, and a pull re-reads
  // briefs and settings
  // -------------------------------------------------------------------------
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [
      { kind: "message", role: "user", content: "A base block" },
      { kind: "planBrief", artifactId: "brief-2" }
    ],
    getPlanBriefs: [BASE_BRIEF],
    getConversationSettings: ALL_SOURCES,
    sendChat: { __reject: "That brief is no longer in this conversation." }
  });
  await waitFor(() => harness("exists", ".chat-brief-card"), "the brief is drawn");
  await page(`[...document.querySelectorAll(".chat-brief-card button")].find((b) => b.textContent.trim() === "Draw the outline").click()`);
  await waitFor(async () => (await harness("calls", "sendChat")).length === 1, "the step is sent");
  const refusedError = await waitFor(
    async () => (await harness("calls", "prop:onError")).map((call) => call.args[0]).find((message) => typeof message === "string" && message),
    "the refusal is reported"
  );
  assert.equal(refusedError, "That brief is no longer in this conversation.", "in its own words, not Electron's plumbing");
  await waitFor(
    async () => !(await page(`[...document.querySelectorAll(".chat-row-user")].some((row) => row.textContent.includes("Draw the outline"))`)),
    "the refused step's words are taken back"
  );
  const takenBack = (await harness("calls", "saveChatSession")).at(-1);
  assert.ok(takenBack, "and the conversation is saved without them");
  assert.equal(
    takenBack.args[1].some((entry) => entry.kind === "message" && entry.content === "Draw the outline"),
    false
  );

  // Coach's AI is ready; this conversation answers with OpenRouter, which has no key.
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getConversationSettings: { ...ALL_SOURCES, runtime: { provider: "openrouter", model: "some/model" } }
  });
  await waitFor(() => harness("callCount", "getConversationSettings"), "the conversation's settings are read");
  await settle();
  await harness("setValue", ".chat-composer textarea", "How was my week?");
  await harness("click", ".chat-send");
  const keyError = await waitFor(
    async () => (await harness("calls", "prop:onError")).map((call) => call.args[0]).find((message) => typeof message === "string" && message),
    "the missing key is named"
  );
  assert.match(keyError, /OpenRouter API key/, "the key this conversation's AI needs, not Coach's");
  assert.equal(await harness("callCount", "sendChat"), 0, "and nothing is sent to fail in the main process");

  // A pull that merged another machine's brief and settings.
  await harness("mount", "ChatView", {}, {
    ...BASE_SCRIPT,
    getChatSession: [{ kind: "planBrief", artifactId: "brief-2" }],
    getPlanBriefs: [BASE_BRIEF],
    getConversationSettings: ALL_SOURCES
  });
  await waitFor(() => harness("exists", ".chat-brief-card"), "the brief is drawn");
  const briefReads = await harness("callCount", "getPlanBriefs");
  const settingsReads = await harness("callCount", "getConversationSettings");
  await harness("setScript", {
    getPlanBriefs: [{ ...BASE_BRIEF, outline: { outline: OUTLINE, version: 1, author: "coach", updatedAt: "" } }]
  });
  await harness("emit", "onSyncChanged", { tables: ["chat_plan_artifacts", "chat_conversation_settings"], applied: 2, skipped: 0 });
  await waitFor(async () => (await harness("callCount", "getPlanBriefs")) > briefReads, "the briefs are read again");
  await waitFor(async () => (await harness("callCount", "getConversationSettings")) > settingsReads, "and so are the settings");
  await waitFor(
    async () => !(await page(`[...document.querySelectorAll(".chat-brief-card button")].some((b) => b.textContent.trim() === "Draw the outline")`)),
    "the brief now knows its outline, drawn on the other machine"
  );

  // -------------------------------------------------------------------------
  // AI Plan: the brief is filled in first, then a conversation opens on it
  // and the outline is drawn at once (P2.5, UAT)
  // -------------------------------------------------------------------------
  const STARTED = { ...BASE_BRIEF, artifactId: "brief-new", sessionId: "s-new" };
  const NO_SLEEP = { activities: true, sleep: false, zones: true };
  await harness("mount", "ChatView", { pendingPrompt: { newPlan: { request: STARTED.request, sources: NO_SLEEP } } }, {
    ...BASE_SCRIPT,
    setConversationSettings: { sessionId: "s-new", sources: NO_SLEEP },
    getConversationSettings: { sessionId: "s-new", sources: NO_SLEEP },
    getPlanBriefs: [STARTED],
    createChatSession: { id: "s-new", provider: "claude-code", title: "New chat", updatedAt: new Date().toISOString() },
    createPlanBrief: STARTED,
    renameChatSession: { id: "s-new", provider: "claude-code", title: "New plan", updatedAt: new Date().toISOString() },
    saveChatSession: { id: "s-new", provider: "claude-code", title: "New plan", updatedAt: new Date().toISOString() }
  });
  const planBrief = await waitFor(async () => (await harness("calls", "createPlanBrief"))[0], "the brief is made");
  assert.equal(planBrief.args[0], "s-new", "in the new conversation");
  assert.deepEqual(planBrief.args[1], JSON.parse(JSON.stringify(STARTED.request)), "from what the athlete filled in");
  assert.deepEqual(
    (await harness("calls", "setConversationSettings"))[0]?.args[0],
    { sessionId: "s-new", sources: NO_SLEEP },
    "with what Coach may read as the athlete left it"
  );
  assert.deepEqual((await harness("calls", "renameChatSession"))[0]?.args, ["s-new", "New plan"]);
  const savedNew = await waitFor(
    async () => (await harness("calls", "saveChatSession")).find((call) => call.args[0] === "s-new"),
    "the anchor is saved at once"
  );
  assert.equal(savedNew.args[1][0]?.kind, "planBrief", "the brief's anchor is the conversation's first entry");
  const outlineTurn = await waitFor(
    async () => (await harness("calls", "sendChat"))[0],
    "Start plan draws the outline without another press"
  );
  assert.equal(outlineTurn.args[3], "s-new", "in the new conversation");
  assert.equal(
    await page(`[...document.querySelectorAll(".chat-row-user")].some((row) => row.textContent.includes("Draw the outline"))`),
    false,
    "the athlete pressed nothing, so no message of theirs is drawn for it (UAT)"
  );
  assert.deepEqual(outlineTurn.args[4], { step: "outline", artifactId: "brief-new" }, "as the outline step of that brief");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await harness("callCount", "sendChat"), 1, "and only once");

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
