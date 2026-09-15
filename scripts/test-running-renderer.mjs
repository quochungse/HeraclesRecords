// The Running screen, mounted for real in Electron's Chromium.
//
// Everything asserted here has already gone wrong once, in a way that type-
// checked and threw nothing:
//
// - An empty activity list reads three ways — still loading, failed, never ran
//   — and the screen used to take all three for "no runs", showing a row of
//   zeros on every launch until COROS answered.
// - The run list rendered two pixels tall. A grid item with `overflow: hidden`
//   loses its automatic minimum size, and in a column that cannot grow the
//   track shrinks to it. Every row was in the DOM; none was on screen.
// - A seven-column table in a two-column grid pushed its track past `1fr` and
//   gave the whole page a horizontal scrollbar.
// - Coming back from a run could land far above where the list was left.
// - The route map drew over the lap table. Its panel carried `min-height: 0`,
//   the same zero minimum as the list, and was squeezed to its padding.
// - A paused run's chart ran on the wall clock: the laps drifted off their own
//   boundaries and "Whole run" reported the wait as running.
//
// Layout is asserted in a hidden window, which lays out but does not paint:
// boxes and scroll positions are real there, animations are not.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

const DAY_SECONDS = 86_400;
const nowSeconds = Math.floor(Date.now() / 1000);

/** A road run `daysAgo` days back; the screen's default window is 90 days. */
function run(index, overrides = {}) {
  return {
    activityId: `run-${index}`,
    name: `Run ${index}`,
    sportType: 100,
    startTime: nowSeconds - (index + 1) * DAY_SECONDS * 2,
    duration: 3600,
    distance: 10_000,
    avgHr: 150,
    maxHr: 170,
    trainingLoad: 90,
    elevationGain: 20,
    ...overrides
  };
}

const RUNS = Array.from({ length: 30 }, (_, index) => run(index));
const RIDE = {
  activityId: "ride-1",
  name: "Ride",
  sportType: 200,
  startTime: nowSeconds - DAY_SECONDS,
  duration: 3600,
  distance: 30_000
};

/**
 * Zone ceilings, as the dashboard sends them. Without these the intensity panel
 * says it has no zones and draws nothing — which is its own correct behaviour,
 * and not what the summary block below is about.
 */
const SNAPSHOT_WITH_ZONES = {
  dashboard: {
    lthrZones: [
      { index: 1, hr: 133 },
      { index: 2, hr: 154 },
      { index: 3, hr: 168 },
      { index: 4, hr: 173 },
      { index: 5, hr: 183 }
    ]
  }
};

let win;
/** Where the back button sits on a run with no route, for the cover to match. */
let backOffsetWithoutCover;

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
    await win.webContents.executeJavaScript(
      "new Promise((resolve) => setTimeout(resolve, 60))",
      true
    );
  }
}

async function mountRunning(options, script = {}) {
  await harness("mount", "RunningView", options, script);
  await waitFor(() => harness("appStylesReady"), "the app stylesheet loads");
  await waitFor(() => harness("exists", ".running-page-header"), "the page renders");
  await settle();
}

