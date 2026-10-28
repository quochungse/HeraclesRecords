// Overview's Coming up, mounted for real in Electron's Chromium.
//
// Today is read four ways, and each is a different screen:
//
// - a session planned and not done: the plan, pressed as a whole to open it;
// - done: the session, read against what was planned, pressed to open the
//   session rather than the plan;
// - two today, one done: both, the done one first, and a count;
// - nothing today: a rest day, and nothing to press.
//
// And nothing on the calendar at all, with nothing done today, draws no
// section. Set OVERVIEW_SHOTS=<dir> to keep a picture of each state.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.env.OVERVIEW_SHOTS;

if (!shots) {
  app.commandLine.appendSwitch("no-sandbox");
  app.disableHardwareAcceleration();
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

const key = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const now = new Date();
const dayAfter = (days) => {
  const date = new Date(now);
  date.setDate(now.getDate() + days);
  return date;
};
const today = key(now);
// Early this morning, so it is today in any time zone the suite runs in.
const thisMorning = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30).getTime() / 1000);

const easyRun = { happenDay: today, name: "Easy run 8 km", volume: "8.00km", trainingLoad: 75, sportType: 1, sortNo: 1 };
const upperBody = { happenDay: today, name: "Upper body", volume: "5 set(s)", trainingLoad: 40, sportType: 4, sortNo: 0 };
const later = [
  { happenDay: key(dayAfter(1)), name: "Long run 20 km", volume: "20.00km", trainingLoad: 206, sportType: 1, sortNo: 0 },
  { happenDay: key(dayAfter(3)), name: "Tempo run", volume: "11.50km", trainingLoad: 130, sportType: 1, sortNo: 0 },
  { happenDay: key(dayAfter(5)), name: "Easy run + strides", volume: "9.00km", trainingLoad: 90, sportType: 1, sortNo: 0 },
  { happenDay: key(dayAfter(9)), name: "Beyond the list", volume: "10.00km", trainingLoad: 100, sportType: 1, sortNo: 0 }
];
const morningRun = {
  activityId: "run-today",
  name: "Morning run",
  sportType: 100,
  startTime: thisMorning,
  distance: 8120,
  duration: 2880,
  trainingLoad: 82
};
const morningLift = {
  activityId: "lift-today",
  name: "Strength",
  sportType: 402,
  startTime: thisMorning,
  duration: 2700,
  trainingLoad: 50
};

async function mountComingUp(name, options) {
  await harness("mount", "OverviewComingUp", options);
  await waitFor(() => harness("appStylesReady"), "the app stylesheet loads");
  if (shots && (await harness("exists", ".overview-plan"))) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shots, `coming-up-${name}.png`), image.toPNG());
  }
}

async function main() {
  await app.whenReady();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  win = new BrowserWindow({
    show: false,
    width: 1180,
    height: 520,
    webPreferences: { backgroundThrottling: false, ...(shots ? { offscreen: true } : {}) }
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");
  await harness("freezeAnimations");

  // 1. Planned, not done yet.
  await mountComingUp("planned", { upcoming: [easyRun, ...later] });
  assert.equal(await harness("exists", ".overview-plan-today.is-planned"), true);
  assert.equal(await harness("count", ".overview-plan-today .overview-plan-entry.is-lead"), 1);
  assert.match(await harness("text", ".overview-plan-today .overview-plan-title"), /Easy run 8 km/);
  assert.equal(await harness("exists", ".overview-plan-today button.overview-plan-entry"), true, "the plan is pressed as a whole, as a day after it is");
  assert.equal(await harness("count", ".overview-plan-today button"), 1, "no button of its own inside it");
  assert.equal(await harness("exists", ".overview-plan-against"), false, "nothing to read a plan against yet");
  assert.match(await harness("text", ".overview-section-aside"), /^Next 7 days · 4 workouts/, "the week ahead, today's included");
  assert.equal(await harness("count", ".overview-plan-row"), 3, "three of the days after, the tenth day left off");
  assert.match(await harness("text", ".overview-plan-row"), /Tomorrow/);

  // 2. Done, against its plan.
  await mountComingUp("done", { upcoming: [easyRun, ...later], activities: [morningRun] });
  assert.equal(await harness("exists", ".overview-plan-today.is-done"), true);
  assert.match(await harness("text", ".overview-plan-today .overview-plan-title"), /Easy run 8 km\s*Done/, "the plan's name, marked done");
  assert.match(await harness("text", ".overview-plan-against"), /109% of planned load/);
  assert.match(
    await harness("text", ".overview-plan-today .overview-plan-copy > .overview-plan-meta"),
    /^Morning run · /,
    "named by its plan, the session's own name goes with its figures"
  );
  assert.equal(await harness("click", ".overview-plan-today button.overview-plan-entry"), true);
  assert.deepEqual(
    (await harness("calls", "prop:onOpenActivity")).map((call) => call.args),
    [["run-today"]],
    "the way in is the session, not the plan"
  );

  // 3. Two today, one done.
  await mountComingUp("two", { upcoming: [upperBody, easyRun, ...later], activities: [morningLift] });
  assert.match(await harness("text", ".overview-plan-today .eyebrow"), /1 of 2 done/);
  assert.equal(await harness("count", ".overview-plan-today .overview-plan-entry"), 2);
  assert.equal(await harness("exists", ".overview-plan-entry.is-lead"), false, "two sessions are two rows, neither at full size");
  assert.equal(await harness("exists", ".overview-plan-today li:first-child .overview-plan-entry.is-done"), true, "the done one first");
  assert.equal(await harness("exists", ".overview-plan-against"), false);

  // 4. Nothing today.
  await mountComingUp("rest", { upcoming: later });
  assert.equal(await harness("exists", ".overview-plan-today.is-rest"), true);
  assert.match(await harness("text", ".overview-plan-rest"), /Rest day/);
  assert.equal(await harness("exists", ".overview-plan-today button"), false, "a rest day has nothing to press");

  // 5. Nothing at all.
  await harness("mount", "OverviewComingUp", { upcoming: [], activities: [] });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await harness("exists", ".overview-section"), false, "no section to say there is nothing");

  assert.deepEqual(await harness("consoleErrors"), [], "no console errors");
  console.log("overview renderer OK");
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
