// The Hiking screen, mounted for real in Electron's Chromium.
//
// It draws with Running's stylesheet as Cycling does, so the layout traps the
// other two sport suites hold down are asked again of it — an empty list read
// three ways, a list at its full height, no sideways scroll — along with what
// is Hiking's own: hikes split by kind, a week read in metres climbed, no
// pace anywhere, no load ratio and no 80/20 mark, and a hike page that finds
// the moving time and the rests in the samples, splits the day into climbing,
// flat and descending, lists its ascents and descents, and reads its channel
// chart in km/h and metres an hour.
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

/** A hike `index * 5 + 2` days back; the screen's default window is 90 days. */
function hike(index, overrides = {}) {
  return {
    activityId: `hike-${index}`,
    name: `Hike ${index}`,
    sportType: 104,
    startTime: nowSeconds - (index * 5 + 2) * DAY_SECONDS,
    duration: 4 * 3600,
    distance: 11_000,
    avgHr: 124,
    maxHr: 158,
    trainingLoad: 300,
    elevationGain: 750,
    ...overrides
  };
}

const HIKES = [
  ...Array.from({ length: 12 }, (_, index) => hike(index)),
  hike(12, { sportType: 105, name: "Summit day", distance: 9000, duration: 6 * 3600, elevationGain: 1250 }),
  hike(13, { sportType: 105, name: "Second summit", distance: 8000, duration: 5 * 3600, elevationGain: 1100 })
];
const RUN = {
  activityId: "run-1",
  name: "Trail run",
  sportType: 102,
  startTime: nowSeconds - DAY_SECONDS,
  duration: 3000,
  distance: 10_000
};

const PROFILE = {
  profile: {
    hrZoneType: 3,
    weightKg: 70,
    thresholds: {
      lthr: 168,
      zones: {
        maxHr: [],
        restingHr: [],
        lthr: [133, 154, 168, 173, 183, 404].map((bpm, index) => ({ index, bpm })),
        thresholdPace: [],
        cyclePower: []
      },
      ranges: {}
    }
  },
  dashboard: null,
  cachedAt: new Date().toISOString()
};

const QUIET = {
  getCorosProfileSnapshot: PROFILE,
  getActivityDetailSummaries: [],
  syncActivityDetailSummaries: { computed: 0, remaining: 0, failed: 0, summaries: [] }
};

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

