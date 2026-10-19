/**
 * The exercise library screen, mounted for real in Electron's Chromium.
 *
 * Muscles come from COROS's own codes where the catalog row lists them and
 * from the movement's name where it does not (`exerciseFacets.ts`); equipment
 * always comes from the name. So the two things that can go wrong are wrong
 * attribution and a filter that narrows to nothing. Neither is visible from
 * the source:
 *
 * - **A facet nothing is filed under is not drawn.** The column is built from
 *   a fixed taxonomy, so without the count gate it would list sixteen muscles
 *   over a catalog that trains four of them, and twelve of the rows would
 *   answer "no exercise matches this search".
 * - **Picking a value narrows the results.** The facet list and the result
 *   list read the same `exerciseFacets`, so a mismatch between the count on a
 *   row and the rows it opens means the two disagree about what a movement is.
 * - **A movement no rule recognises is still reachable.** It carries no facet
 *   and must therefore still be in **All** — filing it under a guess is the
 *   failure this is guarding against, not filing it nowhere.
 * - **The value column and the results are two columns.** `All` drops the
 *   first, and a grid that keeps a track for a column it no longer draws
 *   leaves the results in the right-hand half of the screen.
 *
 * Run: npm run test:exercise-picker
 * (a real Electron window: these are layout and effect questions)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.disableHardwareAcceleration();

let win;

const evaluate = (source) => win.webContents.executeJavaScript(source, true);

function harness(method, ...args) {
  const list = args.map((value) => JSON.stringify(value)).join(", ");
  return evaluate(`window.__harness.${method}(${list})`).catch((error) => {
    throw new Error(`harness ${method} failed: ${error.message}`);
  });
}

async function settle(passes = 5) {
  for (let pass = 0; pass < passes; pass += 1) {
    await evaluate("new Promise((resolve) => setTimeout(resolve, 50))");
  }
}

const count = (selector) =>
  evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

const texts = (selector) =>
  evaluate(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(
       (node) => node.textContent.replace(/\\s+/g, " ").trim()
     )`
  );

const box = (selector) =>
  evaluate(
    `(() => {
       const node = document.querySelector(${JSON.stringify(selector)});
       if (!node) return null;
       const rect = node.getBoundingClientRect();
       return {
         top: Math.round(rect.top),
         left: Math.round(rect.left),
         width: Math.round(rect.width),
         height: Math.round(rect.height)
       };
     })()`
  );

/** Presses the filter-kind chip carrying this label. */
const chooseKind = (label) =>
  evaluate(
    `(() => {
       const chip = Array.from(document.querySelectorAll(".option-group button"))
         .find((node) => node.textContent.trim() === ${JSON.stringify(label)});
       if (!chip) return false;
       chip.click();
       return true;
     })()`
  );

/**
 * A catalog with one movement per rule family, plus one — "Coros Special
 * Drill" — that no rule set recognises at all. That last row is the point of
 * fixture 4.
 */
const NAMES = [
  "Barbell Bench Press",
  "Dumbbell Curl",
  "Back Squat",
  "Cable Row",
  "Plank",
  "Standing Calf Raise",
  "Kettlebell Swing",
  "Coros Special Drill"
];

const OPTIONS = NAMES.map((name, index) => ({
  id: `E${index}`,
  name,
  label: name,
  // Every third movement ships a clip, so the play button is on some cards
  // and not others — which is what it looks like in the real catalog.
  media: index % 3 === 0 ? [{ videoUrl: `https://example.invalid/${index}.mp4` }] : []
}));

