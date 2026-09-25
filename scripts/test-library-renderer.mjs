// The plan reader, mounted for real in Electron's Chromium.
//
// `test:plan-reader` proves the model reads a plan correctly. Nothing in it
// can say the screen draws what the model returned, and every claim below is
// one a static scan gets wrong in the same confident way:
//
// - **A plan item is not a workout tile.** That was the whole correction this
//   rebuild started from, and it is only true if the row actually renders the
//   four things a session has that a library workout does not: a day, a
//   target, a step count and an outcome.
// - **A grid row draws in one row.** The plan list declared five tracks for
//   six visible cells below 900px, so its actions cell fell into an implicit
//   second row — valid CSS, no warning, a broken table. The static check added
//   in phase 4 compares the stylesheet against itself; only a browser can say
//   what the boxes did. The day row here is the same shape of grid.
// - **An upcoming session is not drawn like a kept one.** `statusTone` says
//   "quiet", but the colour it resolves to is a CSS question, and a token that
//   resolves to nothing takes the whole declaration with it.
// - **An empty week keeps its number.** Dropping it renumbers every week after
//   it, so week 9 in the reader would not be week 9 of the plan.
//
// **One section needs the window to be painted.** The tile shape queue is driven
// by an `IntersectionObserver`, and an observer needs a rendering opportunity —
// which a `show: false` window does not always get. Measured on a GNOME Wayland
// session: neither `IntersectionObserver` nor `requestAnimationFrame` fires at
// all there, while every other assertion here passes. Without frames the queue
// produces nothing, which reads exactly like the drain bug section 8 exists to
// catch, so it asks `hasFrames()` first and names the environment instead.
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

async function mount(options) {
  await harness("mount", "PlanReader", options);
  await settle();
}

/**
 * The window itself, because `.plan-reader-day` folds on a media query and a
 * media query reads the window rather than the column it is mounted in. A
 * hidden window does honour this — verified against one before the assertion
 * below was written, since the harness header warns that it does not.
 */
async function resizeWindow(width) {
  win.setContentSize(width, 900);
  /*
   * Polled rather than waited on. A resize is handed to the window manager
   * and lands when it lands — a fixed pause was long enough going down and
   * intermittently short going back up, which is a suite that passes on
   * timing rather than on behaviour.
   */
  let inner = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    inner = await evaluate("window.innerWidth");
    if (Math.abs(inner - width) <= 20) break;
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
  assert.ok(
    Math.abs(inner - width) <= 20,
    `the window has to actually resize for a media query to fire: asked ${width}, got ${inner}`
  );
  await settle();
}

/**
 * Whether the window is being given frames.
 *
 * `IntersectionObserver` and `requestAnimationFrame` both need a rendering
 * opportunity, and a hidden window does not always get one — measured on a
 * GNOME Wayland session, where neither fires at all in a `show: false` window
 * while every other assertion in this suite passes. The tile shape queue is
 * driven by an observer, so without frames it produces nothing and the section
 * below reads exactly like the drain bug it exists to catch. Asked once so the
 * failure can name the real cause.
 */
async function hasFrames() {
  return evaluate(
    `new Promise((resolve) => {
       const timer = setTimeout(() => resolve(false), 1500);
       requestAnimationFrame(() => {
         clearTimeout(timer);
         resolve(true);
       });
     })`
  );
}

