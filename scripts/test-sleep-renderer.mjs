// The Sleep screen's night curve, mounted for real in Electron's Chromium.
//
// Two things about picking a night, neither of which type-checks and neither of
// which a main-process test can see:
//
// - **The curve's box must not shrink while a night's samples are on their
//   way.** The three states are three sizes — a chart is 210px of plot plus its
//   heading, an answered "no samples" is a short dashed strip — so swapping
//   through the short one on the way between two charts dropped the detail pane
//   156px and sprang it back, measured at 7–12 ms, on every single selection.
// - **A night this screen has already been shown must not be asked for
//   again.** The main process serves a settled night out of `sleep_night_series`
//   in a few milliseconds, so the round trip bought nothing and cost exactly
//   that flash — including when the athlete clicked back onto the night that
//   had just been on screen.
// - **The Naps tile's hover note has to carry what the tile could not fit, and
//   stay inside the row.** COROS sends a window per nap, so a day of several is
//   a list; the tile has room for a count. And the tiles are an `auto-fit` grid,
//   so a note anchored to the wrong side of the last one in a row hangs off the
//   panel.
//
// Layout is asserted in a hidden window, which lays out but does not paint.
// Every transition is frozen before anything is measured.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const DAYS = ["20260916", "20260915", "20260914"];

function night(happenDay, extra = {}) {
  return {
    happenDay,
    kind: "main",
    completeness: "complete",
    score: 61,
    totalMinutes: 400,
    deepMinutes: 60,
    lightMinutes: 260,
    remMinutes: 80,
    awakeMinutes: 30,
    deepPercent: 14,
    lightPercent: 60,
    remPercent: 19,
    awakePercent: 7,
    windowMinutes: 430,
    sleepStart: "23:30",
    sleepEnd: "06:40",
    napMinutes: 0,
    ...extra
  };
}

/**
 * The middle night carries two naps, the shape that has nowhere to go on the
 * tile. The clocks are the ones COROS sent for 2026-09-15, whose two windows
 * sum to its reported 4h 38m total exactly.
 */
const TWO_NAPS = {
  napMinutes: 278,
  napWindows: [
    { start: "00:19", end: "02:20", startDay: "20260915", endDay: "20260915" },
    { start: "05:05", end: "07:42", startDay: "20260915", endDay: "20260915" }
  ],
  napStart: "00:19",
  napEnd: "02:20"
};

const SNAPSHOT = {
  records: DAYS.map((day, index) =>
    night(day, {
      sleepStart: `2${index}:00`,
      sleepEnd: `0${index + 4}:30`,
      ...(index === 1 ? TWO_NAPS : {})
    })
  ),
  mcpState: "ready",
  source: "cache",
  fetchedAt: Date.UTC(2026, 8, 16, 8, 0)
};

/**
 * A night's samples. The window is stated rather than inferred so each night's
 * curve heading reads differently — that heading is how the driver tells which
 * night is on screen without trusting the order of anything.
 */
function series(happenDay, hourOfDay) {
  const base = Date.UTC(2026, 8, 16, hourOfDay, 0);
  const points = Array.from({ length: 12 }, (_value, index) => ({
    at: base + index * 600_000,
    localAt: base + index * 600_000,
    clock: "00:00",
    value: 50 + index
  }));

  return {
    happenDay,
    hrv: points,
    stress: points,
    windowStart: base,
    windowEnd: base + 11 * 600_000,
    source: "cache",
    mcpState: "ready"
  };
}

let win;

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return win.webContents
    .executeJavaScript(`window.__harness.${method}(${list})`, true)
    .catch((error) => {
      throw new Error(`harness ${method} failed: ${error.message}`);
    });
}

async function waitFor(read, what, timeoutMs = 8_000) {
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
  for (let pass = 0; pass < 4; pass += 1) {
    await win.webContents.executeJavaScript(
      "new Promise((resolve) => setTimeout(resolve, 50))",
      true
    );
  }
}

