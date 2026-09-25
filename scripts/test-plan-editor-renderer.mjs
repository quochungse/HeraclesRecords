// The plan editor, mounted for real in Electron's Chromium.
//
// `test:plan-editor-model` proves what the editor does to a plan. Everything
// here is about what the screen does, and each section is a way the editor it
// replaced was broken with every test green:
//
// 1. **A session's name has width.** The old card's move controls were wider
//    than a day column, so every name on a twelve-week plan drew 0px wide —
//    measured in the running app at 1600px. The mount is 1180px, the window the
//    app restores to, because that is the width that has the least to spare.
// 2. **The editor's controls are styled.** The editor is portalled out of the
//    library view and the button rules were scoped to the view, so Save and
//    Back were drawn by the platform. The harness mounts it in the backdrop it
//    is portalled into, and reads the computed background.
// 3. **Save says why it is off, on screen.** The validation lived in a column
//    hidden below 1320px, so Save went grey with no reason anywhere. And a new
//    plan opens without one: it opened unnamed, so "Add a plan name." was the
//    first thing on the screen for a plan nobody had touched. It opens named,
//    with the name selected so typing replaces it.
// 4. **A session goes to the day whose + it was added from**, through the
//    screen that option opens — not to a holding area in week 1. And a new
//    session's builder says what it is: the modal alone read "Training plan
//    copy" over "Edit Strength" for a session that did not exist yet. And
//    discarding it asks with the plan's own dialog, whose buttons are styled
//    even though the builder portals outside every library scope.
// 5. **A session moves by keyboard, and focus goes with it.** It is remounted
//    in its new day, and a focus left behind is a keyboard user dropped at the
//    top of the page after every move.
// 6. **Undo works after the thing that had focus is gone.** An undo remounts
//    the session it moves back, focus falls to <body>, and a shortcut handler
//    on the editor's own element heard none of the presses after the first.
// 7. **Move to… and a week delete reach the saved plan**, stages included.
// 8. **A typed name is one undo step.**
// 9. **A double day is not a warning.** "N items share one day" fired on a run
//    and a strength session written for the same day, which is ordinary.
// 10. **The reader draws what the editor writes**: the description, and each
//    week's COROS stage.
// 11. **A session is written in Create workout's builder.** It had an editor
//    of its own, with its own defaults, validator and layout. A new session
//    now opens as Create workout does, lands on its day, and an edit writes
//    back what nobody touched exactly as it was — the COROS program of a
//    session nobody opened included, since the save writes it back.
//
// A plan is a COROS plan (docs/training-plan-coros-first.md): the editor
// writes sessions on days and a stage per week, and a workout taken from the
// library is copied in whole, because a COROS plan holds its own program.
//
// Runs in a hidden window; nothing here needs frames — no animation, observer
// or rAF is waited on — which is what keeps it honest on the GNOME Wayland
// session where a hidden window gets none.
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

/* Enough of an account for the workout editor to open a new session. */
const EDITOR_CONTEXT = {
  distanceUnit: "metric",
  paceUnit: "km",
  heartRateBasis: "maxHr",
  zones: {},
  lthrZones: [],
  defaultPoolLength: { value: 25, unit: "m" },
  climbSystems: {}
};

/* A library workout, copied in whole — what `libraryWorkoutAsPlanSession` answers. */
const LIBRARY_SESSION = {
  title: "Threshold 5 x 1 km",
  workout: { key: "library:w1:x", name: "Threshold 5 x 1 km", sport: "run", save_to_library: false },
  corosProgram: { id: "w1", name: "Threshold 5 x 1 km", sportType: 1, exercises: [] },
  plannedDurationSeconds: 2400,
  plannedStrengthSets: 11
};

