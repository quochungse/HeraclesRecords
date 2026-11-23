// Stress level and Heart rate, mounted for real in Electron's Chromium.
//
// - **Both open on today, and today states no average.** At nine in the
//   morning the day's average is the night's: Stress level leads with the
//   latest reading and its time, Heart rate with the resting rate and no Avg HR.
// - **Picking a day costs no round trip.** The month's readings arrive in
//   one read, so a click on another day draws it from what is already here.
// - A past day leads with its average and draws a bar for every reading.
// - The day's levels are one bar with no legend; a part names itself when
//   pointed at.
// - Heart rate draws the night's heart rate and each session on the day's
//   ladder — the session's highest from its detail, which the list lacks; a
//   day's range takes in the night inside it, which COROS's own can miss —
//   each session's own time in its zones, and the period's in the account's.
// - A period chosen beside a trend chart moves it (`data-grow`), and only then.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.disableHardwareAcceleration();

function dayKey(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

const TODAY = dayKey(0);
const YESTERDAY = dayKey(-1);

const DAYS = Array.from({ length: 40 }, (_, index) => {
  const day = dayKey(index - 39);
  return {
    day,
    stressAvg: 20 + (index % 7) * 3,
    levels: { relaxed: 500 + index, low: 120, medium: 60, high: 15 + (index % 5) * 10 },
    avgHr: 65 + (index % 6),
    minHr: 45 + (index % 4),
    maxHr: 120 + (index % 9) * 4,
    restingHr: 52 + (index % 3)
  };
});

/** Readings from 00:00 to 07:00 on every day, and until 22:00 on past ones. */
function slots(day) {
  const last = day === TODAY ? 84 : 264;
  return Array.from({ length: 288 }, (_, slot) => (slot < last && slot % 9 !== 0 ? 10 + (slot % 60) : null));
}
const SERIES = Array.from({ length: 30 }, (_, index) => dayKey(index - 29)).map((day) => ({ day, slots: slots(day) }));
const readings = (day) => slots(day).filter((value) => value !== null).length;

let win;
const harness = (method, ...args) =>
  win.webContents.executeJavaScript(`window.__harness.${method}(${args.map((v) => JSON.stringify(v)).join(", ")})`, true);
const js = (code) => win.webContents.executeJavaScript(code, true);

async function waitFor(read, what, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 1200, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");
  assert.equal(await harness("freezeAnimations"), true);

  await harness("mount", "StressLevelView", {}, {
    getStressHeartDays: { days: DAYS, mcpState: "ready", source: "cache", fetchedAt: Date.now() },
    getStressSeries: { days: SERIES, mcpState: "ready" },
    getSleepHistory: { records: [], mcpState: "ready", source: "cache" }
  });

  await waitFor(() => js("document.querySelectorAll('.stress-timeline-bar').length > 0"), "the day's readings are drawn");
  assert.equal(await js("document.querySelectorAll('.stress-day-row').length"), 30, "a month of days, as on Sleep");
  assert.match(await js("document.querySelector('.stress-day-row.is-selected .stress-day-row-date').textContent"), /Today/);

  // Today: the latest reading, never the average.
  const unit = await js("document.querySelector('.stress-day-detail-unit').textContent");
  assert.match(unit, /latest reading, 06:55/, `today leads with its latest reading (${unit})`);
  assert.equal(await js("document.querySelector('.stress-day-detail-figure').textContent"), String(10 + (83 % 60)));
  const todayFigures = await js("[...document.querySelectorAll('.stress-day-figure dt')].map((n) => n.textContent)");
  assert.ok(!todayFigures.includes("Avg HR"), `no average heart rate on today (${todayFigures})`);
  assert.equal(await js("document.querySelectorAll('.stress-timeline-bar').length"), readings(TODAY));
  assert.ok(await js("Boolean(document.querySelector('.stress-timeline-now'))"), "today marks its last reading");

  // StrictMode mounts twice; what matters is that a pick adds nothing.
  const seriesCalls = (await harness("calls", "getStressSeries")).length;

  // Yesterday: its average, its own readings, and no new request.
  await js("document.querySelectorAll('.stress-day-row')[1].click()");
  await waitFor(
    () => js("document.querySelector('.stress-day-detail-unit').textContent === 'avg stress'"),
    "a past day leads with its average"
  );
  const yesterday = DAYS.find((record) => record.day === YESTERDAY);
  assert.equal(await js("document.querySelector('.stress-day-detail-figure').textContent"), String(yesterday.stressAvg));
  assert.equal(await js("document.querySelectorAll('.stress-timeline-bar').length"), readings(YESTERDAY));
  assert.equal(await js("Boolean(document.querySelector('.stress-timeline-now'))"), false);
  assert.equal((await harness("calls", "getStressSeries")).length, seriesCalls, "picking a day asks for nothing");

  // No legend under the day; the bar's parts say what they are when pointed at.
  assert.equal(await js("document.querySelector('.stress-day-detail .stress-legend')"), null, "the day has no legend");
  assert.equal(await js("document.querySelectorAll('.stress-day-levels-cols').length"), 0);
  assert.equal(await js("document.querySelector('.stress-levels-tip')"), null);
  await js(`document.querySelector('.stress-day-levels-stack > .is-relaxed').dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 1 }))`);
  const levelTip = await waitFor(() => js("document.querySelector('.stress-levels-tip')?.textContent ?? null"), "the pointed part names itself");
  assert.match(levelTip, /^Relaxed 0–25/, levelTip);

  // The day's line under the plot: a sleep and a session would carry badges;
  // a day of readings alone is a solid line with dotted gaps.
  assert.ok(await js("document.querySelectorAll('.stress-timeline-line.is-measured').length > 0"));
  assert.ok(await js("document.querySelectorAll('.stress-timeline-line.is-unmeasured').length > 0"));
  assert.deepEqual(await harness("consoleErrors"), []);

  // --- Heart rate ---------------------------------------------------------
  const RUN_DAY = dayKey(-2);
  const runStart = new Date();
  runStart.setDate(runStart.getDate() - 2);
  runStart.setHours(18, 0, 0, 0);
  const RUN = {
    activityId: "run-1",
    name: "Easy run",
    sportType: 100,
    startTime: Math.round(runStart.getTime() / 1000),
    endTime: Math.round(runStart.getTime() / 1000) + 3600,
    duration: 3600,
    avgHr: 140,
    maxHr: 165
  };
  const night = (day, avgHr) => ({
    happenDay: day,
    kind: "main",
    completeness: "complete",
    sleepStart: "23:30",
    sleepEnd: "06:40",
    avgHr,
    minHr: avgHr - 6,
    maxHr: avgHr + 11
  });
  // 2026-11-23 as COROS sent it: the day 48–73, its night (00:00–06:58,
  // wholly inside it) 48–85. The day is shown as COROS sent it.
  const HEART_DAYS = DAYS.map((record) => (record.day === TODAY ? { ...record, minHr: 48, maxHr: 73 } : record));
  const TONIGHT = {
    ...night(TODAY, 55),
    sleepStart: "00:00",
    sleepEnd: "06:58",
    sleepStartDay: TODAY,
    sleepEndDay: TODAY,
    minHr: 48,
    maxHr: 85
  };
  await harness("mount", "HeartRateView", { activities: [RUN] }, {
    getStressHeartDays: { days: HEART_DAYS, mcpState: "ready", source: "cache", fetchedAt: Date.now() },
    getSleepHistory: { records: [TONIGHT, night(YESTERDAY, 52), night(RUN_DAY, 53)], mcpState: "ready", source: "cache" },
    getActivityDetailSummaries: [
      {
        activityId: "run-1",
        fingerprint: "f",
        summaryVersion: 1,
        zoneSeconds: [600, 1200, 900, 300, 60, 0],
        // Its highest, stored from its detail once: the list draws it on open.
        heartRateVersion: 1,
        heartRate: { avg: 140, max: 172 }
      }
    ],
    syncActivityDetailSummaries: { remaining: 0, computed: 0, failed: 0, summaries: [] },
    // The list row has no maxHr (COROS's list never carries one); the detail does.
    getTrainingHubActivityDetail: {
      avgHr: 140,
      maxHr: 172,
      hrZoneType: 2,
      hrZones: [
        { index: 0, high: 120, seconds: 300 },
        { index: 1, low: 121, high: 138, seconds: 1500 },
        { index: 2, low: 139, high: 152, seconds: 1200 },
        { index: 3, low: 153, high: 165, seconds: 540 },
        { index: 4, low: 166, high: 178, seconds: 60 },
        { index: 5, low: 179, high: 404, seconds: 0 }
      ]
    }
  });

  await waitFor(() => js("document.querySelectorAll('.heart-ladder-row').length > 0"), "the day's ladder is drawn");
  // The month, as Sleep and Stress level list it.
  assert.equal(await js("document.querySelectorAll('.stress-day-row').length"), 30);
  const todayRecord = DAYS.find((record) => record.day === TODAY);
  assert.equal(await js("document.querySelector('.stress-day-detail-figure').textContent"), String(todayRecord.restingHr));
  const heartTiles = await js("[...document.querySelectorAll('.stress-day-figure dt')].map((n) => n.textContent)");
  assert.deepEqual(heartTiles, ["Daily heart rate", "Sleep heart rate"], `two tiles alike (${heartTiles})`);
  assert.match(await js("document.querySelector('.stress-day-figure.is-asleep strong').textContent"), /^48–85/);
  assert.equal(await js("document.querySelector('.stress-day-figure dd > span').textContent"), "so far", "today's daily tile states no average");
  assert.match(await js("document.querySelector('.stress-day-figure strong').textContent"), /^48–73/, "COROS's day, as sent");
  // A row leads with the day's lowest to highest; resting follows.
  assert.equal(await js("document.querySelector('.stress-day-row .stress-day-row-figure').textContent"), "48–73");
  assert.match(
    await js("document.querySelector('.stress-day-row .stress-day-row-meta').textContent"),
    new RegExp(`Resting ${todayRecord.restingHr} · so far`)
  );
  // Each row's strip previews its ladder: the night's range, each session at its average.
  assert.ok(await js("Boolean(document.querySelectorAll('.stress-day-row')[0].querySelector('.heart-day-row-range .is-sleep'))"), "today's night on its strip");
  // On open, before its day is: the run's strip reaches its stored highest.
  await waitFor(
    () => js("Boolean(document.querySelectorAll('.stress-day-row')[2].querySelector('.heart-day-row-range i.is-session'))"),
    "the run on its day's strip, avg to max from its summary"
  );
  assert.equal(await harness("calls", "getTrainingHubActivityDetail").then((calls) => calls.length), 0, "no detail read for the list");
  const sweep = await harness("calls", "syncActivityDetailSummaries");
  assert.ok(sweep.some((call) => call.args[2]?.requireHeartRate === true), "the list asks for sessions' heart rate");
  assert.equal(await js("document.querySelectorAll('.stress-day-row')[1].querySelector('.heart-day-row-range .is-session')"), null);
  // The strip is the ladder in small: the same scale, so the same places.
  assert.equal(
    await js("document.querySelectorAll('.stress-day-row')[0].querySelector('.heart-day-row-range .is-day').style.left"),
    await js("document.querySelector('.heart-ladder-row.is-day .heart-ladder-range').style.left")
  );
  assert.equal(
    await js("document.querySelectorAll('.stress-day-row')[0].querySelector('.heart-day-row-range .is-sleep').style.width"),
    await js("document.querySelector('.heart-ladder-row.is-asleep .heart-ladder-range').style.width")
  );
  assert.equal(await js("document.querySelector('.stress-trend-panel .stress-pane-title').textContent"), "Daily heart rate");
  // No footnote under the ladder; a row says what it holds when pointed at.
  assert.ok(!(await js("document.querySelector('.stress-day-detail').textContent")).includes("The line through"));
  await js(`document.querySelector('.heart-ladder-row.is-asleep').dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 300 }))`);
  const ladderTip = await waitFor(() => js("document.querySelector('.heart-ladder-tip')?.innerText ?? null"), "the pointed row's card");
  assert.match(ladderTip, /Sleep heart rate · 00:00–06:58/i);
  // Lowest and highest are one line.
  assert.match(ladderTip, /HR\s+48–85 bpm/);
  assert.ok(!/Lowest|Highest/.test(ladderTip), ladderTip);
  // So far, asleep, and the axis.
  assert.equal(await js("document.querySelectorAll('.heart-ladder-row:not(.is-axis)').length"), 2);
  assert.equal(await js("document.querySelector('.heart-ladder-row.is-day .heart-ladder-average')"), null, "today's row has no average");

  await js("document.querySelectorAll('.stress-day-row')[2].click()");
  await waitFor(() => js("document.querySelectorAll('.heart-ladder-row.is-session').length === 1"), "the run is on its day's ladder");
  assert.match(await js("document.querySelector('.stress-day-figure dd > span').textContent"), /^avg \d+ bpm$/, "a past day's average under its range");
  // The session's range on the ladder, avg to max from its detail; its zones
  // folded until the session is pressed.
  await waitFor(() => js("Boolean(document.querySelector('.heart-ladder-row.is-session .heart-ladder-range'))"), "avg to max from the detail");
  assert.match(await js("document.querySelector('.heart-session-hr').textContent"), /avg 140 · max 172 bpm/);
  // Its detail read, the run's strip reaches its highest where the ladder does.
  await waitFor(() => js("Boolean(document.querySelectorAll('.stress-day-row')[2].querySelector('.heart-day-row-range i.is-session'))"), "the run's strip reaches its highest");
  assert.equal(
    await js("document.querySelectorAll('.stress-day-row')[2].querySelector('.heart-day-row-range i.is-session').style.width"),
    await js("document.querySelector('.heart-ladder-row.is-session .heart-ladder-range').style.width")
  );
  assert.equal(await js("document.querySelectorAll('.heart-session .heart-zones li').length"), 0, "folded at first");
  assert.equal(await js("document.querySelector('.heart-session-head').getAttribute('aria-expanded')"), "false");
  await js("document.querySelector('.heart-session-head').click()");
  await waitFor(() => js("document.querySelectorAll('.heart-session .heart-zones li').length === 6"), "the run's time in each zone");
  assert.equal(await js("document.querySelector('.heart-session-head').getAttribute('aria-expanded')"), "true");
  assert.match(await js("document.querySelector('.heart-session .heart-zones li:nth-child(2)').textContent"), /121–138 bpm/);
  const detailCalls = (await harness("calls", "getTrainingHubActivityDetail")).length;
  await js("document.querySelectorAll('.stress-day-row')[0].click()");
  await js("document.querySelectorAll('.stress-day-row')[2].click()");
  await waitFor(() => js("document.querySelectorAll('.heart-session .heart-zones li').length === 6"), "the run again");
  assert.equal((await harness("calls", "getTrainingHubActivityDetail")).length, detailCalls, "a session read once is not read again");

  // A period chosen beside a chart moves it, and the motion lets go.
  assert.equal(await js("document.querySelector('.stress-trend-chart[data-grow]')"), null, "nothing moves unasked");
  await js("[...document.querySelectorAll('.stress-trend-panel')[0].querySelectorAll('button')].find((b) => b.textContent === '3 months').click()");
  await waitFor(() => js("Boolean(document.querySelector('.stress-trend-chart[data-grow]'))"), "the chart answers the press");
  await waitFor(() => js("document.querySelector('.stress-trend-chart[data-grow]') === null"), "and settles", 4_000);

  // Sleep heart rate and the zones panel.
  // Daily heart rate and the exercise zones; no asleep panel.
  assert.equal(await js("document.querySelectorAll('.stress-trend-panel').length"), 2);
  await waitFor(() => js("document.querySelectorAll('.heart-zones-panel .heart-zones li').length === 6"), "time in each zone");
  assert.match(await js("document.querySelector('.heart-zones-panel .stress-trend-figures strong').textContent"), /51/);
  assert.deepEqual(await harness("consoleErrors"), []);

  console.log("stress & heart renderer tests passed");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
