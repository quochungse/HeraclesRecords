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
// - **A range read once is drawn at once, and one never read shimmers.** The
//   cache used to live inside the screen, so every visit waited on COROS again.
//   It outlives the screen now: paging back, or leaving and returning, paints
//   the range before the refresh behind it lands. Until a range has been read
//   its days and weekly statistics draw stand-ins in the Library's shimmer.
//   App draws the same stand-ins as the Suspense fallback while the screen's
//   chunk loads, and the grid must sit where the screen's own will, or the
//   chunk landing moves the whole month.
// - **A scheduled session is edited in Create workout's builder.** It had an
//   editor of its own; now Edit opens the builder every other workout is
//   written in, saves against the occurrence and asks in the screen's dialog.
// - **The cell is the day and a card is its session.** A press anywhere in a
//   cell opens the day as a whole, an empty one too; a card opens its own
//   session; a month cell folds past three cards into "+N more". A planned
//   card says "Plan" and states COROS's own time, and the week column counts
//   the plan apart from everything done.
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
// On a display scaled to 125% every box is a fraction of a pixel off, and the
// fallback's grid read a pixel lower than the screen's on code that was fine.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
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
const SKELETON_CHIP = ".calendar-skeleton-chip";
const SKELETON_STAT = ".calendar-skeleton-stat";
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
    assert.ok((await harness("count", SKELETON_CHIP)) > 0, "the unread days shimmer");
    assert.ok((await harness("count", SKELETON_STAT)) > 0, "the unread weeks' statistics shimmer");

    assert.equal(await harness("resolvePending", "listScheduledWorkouts", []), true);
    await settle();
    assert.equal(await harness("count", SKELETON_CHIP), 0, "a read range drops its stand-ins");
    assert.equal(await harness("count", SKELETON_STAT), 0);
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
    assert.equal(
      await harness("count", SKELETON_CHIP),
      0,
      "a refresh of a range already read does not shimmer"
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
    assert.ok((await harness("count", SKELETON_CHIP)) > 0, "the unread month shimmers");
    await harness("resolvePending", "listScheduledWorkouts", []);
    await settle();
    assert.ok(
      (await harness("count", EMPTY_COPY)) > 0,
      "the new month's empty weeks say so once it is read"
    );

    // Back to the month read first: drawn from the cache, refreshed behind it.
    await harness("setScript", { listScheduledWorkouts: "__pending" });
    assert.equal(await harness("click", `[aria-label="Previous month"]`), true);
    await settle();
    assert.equal(await harness("count", SKELETON_CHIP), 0, "a month read before is drawn at once");
    assert.ok((await harness("count", EMPTY_COPY)) > 0, "and reads as read");
    assert.equal(await harness("exists", ".calendar-loading"), false, "without a loading line");
    await harness("resolvePending", "listScheduledWorkouts", []);
    await settle();

    // Leaving the screen and coming back keeps what was read.
    await mountCalendar({ listScheduledWorkouts: "__pending" });
    assert.equal(
      await harness("count", SKELETON_CHIP),
      0,
      "a return to the screen paints the month it read last time"
    );
    assert.ok((await harness("count", EMPTY_COPY)) > 0);
    await harness("resolvePending", "listScheduledWorkouts", []);
    await settle();
  }

  // -------------------------------------------------------------------------
  // 1b. The fallback drawn while the chunk loads is the screen's own shimmer
  // -------------------------------------------------------------------------
  {
    const gridBox = `(() => {
      const grid = document.querySelector(".calendar-grid").getBoundingClientRect();
      return [Math.round(grid.top), Math.round(grid.height), document.querySelectorAll(".calendar-grid-row").length];
    })()`;
    await harness("mount", "CalendarSkeleton", {}, EMPTY_RANGE);
    await settle();
    assert.ok((await harness("count", SKELETON_CHIP)) > 0, "the fallback shimmers");
    assert.ok((await harness("count", SKELETON_STAT)) > 0);
    assert.equal(await harness("count", ".empty-state"), 0, "and is not the generic spinner");
    const fallback = await evaluate(gridBox);

    // The month was read above, so the screen draws it at once, empty — which
    // is also the size of the grid it will draw once any range has landed.
    await mountCalendar({ listScheduledWorkouts: "__pending" });
    const screen = await evaluate(gridBox);
    assert.deepEqual(
      fallback,
      screen,
      "the fallback's grid sits where the screen's does, and is as tall"
    );
    await harness("resolvePending", "listScheduledWorkouts", []);
    await settle();
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

  // -------------------------------------------------------------------------
  // 4. A press on a cell opens the day as a whole, an empty one too
  // -------------------------------------------------------------------------
  //
  // It used to open nothing on an empty day and the one thing on a day holding
  // one, so the cell meant three things. Now the cell is the day and a card is
  // its session.
  const TODAY_OPEN = ".calendar-day.is-today .calendar-day-open";
  {
    await mountCalendar({ listScheduledWorkouts: [entry] });
    assert.equal(
      await harness("count", ".calendar-day.is-openable"),
      await harness("count", ".calendar-day"),
      "every day opens"
    );
    // The card answers its own press, over the button stretched across the
    // cell. Asked before any panel opens: a closed one leaves its backdrop on
    // frames a hidden window never gets.
    assert.equal(
      await evaluate(`(() => {
        const card = document.querySelector(".calendar-day.is-today .calendar-chip-planned").getBoundingClientRect();
        const hit = document.elementFromPoint(card.left + card.width / 2, card.top + card.height / 2);
        return Boolean(hit?.closest(".calendar-chip-planned"));
      })()`),
      true,
      "a card sits above the cell's own button"
    );
    assert.equal(await harness("click", TODAY_OPEN), true);
    await settle();
    assert.ok(await harness("exists", ".calendar-day-overview"), "a day with one thing opens as a day");
    assert.equal(await harness("count", ".calendar-day-overview-item"), 1);
    await pressOnDocument("Escape");
    await settle();

    assert.equal(await harness("click", ".calendar-day.is-empty .calendar-day-open"), true);
    await settle();
    assert.ok(await harness("exists", ".calendar-day-overview.is-empty"), "an empty day opens too");
    assert.ok(await harness("exists", ".calendar-day-overview-add"), "and offers what its + does");
    await pressOnDocument("Escape");
    await settle();

    const strides = { ...entry, idInPlan: "8", planProgramId: "program-2", name: "Strides", trainingLoad: 15 };
    await mountCalendar({ listScheduledWorkouts: [entry, strides] });
    assert.equal(await harness("click", TODAY_OPEN), true);
    await settle();
    assert.ok(await harness("exists", ".calendar-day-overview"), "a day with two things opens as a whole");
    assert.equal(await harness("count", ".calendar-day-overview-item"), 2, "a row for each");

    assert.equal(await harness("clickText", ".calendar-detail-action", "Ask Coach"), true);
    const asked = (await harness("calls", "prop:onOpenCoach")).at(-1)?.args[0];
    assert.equal(asked?.scheduleRefs?.[0]?.scope, "day", "Ask Coach asks about the day");
    assert.equal(asked?.scheduleRefs?.[0]?.day, todayKey);

    assert.equal(await harness("clickText", ".calendar-day-overview-item", "Strides"), true);
    await settle();
    assert.equal(await harness("text", ".calendar-detail-header h3"), "Strides", "a row opens its thing");
    assert.ok(await harness("exists", ".calendar-detail-back"), "with a way back to the day");
    assert.equal(await harness("click", ".calendar-detail-back"), true);
    await settle();
    assert.ok(await harness("exists", ".calendar-day-overview"), "back to the day");
    await pressOnDocument("Escape");
    await settle();

    // A month cell shows three cards; past that, two and the rest folded.
    const more = [9, 10, 11].map((id) => ({ ...entry, idInPlan: String(id), planProgramId: `program-${id}`, name: `Session ${id}` }));
    await mountCalendar({ listScheduledWorkouts: [entry, strides, ...more] });
    assert.equal(await harness("count", ".calendar-day.is-today .calendar-chip"), 2, "two cards and the fold");
    assert.equal(await harness("text", ".calendar-day.is-today .calendar-day-more"), "+3 more");
    assert.equal(await harness("click", ".calendar-day.is-today .calendar-day-more"), true);
    await settle();
    assert.equal(await harness("count", ".calendar-day-overview-item"), 5, "the fold opens the whole day");
    await pressOnDocument("Escape");
    await settle();
  }

  // -------------------------------------------------------------------------
  // 4b. A card is two lines, and the week column keeps plan apart from total
  // -------------------------------------------------------------------------
  {
    const strength = {
      ...entry,
      idInPlan: "12",
      planProgramId: "program-12",
      name: "Full body",
      sportType: 4,
      volume: undefined,
      trainingLoad: undefined,
      rawProgram: { estimatedTime: 2700 }
    };
    await mountCalendar({ listScheduledWorkouts: [{ ...entry, rawProgram: { estimatedTime: 1800 } }, strength] });
    const metas = await evaluate(
      `Array.from(document.querySelectorAll(".calendar-day.is-today .calendar-chip-meta"), (node) => node.textContent)`
    );
    assert.deepEqual(
      metas,
      ["Plan · 5 km · 30m · 40 TL", "Plan · 45m"],
      "a planned card says so, and a strength session states COROS's own time"
    );
    const rows = await evaluate(
      `Array.from(document.querySelectorAll(".calendar-weekstats-row"), (row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]).filter(([label]) => label)`
    );
    assert.deepEqual(
      rows,
      [
        ["Planned sessions", "0 / 2"],
        ["Planned time", "0m / 1h 15m"]
      ],
      "a week of plan only: its sessions and their time, no totals of nothing"
    );
    assert.match(
      await harness("text", ".calendar-weekstats-load"),
      /40\s*TL planned/,
      "a week nothing has been done in yet reads as what it will be"
    );
  }

  // -------------------------------------------------------------------------
  // 5. Editing a scheduled session opens Create workout's builder
  // -------------------------------------------------------------------------
  //
  // It had an editor of its own (`WorkoutEditorModal`): card-per-step, its own
  // header, footer and discard strip, beside a builder every other workout is
  // written in. Now it is that builder, read from the occurrence, saved back
  // against it, and its discard question is the screen's ConfirmDialog.
  {
    const context = {
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
    const ref = {
      kind: "scheduled",
      happenDay: todayKey,
      planId: "plan-1",
      idInPlan: "7",
      planProgramId: "program-1"
    };
    const occurrence = {
      ref,
      revision: "rev-1",
      canEdit: true,
      context,
      draft: {
        name: "Easy run",
        overview: "",
        sportType: 1,
        sport: "run",
        nodes: [
          {
            id: "step-1",
            sourceExerciseId: "1",
            nodeType: "step",
            kind: "training",
            name: "Easy",
            target: { type: "distance", meters: 5000 },
            intensity: { type: "none" },
            editable: true
          }
        ]
      }
    };
    // A scheduled session's sport is a COROS program code (1 is a run), not
    // the activity code the entries above carry, and only those are editable.
    await mountCalendar({
      listScheduledWorkouts: [{ ...entry, sportType: 1 }],
      getWorkoutForEdit: occurrence,
      getWorkoutEditorContext: context,
      listWorkoutExercises: [],
      previewWorkoutEdit: { trainingLoad: 40 },
      saveWorkoutEdit: { verified: true, document: occurrence }
    });
    assert.equal(await harness("click", ".calendar-chip-planned"), true);
    await settle();
    assert.equal(await harness("clickText", ".calendar-detail-action", "Edit"), true);
    await settle();
    await settle();

    assert.equal(await harness("exists", ".workout-editor-modal"), false, "not the old editor");
    assert.ok(await harness("exists", ".calendar-modal-builder"), "the builder opens");
    assert.equal(
      await harness("text", ".calendar-modal-builder .calendar-modal-header h3"),
      "Edit workout"
    );
    assert.ok(
      await harness("exists", ".calendar-modal-builder .calendar-modal-date"),
      "the day it is on heads the sheet, as Create workout's does"
    );
    assert.equal(
      await evaluate(`document.querySelector(".calendar-builder-sport-value")?.textContent`),
      "Run",
      "it keeps its sport, stated where the picker would be"
    );
    const saveButton = `Array.from(document.querySelectorAll(".calendar-builder-footer .primary-button")).find((node) => node.textContent.includes("Save changes"))`;
    assert.equal(await evaluate(`${saveButton}.disabled`), true, "nothing changed, nothing to save");

    await evaluate(
      `(() => {
         const input = document.querySelector('.calendar-builder-settings input[type="text"]');
         const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
         setter.call(input, "Easy run, relaxed");
         input.dispatchEvent(new Event("input", { bubbles: true }));
         return true;
       })()`
    );
    await settle();
    await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`);
    await settle();
    assert.equal(
      await harness("text", `${DIALOG} h2`),
      "Discard unsaved changes?",
      "an edit is asked about in the screen's own dialog before it is thrown away"
    );
    assert.equal(await harness("click", CANCEL), true);
    await settle();
    assert.ok(await harness("exists", ".calendar-modal-builder"), "Keep editing keeps it");

    await evaluate(`${saveButton}.click()`);
    await settle();
    const saves = await harness("calls", "saveWorkoutEdit");
    assert.equal(saves.length, 1, "Save goes to COROS once");
    const [savedRef, revision, draft] = saves[0].args;
    assert.deepEqual(savedRef, ref, "against the occurrence on screen");
    assert.equal(revision, "rev-1");
    assert.equal(draft.name, "Easy run, relaxed");
    assert.deepEqual(draft.nodes, occurrence.draft.nodes, "the untouched step goes back as it was read");
    assert.ok(
      (await harness("calls", "prop:onMessage")).some((call) => call.args[0] === "Updated scheduled occurrence in COROS."),
      "the update is reported"
    );
    assert.equal(await harness("exists", ".calendar-modal-builder"), false, "and the builder closes");
  }

  assert.deepEqual(await harness("consoleErrors"), [], "the screen logged no errors");

  console.log(
    "calendar renderer OK — an unread range shimmers and a read one is drawn from cache at once, an empty week waits for its range before saying so, both removals ask first in a portalled dialog, its Escape leaves the panel open, a scheduled session is edited in Create workout's builder, every cell opens its day under cards that open their own session, and the week column keeps the plan apart"
  );
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
