// The AI plan generator, mounted for real in Electron's Chromium.
//
// `test:training-plan-generation` holds the rules; this holds the screen that
// states them, where every one of these was wrong and type-checked:
//
// - **Every provider Coach offers is recognised.** OpenRouter fell through to
//   the local-model branch, was named "ChatGPT", and could never generate. And
//   opening the dialog no longer sends a live test request to the provider.
// - **The AI panel changes this plan only** unless the athlete keeps it for
//   Coach: an untouched panel sends no runtime, a changed one sends only what
//   differs, and each sign-in status is read once, when the panel lists it.
// - **A step nobody has touched is not red**, and moving on from an
//   incomplete one marks the field and puts focus on it.
// - **Every goal fits somewhere**: "Something else" takes the athlete's own
//   words, a goal that is not a race may leave its length to Coach, and a
//   race runs to the day picked for it.
// - **"Not sure" is an answer**: a week may be set day by day, with days
//   Coach may use or leave free, or left to Coach with only what is certain.
// - **Clicking the word "Weeks" does not take a week off.** The steppers sat
//   inside `<label>`s, and a label forwards a click on its text to the first
//   control inside it — the "fewer" button.
// - **The plan's shape is read before its sessions are written.** The outline
//   is drawn, picked through week by week and redrawn in the athlete's words;
//   the sessions are then written to it, and an outline whose request has
//   changed since is drawn again rather than written to.
// - **An outline is not left drawn from data Coach may no longer read.**
//   Switching a source under it asks first and, on yes, draws it again; it
//   used to leave the outline stale and the step blank.
// - **The run's steps only move forward**, and a failed read does not put its
//   raw error where the step is. **Stop returns to the week with everything
//   kept**, and a result arriving after Stop is ignored.
// - **Stop returns to where the run began** — the week, or the outline being
//   redrawn — with everything kept.
// - **A finished plan is kept as a library draft before anything else**, so
//   closing the dialog on its last step loses nothing.
// - **The last step saves it or schedules it.** Save to COROS writes it
//   once; Add to calendar asks for the day first — previewed from the kept
//   draft, before anything is on COROS — then saves and adds it, in that order.
// - **Edit plan does not close the generator**: it waits hidden and deaf to
//   Escape under the editor, and comes back showing what the editor kept.
// - **A run says what Coach is doing**: a line per read and per point its
//   thinking turns to, and the words it is on, kept out of the live region.
// - **Escape steps back one layer**: out of the AI panel, out of a run, then
//   out of the dialog.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

let win;

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return win.webContents
    .executeJavaScript(`window.__harness.${method}(${list})`, true)
    .catch((error) => {
      throw new Error(`harness ${method} failed: ${error.message}`);
    });
}

function evaluate(source) {
  return win.webContents.executeJavaScript(source, true);
}

