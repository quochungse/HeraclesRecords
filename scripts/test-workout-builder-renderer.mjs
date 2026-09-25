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

  const errors = await evaluate("window.__harness.consoleErrors()");
  assert.deepEqual(errors, [], "the dialog mounted without console errors");

  console.log("workout builder renderer tests passed");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
