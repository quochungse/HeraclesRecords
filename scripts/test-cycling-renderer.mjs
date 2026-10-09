// The Cycling screen, mounted for real in Electron's Chromium.
//
// It draws with Running's stylesheet and several of its pieces, so the layout
// traps test-running-renderer holds down are asked again here of the page that
// was built on top of them — an empty list read three ways, a list that must
// keep its full height in a column that cannot grow, no sideways scroll — along
// with what is Cycling's own: rides split by bike, a week read in hours, speed
// in place of pace, and a ride page whose channel chart reads km/h and rpm,
// with power (NP, IF, TSS, peaks, COROS's power zones) and the climbs on it.
//
// The device scale is pinned to 1. The layout asserts compare boxes, and on a
// display scaled to 125% every box comes back a few thousandths of a pixel off
// its CSS size.
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

/** A road ride `index * 2 + 2` days back; the screen's default window is 90 days. */
function ride(index, overrides = {}) {
  return {
    activityId: `ride-${index}`,
    name: `Ride ${index}`,
    sportType: 200,
    startTime: nowSeconds - (index + 1) * DAY_SECONDS * 2,
    duration: 3600,
    distance: 30_000,
    avgHr: 140,
    maxHr: 165,
    trainingLoad: 80,
    elevationGain: 350,
    ...overrides
  };
}

const RIDES = [
  ...Array.from({ length: 20 }, (_, index) => ride(index)),
  ride(20, { sportType: 203, name: "Gravel loop", distance: 45_000, duration: 7200 }),
  ride(21, { sportType: 203, name: "Gravel two", distance: 40_000, duration: 6000 }),
  ride(22, { sportType: 201, name: "Trainer hour", distance: 0, elevationGain: 0 })
];
const RUN = {
  activityId: "run-1",
  name: "Run",
  sportType: 100,
  startTime: nowSeconds - DAY_SECONDS,
  duration: 3000,
  distance: 10_000
};