async function hasText(text) {
  return win.webContents.executeJavaScript(
    `document.body.textContent.includes(${JSON.stringify(text)})`,
    true
  );
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false }
  });
  // Nothing here needs the network, and the route map would otherwise fetch
  // real tiles — a suite that fails offline is a suite nobody trusts.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // -------------------------------------------------------------------------
  // An empty list says nothing by itself — the status decides which screen.
  // -------------------------------------------------------------------------
  {
    await mountRunning({ activities: [], activitiesStatus: "pending" });
    assert.equal(await harness("exists", ".run-skeleton"), true, "loading shows the placeholder");
    assert.equal(await hasText("No runs"), false, "loading is not 'no runs'");
    assert.equal(
      await harness("exists", ".running-totals"),
      false,
      "no figures before the list arrives — a zero reads as a fact"
    );

    await mountRunning({ activities: [], activitiesStatus: "failed" });
    assert.equal(await hasText("did not load"), true, "a failed load says so");
    assert.equal(await harness("exists", ".run-skeleton"), false);
    assert.equal(await harness("clickText", "button", "Try again"), true);
    assert.equal(await harness("callCount", "prop:onRetryActivities"), 1, "retry reloads");

    await mountRunning({ activities: [], activitiesStatus: "ready" });
    assert.equal(await hasText("No runs yet"), true, "a loaded, empty history is 'no runs yet'");

    await mountRunning({ activities: [RIDE], activitiesStatus: "ready" });
    assert.equal(
      await hasText("No runs yet"),
      true,
      "a history with only rides in it has no runs either"
    );

    // A refresh in flight keeps what is already on screen: `pending` only holds
    // back an empty list.
    await mountRunning({ activities: RUNS, activitiesStatus: "pending" });
    assert.equal(await harness("exists", ".run-skeleton"), false);
    assert.equal(await harness("count", ".running-list-panel tbody tr"), RUNS.length);
  }

  // -------------------------------------------------------------------------
  // The list is on screen at its full height, and the page scrolls as one.
  // -------------------------------------------------------------------------
  {
    await mountRunning({ activities: RUNS, activitiesStatus: "ready", height: 700 });
    const rows = await harness("count", ".running-list-panel tbody tr");
    assert.equal(rows, RUNS.length);

    const panel = await harness("rect", ".running-list-panel");
    assert.ok(
      panel.height >= rows * 40,
      `the list panel is ${panel.height}px for ${rows} rows — a collapsed grid track`
    );

    // The panel keeping its own height proves nothing if a box above it has
    // collapsed and clips it away — which is what a clipping grid item in this
    // column does. The scroll has to reach all of it.
    const reach = await win.webContents.executeJavaScript(
      `document.querySelector(".running-view").scrollHeight`,
      true
    );
    assert.ok(
      reach >= panel.height,
      `the page scrolls ${reach}px but the list alone is ${panel.height}px — something above it collapsed`
    );

    const scroll = await harness("rect", ".running-view");
    assert.ok(scroll.height <= 700, "the page is bounded by its column");
    await harness("scrollTo", ".running-view", 500);
    const header = await harness("rect", ".running-page-header");
    assert.ok(
      header.top < 0,
      "the title and filters scroll away with the page instead of staying pinned"
    );
  }

  // -------------------------------------------------------------------------
  // No horizontal scroll, from a wide column down to the app's minimum.
  // -------------------------------------------------------------------------
  //
  // The window is at least 900px wide (main.ts); with the sidebar expanded that
  // leaves the page a column of roughly 620px, the app's own 28px side padding
  // included. The column is sized directly — a hidden window does not take a
  // resize, which is how an earlier version of this loop ran all three widths
  // at 1400px and proved nothing.
  for (const width of [1344, 1000, 620]) {
    await mountRunning({ activities: RUNS, activitiesStatus: "ready", height: 900, width });
    const page = await harness("rect", ".running-view");
    assert.ok(
      page.width <= width,
      `the column really is ${width}px wide (page measured ${page.width}px)`
    );
    const overflow = await harness("overflowX", ".running-view");
    if (overflow !== 0) {
      // Name the culprits: "it overflows" is the easy half of a layout bug.
      const offenders = await win.webContents.executeJavaScript(
        `(() => {
          const view = document.querySelector(".running-view");
          const limit = view.getBoundingClientRect().right + 1;
          const describe = (el) => el.tagName + "." + String(el.className).split(" ").join(".") +
            " right=" + Math.round(el.getBoundingClientRect().right) +
            " width=" + Math.round(el.getBoundingClientRect().width) +
            " overflowX=" + getComputedStyle(el).overflowX;
          const offenders = [...view.querySelectorAll("*")]
            .filter((el) => el.getBoundingClientRect().right > limit);
          // The outermost offender is the one to fix; everything inside it is
          // only following. Its parent chain shows which box let it through.
          // An offender inside a box that scrolls on its own is not the page's
          // problem, so those are left out.
          const clippedAway = (el) => {
            for (let up = el.parentElement; up && up !== view; up = up.parentElement) {
              if (getComputedStyle(up).overflowX !== "visible") return true;
            }
            return false;
          };
          const outermost = offenders.filter(
            (el) => !offenders.includes(el.parentElement) && !clippedAway(el)
          );
          const columns = [...document.querySelectorAll(".running-list-panel thead th")].map(
            (th) => th.textContent.trim() + ":" + getComputedStyle(th).display + ":" + Math.round(th.getBoundingClientRect().width)
          );
          const panel = document.querySelector(".running-list-panel");
          const containerInfo = panel
            ? "container-type=" + getComputedStyle(panel).containerType + " width=" + Math.round(panel.getBoundingClientRect().width)
            : "no panel";
          return ["list columns: " + columns.join(" | "), containerInfo, ...outermost.slice(0, 6).flatMap((el) => {
            const chain = [];
            for (let up = el; up && up !== view; up = up.parentElement) chain.push(describe(up));
            return ["--", ...chain];
          })];
        })()`,
        true
      );
      assert.fail(
        `the page scrolls sideways by ${overflow}px in a ${width}px column:\n  ${offenders.join("\n  ")}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // A run's detail: placeholder while it loads, a real failure when it fails.
  // -------------------------------------------------------------------------
  {
    const target = RUNS[0];
    await mountRunning({
      activities: RUNS,
      activitiesStatus: "ready",
      detailRequest: { activityId: target.activityId, status: "pending" },
      busy: `training-detail:${target.activityId}`
    });
    await harness("scrollTo", ".running-view", 1200);
    const leftAt = await harness("scrollTop", ".running-view");
    assert.ok(leftAt > 1000, "the page is long enough to test a return position");

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-list-panel tbody tr")].find((row) => row.textContent.includes(${JSON.stringify(target.name)})).click()`,
      true
    );
    await waitFor(() => harness("exists", ".run-detail"), "the run opens");
    assert.equal(await harness("callCount", "prop:onSelectActivity"), 1);
    assert.equal(
      await harness("exists", ".run-detail-skeleton"),
      true,
      "a run still loading shows the placeholder"
    );
    assert.equal(await hasText("did not load"), false);

    // `busy` is one string for the whole app: something else clearing or
    // replacing it says nothing about this run's request, which is still out.
    await harness("setProps", { busy: null });
    await settle();
    assert.equal(
      await harness("exists", ".run-detail-skeleton"),
      true,
      "a cleared busy flag is not a finished request"
    );
    assert.equal(await hasText("did not load"), false);

    // A reply for a run opened earlier is not this run's, whatever it says.
    await harness("setProps", {
      detailRequest: { activityId: RUNS[5].activityId, status: "failed" }
    });
    await settle();
    assert.equal(await hasText("did not load"), false, "another run's failure is not this one's");

    // This run's request failed.
    await harness("setProps", {
      detailRequest: { activityId: target.activityId, status: "failed" }
    });
    await settle();
    assert.equal(await harness("exists", ".run-detail-skeleton"), false);
    assert.equal(await hasText("detail did not load"), true);
    assert.equal(await harness("clickText", "button", "Try again"), true);
    assert.equal(
      await harness("callCount", "prop:onSelectActivity"),
      2,
      "retry fetches this run again"
    );

    // A detail for a different run is not this run's detail.
    await harness("setProps", {
      detail: { activityId: RUNS[5].activityId, laps: [], hrZones: [], raw: {} }
    });
    await settle();
    assert.equal(await hasText("detail did not load"), true);

    await harness("setProps", {
      detail: {
        activityId: target.activityId,
        distance: target.distance,
        duration: target.duration,
        laps: [],
        hrZones: [],
        raw: {}
      }
    });
    await settle();
    assert.equal(await hasText("detail did not load"), false, "this run's detail arrived");
    assert.equal(await harness("exists", ".run-detail-skeleton"), false);

    await harness("click", ".run-detail-back");
    await waitFor(() => harness("exists", ".running-list-panel"), "back on the list");
    await settle();
    const returnedTo = await harness("scrollTop", ".running-view");
    assert.ok(
      Math.abs(returnedTo - leftAt) <= 2,
      `the list returns to where it was left (left ${leftAt}, back at ${returnedTo})`
    );
  }

  // -------------------------------------------------------------------------
  // The detail page in the narrowest column: seven lap columns, form stats and
  // effect cards must not take the page sideways either.
  // -------------------------------------------------------------------------
  {
    const target = RUNS[1];
    const laps = Array.from({ length: 10 }, (_, index) => ({
      // The parser counts laps from one.
      index: index + 1,
      distance: 1000,
      duration: 360,
      pace: 360,
      avgHr: 150 + index,
      elevationGain: 3,
      avgCadence: 170
    }));
    await mountRunning({
      activities: RUNS,
      activitiesStatus: "ready",
      width: 620,
      height: 900,
      detail: {
        activityId: target.activityId,
        distance: target.distance,
        duration: target.duration,
        avgHr: 150,
        maxHr: 170,
        elevationGain: 30,
        trainingLoad: 90,
        adjustedPace: 355,
        laps,
        hrZones: [],
        dynamics: {
          avgCadence: 170,
          strideLength: 0.9,
          groundTime: 280,
          verticalOscillation: 8.2,
          verticalRatio: 9.4,
          avgPower: 210
        },
        effect: { aerobic: 3.1, anaerobic: 0.4, vo2max: 50 },
        weather: { temperatureC: 27, humidityPct: 80 },
        raw: {}
      }
    });
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-list-panel tbody tr")].find((row) => row.textContent.includes(${JSON.stringify(target.name)})).click()`,
      true
    );
    await waitFor(() => harness("exists", ".run-lap-table"), "the laps render");
    await settle();
    assert.equal(await harness("count", ".run-lap-table tbody tr"), laps.length);
    assert.equal(await harness("exists", ".run-detail-cover"), false, "no track, no cover");
    backOffsetWithoutCover =
      (await harness("rect", ".run-detail-back")).top - (await harness("rect", ".running-view")).top;
    assert.equal(
      await harness("overflowX", ".running-view"),
      0,
      "the detail page scrolls sideways in a 620px column"
    );
  }

  // -------------------------------------------------------------------------
  // The filter chips are the load heatmap's, pressed state included.
  // -------------------------------------------------------------------------
  {
    await mountRunning({ activities: RUNS, activitiesStatus: "ready", width: 1000 });
    const pressed = () =>
      win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".running-controls .training-metric-option[aria-pressed=true]")].map((chip) => chip.textContent.trim())`,
        true
      );
    assert.equal(await harness("count", ".running-controls .training-metric-toggle"), 2);
    assert.deepEqual(await pressed(), ["All", "3 months"]);
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-period .training-metric-option")].find((chip) => chip.textContent.trim() === "1 year").click()`,
      true
    );
    await settle();
    assert.deepEqual(await pressed(), ["All", "1 year"]);
  }

  // -------------------------------------------------------------------------
  // A paused run with a route: activity time throughout, and every panel as
  // tall as what it holds.
  // -------------------------------------------------------------------------
  {
    const target = RUNS[2];
    // A real run's clocks: 10.2 km, 7 102 s start to finish, 4 190 s running,
    // stopped at 1 120 s for 694 s and at 2 524 s for 2 218 s.
    const pauses = [
      { start: 1120, duration: 694 },
      { start: 2524, duration: 2218 }
    ];
    const activeAt = (t) =>
      t - pauses.reduce((sum, p) => sum + (p.start < t ? Math.min(p.duration, t - p.start) : 0), 0);
    const series = [];
    for (let t = 0; t <= 7102; t += 2) {
      if (pauses.some((p) => t > p.start && t < p.start + p.duration)) continue;
      series.push({ elapsed: t, distance: (activeAt(t) / 4190) * 10_200, hr: 150, pace: 411 });
    }
    const laps = Array.from({ length: 10 }, (_, index) => ({
      index: index + 1,
      distance: 1000,
      duration: 411,
      pace: 411,
      avgHr: 150
    }));
    const track = {
      points: Array.from({ length: 60 }, (_, index) => ({
        lat: 10.748 + index * 0.0005,
        lon: 106.724 + Math.sin(index / 6) * 0.002
      }))
    };
    const activities = RUNS.map((entry) =>
      entry.activityId === target.activityId
        ? { ...entry, distance: 10_200, duration: 4190, elapsedDuration: 7102 }
        : entry
    );

    await mountRunning({
      activities,
      activitiesStatus: "ready",
      width: 1000,
      height: 800,
      detail: {
        activityId: target.activityId,
        distance: 10_200,
        duration: 4190,
        elapsedDuration: 7102,
        pauses,
        avgHr: 150,
        laps,
        hrZones: [],
        series,
        track,
        raw: {}
      }
    });
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-list-panel tbody tr")].find((row) => row.textContent.includes(${JSON.stringify(target.name)})).click()`,
      true
    );
    await waitFor(() => harness("exists", ".run-chart-segment"), "the chart renders");
    await waitFor(() => harness("exists", ".run-detail-cover .activity-route-map-canvas"), "the route cover renders");
    await settle();

    const stats = await win.webContents.executeJavaScript(
      `Object.fromEntries([...document.querySelectorAll(".run-detail-hero .run-detail-stats .running-stat")].map((stat) => [stat.querySelector("span").textContent, stat.querySelector("strong").textContent]))`,
      true
    );
    assert.equal(stats.Time, "1:09:50", "Time is the running, not the wait");
    assert.equal(stats["Total time"], "1:58:22", "start to finish still has its place");
    assert.equal(stats.Pace, "6:51 /km");

    const wholeRun = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-chart-segment span")].map((span) => span.textContent).find((text) => /^\\d+:\\d\\d(:\\d\\d)?$/.test(text))`,
      true
    );
    assert.ok(wholeRun, "the segment states a duration");
    assert.equal(wholeRun, "1:09:50", "the whole run is COROS's activity time, read directly");

    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector(".run-lap-table tbody tr td").textContent`,
        true
      ),
      "1",
      "laps count from one"
    );

    const pressedAxis = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-chart-axis .training-metric-option[aria-pressed=true]")].map((chip) => chip.textContent.trim())`,
      true
    );
    assert.deepEqual(pressedAxis, ["Time"]);
    assert.equal(await harness("count", ".run-chip.is-active"), 2, "pace and heart rate open");

    // "Try again" re-fetches the same run and hands back a new detail object
    // with the same readings. That is not a different run, and the athlete's
    // chip choice survives it — the reset used to key on the object.
    await win.webContents.executeJavaScript(
      `document.querySelectorAll(".run-chip.is-active")[1].click()`,
      true
    );
    await settle();
    assert.equal(await harness("count", ".run-chip.is-active"), 1, "one channel turned off");
    await harness("setProps", {
      detail: {
        activityId: target.activityId,
        distance: 10_200,
        duration: 4190,
        elapsedDuration: 7102,
        pauses: pauses.map((pause) => ({ ...pause })),
        avgHr: 150,
        laps: laps.map((lap) => ({ ...lap })),
        hrZones: [],
        series: series.map((point) => ({ ...point })),
        track,
        raw: {}
      }
    });
    await settle();
    assert.equal(
      await harness("count", ".run-chip.is-active"),
      1,
      "the same run's detail arriving again keeps the channels the athlete chose"
    );
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-chip")].find((chip) => !chip.classList.contains("is-active")).click()`,
      true
    );
    await settle();
    assert.equal(await harness("count", ".run-chip.is-active"), 2);

    // No panel's content reaches past its own bottom edge — which is what a
    // squeezed grid row looks like, whatever squeezed it. Content inside
    // something that clips (Leaflet's panes are far larger than the map) is
    // not on screen to overlap anything, so it does not count.
    const spills = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-detail > *")].flatMap((panel) => {
        const bottom = panel.getBoundingClientRect().bottom;
        const clipped = (child) => {
          for (let up = child.parentElement; up && up !== panel; up = up.parentElement) {
            if (getComputedStyle(up).overflow !== "visible") return true;
          }
          return false;
        };
        return [...panel.querySelectorAll("*")]
          // The route cover's faded tail hangs under the next panel by design.
          .filter((child) => !child.closest(".run-detail-cover"))
          .filter((child) => !clipped(child) && child.getBoundingClientRect().bottom > bottom + 1)
          .slice(0, 1)
          .map((child) => panel.className + " is " + Math.round(panel.getBoundingClientRect().height) + "px but holds " + child.className + " down to " + Math.round(child.getBoundingClientRect().bottom - bottom) + "px below it");
      })`,
      true
    );
    assert.deepEqual(spills, [], "a panel was squeezed below its content");
    // The route is a cover under the heading, not a panel of its own.
    assert.equal(await harness("exists", ".run-detail-map"), false);
    const view = await harness("rect", ".running-view");
    const cover = await harness("rect", ".run-detail-cover");
    assert.ok(
      cover.height >= Math.floor(cover.width / 3),
      `the cover is ${cover.width}×${cover.height}, shorter than three to one`
    );
    // Ten stats wrap onto two rows in this column, and the map grows to lie
    // under the second as well as the first.
    const statRows = await win.webContents.executeJavaScript(
      `new Set([...document.querySelectorAll(".run-detail-hero .running-stat")].map((stat) => Math.round(stat.getBoundingClientRect().top))).size`,
      true
    );
    assert.ok(statRows >= 2, `the fixture should wrap the stats (got ${statRows} row)`);
    const statsBox = await harness("rect", ".run-detail-hero .run-detail-stats");
    assert.ok(
      cover.top + cover.height >= statsBox.top + statsBox.height + 60,
      `the map ends at ${cover.top + cover.height}, above the stats' last row (${statsBox.top + statsBox.height})`
    );
    assert.equal(cover.top, view.top, "the cover starts at the top of the page");
    const back = await harness("rect", ".run-detail-back");
    assert.equal(back.top - view.top, backOffsetWithoutCover, "the back button has not moved");
    const title = await harness("rect", ".run-detail-title");
    assert.ok(
      // The clear band is 15% of the width however tall the cover grows.
      title.top - cover.top >= cover.width * 0.13 && title.top < cover.top + cover.height,
      `the title starts ${title.top - cover.top}px into a ${cover.width}×${cover.height} cover — it should leave the top of the map showing and still sit on it`
    );

    // The tile credit: required, so never left out, but folded into an (i)
    // after five seconds as the OSM attribution guidelines allow.
    const credit = () =>
      win.webContents.executeJavaScript(
        // Read off the state class, not computed visibility: the fade is a
        // transition, and a hidden window never gets the frames to finish one.
        `(() => { const el = document.querySelector(".run-detail-cover .leaflet-control-attribution"); return el && { text: el.textContent, shown: Boolean(el.closest(".run-detail-cover.is-credit-open")) }; })()`,
        true
      );
    const first = await credit();
    assert.equal(first.shown, true, "the credit is spelled out at first");
    assert.ok(first.text.includes("OpenStreetMap"), `the credit names OpenStreetMap: ${first.text}`);
    assert.equal(first.text.includes("Leaflet"), false, "no Leaflet prefix");
    await waitFor(async () => !(await credit()).shown, "the credit folds away", 7_000);
    await harness("click", ".activity-route-cover-credit");
    await waitFor(async () => (await credit()).shown, "the (i) brings it back");
    assert.equal(await harness("exists", ".activity-route-modal"), false, "the (i) does not open the map");

    // A click on the showing part of the map — found by hit-testing, so a
    // heading that swallowed the click would fail here — opens the full map.
    const hit = await win.webContents.executeJavaScript(
      `(() => {
        const box = document.querySelector(".run-detail-cover").getBoundingClientRect();
        const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height * 0.2);
        const onCover = Boolean(target?.closest(".run-detail-cover"));
        target?.click();
        return onCover;
      })()`,
      true
    );
    assert.equal(hit, true, "the top of the cover is not covered by the heading");
    await waitFor(() => harness("exists", ".activity-route-modal"), "the full map opens");

    // The full map folds its credit the same way the cover does.
    await waitFor(
      () => harness("exists", ".activity-route-modal .leaflet-control-attribution"),
      "the full map credits its tiles"
    );
    assert.equal(
      (await harness("text", ".activity-route-modal .leaflet-control-attribution")).includes("Leaflet"),
      false,
      "no Leaflet prefix on the full map either"
    );
    assert.equal(await harness("exists", ".activity-route-modal-map.is-credit-open"), true);
    await waitFor(
      async () => !(await harness("exists", ".activity-route-modal-map.is-credit-open")),
      "the full map's credit folds away",
      7_000
    );
    await harness("click", ".activity-route-credit-toggle");
    assert.equal(await harness("exists", ".activity-route-modal-map.is-credit-open"), true, "its (i) brings it back");
    assert.equal(await harness("exists", ".activity-route-modal"), true, "and leaves the map open");

    // One Escape closes the map and leaves the run open.
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await waitFor(async () => !(await harness("exists", ".activity-route-modal")), "Escape closes the map");
    await settle();
    assert.equal(await harness("exists", ".run-detail"), true, "and only the map");

    // A backdrop click closes it for good rather than bubbling back into the
    // cover and opening it again.
    await harness("click", ".activity-route-cover-open");
    await waitFor(() => harness("exists", ".activity-route-modal"), "the button opens it too");
    await harness("click", ".activity-route-modal-backdrop");
    await settle();
    assert.equal(await harness("exists", ".activity-route-modal"), false, "the backdrop closes it");

    // Only the either/or switches took the heatmap's look; the channel chips
    // are a pick-any-two set and keep their own, coloured by channel.
    assert.equal(await harness("count", ".run-chart-chips .training-metric-option"), 0);
    const chipColours = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-chip.is-active")].map((chip) => chip.style.borderColor)`,
      true
    );
    assert.equal(chipColours.length, 2);
    assert.ok(chipColours.every(Boolean), "a pressed channel chip wears its channel's colour");
  }

  // -------------------------------------------------------------------------
  // Detail summaries: the two figures a run list cannot get from the list.
  //
  // They arrive after the rows do — a detail is 2.5 MB, so they are computed
  // once and kept as a row per run — which is exactly why the screen must be
  // complete without them and must not wait.
  // -------------------------------------------------------------------------
  {
    const summarised = RUNS.slice(0, 2).map((activity, index) => ({
      activityId: activity.activityId,
      fingerprint: "fp",
      summaryVersion: 1,
      // Mostly zone 1-2 on the first, mostly zone 4 on the second.
      zoneSeconds: index === 0 ? [0, 1800, 1500, 300, 0, 0] : [0, 0, 300, 600, 2400, 300],
      decouplingPercent: index === 0 ? 4.25 : -1.5,
      computedAt: Date.now()
    }));

    await mountRunning(
      { activities: RUNS, activitiesStatus: "ready", snapshot: SNAPSHOT_WITH_ZONES },
      {
        getActivityDetailSummaries: summarised,
        syncActivityDetailSummaries: { computed: 0, remaining: 0, failed: 0, summaries: [] }
      }
    );
    await settle();

    assert.equal(await hasText("Drift"), true, "the list carries a drift column");
    const drift = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-list-panel tbody tr")].map(
         (row) => row.lastElementChild.textContent
       )`,
      true
    );
    assert.equal(drift.length, RUNS.length);
    assert.equal(drift[0], "+4.3%", "a run that drifted reads with its sign");
    assert.equal(drift[1], "-1.5%", "and one that did not is not shown as drift");
    assert.equal(
      drift.filter((value) => value === "—").length,
      RUNS.length - 2,
      "every run without a summary reads as a dash rather than a zero"
    );

    // An eighth column, and the narrow width is where a table stops fitting.
    // The earlier seven already pushed the page into a horizontal scrollbar
    // once, and "—" in every drift cell is not the width that matters: a filled
    // column is wider than an empty one.
    await mountRunning(
      {
        activities: RUNS,
        activitiesStatus: "ready",
        snapshot: SNAPSHOT_WITH_ZONES,
        height: 900,
        width: 620
      },
      {
        getActivityDetailSummaries: RUNS.map((activity, index) => ({
          activityId: activity.activityId,
          fingerprint: "fp",
          summaryVersion: 1,
          zoneSeconds: [0, 1800, 1500, 300, 0, 0],
          decouplingPercent: index % 2 === 0 ? 12.75 : -8.5,
          computedAt: Date.now()
        })),
        syncActivityDetailSummaries: { computed: 0, remaining: 0, failed: 0, summaries: [] }
      }
    );
    await settle();
    assert.equal(
      await harness("overflowX", ".running-view"),
      0,
      "a drift column with a value in every row still fits the narrow page"
    );

    await mountRunning(
      { activities: RUNS, activitiesStatus: "ready", snapshot: SNAPSHOT_WITH_ZONES },
      {
        getActivityDetailSummaries: summarised,
        syncActivityDetailSummaries: { computed: 0, remaining: 0, failed: 0, summaries: [] }
      }
    );
    await settle();

    // The backfill is asked for, and for the runs on screen.
    const sweeps = await harness("calls", "syncActivityDetailSummaries");
    assert.ok(sweeps.length > 0, "missing summaries are asked for");
    assert.equal(
      sweeps[0].args[0].length,
      RUNS.length,
      "the sweep covers the list on screen"
    );

    assert.equal(
      await hasText("2 of 30 runs are split by their time in each zone"),
      true,
      "the intensity panel says which reading each run got"
    );

    // Zone time and average heart rate disagree on purpose: all 30 runs average
    // 150 bpm, which is easy, and the one summarised as mostly zone 4 must move
    // its time out of the easy band.
    const hard = await win.webContents.executeJavaScript(
      `document.querySelector(".run-intensity-row .run-intensity-seg.tone-hard") !== null`,
      true
    );
    assert.equal(hard, true, "a run scored into zone 4 shows up as hard time");
  }

  // -------------------------------------------------------------------------
  // Every block reads one window. The period filter cut at now − N days while
  // the charts bucket by calendar week, so on any day but Monday the totals
  // strip counted runs no bar held. And "a year ago" must not overlap the bars.
  // -------------------------------------------------------------------------
  {
    const periodRuns = [
      ...Array.from({ length: 40 }, (_, index) =>
        run(index, { startTime: nowSeconds - index * DAY_SECONDS })
      ),
      // One run a year and a bit back, inside "3 months" seen a year earlier.
      run(90, { startTime: nowSeconds - 400 * DAY_SECONDS }),
      // And one over two years back, which any comparison window "All" might
      // shift to would find — so hiding the aside is the rule, not the data.
      run(91, { startTime: nowSeconds - 800 * DAY_SECONDS })
    ];
    const readTotals = () =>
      win.webContents.executeJavaScript(
        `(() => {
          const strip = [...document.querySelectorAll(".running-totals .running-stat")]
            .find((stat) => stat.querySelector("span").textContent === "Distance");
          const heading = [...document.querySelectorAll(".run-block")]
            .find((block) => block.textContent.includes("Weekly volume"));
          return {
            strip: parseFloat(strip.querySelector("strong").textContent),
            chart: parseFloat(heading.querySelector("h3").textContent),
            yearAgo: heading.textContent.includes("Same span a year ago")
          };
        })()`,
        true
      );
    const pickPeriod = (label) =>
      win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".running-period .training-metric-option")].find((chip) => chip.textContent.trim() === ${JSON.stringify(label)}).click()`,
        true
      );

    await mountRunning({ activities: periodRuns, activitiesStatus: "ready", width: 1000 });
    await pickPeriod("4 weeks");
    await settle();
    const fourWeeks = await readTotals();
    assert.ok(
      Math.abs(fourWeeks.strip - fourWeeks.chart) < 1,
      `the totals strip and the volume chart count the same runs (${fourWeeks.strip} vs ${fourWeeks.chart})`
    );

    await pickPeriod("3 months");
    await settle();
    assert.equal((await readTotals()).yearAgo, true, "a three-month window has a year-ago twin");

    await pickPeriod("All");
    await settle();
    assert.equal(
      (await readTotals()).yearAgo,
      false,
      "a two-year chart has no 'same span a year ago' that is not half itself"
    );
  }

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors, [], "the page logged errors");

  console.log("running renderer tests passed");
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);
