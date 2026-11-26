// The Climbing screen, mounted for real in Electron's Chromium.
//
// It draws with Running's stylesheet as Swimming does, so the layout traps
// those suites hold down are asked again of it — an empty list read three
// ways, no sideways scroll — along with what is Climbing's own: grades said
// a route's and a boulder's apart and never as one figure, every grade in the
// scale chosen in COROS's climb settings, a hero that says it is still reading
// before it says "none", and a session's page read climb by climb.
//
// The sessions are the development build's sample climbs (electron/
// sampleClimbs.ts), built by `npm run build:electron` and read back through
// the real parser. CLIMB_SHOTS=<dir> also writes what the window drew there.
//
// The device scale is pinned to 1, for the reason test-cycling-renderer's is.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A picture needs frames, which a hidden window gets only offscreen — and an
// offscreen renderer dies on `no-sandbox` here (/dev/shm), so shots keep it.
if (!process.env.CLIMB_SHOTS) app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();

const samples = await import(pathToFileURL(path.join(repoRoot, "dist-electron", "sampleClimbs.js")).href);
const CLIMBS = samples.withSampleClimbs([], { page: 1 });
const SUMMARIES = samples.withSampleClimbSummaries(CLIMBS.map((activity) => activity.activityId), []);
const RUN = {
  activityId: "run-1",
  name: "Easy run",
  sportType: 100,
  startTime: Math.floor(Date.now() / 1000) - 86_400,
  duration: 3000,
  distance: 10_000
};
const SETTLED = { computed: 0, remaining: 0, failed: 0, summaries: [] };
/** COROS's climb settings: French routes with a 6b onsight, V boulders with a V3 one. */
const CONTEXT = {
  maxHr: 188,
  restingHr: 52,
  lthrBpm: 168,
  climbSystems: { indoorClimb: "french", bouldering: "vScale" },
  climbSettings: { indoorClimb: { system: 2, gradeIndex: 8 }, bouldering: { system: 7, gradeIndex: 3 } }
};
const READ = {
  getActivityDetailSummaries: SUMMARIES,
  syncActivityDetailSummaries: SETTLED,
  getWorkoutEditorContext: CONTEXT
};
const shots = process.env.CLIMB_SHOTS;

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

async function mountClimbing(options, script = READ) {
  await harness("mount", "ClimbingView", options, script);
  await waitFor(() => harness("appStylesReady"), "the app stylesheet loads");
  await waitFor(() => harness("exists", ".running-page-header, .run-detail"), "the page renders");
  await settle();
}

/** The whole column as one picture, when CLIMB_SHOTS names a folder for it. */
async function shoot(name) {
  if (!shots) return;
  const height = await win.webContents.executeJavaScript(
    `Math.ceil(document.querySelector(".running-view").scrollHeight + 40)`,
    true
  );
  win.setContentSize(1400, Math.min(6000, Math.max(900, height)));
  await win.webContents.executeJavaScript(
    `document.querySelector("main").style.height = "${Math.max(900, height)}px"`,
    true
  );
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(shots, `${name}.png`), image.toPNG());
  win.setContentSize(1400, 900);
}

const hasText = (text) =>
  win.webContents.executeJavaScript(`document.body.textContent.includes(${JSON.stringify(text)})`, true);

const listRowCount = () => harness("count", ".running-list-panel tbody tr");

const statText = (label) =>
  win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".run-detail-stats .running-stat")].find((s) => s.querySelector("span").textContent === ${JSON.stringify(label)})?.querySelector("strong").textContent`,
    true
  );

const clickChip = (label) =>
  win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".running-controls button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`,
    true
  );

