// Exercise the real Strength hero, including its WebGL map and detail panel.
// Run: npm run test:strength-renderer
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { strengthExerciseMetadata } from "./fixtures/strength-exercises.mjs";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");
const repoRoot = path.resolve(import.meta.dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-strength-renderer-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("no-zygote");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
app.disableHardwareAcceleration();
const timeout = setTimeout(() => {
  console.error("strength renderer test timed out");
  app.exit(1);
}, 90_000);

const exercise = (key, entries) => ({
  nameKey: key, ...strengthExerciseMetadata(key), sets: entries.length,
  totalReps: entries.reduce((sum, set) => sum + set.reps, 0), entries
});
const session = {
  activityId: "mixed", sportType: 402, startTime: Math.floor(Date.now() / 1000),
  detail: {
    summary: { sets: 2, totalReps: 8, totalWeightKg: 480, exercises: 2, calories: 0, durationSec: 180 },
    exercises: [
      exercise("T1041", [{ reps: 8, weightKg: 60, workSec: 24, restSec: 60 }]),
      exercise("T1010", [{ reps: 0, weightKg: 0, workSec: 45, restSec: 30, timed: true }])
    ]
  },
  heracles: {
    value: 60, cardio: 10, muscular: 50, quality: "sets",
    sets: [[{ load: 30, rpe: 8, seconds: 84 }], [{ load: 12, rpe: 7, seconds: 75 }]]
  }
};

let win;
const evaluate = (source) => win.webContents.executeJavaScript(source, true);
const harness = (method, ...args) =>
  evaluate(`window.__harness.${method}(${args.map((arg) => JSON.stringify(arg)).join(",")})`);

async function waitFor(read, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!(await read())) {
    const errors = await harness("consoleErrors");
    assert.deepEqual(errors, [], `${label}: renderer errors: ${errors.join("\n")}`);
    assert.ok(Date.now() < deadline, `timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function assertHealthy() {
  assert.equal(await harness("exists", ".strength-hero"), true);
  assert.deepEqual(await harness("consoleErrors"), []);
  assert.equal(await evaluate('/NaN|undefined|Infinity/.test(document.querySelector(".strength-muscle-panel").textContent)'), false);
  // A MotionFigure is a span: a stylesheet's `.stat span` rule meant for a label
  // shrank the window's figures and knocked their wheels off the line.
  assert.deepEqual(await evaluate(`[...document.querySelectorAll(".motion-figure")].flatMap((figure) => {
    const own = getComputedStyle(figure), parent = getComputedStyle(figure.parentElement);
    return ["fontSize", "fontWeight", "color"].filter((p) => own[p] !== parent[p]).map((p) => figure.textContent + " " + p + " " + own[p] + " ≠ " + parent[p]);
  })`), [], "a figure looks like what holds it");
}

async function mount({ sessions = [session], scope = "window", metric = "load", source = "heracles", units = "metric", map = false } = {}) {
  await harness("unmount");
  await evaluate(`localStorage.clear();
    localStorage.setItem("heraclesrecords.loadSource", ${JSON.stringify(source)});
    localStorage.setItem("heraclesrecords.unitSystem", ${JSON.stringify(units)});
    localStorage.setItem("heraclesrecords.strength.bodyRotate", "false");
    localStorage.setItem("heraclesrecords.selection.v1.strength.metric", ${JSON.stringify(JSON.stringify(metric))});
    document.getElementById("strength-test-map-visibility")?.remove();
    if (!${map}) {
      const style = document.createElement("style");
      style.id = "strength-test-map-visibility";
      style.textContent = ".strength-body-panel { display: none; }";
      document.head.append(style);
    }`);
  await harness("mount", "StrengthHero", { sessions, scope });
  await waitFor(() => harness("appStylesReady"), "styles");
  await waitFor(() => harness("exists", ".muscle-ranking-row"), "muscle ranking");
}

async function pickMuscle(name) {
  assert.equal(await evaluate(`(() => {
    const button = [...document.querySelectorAll(".muscle-ranking-row")]
      .find((node) => node.querySelector(".muscle-ranking-name").textContent === ${JSON.stringify(name)});
    button?.click(); return Boolean(button);
  })()`), true, `select ${name}`);
  await waitFor(() => harness("exists", ".muscle-hero-value"), `${name} detail`);
  assert.equal(await harness("text", ".muscle-detail-title h3"), name);
  await assertHealthy();
}

async function chooseMetric(label) {
  assert.equal(await harness("clickText", ".muscle-panel-metric button", label), true);
  await waitFor(async () => await harness("text", ".muscle-panel-metric button[aria-checked=true]") === label, label);
  await assertHealthy();
}

async function back() {
  assert.equal(await harness("click", ".muscle-panel-back"), true);
  await waitFor(() => harness("exists", ".muscle-ranking-row"), "back to ranking");
}

async function main() {
  // Copy only the body assets this fixture uses; the harness has no public directory.
  fs.cpSync(path.join(repoRoot, "public/assets/anatomy/hero"), path.join(repoRoot, "dist-harness/assets/anatomy/hero"), { recursive: true });
  await app.whenReady();
  win = new BrowserWindow({
    show: false, width: 1200, height: 950,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  // The matrix tests panel state; keep software WebGL animation out of their
  // critical path. The final case shows the model and clicks its actual mesh.
  win.webContents.setFrameRate(10);
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness/index.html"));
  assert.equal(await harness("dev"), true);

  // Regression: opening any muscle in Load used to unmount the entire page.
  await mount();
  await pickMuscle("Chest");
  assert.equal(await harness("text", ".muscle-hero-label"), "Load");
  assert.equal(await harness("text", ".muscle-hero-value"), "15 TL", "half the bench load goes to the chest; shoulders and triceps share the rest");
  assert.equal(await harness("text", ".muscle-hero-note"), "15 TL per session");
  assert.match(await harness("attr", ".muscle-detail-rank", "aria-label"), /by training load/);
  await back();
  await pickMuscle("Abs");
  assert.equal(await harness("text", ".muscle-hero-value"), "6 TL", "bodyweight sets still have load");
  await chooseMetric("Volume");
  assert.equal(await harness("text", ".muscle-hero-value"), "Bodyweight");
  await chooseMetric("Load");
  assert.equal(await harness("text", ".muscle-hero-value"), "6 TL");
  assert.equal(await harness("keyDown", ".strength-hero", "Escape"), true);
  await waitFor(() => harness("exists", ".muscle-ranking-row"), "Escape clears selection");

  // Every muscle, including untrained ones, opens in every offered metric.
  const names = await evaluate('[...document.querySelectorAll(".muscle-ranking-name")].map((node) => node.textContent)');
  for (const scope of ["window", "session"]) {
    await mount({ scope });
    for (const label of ["Load", "Sets", "Volume"]) {
      await chooseMetric(label);
      for (const name of names) {
        await pickMuscle(name);
        assert.equal(await harness("text", ".muscle-hero-label"), label);
        await back();
      }
    }
    console.log(`strength detail matrix passed: ${scope}`);
  }

  // A saved Load choice, no scored sets, and an empty history must all open safely.
  for (const sessions of [[{ ...session, heracles: undefined }], []]) {
    await mount({ sessions });
    await pickMuscle("Chest");
    assert.equal(await harness("text", ".muscle-hero-value"), "0 TL");
    assert.equal(await harness("exists", ".muscle-detail-rank"), false);
    await back();
  }

  await mount({ source: "coros" });
  assert.equal(await harness("text", ".muscle-panel-metric button[aria-checked=true]"), "Sets");
  assert.equal(await evaluate('[...document.querySelectorAll(".muscle-panel-metric button")].some((node) => node.textContent === "Load")'), false);
  await pickMuscle("Chest");
  assert.equal(await harness("text", ".muscle-hero-label"), "Sets");

  // The unit setting must not convert Training Load into pounds.
  await mount({ units: "imperial", map: true });
  await pickMuscle("Chest");
  assert.equal(await harness("text", ".muscle-hero-value"), "15 TL");
  await back();

  // Click the actual map too: its picking path shares the detail panel's selection.
  await waitFor(async () => await harness("exists", ".body-map-canvas") && !(await harness("exists", ".anatomy-model-status")), "body mesh", 20_000);
  let picked = false;
  for (const y of [0.35, 0.4, 0.45, 0.3, 0.5]) {
    await evaluate(`(() => {
      const canvas = document.querySelector(".body-map-canvas");
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: rect.left + rect.width * 0.52, clientY: rect.top + rect.height * ${y} }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await assertHealthy();
    if (await harness("exists", ".muscle-hero-value")) { picked = true; break; }
  }
  assert.equal(picked, true, "a body-map click opens a muscle");
  assert.equal(await harness("text", ".muscle-hero-label"), "Load");
  await back();
  await assertHealthy();
  console.log(`strength renderer tests passed (${names.length} muscles × 3 metrics × 2 scopes, empty/unscored data, persisted preference, units and map click)`);
}

main().then(() => {
  clearTimeout(timeout);
  win?.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  win?.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