async function mount(options) {
  await harness("mount", "PlanEditor", options, {
    getWorkoutEditorContext: EDITOR_CONTEXT,
    listWorkoutExercises: [],
    __byArg: { libraryWorkoutAsPlanSession: { '"w1"': LIBRARY_SESSION } }
  });
  for (let attempt = 0; attempt < 50 && !(await harness("appStylesReady")); attempt += 1) {
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
  await settle();
}

const click = (selector) =>
  evaluate(
    `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`
  );

/** A key press where React and the window both hear it, as a real one is. */
const press = (selector, key, modifiers = {}) =>
  evaluate(
    `(() => {
       const node = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.activeElement || document.body"};
       if (!node) return false;
       node.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(modifiers)} }));
       return true;
     })()`
  );

function textOf(selector) {
  return evaluate(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(
       (node) => node.textContent.replace(/\\s+/g, " ").trim()
     )`
  );
}

/** Which week and day an entry is in, read off the DOM around it. */
function whereIs(name) {
  return evaluate(
    `(() => {
       const entry = Array.from(document.querySelectorAll(".plan-editor-entry"))
         .find((node) => node.querySelector(".plan-editor-entry-name").textContent === ${JSON.stringify(name)});
       if (!entry) return null;
       const week = entry.closest("[data-week]").dataset.week;
       const day = entry.closest(".plan-editor-day").querySelector(".plan-editor-day-label").textContent;
       return week + ":" + day;
     })()`
  );
}

const focusedEntry = () =>
  evaluate(
    `document.activeElement?.closest(".plan-editor-entry")?.querySelector(".plan-editor-entry-name")?.textContent ?? null`
  );

// ---------------------------------------------------------------------------
// A plan with the shapes the editor has to draw
// ---------------------------------------------------------------------------

const session = (id, weekIndex, dayIndex, title, extra = {}) => ({
  id,
  weekIndex,
  dayIndex,
  sortOrder: 0,
  title,
  workout: {
    key: id,
    name: title,
    sport: "run",
    save_to_library: false,
    steps: [{ kind: "training", target_type: "time", target_duration_seconds: 2700, intensity: { type: "none" } }]
  },
  ...extra
});

const PLAN = {
  id: "coros:plan-editor-1",
  remoteId: "plan-editor-1",
  remoteVersion: 1,
  name: "Autumn half marathon",
  description: "",
  sportMix: ["run"],
  weekCount: 3,
  weekStages: [
    { weekIndex: 0, stage: 2 },
    { weekIndex: 1, stage: 3 },
    { weekIndex: 2, stage: 3 }
  ],
  entries: [
    session("e1", 0, 0, "Easy aerobic run with strides at the end"),
    session("e2", 0, 2, "Tempo 3 x 10 min at half marathon effort"),
    session("e3", 0, 6, "Long run"),
    session("e4", 1, 1, "Hill repeats"),
    session("e6", 2, 5, "Parkrun")
  ],
  calendar: "unscheduled",
  tags: [],
  favorite: false,
  archived: false,
  updatedAt: "2026-09-01T00:00:00.000Z"
};

const WORKOUTS = [
  { id: "w1", name: "Threshold 5 x 1 km", sportType: 100, durationSeconds: 2400, setCount: 11, favorite: false, tags: [], source: "coros", syncState: "synced" },
  { id: "w2", name: "Core circuit", sportType: 402, durationSeconds: 1200, setCount: 9, favorite: false, tags: [], source: "coros", syncState: "synced" }
];

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false }
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // -------------------------------------------------------------------------
  // 1. Every session's name has width, and the week is seven columns
  // -------------------------------------------------------------------------
  await mount({ plan: PLAN, workouts: WORKOUTS, width: 1180, height: 820 });
  {
    const widths = await evaluate(
      `Array.from(document.querySelectorAll(".plan-editor-entry-name")).map((node) => [node.textContent, Math.round(node.getBoundingClientRect().width)])`
    );
    assert.equal(widths.length, 5, "every session is drawn");
    for (const [name, width] of widths) {
      assert.ok(
        width >= 40,
        `"${name}" is ${width}px wide — the old card's controls pushed every name to 0px`
      );
    }
    const columns = await evaluate(
      `getComputedStyle(document.querySelector('[data-week="0"] .plan-editor-days')).gridTemplateColumns.split(" ").length`
    );
    assert.equal(columns, 7, "at 1180px a week is laid out as the seven days it is");
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll(".plan-editor-week-stage .app-select-trigger")).map((node) => node.textContent.trim())`
      ),
      ["Base", "Build", "Build"],
      "every week says its COROS stage where it is named"
    );
    const figures = await textOf('[data-week="0"] .plan-editor-day:nth-child(1) .plan-editor-entry-detail');
    assert.deepEqual(figures, ["45m"], "a session states its own figures, as the reader draws them");
    const slack = await evaluate(
      `Array.from(document.querySelectorAll('.plan-editor-days > .plan-editor-day .plan-editor-entry')).map((entry) => {
         const day = entry.closest(".plan-editor-day");
         const style = getComputedStyle(day);
         const inner = day.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
         // Layout pixels on both sides: the harness scales the page, so a
         // client rect is not in the units clientWidth is.
         return Math.round(inner - entry.offsetWidth);
       })`
    );
    assert.ok(slack.length > 0);
    assert.deepEqual(
      slack.filter((gap) => gap !== 0),
      [],
      `a session fills its day's width — the list layout's align-items: start shrank each to its words: ${JSON.stringify(slack)}`
    );
  }

  // -------------------------------------------------------------------------
  // 2. The controls are styled inside the portal's backdrop
  // -------------------------------------------------------------------------
  {
    const save = await evaluate(
      `(() => { const style = getComputedStyle(document.querySelector(".plan-editor-bar .primary-button")); return { image: style.backgroundImage, height: parseFloat(style.minHeight) }; })()`
    );
    assert.match(
      save.image,
      /gradient/,
      "Save wears the accent gradient; unstyled, the platform drew it — the rules were scoped to a view the editor is portalled out of"
    );
    assert.equal(save.height, 32, "and the library's quieter 32px, not the global 44px button");
    assert.equal(
      await evaluate(`Boolean(document.querySelector(".plan-editor-details"))`),
      false,
      "no details pane: a plan has no start date or free-text phases to set there"
    );
    const border = await evaluate(`getComputedStyle(document.querySelector(".plan-editor-name")).borderTopWidth`);
    assert.equal(border, "1px", "the name is drawn as the field it is");
    assert.equal(
      await evaluate(`Boolean(document.querySelector(".plan-editor-title .plan-editor-about textarea"))`),
      true,
      "the description sits under the name"
    );
  }

  // -------------------------------------------------------------------------
  // 3. Save says why it is off
  // -------------------------------------------------------------------------
  await mount({ plan: { ...PLAN, name: "" }, workouts: WORKOUTS, width: 1180, height: 820 });
  {
    const issues = await textOf(".plan-editor-issues li");
    assert.deepEqual(issues, ["Add a plan name."]);
    const box = await evaluate(
      `(() => { const rect = document.querySelector(".plan-editor-issues").getBoundingClientRect(); return rect.height; })()`
    );
    assert.ok(box > 0, "the reason is on screen at 1180px, where the old column holding it was hidden");
    assert.equal(
      await evaluate(`document.querySelector(".plan-editor-bar .primary-button").disabled`),
      true
    );
  }

  await mount({
    plan: { ...PLAN, id: "draft:new", remoteId: undefined, remoteVersion: undefined, name: "New plan", sportMix: [], weekStages: [], entries: [], weekCount: 4 },
    workouts: WORKOUTS,
    isNew: true,
    width: 1180,
    height: 820
  });
  {
    assert.equal(
      await evaluate(`document.querySelectorAll(".plan-editor-issues li").length`),
      0,
      "a new plan nobody has touched opens with nothing marked wrong — the hint says to add a session"
    );
    assert.deepEqual(
      await evaluate(
        `(() => { const field = document.activeElement; return [field?.className, field?.selectionStart, field?.selectionEnd]; })()`
      ),
      ["plan-editor-name", 0, "New plan".length],
      "the default name is focused and selected, so the first keystroke replaces it"
    );
    const save = await evaluate(
      `(() => { const button = document.querySelector(".plan-editor-bar .primary-button"); return { disabled: button.disabled, title: button.title }; })()`
    );
    assert.equal(save.disabled, true, "COROS keeps no empty plan, so Save to COROS waits for a session");
    assert.match(save.title, /Add a session/, "and says so where the press would land");
    assert.equal(
      await evaluate(`Array.from(document.querySelectorAll(".plan-editor-bar .ghost-button")).find((node) => node.textContent.includes("Save draft")).disabled`),
      false,
      "a draft keeps unfinished work, so it saves as it is"
    );
  }

  // -------------------------------------------------------------------------
  // 4. A session goes to the day it was added to
  // -------------------------------------------------------------------------
  await mount({ plan: PLAN, workouts: WORKOUTS, width: 1180, height: 820 });
  {
    assert.equal(
      await evaluate(`document.querySelector(".plan-editor-bar .primary-button").disabled`),
      true,
      "an existing plan with nothing changed has nothing to save"
    );
    const openAddMenu = async (week, day) => {
      assert.ok(await click(`[data-week="${week}"] .plan-editor-day:nth-child(${day}) .plan-editor-day-add`));
      await settle();
      return textOf(".plan-editor-day-menu .plan-more-menu [role=menuitem]");
    };
    const choose = async (label) => {
      await evaluate(
        `Array.from(document.querySelectorAll(".plan-editor-day-menu .plan-more-menu [role=menuitem]")).find((node) => node.textContent.trim() === ${JSON.stringify(label)}).click()`
      );
      await settle();
    };

    assert.deepEqual(
      await openAddMenu(1, 3),
      ["New session", "From workout library"],
      "a day's + offers what COROS keeps on a day: a session"
    );
    await choose("From workout library");
    assert.deepEqual(await textOf(".plan-editor-add-dialog > p"), ["On Week 2 · Wed."]);
    assert.equal(
      await evaluate(`document.activeElement?.getAttribute("aria-label")`),
      "Search saved workouts",
      "the library opens with the keyboard in its search"
    );
    assert.ok(await click(".plan-editor-add-dialog .plan-editor-library li:first-child button"));
    await settle();
    assert.equal(await evaluate(`Boolean(document.querySelector(".plan-editor-add-dialog"))`), false, "picking closes it");
    assert.equal(await whereIs("Threshold 5 x 1 km"), "1:Wed", "it lands on that day — not in a holding area in week 1");
    assert.deepEqual(
      await evaluate(`window.__harness.calls("libraryWorkoutAsPlanSession").map((call) => call.args[0])`),
      ["w1"],
      "the workout is read in full, once — a COROS plan holds its own copy of the program"
    );
    assert.deepEqual(
      await textOf('[data-week="1"] .plan-editor-day:nth-child(3) .plan-editor-entry-detail'),
      ["40m · 11 sets"],
      "carrying the figures COROS stored for it"
    );

    // New session: Create workout's builder, headed for the plan and the day.
    // The sport used to be asked first in a dialog of its own, because the
    // editor it opened could not change one; the builder offers it in place.
    await openAddMenu(2, 2);
    await choose("New session");
    assert.equal(await evaluate(`Boolean(document.querySelector(".plan-editor-add-dialog"))`), false, "no sport dialog first");
    assert.equal(await evaluate(`Boolean(document.querySelector(".workout-editor-modal"))`), false, "and not the old session editor");
    assert.deepEqual(await textOf(".calendar-modal-builder .calendar-modal-header h3"), ["New session"]);
    assert.deepEqual(
      await textOf(".calendar-modal-builder .calendar-modal-date"),
      ["Autumn half marathon · Week 3 · Tue"],
      "the plan and the day, where the modal alone said \"Training plan copy\""
    );
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll(".calendar-builder-settings > .calendar-field .calendar-field-label > span:first-child")).map((node) => node.textContent)`
      ),
      ["Sport", "Workout name", "Description"],
      "the settings column is Create workout's"
    );
    assert.equal(await evaluate(`Boolean(document.querySelector(".calendar-builder-sport-value"))`), false, "a new session's sport is a choice");
    assert.deepEqual(
      await textOf(".calendar-builder-row .calendar-builder-row-toggle > strong"),
      ["Warm-up", "Training", "Cool-down"],
      "and it opens on the plan's sport with Create workout's three steps"
    );
    assert.deepEqual(await textOf(".calendar-builder-footer .primary-button"), ["Add to plan"]);

    // Unsaved edits are asked about with the plan's own dialog, not a bar.
    await harness("setValue", '.calendar-builder-settings input[type="text"]', "Gym A");
    await click('.calendar-modal-builder .calendar-modal-close');
    await settle();
    assert.deepEqual(await textOf(".tl-dialog h2"), ["Discard unsaved changes?"]);
    /* The workout modal portals to <body>, outside both library scopes, so this
       dialog's buttons had no rule: Keep editing was the platform's grey button
       beside a 44px Discard. */
    const answers = await evaluate(
      `Array.from(document.querySelectorAll(".tl-dialog footer button")).map((node) => { const style = getComputedStyle(node); return { text: node.textContent.trim(), border: style.borderTopStyle, radius: style.borderTopLeftRadius, height: parseFloat(style.minHeight) }; })`
    );
    assert.equal(
      await evaluate(`Boolean(document.querySelector(".tl-dialog").closest(".tl-plan-modal-backdrop, .training-library-view"))`),
      false,
      "the dialog this guards is the one outside both library scopes"
    );
    assert.deepEqual(
      answers.map(({ text, height }) => [text, height]),
      [["Keep editing", 32], ["Discard changes", 32]],
      "both answers are the library's 32px buttons, not the global 44px one beside a bare one"
    );
    assert.equal(answers[0].border, "solid", "Keep editing wears the ghost button's hairline");
    assert.equal(answers[0].radius, answers[1].radius, "and the same corner as the button beside it");
    await evaluate(
      `Array.from(document.querySelectorAll(".tl-dialog button")).find((node) => node.textContent.trim() === "Keep editing").click()`
    );
    await settle();
    assert.equal(await evaluate(`Boolean(document.querySelector(".tl-dialog"))`), false);
    assert.equal(await evaluate(`Boolean(document.querySelector(".calendar-modal-builder"))`), true, "Keep editing keeps it");
    await click('.calendar-modal-builder .calendar-modal-close');
    await settle();
    await evaluate(
      `Array.from(document.querySelectorAll(".tl-dialog button")).find((node) => node.textContent.trim() === "Discard changes").click()`
    );
    await settle();
    assert.equal(await evaluate(`Boolean(document.querySelector(".calendar-modal-builder"))`), false);

    assert.deepEqual(await textOf(".plan-editor-state"), ["Unsaved changes"]);
    assert.equal(await evaluate(`document.querySelector(".plan-editor-bar .primary-button").disabled`), false);
  }

  // -------------------------------------------------------------------------
  // 5. A session moves by keyboard, and focus goes with it
  // -------------------------------------------------------------------------
  {
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-editor-entry")).find((node) => node.textContent.includes("Threshold")).querySelector(".plan-editor-entry-main").focus()`
    );
    await press(null, "ArrowRight", { altKey: true });
    await settle();
    assert.equal(await whereIs("Threshold 5 x 1 km"), "1:Thu");
    assert.equal(await focusedEntry(), "Threshold 5 x 1 km", "focus follows the session into its new day");
    await press(null, "ArrowDown", { altKey: true });
    await settle();
    assert.equal(await whereIs("Threshold 5 x 1 km"), "2:Thu", "Alt + Down is the same day next week");
    assert.equal(await focusedEntry(), "Threshold 5 x 1 km");
  }

  // -------------------------------------------------------------------------
  // 6. Undo keeps working once the focused session is gone
  // -------------------------------------------------------------------------
  {
    const before = await evaluate(`document.querySelectorAll(".plan-editor-entry").length`);
    for (let pass = 0; pass < 3; pass += 1) {
      await press(null, "z", { ctrlKey: true });
      await settle();
    }
    assert.equal(
      await evaluate(`document.activeElement === document.body || !document.activeElement`),
      true,
      "the premise: after an undo moved it, the session that had focus has been remounted and focus is on <body>"
    );
    assert.equal(
      await whereIs("Threshold 5 x 1 km"),
      null,
      "three presses undid both moves and the add — the cancelled new session left nothing to undo"
    );
    assert.equal(await evaluate(`document.querySelectorAll(".plan-editor-entry").length`), before - 1);
    assert.deepEqual(await textOf(".plan-editor-state"), ["No changes"]);
    await press(null, "z", { ctrlKey: true, shiftKey: true });
    await settle();
    assert.equal(await whereIs("Threshold 5 x 1 km"), "1:Wed", "and redo brings it back");
  }

  // -------------------------------------------------------------------------
  // 7. Move to…, Delete and a week delete reach the saved plan
  // -------------------------------------------------------------------------
  {
    // Move to… through the session's ⋯.
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-editor-entry")).find((node) => node.textContent.includes("Hill repeats")).querySelector(".plan-editor-entry-more").click()`
    );
    await settle();
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-more-menu [role=menuitem]")).find((node) => node.textContent.includes("Move to")).click()`
    );
    await settle();
    assert.equal(await evaluate(`Boolean(document.querySelector(".plan-editor-move"))`), true, "Move to… opens its dialog");
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-editor-move .option-group button")).find((node) => node.textContent.trim() === "Sun").click()`
    );
    await settle();
    await click(".plan-editor-move .primary-button");
    await settle();
    assert.equal(await whereIs("Hill repeats"), "1:Sun");

    // Delete from the keyboard.
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-editor-entry")).find((node) => node.textContent.includes("Parkrun")).querySelector(".plan-editor-entry-main").focus()`
    );
    await press(null, "Delete");
    await settle();
    assert.equal(await whereIs("Parkrun"), null, "Delete removes the focused session");

    // Delete week 1, which holds sessions, so it asks first.
    await click('[data-week="0"] .plan-editor-week-menu .icon-button');
    await settle();
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-more-menu [role=menuitem]")).find((node) => node.textContent.includes("Delete week")).click()`
    );
    await settle();
    assert.deepEqual(await textOf(".tl-dialog h2"), ["Delete week 1?"]);
    await evaluate(
      `Array.from(document.querySelectorAll(".tl-dialog button")).find((node) => node.textContent.includes("Delete week")).click()`
    );
    await settle();

    await click(".plan-editor-bar .primary-button");
    await settle();
    const saved = await evaluate(`window.__harness.calls("prop:onSave").map((call) => call.args[0])`);
    assert.equal(saved.length, 1, "Save hands the plan to the view");
    const plan = saved[0];
    assert.equal(plan.weekCount, 2);
    assert.deepEqual(
      plan.weekStages,
      [{ weekIndex: 0, stage: 3 }, { weekIndex: 1, stage: 3 }],
      "week 1's Base went with it, and the Build weeks moved up one"
    );
    const byTitle = Object.fromEntries(plan.entries.map((entry) => [entry.title, [entry.weekIndex, entry.dayIndex]]));
    assert.deepEqual(byTitle["Hill repeats"], [0, 6], "the moved session, a week earlier now");
    assert.deepEqual(byTitle["Threshold 5 x 1 km"], [0, 2]);
    assert.equal(byTitle.Parkrun, undefined);
    assert.equal(byTitle["Long run"], undefined, "week 1's sessions went with it");
    const threshold = plan.entries.find((entry) => entry.title === "Threshold 5 x 1 km");
    assert.equal(threshold.corosProgram.id, "w1", "a library session carries the program it was copied from");
    assert.equal("programId" in threshold, false, "and no link back to the library");
  }

  // -------------------------------------------------------------------------
  // 8. A typed name is one undo step
  // -------------------------------------------------------------------------
  await mount({ plan: PLAN, workouts: WORKOUTS, width: 1180, height: 820 });
  {
    for (const value of ["A", "Au", "Aut", "Autumn 10k"]) {
      await harness("setValue", ".plan-editor-name", value);
    }
    await settle();
    assert.equal(await evaluate(`document.querySelector(".plan-editor-name").value`), "Autumn 10k");
    await click('.plan-editor-bar-actions .icon-button[aria-label="Undo"]');
    await settle();
    assert.equal(
      await evaluate(`document.querySelector(".plan-editor-name").value`),
      "Autumn half marathon",
      "one Undo takes the whole name back, not the last letter"
    );
  }

  // -------------------------------------------------------------------------
  // 9. A double day is not a warning
  // -------------------------------------------------------------------------
  await mount({
    plan: {
      ...PLAN,
      /* One week, so the only thing on the plan to judge is the double day —
         COROS ends a plan at its last session, and would warn about the rest. */
      weekCount: 1,
      entries: [
        session("d1", 0, 2, "Morning run"),
        session("d2", 0, 2, "Evening strength", { workout: { key: "d2", name: "Evening strength", sport: "strength", save_to_library: false } }),
        session("d3", 0, 2, "Mobility")
      ]
    },
    workouts: WORKOUTS,
    width: 1180,
    height: 820
  });
  assert.equal(
    await evaluate(`Boolean(document.querySelector(".plan-editor-issues"))`),
    false,
    "three items on one day is a plan, not a problem"
  );

  // -------------------------------------------------------------------------
  // 10. The reader draws the description and each week's stage
  // -------------------------------------------------------------------------
  {
    await harness("mount", "PlanReader", {
      plan: { ...PLAN, description: "Three weeks from base into race week." },
      width: 1000,
      height: 900
    });
    await settle();
    assert.deepEqual(await textOf(".plan-reader-title .plan-reader-goal"), ["Three weeks from base into race week."]);
    assert.deepEqual(
      await textOf(".plan-week-card > header h2 em"),
      ["Base", "Build", "Build"],
      "a week's COROS stage is named on its card"
    );
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelectorAll(".plan-week-card")).map((node) => node.dataset.stage)`),
      ["base", "build", "build"],
      "and coloured by it"
    );
  }

  // A copy being written says so. Duplicating a COROS plan used to sit with
  // nothing on screen until the copy opened, which read as a press that did
  // nothing.
  {
    await harness("mount", "PlanReader", { plan: PLAN, duplicating: true, width: 1000, height: 900 });
    await settle();
    assert.deepEqual(await textOf(".plan-reader-busy"), ["Duplicating…"], "the reader says it is copying");
    await harness("mount", "PlanReader", { plan: PLAN, width: 1000, height: 900 });
    await settle();
    assert.equal(await evaluate(`Boolean(document.querySelector(".plan-reader-busy"))`), false, "nothing is said when nothing is happening");
  }

  // -------------------------------------------------------------------------
  // 11. A session is written in Create workout's builder, and an edit leaves
  //     what nobody touched as it was
  // -------------------------------------------------------------------------
  {
    /* A session as a plan read from COROS carries it: its steps, its id in
       the plan and the program COROS sent — no library workout. */
    const corosSession = {
      ...session("c1", 2, 0, "30 min z2 ride"),
      idInPlan: "6",
      corosProgram: { id: "1188", name: "30 min z2 ride", sportType: 2, opaque: "kept" },
      workout: {
        key: "coros:plan-1:c1",
        name: "30 min z2 ride",
        sport: "bike",
        save_to_library: false,
        steps: [{ kind: "training", target_type: "time", target_duration_seconds: 1800, intensity: { type: "none" } }]
      }
    };
    await mount({ plan: { ...PLAN, entries: [...PLAN.entries, corosSession] }, workouts: WORKOUTS, width: 1180, height: 820 });
    const savedPlan = async () => {
      assert.ok(await click(".plan-editor-bar .primary-button"));
      await settle();
      const calls = await evaluate(`window.__harness.calls("prop:onSave").map((call) => call.args[0])`);
      return calls[calls.length - 1];
    };

    // A new session, added for real.
    assert.ok(await click(`[data-week="1"] .plan-editor-day:nth-child(2) .plan-editor-day-add`));
    await settle();
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-editor-day-menu .plan-more-menu [role=menuitem]")).find((node) => node.textContent.trim() === "New session").click()`
    );
    await settle();
    await harness("setValue", '.calendar-builder-settings input[type="text"]', "Track 6 x 800");
    await settle();
    assert.equal(
      await evaluate(`document.querySelector(".calendar-builder-footer .primary-button").disabled`),
      false,
      "Create workout's defaults are a valid session, so it can be added as it opens"
    );
    assert.ok(await click(".calendar-builder-footer .primary-button"));
    await settle();
    assert.equal(await evaluate(`Boolean(document.querySelector(".calendar-modal-builder"))`), false, "adding closes the builder");
    assert.equal(await whereIs("Track 6 x 800"), "1:Tue", "and the session is on the day whose + it came from");

    // An existing session: its sport is stated, its steps are read in, and
    // Apply waits for an edit.
    assert.ok(await click(`[data-entry-id="e3"] .plan-editor-entry-main`));
    await settle();
    assert.deepEqual(await textOf(".calendar-modal-builder .calendar-modal-header h3"), ["Edit Long run"]);
    assert.deepEqual(await textOf(".calendar-builder-sport-value"), ["Run"], "an existing session keeps its sport");
    assert.deepEqual(await textOf(".calendar-builder-row .calendar-builder-row-toggle > strong"), ["Training"]);
    assert.deepEqual(await textOf(".calendar-builder-footer .primary-button"), ["Apply to plan"]);
    assert.equal(
      await evaluate(`document.querySelector(".calendar-builder-footer .primary-button").disabled`),
      true,
      "nothing changed, nothing to apply"
    );
    await harness("setValue", '.calendar-builder-settings input[type="text"]', "Long run, easy");
    await settle();
    assert.ok(await click(".calendar-builder-footer .primary-button"));
    await settle();
    assert.equal(await whereIs("Long run, easy"), "0:Sun", "the edit reaches the plan");

    // A COROS plan's session opens from its own steps. It used to ask the
    // library for the plan's program, and COROS answered "The data was not
    // found".
    assert.ok(await click(`[data-entry-id="c1"] .plan-editor-entry-main`));
    await settle();
    assert.equal(
      await evaluate(`window.__harness.calls("getWorkoutForEdit").length`),
      0,
      "a COROS plan's session is not looked up in the library"
    );
    assert.equal(await evaluate(`Boolean(document.querySelector(".workout-builder-state"))`), false, "and opens without a load");
    assert.deepEqual(await textOf(".calendar-builder-sport-value"), ["Bike"]);
    assert.deepEqual(await textOf(".calendar-builder-row .calendar-builder-row-toggle > strong"), ["Training"]);
    await click(".calendar-modal-builder .calendar-modal-close");
    await settle();

    const plan = await savedPlan();
    const added = plan.entries.find((entry) => entry.title === "Track 6 x 800");
    assert.equal(added.workout.sport, "run");
    assert.deepEqual(
      added.workout.steps.map((step) => step.kind),
      ["warmup", "training", "cooldown"],
      "the new session is the workout Create workout would have written"
    );
    const untouched = plan.entries.find((entry) => entry.id === "c1");
    assert.equal(untouched.corosProgram.opaque, "kept", "a session opened and closed is written back as COROS sent it");
    assert.equal(untouched.idInPlan, "6");
    const edited = plan.entries.find((entry) => entry.id === "e3");
    assert.equal(edited.workout.name, "Long run, easy");
    assert.deepEqual(
      edited.workout.steps.map(({ kind, target_type, target_duration_seconds, intensity }) => ({ kind, target_type, target_duration_seconds, intensity })),
      [{ kind: "training", target_type: "time", target_duration_seconds: 2700, intensity: { type: "none" } }],
      "a renamed session's untouched step is written back as it was"
    );
  }

  {
    const errors = await harness("consoleErrors");
    assert.deepEqual(errors, [], `the editor logged: ${errors.join(" | ")}`);
  }

  console.log(
    "plan editor renderer OK — names have width at 1180px, the portal is styled, a new plan opens named and clean, " +
      "Save says why it is off, sessions land where they are added, move by " +
      "keyboard with focus, undo survives losing focus, edits reach the saved plan, sessions are written in the builder"
  );
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
