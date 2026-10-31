// The Swimming screen, mounted for real in Electron's Chromium.
//
// It draws with Running's stylesheet as Cycling and Hiking do, so the layout
// traps those suites hold down are asked again of it — an empty list read
// three ways, no sideways scroll — along with what is Swimming's own: pool and
// open water apart, a pace per 100 and never per kilometre, a hero that says it
// is still reading before it says "none", CSS worked out of the best 200 and
// 400, and a swim page read length by length, its intervals under the sets
// they make, its channel chart in pace per 100 and stroke rate.
//
// The device scale is pinned to 1, for the reason test-cycling-renderer's is.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();

const DAY_SECONDS = 86_400;
const nowSeconds = Math.floor(Date.now() / 1000);
/** electron/swimDetail.ts's SWIM_SUMMARY_VERSION: a bump there is a fixture to look at here. */
const SWIM_SUMMARY_VERSION = 1;

/** A swim `index * 4 + 1` days back; the screen's default window is 90 days. */
function swim(index, overrides = {}) {
  return {
    activityId: `swim-${index}`,
    name: `Swim ${index}`,
    sportType: 300,
    startTime: nowSeconds - (index * 4 + 1) * DAY_SECONDS,
    duration: 2700,
    distance: 2000,
    avgHr: 138,
    maxHr: 162,
    trainingLoad: 60,
    ...overrides
  };
}

const POOL = Array.from({ length: 10 }, (_, index) => swim(index));
const OPEN = [
  swim(10, { sportType: 301, name: "Lake loop", distance: 1500, duration: 1700 }),
  swim(11, { sportType: 301, name: "Bay crossing", distance: 2400, duration: 2900 })
];
const SWIMS = [...POOL, ...OPEN];
const RUN = { activityId: "run-1", name: "Easy run", sportType: 100, startTime: nowSeconds - DAY_SECONDS, duration: 3000, distance: 10_000 };

/** What the summary sweep keeps of a pool swim: 80 freestyle lengths, the best efforts. */
function summaryOf(activity, index) {
  const lengths = 80;
  return {
    activityId: activity.activityId,
    fingerprint: "fixture",
    summaryVersion: 2,
    swimVersion: SWIM_SUMMARY_VERSION,
    swim: {
      version: SWIM_SUMMARY_VERSION,
      poolLength: 25,
      poolUnit: "m",
      lengths,
      swimSeconds: 2400,
      restSeconds: 300,
      byStyle: [
        {
          style: "free",
          meters: 2000,
          seconds: 2400,
          lengths,
          counted: { lengths, meters: 2000, seconds: 2400, strokes: lengths * (16 - (index % 3)) }
        }
      ],
      // The fastest 200 and 400 of the twelve weeks are swim 3's: CSS 200 m over
      // 224 s, 1:52 a hundred.
      best: [
        { distance: 100, seconds: 95 + index },
        { distance: 200, seconds: index === 3 ? 196 : 205 },
        { distance: 400, seconds: index === 3 ? 420 : 440 }
      ]
    },
    computedAt: Date.now()
  };
}
const SUMMARIES = POOL.map(summaryOf);
const SETTLED = { computed: 0, remaining: 0, failed: 0, summaries: [] };
const READ = { getActivityDetailSummaries: SUMMARIES, syncActivityDetailSummaries: SETTLED };

/**
 * A swim's page: 4 × 25 m warm-up, 20 s at the wall, 4 × 100 m freestyle on
 * 15 s, two 25 m drill lengths — 22 lengths, a sample a second.
 */
