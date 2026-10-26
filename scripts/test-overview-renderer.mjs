// The Overview's loading states, chart overlays and content-width layout in Chromium.
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();

const root = path.resolve(import.meta.dirname, "..");
const today = new Date();
const key = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
const zones = [133, 154, 168, 173, 183, 404].map((hr, index) => ({ index, hr }));
const run = { activityId: "run-1", name: "Easy run", sportType: 100, startTime: Date.now() / 1000 - 86_400, duration: 3600, distance: 10_000, avgHr: 150, trainingLoad: 90 };
const snapshot = {
  summary: {}, trendPoints: [], racePredictor: null, analytics: null,
  dashboard: { lthrZones: zones },
  dailyMetrics: { dayList: [{ happenDay: key, cti: 50, ati: 55, trainingLoadRatio: 1.1, trainingLoad: 90 }] },
};
const profile = { hrZoneType: 2, thresholds: { maxHr: 190, restingHr: 52, zones: { restingHr: zones.map(({ hr, index }) => ({ index, bpm: hr })) } } };
const summaries = [{ activityId: run.activityId, zoneSeconds: [600, 1200, 900, 600, 300, 0] }];
const answers = { getCorosProfileSnapshot: { profile }, getActivityDetailSummaries: summaries };
let win;
const evaluate = (code) => win.webContents.executeJavaScript(code, true);
const harness = (method, ...args) => evaluate(`window.__harness.${method}(${args.map((arg) => JSON.stringify(arg)).join(",")})`);

async function waitFor(read, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(`Timed out: ${description}; console: ${JSON.stringify(await harness("consoleErrors"))}`);
}

