/**
 * The Create-workout dialog on a narrow window, mounted for real.
 *
 * The builder has two layouts. The wide one is a grid of two columns that each
 * own a scroller; the narrow one is a single scrolling column. Everything here
 * is about the narrow one, because it is the one that has silently overlapped
 * itself twice, and neither time was visible from the stylesheet:
 *
 * - **Nothing under the body's scroller may be shorter than what it holds.**
 *   `min-height: 0` belongs to the wide layout, where each column scrolls on
 *   its own. Stated at the base level it let the settings column be handed a
 *   share of the height instead of its own — measured at 202px against a
 *   content height of 308 — so the Description textarea ran on past its column
 *   and the workout-steps heading drew over it. Two boxes overlapping is not a
 *   thing a stylesheet says; it is a thing a layout does.
 * - **A sticky footer needs a ground.** `.calendar-builder-footer` said
 *   `background: none`, which is right in the wide layout, where it is static
 *   and separated by a rule. Down here it is `position: sticky` inside the
 *   body's scroller, so the step rows scrolled visibly through the totals and
 *   the save button.
 * - **A tablist with one tab is a label that looks like a control.** The
 *   library entry point offers only Structured.
 * - **The expand chevron does not move when it is pressed.** It sat after the
 *   step summary, which is drawn only while the step is collapsed, so the one
 *   control whose job is to be pressed twice changed places between presses.
 * - **And pressing it opens the step it was pressed on.** A press is `focus`
 *   on mousedown and `click` on mouseup. The section's `onFocusCapture` — which
 *   is there so tabbing into a collapsed step's field opens it — fired on the
 *   first of those and opened the step; the click then read it as already open
 *   and shut it, about a fifth of the way into the reveal. It read as
 *   intermittent because it is a race with React's flush of the focus render,
 *   and it was worst when moving between steps. No assertion about a class or
 *   a handler catches this; only the two events in order do.
 *
 * The viewport is overridden through the debugger rather than by resizing the
 * window: `setContentSize` does nothing to a hidden window on Wayland, and a
 * media query reads the viewport either way.
 *
 * Run: npm run test:workout-builder-renderer
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.disableHardwareAcceleration();

/** The width the overlap was reported at. */
const NARROW = { width: 796, height: 841 };

let win;

const evaluate = (source) => win.webContents.executeJavaScript(source, true);

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return evaluate(`window.__harness.${method}(${list})`).catch((error) => {
    throw new Error(`harness ${method} failed: ${error.message}`);
  });
}

async function settle(passes = 8) {
  for (let pass = 0; pass < passes; pass += 1) {
    await evaluate("new Promise((resolve) => setTimeout(resolve, 50))");
  }
}

/** The box, plus what the element would need to show everything it holds. */
const box = (selector, nth = 0) =>
  evaluate(
    `(() => {
       const node = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
       if (!node) return null;
       const rect = node.getBoundingClientRect();
       return {
         top: Math.round(rect.top),
         bottom: Math.round(rect.bottom),
         left: Math.round(rect.left),
         right: Math.round(rect.right),
         width: Math.round(rect.width),
         height: Math.round(rect.height),
         scrollHeight: node.scrollHeight,
         clientHeight: node.clientHeight
       };
     })()`
  );

const style = (selector, property) =>
  evaluate(
    `(() => {
       const node = document.querySelector(${JSON.stringify(selector)});
       return node ? getComputedStyle(node).getPropertyValue(${JSON.stringify(property)}) : null;
     })()`
  );

const count = (selector) =>
  evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