async function mountHiking(options, script = QUIET) {
  await harness("mount", "HikingView", options, script);
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

async function listRowCount() {
  return harness("count", ".running-list-panel tbody tr");
}

async function noPace() {
  return win.webContents.executeJavaScript(
    String.raw`!/\d:\d\d \/(km|mi)/.test(document.body.textContent)`,
    true
  );
}

/**
 * The detail a hike page opens on, a second at a time: 1.2 km of flat, a 2 km
 * climb at 15%, ten minutes on top with the watch recording, 1 km down, a
 * twenty-minute auto-pause, 1 km more down.
 */
function hikeDetail(activityId) {
  const series = [];
  let t = 0;
  let d = 0;
  let alt = 400;
  const walk = (meters, grade, speed) => {
    for (let s = 0; s < Math.round(meters / speed); s += 1) {
      series.push({ elapsed: t, distance: d, altitude: alt, hr: grade > 0 ? 148 : 116, pace: 1000 / speed, cadence: grade > 0 ? 88 : 104 });
      t += 1;
      d += speed;
      alt += speed * grade;
    }
  };
  walk(1200, 0, 1.4);
  walk(2000, 0.15, 0.6);
  for (let s = 0; s < 600; s += 1) {
    series.push({ elapsed: t, distance: d, altitude: alt, hr: 92, cadence: 0 });
    t += 1;
  }
  walk(1000, -0.15, 0.9);
  const pauseAt = t;
  t += 1200;
  walk(1000, -0.15, 0.9);
  const duration = series.length;
  const laps = [];
  for (let km = 0; km * 1000 < d; km += 1) {
    const inLap = series.filter((point) => point.distance >= km * 1000 && point.distance < (km + 1) * 1000);
    laps.push({ index: km + 1, distance: Math.min(1000, d - km * 1000), duration: inLap.length, avgHr: 130, avgCadence: 96, elevationGain: 50 });
  }
  return {
    activityId,
    name: "Hike 0",
    sportType: 104,
    duration,
    elapsedDuration: duration + 1200,
    distance: Math.round(d),
    avgHr: 128,
    maxHr: 158,
    elevationGain: 300,
    elevationLoss: 300,
    trainingLoad: 180,
    pauses: [{ start: pauseAt, duration: 1200 }],
    laps,
    dynamics: { avgCadence: 96, maxCadence: 118 },
    hrZones: [],
    series
  };
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

  // -------------------------------------------------------------------------
  // An empty list says nothing by itself — the status decides which screen.
  // -------------------------------------------------------------------------
  {
    await mountHiking({ activities: [], activitiesStatus: "pending" });
    assert.equal(await harness("exists", '[aria-label="Loading your hikes"]'), true, "loading, named for hikes");
    assert.equal(await hasText("No hikes"), false, "loading is not 'no hikes'");
    assert.equal(await harness("exists", ".running-totals"), false, "no zeros before the list");

    await mountHiking({ activities: [], activitiesStatus: "failed" });
    assert.equal(await hasText("did not load"), true);
    assert.equal(await harness("clickText", "button", "Try again"), true);
    assert.equal(await harness("callCount", "prop:onRetryActivities"), 1);

    await mountHiking({ activities: [RUN], activitiesStatus: "ready" });
    assert.equal(await hasText("No hikes yet"), true, "a trail run is a run, not a hike");

    await mountHiking({ activities: [], activitiesStatus: "ready", connected: false });
    assert.equal(await hasText("Connect COROS first"), true);
  }

  // -------------------------------------------------------------------------
  // The page: hikes only, at full height, split by kind, with a walker's hero.
  // -------------------------------------------------------------------------
  {
    await mountHiking({ activities: [RUN, ...HIKES], activitiesStatus: "ready", height: 700 });
    await waitFor(() => hasText("of hiking time is easy"), "the intensity panel draws once the zones land");

    assert.equal(await listRowCount(), HIKES.length, "every hike listed, the trail run left out");
    const panel = await harness("rect", ".running-list-panel");
    assert.ok(panel.height >= HIKES.length * 40, `the list panel is ${panel.height}px — a collapsed grid track`);

    for (const label of ["Ascent this week", "Biggest day", "Ascent per hour", "Kinds"]) {
      assert.equal(await hasText(label), true, `the page states ${label}`);
    }
    assert.equal(await hasText("Summit day"), true, "the biggest day is named");
    for (const absent of ["Load ratio", "VO₂max", "Threshold pace", "80/20", "Aerobic efficiency"]) {
      assert.equal(await hasText(absent), false, `${absent} is a runner's figure and not this screen's`);
    }
    assert.equal(await noPace(), true, "no pace anywhere: a walker reads km/h");
    assert.equal(await hasText("km/h"), true, "the speed that stands in for it");

    for (const label of ["Hike", "Mountain climb"]) {
      assert.equal(
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll(".running-controls button")].some((b) => b.textContent.trim() === ${JSON.stringify(label)})`,
          true
        ),
        true,
        `a ${label} chip`
      );
    }
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-controls button")].find((b) => b.textContent.trim() === "Mountain climb").click()`,
      true
    );
    await settle();
    assert.equal(await listRowCount(), 2, "the chip narrows the list to mountain climbs");

    const heading = () =>
      win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".run-block")].find((b) => b.textContent.includes("Weekly volume")).querySelector("h3").textContent`,
        true
      );
    assert.match(await heading(), /^\d+ m\b/, "a hiking week opens on metres climbed");
    assert.equal(await hasText("Biggest ascent"), true);
    assert.equal(await harness("clickText", ".sport-volume-aside button", "Time"), true);
    await settle();
    assert.match(await heading(), /^\d+ h\b/, "hours once Time is picked");
    assert.equal(await hasText("Longest day"), true, "the dashed line follows the measure");
    assert.equal(await harness("clickText", ".sport-volume-aside button", "Distance"), true);
    await settle();
    assert.match(await heading(), /\d+ km/, "kilometres once Distance is picked");
  }

  // -------------------------------------------------------------------------
  // No horizontal scroll, from a wide column down to the app's minimum.
  // -------------------------------------------------------------------------
  for (const width of [1344, 1000, 620]) {
    await mountHiking({ activities: HIKES, activitiesStatus: "ready", height: 900, width });
    await waitFor(() => hasText("of hiking time is easy"), "the page is complete");
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the page scrolls sideways by ${overflow}px in a ${width}px column`);
  }

  // -------------------------------------------------------------------------
  // A hike's page: placeholder, then a walker's figures read out of the samples.
  // -------------------------------------------------------------------------
  {
    const target = HIKES[0];
    await mountHiking({
      activities: HIKES,
      activitiesStatus: "ready",
      detailRequest: { activityId: target.activityId, status: "pending" }
    });
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-list-panel tbody tr")].find((row) => row.textContent.includes(${JSON.stringify(target.name)})).click()`,
      true
    );
    await waitFor(() => harness("exists", ".run-detail"), "the hike opens");
    assert.equal(await harness("callCount", "prop:onSelectActivity"), 1);
    assert.equal(await harness("exists", '[aria-label="Loading this hike"]'), true);

    await harness("setProps", {
      detail: hikeDetail(target.activityId),
      detailRequest: { activityId: target.activityId, status: "ready" }
    });
    await waitFor(() => harness("exists", ".activity-chart-chips"), "the channel chart draws");
    await settle();

    const chips = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".activity-chart-chips button")].map((b) => b.textContent.trim())`,
      true
    );
    assert.ok(chips.includes("Climbing rate") && chips.includes("Speed"), `a hike's chart reads climbing rate and speed: ${chips}`);
    assert.ok(!chips.includes("Pace") && !chips.includes("Grade-adjusted pace"), `and no pace: ${chips}`);
    assert.equal(await noPace(), true, "no pace on the page either");

    for (const label of ["Moving time", "Total time", "Highest point", "Climbing rate", "Vs Naismith", "Terrain", "Rests"]) {
      assert.equal(await hasText(label), true, `the hike page states ${label}`);
    }
    assert.equal(await hasText("Descending"), true, "the way down is half the day");
    assert.equal(await hasText("1 ascent · 1 descent"), true, "the legs, named");
    assert.equal(await harness("count", ".terrain-leg-dir"), 2);
    assert.equal(await harness("count", ".hike-rest-paused"), 1, "the auto-pause is a rest, marked as one");
    assert.equal(
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".run-detail-panel")].find((p) => p.textContent.startsWith("Rests")).querySelectorAll("tbody tr").length`,
        true
      ),
      2,
      "the top and the pause are the rests"
    );
    assert.equal(await hasText("Whole hike"), true, "the segment is the hike's");
    assert.equal(await hasText("spm"), true, "cadence in steps");
    assert.equal(await hasText("rpm"), false);
    assert.equal(await hasText("Running form"), false, "a hiking watch records no running form");
    assert.equal(await harness("count", ".run-lap-table tbody tr"), 6, "a split a kilometre");

    assert.equal(await harness("text", ".run-detail-back span"), "Hiking");
    assert.equal(await harness("clickText", ".run-detail-back", "Hiking"), true);
    await settle();
    assert.equal(await harness("exists", ".run-detail"), false, "Back returns to the list");
    assert.equal(await listRowCount(), HIKES.length);
  }

  // -------------------------------------------------------------------------
  // The hike page's tables scroll inside their panels, never the page.
  // -------------------------------------------------------------------------
  for (const width of [1000, 620]) {
    const target = HIKES[0];
    await mountHiking({
      activities: HIKES,
      activitiesStatus: "ready",
      width,
      openRequest: { view: "hiking", activityId: target.activityId },
      detail: hikeDetail(target.activityId),
      detailRequest: { activityId: target.activityId, status: "ready" }
    });
    await waitFor(() => harness("exists", ".terrain-leg-dir"), "the hike page draws its legs");
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the hike page scrolls sideways by ${overflow}px in a ${width}px column`);
  }

  // -------------------------------------------------------------------------
  // A hike handed over from Activities opens at once, and Back goes back there.
  // -------------------------------------------------------------------------
  {
    const target = HIKES[12];
    await mountHiking({
      activities: HIKES,
      activitiesStatus: "ready",
      openRequest: { view: "hiking", activityId: target.activityId, from: "training" }
    });
    await waitFor(() => harness("exists", ".run-detail"), "the handed-over hike opens");
    assert.ok((await harness("callCount", "prop:onOpenRequestHandled")) >= 1, "the request is taken");
    await harness("setProps", { openRequest: null });
    await settle();
    assert.equal(await harness("exists", ".run-detail"), true, "and the hike stays open once it is");
    assert.equal(await harness("text", ".run-detail-back span"), "Activities");
    assert.equal(await hasText("Mountain climb ·"), true, "the eyebrow names the kind");
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

  console.log("hiking renderer tests passed");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