async function tooltipWithinViewport() {
  await waitFor(() => harness("exists", ".overview-chart-tooltip"), "tooltip opens");
  const box = await evaluate(`(() => {
    const tooltip = document.querySelector('.overview-chart-tooltip');
    const box = tooltip.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      width: innerWidth, height: innerHeight, visible: getComputedStyle(tooltip).visibility,
      portal: tooltip.parentElement === document.body };
  })()`);
  assert.equal(box.portal, true, "tooltip escapes the card and scrollport");
  assert.equal(box.visible, "visible");
  assert(box.left >= 7 && box.top >= 7 && box.right <= box.width - 7 && box.bottom <= box.height - 7,
    `tooltip stays in the viewport: ${JSON.stringify(box)}`);
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(path.join(root, "dist-harness/index.html"));
  await waitFor(() => evaluate("Boolean(window.__harness)"), "harness ready");

  await harness("mount", "TrainingOverview", { snapshot, activities: [run] }, {
    getCorosProfileSnapshot: "__pending", getActivityDetailSummaries: "__pending",
  });
  await waitFor(() => harness("appStylesReady"), "stylesheet ready");
  await waitFor(() => harness("callCount", "getActivityDetailSummaries"), "cached summaries requested");
  assert.equal(await harness("count", ".overview-hr-row"), 0, "no provisional LTHR distribution");
  await harness("resolvePending", "getCorosProfileSnapshot", { profile });
  await waitFor(() => evaluate("document.querySelector('.overview-hr .eyebrow')?.textContent.includes('Reserve')"), "selected profile model");
  assert.equal(await harness("count", ".overview-hr-row"), 0, "wait for recorded splits before estimating");
  await harness("resolvePending", "getActivityDetailSummaries", summaries);
  await waitFor(() => evaluate("document.querySelectorAll('.overview-hr-row').length === 6"), "recorded distribution");
  assert.match(await harness("text", ".overview-hr-dominant"), /33/);
  const requests = await harness("calls", "getActivityDetailSummaries");
  // StrictMode intentionally starts each effect twice; each pass serves both cards.
  assert.equal(requests.length, 2);
  assert(requests.every((call) => JSON.stringify(call.args[0]) === JSON.stringify([run.activityId])));
  assert.equal(await harness("callCount", "syncActivityDetailSummaries"), 0, "Overview never backfills endurance details");

  await harness("clickText", ".overview-hr [role=radio]", "Training Load");
  await waitFor(() => evaluate("document.querySelectorAll('.overview-hr-row')[1]?.textContent.includes('30')"), "load allocation uses the same split");
  await harness("click", '[data-overview-sport="running"] .overview-entry');
  assert.deepEqual((await harness("calls", "prop:onOpenView")).at(-1).args, ["running"]);
  assert.match(await harness("attr", '[data-overview-sport="running"] .overview-entry', "aria-label"), /Running/);

  // The viewport remains 1400px; only the content narrows, as when a sidebar opens.
  for (const width of [1100, 760, 620]) {
    await harness("setProps", { width });
    await waitFor(() => evaluate(`Math.abs(document.querySelector('.content').getBoundingClientRect().width - ${width}) < 1`), "content width");
    assert((await harness("overflowX", ".content")) <= 1, `page has no horizontal overflow at ${width}px`);
  }
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.overview-sport-body')).gridTemplateColumns.split(' ').length"), 1);
  const daily = await evaluate(`Array.from(document.querySelector('.overview-daily-grid').children).map(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }))`);
  assert.equal(daily[0].top, daily[1].top);
  assert(daily[2].top >= daily[0].bottom, "training status moves below the daily pair");

  await evaluate("document.querySelector('.overview-volume g[tabindex]').scrollIntoView({block:'center'})");
  await harness("focus", ".overview-volume g[tabindex]");
  await tooltipWithinViewport();
  await harness("keyDown", ".overview-volume g[tabindex]", "Escape");
  await waitFor(async () => !(await harness("exists", ".overview-chart-tooltip")), "Escape dismisses chart tooltip");
  // The tooltip flips below a chart near the top of the viewport.
  await evaluate("document.querySelector('.overview-volume').scrollIntoView({block:'start'})");
  await harness("focus", ".overview-volume g[tabindex]");
  await tooltipWithinViewport();
  await evaluate("document.querySelector('.content').scrollTop += 20");
  await waitFor(async () => !(await harness("exists", ".overview-chart-tooltip")), "scroll dismisses fixed tooltip");

  await evaluate("document.querySelector('.training-heatmap-cell.is-card').scrollIntoView({block:'center'})");
  await harness("focus", ".training-heatmap-cell.is-card");
  await tooltipWithinViewport();
  await harness("keyDown", ".training-heatmap-cell.is-card", "Escape");
  await waitFor(async () => !(await harness("exists", ".overview-chart-tooltip")), "Escape dismisses heatmap tooltip");
  await harness("focus", ".overview-status-chart");
  await harness("keyDown", ".overview-status-chart", "ArrowLeft");
  await tooltipWithinViewport();
  await evaluate("window.dispatchEvent(new Event('resize'))");
  await waitFor(async () => !(await harness("exists", ".overview-chart-tooltip")), "resize dismisses tooltip");

  await evaluate(`(() => { const snapshot = ${JSON.stringify(snapshot)}; snapshot.dailyMetrics.dayList[0].trainingLoadRatio = NaN; window.__harness.setProps({ snapshot }); })()`);
  await waitFor(() => evaluate("document.querySelector('.overview-status h3')?.textContent.includes('unavailable')"), "invalid ratio never reports Steady");
  assert(!(await harness("text", ".overview-status-metrics")).includes("NaN"));
  assert.deepEqual(await harness("consoleErrors"), []);

  const oneBased = { ...snapshot, dashboard: { lthrZones: zones.map((zone) => ({ ...zone, index: zone.index + 1 })) } };
  await harness("mount", "TrainingOverview", { snapshot: oneBased, activities: [run] }, {
    ...answers, getCorosProfileSnapshot: { profile: null },
  });
  await waitFor(() => evaluate("document.querySelectorAll('.overview-hr-row').length === 6"), "dashboard zone fallback");
  const ranges = await evaluate("Array.from(document.querySelectorAll('.overview-hr-row > div small')).map(el => el.textContent)");
  assert.equal(ranges[0], "≤ 133 bpm");
  assert.equal(ranges[1], "134–154 bpm", "native one-based indices must not repeat the first range");

  const surfaces = [run, { ...run, activityId: "indoor", sportType: 101, distance: 2000 }, { ...run, activityId: "track", sportType: 103, distance: 1000 }];
  const napSnapshot = {
    ...snapshot,
    sleep: { records: [{ happenDay: key, kind: "nap-only", completeness: "complete", napMinutes: 45 }] },
    trendPoints: [{ date: key, avgSleepHrv: 0, rhr: -1 }],
  };
  await harness("mount", "TrainingOverview", { snapshot: napSnapshot, activities: surfaces }, answers);
  await waitFor(() => evaluate("document.querySelector('.overview-sport-caption')?.textContent.includes('Treadmill')"), "run surfaces are kept distinct");
  const caption = await harness("text", ".overview-sport-caption");
  assert.match(caption, /Road: 10[.,]0 km/);
  assert.match(caption, /Treadmill: 2[.,]00 km/);
  assert.match(caption, /Track: 1[.,]00 km/);
  assert.match(await harness("text", ".overview-sleep-stages"), /Naps only/);
  assert.equal(await harness("count", ".overview-sleep-vitals small"), 0, "missing vitals never carry units");
  assert.deepEqual(await harness("consoleErrors"), []);

  const lift = { ...run, activityId: "lift-1", sportType: 402, name: "Strength" };
  const strengthSession = { ...lift, detail: { exercises: [{ rawName: "Chest" }] } };
  await harness("mount", "TrainingOverview", { snapshot, activities: [lift] }, {
    ...answers, syncStrengthHistory: "__pending",
  });
  await waitFor(() => harness("callCount", "syncStrengthHistory"), "heatmap Strength read");
  assert.equal(await harness("callCount", "syncStrengthHistory"), 1, "StrictMode shares the in-flight heatmap read");
  await harness("resolvePending", "syncStrengthHistory", { sessions: [strengthSession], pending: 0 });
  await waitFor(() => evaluate("document.querySelector('.training-heatmap-card-title')?.textContent.includes('Chest')"), "replayed effect receives Strength focus");
  assert.equal((await harness("calls", "syncStrengthHistory"))[0].args[0].source, "coros");
  assert.deepEqual(await harness("consoleErrors"), []);

  await harness("mount", "TrainingOverview", { snapshot, activities: [run], showStrength: true }, {
    ...answers, getHevyStatus: { connected: false }, syncStrengthHistory: { sessions: [], pending: 0, fetched: 0 },
  });
  await waitFor(() => harness("exists", ".overview-strength-placeholder"), "Strength placeholder");
  await waitFor(() => harness("exists", ".overview-hr-row"), "initial data ready");
  assert.equal(await harness("callCount", "getHevyStatus"), 0, "offscreen Strength does not load");
  await evaluate("document.querySelector('.overview-strength-placeholder').scrollIntoView({block:'center'})");
  await waitFor(() => harness("callCount", "syncStrengthHistory"), "Strength loads near the viewport");
  assert((await harness("calls", "syncStrengthHistory")).every((call) => call.args[0].days === 30));
  await waitFor(async () => !(await harness("exists", '[data-overview-sport="strength"]')), "empty Strength stays hidden");
  assert.deepEqual(await harness("consoleErrors"), []);
  console.log("overview renderer OK — shared reads, profile loading, load splits, container layout, portal tooltips and deferred Strength");
}

const timeout = setTimeout(() => { console.error("Overview renderer timed out"); app.exit(1); }, 60_000);
main().then(() => { clearTimeout(timeout); app.quit(); }).catch((error) => {
  console.error(error); clearTimeout(timeout); app.exit(1);
});