async function settle() {
  for (let pass = 0; pass < 4; pass += 1) {
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
}

function pressEscape() {
  return evaluate(
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })), true`
  );
}

const settings = (provider, patch = {}) => ({
  provider,
  chatgpt: {},
  anthropic: { hasApiKey: false, model: "" },
  claudeCode: {},
  openRouter: { hasApiKey: false, model: "openrouter/auto" },
  local: { baseUrl: "", model: "" },
  compactContext: { enabled: true, limit: 60, keep: 20 },
  ...patch
});

const OUTLINE = {
  summary: "Four weeks: build steadily, then ease off.",
  basis: "About 30 km a week lately; long run 14 km.",
  weeks: [
    { stage: 2, lighter: false, hours: 4, sessions: 4, focus: "Settle in.", keySessions: [{ dayIndex: 5, name: "Long run", sport: "run", minutes: 90 }] },
    { stage: 3, lighter: false, hours: 5, sessions: 4, focus: "More volume.", keySessions: [{ dayIndex: 2, name: "Tempo", sport: "run", minutes: 50 }] },
    { stage: 3, lighter: true, hours: 3, sessions: 3, focus: "Absorb it.", keySessions: [] },
    { stage: 4, lighter: false, hours: 5.5, sessions: 4, focus: "The hardest week.", keySessions: [] }
  ]
};

const READY = {
  getChatSettings: settings("openrouter", { openRouter: { hasApiKey: true, model: "openrouter/auto" } }),
  outlineTrainingPlan: { ok: true, outline: OUTLINE }
};

async function mount(script = READY) {
  await harness("mount", "TrainingPlanGenerator", {}, script);
  await settle();
}

const NEXT = ".plan-generator > footer .primary-button";

/** The goal step, filled with the one kind that asks nothing more, and left. */
async function toWeek() {
  await harness("clickText", ".plan-generator-goal-kind", "Build a base");
  await settle();
  await harness("click", NEXT);
  await settle();
  assert.equal(await harness("exists", ".plan-generator-week-summary"), true, "the goal step leads to the week");
}

/** On to the outline, with `outlineTrainingPlan` scripted to answer at once. */
async function toOutline() {
  await toWeek();
  await harness("click", NEXT);
  await settle();
  assert.equal(await harness("exists", ".plan-generator-outline-bars"), true, "the week leads to the outline");
}

const stageStates = () =>
  evaluate(`[...document.querySelectorAll(".plan-generator-stages li")].map((li) => li.className)`);

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { backgroundThrottling: false }
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // 1. Providers ------------------------------------------------------------
  {
    await mount();
    assert.equal(await harness("text", ".plan-generator-provider strong"), "OpenRouter");
    assert.equal(await harness("exists", ".plan-generator-provider.is-ready"), true, "an OpenRouter key in place is ready");
    for (const probe of ["testAnthropicConnection", "testLocalChatConnection", "testOpenRouterConnection", "getChatAuthStatus", "getClaudeCodeStatus"]) {
      assert.equal(await harness("callCount", probe), 0, `opening the dialog does not call ${probe}`);
    }

    await mount({ getChatSettings: settings("openrouter") });
    assert.equal(await harness("exists", ".plan-generator-provider.is-blocked"), true);
    assert.match(await harness("text", ".plan-generator-provider small"), /OpenRouter API key/);
    await toWeek();
    assert.equal(await harness("attr", NEXT, "disabled"), "", "nothing to write the plan with");
    assert.match(await harness("text", ".plan-generator-footer-hint"), /Pick an AI that is set up/);

    await mount({ getChatSettings: settings("chatgpt"), getChatAuthStatus: { signedIn: true } });
    assert.equal(await harness("text", ".plan-generator-provider strong"), "ChatGPT");
    assert.equal(await harness("exists", ".plan-generator-provider.is-ready"), true);
    assert.equal(await harness("exists", ".plan-generator-provider > svg, .plan-generator-provider svg"), false, "the provider card carries no status mark");
    const pane = await harness("rect", ".plan-generator-status");
    const form = await harness("rect", ".plan-generator-form");
    assert.ok(pane.right <= form.left + 1 && Math.abs(pane.top - form.top) <= 1, "the plan's settings are the left pane, beside the step");
  }

  // 2. AI for this plan -----------------------------------------------------
  {
    const apiKey = settings("claude-api", { anthropic: { hasApiKey: true, model: "claude-opus-5", effort: "high" } });
    const script = { getChatSettings: apiKey, getChatAuthStatus: { signedIn: false }, getClaudeCodeStatus: { state: "not-installed" }, outlineTrainingPlan: "__pending" };
    await mount(script);
    assert.equal(await harness("text", ".plan-generator-provider strong"), "Claude API key");
    assert.match(await harness("text", ".plan-generator-provider small"), /Claude Opus 5 · High effort · Coach's settings/);

    await harness("click", "button.plan-generator-provider");
    await settle();
    assert.equal(await harness("exists", ".plan-generator-sheet"), true, "the provider card opens the AI panel");
    assert.equal(await harness("callCount", "getChatAuthStatus"), 1, "the panel reads each sign-in once");
    assert.equal(await harness("callCount", "getClaudeCodeStatus"), 1);
    assert.match(await harness("text", ".plan-generator-provider-option.is-selected"), /Claude API key.*Connected/);
    assert.match(await evaluate(`[...document.querySelectorAll(".plan-generator-provider-option")].map((b) => b.textContent).join("|")`), /ChatGPTNot set up/);

    await harness("clickText", ".plan-generator-provider-option", "ChatGPT");
    await settle();
    assert.match(await harness("text", ".plan-generator-sheet-warning"), /Sign in to ChatGPT/, "a provider not set up says what it needs");
    assert.match(await harness("text", ".plan-generator-sheet-body"), /ChatGPT has no effort setting/);

    await harness("clickText", ".plan-generator-provider-option", "Claude API key");
    await settle();
    await harness("clickText", ".plan-generator-sheet button", "Max");
    await settle();
    await pressEscape();
    await settle();
    assert.equal(await harness("exists", ".plan-generator-sheet"), false, "Escape closes the panel first");
    assert.equal(await harness("callCount", "prop:onClose"), 0, "and not the generator");
    assert.match(await harness("text", ".plan-generator-provider small"), /Max effort · this plan only/);

    await toWeek();
    await harness("click", NEXT);
    await settle();
    const [call] = await harness("calls", "outlineTrainingPlan");
    assert.deepEqual(call.args[1].runtime, { effort: "max" }, "only what differs from Coach travels, for this plan");
    assert.equal(await harness("callCount", "saveChatSettings"), 0, "and Coach's settings are left alone");

    const saved = settings("claude-api", { anthropic: { hasApiKey: true, model: "claude-sonnet-5", effort: "high" } });
    await mount({ ...script, saveChatSettings: saved });
    await harness("click", "button.plan-generator-provider");
    await settle();
    await harness("clickText", ".plan-generator-sheet button", "Claude Sonnet 5");
    await harness("click", ".plan-generator-sheet-keep input");
    await settle();
    await harness("clickText", ".plan-generator-sheet footer button", "Done");
    await settle();
    const [save] = await harness("calls", "saveChatSettings");
    assert.equal(save?.args[0]?.anthropic?.model, "claude-sonnet-5", "kept for Coach, it is written as Coach's own");
    assert.match(await harness("text", ".plan-generator-provider small"), /Claude Sonnet 5 · High effort · Coach's settings/);
  }

  // 3. The goal -------------------------------------------------------------
  {
    await mount();
    assert.equal(await harness("count", ".plan-generator-inline-error"), 0, "an untouched step is not red");
    assert.match(await harness("text", ".plan-generator-footer-hint"), /Pick race day/, "the footer says what the step still needs");
    assert.equal(await harness("attr", ".plan-generator-cards button.is-selected", "aria-pressed"), "true");
    assert.match(await harness("text", ".plan-generator-segmented .is-selected"), /From my data/, "Coach judges the level by default");

    // One goal field, one size: it was an input for four kinds and a box for
    // the fifth, so picking a kind moved everything under it.
    const goalHeight = (await harness("rect", ".plan-generator-goal")).height;
    for (const kind of ["Build a base", "Come back", "Strength & hybrid", "Something else", "A race or event"]) {
      await harness("clickText", ".plan-generator-goal-kind", kind);
      await settle();
      assert.equal(await evaluate(`document.getElementById("plan-generator-goal")?.tagName`), "TEXTAREA", kind);
      assert.equal((await harness("rect", ".plan-generator-goal")).height, goalHeight, `${kind}: the goal field keeps its height`);
    }
    assert.equal(await harness("count", ".plan-generator-inline-error"), 0, "trying the kinds touches nothing");

    await harness("click", NEXT);
    await settle();
    assert.equal(await harness("exists", ".plan-generator-week-summary"), false, "an incomplete step is not left");
    assert.match(await harness("text", "#plan-generator-race-problem"), /Pick race day/);
    assert.equal(await evaluate(`document.activeElement?.id`), "plan-generator-race", "and focus goes to what is missing");

    await harness("click", "#plan-generator-race");
    await settle();
    assert.equal(await harness("exists", ".plan-generator-racepop-panel .tl-daypick"), true, "race day is picked from a month");
    await evaluate(`(() => { const days = [...document.querySelectorAll(".plan-generator-racepop-panel .tl-daypick-day:not(:disabled)")]; days[days.length - 1].click(); return true; })()`);
    await settle();
    assert.equal(await harness("exists", ".plan-generator-racepop-panel"), false, "a pick closes the month");
    assert.match(await harness("text", "#plan-generator-race-problem"), /Name the race or pick its distance/);
    await harness("clickText", ".plan-generator-row button", "Half");
    await settle();
    assert.equal(await harness("exists", "#plan-generator-race-problem"), false);
    assert.match(await harness("text", ".plan-generator-span"), /ending on race day/);
    assert.match(await harness("text", ".plan-generator-snapshot"), /Length\d+ weeks/, "the aside counts the weeks to race day");

    await harness("clickText", ".plan-generator-goal-kind", "Something else");
    await settle();
    assert.equal(await evaluate(`document.getElementById("plan-generator-goal")?.tagName`), "TEXTAREA", "a goal of one's own is described, not named");
    await harness("click", NEXT);
    await settle();
    assert.match(await harness("text", "#plan-generator-goal-problem"), /Describe what you are training for/);
    assert.equal(await evaluate(`document.activeElement?.id`), "plan-generator-goal");
    await harness("setValue", "#plan-generator-goal", "Ski fitness for February, two gym days a week");
    await settle();
    assert.equal(await harness("exists", "#plan-generator-goal-problem"), false);
    assert.match(await harness("text", ".plan-generator-span"), /Coach chooses how many weeks/, "a goal that is not a race may leave its length to Coach");
    assert.equal(await harness("exists", "#plan-generator-weeks"), false);

    await harness("clickText", ".plan-generator-row button", "Set the length");
    await settle();
    await harness("click", "#plan-generator-weeks-label");
    await settle();
    assert.equal(await harness("text", "#plan-generator-weeks strong"), "8", "the word Weeks is a name, not the fewer button");
    assert.match(await harness("text", ".plan-generator-span"), /^8 weeks, Mon/);

    const firstWeek = await harness("text", "#plan-generator-start strong");
    assert.match(firstWeek, /^Mon/, "the first week is a Monday");
    assert.equal(await harness("attr", `#plan-generator-start button[aria-label="A week earlier"]`, "disabled"), "", "and not one already begun");
    await harness("click", `#plan-generator-start button[aria-label="A week later"]`);
    await settle();
    const later = await harness("text", "#plan-generator-start strong");
    assert.notEqual(later, firstWeek);
    assert.match(later, /^Mon/);

    await harness("click", NEXT);
    await settle();
    assert.equal(await harness("exists", ".plan-generator-week-summary"), true);
    assert.equal(await harness("attr", `.plan-generator-steps button[aria-current="step"]`, "aria-current"), "step");
    assert.match(await harness("text", `.plan-generator-steps button[aria-current="step"]`), /Your week/);
  }

  // 4. The week -------------------------------------------------------------
  {
    await mount();
    await toWeek();
    assert.equal(await harness("count", ".plan-generator-day"), 7);
    const heading = await harness("rect", ".plan-generator-step-head h3");
    const switcher = await harness("rect", ".plan-generator-week-mode .option-group");
    const head = await harness("rect", ".plan-generator-step-head");
    assert.ok(switcher.top >= heading.top + heading.height, "the week's switch sits under its heading");
    assert.equal(Math.round(switcher.left), Math.round(heading.left), "and starts where it does");
    assert.ok(switcher.width < head.width / 2, "at its own width, not the row's");
    const summary = () => evaluate(`[...document.querySelectorAll(".plan-generator-week-summary dd")].map((dd) => dd.textContent)`);
    assert.deepEqual(await summary(), ["5", "6 h", "Saturday"]);

    // Each kind starts at its own time, shown inside the day's card.
    const monday = `.plan-generator-day:nth-child(1)`;
    const mondayTime = () => harness("text", `${monday} .app-select-trigger`);
    assert.equal(await harness("text", `${monday} .plan-generator-day-time`), "—", "a rest day has no time");
    await harness("click", `.plan-generator-day-kind[aria-label^="Monday"]`);
    await settle();
    assert.match(await harness("attr", `.plan-generator-day-kind[aria-label^="Monday"]`, "aria-label"), /Monday: Train/);
    assert.equal(await mondayTime(), "1 h", "a training day starts at an hour");
    const card = await harness("rect", monday);
    const time = await harness("rect", `${monday} .app-select-trigger`);
    assert.ok(time.left >= card.left && time.right <= card.right && time.top > card.top && time.top + time.height <= card.top + card.height, "inside the day's card");
    await harness("click", `.plan-generator-day-kind[aria-label^="Monday"]`);
    await settle();
    assert.equal(await mondayTime(), "2 h", "the long day at two");
    await harness("click", `.plan-generator-day-kind[aria-label^="Monday"]`);
    await settle();
    assert.match(await harness("attr", `.plan-generator-day-kind[aria-label^="Monday"]`, "aria-label"), /Monday: Coach picks/);
    assert.equal(await mondayTime(), "1 h", "a day Coach picks at an hour");
    assert.deepEqual(await summary(), ["5–6", "up to 7 h", "Saturday"], "a day Coach picks widens the week into a band");

    await harness("click", `${monday} .app-select-trigger`);
    await settle();
    await harness("click", `.app-select-menu [role="option"][data-value="free"]`);
    await settle();
    assert.equal(await mondayTime(), "Free", "a day may have no limit");
    assert.deepEqual(await summary(), ["5–6", "No limit", "Saturday"], "and then the week has none");
    await harness("click", `${monday} .app-select-trigger`);
    await settle();
    await harness("click", `.app-select-menu [role="option"][data-value="45"]`);
    await settle();
    assert.equal(await mondayTime(), "45 min");
    assert.deepEqual(await summary(), ["5–6", "up to 6.8 h", "Saturday"]);

    await harness("clickText", ".plan-generator-step-head button", "Let Coach decide");
    await settle();
    assert.equal(await harness("exists", ".plan-generator-coach-week"), true);
    assert.deepEqual(await summary(), ["Coach decides", "Coach decides", "Coach decides"], "nothing is required");
    await harness("clickText", `[aria-label="Sessions a week"] button`, "6");
    for (const day of ["Mon", "Wed"]) await harness("clickText", ".plan-generator-coach-week button", day);
    await settle();
    assert.match(await harness("text", "#plan-generator-week-problem"), /6 sessions a week need at least 6 days you can train/);
    await harness("clickText", `[aria-label="Sessions a week"] button`, "5");
    await harness("clickText", ".plan-generator-coach-week button", "5–8 h");
    await settle();
    assert.equal(await harness("exists", "#plan-generator-week-problem"), false);
    await harness("setValue", "#plan-generator-constraints", "Left knee");
    await settle();

    await harness("click", ".plan-generator-steps button:first-child");
    await settle();
    assert.equal(await harness("exists", ".plan-generator-goal-kinds"), true, "the steps above lead back");
    await harness("click", NEXT);
    await settle();
    assert.equal(await harness("value", "#plan-generator-constraints"), "Left knee", "and the week is as it was left");
  }

  // 5. The outline ------------------------------------------------------------
  {
    await mount({ ...READY, outlineTrainingPlan: "__pending" });
    await toWeek();
    assert.equal(await harness("text", NEXT), "Draft the outline");
    await harness("click", NEXT);
    await settle();
    const [call] = await harness("calls", "outlineTrainingPlan");
    const [requestId, request, , revision] = call.args;
    assert.equal(request.goalKind, "base");
    assert.equal(request.outline, undefined);
    assert.equal(revision, undefined, "a first outline redraws nothing");
    assert.equal(await harness("text", ".plan-generator-run > strong"), "Drawing the outline");
    assert.deepEqual(await stageStates(), ["is-active", "", ""]);
    assert.match(await harness("text", `.plan-generator-steps button[aria-current="step"]`), /Outline/);
    assert.equal(await harness("exists", ".plan-generator-trail"), false, "nothing is said before the stream says it");

    // What Coach is doing: a line per thing the stream said, the latest in the present.
    const trailLines = () => evaluate(`[...document.querySelectorAll(".plan-generator-trail li")].map((li) => li.textContent)`);
    await harness("emit", "onChatStreamInfo", { requestId, kind: "context", snapshotIncluded: true, mcpEnabled: false });
    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "list_recent_activities", status: "call" });
    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "get_activity_detail", status: "call" });
    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "get_activity_detail", status: "call" });
    await settle();
    assert.deepEqual(await trailLines(), ["Read your training snapshot", "Read your recent activities", "Looking at a session in detail ×2"]);
    await harness("emit", "onChatStreamInfo", { requestId, kind: "thinking", delta: "**Weighing your recent volume**\n\nAbout 30 km a week, the long run near 14 km" });
    await settle();
    assert.equal((await trailLines()).at(-1), "Weighing your recent volume", "a point the thinking turns to is a line");
    assert.equal(await harness("attr", ".plan-generator-trail li:last-child", "class"), "is-latest");
    assert.equal(await harness("text", ".plan-generator-trail-thought"), "About 30 km a week, the long run near 14 km", "and the words it is on show under the lines");
    assert.equal(await harness("attr", ".plan-generator-trail-thought", "aria-hidden"), "true", "kept out of the live region, which would read every token");
    assert.match((await trailLines())[2], /^Looked at/, "a line followed by another is in the past");

    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "propose_plan_outline", status: "call" });
    await settle();
    assert.equal((await trailLines()).at(-1), "Handing the outline to the check");
    assert.deepEqual(await stageStates(), ["is-done", "is-done", "is-active"]);
    assert.match(await harness("text", ".plan-generator-run-activity"), /Checking the outline/);
    assert.equal(await harness("exists", ".plan-generator-run-checks"), false, "a first check sent nothing back");

    await harness("resolvePending", "outlineTrainingPlan", { ok: true, outline: OUTLINE });
    await settle();
    assert.equal(await harness("count", ".plan-generator-outline-bar"), 4, "a bar a week");
    assert.match(await harness("text", ".plan-generator-outline .plan-generator-step-head p"), /^Coach chose 4 weeks for this goal\. Four weeks/);
    assert.deepEqual(
      await evaluate(`[...document.querySelectorAll(".plan-generator-outline-legend li")].map((li) => li.textContent)`),
      ["Base", "Build", "Peak"],
      "the legend names the stages the outline uses"
    );
    assert.match(await harness("text", ".plan-generator-outline-week"), /Week 1 · .*Base.*4 sessions · 4 h.*Settle in\..*SatLong run.*90 min/);
    await harness("click", `.plan-generator-outline-bar[aria-label^="Week 3"]`);
    await settle();
    assert.match(await harness("text", ".plan-generator-outline-week"), /Build · lighter week/);
    assert.equal(await harness("attr", `.plan-generator-outline-bar[aria-label^="Week 3"]`, "aria-pressed"), "true");
    assert.match(await harness("text", ".plan-generator-outline"), /What Coach read: About 30 km a week/);

    assert.equal(await harness("attr", ".plan-generator-redraw button", "disabled"), "", "a redraw needs something to change");
    await harness("setValue", "#plan-generator-outline-note", "A lighter week 2, I'm travelling");
    await settle();
    await harness("click", ".plan-generator-redraw button");
    await settle();
    const [, redraw] = await harness("calls", "outlineTrainingPlan");
    assert.deepEqual(redraw.args[3], { outline: OUTLINE, note: "A lighter week 2, I'm travelling" }, "a redraw carries the outline and what to change");
    await harness("clickText", ".plan-generator > footer button", "Stop");
    await settle();
    assert.equal(await harness("exists", ".plan-generator-outline-bars"), true, "stopping a redraw keeps the outline");
    assert.equal(await harness("callCount", "cancelChat"), 1);

    await harness("click", ".plan-generator-steps button:first-child");
    await settle();
    await harness("clickText", ".plan-generator-sports button", "Strength");
    await settle();
    assert.equal(await harness("attr", `.plan-generator-steps button:nth-child(3)`, "disabled"), "", "an outline of another request is not offered");
    await harness("click", NEXT);
    await settle();
    assert.equal(await harness("text", NEXT), "Draft the outline", "it is drawn again");
  }

  // 6. The sessions ------------------------------------------------------------
  {
    await mount({ ...READY, generateTrainingPlan: "__pending" });
    await toWeek();
    await harness("clickText", ".plan-generator-step-head button", "Let Coach decide");
    await harness("setValue", "#plan-generator-constraints", "Left knee");
    await settle();
    await harness("click", NEXT);
    await settle();
    for (let pass = 0; pass < 25 && (await harness("style", ".plan-generator", "display")) !== "flex"; pass += 1) await settle();
    const formHeight = (await harness("rect", ".plan-generator")).height;
    assert.equal(await harness("text", NEXT), "Write the sessions");
    await harness("click", NEXT);
    await settle();
    assert.equal((await harness("rect", ".plan-generator")).height, formHeight, "the dialog keeps its height when a run takes the step's place");

    const [call] = await harness("calls", "generateTrainingPlan");
    assert.ok(call, "Write the sessions asks main for the plan");
    const [requestId, request] = call.args;
    assert.equal(new Date(`${request.startDate}T12:00:00`).getDay(), 1, "the request starts on a Monday");
    assert.equal(request.goalKind, "base");
    assert.equal(request.weeks, undefined, "the length is Coach's");
    assert.deepEqual(request.week, { mode: "coach", blockedDayIndexes: [] }, "and so is the week, with nothing assumed");
    assert.equal(request.constraints, "Left knee");
    assert.deepEqual(request.outline, OUTLINE, "the sessions are written to the outline read");
    assert.equal(request.runtime, undefined, "an untouched AI panel sends nothing");
    assert.equal(request.sources, undefined, "and everything shared says nothing");
    assert.equal(await harness("callCount", "sendChat"), 0, "a generation is not a chat turn");

    assert.equal(await harness("exists", ".plan-generator-run"), true, "the run takes the step's place");
    assert.deepEqual(await stageStates(), ["is-active", "", "", ""]);
    const weekStates = () => evaluate(`[...document.querySelectorAll(".plan-generator-run-weeks li")].map((li) => li.dataset.state)`);
    assert.deepEqual(await weekStates(), ["Queued", "Queued", "Queued", "Queued"], "the outline's weeks wait to be written");

    const weeksTop = (await harness("rect", ".plan-generator-run-weeks")).top;
    assert.equal(
      await evaluate(`Boolean(document.querySelector(".plan-generator-run-weeks").compareDocumentPosition(document.querySelector(".plan-generator-stages")) & Node.DOCUMENT_POSITION_FOLLOWING)`),
      true,
      "the weeks come first, under the title"
    );
    await harness("emit", "onChatStreamStart", { requestId });
    await harness("emit", "onChatStreamToken", { requestId, delta: "Looking" });
    await settle();
    assert.deepEqual(await stageStates(), ["is-done", "is-active", "", ""]);

    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "list_recent_activities", status: "call" });
    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "get_training_zones", status: "failed", message: "ECONNRESET boom" });
    await settle();
    assert.deepEqual(await stageStates(), ["is-done", "is-active", "", ""], "a read after the model started designing does not step back");
    assert.equal(await harness("text", ".plan-generator-run-activity"), "Reading your recent activities");
    assert.doesNotMatch(await evaluate(`document.querySelector(".plan-generator-run").textContent`), /boom/, "a failed read's raw error is not shown as progress");

    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "draft_training_plan", status: "call" });
    await settle();
    assert.deepEqual(await stageStates(), ["is-done", "is-done", "is-active", ""]);
    assert.deepEqual(await weekStates(), ["Writing…", "Writing…", "Writing…", "Writing…"]);
    await harness("emit", "onChatStreamInfo", { requestId, kind: "mcp", tool: "draft_training_plan", status: "call" });
    await settle();
    assert.match(await harness("text", ".plan-generator-run-activity"), /Correcting/, "a second draft is a correction");
    assert.match(await harness("text", ".plan-generator-run-checks"), /sent the plan back once; Coach is fixing/, "and it says the run is working, not stuck");
    await harness("emit", "onChatStreamInfo", { requestId, kind: "thinking", delta: "**Placing the long runs**\n\nSaturdays, rising by ten minutes a week, and a lighter third week so the build can settle." });
    await settle();
    assert.equal((await harness("rect", ".plan-generator-run-weeks")).top, weeksTop, "and stay where they are while the trail grows under them");
    await harness("emit", "onChatStreamInfo", { requestId: "someone-else", kind: "planDraft", draft: {} });
    await settle();
    assert.deepEqual(await stageStates(), ["is-done", "is-done", "is-active", ""], "another stream's events are not this run's");
    await harness("emit", "onChatStreamInfo", { requestId, kind: "planDraft", draft: {} });
    await settle();
    assert.deepEqual(await weekStates(), ["Checked", "Checked", "Checked", "Checked"], "an accepted draft is every week checked");

    await harness("clickText", ".plan-generator > footer button", "Stop");
    await settle();
    assert.deepEqual((await harness("calls", "cancelChat")).map((entry) => entry.args[0]), [requestId]);
    assert.equal(await harness("exists", ".plan-generator-outline-bars"), true, "Stop returns to the outline");
    assert.equal(await harness("callCount", "prop:onClose"), 0, "and does not close the dialog");
    await harness("clickText", ".plan-generator > footer button", "Back");
    await settle();
    assert.equal(await harness("value", "#plan-generator-constraints"), "Left knee", "with the week as it was left");
    await harness("resolvePending", "generateTrainingPlan", { ok: false, reason: "failed", message: "late" });
    await settle();
    assert.equal(await harness("exists", ".plan-generator-failure"), false, "a result after Stop is ignored");
  }

  // 7a. What Coach reads -------------------------------------------------------
  {
    await mount({ ...READY, outlineTrainingPlan: "__pending" });
    const switches = () => evaluate(`[...document.querySelectorAll(".plan-generator-source")].map((b) => b.getAttribute("aria-checked"))`);
    assert.deepEqual(await switches(), ["true", "true", "true"], "everything is shared unless the athlete says otherwise");
    await harness("click", `.plan-generator-source[aria-labelledby="plan-generator-source-sleep"]`);
    await harness("click", `.plan-generator-source[aria-labelledby="plan-generator-source-activities"]`);
    await settle();
    assert.deepEqual(await switches(), ["false", "false", "true"]);
    assert.match(await harness("text", ".plan-generator-sources"), /Not shared with this plan/);
    assert.match(await harness("text", "#plan-generator-difficulty-problem"), /can't judge your level without your recent activities/, "From my data needs the data");
    await harness("clickText", ".plan-generator-goal-kind", "Build a base");
    await harness("clickText", ".plan-generator-segmented button", "Intermediate");
    await settle();
    assert.equal(await harness("exists", "#plan-generator-difficulty-problem"), false);
    await harness("click", NEXT);
    await settle();
    await harness("click", NEXT);
    await settle();
    const [call] = await harness("calls", "outlineTrainingPlan");
    assert.deepEqual(call.args[1].sources, { activities: false, sleep: false, zones: true }, "what was switched off travels");
    assert.equal(await harness("attr", ".plan-generator-source", "disabled"), "", "and cannot change under a run");
  }

  // 7b. Changing what Coach reads under a drawn outline ------------------------
  {
    await mount();
    await toOutline();
    const sleepSwitch = `.plan-generator-source[aria-labelledby="plan-generator-source-sleep"]`;
    await harness("click", sleepSwitch);
    await settle();
    assert.equal(await harness("exists", ".tl-dialog"), true, "the outline was drawn from what Coach read, so a change asks first");
    assert.equal(await harness("attr", sleepSwitch, "aria-checked"), "true", "and changes nothing until it is answered");
    assert.equal(await harness("exists", ".plan-generator-outline-bars"), true, "the outline stays on screen meanwhile");
    await pressEscape();
    await settle();
    assert.equal(await harness("exists", ".tl-dialog"), false, "Escape answers no");
    assert.equal(await harness("callCount", "prop:onClose"), 0, "and leaves the generator open");
    await harness("click", sleepSwitch);
    await settle();
    await harness("clickText", ".tl-dialog button", "Keep this outline");
    await settle();
    assert.equal(await harness("attr", sleepSwitch, "aria-checked"), "true");
    assert.equal(await harness("callCount", "outlineTrainingPlan"), 1);

    await harness("click", sleepSwitch);
    await settle();
    await harness("clickText", ".tl-dialog button", "Redraw outline");
    await settle();
    assert.equal(await harness("attr", sleepSwitch, "aria-checked"), "false");
    const calls = await harness("calls", "outlineTrainingPlan");
    assert.equal(calls.length, 2, "yes redraws the outline");
    assert.deepEqual(calls[1].args[1].sources, { activities: true, sleep: false, zones: true }, "from the sources as changed");
    assert.equal(calls[1].args[3], undefined, "drawn afresh, not revised from one read with more");
    assert.equal(await harness("exists", ".plan-generator-outline-bars"), true, "and lands back on the outline");

    await harness("click", `.plan-generator-source[aria-labelledby="plan-generator-source-activities"]`);
    await settle();
    assert.match(await harness("text", ".tl-dialog-warning"), /can't judge your level without your recent activities/, "a change the form cannot take says so first");
    await harness("clickText", ".tl-dialog button", "Change and fix it");
    await settle();
    assert.equal(await harness("callCount", "outlineTrainingPlan"), 2, "and draws nothing");
    assert.match(await harness("text", "#plan-generator-difficulty-problem"), /can't judge your level/, "it goes to what needs fixing");
  }

  // 7. How a run ends ---------------------------------------------------------
  {
    await mount({ ...READY, outlineTrainingPlan: { ok: false, reason: "no-outline", message: "No shape came back" } });
    await toWeek();
    await harness("click", NEXT);
    await settle();
    assert.match(await harness("text", ".plan-generator-failure"), /No outline this time.*No shape came back/);
    assert.equal(await harness("exists", ".plan-generator-week-summary"), true, "an outline that failed keeps the week");
    assert.match(await harness("text", NEXT), /Try again/);

    await mount({ ...READY, generateTrainingPlan: { ok: false, reason: "failed", message: "COROS said no" } });
    await toOutline();
    await harness("click", NEXT);
    await settle();
    assert.match(await harness("text", ".plan-generator-failure"), /No plan this time.*COROS said no/);
    assert.equal(await harness("exists", ".plan-generator-outline-bars"), true, "a plan that failed keeps the outline");
    assert.match(await harness("text", NEXT), /Try again/);
    await harness("clickText", ".plan-generator-failure button", "Continue in Coach");
    const [handoff] = await harness("calls", "prop:onOpenCoach");
    assert.match(handoff.args[0], /^Help me build a training plan\./);

    const plan = { id: "draft:1", name: "Base build", description: "Eight steady weeks.", weekCount: 1, entries: [], weekStages: [], sportMix: [] };
    await mount({ ...READY, generateTrainingPlan: { ok: true, plan }, saveTrainingPlanDraft: { id: "draft-1", plan, savedAt: "2026-09-25T00:00:00Z" } });
    await toOutline();
    await harness("click", NEXT);
    await settle();
    const [kept] = await harness("calls", "saveTrainingPlanDraft");
    assert.equal(kept?.args[0]?.plan?.name, "Base build", "a finished plan is kept as a library draft at once");
    const [announced] = await harness("calls", "prop:onKept");
    assert.deepEqual(announced?.args.slice(1), ["draft-1"], "and the library is told, to list it");
    assert.equal(await harness("text", ".plan-generator-done-name"), "Base build");
    assert.equal(await harness("text", ".plan-generator-done-title"), "Plan created and saved as a draft", "the last step says the plan exists, and where");
    assert.equal(
      await harness("style", ".plan-generator-done-mark", "color"),
      await evaluate(`getComputedStyle(document.querySelector(".plan-generator-done-title")).color`),
      "its mark in the same success ink"
    );
    assert.ok((await harness("rect", ".plan-generator-done-mark")).width >= 56, "and large enough to be seen");
    assert.match(await harness("text", ".plan-generator-done-kept"), /Kept as a draft/);
    assert.equal(await harness("callCount", "prop:onOpenPlan"), 0, "nothing opens until the athlete asks");
    await harness("clickText", ".plan-generator > footer button", "Edit plan");
    await settle();
    const [opened] = await harness("calls", "prop:onOpenPlan");
    assert.deepEqual(opened?.args.map((arg) => (typeof arg === "object" ? arg.name : arg)), ["Base build", "draft-1"], "Edit plan opens the kept draft");
    assert.equal(await harness("callCount", "prop:onClose"), 0, "and does not close the generator");

    // The editor over it: the generator waits hidden, deaf to Escape, and comes back as it was.
    await harness("setProps", { covered: true });
    await settle();
    assert.equal(await harness("style", ".plan-generator-backdrop", "display"), "none", "hidden under the editor");
    await pressEscape();
    await settle();
    assert.equal(await harness("callCount", "prop:onClose"), 0, "an Escape meant for the editor does not close it");
    await harness("setProps", { covered: false, editedDraft: { draftId: "draft-1", plan: { ...plan, name: "Base build, edited" } } });
    await settle();
    assert.notEqual(await harness("style", ".plan-generator-backdrop", "display"), "none", "back when the editor closes");
    assert.equal(await harness("text", ".plan-generator-done-name"), "Base build, edited", "showing the edits the editor kept");
    assert.match(await harness("text", ".plan-generator-done-kept"), /Kept as a draft/, "still on the last step");

    /* A plan of some length: its figures and the reader's ridge. */
    const entry = (weekIndex, dayIndex, minutes) => ({
      id: `e${weekIndex}${dayIndex}`, weekIndex, dayIndex, sortOrder: 0, title: "Easy run",
      workout: { name: "Easy run", sport: "run", steps: [{ kind: "training", target_type: "time", target_duration_seconds: minutes * 60, intensity: { type: "none" } }] }
    });
    const long = {
      ...plan, name: "Four weeks", weekCount: 4, sportMix: [],
      weekStages: [{ weekIndex: 0, stage: 2 }, { weekIndex: 1, stage: 3 }, { weekIndex: 2, stage: 3 }, { weekIndex: 3, stage: 4 }],
      entries: [0, 1, 2, 3].flatMap((week) => [entry(week, 1, 45), entry(week, 5, 75)])
    };
    await mount({ ...READY, generateTrainingPlan: { ok: true, plan: long }, saveTrainingPlanDraft: { id: "draft-4", plan: long, savedAt: "2026-09-25T00:00:00Z" } });
    await toOutline();
    await harness("click", NEXT);
    await settle();
    assert.deepEqual(
      await evaluate(`[...document.querySelectorAll(".plan-generator-done-figures dd")].map((dd) => dd.textContent)`),
      ["4", "8", "about 2 h"],
      "the plan's weeks, sessions and time a week"
    );
    assert.equal(await harness("count", ".plan-generator-done-ridge .plan-ridge-week"), 4, "and its shape, as the reader draws it");
    assert.equal(await harness("count", ".plan-generator-done-weeks .plan-week-card"), 4, "and every week, with the reader's own cards");
    assert.equal(await harness("count", ".plan-generator-done-weeks .plan-entry"), 8, "holding every session");
    assert.equal(await harness("count", ".plan-generator-done-weeks button.plan-entry"), 0, "read only: a session there does not open");
    assert.equal(await harness("exists", ".plan-generator-status"), false, "the settings pane is gone once the plan is written");
    const doneForm = await harness("rect", ".plan-generator-form");
    const dialog = await harness("rect", ".plan-generator");
    assert.ok(dialog.width - doneForm.width <= 2, "and the plan takes the whole width");

    await mount({ ...READY, generateTrainingPlan: { ok: true, plan } });
    await toOutline();
    await harness("click", NEXT);
    await settle();
    assert.equal(await harness("exists", ".plan-generator-done-warning"), true, "a draft that could not be kept says so");
    assert.equal(await harness("text", ".plan-generator-done-title"), "Plan created", "and the head claims no draft");
    await harness("clickText", ".plan-generator > footer button", "Edit plan");
    await settle();
    const [unkept] = await harness("calls", "prop:onOpenPlan");
    assert.equal(unkept?.args.length === 1 || unkept?.args[1] === undefined, true, "and opens without a draft to point at");
  }

  // 7c. Saving the plan, or putting it on the calendar -------------------------
  {
    const plan = { id: "draft:plan", name: "Base build", description: "Eight steady weeks.", weekCount: 1, entries: [], weekStages: [], sportMix: [] };
    const saved = { ...plan, id: "coros:900", remoteId: "900" };
    const script = {
      ...READY,
      generateTrainingPlan: { ok: true, plan },
      saveTrainingPlanDraft: { id: "draft:abc", plan, savedAt: "2026-09-25T00:00:00Z" },
      saveTrainingPlanToCoros: { ok: true, plan: saved },
      previewTrainingPlanCalendar: "__pending",
      addTrainingPlanToCalendar: { ...saved, id: "coros:901", calendar: "running" }
    };
    const footer = () => evaluate(`[...document.querySelectorAll(".plan-generator > footer button")].map((b) => b.textContent)`);
    const answerPreview = async () => {
      const calls = await harness("calls", "previewTrainingPlanCalendar");
      const [planId, startDay] = calls.at(-1).args;
      await harness("resolvePending", "previewTrainingPlanCalendar", {
        planId, startDay, anchorDay: startDay, blockers: [],
        entries: [{ entryId: "e1", name: "Easy run", sport: "run", happenDay: startDay, dropped: false, existing: [] }]
      });
      await settle();
      return { planId, startDay };
    };
    const CALENDAR_ADD = ".plan-calendar-dialog > footer .primary-button";

    await mount(script);
    await toOutline();
    await harness("click", NEXT);
    await settle();
    assert.deepEqual(await footer(), ["Close", "Edit plan", "Save to COROS", "Add to calendar"], "the last step saves, schedules, or edits first");
    await harness("clickText", ".plan-generator > footer button", "Save to COROS");
    await settle();
    const [save] = await harness("calls", "saveTrainingPlanToCoros");
    assert.equal(save.args[0].draftId, "draft:abc", "the save lets the kept draft go");
    assert.equal(save.args[0].origin, "coach", "and marks the plan as Coach's");
    assert.equal((await harness("calls", "prop:onSaved"))[0]?.args[0]?.id, "coros:900", "the library is told");
    assert.match(await harness("text", ".plan-generator-done-kept"), /^Saved to COROS/);
    assert.equal(await harness("text", ".plan-generator-done-title"), "Plan created and saved to COROS");
    assert.deepEqual(await footer(), ["Close", "Open plan", "Add to calendar"]);

    await harness("click", NEXT);
    await settle();
    const saving = await answerPreview();
    assert.equal(saving.planId, "coros:900", "a saved plan is previewed as COROS has it");
    assert.equal(await harness("text", CALENDAR_ADD), "Add to calendar");
    await harness("click", CALENDAR_ADD);
    await settle();
    assert.deepEqual((await harness("calls", "addTrainingPlanToCalendar"))[0]?.args, ["coros:900", saving.startDay]);
    assert.equal(await harness("callCount", "saveTrainingPlanToCoros"), 1, "and is not saved twice");
    assert.equal(await harness("exists", ".plan-calendar-dialog"), false);
    assert.equal((await harness("calls", "prop:onScheduled"))[0]?.args[0]?.id, "coros:900", "the library hears of the plan, not its running copy");
    assert.match(await harness("text", ".plan-generator-done-kept"), /on your calendar/);
    assert.deepEqual(await footer(), ["Close", "Open plan"]);
    await harness("clickText", ".plan-generator > footer button", "Open plan");
    assert.equal((await harness("calls", "prop:onReadPlan"))[0]?.args[0]?.id, "coros:900", "Open plan opens the saved plan in the reader");

    // Straight to the calendar: the day first, then the save and the add as one answer.
    // The plan starts a week later than the next Monday, and the dialog opens on
    // that Monday: it used to open on the next one whatever the athlete chose, which
    // for a race plan put race day a week early without a word.
    await mount(script);
    await harness("click", '[aria-label="A week later"]');
    await settle();
    await toOutline();
    await harness("click", NEXT);
    await settle();
    await harness("click", NEXT);
    await settle();
    assert.equal(await harness("exists", ".plan-calendar-dialog"), true, "Add to calendar asks for the day first");
    assert.equal(
      await evaluate(`(() => { const box = document.querySelector(".plan-calendar-dialog").getBoundingClientRect(); return Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + 40)?.closest(".plan-calendar-dialog")); })()`),
      true,
      "over the generator, not under it"
    );
    const straight = await answerPreview();
    assert.equal(straight.planId, "draft:abc", "previewed from the kept draft, before it is on COROS");
    const chosenStart = (await harness("calls", "outlineTrainingPlan")).at(-1).args[1].startDate;
    assert.equal(straight.startDay, chosenStart.replace(/-/g, ""), "the dialog opens on the first week the athlete chose");
    assert.equal(await harness("callCount", "saveTrainingPlanToCoros"), 0, "nothing is saved until the day is picked");
    assert.equal(await harness("text", CALENDAR_ADD), "Save & add to calendar");
    await harness("click", CALENDAR_ADD);
    await settle();
    const order = (await harness("calls")).map((entry) => entry.method).filter((method) => /saveTrainingPlanToCoros|addTrainingPlanToCalendar/.test(method));
    assert.deepEqual(order, ["saveTrainingPlanToCoros", "addTrainingPlanToCalendar"], "saved, then added");
    assert.deepEqual((await harness("calls", "addTrainingPlanToCalendar"))[0]?.args, ["coros:900", straight.startDay], "the saved plan goes on the calendar");
    assert.equal(await harness("callCount", "prop:onSaved"), 1);
    assert.equal(await harness("callCount", "prop:onScheduled"), 1);
    assert.match(await harness("text", ".plan-generator-done-kept"), /Saved to COROS and on your calendar/);
  }

  // 8. Escape -----------------------------------------------------------------
  {
    await mount({ ...READY, outlineTrainingPlan: "__pending" });
    await toWeek();
    await harness("click", NEXT);
    await settle();
    await pressEscape();
    await settle();
    assert.equal(await harness("callCount", "cancelChat"), 1, "Escape during a run stops it");
    assert.equal(await harness("callCount", "prop:onClose"), 0, "and leaves the dialog open");
    assert.equal(await harness("exists", ".plan-generator-week-summary"), true);
    await pressEscape();
    await settle();
    assert.equal(await harness("callCount", "prop:onClose"), 1, "Escape on the form closes it");
  }

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors, [], "the generator logs no errors");

  console.log("plan generator renderer OK");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
