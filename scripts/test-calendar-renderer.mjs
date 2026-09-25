// The Calendar screen, mounted for real in Electron's Chromium against a stubbed
// COROS. Two things are held here, both about what the screen says before and
// around a request rather than about the request itself.
//
// - **An empty week says so only once the range has been read.** The weekly
//   statistics column used to read "Nothing planned or logged" beside every
//   week while COROS was still answering — on every launch, and on every page
//   to a month not yet cached — then swap in the real figures. So until the
//   range on screen has landed the cell is drawn and says nothing; a refresh of
//   a range already read keeps the copy, because what is on screen was read
//   for that range.
// - **Removing a workout asks first, in a dialog.** It was a button that armed
//   itself on the first press and removed on the second, in place. Both
//   removals — the day panel's and the selection bar's — now open the app's
//   ConfirmDialog, portalled to `<body>`, and nothing is sent to COROS until it
//   is answered. The dialog's Escape must not also close the panel under it:
//   both listen on `document` in the capture phase, and the panel registered
//   first, so it hears the key first.
//
// Nothing here removes anything anywhere: `removeScheduledWorkout` is a stub
// that records its arguments.
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
  for (let pass = 0; pass < 3; pass += 1) {
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
}

async function waitForStyles() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await harness("appStylesReady")) return;
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
  throw new Error("the app stylesheet never loaded");
}