async function mount(options = {}) {
  await harness("mount", "ExercisePickerDialog", { options: OPTIONS, ...options });
  await settle();
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false }
  });
  // Nothing here may reach the network: the fixture's media URLs are fake and
  // a real request would make the suite depend on a host being up.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/.test(details.url) });
  });
  await win.loadFile(path.join(repoRoot, "dist-harness", "index.html"));
  assert.equal(await harness("dev"), true, "the harness must be the dev build");

  // -------------------------------------------------------------------------
  // 1. All shows the whole catalog, in one column
  // -------------------------------------------------------------------------
  await mount();

  assert.equal(
    await count(".exercise-picker-card"),
    NAMES.length,
    "All is the catalog: every movement has a card"
  );
  assert.equal(
    await count(".exercise-picker-facets"),
    0,
    "All has nothing to narrow by, so the value column is not drawn"
  );

  const unfilteredResults = await box(".exercise-picker-results");
  const dialog = await box(".exercise-picker");
  assert.ok(
    unfilteredResults.width > dialog.width - 40,
    `with no value column the results take the width: ${unfilteredResults.width} of ${dialog.width}`
  );

  assert.equal(
    await count(".exercise-picker-card-play"),
    OPTIONS.filter((option) => option.media.length > 0).length,
    "a play button only where COROS ships a clip"
  );

  // -------------------------------------------------------------------------
  // 2. A facet is drawn only where something is filed under it
  // -------------------------------------------------------------------------
  assert.equal(await chooseKind("Body part"), true, "the Body part chip is there");
  await settle();

  const parts = await texts(".exercise-picker-facet");
  assert.ok(parts.length > 0, "the fixture trains something");
  assert.ok(
    parts.length < 7,
    `only the body parts this catalog reaches: ${parts.join(", ")}`
  );
  assert.ok(
    parts.some((row) => row.startsWith("Chest")),
    `a bench press files the catalog under Chest: ${parts.join(", ")}`
  );

  const facetColumn = await box(".exercise-picker-facets");
  const filteredResults = await box(".exercise-picker-results");
  assert.ok(
    facetColumn.width > 100 && filteredResults.left > facetColumn.left,
    `the value column and the results are two columns: ${JSON.stringify({ facetColumn, filteredResults })}`
  );

  // -------------------------------------------------------------------------
  // 3. The count on a row is the number of rows it opens
  // -------------------------------------------------------------------------
  const chestCount = Number(
    await evaluate(
      `(() => {
         const row = Array.from(document.querySelectorAll(".exercise-picker-facet"))
           .find((node) => node.textContent.trim().startsWith("Chest"));
         return row.querySelector(".exercise-picker-facet-count").textContent.trim();
       })()`
    )
  );
  await evaluate(
    `Array.from(document.querySelectorAll(".exercise-picker-facet"))
       .find((node) => node.textContent.trim().startsWith("Chest")).click()`
  );
  await settle();
  assert.equal(
    await count(".exercise-picker-card"),
    chestCount,
    "the count on a value is the number of movements it opens"
  );

  // -------------------------------------------------------------------------
  // 4. A movement no rule recognises is still reachable under All
  // -------------------------------------------------------------------------
  assert.equal(await chooseKind("All"), true, "the All chip is there");
  await settle();
  const allNames = await texts(".exercise-picker-card-name");
  assert.ok(
    allNames.includes("Coros Special Drill"),
    "a movement no rule classifies is filed nowhere and reachable everywhere"
  );

  // -------------------------------------------------------------------------
  // 5. The muscle column names the muscle and its anatomy
  // -------------------------------------------------------------------------
  assert.equal(await chooseKind("Muscle"), true, "the Muscle chip is there");
  await settle();
  const muscles = await texts(".exercise-picker-facet");
  assert.ok(
    muscles.some((row) => row.includes("Pectoralis major")),
    `the muscle row carries its anatomical name: ${muscles.join(" | ")}`
  );

  // -------------------------------------------------------------------------
  // 5b. Every value row draws a figure, and lights something on it
  //
  // The artwork is copied in from a package and grouped by hand, so the way it
  // breaks is a slug that quietly stops matching: the row then draws a bare
  // silhouette with nothing lit, which looks like a design choice rather than
  // a fault. `bodyShapes.ts` also names the *view* a muscle is drawn on, and a
  // wrong one puts the lats on a chest.
  // -------------------------------------------------------------------------
  const facetArt = () =>
    evaluate(
      `Array.from(document.querySelectorAll(".exercise-picker-facet")).map((row) => ({
         label: row.querySelector("strong").textContent.trim(),
         view: row.querySelector("svg").getAttribute("viewBox").startsWith("0 ") ? "front" : "back",
         figures: row.querySelectorAll(".exercise-body-glyph-figure").length,
         lit: row.querySelectorAll(".exercise-body-glyph-lit").length
       }))`
    );

  const muscleArt = await facetArt();
  for (const row of muscleArt) {
    assert.equal(row.figures, 1, `${row.label} draws one silhouette`);
    assert.ok(row.lit > 0, `${row.label} lights something on it`);
  }
  const byLabel = Object.fromEntries(muscleArt.map((row) => [row.label, row]));
  assert.equal(byLabel.Back?.view, "back", "the lats are drawn on the back figure");
  assert.equal(byLabel.Chest?.view, "front", "the chest is drawn on the front one");

  assert.equal(await chooseKind("Body part"), true, "back to Body part");
  await settle();
  const partArt = await facetArt();
  for (const row of partArt) {
    assert.ok(row.lit > 0, `the ${row.label} row lights something`);
  }
  const partByLabel = Object.fromEntries(partArt.map((row) => [row.label, row]));
  assert.equal(partByLabel.Back?.view, "back", "Body part > Back is the back view");
  assert.equal(
    partByLabel.Arms?.view,
    "front",
    "Arms is the front view: biceps and forearms outnumber the triceps there"
  );

  assert.equal(await chooseKind("Muscle"), true, "and back to Muscle for the search");
  await settle();

  // -------------------------------------------------------------------------
  // 6. The search narrows the values, not only the results
  // -------------------------------------------------------------------------
  await evaluate(
    `(() => {
       const input = document.querySelector(".exercise-picker-search input");
       const setter = Object.getOwnPropertyDescriptor(
         window.HTMLInputElement.prototype, "value"
       ).set;
       setter.call(input, "squat");
       input.dispatchEvent(new Event("input", { bubbles: true }));
       return true;
     })()`
  );
  await settle();
  assert.equal(await count(".exercise-picker-card"), 1, "one movement matches 'squat'");
  const narrowed = await texts(".exercise-picker-facet");
  assert.ok(
    narrowed.length > 0 && narrowed.length < muscles.length,
    `a value the search has emptied stops being offered: ${narrowed.length} of ${muscles.length}`
  );

  // -------------------------------------------------------------------------
  // 7. A chosen muscle puts the movements that load it hardest first
  // -------------------------------------------------------------------------
  const pickMuscle = async (label) => {
    assert.equal(await chooseKind("Muscle"), true, "the Muscle chip is there");
    await settle();
    const pressed = await evaluate(
      `(() => {
         const row = Array.from(document.querySelectorAll(".exercise-picker-facet"))
           .find((node) => node.querySelector("strong")?.textContent.trim() === ${JSON.stringify(label)});
         if (!row) return false;
         row.click();
         return true;
       })()`
    );
    assert.equal(pressed, true, `${label} is offered`);
    await settle();
  };

  // Names alone: a row is a secondary mover for the biceps and sits ahead of
  // the curl in the catalog; under Biceps the curl, nearly all biceps, leads.
  await mount({
    options: ["Cable Row", "Dumbbell Curl"].map((name, index) => ({
      id: `O${index}`, name, label: name, media: []
    }))
  });
  await pickMuscle("Biceps");
  assert.deepEqual(
    await texts(".exercise-picker-card-name"),
    ["Dumbbell Curl", "Cable Row"],
    "from the name rules, the curl loads the biceps hardest and comes first"
  );

  // COROS's own muscles (3 = biceps, 12 = lats): the row only involves the
  // biceps, a movement no name rule knows works them alone, and the curl is a
  // primary mover that leans on the forearms and is filed under dumbbells — so the curl
  // leads, then the drill, and the row, which is mostly back, comes last.
  await mount({
    options: [
      { id: "C0", name: "Cable Row", label: "Cable Row", media: [], primaryMuscles: [12], involvedMuscles: [12, 3], equipmentCodes: [5] },
      { id: "C1", name: "Coros Special Drill", label: "Coros Special Drill", media: [], primaryMuscles: [3], involvedMuscles: [3] },
      { id: "C2", name: "Dumbbell Curl", label: "Dumbbell Curl", media: [], primaryMuscles: [3], involvedMuscles: [3, 5], equipmentCodes: [2] }
    ]
  });
  await pickMuscle("Biceps");
  assert.deepEqual(
    await texts(".exercise-picker-card-name"),
    ["Dumbbell Curl", "Coros Special Drill", "Cable Row"],
    "a loaded curl leads a bodyweight movement that is all biceps, and a row that only involves them is last"
  );

  // Shoulders (COROS muscle 1). None of these names says what the movement is:
  // what ranks them is what COROS says about it. A press under dumbbells (equipment
  // 2) and a sled push (equipment 16 with a default weight) are loaded; a
  // movement counting reps with no weight is plain; a timed one with none (target
  // 2) is a hold, a stretch or a drill and goes well below. Bands (9) carry a
  // "weight" that is only a setting, so a banded movement is not loaded by it.
  await mount({
    options: [
      { id: "S0", name: "Alpha", label: "Alpha", media: [], primaryMuscles: [1], involvedMuscles: [1], equipmentCodes: [1], targetType: 2, defaultLoad: 0 },
      { id: "S1", name: "Bravo", label: "Bravo", media: [], primaryMuscles: [1], involvedMuscles: [1], equipmentCodes: [1], targetType: 3, defaultLoad: 0 },
      { id: "S2", name: "Charlie", label: "Charlie", media: [], primaryMuscles: [1], involvedMuscles: [1, 4], equipmentCodes: [2], targetType: 3, defaultLoad: 15000 },
      { id: "S3", name: "Delta", label: "Delta", media: [], primaryMuscles: [1], involvedMuscles: [1, 4], equipmentCodes: [16], targetType: 3, defaultLoad: 15000 },
      { id: "S4", name: "Echo", label: "Echo", media: [], primaryMuscles: [1], involvedMuscles: [1], equipmentCodes: [9], targetType: 3, defaultLoad: 10000 },
      { id: "S5", name: "Foxtrot", label: "Foxtrot", media: [], primaryMuscles: [1], involvedMuscles: [1, 4], equipmentCodes: [6], targetType: 3, defaultLoad: 0 }
    ]
  });
  await pickMuscle("Shoulders");
  assert.deepEqual(
    await texts(".exercise-picker-card-name"),
    ["Charlie", "Delta", "Foxtrot", "Bravo", "Echo", "Alpha"],
    "loaded movements first (dumbbells, a default weight, gym equipment), then plain reps, " +
      "a band's setting is not a load, and a timed unloaded hold is last — none of it from the names"
  );

  // Bodyweight is not one thing. All five of these are the same row to COROS —
  // reps, no weight — and what separates them is the movement, which
  // exerciseEffort.ts places by COROS key: a dip (T1051) is most of the body on
  // a small base and outranks a dumbbell press, a push-up (T1004) sits between
  // plain and loaded, a movement it does not place (T9999) is plain, and a stick
  // warm-up (T1378) is next to nothing however completely it is chest.
  await mount({
    options: [
      { id: "B0", name: "Alpha", label: "Alpha", media: [], corosKey: "T1378", primaryMuscles: [2], involvedMuscles: [2], equipmentCodes: [16], targetType: 3, defaultLoad: 0 },
      { id: "B1", name: "Bravo", label: "Bravo", media: [], corosKey: "T1004", primaryMuscles: [2], involvedMuscles: [2, 4, 1], equipmentCodes: [1], targetType: 3, defaultLoad: 0 },
      { id: "B2", name: "Charlie", label: "Charlie", media: [], corosKey: "T1051", primaryMuscles: [2], involvedMuscles: [1, 2, 4], equipmentCodes: [6], targetType: 3, defaultLoad: 0 },
      { id: "B3", name: "Delta", label: "Delta", media: [], corosKey: "T0001", primaryMuscles: [2], involvedMuscles: [2, 4, 1], equipmentCodes: [2], targetType: 3, defaultLoad: 15000 },
      { id: "B4", name: "Echo", label: "Echo", media: [], corosKey: "T9999", primaryMuscles: [2], involvedMuscles: [2, 4], equipmentCodes: [1], targetType: 3, defaultLoad: 0 }
    ]
  });
  await pickMuscle("Chest");
  assert.deepEqual(
    await texts(".exercise-picker-card-name"),
    ["Charlie", "Delta", "Bravo", "Echo", "Alpha"],
    "a dip (heavy) outranks a dumbbell press (loaded), then a push-up (moderate), a plain bodyweight movement, and a warm-up last"
  );

  const errors = await evaluate("window.__harness.consoleErrors()");
  assert.deepEqual(errors, [], `the screen mounted without console errors`);

  console.log("exercise picker renderer tests passed");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