async function main() {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { backgroundThrottling: false, offscreen: Boolean(shots) } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");
  assert.ok(CLIMBS.length > 20, "the sample climbs are there to read");

  // -------------------------------------------------------------------------
  // An empty list says nothing by itself — the status decides which screen.
  // -------------------------------------------------------------------------
  {
    await mountClimbing({ activities: [], activitiesStatus: "pending" });
    assert.equal(await harness("exists", '[aria-label="Loading your climbing"]'), true, "loading, named for climbing");
    assert.equal(await hasText("No climbing yet"), false, "loading is not 'no climbing'");

    await mountClimbing({ activities: [], activitiesStatus: "failed" });
    assert.equal(await harness("clickText", "button", "Try again"), true);
    assert.equal(await harness("callCount", "prop:onRetryActivities"), 1);

    await mountClimbing({ activities: [RUN], activitiesStatus: "ready" });
    assert.equal(await hasText("No climbing yet"), true, "a run is not a climb");

    await mountClimbing({ activities: [], activitiesStatus: "ready", connected: false });
    assert.equal(await hasText("Connect COROS first"), true);
  }

  // -------------------------------------------------------------------------
  // Still reading the climbs is not "none": the hero and panels say they read.
  // -------------------------------------------------------------------------
  {
    await mountClimbing(
      { activities: CLIMBS, activitiesStatus: "ready" },
      { getActivityDetailSummaries: [], syncActivityDetailSummaries: "__pending", getWorkoutEditorContext: CONTEXT }
    );
    assert.equal(await hasText("Reading your climbs"), true, "the screen says it is reading");
    assert.equal(await hasText("No graded send in 12 weeks"), false, "not yet that nothing was sent");
    assert.equal(await harness("resolvePending", "syncActivityDetailSummaries", { ...SETTLED, computed: 1, summaries: SUMMARIES }), true);
    await waitFor(() => hasText("Grade pyramid"), "the grades once the climbs are read");
    await waitFor(async () => !(await hasText("Reading your climbs")), "and the reading notes are gone");
  }

  // -------------------------------------------------------------------------
  // The page: climbs only, grades a route's and a boulder's apart, in French and V.
  // -------------------------------------------------------------------------
  {
    await mountClimbing({ activities: [RUN, ...CLIMBS], activitiesStatus: "ready", height: 900 });
    await waitFor(() => hasText("Grade pyramid"), "the pyramid draws");
    assert.equal(await listRowCount(), CLIMBS.filter((activity) => (activity.startTime ?? 0) * 1000 > Date.now() - 90 * 86_400_000).length, "every climb in the window listed, the run left out");
    for (const label of ["This week", "Hardest send · 12 weeks", "Sent · 4 weeks", "Onsight grade · COROS", "Grade over time", "Kinds", "On the wall"]) {
      assert.equal(await hasText(label), true, `the page states ${label}`);
    }
    for (const absent of ["Load ratio", "VO₂max", "Threshold pace", "/km"]) {
      assert.equal(await hasText(absent), false, `${absent} is not a climber's figure`);
    }
    const hero = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".run-hero-card")].map((card) => card.querySelector(".run-hero-value").textContent)`,
      true
    );
    assert.match(hero[1], /^\d[abc]\+? · V\d+$/, `the hardest send is a route's grade and a boulder's apart: ${hero[1]}`);
    assert.match(hero[3], /^6b · V3$/, "the onsight grades from COROS's settings");
    const rows = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".climb-pyramid-rows .climb-pyramid-grade")].map((cell) => cell.textContent)`,
      true
    );
    assert.ok(rows.every((name) => /^[4-9][abc]\+?$/.test(name)), `the route pyramid reads in French: ${rows}`);
    assert.equal(await harness("count", ".climb-pyramid-rows li.is-onsight"), 1, "the onsight grade marked once");
    await shoot("climbing");

    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".climb-pyramid button")].find((b) => b.textContent.trim() === "Boulders").click()`,
      true
    );
    await settle();
    const boulders = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".climb-pyramid-rows .climb-pyramid-grade")].map((cell) => cell.textContent)`,
      true
    );
    assert.ok(boulders.length > 0 && boulders.every((name) => /^V\d+$/.test(name)), `the boulder pyramid reads in V: ${boulders}`);

    await clickChip("Bouldering");
    await settle();
    assert.equal(
      await listRowCount(),
      CLIMBS.filter((activity) => activity.sportType === 801 && (activity.startTime ?? 0) * 1000 > Date.now() - 90 * 86_400_000).length,
      "the chip narrows the list to boulder sessions"
    );
    await clickChip("All");
    await settle();
  }

  // -------------------------------------------------------------------------
  // No horizontal scroll, from a wide column down to the app's minimum.
  // -------------------------------------------------------------------------
  for (const width of [1344, 1000, 620]) {
    await mountClimbing({ activities: CLIMBS, activitiesStatus: "ready", height: 900, width });
    await waitFor(() => hasText("Grade pyramid"), "the page is complete");
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the page scrolls sideways by ${overflow}px in a ${width}px column`);
  }

  // -------------------------------------------------------------------------
  // A session's page: its climbs on its clock, climb by climb.
  // -------------------------------------------------------------------------
  const target = CLIMBS.find((activity) => activity.sportType === 800);
  const detail = samples.sampleClimbDetail(target.activityId);
  for (const width of [1344, 620]) {
    await mountClimbing({
      activities: CLIMBS,
      activitiesStatus: "ready",
      width,
      openRequest: { view: "climbing", activityId: target.activityId },
      detail,
      detailRequest: { activityId: target.activityId, status: "ready" }
    });
    await waitFor(() => harness("exists", ".climb-routes-block"), "the climbs draw");
    await settle();
    assert.equal(await harness("count", ".climb-routes-block"), detail.climb.climbs.length, "a block a climb");
    assert.equal(await harness("count", ".climb-route-table tbody tr"), detail.climb.climbs.length, "a row a climb");
    assert.equal(await statText("Climbs"), String(detail.climb.climbs.length));
    assert.match(await statText("Hardest send"), /^\d[abc]\+?$/, "the hardest send in French");
    for (const label of ["Climbing time", "Off the wall", "Height", "Falls", "Climb by climb"]) {
      assert.equal(await hasText(label), true, `the session page states ${label}`);
    }
    const overflow = await harness("overflowX", ".running-view");
    assert.equal(overflow, 0, `the session page scrolls sideways by ${overflow}px in a ${width}px column`);
    if (width === 1344) await shoot("climb-session");
  }

  const errors = await harness("consoleErrors");
  assert.deepEqual(errors, [], `no console errors: ${JSON.stringify(errors)}`);

  console.log("climbing renderer tests passed");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