app.whenReady().then(async () => {
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

  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
    ...NARROW,
    deviceScaleFactor: 1,
    mobile: false
  });

  // `libraryOnly`, which is how the Training Library opens this dialog: one
  // tab, and the layout the report was made against.
  await harness("mount", "AddWorkoutModal", {}, {
    getWorkoutEditorContext: null,
    listWorkoutExercises: [],
    listUpcomingWorkouts: []
  });
  await settle();

  assert.deepEqual(
    await evaluate("[window.innerWidth, window.innerHeight]"),
    [NARROW.width, NARROW.height],
    "the viewport override has to take, or every media query below reads the wide layout"
  );

  // -------------------------------------------------------------------------
  // 1. One tab is not a choice
  // -------------------------------------------------------------------------
  assert.equal(
    await count(".calendar-modal-tabs"),
    0,
    "the library entry point offers only Structured, so there is no tablist"
  );
  assert.equal(
    await count(".calendar-builder-workspace"),
    1,
    "and it opens straight into the builder"
  );

  // -------------------------------------------------------------------------
  // 2. The settings column is as tall as what it holds
  // -------------------------------------------------------------------------
  const settings = await box(".calendar-builder-settings");
  assert.ok(
    settings.height >= settings.scrollHeight - 8,
    `the settings column keeps its own height: ${settings.height} laid out against ${settings.scrollHeight} of content`
  );

  // -------------------------------------------------------------------------
  // 3. Description and the steps heading do not overlap
  // -------------------------------------------------------------------------
  const textarea = await box(".calendar-builder-description textarea");
  const stepsHeading = await box(".calendar-builder-canvas-header");
  assert.ok(
    stepsHeading.top >= textarea.bottom,
    `the workout-steps heading starts below the Description box: heading at ${stepsHeading.top}, textarea ends at ${textarea.bottom}`
  );

  // -------------------------------------------------------------------------
  // 4. The overflow goes into the body's scroller, not over the layout
  // -------------------------------------------------------------------------
  const body = await box(".calendar-modal-body");
  assert.ok(
    body.scrollHeight > body.clientHeight,
    "the narrow builder is taller than the dialog, so the body is what scrolls"
  );
  assert.equal(
    await style(".calendar-modal-body", "overflow-y"),
    "auto",
    "and it is allowed to"
  );

  // -------------------------------------------------------------------------
  // 5. The sticky footer has a ground
  // -------------------------------------------------------------------------
  assert.equal(
    await style(".calendar-builder-footer", "position"),
    "sticky",
    "the footer stays on screen while the steps scroll under it"
  );
  const footerGround = await style(".calendar-builder-footer", "background-image");
  assert.notEqual(
    footerGround,
    "none",
    "so it needs a ground — without one the step rows scroll through the save button"
  );
  const footer = await box(".calendar-builder-footer");
  assert.ok(
    footer.height >= footer.scrollHeight - 8,
    `and it keeps its own height: ${footer.height} against ${footer.scrollHeight}`
  );

  // -------------------------------------------------------------------------
  // 6. The expand chevron does not move when it is pressed
  // -------------------------------------------------------------------------
  const chevronBefore = await box(".calendar-builder-row-toggle > svg");
  await evaluate(`document.querySelectorAll(".calendar-builder-row-toggle")[0].click()`);
  await settle(4);
  const chevronAfter = await box(".calendar-builder-row-toggle > svg");
  assert.equal(
    chevronAfter.left,
    chevronBefore.left,
    `the chevron holds its place across an open and a close: ${chevronBefore.left} then ${chevronAfter.left}`
  );

  // -------------------------------------------------------------------------
  // 7. The add bar is two centred lines
  // -------------------------------------------------------------------------
  const addLabel = await box(".calendar-builder-add-label");
  const addChips = await box(".calendar-builder-add-chips");
  const addBar = await box(".calendar-builder-add-bar");
  assert.ok(
    addChips.top >= addLabel.bottom,
    `the step kinds sit on their own line under the label: ${addChips.top} against ${addLabel.bottom}`
  );
  for (const [name, part] of [["label", addLabel], ["chips", addChips]]) {
    const offLeft = part.left - addBar.left;
    const offRight = addBar.right - part.right;
    assert.ok(
      Math.abs(offLeft - offRight) <= 2,
      `the ${name} line is centred in the bar: ${offLeft}px left, ${offRight}px right`
    );
  }

  // -------------------------------------------------------------------------
  // 8. A press on the toggle opens the step it was pressed on, and leaves it open
  //
  // A real press is `focus` on mousedown and `click` on mouseup, and that
  // order is the whole bug: the section's `onFocusCapture` opened the step, the
  // click read it as already open and shut it again. The reveal got about a
  // fifth of the way through. `node.focus()` then `node.click()` is that
  // sequence, with the flush in between that made it look intermittent.
  // -------------------------------------------------------------------------
  const expanded = (nth) =>
    evaluate(
      `document.querySelectorAll(".calendar-builder-row-toggle")[${nth}].getAttribute("aria-expanded")`
    );
  /*
   * `node.focus()` is no good here: a `show: false` window does not hold the
   * document focus, so the browser dispatches nothing and the press reads as a
   * bare click — which is the one shape that never showed the bug. What the
   * browser actually sends on mousedown is `focusin`, which is also the event
   * React's `onFocusCapture` is attached to, so that is what this sends, with
   * a flush after it.
   */
  const press = async (nth) => {
    await evaluate(
      `(() => {
         const node = document.querySelectorAll(".calendar-builder-row-toggle")[${nth}];
         node.focus();
         node.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
         return true;
       })()`
    );
    await settle(2);
    await evaluate(
      `document.querySelectorAll(".calendar-builder-row-toggle")[${nth}].click()`
    );
    await settle(4);
  };

  // Section 6 left step 1 closed, so this starts by opening it.
  await press(0);
  assert.equal(
    await expanded(0),
    "true",
    "pressing a closed step opens it — focus must not open it first and let the click shut it"
  );

  await press(2);
  assert.equal(
    await expanded(2),
    "true",
    "pressing a collapsed step opens it — and it stays open"
  );
  assert.equal(await expanded(0), "false", "and the step that was open closes");

  await press(1);
  assert.equal(
    await expanded(1),
    "true",
    "moving between two steps is the case this broke on"
  );
  assert.equal(await expanded(2), "false", "the previous one closes");

  await press(1);
  assert.equal(
    await expanded(1),
    "false",
    "and pressing the open step closes it"
  );

  // -------------------------------------------------------------------------
  // The derived-figures line does not grow the form under the athlete
  //
  // `getWorkoutEditorContext` is a round trip, so it lands well after the
  // form is on screen. The box used to be `display: none` until it had
  // figures, so everything below it dropped ~34px the moment COROS answered —
  // measured here rather than reasoned about, because a height is the one
  // thing a static read of the CSS cannot settle.
  // -------------------------------------------------------------------------
  const CONTEXT = {
    distanceUnit: "metric",
    paceUnit: "km",
    heartRateBasis: "maxHr",
    maxHr: 190,
    restingHr: 52,
    lthrBpm: 168,
    thresholdPaceSecondsPerKm: 322,
    ftp: 180,
    zones: {},
    lthrZones: [],
    defaultPoolLength: { value: 25, unit: "m" },
    climbSystems: {}
  };

  const derivedBox = async (context) => {
    await harness("mount", "AddWorkoutModal", {}, {
      getWorkoutEditorContext: context,
      listWorkoutExercises: [],
      listUpcomingWorkouts: []
    });
    await settle();
    return {
      derived: await box(".calendar-builder-derived"),
      grid: await box(".calendar-builder-intensity-grid")
    };
  };

  // A Run warm-up starts on a heart-rate zone, so the line is on offer either
  // way; only its figures wait on the account.
  const waiting = await derivedBox(null);
  const answered = await derivedBox(CONTEXT);

  assert.ok(
    waiting.derived && answered.derived,
    "the box is drawn for a zone intensity whether or not the figures are in"
  );
  assert.equal(
    waiting.derived.height,
    answered.derived.height,
    `the derived line keeps its height while it waits:`
    + ` ${waiting.derived.height}px empty against ${answered.derived.height}px filled`
  );
  assert.equal(
    waiting.grid.height,
    answered.grid.height,
    "so nothing below it moves when COROS answers"
  );
  assert.ok(
    answered.derived.height > 0,
    "and the line is actually there, rather than both being collapsed"
  );

  /*
   * Edit workout, in the Training Library, is the same builder.
   *
   * It had an editor of its own (`WorkoutEditorModal`), with its own defaults,
   * validator and layout. Now it opens Create workout's builder read from
   * COROS, keeps the sport, prices the draft with COROS's own load as the old
   * editor did, and a save writes back the steps nobody touched exactly as
   * they were read — `sourceExerciseId` and the step's own name included,
   * because those are what let COROS update an exercise in place.
   */
  await win.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
  {
    const LIBRARY_DOCUMENT = {
      ref: { kind: "library", programId: "wk-1" },
      revision: "rev-1",
      canEdit: true,
      context: CONTEXT,
      draft: {
        name: "Tempo",
        overview: "Controlled, not racing.",
        sportType: 1,
        sport: "run",
        nodes: [
          {
            id: "step-1",
            sourceExerciseId: "1",
            nodeType: "step",
            kind: "warmup",
            name: "Jog in",
            target: { type: "time", seconds: 900 },
            intensity: { type: "none" },
            editable: true
          },
          {
            id: "step-2",
            sourceExerciseId: "2",
            nodeType: "step",
            kind: "training",
            name: "Tempo block",
            target: { type: "distance", meters: 6437 },
            intensity: { type: "pace", lowSecondsPerKm: 271.2, highSecondsPerKm: 280.7, displayUnit: "km" },
            editable: true
          }
        ]
      }
    };
    await harness("mount", "WorkoutWorkspace", {
      width: 1300,
      height: 820,
      workouts: [{
        id: "wk-1",
        programId: "wk-1",
        name: "Tempo",
        sportType: 1,
        volume: "1 set(s)",
        trainingLoad: 0,
        exerciseCount: 2,
        setCount: 2,
        durationSeconds: 2400,
        tags: [],
        favorite: false,
        archived: false,
        syncState: "synced",
        updatedAt: "2026-02-01T00:00:00.000Z"
      }]
    }, {
      getWorkoutForEdit: LIBRARY_DOCUMENT,
      getWorkoutEditorContext: CONTEXT,
      listWorkoutExercises: [],
      previewWorkoutEdit: { trainingLoad: 193, durationSeconds: 2400, distanceMeters: 9437 },
      saveWorkoutEdit: { verified: true, document: LIBRARY_DOCUMENT }
    });
    await settle();
    await evaluate(
      `Array.from(document.querySelectorAll("button")).find((node) => node.textContent.trim() === "Edit").click()`
    );
    await settle(20);

    assert.equal(await count(".workout-editor-modal"), 0, "not the old editor");
    assert.equal(
      await evaluate(`document.querySelector(".calendar-modal-builder .calendar-modal-header h3")?.textContent`),
      "Edit library workout"
    );
    assert.equal(
      await evaluate(`document.querySelector(".calendar-builder-sport-value")?.textContent`),
      "Run",
      "a COROS workout keeps its sport: it is stated where the picker would be"
    );
    assert.equal(
      await evaluate(`document.querySelector('.calendar-builder-settings input[type="text"]').value`),
      "Tempo",
      "its name is read in"
    );
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelectorAll(".calendar-builder-row .calendar-builder-row-toggle > strong")).map((node) => node.textContent)`),
      ["Warm-up", "Training"],
      "and its steps, as the builder's rows"
    );
    const saveButton = `Array.from(document.querySelectorAll(".calendar-builder-footer .primary-button")).find((node) => node.textContent.includes("Save changes"))`;
    assert.equal(await evaluate(`${saveButton}.disabled`), true, "nothing changed, nothing to save");
    assert.match(
      await evaluate(`document.querySelector(".calendar-builder-totals").textContent`),
      /193 TL/,
      "COROS's load for the draft sits beside the builder's own totals"
    );

    // Escape with an edit asks first, in the library's own dialog.
    await evaluate(
      `(() => {
         const input = document.querySelector('.calendar-builder-settings input[type="text"]');
         const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
         setter.call(input, "Tempo, steady");
         input.dispatchEvent(new Event("input", { bubbles: true }));
         return true;
       })()`
    );
    await settle();
    await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`);
    await settle();
    assert.equal(
      await evaluate(`document.querySelector(".tl-dialog h2")?.textContent`),
      "Discard unsaved changes?",
      "unsaved edits are asked about before they are thrown away"
    );
    await evaluate(
      `Array.from(document.querySelectorAll(".tl-dialog button")).find((node) => node.textContent.trim() === "Keep editing").click()`
    );
    await settle();
    assert.equal(await count(".calendar-modal-builder"), 1, "Keep editing keeps it");

    await evaluate(`${saveButton}.click()`);
    await settle(12);
    const saves = await evaluate(
      `window.__harness.calls("saveWorkoutEdit").map((call) => call.args)`
    );
    assert.equal(saves.length, 1, "Save goes to COROS once");
    const [ref, revision, draft] = saves[0];
    assert.deepEqual(ref, { kind: "library", programId: "wk-1" });
    assert.equal(revision, "rev-1", "against the revision it was read at");
    assert.equal(draft.name, "Tempo, steady");
    assert.deepEqual(
      draft.nodes,
      LIBRARY_DOCUMENT.draft.nodes,
      "the steps nobody touched go back exactly as they were read"
    );
    assert.deepEqual(
      await evaluate(`window.__harness.calls("prop:onMessage").map((call) => call.args[0])`),
      ["Workout saved and verified."]
    );
    assert.equal(await count(".calendar-modal-builder"), 0, "and the builder closes");
  }

  const errors = await evaluate("window.__harness.consoleErrors()");
  assert.deepEqual(errors, [], "the dialog mounted without console errors");

  console.log("workout builder renderer tests passed");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