/** Every matching element's text, trimmed and collapsed. */
function textOf(selector) {
  return evaluate(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(
       (node) => node.textContent.replace(/\\s+/g, " ").trim()
     )`
  );
}

/** Just the method names of what the page called back, which always clone. */
function calledBack() {
  return evaluate("window.__harness.calls().map((call) => call.method)");
}

/**
 * Polls until a count settles on what is expected, then returns what it found.
 *
 * The shapes arrive over a queue of COROS requests, so a fixed pause is a
 * test that passes on timing — too short and it reports the bug it is meant
 * to catch, too long and it hides a stall behind patience. Returning the last
 * reading either way means the assertion still names the real number.
 */
async function waitForCount(selector, expected, attempts = 40) {
  let seen = -1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    seen = await count(selector);
    if (seen === expected) return seen;
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
  return seen;
}

/** The same patience, for text that arrives with a detail rather than a count. */
async function waitForText(selector, expected, attempts = 40) {
  let seen = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    seen = await textOf(selector);
    if (seen.length === expected.length && seen.every((value, index) => value === expected[index])) {
      return seen;
    }
    await evaluate("new Promise((resolve) => setTimeout(resolve, 40))");
  }
  return seen;
}

function count(selector) {
  return evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

/** The box of the first match, as the browser laid it out. */
function boxOf(selector) {
  return evaluate(
    `(() => {
       const node = document.querySelector(${JSON.stringify(selector)});
       if (!node) return null;
       const rect = node.getBoundingClientRect();
       return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
     })()`
  );
}

// ---------------------------------------------------------------------------
// One plan carrying every shape the reader has to draw
// ---------------------------------------------------------------------------

const entry = (id, overrides) => ({
  id,
  weekIndex: 0,
  dayIndex: 0,
  sortOrder: 1,
  ...overrides
});

/*
 * A plan on the calendar is COROS's running copy of a plan: its sessions carry
 * the identity COROS gave them (`idInPlan`) and the day it put them on, and it
 * is dated from a Monday. Week stages are COROS's own enum — 2 Base, 3 Build.
 */
const PLAN = {
  id: "coros:run-1",
  remoteId: "run-1",
  remoteVersion: 2,
  name: "Spring marathon",
  description: "Sub 3:30 in May",
  sportMix: ["run", "trailRun"],
  weekCount: 3,
  weekStages: [
    { weekIndex: 0, stage: 2 },
    { weekIndex: 1, stage: 2 },
    { weekIndex: 2, stage: 3 }
  ],
  entries: [
    entry("e-tempo", {
      dayIndex: 1,
      sortOrder: 1,
      title: "Tempo 4 x 8",
      idInPlan: "1",
      happenDay: "20260303",
      workout: {
        key: "w1",
        name: "Tempo",
        sport: "run",
        steps: [
          { target_duration_seconds: 900, target_load: 25 },
          { target_duration_seconds: 1920, target_distance_meters: 8000, target_load: 65 }
        ]
      }
    }),
    entry("e-long", {
      dayIndex: 6,
      sortOrder: 2,
      title: "Long run",
      idInPlan: "2",
      happenDay: "20260308",
      plannedDurationSeconds: 7200,
      plannedTrainingLoad: 120,
      workout: { key: "w2", name: "Long", sport: "run" }
    }),
    /* Week 2 is deliberately empty — a gap in a block is a fact about the plan. */
    entry("e-hills", {
      weekIndex: 2,
      dayIndex: 1,
      sortOrder: 3,
      title: "Hills",
      idInPlan: "3",
      happenDay: "20260317",
      workout: { key: "w3", name: "Hills", sport: "trailRun", steps: [{ target_load: 70 }] }
    })
  ],
  calendar: "running",
  startDate: "2026-03-02",
  sourcePlanId: "tpl-1",
  tags: [],
  favorite: false,
  archived: false,
  updatedAt: "2026-02-20T00:00:00.000Z"
};

/** The same plan as a template: no dates, no identities on a calendar. */
function templateOf(plan, overrides = {}) {
  const { startDate: _start, sourcePlanId: _source, ...rest } = plan;
  return {
    ...rest,
    calendar: "unscheduled",
    entries: plan.entries.map(({ happenDay: _day, ...item }) => item),
    ...overrides
  };
}

const snapshotOf = (plans, extra = {}) => ({
  workouts: [],
  plans,
  drafts: [],
  matches: [],
  cachedAt: "2026-03-01T00:00:00.000Z",
  stale: false,
  offline: false,
  partialFailures: [],
  ...extra
});

async function openPlansTab() {
  await settle();
  await evaluate(
    `(() => { const tab = Array.from(document.querySelectorAll(".tl-sections button")).find((b) => b.textContent.startsWith("Plans")); tab?.click(); })()`
  );
  await settle();
}

async function openPlanTile(name) {
  await evaluate(
    `Array.from(document.querySelectorAll(".tl-card-name")).find((n) => n.textContent === ${JSON.stringify(name)}).closest("button").click()`
  );
  await settle();
}

async function pickMenuItem(text) {
  await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
  await settle();
  await evaluate(
    `Array.from(document.querySelectorAll(".plan-more-menu [role=menuitem]")).find((n) => n.textContent.includes(${JSON.stringify(text)})).click()`
  );
  await settle();
}

/** One item of the reader's ⋯, read with the menu opened and closed again. */
async function menuItemState(text) {
  await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
  await settle();
  const state = await evaluate(
    `(() => { const item = Array.from(document.querySelectorAll(".plan-more-menu [role=menuitem]")).find((n) => n.textContent.trim() === ${JSON.stringify(text)});
       return item ? { disabled: item.disabled, title: item.title } : null; })()`
  );
  await evaluate(
    `document.querySelector(".plan-more-menu")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`
  );
  await settle();
  return state;
}

const MATCHES = [
  {
    id: "m1",
    schedulePlanId: "run-1",
    scheduleIdInPlan: "1",
    happenDay: "2026-03-03",
    status: "completed",
    manual: false,
    activityId: "act-tempo",
    completedDurationSeconds: 2950,
    completedDistanceMeters: 8200,
    updatedAt: "2026-03-03T00:00:00.000Z"
  },
  {
    id: "m2",
    schedulePlanId: "run-1",
    scheduleIdInPlan: "2",
    happenDay: "2026-03-08",
    status: "missed",
    manual: false,
    updatedAt: "2026-03-09T00:00:00.000Z"
  },
  {
    id: "m3",
    schedulePlanId: "run-1",
    scheduleIdInPlan: "3",
    happenDay: "2026-03-17",
    status: "upcoming",
    manual: false,
    updatedAt: "2026-03-10T00:00:00.000Z"
  }
];

// ---------------------------------------------------------------------------
// The Workouts tab's fixture: a library, and the one document COROS serves
// when a workout is selected.
// ---------------------------------------------------------------------------

/*
 * The library rows as `/training/program/query` actually answers with them.
 *
 * Probed live on 2026-09-22 against this account, field by field:
 *
 * - `trainingLoad`, `essence`, `estimatedValue`, `duration`, `distance` and
 *   `estimatedDistance` are **all `0`** on every row. So is `volume`'s source,
 *   which is why `formatUpcomingWorkoutVolume` falls back to a set count and
 *   an hour's easy run reads back as "1 set(s)".
 * - `estimatedTime` is **real** (690, 360, 1618, 1096 seconds), and equals the
 *   detail's own `duration` on every one of them. It is therefore the single
 *   figure a row can state without a second request — which is what
 *   `durationSeconds` carries.
 *
 * A fixture that fills the zeros in is not the shape the app is handed, and it
 * is exactly why the tile's "—" for load, its set count for a run, and both
 * dead figure sorts survived every pass of this suite.
 */
const WORKOUTS = [
  {
    id: "wk-1",
    programId: "wk-1",
    name: "Easy hour",
    sportType: 1,
    volume: "1 set(s)",
    trainingLoad: 0,
    exerciseCount: 4,
    setCount: 12,
    durationSeconds: 3600,
    tags: ["base"],
    favorite: false,
    archived: false,
    syncState: "synced",
    updatedAt: "2026-02-01T00:00:00.000Z"
  },
  {
    id: "wk-2",
    programId: "wk-2",
    name: "Threshold 4 x 8",
    sportType: 1,
    volume: "1 set(s)",
    trainingLoad: 0,
    exerciseCount: 6,
    setCount: 18,
    durationSeconds: 3120,
    tags: ["quality"],
    favorite: true,
    archived: false,
    syncState: "synced",
    updatedAt: "2026-02-02T00:00:00.000Z"
  },
  {
    id: "wk-3",
    programId: "wk-3",
    name: "Long run",
    sportType: 1,
    volume: "1 set(s)",
    trainingLoad: 0,
    exerciseCount: 2,
    setCount: 2,
    durationSeconds: 7800,
    tags: [],
    favorite: false,
    archived: false,
    syncState: "synced",
    updatedAt: "2026-02-03T00:00:00.000Z"
  },
  {
    /* A name no column can hold, so the ellipsis has something to do. COROS
       lets an athlete name a workout whatever they like and they do. */
    id: "wk-4",
    programId: "wk-4",
    name: "Zone 2 aerobic base with strides and a long cool-down, week 3 of 12",
    sportType: 1,
    volume: "1 set(s)",
    trainingLoad: 0,
    durationSeconds: 5400,
    exerciseCount: 9,
    setCount: 9,
    tags: [],
    favorite: false,
    archived: false,
    syncState: "synced",
    updatedAt: "2026-02-04T00:00:00.000Z"
  }
];

/** A `WorkoutEditorDocument` as `getWorkoutForEdit` answers with one. */
const WORKOUT_DOCUMENT = {
  ref: { kind: "library", programId: "wk-2" },
  revision: 1,
  canEdit: true,
  /*
   * What COROS stored against the program, read off the detail payload the
   * draft was parsed from.
   *
   * `distanceMeters` is here because the list has none — it answers `0`, and
   * the volume string it produces instead is a set count. `trainingLoad` is
   * here to exercise the branch where COROS has one at all: measured against
   * `/training/program/calculate`, it is 0 for a strength session and for a
   * distance-only run, and non-zero only once a step carries an intensity
   * target — 193 for an 8 km run at a pace band, 104 at a heart-rate band.
   */
  totals: { durationSeconds: 3120, distanceMeters: 12_000, trainingLoad: 95 },
  context: {
    distanceUnit: "metric",
    paceUnit: "km",
    zones: {},
    lthrZones: [],
    defaultPoolLength: { value: 25, unit: "m" },
    climbSystems: {}
  },
  draft: {
    sport: "run",
    overview: "",
    /* `target` and `intensity` are objects, not flattened fields — see
       RunWorkoutEditorStep. A fixture that invents the shape renders nothing
       and fails with a TypeError rather than an assertion. */
    nodes: [
      {
        id: "n1",
        nodeType: "step",
        kind: "warmup",
        name: "Warm-up",
        editable: true,
        target: { type: "time", seconds: 900 },
        intensity: { type: "none" }
      },
      {
        id: "n2",
        nodeType: "step",
        kind: "training",
        name: "Threshold",
        editable: true,
        target: { type: "distance", meters: 8000 },
        intensity: { type: "none" }
      }
    ]
  }
};

const WORKOUT_SCRIPT = {
  getWorkoutForEdit: WORKOUT_DOCUMENT,
  listWorkoutExercises: []
};

/*
 * A library too tall for one screen.
 *
 * The shape queue's stall needs the observer to report a second time while a
 * batch is in flight, which is what scrolling does and what three tiles all
 * visible at once never will. Twenty-four tiles over a half-width pane leaves
 * most of them below the fold.
 */
const MANY_WORKOUTS = Array.from({ length: 24 }, (_, index) => ({
  ...WORKOUTS[0],
  id: `many-${index}`,
  programId: `many-${index}`,
  name: `Session ${index + 1}`
}));

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
  // 1. The weeks are the plan's weeks, empty ones included
  // -------------------------------------------------------------------------
  {
    await mount({ plan: PLAN, matches: MATCHES });

    assert.equal(await count(".plan-week-card"), 3, "three declared weeks, three cards");
    const headings = await textOf(".plan-week-card > header h2");
    assert.deepEqual(
      headings,
      ["Week 1 Base", "Week 2 Base", "Week 3 Build"],
      "each week carries its own number and COROS's stage for it — as two " +
        "words, because the uppercase is CSS and a screen reader reads the text"
    );
    assert.equal(
      await count(".plan-reader-empty-week"),
      1,
      "week 2 holds nothing and says so — dropped, it would renumber week 3 as week 2"
    );
  }

  // -------------------------------------------------------------------------
  // 2. A plan item is not a workout tile
  // -------------------------------------------------------------------------
  {
    assert.deepEqual(
      await textOf(".plan-entry-name"),
      ["Tempo 4 x 8", "Long run", "Hills"],
      "every session draws"
    );

    // The day, which a library workout has no concept of. Every day of the week
    // is drawn — a wide reader lays them out as seven columns — so the days
    // with something in them are the ones this reads.
    const days = await textOf(".plan-reader-day:not(.is-empty) .plan-reader-day-label");
    assert.ok(days[0].startsWith("Tue "), `a plan on the calendar names the date on the day: ${days[0]}`);

    // The target, and nothing else: a step count sat in a day column that
    // could not hold it and broke the row.
    const figures = await textOf(".plan-entry-figures");
    assert.ok(
      figures[0].includes("47m") && figures[0].includes("90 load"),
      `the session states what it asks for: ${figures[0]}`
    );
    assert.equal(await count(".plan-entry-steps"), 0, "a session does not count its steps in the row");
    assert.ok(
      figures.some((value) => value.includes("2:00") && value.includes("120 load")),
      "a session with no structure still states the target it declares"
    );
  }

  // -------------------------------------------------------------------------
  // 3. Outcomes: three tones, and an upcoming session is not a kept one
  // -------------------------------------------------------------------------
  {
    assert.deepEqual(
      await textOf(".plan-entry-status"),
      ["Done", "Missed", "Ahead"],
      "one badge per session the matcher has judged, joined on the running copy's id and idInPlan"
    );

    /*
     * The tone each badge is actually wearing, in order. Reading the colours
     * alone is not enough: fold "upcoming" into the kept tone and there are
     * still three badges and still two distinct colours on screen, so only
     * naming the tone per session catches it.
     */
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll(".plan-entry-status")).map(
           (node) => node.dataset.tone
         )`
      ),
      ["done", "missed", "quiet"],
      "a session that has not happened yet wears the quiet tone, not the kept one"
    );

    const colourOf = (tone) =>
      evaluate(
        `getComputedStyle(
           document.querySelector('.plan-entry-status[data-tone=${JSON.stringify(tone)}]')
         ).color`
      );
    const done = await colourOf("done");
    const missed = await colourOf("missed");
    const quiet = await colourOf("quiet");

    for (const [tone, colour] of [["done", done], ["missed", missed], ["quiet", quiet]]) {
      // An undeclared token takes the whole declaration with it, so a badge
      // that lost its colour inherits the row's ink and reads as ordinary text.
      assert.match(colour, /^rgba?\(/, `${tone} must resolve to a colour, got ${colour}`);
    }
    assert.notEqual(
      done,
      quiet,
      "a session that has not happened yet must not be drawn like one that was " +
        "kept — a plan of upcoming sessions would read as a plan already completed"
    );
    assert.notEqual(done, missed);

    // The figure on the row and the sentence under it agree with the badges.
    assert.deepEqual(await textOf(".plan-reader-fig-done b"), ["50%"], "1 of 2 settled");
    assert.deepEqual(await textOf(".plan-reader-compliance"), ["1 done · 1 missed · 1 ahead"]);
  }

  // -------------------------------------------------------------------------
  // 3b. A wide week is seven columns, and a session in one is readable
  // -------------------------------------------------------------------------
  {
    /*
     * The reader's day list once wore `.plan-week-days`, the editor's grid,
     * without the column styles that go with it: each day was a seventh of the
     * week *and* still a label-beside-sessions row inside that seventh, so a
     * session name wrapped a word to a line. The assertions in section 4
     * passed through all of it, because they only measured inside one day.
     * The week is laid out as seven columns on purpose now, so what has to
     * hold is that the columns are the week's and the names inside them read.
     */
    const layout = await evaluate(
      `(() => {
         const card = document.querySelector(".plan-week-card");
         const box = card.getBoundingClientRect();
         const days = Array.from(card.querySelectorAll(".plan-reader-day"))
           .map((day) => day.getBoundingClientRect());
         const name = card.querySelector(".plan-entry-name").getBoundingClientRect();
         return { card: box.width, days: days.map((d) => ({ left: d.left, top: d.top, width: d.width })), name: name.width };
       })()`
    );
    assert.equal(layout.days.length, 7, "every day of the week has its column, empty ones included");
    assert.ok(
      layout.days.every((day) => Math.abs(day.top - layout.days[0].top) < 2),
      "the seven sit on one row"
    );
    assert.ok(
      layout.days.every((day, index) => index === 0 || day.left > layout.days[index - 1].left),
      "Monday to Sunday, left to right"
    );
    const span = layout.days.reduce((total, day) => total + day.width, 0);
    assert.ok(
      span > layout.card * 0.8,
      `together they span the week: ${Math.round(span)}px of ${Math.round(layout.card)}px`
    );
    assert.ok(
      layout.name > layout.days[1].width * 0.6,
      `a session's name takes its column's width, not a word's: ${Math.round(layout.name)}px`
    );
  }

  // -------------------------------------------------------------------------
  // 3c. A session opens, steps to its neighbours, and Escape comes back
  // -------------------------------------------------------------------------
  {
    assert.equal(await count(".plan-entry.is-openable"), 3, "every session opens");
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-entry.is-openable"))
         .find((row) => row.textContent.includes("Tempo 4 x 8")).click()`
    );
    await settle();

    assert.deepEqual(
      await harness("consoleErrors"),
      [],
      "the fixture's steps carry no `kind`, as plans written before the field was " +
        "required do — converted with `undefined` for a name, the first `.trim()` " +
        "downstream unmounted the whole screen"
    );
    assert.equal(await count(".plan-session"), 1, "the session replaces the weeks");
    assert.equal(await count(".plan-week-card"), 0);
    assert.deepEqual(await textOf(".plan-session .sched-hero-name"), ["Tempo 4 x 8"]);
    assert.ok(
      (await textOf(".plan-session-where"))[0].startsWith("Week 1 · Base · Tue "),
      "it says where in the plan it sits"
    );
    assert.equal(
      await count(".plan-session .sched-structure"),
      1,
      "a session with steps draws them, through the workout view the library shares"
    );
    assert.ok(
      (await textOf(".plan-session-outcome dd")).some((value) => value.includes("8.2")),
      "the kept session sets what was done beside what was asked"
    );
    await evaluate(`document.querySelector(".plan-session-activity").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(
        `window.__harness.calls("prop:onOpenActivity").map((call) => call.args[0])`
      ),
      ["act-tempo"],
      "and opens the activity it became"
    );
    assert.deepEqual(await textOf(".plan-session-pager span"), ["Session 1 of 3"]);
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Previous session"]').disabled`),
      true,
      "nothing before the first session"
    );

    await evaluate(`document.querySelector('[aria-label="Next session"]').click()`);
    await settle();
    assert.deepEqual(await textOf(".plan-session .sched-hero-name"), ["Long run"]);
    assert.equal(
      await count(".plan-session-bare"),
      1,
      "a session with a target and no steps says what it states instead of an empty structure"
    );

    await evaluate(
      `document.querySelector(".plan-session-back").dispatchEvent(
         new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
       )`
    );
    await settle();
    assert.equal(await count(".plan-session"), 0, "Escape steps out of the session");
    assert.equal(await count(".plan-week-card"), 3, "and the weeks are back");
    assert.equal(
      (await calledBack()).includes("prop:onBack"),
      false,
      "one layer at a time: the reader itself stays open"
    );
    assert.equal(
      await evaluate(`document.activeElement?.closest("[data-entry-id]")?.textContent.includes("Long run")`),
      true,
      "focus lands on the session last read, not at the top of the page"
    );
  }

  // -------------------------------------------------------------------------
  // 3c'. The head: a close, not a back arrow; the calendar at the right edge
  // -------------------------------------------------------------------------
  {
    await mount({ plan: templateOf(PLAN, { weekCount: 8 }), matches: MATCHES, height: 500 });
    assert.deepEqual(
      await evaluate(
        `Array.from(document.querySelectorAll(".plan-reader-head > button, .plan-reader-actions > * > button:first-child, .plan-reader-actions > button")).map(
           (button) => button.getAttribute("aria-label") || button.textContent.trim()
         )`
      ),
      ["Close plan", "More actions", "Add to favorites", "Add to calendar"],
      "the close where a back arrow was; the actions read the calendar, heart, ⋯ from the right edge in"
    );
    assert.equal(await count(".plan-reader-head > .ghost-button"), 0, "no back button on a dialog");
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelector(".plan-reader-add-calendar").classList)`),
      ["primary-button", "plan-reader-add-calendar"],
      "Add to calendar is the one filled button: it is what a plan is for"
    );
    await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
    await settle();
    assert.deepEqual(
      await textOf(".plan-more-menu [role=menuitem]"),
      ["Edit", "Duplicate", "Archive", "Delete"],
      "Edit leads the ⋯, and adding is not offered twice"
    );
    await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
    await settle();
    assert.equal(await count(".plan-reader-edit"), 0, "Edit is no button of its own without kept edits");
    assert.equal(await count(".plan-entry-status"), 0, "a plan not on the calendar has no outcomes to report");

    await evaluate(`document.querySelector(".plan-reader-add-calendar").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("prop:onCalendar").map((call) => call.args[1])`),
      ["add"],
      "a plan not on the calendar offers to add it, and pressing it asks for the dialog"
    );

    // The scroll: faded only where the plan goes on past the edge.
    const fadeOf = () =>
      evaluate(
        `(() => { const node = document.querySelector(".plan-reader");
           return [node.classList.contains("has-fade-top"), node.classList.contains("has-fade-bottom")]; })()`
      );
    assert.deepEqual(await fadeOf(), [false, true], "at the top only the lower edge fades");
    await evaluate(
      `(() => { const node = document.querySelector(".plan-reader"); node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event("scroll")); })()`
    );
    await settle();
    assert.deepEqual(await fadeOf(), [true, false], "at the foot only the upper one");
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector(".plan-reader")).scrollbarWidth`),
      "thin"
    );

    await evaluate(`document.querySelector(".plan-reader-close").click()`);
    await settle();
    assert.ok((await calledBack()).includes("prop:onBack"), "the close closes the reader");
  }

  // -------------------------------------------------------------------------
  // 3c''. Duplicating says so while COROS makes the copy
  // -------------------------------------------------------------------------
  {
    /*
     * A copy is made on COROS and then renamed, two round trips, and the
     * reader said nothing while they ran — long enough to read as a press that
     * did nothing, with the copy appearing on its own later. The copy is held
     * open here so the screen can be read in the middle of it.
     */
    const original = templateOf(PLAN, { id: "coros:dup", remoteId: "dup", name: "Official plan" });
    const copy = { ...original, id: "coros:dup-copy", remoteId: "dup-copy", name: "Official plan Copy" };
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      {
        getTrainingLibrarySnapshot: snapshotOf([original]),
        getNativeTrainingPlan: original,
        duplicateTrainingPlan: "__pending"
      }
    );
    await openPlansTab();
    await openPlanTile("Official plan");
    assert.equal(await count(".plan-reader-busy"), 0, "nothing is said before anything happens");
    await pickMenuItem("Duplicate");
    assert.deepEqual(await textOf(".plan-reader-busy"), ["Duplicating…"], "the reader says the copy is being made");
    assert.equal((await menuItemState("Edit")).disabled, true, "and Edit waits for it");

    await harness("setScript", { getTrainingLibrarySnapshot: snapshotOf([original, copy]) });
    await harness("resolvePending", "duplicateTrainingPlan", copy);
    await settle();
    assert.equal(await count(".plan-reader-busy"), 0, "the word goes when the copy is made");
    assert.deepEqual(await textOf(".plan-reader-title h1"), ["Official plan Copy"], "and the reader opens the copy");
    assert.deepEqual(
      await evaluate(`window.__harness.calls("duplicateTrainingPlan").map((call) => call.args[0])`),
      ["coros:dup"],
      "asked once, of the plan on screen"
    );
  }

  // -------------------------------------------------------------------------
  // 3c''-bis. The read on opening reaches the list, and never goes backwards
  // -------------------------------------------------------------------------
  {
    /*
     * Opening a plan reads it from COROS in the background. The answer used to
     * reach the reader alone: the tile kept its shallow copy, so every reopen
     * waited on the same read again, with Edit held down each time.
     */
    const shallow = templateOf(PLAN, { id: "coros:open", remoteId: "open", name: "Base block", remoteVersion: 2 });
    const read = {
      ...shallow,
      name: "Base block read",
      entries: shallow.entries.map((item) => ({ ...item, corosProgram: { id: `p-${item.id}` } }))
    };
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      { getTrainingLibrarySnapshot: snapshotOf([shallow]), getNativeTrainingPlan: "__pending" }
    );
    await openPlansTab();
    await openPlanTile("Base block");
    const editDisabled = async () => (await menuItemState("Edit")).disabled;
    assert.equal(await editDisabled(), true, "a copy without its programs cannot be edited yet");
    await harness("resolvePending", "getNativeTrainingPlan", read);
    await settle();
    assert.deepEqual(await textOf(".plan-reader-title h1"), ["Base block read"], "the reader takes the read");
    assert.equal(await editDisabled(), false);
    await evaluate(`document.querySelector(".plan-reader-close").click()`);
    await settle();
    assert.ok((await textOf(".tl-card-name")).includes("Base block read"), "and so does the tile in the list");

    await openPlanTile("Base block read");
    assert.equal(
      await evaluate(`window.__harness.callCount("getNativeTrainingPlan")`),
      2,
      "reopened, it is still checked against COROS"
    );
    assert.equal(await editDisabled(), false, "but a copy that has its programs does not wait for the check");
    await harness("resolvePending", "getNativeTrainingPlan", { ...read, name: "Stale reply", remoteVersion: 1 });
    await settle();
    assert.deepEqual(await textOf(".plan-reader-title h1"), ["Base block read"], "a reply older than the copy on screen is dropped");
    await evaluate(`document.querySelector(".plan-reader-close").click()`);
    await settle();
    assert.ok(!(await textOf(".tl-card-name")).includes("Stale reply"), "from the list as well");
  }

  // -------------------------------------------------------------------------
  // 3c''-ter. A run taken off is not listed; one outliving its plan says so
  // -------------------------------------------------------------------------
  {
    /*
     * COROS gives "Remove from calendar" the status of a run that ran out, and
     * the library filed it under Done. There is nothing left to do with it —
     * COROS will not put it back on the calendar — so it is not listed. A run
     * still on the calendar is listed however its plan fares on COROS, for
     * tracking; when that plan is gone, taking the run off is the last of it,
     * and the removal says so and offers a copy first.
     */
    const dated = PLAN.entries.map(({ happenDay: _day, ...item }) => item);
    const takenOff = { ...PLAN, id: "coros:off", remoteId: "off", name: "Taken off", calendar: "stopped", startDate: "2099-10-05", entries: dated };
    const ranOut = { ...PLAN, id: "coros:ran", remoteId: "ran", name: "Ran out", calendar: "finished", startDate: "2026-01-05", entries: dated };
    const outlived = { ...PLAN, id: "coros:run-9", remoteId: "run-9", name: "Catalogue run", sourcePlanId: "gone" };
    const copy = { ...templateOf(PLAN), id: "coros:copy-9", remoteId: "copy-9", name: "Catalogue run Copy" };
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      {
        getTrainingLibrarySnapshot: snapshotOf([takenOff, ranOut, outlived]),
        getNativeTrainingPlan: outlived,
        duplicateTrainingPlan: copy
      }
    );
    await openPlansTab();
    const gridOf = (name) =>
      evaluate(
        `Array.from(document.querySelectorAll(".tl-card-name")).find((n) => n.textContent === ${JSON.stringify(name)})?.closest("ul.tl-grid")?.getAttribute("aria-label") ?? null`
      );
    assert.equal(await gridOf("Taken off"), null, "a run taken off the calendar is not listed");
    assert.equal(await gridOf("Ran out"), "Plans that have finished", "one that ran out is, under Done");
    assert.notEqual(await gridOf("Catalogue run"), null, "and one on the calendar is, though its plan is gone");
    assert.match(
      await evaluate(`Array.from(document.querySelectorAll(".tl-sections button")).find((b) => b.textContent.startsWith("Plans")).textContent`),
      /2$/,
      "the tab counts what is listed"
    );

    await openPlanTile("Catalogue run");
    await pickMenuItem("Remove from calendar");
    assert.match((await textOf(".tl-dialog-warning"))[0] ?? "", /no longer in your COROS plans/, "the removal warns it is the last of it");
    assert.doesNotMatch((await textOf(".tl-dialog > p"))[0], /stays in your library/, "and does not promise otherwise");
    await harness("setScript", { getTrainingLibrarySnapshot: snapshotOf([takenOff, ranOut, outlived, copy]) });
    await evaluate(`Array.from(document.querySelectorAll(".tl-dialog footer button")).find((b) => b.textContent === "Duplicate first").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("duplicateTrainingPlan").map((call) => call.args[0])`),
      [outlived.id],
      "Duplicate first copies the run"
    );
    assert.equal(await count(".tl-dialog"), 0, "and the question goes with it");

    await evaluate(`document.querySelector(".plan-reader-close").click()`);
    await settle();
    await openPlanTile("Catalogue run");
    await pickMenuItem("Remove from calendar");
    await harness("setScript", {
      getTrainingLibrarySnapshot: snapshotOf([takenOff, ranOut, { ...outlived, calendar: "stopped" }, copy])
    });
    await evaluate(`document.querySelector(".tl-dialog footer .primary-button.danger").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("removeTrainingPlanFromCalendar").map((call) => call.args[0])`),
      [outlived.id]
    );
    assert.equal(await count(".plan-reader-title"), 0, "the reader closes on a plan the list no longer has");
    assert.equal(await gridOf("Catalogue run"), null, "and the run leaves the list");
    assert.notEqual(await gridOf("Catalogue run Copy"), null, "while the copy stays");
  }

  // -------------------------------------------------------------------------
  // 3c''-quater. Deleting a plan on the calendar takes it off first, and says so
  // -------------------------------------------------------------------------
  {
    const onCalendarPlan = templateOf(PLAN, { id: "coros:del-1", remoteId: "del-1", name: "Scheduled block", runningInstanceId: "run-1" });
    const idle = templateOf(PLAN, { id: "coros:del-2", remoteId: "del-2", name: "Idle block" });
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      { getTrainingLibrarySnapshot: snapshotOf([onCalendarPlan, idle]), getNativeTrainingPlan: null }
    );
    await openPlansTab();
    await openPlanTile("Scheduled block");
    await pickMenuItem("Delete");
    assert.match((await textOf(".tl-dialog-warning"))[0] ?? "", /on your COROS calendar/, "the deletion says the plan is on the calendar");
    assert.deepEqual(
      await textOf(".tl-dialog footer .primary-button.danger"),
      ["Remove from calendar and delete"],
      "and the button says both things it will do"
    );
    await harness("setScript", { getTrainingLibrarySnapshot: snapshotOf([idle]) });
    await evaluate(`document.querySelector(".tl-dialog footer .primary-button.danger").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("deleteTrainingPlan").map((call) => call.args)`),
      [[onCalendarPlan.id, true, { takeOffCalendar: true }]],
      "the service is told to take it off, which it otherwise refuses"
    );
    assert.ok((await calledBack()).includes("prop:onScheduleChanged"), "the calendar screen is told");
    assert.equal(await count(".plan-reader-title"), 0, "and the reader closes on the plan it deleted");

    await openPlanTile("Idle block");
    await pickMenuItem("Delete");
    assert.equal(await count(".tl-dialog-warning"), 0, "a plan off the calendar is deleted as before");
    assert.equal(
      /* offsetWidth: the dialog opens from scale(0.97), and a window without
         frames holds it there, so its bounding box reads 446px. */
      await evaluate(`document.querySelector(".tl-dialog").offsetWidth`),
      460,
      "a question whose answers fit keeps its 460px"
    );
    assert.deepEqual(await textOf(".tl-dialog footer .primary-button.danger"), ["Delete plan"]);
    await evaluate(`Array.from(document.querySelectorAll(".tl-dialog footer button")).find((b) => b.textContent === "Cancel").click()`);
    await settle();
  }

  // -------------------------------------------------------------------------
  // 3c''-quinquies. Saving a plan on the calendar asks whether the calendar follows
  // -------------------------------------------------------------------------
  {
    /*
     * The calendar runs COROS's own copy of a plan, which a save to the plan
     * does not touch. "Update the calendar copy" was a separate item that had
     * to be remembered; the save asks instead, and only for a plan with a copy
     * running.
     */
    const withPrograms = PLAN.entries.map(({ happenDay: _day, ...item }) => ({ ...item, corosProgram: { id: `p-${item.id}` } }));
    const scheduled = templateOf(PLAN, { id: "coros:cal-1", remoteId: "cal-1", name: "Base on calendar", runningInstanceId: "run-1", entries: withPrograms });
    const idle = templateOf(PLAN, { id: "coros:cal-2", remoteId: "cal-2", name: "Base off calendar", entries: withPrograms });
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      {
        getTrainingLibrarySnapshot: snapshotOf([scheduled, idle]),
        getNativeTrainingPlan: null,
        saveTrainingPlanToCoros: { ok: true, plan: scheduled },
        syncTrainingPlanToCalendar: null
      }
    );
    const renameAndSave = async (name) => {
      await pickMenuItem("Edit");
      await evaluate(
        `(() => { const input = document.querySelector(".plan-editor-name");
           Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(name)});
           input.dispatchEvent(new Event("input", { bubbles: true }));
           input.dispatchEvent(new Event("change", { bubbles: true }));
           input.blur(); })()`
      );
      await settle();
      await evaluate(
        `Array.from(document.querySelectorAll(".tl-plan-modal button")).find((b) => b.textContent.includes("Save to COROS")).click()`
      );
      await settle();
    };
    const calls = (method) => evaluate(`window.__harness.callCount(${JSON.stringify(method)})`);

    await openPlansTab();
    await openPlanTile("Base on calendar");
    await renameAndSave("Base on calendar v2");
    assert.deepEqual(await textOf(".tl-dialog h2"), ['"Base on calendar v2" is on your calendar'], "the save asks first");
    assert.deepEqual(
      await textOf(".tl-dialog footer button"),
      ["Keep editing", "Save plan only", "Save & update calendar"],
      "three answers: not yet, the plan alone, or the plan and the calendar"
    );
    assert.match((await textOf(".tl-dialog-warning"))[0] ?? "", /moved, edited or added on the calendar/, "and says what updating costs");
    const layout = await evaluate(
      `(() => {
         const dialog = document.querySelector(".tl-dialog");
         const buttons = Array.from(dialog.querySelectorAll("footer button"));
         const lines = (button) => { const range = document.createRange(); range.selectNodeContents(button);
           return new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size; };
         /* Layout sizes, not bounding boxes: the dialog opens from scale(0.97),
            and a window without frames holds it there. */
         const box = dialog.getBoundingClientRect();
         return { lines: buttons.map(lines), tops: buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
                  width: dialog.offsetWidth, inside: box.left >= 0 && box.right <= window.innerWidth,
                  prose: dialog.querySelector("p").offsetWidth };
       })()`
    );
    assert.deepEqual(layout.lines, [1, 1, 1], `every answer reads on one line: ${JSON.stringify(layout)}`);
    assert.equal(new Set(layout.tops).size, 1, "and the three stand in one row");
    assert.ok(layout.width > 460 && layout.inside, `the dialog widens to hold them and stays in the window, ${layout.width}px`);
    assert.ok(layout.prose <= layout.width - 40, "the prose wraps to that width rather than setting it");
    assert.equal(await calls("saveTrainingPlanToCoros"), 0, "nothing is written while it asks");

    /* Held open, so the screen can be read while each step runs. */
    await harness("setScript", { saveTrainingPlanToCoros: "__pending", syncTrainingPlanToCalendar: "__pending" });
    await evaluate(`Array.from(document.querySelectorAll(".tl-dialog footer button")).find((b) => b.textContent === "Save & update calendar").click()`);
    await settle();
    const footer = () =>
      evaluate(
        `Array.from(document.querySelectorAll(".tl-dialog footer button")).map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, busy: b.classList.contains("is-busy"), spinner: Boolean(b.querySelector(".is-spinning")), opacity: getComputedStyle(b).opacity }))`
      );
    let buttons = await footer();
    assert.equal(buttons.length, 3, "the question stays up while its answer is carried out");
    assert.deepEqual(
      buttons.map((b) => [b.text, b.disabled, b.busy, b.spinner]),
      [["Keep editing", true, false, false], ["Save plan only", true, false, false], ["Saving…", true, true, true]],
      "the chosen answer says it is saving, and nothing can be answered twice"
    );
    assert.equal(buttons[2].opacity, "1", "and it is not greyed with the rest");
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await settle();
    assert.equal(await count(".tl-dialog"), 1, "Escape does not walk away from a save in flight");

    await harness("resolvePending", "saveTrainingPlanToCoros", { ok: true, plan: scheduled });
    await settle();
    buttons = await footer();
    assert.equal(buttons[2]?.text, "Updating calendar…", "then that the calendar is being updated");
    await harness("resolvePending", "syncTrainingPlanToCalendar", null);
    await settle();
    assert.equal(await count(".tl-dialog"), 0, "and it goes when both are done");
    assert.equal(await calls("saveTrainingPlanToCoros"), 1);
    assert.deepEqual(
      await evaluate(`window.__harness.calls("syncTrainingPlanToCalendar").map((call) => call.args[0])`),
      [scheduled.id],
      "the plan is saved, then carried onto the calendar"
    );
    await harness("setScript", { saveTrainingPlanToCoros: { ok: true, plan: scheduled }, syncTrainingPlanToCalendar: null });
    assert.ok((await calledBack()).includes("prop:onScheduleChanged"), "the calendar screen is told");

    await renameAndSave("Base on calendar v3");
    await evaluate(`Array.from(document.querySelectorAll(".tl-dialog footer button")).find((b) => b.textContent === "Save plan only").click()`);
    await settle();
    assert.equal(await calls("saveTrainingPlanToCoros"), 2);
    assert.equal(await calls("syncTrainingPlanToCalendar"), 1, "Save plan only leaves the calendar alone");

    // A save refused as a conflict: its question carries the work the same way.
    await harness("setScript", { saveTrainingPlanToCoros: { ok: false } });
    await renameAndSave("Base on calendar v4");
    await evaluate(`Array.from(document.querySelectorAll(".tl-dialog footer button")).find((b) => b.textContent === "Save plan only").click()`);
    await settle();
    assert.deepEqual(await textOf(".tl-dialog h2"), ["This plan changed on COROS"], "the calendar question gives way to the conflict");
    await harness("setScript", { saveTrainingPlanToCoros: "__pending" });
    await evaluate(`Array.from(document.querySelectorAll(".tl-dialog footer button")).find((b) => b.textContent === "Replace with my edit").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`Array.from(document.querySelectorAll(".tl-dialog footer button")).map((b) => [b.textContent.trim(), b.disabled])`),
      [["Keep editing", true], ["Save as a new plan", true], ["Saving…", true]],
      "the overwrite says it is saving"
    );
    await harness("resolvePending", "saveTrainingPlanToCoros", { ok: true, plan: scheduled });
    await settle();
    assert.equal(await count(".tl-dialog"), 0);
    assert.equal(await calls("syncTrainingPlanToCalendar"), 1, "the plan-only answer holds through the conflict");

    await evaluate(`document.querySelector(".plan-reader-close").click()`);
    await settle();
    await harness("setScript", { saveTrainingPlanToCoros: { ok: true, plan: idle } });
    await openPlanTile("Base off calendar");
    await renameAndSave("Base off calendar v2");
    assert.equal(await count(".tl-dialog"), 0, "a plan off the calendar is saved without a question");
    assert.equal(await calls("saveTrainingPlanToCoros"), 5);
  }

  // -------------------------------------------------------------------------
  // 3c'''. Adding a plan to the calendar: a day, and what COROS will do with it
  // -------------------------------------------------------------------------
  {
    /*
     * COROS dates a plan from the Monday of the week the start day is in,
     * leaves off the sessions before the start, and never looks at what the
     * calendar holds. The dialog reads the preview on every day picked and
     * says both, before anything is written.
     */
    const template = templateOf(PLAN, { id: "coros:tpl-1", remoteId: "tpl-1", name: "Spring marathon" });
    const running = { ...PLAN, name: "Spring marathon" };
    const dayKey = (date) =>
      `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const monday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7)));
    const preview = (startDay, overrides = {}) => ({
      planId: template.id,
      startDay,
      anchorDay: "20991228",
      entries: [
        { entryId: "e-tempo", name: "Tempo 4 x 8", sport: "run", happenDay: "20991229", dropped: true, existing: [] },
        { entryId: "e-long", name: "Long run", sport: "run", happenDay: "21000103", dropped: false, existing: ["Club run"] },
        { entryId: "e-hills", name: "Hills", sport: "trailRun", happenDay: "21000112", dropped: false, existing: [] }
      ],
      blockers: [],
      ...overrides
    });
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      {
        getTrainingLibrarySnapshot: snapshotOf([template]),
        getNativeTrainingPlan: template,
        previewTrainingPlanCalendar: preview(monday),
        addTrainingPlanToCalendar: running
      }
    );
    await openPlansTab();
    await openPlanTile("Spring marathon");
    assert.equal(await count(".plan-calendar-mark"), 0, "a plan that is not on the calendar carries no mark");
    await evaluate(`document.querySelector(".plan-reader-add-calendar").click()`);
    await settle();

    assert.equal(await count(".plan-calendar-backdrop"), 1, "the calendar dialog opens");
    const [firstAsk] = await evaluate(`window.__harness.calls("previewTrainingPlanCalendar").map((call) => call.args)`);
    assert.deepEqual(
      firstAsk,
      [template.id, monday],
      "it opens on the next Monday, the day that keeps every session of week 1"
    );
    assert.equal(await evaluate(`window.__harness.callCount("addTrainingPlanToCalendar")`), 0, "and nothing is written by opening it");

    // A day in the middle of that week: the preview is read again for it.
    const asked = dayKey(new Date(Number(monday.slice(0, 4)), Number(monday.slice(4, 6)) - 1, Number(monday.slice(6)) + 2));
    await harness("setScript", { previewTrainingPlanCalendar: preview(asked) });
    await evaluate(`document.querySelector('.plan-calendar-dialog [data-day="${asked}"]').click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("previewTrainingPlanCalendar").at(-1).args[1]`),
      asked
    );

    assert.deepEqual(
      await textOf(".plan-calendar-summary small"),
      ["sessions to add", "Week 1 starts", "day already holds a workout"],
      "what goes on, from which Monday, and how many days it shares"
    );
    assert.deepEqual(await textOf(".plan-calendar-summary strong").then((values) => [values[0], values[2]]), ["2", "1"]);
    assert.equal(await count(".plan-calendar-dates article.is-dropped"), 1, "the session before the start is shown, struck out");
    assert.match((await textOf(".plan-calendar-safety"))[0], /left off/, "and said in words");
    assert.deepEqual(
      await textOf(".plan-calendar-dates small.has-conflict"),
      ["Also on this day: Club run"],
      "a day that already holds a workout names it"
    );
    assert.deepEqual(
      await textOf(".plan-calendar-dialog > footer .primary-button"),
      ["Add alongside them"],
      "and the button says what adding will do"
    );

    // What the reload after adding sees: the template, with its running copy.
    await harness("setScript", {
      getTrainingLibrarySnapshot: snapshotOf([{ ...template, runningInstanceId: running.remoteId }, running])
    });
    await evaluate(`document.querySelector(".plan-calendar-dialog > footer .primary-button").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("addTrainingPlanToCalendar").map((call) => call.args)`),
      [[template.id, asked]],
      "added from the day the preview was read for"
    );
    assert.ok((await calledBack()).includes("prop:onScheduleChanged"), "the calendar screen is told");
    assert.equal(await count(".plan-calendar-backdrop"), 0, "the dialog closes");
    const mark = await evaluate(
      `(() => {
         const mark = document.querySelector(".plan-reader-title h1 .plan-calendar-mark");
         const name = document.querySelector(".plan-reader-title h1");
         if (!mark) return null;
         return {
           label: mark.getAttribute("aria-label"),
           beforeName: mark === name.firstElementChild,
           color: getComputedStyle(mark).color,
           nameColor: getComputedStyle(name).color
         };
       })()`
    );
    assert.ok(mark, "the reader, still on the plan, now carries the calendar mark");
    assert.equal(mark.label, "On calendar", "named for a screen reader");
    assert.equal(await count(".plan-reader-add-calendar"), 0, "the button makes way");
    assert.deepEqual(
      await evaluate(
        `(() => { const node = document.querySelector(".plan-reader-actions > .plan-reader-scheduled"); return node ? { text: node.textContent.trim(), tag: node.tagName, last: node === node.parentElement.lastElementChild } : null; })()`
      ),
      { text: "On calendar", tag: "SPAN", last: true },
      "for a statement in the same place, which is not a control"
    );
    assert.ok(mark.beforeName, "to the left of the name");
    assert.notEqual(mark.color, mark.nameColor, "in the success ink, not the name's");

    // The way back. Carrying an edit over is asked when the edit is saved.
    await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
    await settle();
    assert.deepEqual(
      (await textOf(".plan-more-menu [role=menuitem]")).slice(0, 3),
      ["Edit", "Remove from calendar", "Duplicate"],
      "no separate item to update the calendar: saving an edit asks instead"
    );
    await evaluate(
      `Array.from(document.querySelectorAll(".plan-more-menu [role=menuitem]")).find((n) => n.textContent.includes("Remove from calendar")).click()`
    );
    await settle();
    const removeButton = await evaluate(
      `(() => {
         const button = document.querySelector(".tl-dialog footer .primary-button.danger");
         if (!button) return null;
         const style = getComputedStyle(button);
         const cancel = Array.from(document.querySelectorAll(".tl-dialog footer button")).find((b) => b.textContent === "Cancel");
         return { text: button.textContent.trim(), height: button.getBoundingClientRect().height, cancelHeight: cancel.getBoundingClientRect().height, radius: parseFloat(style.borderTopLeftRadius), cancelRadius: parseFloat(getComputedStyle(cancel).borderTopLeftRadius), image: style.backgroundImage };
       })()`
    );
    assert.ok(removeButton, "the removal is confirmed, with the screen's own destructive button");
    assert.equal(await count(".tl-dialog-warning"), 0, "a plan still on COROS is not warned about");
    assert.equal(removeButton.text, "Remove from calendar");
    assert.equal(removeButton.height, removeButton.cancelHeight, "it is sized like the Cancel beside it");
    assert.equal(removeButton.radius, removeButton.cancelRadius, "and rounded like it");
    assert.match(removeButton.image, /gradient/, "filled, as the delete confirmation is");
    await harness("setScript", { getTrainingLibrarySnapshot: snapshotOf([template]) });
    await evaluate(`document.querySelector(".tl-dialog footer .primary-button.danger").click()`);
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("removeTrainingPlanFromCalendar").map((call) => call.args[0])`),
      [template.id],
      "asked of the plan; the service finds its running copy"
    );
    assert.equal(await count(".plan-reader-title h1 .plan-calendar-mark"), 0, "and the mark goes with it");
    assert.equal(await count(".plan-reader-scheduled"), 0);
    assert.equal(await count(".plan-reader-add-calendar"), 1, "and the button comes back");

    // A preview that refuses the day holds the button down.
    await harness("setScript", {
      previewTrainingPlanCalendar: preview(monday, { blockers: ["This plan is already on the calendar."] })
    });
    await evaluate(`document.querySelector(".plan-reader-add-calendar").click()`);
    await settle();
    assert.deepEqual(await textOf(".plan-calendar-blockers p"), ["This plan is already on the calendar."]);
    assert.equal(
      await evaluate(`document.querySelector(".plan-calendar-dialog > footer .primary-button").disabled`),
      true,
      "what COROS would accept and get wrong is not offered"
    );
    await evaluate(`Array.from(document.querySelectorAll(".plan-calendar-dialog > footer button")).find((b) => b.textContent === "Cancel").click()`);
    await settle();
    assert.equal(await count(".plan-calendar-backdrop"), 0);
  }

  // -------------------------------------------------------------------------
  // 3c''''. On the index, a plan on the calendar is its template's tile
  // -------------------------------------------------------------------------
  {
    /*
     * A running copy is a plan of its own on COROS, but listing it beside the
     * plan it came from shows one plan twice. The copy folds into its
     * template's tile; one whose template is not in the list — applied from
     * the COROS app off a catalogue plan — stands on its own, and says it is
     * on the calendar either way.
     */
    const template = templateOf(PLAN, { id: "coros:tpl-1", remoteId: "tpl-1", name: "Spring marathon", runningInstanceId: "run-1" });
    const orphan = { ...PLAN, id: "coros:run-2", remoteId: "run-2", name: "Catalogue plan", sourcePlanId: "somewhere-else" };
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      { getTrainingLibrarySnapshot: snapshotOf([template, PLAN, orphan]), getNativeTrainingPlan: null }
    );
    await openPlansTab();
    assert.deepEqual(
      await evaluate(
        `Object.fromEntries(Array.from(document.querySelectorAll(".tl-card")).map((card) => [card.querySelector(".tl-card-name").textContent, card.querySelector(".tl-card-name .plan-calendar-mark")?.getAttribute("aria-label") ?? null]))`
      ),
      { "Spring marathon": "On calendar", "Catalogue plan": "On calendar" },
      "one tile per plan, and each on the calendar says so"
    );
    await openPlanTile("Catalogue plan");
    await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
    await settle();
    const items = await textOf(".plan-more-menu [role=menuitem]");
    assert.ok(items.includes("Remove from calendar"), "a running copy offers the way off");
    assert.equal(items.includes("Add to calendar"), false, "never a second run of the same plan");
    assert.equal(await count(".plan-reader-add-calendar"), 0, "not as a button either");
    assert.equal(items.includes("Update the calendar copy"), false, "and nothing to carry over: it is the copy");
  }

  // -------------------------------------------------------------------------
  // 3c'''''. Drafts: a new plan is a tile of its own, an edit marks its plan
  // -------------------------------------------------------------------------
  {
    /*
     * A draft is not listed apart any more. A new plan kept as a draft is a
     * tile among the plans, marked Draft, and opens the editor — there is
     * nothing on COROS to read. Edits kept for a plan mark that plan's tile
     * Editing; its one way into the editor becomes Continue editing, and its
     * ⋯ leads with Clear editing.
     */
    const edited = templateOf(PLAN, { id: "coros:ed-1", remoteId: "ed-1", name: "Edited plan" });
    const newDraft = {
      id: "draft:new-1",
      plan: { ...templateOf(PLAN), id: "draft:new-1", remoteId: undefined, remoteVersion: undefined, name: "Base block" },
      savedAt: "2026-02-21T00:00:00.000Z"
    };
    const editDraft = {
      id: "draft:ed",
      baseRemoteId: "ed-1",
      baseVersion: 2,
      plan: { ...edited, name: "Edited plan v2" },
      savedAt: "2026-02-22T00:00:00.000Z"
    };
    await harness(
      "mount",
      "TrainingLibraryView",
      { height: 900 },
      {
        getTrainingLibrarySnapshot: snapshotOf([edited], { drafts: [newDraft, editDraft] }),
        getNativeTrainingPlan: null
      }
    );
    await openPlansTab();
    assert.equal(await count(".tl-drafts"), 0, "no section of drafts apart from the plans");
    assert.deepEqual(
      await evaluate(
        `Object.fromEntries(Array.from(document.querySelectorAll(".tl-card")).map((card) => [card.querySelector(".tl-card-name").textContent, card.querySelector(".tl-draft-mark")?.textContent ?? null]))`
      ),
      { "Base block": "Draft", "Edited plan": "Editing" },
      "one tile per plan: the new plan's draft marked Draft, the edited plan marked Editing, and no tile for the edit"
    );

    await openPlanTile("Base block");
    assert.equal(await count(".tl-dialog-sheet.is-reader"), 0, "a draft opens no reader");
    assert.equal(
      await evaluate(`document.querySelector(".plan-editor-name")?.value ?? null`),
      "Base block",
      "it opens the editor, on the draft"
    );
    assert.ok(
      (await textOf(".plan-editor-bar-actions button")).includes("Discard draft"),
      "which is where a new plan's draft is let go of"
    );
    await evaluate(`document.querySelector('[aria-label="Close editor"]').click()`);
    await settle();

    await openPlanTile("Edited plan");
    assert.deepEqual(await textOf(".plan-reader-meta .tl-draft-mark"), ["Editing"], "the reader says so too");
    await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
    await settle();
    const items = await textOf(".plan-more-menu [role=menuitem]");
    assert.equal(items[0], "Clear editing", "the ⋯ leads with clearing the edit kept for this plan");
    assert.equal(items.includes("Continue editing"), false, "and does not offer a second way into the editor");
    assert.equal(items.includes("Edit"), false, "not even Edit: Continue editing, outside, is the one way in");
    await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
    await settle();
    assert.deepEqual(
      await evaluate(
        `(() => { const button = document.querySelector(".plan-reader-edit"); return { text: button.textContent.trim(), filled: button.classList.contains("primary-button") }; })()`
      ),
      { text: "Continue editing", filled: true },
      "Continue editing stands outside the ⋯, drawn filled because there is work to go back to"
    );

    await evaluate(`document.querySelector(".plan-reader-edit").click()`);
    await settle();
    assert.equal(
      await evaluate(`document.querySelector(".plan-editor-name")?.value ?? null`),
      "Edited plan v2",
      "Continue editing picks up the kept edit, not the plan on COROS"
    );
    await evaluate(`document.querySelector('[aria-label="Close editor"]').click()`);
    await settle();

    await pickMenuItem("Clear editing");
    assert.deepEqual(
      await textOf(".tl-dialog h2"),
      ['Clear your edits to "Edited plan v2"?'],
      "clearing asks first"
    );
    await evaluate(
      `Array.from(document.querySelectorAll(".tl-dialog button")).find((b) => b.textContent.includes("Clear editing")).click()`
    );
    await settle();
    assert.deepEqual(
      await evaluate(`window.__harness.calls("deleteTrainingPlanDraft").map((call) => call.args[0])`),
      ["draft:ed"],
      "and then deletes the draft, and nothing on COROS"
    );
  }

  // -------------------------------------------------------------------------
  // 3d. A running plan: past weeks fold, today is marked, the ridge jumps
  // -------------------------------------------------------------------------
  {
    /* Five weeks from 2 March, read on Wednesday of week 3. */
    const running = {
      ...PLAN,
      weekCount: 5,
      weekStages: [0, 1, 2, 3, 4].map((weekIndex) => ({ weekIndex, stage: weekIndex < 2 ? 2 : 3 }))
    };
    await mount({ plan: running, matches: MATCHES, today: "2026-03-18T09:00:00" });

    assert.equal(await count(".plan-week-card.is-folded"), 2, "weeks 1 and 2 are behind the reader");
    assert.deepEqual(
      await textOf(".plan-week-card.is-folded .plan-week-fold-outcomes"),
      ["1 done 1 missed", ""],
      "a folded week still says how it went"
    );
    assert.equal(await count(".plan-week-card.is-current"), 1);
    const today = await textOf(".plan-reader-day.is-today .plan-reader-day-label");
    assert.equal(today.length, 1, "one column is today");
    assert.ok(
      today[0].startsWith("Wed") && today[0].includes("18") && today[0].endsWith("Today"),
      `today's column is marked: ${today[0]}`
    );
    assert.ok(
      (await evaluate(`document.querySelector(".plan-reader").scrollTop`)) > 0,
      "the reader opens scrolled to this week, not to the top"
    );

    assert.equal(await count(".plan-ridge-week"), 5, "one bar per week, past two weeks");
    assert.equal(await count(".plan-ridge-week.is-current"), 1);
    assert.deepEqual(await textOf(".plan-ridge-stage"), ["Base", "Build"], "the stages run under their weeks");
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector('.plan-ridge-stage[data-stage="base"]')).color !== getComputedStyle(document.querySelector('.plan-ridge-stage[data-stage="build"]')).color`),
      true,
      "each stage takes its own ink"
    );

    await evaluate(`document.querySelector('.plan-ridge-week[aria-label^="Week 1"]').click()`);
    await settle();
    assert.equal(await count(".plan-week-card.is-folded"), 1, "jumping to a folded week opens it");
    assert.match(
      await evaluate(`document.activeElement?.textContent ?? ""`),
      /^Week 1/,
      "and puts focus on its heading"
    );

    // The ⋯ holds what a reader does not come to do; Escape closes it alone.
    await evaluate(`document.querySelector('[aria-label="More actions"]').click()`);
    await settle();
    assert.deepEqual(
      await textOf(".plan-more-menu [role=menuitem]"),
      ["Edit", "Remove from calendar", "Duplicate", "Archive", "Delete"],
      "Edit leads the ⋯, and taking the plan off the calendar is behind it with the rest"
    );
    assert.equal(
      await evaluate(`Array.from(document.querySelectorAll(".plan-more-menu [role=menuitem]")).find((n) => n.textContent === "Delete").disabled`),
      false,
      "a plan on the calendar can be deleted: the confirmation takes it off first"
    );
    assert.equal(
      await evaluate(`document.activeElement?.getAttribute("role")`),
      "menuitem",
      "opening the menu puts focus on its first item"
    );
    await evaluate(
      `document.querySelector(".plan-more-menu").dispatchEvent(
         new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
       )`
    );
    await settle();
    assert.equal(await count(".plan-more-menu"), 0, "Escape closes the menu");
    assert.equal(await count(".plan-reader"), 1, "and only the menu");
  }

  {
    /* A plan of two weeks is on screen whole; a ridge of two bars says nothing. */
    await mount({ plan: { ...PLAN, weekCount: 2 }, matches: MATCHES });
    assert.equal(await count(".plan-ridge"), 0);

    /* Reading a COROS plan in full: Edit and Duplicate wait for it. */
    await mount({ plan: PLAN, matches: MATCHES, loadingFull: true });
    assert.equal(
      (await menuItemState("Edit")).disabled,
      true,
      "a copy of the shallow plan would be the names without the sessions"
    );
  }

  // -------------------------------------------------------------------------
  // 4. Wide, a day is a column with its label on top; narrow, the list
  // -------------------------------------------------------------------------
  {
    /*
     * The column, not the window: the week switches on a container query over
     * its own card, so narrowing the mount is the honest test — and it needs
     * no window resize, which a Wayland session does not perform.
     */
    for (const width of [1400, 600]) {
      await mount({ plan: PLAN, matches: MATCHES, width });

      const row = await boxOf(".plan-reader-day:not(.is-empty)");
      const label = await boxOf(".plan-reader-day:not(.is-empty) .plan-reader-day-label");
      const entries = await boxOf(".plan-reader-day:not(.is-empty) .plan-reader-day-entries");
      assert.ok(row && label && entries, `the day must be laid out at ${width}px`);

      if (width > 900) {
        assert.ok(
          entries.top >= label.top + label.height - 1,
          "in a column the label heads its sessions"
        );
      } else {
        assert.ok(
          label.left + label.width <= entries.left + 1 || entries.top > label.top,
          "a narrow week is the list: the label beside its sessions, or above them below 900px"
        );
        assert.equal(
          await evaluate(
            `Array.from(document.querySelectorAll(".plan-reader-day.is-empty"))
               .filter((day) => getComputedStyle(day).display !== "none").length`
          ),
          0,
          "and a listed week leaves out the days with nothing in them"
        );
      }

      assert.ok(
        label.width > 0 && entries.width > 0,
        `neither part may collapse at ${width}px`
      );
      assert.ok(
        entries.left + entries.width <= row.left + row.width + 1,
        `the sessions must stay inside the day at ${width}px`
      );
    }
  }

  // -------------------------------------------------------------------------
  // 5. A plan not on the calendar says days; only a running one says dates
  // -------------------------------------------------------------------------
  {
    await resizeWindow(1400);
    await mount({ plan: templateOf(PLAN), matches: MATCHES });

    assert.deepEqual(
      await textOf(".plan-reader-day:not(.is-empty) .plan-reader-day-label"),
      ["Tue", "Sun", "Tue"],
      "with no start there is nothing to say but the day of the week"
    );
    assert.equal(
      await count(".plan-entry-status"),
      0,
      "and nothing is on the calendar, so no session has an outcome to report — " +
        "even though a match names the same idInPlan on the running copy"
    );
    assert.equal(
      await count(".plan-reader-fig-done"),
      0,
      "nor is there a compliance figure — 0% is the one number read as failure"
    );
  }

  // -------------------------------------------------------------------------
  // 6. The confirmation that replaced window.confirm
  // -------------------------------------------------------------------------
  {
    await harness("mount", "ConfirmDialog", {
      title: "Discard unsaved changes?",
      description: "Closing the editor throws them away.",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      danger: true
    });
    await settle();

    assert.equal(
      await harness("attr", ".tl-dialog", "role"),
      "alertdialog",
      "a question about losing work is an alert, not a plain dialog"
    );
    assert.equal(await harness("attr", ".tl-dialog", "aria-modal"), "true");
    assert.ok(
      await harness("attr", ".tl-dialog", "aria-describedby"),
      "the description has to be attached, or a screen reader gets the title alone"
    );

    /*
     * Cancel holds focus, not confirm. Every use of this warns about the
     * destructive answer, and opening with that button focused turns a
     * reflexive Enter into the thing the dialog exists to prevent.
     */
    assert.equal(
      await evaluate(
        `document.activeElement === document.querySelector(".tl-dialog .ghost-button")`
      ),
      true,
      "the safe button takes focus"
    );
    assert.deepEqual(
      await textOf(".tl-dialog footer button"),
      ["Keep editing", "Discard changes"],
      "and it is the one that keeps the work"
    );

    // Escape cancels; it is caught in the capture phase for the reason
    // PromptDialog catches it there.
    await evaluate(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`
    );
    await settle();
    assert.deepEqual(
      await calledBack(),
      ["prop:onCancel"],
      "Escape answers no, and answers it once"
    );

    // A mousedown inside must not dismiss: without stopPropagation it bubbles
    // to the backdrop, so selecting the text of the question would answer it.
    await harness("mount", "ConfirmDialog", { title: "Delete week 3?" });
    await settle();
    await evaluate(
      `(() => {
         document.querySelector(".tl-dialog h2").dispatchEvent(
           new MouseEvent("mousedown", { bubbles: true })
         );
         return true;
       })()`
    );
    await settle();
    assert.deepEqual(
      await calledBack(),
      [],
      "pressing on the question itself answers nothing"
    );

    await evaluate(
      `(() => {
         document.querySelector(".tl-dialog-backdrop").dispatchEvent(
           new MouseEvent("mousedown", { bubbles: true })
         );
         return true;
       })()`
    );
    await settle();
    assert.deepEqual(
      await calledBack(),
      ["prop:onCancel"],
      "pressing outside dismisses"
    );
  }

  // -------------------------------------------------------------------------
  // 6b. A tag is held to its length at the field, not at the save
  // -------------------------------------------------------------------------
  {
    /*
     * Both tag dialogs take one comma-separated line, so a limit enforced at
     * confirm time would have to refuse the whole line for one long entry in
     * it — and the entry it refused is the one the athlete cannot see a
     * reason for. `clampTagInput` runs on every keystroke instead, which is
     * why this is a mounted test rather than a call to the helper: what is
     * being asserted is that the field never holds more than the limit.
     */
    await harness("mount", "PromptDialog", {
      title: "Tag this workout",
      initialValue: "",
      sanitize: "tags",
      confirmLabel: "Save tags"
    });
    await settle();

    await harness(
      "setValue",
      ".tl-prompt-field input",
      "threshold intervals on the track"
    );
    await settle();
    assert.equal(
      await harness("value", ".tl-prompt-field input"),
      "threshold intervals",
      "a tag stops at 20 characters as it is typed, with no space left " +
        "hanging where the cut landed"
    );

    /* The limit is per tag, and the separator survives it. */
    await harness(
      "setValue",
      ".tl-prompt-field input",
      "base, a very long tag that runs past the limit, winter"
    );
    await settle();
    assert.equal(
      await harness("value", ".tl-prompt-field input"),
      "base, a very long tag that, winter",
      "each entry is held on its own, and the ones already short are untouched"
    );

    /* Typing a comma must not eat the space after it on the next keystroke. */
    await harness("setValue", ".tl-prompt-field input", "base, ");
    await settle();
    assert.equal(
      await harness("value", ".tl-prompt-field input"),
      "base, ",
      "nothing is trimmed while the line is still being typed"
    );
  }

  // -------------------------------------------------------------------------
  // 7. The Workouts tab: what the list shows, and what the pane beside it draws
  // -------------------------------------------------------------------------
  {
    await resizeWindow(1400);
    await harness("mount", "WorkoutWorkspace", { workouts: WORKOUTS }, WORKOUT_SCRIPT);
    await settle();
    /*
     * One layout. The tiles are gone, and with them the switch that chose
     * between the two: the list's rows carry the session shape the tiles
     * existed to draw, so a second layout said the same thing twice.
     */
    assert.equal(await count(".tl-layout-switch"), 0, "there is no layout switch");
    assert.equal(await count(".tl-catalog .tl-grid"), 0, "and no tile grid");

    /*
     * Three labels over three figures. The head this replaces said "Workout /
     * Total", where `Total` stood over the COROS volume string — the one
     * figure the program list gets wrong — so it named a column that was
     * lying. Labels, not controls: the list is in name order and nothing on
     * the screen changes it.
     */
    assert.deepEqual(
      await textOf(".tl-catalog .tl-index-head .tl-column-label"),
      ["Workout", "Exercises", "Sets"],
      "the list names what a workout is and the two figures COROS fills in on " +
        "a library row"
    );
    assert.equal(
      await count(".tl-catalog .tl-index-head button"),
      0,
      "and none of the three is a control"
    );
    assert.equal(
      await count(".tl-workout-row .tl-mark"),
      0,
      "and there is no select mark"
    );

    /*
     * One order — favourites first, then by name — with no control to change it.
     *
     * A dropdown over `Name`, `Duration` and `Training load` stood in the
     * header. Two of its three orders read a figure the list row answers `0`
     * for on every workout COROS holds — the detail that carries the real one
     * arrives a few rows at a time as tiles scroll in, so the list re-ordered
     * itself under the reader as it filled. The names in this fixture arrive
     * in a different order from the alphabet, so a list left as it came would
     * read differently here.
     */
    assert.equal(
      await count(".tl-filters .app-select-trigger"),
      0,
      "the sort dropdown is gone from the list header"
    );
    assert.deepEqual(
      await textOf("li.tl-workout-row .tl-row-name-text"),
      [...WORKOUTS]
        .sort(
          (left, right) =>
            Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)) ||
            left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
        )
        .map((workout) => workout.name),
      "and the rows are favourites first, then in name order"
    );

    // Same invariant as the plan row: one grid track per cell drawn.
    const cells = await evaluate(
      `(() => {
         const row = document.querySelector("li.tl-workout-row");
         return Array.from(row.children).filter(
           (child) => getComputedStyle(child).display !== "none"
         ).length;
       })()`
    );
    const tracks = await evaluate(
      `getComputedStyle(document.querySelector("li.tl-workout-row"))
         .gridTemplateColumns.split(" ").length`
    );
    assert.equal(cells, 3, "name, exercises and sets");
    assert.equal(tracks, cells, "and one track each, so nothing wraps to a second row");

    /*
     * Both figures come off the row the screen was handed, so they are on
     * screen in the first paint with nothing fetched — which also means this
     * holds in a window the compositor is not painting, unlike anything driven
     * by the shape queue's observer.
     */
    assert.deepEqual(
      await textOf("li.tl-workout-row:first-child .tl-fig"),
      ["6", "18"],
      "the row states its exercise count and its set count — the first row is " +
        "Threshold 4 x 8, the one favourite, ahead of the name order"
    );
    const rowCounts = await textOf("li.tl-workout-row .tl-fig:nth-of-type(1)");
    assert.ok(
      rowCounts.length >= 3 && rowCounts.every((value) => value !== "—"),
      `and every row has them without waiting for a detail, got ` +
        `${rowCounts.join(" | ")}`
    );

    /*
     * A name too long for its column ends in an ellipsis rather than being cut
     * flat. `text-overflow` acts on a block's own inline content, and the text
     * of a flex container is an anonymous flex item — so the rules that used to
     * sit on `.tl-row-name` clipped the name and said nothing about it.
     */
    const longName = await evaluate(
      `(() => {
         const texts = Array.from(
           document.querySelectorAll("li.tl-workout-row .tl-row-name-text")
         );
         const clipped = texts.find((text) => text.scrollWidth > text.clientWidth);
         if (!clipped) return { clipped: false, names: texts.length };
         const style = getComputedStyle(clipped);
         return {
           clipped: true,
           overflow: style.textOverflow,
           wrap: style.whiteSpace,
           inside:
             Math.round(clipped.getBoundingClientRect().right) <=
             Math.round(
               clipped.closest("li").getBoundingClientRect().right
             )
         };
       })()`
    );
    assert.equal(
      longName.clipped,
      true,
      "one fixture name has to be too long for its column, or this proves nothing"
    );
    assert.equal(longName.overflow, "ellipsis", "a long name ends in an ellipsis");
    assert.equal(longName.wrap, "nowrap", "on one line");
    assert.equal(longName.inside, true, "and stays inside its row");

    // -----------------------------------------------------------------------
    // The row being read is marked
    // -----------------------------------------------------------------------
    const rowBackground = (nth) =>
      evaluate(
        `getComputedStyle(document.querySelectorAll("li.tl-workout-row")[${nth}]).backgroundColor`
      );

    await harness("clickNth", ".tl-workout-row .tl-row-open", 1);
    await settle();

    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll("li.tl-workout-row")).findIndex(
           (row) => row.classList.contains("is-active")
         )`
      ),
      1,
      "the row that was clicked is the active one"
    );
    assert.notEqual(
      await rowBackground(1),
      await rowBackground(0),
      "and it is drawn differently from the rest. The class was on the row and " +
        "nothing declared it, so every row looked identical and the only way to " +
        "tell which workout the pane was showing was to read its name"
    );

    // -----------------------------------------------------------------------
    // The pane draws the Calendar's workout view, not a second one
    // -----------------------------------------------------------------------
    assert.equal(
      await count(".tl-reader .workout-view"),
      1,
      "the detail pane is the Calendar's own read-only workout view"
    );
    assert.equal(
      await count(".tl-reader .sched-hero"),
      1,
      "including its hero, which is where the sport and the figures live now"
    );
    assert.ok(
      (await textOf(".tl-reader .sched-structure")).join(" ").includes("Warm-up"),
      "and the shared step renderer underneath it"
    );
    assert.equal(
      await count(".tl-reader .tl-reader-metrics"),
      0,
      "the pane's own four-figure strip is gone — it was a second reading of " +
        "the same payload, and it cost a COROS round trip per selection to fill"
    );
    assert.equal(
      await count(".tl-reader-sport"),
      0,
      "and the sport is named once, in the hero, not again just above it"
    );

    // -----------------------------------------------------------------------
    // Duplicate is one button
    // -----------------------------------------------------------------------
    const duplicate = await textOf(".tl-reader-actions > button");
    assert.ok(
      duplicate.includes("Duplicate"),
      `the copy action is there: ${duplicate.join(" | ")}`
    );
    assert.ok(
      !duplicate.some((label) => label.includes("Duplicate as")),
      "it copies this workout in this workout's sport; changing sport belongs " +
        "in the editor, with every other property of a workout"
    );
    assert.equal(
      await count(".tl-reader-actions .app-select-trigger"),
      0,
      "so there is no sport picker bolted to it"
    );

    // -----------------------------------------------------------------------
    // The list and the pane share the width
    // -----------------------------------------------------------------------
    const list = await boxOf(".tl-catalog");
    const reader = await boxOf(".tl-reader");
    assert.ok(list && reader, "both halves must be laid out");
    /*
     * 40 / 60: the list is a name and three columns of figures, the pane beside
     * it draws the whole step structure. The pane was a fixed 392px rail first,
     * which is a sidebar's width, and then an even split.
     */
    const share = list.width / (list.width + reader.width);
    assert.ok(
      Math.abs(share - 0.4) < 0.01,
      `the list takes two fifths of the width, got ${(share * 100).toFixed(1)}% ` +
        `(${Math.round(list.width)}px against ${Math.round(reader.width)}px)`
    );
  }

  // -------------------------------------------------------------------------
  // 8. A row draws its own session shape, without being opened first
  // -------------------------------------------------------------------------
  {
    /*
     * The shape comb is fetched per workout by an IntersectionObserver that
     * queues ids and a second effect that drains the queue. The drain held a
     * `cancelled` flag raised by its own cleanup, and the queue growing is
     * what re-ran it — so the moment the observer reported a second tile, the
     * in-flight batch was abandoned, its results thrown away, the queue never
     * trimmed, and nothing left to re-trigger it. Every tile drew its load bar
     * instead of its shape for the life of the window, and the only thing that
     * ever filled one in was opening that workout, because the reader writes
     * its own shape on the way past.
     *
     * A screen of tiles reports in more than one callback, so this is the
     * ordinary case rather than a corner.
     */
    await resizeWindow(1400);
    assert.ok(
      await hasFrames(),
      "this window is not being painted, so its IntersectionObserver will " +
        "never fire and no tile can queue its shape. That is the environment, " +
        "not the screen — measured on GNOME Wayland, where a hidden window " +
        "gets no rendering opportunity at all. Run this suite where the " +
        "compositor paints one"
    );
    await harness("mount", "WorkoutWorkspace", { workouts: MANY_WORKOUTS }, WORKOUT_SCRIPT);
    await settle();

    assert.equal(
      await count(".tl-workout-row.tl-row"),
      MANY_WORKOUTS.length,
      "every workout gets a row"
    );
    /*
     * No select mark on a row. A selection could once be made in tiles only,
     * so every bulk action was reachable from half the screen — which is what
     * took the mark, the bulk toolbar and the JSON export. Tagging and
     * deleting are the reader's, where the workout they act on is on screen.
     */
    assert.equal(await count(".tl-row .tl-mark"), 0, "no checkbox on a row");
    assert.equal(await count(".tl-bulk"), 0, "so there is no bulk toolbar to reach");

    /*
     * Scroll while the first batches are in flight. This is the whole point of
     * the fixture: it makes the observer report a second time mid-flight,
     * which is the moment the old drain abandoned its batch and left the queue
     * standing. A library that fits on one screen never reaches that state.
     */
    for (let pass = 0; pass < 6; pass += 1) {
      await harness("scrollTo", ".tl-catalog .tl-index", pass * 420);
      await evaluate("new Promise((resolve) => setTimeout(resolve, 30))");
    }
    await harness("scrollTo", ".tl-catalog .tl-index", 99_999);

    /*
     * Nothing has been clicked. `activeId` defaults to the first workout, so
     * that one would draw a shape either way — the other rows are the test.
     */
    const combs = await waitForCount(".tl-row-shape[role='img']", MANY_WORKOUTS.length);
    assert.equal(
      combs,
      MANY_WORKOUTS.length,
      `every row draws its own shape without being opened, got ${combs} of ` +
        `${MANY_WORKOUTS.length}. A number short of the full set is the drain ` +
        "stalling: the batch in flight when the queue grew was abandoned, its " +
        "shapes discarded and its ids never trimmed, leaving nothing to re-run it"
    );

    /*
     * An overview, not a chart: a few pixels high, and the same height on
     * every row, because the slot is drawn before the detail lands — a line
     * that appeared on some rows and not others would move each row under it.
     */
    const lineHeights = JSON.parse(
      await evaluate(
        `JSON.stringify(
           Array.from(document.querySelectorAll(".tl-row-shape")).map(
             (node) => Math.round(node.getBoundingClientRect().height)
           )
         )`
      )
    );
    assert.ok(
      lineHeights.length === MANY_WORKOUTS.length &&
        new Set(lineHeights).size === 1 &&
        lineHeights[0] > 0 &&
        lineHeights[0] <= 8,
      `every row's shape is one thin line of one height, got ` +
        `${[...new Set(lineHeights)].join(", ")}px`
    );

    /*
     * Every workout asked about, and no runaway.
     *
     * Distinct ids rather than a call count: this page runs in StrictMode, so
     * the reader's own effect is deliberately double-invoked and the workout
     * it opens with is fetched twice. That is the harness, not the screen —
     * what the screen must not do is ask about a workout over and over, which
     * is what a queue that restarts without trimming itself would look like.
     */
    const asked = await evaluate(
      `JSON.stringify(
         window.__harness.calls()
           .filter((call) => call.method === "getWorkoutForEdit")
           .map((call) => call.args[0].programId)
       )`
    );
    const ids = JSON.parse(asked);
    assert.deepEqual(
      [...new Set(ids)].sort(),
      MANY_WORKOUTS.map((workout) => workout.id).sort(),
      "every workout is asked about"
    );
    assert.ok(
      ids.length <= MANY_WORKOUTS.length + 1,
      `and asked about once each, give or take StrictMode's second reader ` +
        `pass: ${ids.length} requests for ${MANY_WORKOUTS.length} workouts`
    );

    /*
     * A tag is a chip: a hairline pill, not a word in a line of words joined
     * by dots. The fixture's workouts carry one tag each.
     */
    const chip = JSON.parse(
      await evaluate(
        `(() => {
           const tag = document.querySelector(".tl-row-sub em");
           if (!tag) return "null";
           const style = getComputedStyle(tag);
           return JSON.stringify({
             border: parseFloat(style.borderTopWidth),
             radius: parseFloat(style.borderTopLeftRadius),
             separator: getComputedStyle(tag, "::before").content
           });
         })()`
      )
    );
    assert.ok(chip, "a fixture row draws its tag");
    assert.ok(
      chip.border >= 1 && chip.radius >= 6,
      `the tag is drawn as a bordered chip: ${JSON.stringify(chip)}`
    );
    assert.ok(
      chip.separator === "none" || chip.separator === "normal",
      `with no dot drawn before it: ${chip.separator}`
    );
  }

  // -------------------------------------------------------------------------
  // 9. The header belongs to the list; the hero carries the workout's own facts
  // -------------------------------------------------------------------------
  {
    await harness("mount", "WorkoutWorkspace", { workouts: WORKOUTS }, WORKOUT_SCRIPT);
    await settle();

    const filters = await boxOf(".tl-filters");
    const catalog = await boxOf(".tl-catalog");
    const reader = await boxOf(".tl-reader");
    assert.ok(filters && catalog && reader, "the tab must be laid out");
    /*
     * The header is the list's, not the screen's. It spanned both panes for a
     * phase, which laid the filter chips and the search out over the reader as
     * well — controls that narrow a list, sitting above the pane the list
     * opens.
     */
    assert.equal(
      await count(".tl-catalog > .tl-filters"),
      1,
      "the control row is a child of the list column"
    );
    assert.ok(
      Math.abs(filters.width - catalog.width) <= 2,
      `and it is the width of that column, not of the screen: header ` +
        `${Math.round(filters.width)}px against a list of ${Math.round(catalog.width)}px`
    );
    assert.ok(
      filters.left < reader.left,
      "so it stops where the detail pane begins"
    );
    assert.ok(
      filters.height <= 60,
      `one line tall at rest, with everything in it folded: ` +
        `${Math.round(filters.height)}px. It wraps only while a control is open`
    );

    // --- the chips and the search are folded until they are reached for ----
    assert.equal(
      await evaluate(
        `document.querySelector(".tl-chips")?.dataset.open ?? null`
      ),
      "false",
      "the filter chips are collapsed to the chosen one"
    );
    assert.equal(
      await count(".tl-chips .option-group-trigger"),
      1,
      "so one chip is on screen, and it is the lead"
    );
    /*
     * **The open row holds every option in its declared order, and the chosen
     * chip does not move on the way there.**
     *
     * The order is the invariant: a version of this lifted the chosen option
     * out of the row so that nothing could possibly move, and the cost was an
     * open row that no longer read in the order it was given.
     *
     * So the movement is what gets fixed around it, and the reading below
     * compares two different elements — the label the athlete sees before the
     * click (the lead) against the label they see after it (that option's own
     * chip in the row). Measuring the lead in both states proves nothing: it
     * is clipped to nothing once the row is open and agrees with itself
     * whatever the row does.
     *
     * Two things moved it, and both are gone: the row's labels arrived from
     * `translateX(-5px)`, a 5px shove to the right at the end of every open,
     * and the group's own 2px gap between the lead and the row put the row's
     * first chip 2px further along than the lead it replaced.
     *
     * `data-open` is React state, so the two readings need a render between
     * them — a click and a measure in one expression sees only the first.
     */
    const xOf = (selector) =>
      evaluate(
        `(() => {
           const node = document.querySelector(${JSON.stringify(selector)});
           return node ? +node.getBoundingClientRect().x.toFixed(1) : null;
         })()`
      );
    const groupWidth = () =>
      evaluate(
        `Math.round(document.querySelector(".tl-chips").getBoundingClientRect().width)`
      );
    /*
     * **The chosen chip is at the same pixel folded and open — and all the way
     * between, which is the part the two ends alone do not prove.**
     *
     * There is one copy of each option: the group's own width is the fold,
     * animating from the chosen chip's width to the row's, and the row is slid
     * so the chosen chip sits at the left edge while folded. Two earlier
     * shapes moved it. The row's labels arrived from `translateX(-5px)`, a 5px
     * shove to the right at the end of every open. And the chosen option was
     * drawn twice — a lead chip collapsing while the row grew — so the row's
     * copy slid the lead's whole width to the left underneath a copy of itself
     * being clipped away; the two ends could be lined up and the path between
     * them could not. The `--og-shift` reading below is what covers the path:
     * at zero the row never moves, so nothing is left that could travel.
     *
     * Remounted with the stored scope cleared, because the claim only holds
     * while the chosen option is the first one — a later one legitimately
     * travels to its own place in the order, and the scope is a stored
     * preference an earlier section may have left pointing elsewhere.
     */
    /* Every stored selection, by prefix: `selectionPreferences` keys them
       under `coroslink.selection.v1`, so removing the bare preference name
       removes nothing and the mount comes up on whatever was last chosen. */
    await evaluate(
      `(() => {
         for (const key of Object.keys(localStorage)) {
           if (key.startsWith("coroslink.selection.v1")) localStorage.removeItem(key);
         }
         return true;
       })()`
    );
    await harness("mount", "WorkoutWorkspace", { workouts: WORKOUTS }, WORKOUT_SCRIPT);
    await settle();
    await evaluate(
      `(() => {
         const style = document.createElement("style");
         style.textContent =
           "*,*::before,*::after{transition:none !important;animation:none !important}";
         document.head.appendChild(style);
         return true;
       })()`
    );
    await settle();
    const chosenLabel = '.tl-chips [aria-checked="true"] .option-group-label';
    assert.deepEqual(
      await textOf(chosenLabel),
      ["All"],
      "the chosen option is the first one"
    );
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector(".tl-chips"))
           .getPropertyValue("--og-shift").trim()`
      ),
      "0px",
      "so the row needs no slide at all — which is what makes the chip sit " +
        "still for the whole of the open rather than only at its two ends"
    );

    const foldedX = await xOf(chosenLabel);
    const foldedWidth = await groupWidth();

    await harness("clickNth", ".tl-chips .option-group-trigger", 0);
    await settle();

    const openChips = await textOf(".tl-chips .option-group-rest button");
    assert.equal(openChips[0], "All", "the open row still leads with All");
    assert.ok(
      openChips.length >= 2,
      `and holds every option beside it: ${openChips.join(", ")}`
    );
    const openedX = await xOf(chosenLabel);
    assert.ok(
      foldedX !== null && openedX !== null,
      "both the folded chip and its place in the open row must be on screen"
    );
    assert.deepEqual(
      await textOf('.tl-chips .option-group-rest [aria-checked="true"]'),
      ["All"],
      "All is the chosen option, and it sits in the row rather than beside it"
    );
    assert.ok(
      Math.abs(openedX - foldedX) < 1,
      `and the chosen chip is at the same pixel in both: ${foldedX} then ${openedX}`
    );
    assert.ok(
      (await groupWidth()) > foldedWidth + 60,
      `with the row beside it doing the growing, from ${foldedWidth}px`
    );

    await evaluate("document.body.click()");
    await settle();


    // --- the create button floats in the list's corner, clear of the rows --
    const create = await boxOf(".tl-catalog-new");
    assert.ok(create, "the create button must be laid out");
    assert.ok(
      create.left - catalog.left < 40 &&
        catalog.top + catalog.height - (create.top + create.height) < 40,
      `it floats in the bottom-left of the list column, got ` +
        `${Math.round(create.left - catalog.left)}px in from the left and ` +
        `${Math.round(catalog.top + catalog.height - (create.top + create.height))}px up from the bottom`
    );
    assert.equal(
      await count(".tl-filters .tl-catalog-new"),
      0,
      "and not in the header, where it set the height of the row"
    );
    /*
     * The scroll area carries the button's height as bottom padding, or the
     * last row of a long list can be scrolled to and still sit under it with
     * nowhere further to go.
     */
    const clearance = await evaluate(
      `(() => {
         const list = document.querySelector(".tl-catalog > .tl-index");
         if (!list) return null;
         const button = document.querySelector(".tl-catalog-new");
         return {
           padding: parseFloat(getComputedStyle(list).paddingBottom),
           button: Math.round(button.getBoundingClientRect().height)
         };
       })()`
    );
    assert.ok(
      clearance && clearance.padding >= clearance.button,
      `the list leaves room under its last row for the button: ` +
        `${clearance?.padding}px of padding for a ${clearance?.button}px button`
    );

    // --- the hero leads with the name, the sport is its subtitle -----------
    assert.deepEqual(
      await textOf(".tl-reader .sched-hero-name"),
      ["Easy hour"],
      "the workout's name is the title of the pane"
    );
    assert.equal(
      await count(".tl-reader .sched-hero-sport"),
      0,
      "so the sport is not also the heading"
    );
    assert.ok(
      (await textOf(".tl-reader .sched-hero-context"))[0].startsWith("Run"),
      "it is the subtitle under the name"
    );
    assert.equal(
      await count(".tl-reader-scroll > header"),
      0,
      "the pane's own title block is gone — with the hero naming the workout, " +
        "it drew the name twice"
    );

    /*
     * The three things this screen knows about a workout that the Calendar
     * does not, each in the hero rather than stacked in blocks below the
     * steps: the favourite in its corner, the tags on the sport's own line,
     * and where else it is used as the hero's last line.
     */
    assert.equal(
      await count(".tl-reader .sched-hero-aside > .tl-reader-favorite"),
      1,
      "the favourite toggle is in the hero's top-right corner"
    );
    assert.equal(
      await count(".tl-reader .sched-hero-heading .tl-reader-favorite"),
      0,
      "not on the name's line, where it took the width the name wraps in"
    );
    assert.deepEqual(
      await textOf(".tl-reader .sched-hero-context .tl-reader-tags li"),
      ["base"],
      "the tags ride beside the sport"
    );
    /*
     * And nothing anywhere claims to know where else the workout is used.
     *
     * "Not referenced by a plan or a calendar day" was a constant: both counts
     * matched this workout's COROS program id against other records, and
     * neither match can land — nothing in the app writes a plan entry's
     * `programId` from a library workout, and COROS stores a scheduled workout
     * as a copy under an id of its own. So the line said the same thing about
     * every workout in every library, and the `Most used` sort ordered by one
     * constant. Both are gone rather than left saying it.
     */
    assert.equal(
      await count(".tl-reader-references"),
      0,
      "the reference line is gone"
    );
    assert.equal(
      (await textOf(".tl-catalog")).join(" ").includes("Unused"),
      false,
      "and no tile claims the workout is unused"
    );


    // --- one action row, and scheduling folded into it ---------------------
    /*
     * The dock is one row. Scheduling had a second above it — an icon, a
     * heading, a date field and a button, standing open across the whole dock
     * for a decision that is made once and then not again.
     */
    assert.equal(
      await count(".tl-reader-schedule"),
      0,
      "the standing schedule row is gone from the dock"
    );
    assert.equal(
      await count(".tl-reader-dock > *"),
      1,
      "and the dock is the action row alone"
    );
    assert.equal(
      await count(".tl-schedule-pop-panel"),
      0,
      "the date is folded until it is asked for"
    );

    const actions = await evaluate(
      `Array.from(document.querySelectorAll(".tl-reader-actions > *")).map(
         (node) => {
           const box = node.getBoundingClientRect();
           return {
             label: (node.tagName === "BUTTON" ? node : node.querySelector("button"))
               /* Doubled: this is a template literal, where a lone \s is an
                  "s" — the regex arrived as /s+/ and read "Tags" as "Tag". */
               .textContent.replace(/\\s+/g, " ").trim(),
             top: Math.round(box.top),
             width: Math.round(box.width)
           };
         }
       )`
    );
    assert.deepEqual(
      actions.map((action) => action.label),
      ["Schedule", "Edit", "Tags", "Duplicate", "Delete"],
      "five actions, Schedule leading the row and Delete still apart at the end"
    );
    const editLook = await evaluate(
      `(() => { const buttons = Array.from(document.querySelectorAll(".tl-reader-actions > button"));
         const edit = buttons.find((b) => b.textContent.trim() === "Edit");
         const tags = buttons.find((b) => b.textContent.trim() === "Tags");
         return { ghost: edit.classList.contains("ghost-button"), filled: edit.classList.contains("primary-button"),
                  ink: getComputedStyle(edit).color, tagsInk: getComputedStyle(tags).color }; })()`
    );
    assert.equal(editLook.ghost && !editLook.filled, true, "Edit is the quiet button the plan reader's was, not a filled one");
    assert.notEqual(editLook.ink, editLook.tagsInk, "a step ahead of the muted three beside it");
    const tops = actions.map((action) => action.top);
    assert.ok(
      Math.max(...tops) - Math.min(...tops) < 6,
      `all five on one row, tops at ${tops.join(", ")}`
    );

    /*
     * Opened, it is a month of days rather than a text field.
     *
     * A native `<input type="date">` stood here: the platform draws its picker,
     * and the field itself says nothing about the week a session would land in
     * — which is the thing being decided. The grid is `monthGridWeeks`, the
     * same rows the calendar screen uses, so five whole weeks cover a month.
     */
    assert.equal(
      await harness("clickText", ".tl-schedule-pop > button", "Schedule"),
      true,
      "the trigger has to open it"
    );
    await settle();
    assert.equal(await count(".tl-schedule-pop-panel"), 1, "the panel is open");
    assert.equal(
      await count(".tl-schedule-pop-panel input[type=\"date\"]"),
      0,
      "and it is not a text field"
    );
    assert.ok(
      (await count(".tl-daypick-day")) % 7 === 0,
      "the month comes in whole weeks"
    );
    assert.equal(
      (await textOf(".tl-daypick-day.is-selected")).length,
      1,
      "exactly one day is chosen"
    );
    assert.equal(
      (await textOf(".tl-daypick-day.is-today")).length,
      1,
      "and today is marked, because it is what the athlete counts from"
    );
    /*
     * Nothing already spent can be chosen. Asserted against the day rather
     * than against a count of greyed-out cells, which depends on where in the
     * month the suite happens to run.
     */
    const now = new Date();
    const todayKey =
      `${now.getFullYear()}` +
      `${String(now.getMonth() + 1).padStart(2, "0")}` +
      `${String(now.getDate()).padStart(2, "0")}`;
    const choosable = await evaluate(
      `Array.from(
         document.querySelectorAll(".tl-daypick-day:not(:disabled)")
       ).map((node) => node.dataset.day)`
    );
    assert.ok(choosable.length > 0, "some day has to be choosable");
    assert.ok(
      choosable.every((day) => day > todayKey),
      `and none of them is today or earlier (${todayKey}): ${choosable.slice(0, 3).join(", ")}`
    );
    /*
     * Upward and inside the reader. The dock is the bottom edge of the pane,
     * so a panel opening downward would hang off the window, and the trigger
     * leads the row, so the panel is pinned to its left.
     */
    const panel = await evaluate(
      `(() => {
         const panel = document.querySelector(".tl-schedule-pop-panel").getBoundingClientRect();
         const trigger = document.querySelector(".tl-schedule-pop > button").getBoundingClientRect();
         const reader = document.querySelector(".tl-reader").getBoundingClientRect();
         return {
           above: panel.bottom <= trigger.top,
           aligned: Math.abs(panel.left - trigger.left) < 1,
           inside: panel.top >= reader.top && panel.right <= reader.right + 1
         };
       })()`
    );
    assert.deepEqual(
      panel,
      { above: true, aligned: true, inside: true },
      "the panel opens upward from its trigger and stays inside the reader"
    );

    /* Escape folds it, and it is taken in the capture phase so a dialog
       listening on `document` does not close with it. */
    await evaluate(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`
    );
    await settle();
    assert.equal(await count(".tl-schedule-pop-panel"), 0, "Escape folds it again");

    /*
     * Duplicate is the width of its own label. It was stretched by a `1fr`
     * track left behind when its sport picker was retired, so it ran to the
     * end of the row while the three beside it sat at their text width.
     */
    const duplicate = actions.find((action) => action.label === "Duplicate");
    const tags = actions.find((action) => action.label === "Tags");
    assert.ok(
      duplicate.width < tags.width * 2.2,
      `Duplicate keeps to its content, got ${duplicate.width}px against ` +
        `${tags.width}px for Tags`
    );
  }

  // -------------------------------------------------------------------------
  // 10. Nothing was logged on the way
  // -------------------------------------------------------------------------
  {
    const errors = await harness("consoleErrors");
    assert.deepEqual(errors, [], `the reader logged: ${errors.join(" | ")}`);
  }

  console.log(
    "library renderer tests passed — plan items draw as plan items, the " +
      "workout list heads its own column, its figures come off the detail " +
      "rather than the list row, and the hero carries the workout's own facts"
  );
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