function swimDetail(activityId) {
  const lengths = [];
  const intervals = [];
  const series = [];
  let clock = 0;
  let meters = 0;
  const swimInterval = (times, strokes, style, restAfter) => {
    const index = intervals.length + 1;
    const restBefore = intervals[intervals.length - 1]?.restAfter;
    times.forEach((seconds, position) => {
      const count = strokes?.[position];
      lengths.push({
        index: lengths.length + 1,
        interval: index,
        style,
        distance: 25,
        seconds,
        ...(count !== undefined ? { strokes: count, swolf: seconds + count, strokeRate: Math.round((count / seconds) * 60) } : {}),
        avgHr: 140,
        ...(position === 0 && restBefore !== undefined ? { restBefore } : {})
      });
      for (let second = 0; second < seconds; second += 1) {
        meters += 25 / seconds;
        series.push({ elapsed: clock, distance: meters, hr: 150, pace: seconds * 40, ...(count ? { cadence: Math.round((count / seconds) * 60) } : {}) });
        clock += 1;
      }
    });
    const total = times.reduce((sum, value) => sum + value, 0);
    const counted = strokes ? strokes.reduce((sum, value) => sum + value, 0) : undefined;
    intervals.push({
      index,
      style,
      distance: times.length * 25,
      seconds: total,
      lengths: times.length,
      ...(counted !== undefined ? { strokes: counted, swolf: Math.round((total + counted) / times.length), strokeRate: Math.round((counted / total) * 60) } : {}),
      avgHr: 145,
      ...(restAfter ? { restAfter } : {})
    });
    for (let second = 0; second < (restAfter ?? 0); second += 1) {
      series.push({ elapsed: clock, distance: meters, hr: 110 });
      clock += 1;
    }
  };
  swimInterval([25, 24, 25, 26], [14, 13, 14, 15], "free", 20);
  for (let rep = 0; rep < 4; rep += 1) {
    swimInterval([22, 22, 23, 23], [15, 15, 16, 16], "free", rep < 3 ? 15 : 30);
  }
  swimInterval([40, 41], undefined, "drill", 0);
  return {
    activityId,
    name: "Swim 0",
    sportType: 300,
    duration: clock,
    distance: 650,
    avgHr: 140,
    maxHr: 165,
    trainingLoad: 55,
    laps: intervals.map((interval) => ({ index: interval.index, distance: interval.distance, duration: interval.seconds })),
    hrZones: [],
    series,
    swim: {
      poolLength: 25,
      poolUnit: "m",
      lengths,
      intervals,
      swimSeconds: intervals.reduce((sum, interval) => sum + interval.seconds, 0),
      restSeconds: 125,
      avgSwolf: 41,
      avgStrokeRate: 39,
      waterTemperatureC: 27.5
    }
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
  for (let pass = 0; pass < 4; pass += 1) {
    await win.webContents.executeJavaScript("new Promise((resolve) => setTimeout(resolve, 60))", true);
  }
}

async function mountSwimming(options, script = READ) {
  await harness("mount", "SwimmingView", options, script);
  await waitFor(() => harness("appStylesReady"), "the app stylesheet loads");
  await waitFor(() => harness("exists", ".running-page-header, .run-detail"), "the page renders");
  await settle();
}

const hasText = (text) =>
  win.webContents.executeJavaScript(`document.body.textContent.includes(${JSON.stringify(text)})`, true);

const listRowCount = () => harness("count", ".running-list-panel tbody tr");

/** A swim is never paced per kilometre or mile. */
const noLandPace = () =>
  win.webContents.executeJavaScript(String.raw`!/\d:\d\d \/(km|mi)\b/.test(document.body.textContent)`, true);

const clickChip = (label) =>
  win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".running-controls button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`,
    true
  );

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // -------------------------------------------------------------------------
  // An empty list says nothing by itself — the status decides which screen.
  // -------------------------------------------------------------------------
  {
    await mountSwimming({ activities: [], activitiesStatus: "pending" });
    assert.equal(await harness("exists", '[aria-label="Loading your swims"]'), true, "loading, named for swims");
    assert.equal(await hasText("No swims"), false, "loading is not 'no swims'");

    await mountSwimming({ activities: [], activitiesStatus: "failed" });
    assert.equal(await harness("clickText", "button", "Try again"), true);
    assert.equal(await harness("callCount", "prop:onRetryActivities"), 1);

    await mountSwimming({ activities: [RUN], activitiesStatus: "ready" });
    assert.equal(await hasText("No swims yet"), true, "a run is not a swim");

    await mountSwimming({ activities: [], activitiesStatus: "ready", connected: false });
    assert.equal(await hasText("Connect COROS first"), true);
  }

  // -------------------------------------------------------------------------
  // Still reading the swims is not "none": the hero and panels say they read.
  // -------------------------------------------------------------------------
  {
    await mountSwimming(
      { activities: SWIMS, activitiesStatus: "ready" },
      { getActivityDetailSummaries: [], syncActivityDetailSummaries: "__pending" }
    );
    assert.equal(await hasText("Reading your swims"), true, "the hero says it is reading");
    assert.equal(await hasText("Swim a 200 and a 400"), false, "not yet that there is no CSS");
    assert.equal(await hasText("No freestyle lengths counted yet"), false, "nor that there is no SWOLF");

    assert.equal(await harness("resolvePending", "syncActivityDetailSummaries", { ...SETTLED, computed: 1, summaries: SUMMARIES }), true);
    // The pass computed one, so the sweep asks again and is told nothing is left.
    await waitFor(() => hasText("1:52 /100m"), "CSS once the swims are read");
    assert.equal(await hasText("Reading your swims"), false, "and the reading notes are gone");
  }

  // -------------------------------------------------------------------------
  // The page: swims only, pool and open water apart, a swimmer's figures.
  // -------------------------------------------------------------------------
  {
    await mountSwimming({ activities: [RUN, ...SWIMS], activitiesStatus: "ready", height: 700 });
    await waitFor(() => hasText("1:52 /100m"), "the hero reads CSS out of the best 200 and 400");

    assert.equal(await listRowCount(), SWIMS.length, "every swim listed, the run left out");
    for (const label of ["This week", "CSS", "SWOLF", "Best 100", "Technique · freestyle", "Strokes"]) {
      assert.equal(await hasText(label), true, `the page states ${label}`);
    }
    assert.equal(await hasText("From 200 in 3:16.0, 400 in 7:00.0"), true, "CSS names the swims it came from");
    for (const absent of ["Load ratio", "VO₂max", "Threshold pace", "80/20"]) {
      assert.equal(await hasText(absent), false, `${absent} is a runner's figure and not this screen's`);
    }
    assert.equal(await noLandPace(), true, "no pace per kilometre anywhere");
    assert.equal(await hasText("/100m"), true, "the pace a swimmer reads");
    assert.equal(
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".running-list-panel .run-surface-chip")].filter((c) => c.textContent.trim() === "25 m").length`,
        true
      ),
      POOL.length,
      "a pool swim's chip names its pool"
    );

    const heading = () =>
      win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".run-block")].find((b) => b.textContent.includes("Weekly volume")).querySelector("h3").textContent`,
        true
      );
    assert.match(await heading(), /^\d{1,3}(,\d{3})+ m\b/, "a swimming week is metres, its thousands grouped");

    await clickChip("Open water");
    await settle();
    assert.equal(await listRowCount(), OPEN.length, "the chip narrows the list to open water");
    assert.equal(await hasText("Technique · freestyle"), false, "open water has no lengths to read technique from");
    await clickChip("Pool");
    await settle();
    assert.equal(await listRowCount(), POOL.length);
  }

  // -------------------------------------------------------------------------
  // No horizontal scroll, from a wide column down to the app's minimum.
  // -------------------------------------------------------------------------
  for (const width of [1344, 1000, 620]) {
    await mountSwimming({ activities: SWIMS, activitiesStatus: "ready", height: 900, width });
    await waitFor(() => hasText("1:52 /100m"), "the page is complete");
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the page scrolls sideways by ${overflow}px in a ${width}px column`);
  }

  // -------------------------------------------------------------------------
  // A swim's page: lengths, the sets they make, a chart read per 100.
  // -------------------------------------------------------------------------
  for (const width of [1344, 620]) {
    const target = POOL[0];
    await mountSwimming({
      activities: SWIMS,
      activitiesStatus: "ready",
      width,
      openRequest: { view: "swimming", activityId: target.activityId },
      detail: swimDetail(target.activityId),
      detailRequest: { activityId: target.activityId, status: "ready" }
    });
    await waitFor(() => harness("exists", ".activity-chart-chips"), "the channel chart draws");
    await settle();

    assert.equal(await hasText("Pool · 25 m ·"), true, "the eyebrow names the pool");
    for (const label of ["Swim time", "Rest", "SWOLF", "Strokes / length", "Stroke rate", "Distance / stroke", "Lengths", "Sets"]) {
      assert.equal(await hasText(label), true, `the swim page states ${label}`);
    }
    assert.equal(await hasText("22 lengths"), true, "every length counted");
    assert.equal(await hasText("4 × 100 m Freestyle"), true, "the hundreds read as the set they were");
    assert.equal(await hasText("rest 0:15"), true, "with the rest between them");
    const swolf = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-detail-stats .running-stat")].find((s) => s.querySelector("span").textContent === "SWOLF").querySelector("strong").textContent`,
      true
    );
    assert.equal(swolf, "38", "the row's SWOLF off the lengths, drills out — not COROS's 41");
    const chips = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".activity-chart-chips button")].map((b) => b.textContent.trim())`,
      true
    );
    assert.ok(chips.includes("Pace") && chips.includes("Stroke rate"), `a swim's chart reads pace and stroke rate: ${chips}`);
    assert.equal(await hasText("Whole swim"), true, "the segment is the swim's");
    assert.equal(await noLandPace(), true, "no pace per kilometre on the page either");
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the swim page scrolls sideways by ${overflow}px in a ${width}px column`);
  }

  {
    const target = POOL[0];
    await mountSwimming({
      activities: SWIMS,
      activitiesStatus: "ready",
      openRequest: { view: "swimming", activityId: target.activityId, from: "training" },
      detail: swimDetail(target.activityId),
      detailRequest: { activityId: target.activityId, status: "ready" }
    });
    assert.equal(await harness("text", ".run-detail-back span"), "Activities");
    assert.equal(await harness("clickText", ".run-detail-back", "Activities"), true);
    await settle();
    assert.deepEqual(
      (await harness("calls", "prop:onReturn")).map((call) => call.args),
      [["training"]],
      "Back returns to Activities"
    );
  }

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors, [], `no console errors: ${JSON.stringify(errors)}`);

  console.log("swimming renderer tests passed");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