const PROFILE = {
  profile: {
    hrZoneType: 3,
    weightKg: 70,
    thresholds: {
      ftp: 250,
      lthr: 168,
      zones: {
        maxHr: [],
        restingHr: [],
        lthr: [133, 154, 168, 173, 183, 404].map((bpm, index) => ({ index, bpm })),
        thresholdPace: [],
        // COROS's ceilings for FTP 250, the last a sentinel.
        cyclePower: [140, 188, 225, 263, 300, 375, 900].map((watts, index) => ({ index, watts }))
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
    await win.webContents.executeJavaScript(
      "new Promise((resolve) => setTimeout(resolve, 60))",
      true
    );
  }
}

async function mountCycling(options, script = QUIET) {
  await harness("mount", "CyclingView", options, script);
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

/**
 * The detail a ride page opens on: an hour a second at a time at 30 km/h with a
 * power meter — ten flat kilometres, three at 7% (a Cat 3), then down again.
 */
function rideSeries() {
  return Array.from({ length: 3600 }, (_, t) => {
    const distance = t * (30_000 / 3600);
    const altitude =
      distance < 10_000 ? 20 : distance < 13_000 ? 20 + (distance - 10_000) * 0.07 : Math.max(20, 230 - (distance - 13_000) * 0.02);
    return {
      elapsed: t,
      distance,
      altitude,
      pace: 120,
      hr: 130 + (t % 12),
      power: distance >= 13_000 && distance < 20_000 ? 0 : 190 + (t % 25),
      cadence: 85
    };
  });
}

function rideDetail(activityId, overrides = {}) {
  return {
    activityId,
    name: "Ride 0",
    sportType: 200,
    duration: 3600,
    distance: 30_000,
    avgHr: 140,
    maxHr: 165,
    elevationGain: 350,
    elevationLoss: 340,
    trainingLoad: 80,
    laps: [
      { index: 1, distance: 15_000, duration: 1800, avgHr: 138, avgCadence: 86, avgPower: 205 },
      { index: 2, distance: 15_000, duration: 1800, avgHr: 142, avgCadence: 84, avgPower: 212 }
    ],
    dynamics: { avgPower: 208, maxPower: 480, avgCadence: 85, maxCadence: 112 },
    hrZones: [],
    series: rideSeries(),
    ...overrides
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
  // Nothing here needs the network.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // -------------------------------------------------------------------------
  // An empty list says nothing by itself — the status decides which screen.
  // -------------------------------------------------------------------------
  {
    await mountCycling({ activities: [], activitiesStatus: "pending" });
    assert.equal(
      await harness("exists", '[aria-label="Loading your rides"]'),
      true,
      "loading shows the placeholder, named for rides"
    );
    assert.equal(await hasText("No rides"), false, "loading is not 'no rides'");
    assert.equal(await harness("exists", ".running-totals"), false, "no zeros before the list");

    await mountCycling({ activities: [], activitiesStatus: "failed" });
    assert.equal(await hasText("did not load"), true, "a failed load says so");
    assert.equal(await harness("clickText", "button", "Try again"), true);
    assert.equal(await harness("callCount", "prop:onRetryActivities"), 1, "retry reloads");

    await mountCycling({ activities: [], activitiesStatus: "ready" });
    assert.equal(await hasText("No rides yet"), true);

    await mountCycling({ activities: [RUN], activitiesStatus: "ready" });
    assert.equal(await hasText("No rides yet"), true, "a history of runs has no rides in it");

    await mountCycling({ activities: [], activitiesStatus: "ready", connected: false });
    assert.equal(await hasText("Connect COROS first"), true);
  }

  // -------------------------------------------------------------------------
  // The page: rides only, at full height, split by bike, with a rider's hero.
  // -------------------------------------------------------------------------
  {
    await mountCycling({ activities: [RUN, ...RIDES], activitiesStatus: "ready", height: 700 });
    await waitFor(() => hasText("of riding time is easy"), "the intensity panel draws once the zones land");

    assert.equal(await listRowCount(), RIDES.length, "every ride listed, the run left out");
    const panel = await harness("rect", ".running-list-panel");
    assert.ok(
      panel.height >= RIDES.length * 40,
      `the list panel is ${panel.height}px for ${RIDES.length} rows — a collapsed grid track`
    );

    assert.equal(await hasText("250 W"), true, "FTP from the COROS profile");
    assert.doesNotMatch(
      await harness("text", ".run-hero-card .run-hero-value"),
      /km|mi/,
      "the week is read in hours, not distance: a trainer hour measures none"
    );
    assert.equal(await hasText("3.57 W/kg"), true, "and per kilo, from its weight");
    assert.equal(await hasText("Load ratio"), true);
    assert.equal(await hasText("VO₂max"), false, "no cycling VO₂max from COROS, no card");
    assert.equal(await hasText("km/h"), true, "speed stands where pace does");
    assert.equal(
      await win.webContents.executeJavaScript(
        String.raw`/\d:\d\d \/(km|mi)/.test(document.body.textContent)`,
        true
      ),
      false,
      "and no pace anywhere"
    );
    assert.equal(await hasText("Bikes"), true, "the split by bike");
    assert.equal(await hasText("Aerobic efficiency"), false, "no efficiency chart for a bike");

    // The bike chips are the kinds present and nothing else.
    for (const label of ["Road", "Gravel", "Indoor"]) {
      assert.equal(
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll(".running-controls button")].some((b) => b.textContent.trim() === ${JSON.stringify(label)})`,
          true
        ),
        true,
        `a ${label} chip`
      );
    }
    assert.equal(
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".running-controls button")].some((b) => b.textContent.trim() === "Mountain")`,
        true
      ),
      false,
      "no chip for a bike with no rides"
    );

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-controls button")].find((b) => b.textContent.trim() === "Gravel").click()`,
      true
    );
    await settle();
    assert.equal(await listRowCount(), 2, "the Gravel chip narrows the list to gravel rides");
    assert.equal(await hasText("Load ratio · all rides"), true, "and the ratio says it is still every ride");

    // The volume chart's measure switch moves the heading's unit.
    const heading = () =>
      win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".run-block")].find((b) => b.textContent.includes("Weekly volume")).querySelector("h3").textContent`,
        true
      );
    assert.match(await heading(), /^\d+ h\b/, "hours first, as the hero's week is read");
    assert.equal(await harness("clickText", ".sport-volume-aside button", "Distance"), true);
    await settle();
    assert.match(await heading(), /\d+ km/, "kilometres once Distance is picked");
    assert.equal(await harness("clickText", ".sport-volume-aside button", "Climb"), true);
    await settle();
    assert.match(await heading(), /^\d+ m\b/, "metres once Climb is picked");
    assert.equal(await hasText("Hilliest ride"), true, "the dashed line follows the measure");
  }

  // -------------------------------------------------------------------------
  // COROS's cycling VO₂max is a fifth card, only once COROS has one. The
  // running vo2max beside it is not this screen's, and a 0 is no reading.
  // -------------------------------------------------------------------------
  {
    const day = (offset) => {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    };
    const snapshotWith = (dayList) => ({ dailyMetrics: { dayList, weekList: [] }, analytics: null });

    await mountCycling({
      activities: RIDES,
      activitiesStatus: "ready",
      height: 900,
      snapshot: snapshotWith([{ happenDay: day(3), vo2max: 47 }])
    });
    assert.equal(await harness("count", ".run-hero-card"), 4, "a running VO₂max alone adds nothing");
    assert.equal(await hasText("VO₂max"), false);

    await mountCycling({
      activities: RIDES,
      activitiesStatus: "ready",
      height: 900,
      snapshot: snapshotWith([
        { happenDay: day(20), vo2max: 47, cycleVo2max: 51 },
        { happenDay: day(6), cycleVo2max: 53 },
        { happenDay: day(2), vo2max: 48, cycleVo2max: 53 }
      ])
    });
    assert.equal(await harness("count", ".run-hero-card"), 5, "the cycling VO₂max card");
    const cards = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-hero-card")].map((card) => card.textContent)`,
      true
    );
    const vo2Card = cards.find((text) => text.startsWith("VO₂max"));
    assert.ok(vo2Card, `a VO₂max card among ${JSON.stringify(cards)}`);
    assert.match(vo2Card, /^VO₂max53Held /, "the cycling reading, not the running 48");
    assert.ok(cards.indexOf(vo2Card) === cards.findIndex((text) => text.startsWith("FTP")) + 1, "beside FTP");
  }

  // -------------------------------------------------------------------------
  // No horizontal scroll, from a wide column down to the app's minimum.
  // -------------------------------------------------------------------------
  for (const width of [1344, 1000, 620]) {
    await mountCycling({ activities: RIDES, activitiesStatus: "ready", height: 900, width });
    await waitFor(() => hasText("of riding time is easy"), "the page is complete");
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the page scrolls sideways by ${overflow}px in a ${width}px column`);
  }

  // -------------------------------------------------------------------------
  // A ride's page: placeholder, then a rider's figures and a speed chart.
  // -------------------------------------------------------------------------
  {
    const target = RIDES[0];
    await mountCycling({
      activities: RIDES,
      activitiesStatus: "ready",
      detailRequest: { activityId: target.activityId, status: "pending" }
    });
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".running-list-panel tbody tr")].find((row) => row.textContent.includes(${JSON.stringify(target.name)})).click()`,
      true
    );
    await waitFor(() => harness("exists", ".run-detail"), "the ride opens");
    assert.equal(await harness("callCount", "prop:onSelectActivity"), 1);
    assert.equal(await harness("exists", '[aria-label="Loading this ride"]'), true);

    await harness("setProps", {
      detail: rideDetail(target.activityId),
      detailRequest: { activityId: target.activityId, status: "ready" }
    });
    await waitFor(() => harness("exists", ".activity-chart-chips"), "the channel chart draws");
    await settle();

    const chips = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".activity-chart-chips button")].map((b) => b.textContent.trim())`,
      true
    );
    assert.ok(chips.includes("Speed"), `a ride's chart offers speed: ${chips}`);
    assert.ok(!chips.includes("Pace"), `and not pace: ${chips}`);
    assert.ok(chips.includes("Power"), `and the power meter's channel: ${chips}`);

    assert.equal(await hasText("30.0 km/h"), true, "the headline speed");
    assert.equal(await hasText("Max speed"), true, "and the top speed beside it");
    assert.equal(await hasText("85 rpm"), true, "cadence in revolutions, not steps");

    // Power: what the meter measured, what the ride cost, against the FTP.
    for (const label of ["Normalized", "Intensity", "TSS", "Variability", "Work", "Peak power", "20 min"]) {
      assert.equal(await hasText(label), true, `the power panel states ${label}`);
    }
    assert.equal(await hasText("FTP of 250 W"), true, "and whose FTP it is");
    assert.equal(await hasText("Time in power zones"), true);
    assert.equal(await hasText("Z3 · Aerobic Power"), true, "COROS's zones, by COROS's names");
    assert.equal(await hasText("189–225 W"), true, "bounded by the profile's own ceilings");
    assert.equal(await hasText("coasting at 0 W"), true, "the descent's freewheeling is named, not filed as Recovery");

    // The climb, found in the samples and categorised.
    assert.equal(await hasText("Cat 3"), true, "three kilometres at 7% is a Cat 3");
    assert.equal(await harness("count", ".ride-climb-table tbody tr"), 1);
    assert.equal(await hasText("VAM"), true);
    assert.equal(await hasText("spm"), false);
    assert.equal(await hasText("Whole ride"), true, "the segment is the ride's");
    assert.equal(await hasText("Descent"), true);
    assert.equal(await harness("count", ".run-lap-table tbody tr"), 2);
    assert.equal(await hasText("205 W"), true, "laps carry their power");

    // One lap is the ride again, and a ride with no meter has cadence alone.
    await harness("setProps", {
      detail: rideDetail(target.activityId, {
        laps: [{ index: 1, distance: 30_000, duration: 3600, avgHr: 140, avgCadence: 85 }],
        dynamics: { avgCadence: 85, maxCadence: 112 },
        series: rideSeries().map(({ power: _power, ...rest }) => rest)
      })
    });
    await settle();
    assert.equal(await harness("exists", ".run-lap-table"), false, "a single lap draws no lap table");
    assert.equal(await hasText("Normalized"), false, "no meter, no power figures");
    assert.equal(await hasText("Cadence"), true, "but the cadence sensor still speaks");

    assert.equal(await harness("text", ".run-detail-back span"), "Cycling");
    assert.equal(await harness("clickText", ".run-detail-back", "Cycling"), true);
    await settle();
    assert.equal(await harness("exists", ".run-detail"), false, "Back returns to the list");
    assert.equal(await listRowCount(), RIDES.length);
  }

  // -------------------------------------------------------------------------
  // The ride page's tables scroll inside their panels, never the page.
  // -------------------------------------------------------------------------
  for (const width of [1000, 620]) {
    const target = RIDES[0];
    await mountCycling({
      activities: RIDES,
      activitiesStatus: "ready",
      width,
      openRequest: { view: "cycling", activityId: target.activityId },
      detail: rideDetail(target.activityId),
      detailRequest: { activityId: target.activityId, status: "ready" }
    });
    await waitFor(() => harness("exists", ".ride-climb-table"), "the ride page draws its climbs");
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the ride page scrolls sideways by ${overflow}px in a ${width}px column`);
  }

  // -------------------------------------------------------------------------
  // A ride handed over from Activities opens at once, and Back goes back there.
  // -------------------------------------------------------------------------
  {
    const target = RIDES[21];
    await mountCycling({
      activities: RIDES,
      activitiesStatus: "ready",
      openRequest: { view: "cycling", activityId: target.activityId, from: "training" }
    });
    await waitFor(() => harness("exists", ".run-detail"), "the handed-over ride opens");
    // StrictMode runs the effect twice against a request the harness does not
    // clear; the app clears it on the first call, as this does next.
    assert.ok(await harness("callCount", "prop:onOpenRequestHandled") >= 1, "the request is taken");
    await harness("setProps", { openRequest: null });
    await settle();
    assert.equal(await harness("exists", ".run-detail"), true, "and the ride stays open once it is");
    assert.equal(await harness("text", ".run-detail-back span"), "Activities");
    assert.equal(await hasText("Gravel ·"), true, "the eyebrow names the bike");
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

  console.log("cycling renderer tests passed");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