/** A key pressed on the document, the way a real one arrives. */
function pressOnDocument(key) {
  return evaluate(
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true })), true`
  );
}

const EMPTY_COPY = ".calendar-weekstats-empty";
const DIALOG = `.tl-dialog[role="alertdialog"]`;
const CONFIRM = ".tl-dialog footer .primary-button";
const CANCEL = ".tl-dialog footer .ghost-button";

/** Everything the range read asks for, answered empty. */
const EMPTY_RANGE = {
  listScheduledWorkouts: [],
  listTrainingHubActivities: [],
  getDailyMetrics: { dayList: [], weekList: [] },
  listTrainingActivityMatches: []
};

async function mountCalendar(script) {
  await harness("mount", "CalendarView", {}, { ...EMPTY_RANGE, ...script });
  await waitForStyles();
  await harness("freezeAnimations");
  await settle();
}

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

  // The day the page thinks it is, so the workout lands on a day that is not
  // past — the only days that offer Remove.
  const todayKey = await evaluate(`(() => {
    const d = new Date();
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  })()`);

  // -------------------------------------------------------------------------
  // 1. An empty week says nothing until the range has been read
  // -------------------------------------------------------------------------
  {
    await mountCalendar({ listScheduledWorkouts: "__pending" });

    const weekCells = await harness("count", ".calendar-weekstats");
    assert.ok(weekCells >= 4, `every week keeps its statistics cell (${weekCells})`);
    assert.ok(await harness("exists", ".calendar-loading"), "the range is still being read");
    assert.equal(
      await harness("count", EMPTY_COPY),
      0,
      "a week nobody has asked COROS about yet must not say it has nothing in it"
    );

    assert.equal(await harness("resolvePending", "listScheduledWorkouts", []), true);
    await settle();
    assert.equal(
      await harness("count", EMPTY_COPY),
      weekCells,
      "once the range is read, an empty week says so"
    );
    assert.equal(await harness("text", EMPTY_COPY), "Nothing planned or logged");

    // A refresh re-reads the same range. What is on screen was read for it, so
    // the copy stays rather than blinking out and back on every write.
    await harness("setScript", { listScheduledWorkouts: "__pending" });
    assert.equal(await harness("click", `[aria-label="Refresh calendar"]`), true);
    await settle();
    assert.ok(await harness("exists", ".calendar-loading"), "the refresh is in flight");
    assert.equal(
      await harness("count", EMPTY_COPY),
      weekCells,
      "a refresh of a range already read keeps its empty weeks' copy"
    );
    await harness("resolvePending", "listScheduledWorkouts", []);
    await settle();

    // A month nobody has read yet keeps the previous month's data until its
    // own lands — which says nothing about the new weeks.
    await harness("setScript", { listScheduledWorkouts: "__pending" });
    assert.equal(await harness("click", `[aria-label="Next month"]`), true);
    await settle();
    assert.equal(
      await harness("count", EMPTY_COPY),
      0,
      "paging to an unread month must not call its weeks empty before they are read"
    );
    await harness("resolvePending", "listScheduledWorkouts", []);
    await settle();
    assert.ok(
      (await harness("count", EMPTY_COPY)) > 0,
      "the new month's empty weeks say so once it is read"
    );
  }

  const entry = {
    planId: "plan-1",
    idInPlan: "7",
    planProgramId: "program-1",
    happenDay: todayKey,
    name: "Easy run",
    sportType: 100,
    volume: "5 km",
    trainingLoad: 40
  };

  // -------------------------------------------------------------------------
  // 2. The day panel's Remove asks first, and its Escape closes only itself
  // -------------------------------------------------------------------------
  {
    await mountCalendar({ listScheduledWorkouts: [entry] });

    assert.equal(await harness("click", ".calendar-chip-planned"), true);
    await settle();
    assert.ok(await harness("exists", ".calendar-detail-panel"), "the day panel opens");

    assert.equal(await harness("clickText", ".calendar-detail-action", "Remove"), true);
    await settle();
    assert.ok(await harness("exists", DIALOG), "Remove opens a question, not a second button");
    assert.equal(
      await harness("callCount", "removeScheduledWorkout"),
      0,
      "nothing goes to COROS before the question is answered"
    );
    assert.match(await harness("text", `${DIALOG} h2`), /Remove "Easy run" from the calendar\?/);
    assert.equal(
      await evaluate(`document.querySelector(".tl-dialog-backdrop")?.parentElement === document.body`),
      true,
      "the question is portalled to <body>, clear of the shell's stacking context"
    );
    // Portalled out of every library scope, the scrim read `--tl-scrim` from
    // nothing and the whole `background` declaration was dropped.
    const scrim = await harness("style", ".tl-dialog-backdrop", "background-color");
    assert.notEqual(scrim, "rgba(0, 0, 0, 0)", "the question dims what it sits over");
    assert.equal(
      await evaluate(`document.activeElement?.textContent?.trim()`),
      "Cancel",
      "Cancel takes focus, so a reflexive Enter removes nothing"
    );

    await pressOnDocument("Escape");
    await settle();
    assert.equal(await harness("exists", DIALOG), false, "Escape closes the question");
    // The panel animates out on frames a hidden window never gets, so whether
    // it is still in the DOM proves nothing. Whether its Remove can still ask
    // about the workout does: that needs the selection to be open.
    assert.equal(await harness("clickText", ".calendar-detail-action", "Remove"), true);
    await settle();
    assert.ok(
      await harness("exists", DIALOG),
      "the same Escape must not have closed the panel under the question"
    );

    await harness("setScript", { removeScheduledWorkout: "__pending" });
    assert.equal(await harness("click", CONFIRM), true);
    await settle();
    assert.equal(await harness("callCount", "removeScheduledWorkout"), 1);
    const { planId, idInPlan, planProgramId } = (
      await harness("calls", "removeScheduledWorkout")
    )[0].args[0];
    assert.deepEqual(
      { planId, idInPlan, planProgramId },
      { planId: "plan-1", idInPlan: "7", planProgramId: "program-1" },
      "the removal names the occurrence on screen"
    );
    assert.ok(await harness("exists", DIALOG), "the question stays up while COROS answers");
    assert.equal(await harness("attr", ".tl-dialog", "aria-busy"), "true");
    assert.match(await harness("text", CONFIRM), /Removing…/);

    await harness("resolvePending", "removeScheduledWorkout", null);
    await settle();
    assert.equal(await harness("exists", DIALOG), false, "the question goes when the removal lands");
    const messages = await harness("calls", "prop:onMessage");
    assert.ok(
      messages.some((call) => /Removed "Easy run" from the calendar/.test(String(call.args[0]))),
      "the removal is reported"
    );
  }

  // -------------------------------------------------------------------------
  // 3. The selection bar's Remove asks first too
  // -------------------------------------------------------------------------
  {
    await mountCalendar({ listScheduledWorkouts: [entry] });

    assert.equal(await harness("click", ".calendar-select-button"), true);
    await settle();
    assert.equal(await harness("click", ".calendar-chip-planned"), true);
    await settle();
    assert.equal(await harness("click", ".calendar-selection-delete"), true);
    await settle();

    assert.ok(await harness("exists", DIALOG), "removing a selection opens a question");
    assert.match(await harness("text", `${DIALOG} h2`), /Remove 1 workout from the calendar\?/);
    assert.equal(await harness("callCount", "removeScheduledWorkout"), 0);

    assert.equal(await harness("click", CANCEL), true);
    await settle();
    assert.equal(await harness("exists", DIALOG), false, "Cancel closes the question");
    assert.ok(
      await harness("exists", ".calendar-selection-bar"),
      "and leaves the selection as it was"
    );
    assert.equal(await harness("callCount", "removeScheduledWorkout"), 0);

    await harness("setScript", { removeScheduledWorkout: "__pending" });
    assert.equal(await harness("click", ".calendar-selection-delete"), true);
    await settle();
    assert.equal(await harness("click", CONFIRM), true);
    await settle();
    assert.equal(await harness("callCount", "removeScheduledWorkout"), 1);
    assert.match(
      await harness("text", CONFIRM),
      /Removing 1 of 1…/,
      "the question counts the removals off while they run"
    );

    await harness("resolvePending", "removeScheduledWorkout", null);
    await settle();
    assert.equal(await harness("exists", DIALOG), false);
    assert.equal(
      await harness("exists", ".calendar-selection-bar"),
      false,
      "a selection removed in full leaves selection mode"
    );
  }

  assert.deepEqual(await harness("consoleErrors"), [], "the screen logged no errors");

  console.log(
    "calendar renderer OK — an empty week waits for its range before saying so, both removals ask first in a portalled dialog, and its Escape leaves the panel open"
  );
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