/** Answers the night request the screen is currently waiting on. */
async function answerSeries(happenDay, hourOfDay) {
  await waitFor(
    () => harness("exists", ".sleep-curve.is-empty"),
    `the curve waits for ${happenDay}`
  );
  assert.equal(
    await harness("resolvePending", "getSleepNightSeries", series(happenDay, hourOfDay)),
    true,
    `a request for ${happenDay} was in flight to answer`
  );
  await waitFor(
    () => harness("exists", ".sleep-curve-title"),
    `${happenDay} draws its curve`
  );
  await settle();
}

/** One metric tile by its label, with whatever its hover note holds. */
async function tileNamed(label) {
  return harness("metricTile", label);
}

async function selectNight(happenDay) {
  const rows = await harness("count", ".sleep-night-row");
  const index = DAYS.indexOf(happenDay);
  assert.ok(index >= 0 && index < rows, `night ${happenDay} is in the list`);
  assert.equal(await harness("clickNth", ".sleep-night-row", index), true);
  await settle();
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: { backgroundThrottling: false }
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");
  assert.equal(await harness("freezeAnimations"), true);

  // A stated column width, not the window's: the metric tiles are an `auto-fit`
  // grid, so this is what decides how many land in a row and which one sits at
  // the edge a hover note can be pushed off.
  await harness("mount", "SleepDetailsView", { width: 1000 }, {
    getSleepHistory: SNAPSHOT,
    // Held open so the driver decides when a night's samples land, which is the
    // only way to measure what the screen looks like *while* it waits.
    getSleepNightSeries: "__pending"
  });
  await waitFor(() => harness("appStylesReady"), "the app stylesheet loads");
  await waitFor(
    async () => (await harness("count", ".sleep-night-row")) === DAYS.length,
    "the nights arrive"
  );

  // The newest night is selected for the athlete, so the first wait is already
  // on screen. Nothing has been drawn yet, so the box is whatever CSS says.
  await answerSeries(DAYS[0], 22);
  const chart = await harness("rect", ".sleep-curve");
  assert.ok(chart.height > 200, `a drawn curve is a tall box, got ${chart.height}px`);

  // -------------------------------------------------------------------------
  // 1. Waiting for the next night holds the box open
  // -------------------------------------------------------------------------
  await selectNight(DAYS[1]);
  assert.equal(
    await harness("exists", ".sleep-curve.is-empty"),
    true,
    "the second night has to be fetched, so the curve says it is waiting"
  );
  const waiting = await harness("rect", ".sleep-curve");
  assert.equal(
    waiting.height,
    chart.height,
    `the waiting box keeps the drawn box's height (was ${waiting.height}px against ${chart.height}px)`
  );
  assert.equal(
    await harness("attr", ".sleep-curve", "aria-busy"),
    "true",
    "and says it is busy rather than empty"
  );

  await answerSeries(DAYS[1], 1);
  assert.equal((await harness("rect", ".sleep-curve")).height, chart.height);

  // -------------------------------------------------------------------------
  // 2. A night already seen is not asked for again
  // -------------------------------------------------------------------------
  const secondTitle = await harness("text", ".sleep-curve-title");
  await harness("clearCalls");
  await selectNight(DAYS[0]);

  assert.equal(
    await harness("callCount", "getSleepNightSeries"),
    0,
    "the first night was answered once and is still answered"
  );
  assert.equal(
    await harness("exists", ".sleep-curve.is-empty"),
    false,
    "so nothing ever said it was loading"
  );
  const backTitle = await harness("text", ".sleep-curve-title");
  assert.notEqual(backTitle, secondTitle, "and the curve is the first night's again");
  assert.equal((await harness("rect", ".sleep-curve")).height, chart.height);

  // Back to the second, also from memory: the cache holds every night seen, not
  // just the last one.
  await harness("clearCalls");
  await selectNight(DAYS[1]);
  assert.equal(await harness("callCount", "getSleepNightSeries"), 0);
  assert.equal(await harness("text", ".sleep-curve-title"), secondTitle);

  // -------------------------------------------------------------------------
  // 3. Refresh goes past the memory, because that is what it is for
  // -------------------------------------------------------------------------
  await harness("clearCalls");
  assert.equal(await harness("click", ".sleep-refresh-button"), true);
  await settle();
  assert.equal(
    await harness("callCount", "getSleepNightSeries"),
    1,
    "Refresh re-asks for the night on screen"
  );
  assert.deepEqual(
    (await harness("calls", "getSleepNightSeries"))[0].args[0],
    { happenDay: DAYS[1], refresh: true },
    "and asks past every freshness check"
  );

  // -------------------------------------------------------------------------
  // 4. The Naps tile's note carries what the tile could not fit
  // -------------------------------------------------------------------------
  //
  // The second night is the one with two naps, and it is the one on screen.
  const napTile = await tileNamed("Naps");
  assert.equal(
    napTile.value,
    "4h 38m · 2 naps",
    "the tile counts them, because two clocks do not fit one line"
  );
  assert.ok(napTile.note, "the naps tile carries a hover note");
  assert.deepEqual(
    napTile.note.split("\n"),
    ["Nap 1 · 12:19 AM – 2:20 AM (2h 01m)", "Nap 2 · 5:05 AM – 7:42 AM (2h 37m)"],
    "and hover spells out every nap COROS sent a window for"
  );

  // The note has to sit inside the row it belongs to. The tiles are an
  // `auto-fit` grid, so the side it opens to is decided by where the tile
  // landed, not by a rule a stylesheet could hold.
  const bounds = await harness("noteBounds", ".sleep-detail-metrics");
  assert.equal(bounds.length, 1, `one note on this night, saw ${bounds.length}`);
  assert.ok(
    bounds[0].left >= bounds[0].rowLeft - 1 && bounds[0].right <= bounds[0].rowRight + 1,
    `the note left the row: ${JSON.stringify(bounds[0])}`
  );

  // -------------------------------------------------------------------------
  // 5. What is remembered is what the main process would have remembered
  // -------------------------------------------------------------------------
  //
  // A day the athlete only napped has no sleep window, so it never has a curve
  // — a permanent fact the main process caches like any other settled night.
  // Refusing to remember an answer because it carries that message put the
  // loading flash back on exactly that day, on every click.
  await harness("clearCalls");
  await selectNight(DAYS[2]);
  await waitFor(
    () => harness("exists", ".sleep-curve.is-empty"),
    "the third night is fetched"
  );
  assert.equal(
    await harness("resolvePending", "getSleepNightSeries", {
      happenDay: DAYS[2],
      hrv: [],
      stress: [],
      source: "network",
      mcpState: "ready",
      error: "This night has no sleep window, so nothing can be placed on a clock."
    }),
    true
  );
  await settle();

  await selectNight(DAYS[0]);
  await harness("clearCalls");
  await selectNight(DAYS[2]);
  assert.equal(
    await harness("callCount", "getSleepNightSeries"),
    0,
    "a night that has no curve and never will is answered from memory"
  );

  // An answer given while COROS was unreachable is not the night's. Remembering
  // it left a night looked at during a reconnect reading "no overnight samples"
  // for the life of the screen.
  await harness("clearCalls");
  assert.equal(await harness("click", ".sleep-refresh-button"), true);
  await settle();
  assert.equal(
    await harness("resolvePending", "getSleepNightSeries", {
      happenDay: DAYS[2],
      hrv: [],
      stress: [],
      source: "cache",
      mcpState: "disconnected"
    }),
    true,
    "Refresh re-asked past the memory"
  );
  await settle();

  await selectNight(DAYS[0]);
  await harness("clearCalls");
  await selectNight(DAYS[2]);
  assert.equal(
    await harness("callCount", "getSleepNightSeries"),
    1,
    "so it is asked again rather than kept"
  );
  assert.equal(
    await harness("resolvePending", "getSleepNightSeries", {
      happenDay: DAYS[2],
      hrv: [],
      stress: [],
      source: "network",
      mcpState: "ready",
      error: "This night has no sleep window, so nothing can be placed on a clock."
    }),
    true
  );
  await settle();

  // A night with no naps says so on the tile and has nothing to add on hover.
  await selectNight(DAYS[0]);
  const plainNap = await tileNamed("Naps");
  assert.equal(plainNap.value, "None");
  assert.equal(plainNap.note, null, "an empty tile has no note to open");

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors, [], `the screen logged: ${errors.join(" | ")}`);

  console.log("sleep renderer: all assertions passed");
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
