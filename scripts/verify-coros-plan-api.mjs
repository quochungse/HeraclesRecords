// Live, cleanup-safe check of the native COROS plan writes, through the app's
// own adapter (dist-electron/corosTrainingPlanAdapter.js) rather than a second
// implementation of the requests.
//
// It WRITES to the COROS account the app is signed in to: it creates two
// temporary plans named "Heracles verify … (delete me)", puts one on the
// calendar in an empty three-week window at least a year out, edits, takes it
// off and deletes everything it made in `finally`. No existing plan,
// workout or calendar day is touched, and it refuses to start if the window
// holds anything.
//
// One thing it cannot undo: `quitSubPlan` sets the calendar's stage of the
// window's weeks back to Not Set. The window is chosen far enough out that a
// stage set there by hand is unlikely, but it is not checked.
//
// It never logs in. It copies the four `trainingHub.*` settings from the app's
// database into a throwaway one and deletes that when it ends, so the token is
// not left on disk twice.
//
// Usage:
//   npm run verify:coros-plan-api -- --live
//   HERACLES_USER_DATA=/path/to/userData npm run verify:coros-plan-api -- --live

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.argv.includes("--live")) {
  console.error(
    "This writes temporary plans and calendar sessions to your COROS account and removes them.\n" +
      "Run it with --live to go ahead: npm run verify:coros-plan-api -- --live"
  );
  process.exit(2);
}

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;

/* userData is named after package.json's top-level `name` — see CLAUDE.md. */
function userDataDir() {
  if (process.env.HERACLES_USER_DATA) return process.env.HERACLES_USER_DATA;
  const name = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).name;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library/Application Support", name);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? "", name);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), name);
}

const SESSION_KEYS = ["trainingHub.accessToken", "trainingHub.userId", "trainingHub.regionId", "trainingHub.baseUrl"];
const sourceDb = path.join(userDataDir(), "coroslink.sqlite");
const Database = require("better-sqlite3");
const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
const session = Object.fromEntries(
  SESSION_KEYS.map((key) => [key, source.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value])
);
source.close();
if (SESSION_KEYS.some((key) => !session[key])) {
  console.error(`No saved COROS session in ${sourceDb}. Sign in through the app first.`);
  process.exit(1);
}
if (!/^https:\/\/teamapi[^/]*\.coros\.com$/.test(session["trainingHub.baseUrl"])) {
  console.error(`Refusing a session on ${session["trainingHub.baseUrl"]}: only the Training Hub web host is used.`);
  process.exit(1);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "heracles-verify-plan-"));
const databaseModule = await import(distUrl("database.js"));
databaseModule.initializeDatabase(scratch);
for (const key of SESSION_KEYS) databaseModule.setSetting(key, session[key]);

const hub = await import(distUrl("trainingHubService.js"));
const adapter = await import(distUrl("corosTrainingPlanAdapter.js"));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const createdPlans = new Set();
const results = [];
function check(label, condition, detail = {}) {
  results.push({ label, pass: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${Object.keys(detail).length ? `  ${JSON.stringify(detail)}` : ""}`);
}
const key = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const listIds = async () => (await adapter.listNativeCorosPlans()).map((plan) => plan.remoteId).sort();

/* A Monday at least a year out whose three weeks hold nothing. */
async function emptyWindow() {
  let monday = addDays(new Date(), 365);
  monday.setHours(12, 0, 0, 0);
  monday = addDays(monday, (8 - monday.getDay()) % 7);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const start = key(monday);
    const end = key(addDays(monday, 20));
    if ((await hub.listScheduledWorkoutEntries(start, end)).length === 0) return { monday, start, end };
    monday = addDays(monday, 21);
  }
  throw new Error("No empty three-week window found a year out; not touching the calendar.");
}

const baselineIds = await listIds();
const window = await emptyWindow();
const calendar = async () =>
  (await hub.listScheduledWorkoutEntries(window.start, window.end)).map((entry) => ({
    day: String(entry.happenDay),
    planId: String(entry.planId),
    idInPlan: String(entry.idInPlan),
    name: entry.name
  }));
console.log(`baseline: ${baselineIds.length} plans; calendar window ${window.start}–${window.end} is empty`);

try {
  // ---- programs: one from the library, one built and calculated here ----
  const run = (await hub.listLibraryWorkouts()).find((workout) => workout.sportType === 1);
  const libraryProgram = run ? await hub.getWorkoutProgramDetail(run.id) : undefined;
  const builtProgram = await hub.buildCalculatedPlanProgram({
    key: "verify-easy",
    name: "Heracles verify easy run",
    sport: "run",
    distance_km: 5
  });
  check("a session built in the app calculates into a full program", Array.isArray(builtProgram.exercises) && builtProgram.exercises.length > 0, {
    exercises: builtProgram.exercises?.length,
    distance: builtProgram.distance
  });
  const programA = libraryProgram ?? builtProgram;

  // ---- create ----
  const name = `Heracles verify ${stamp} (delete me)`;
  const templateId = await adapter.createNativeCorosPlan({
    name,
    overview: "Written by scripts/verify-coros-plan-api.mjs. Safe to delete.",
    sessions: [
      { dayNo: 0, program: programA },
      { dayNo: 2, program: builtProgram },
      { dayNo: 9, program: programA }
    ],
    weekStages: [{ weekNo: 1, stage: 2 }, { weekNo: 2, stage: 3 }]
  });
  createdPlans.add(templateId);
  let raw = await adapter.readNativeCorosPlanRaw(templateId);
  let plan = adapter.parseNativeCorosPlan(raw);
  check("create", plan.name === name && plan.entities.length === 3 && plan.totalDay === 10, {
    entities: plan.entities.map((entity) => [entity.idInPlan, entity.dayNo]),
    stages: plan.weekStages.map((stage) => [stage.weekNo, stage.stage]),
    minWeeks: plan.minWeeks,
    maxWeeks: plan.maxWeeks
  });
  check("create keeps every step", plan.programs.every((program) => (program.exercises ?? []).length > 0));
  check("create writes the stages", JSON.stringify(plan.weekStages.map((stage) => [stage.weekNo, stage.stage])) === JSON.stringify([[1, 2], [2, 3]]));

  // ---- update: rename, move, remove, add, restage ----
  const byId = (id) => raw.programs.find((program) => String(program.idInPlan) === id);
  await adapter.updateNativeCorosPlan(templateId, {
    name: `${name} edited`,
    overview: "Edited by the verifier.",
    sessions: [
      { idInPlan: "2", dayNo: 3, program: byId("2") },
      { idInPlan: "3", dayNo: 9, program: byId("3") },
      { dayNo: 4, program: builtProgram }
    ],
    weekStages: [{ weekNo: 2, stage: 4 }]
  }, { expectedVersion: plan.version });
  raw = await adapter.readNativeCorosPlanRaw(templateId);
  const edited = adapter.parseNativeCorosPlan(raw);
  check("update", edited.name === `${name} edited` && edited.version === (plan.version ?? 0) + 1, {
    entities: edited.entities.map((entity) => [entity.idInPlan, entity.dayNo]),
    stages: edited.weekStages.map((stage) => [stage.weekNo, stage.stage]),
    version: edited.version
  });
  check(
    "update moved, removed and added exactly what it was asked to",
    JSON.stringify(edited.entities.map((entity) => [entity.idInPlan, entity.dayNo]).sort()) === JSON.stringify([["2", 3], ["3", 9], ["4", 4]])
  );
  plan = edited;

  // ---- a stale version is refused without writing ----
  let conflict;
  try {
    await adapter.updateNativeCorosPlan(templateId, {
      name: "should not land",
      overview: "",
      sessions: [{ idInPlan: "2", dayNo: 3, program: byId("2") }],
      weekStages: []
    }, { expectedVersion: (plan.version ?? 0) - 1 });
  } catch (error) {
    conflict = error;
  }
  const afterConflict = adapter.parseNativeCorosPlan(await adapter.readNativeCorosPlanRaw(templateId));
  check("a stale version is refused and nothing is written", conflict?.name === "NativePlanVersionConflictError" && afterConflict.name === plan.name);

  // ---- copy ----
  const copy = await adapter.copyNativeCorosPlan(templateId);
  createdPlans.add(copy.remoteId);
  check("copy", copy.name === plan.name && copy.executeStatus === 0 && copy.entities.length === 3, {
    copyId: copy.remoteId,
    originId: copy.rawPayload.originId
  });

  // ---- execute ----
  const running = await adapter.executeNativeCorosPlan(templateId, window.start);
  createdPlans.add(running.remoteId);
  let onCalendar = await calendar();
  const expectedDays = [3, 4, 9].map((dayNo) => key(addDays(window.monday, dayNo))).sort();
  check("execute puts every session on its day", JSON.stringify(onCalendar.map((entry) => entry.day).sort()) === JSON.stringify(expectedDays) && onCalendar.every((entry) => entry.planId === running.remoteId), {
    instance: running.remoteId,
    calendar: onCalendar.map((entry) => `${entry.day}#${entry.idInPlan}`)
  });

  // ---- edit the running instance: the calendar follows ----
  const instanceRaw = await adapter.readNativeCorosPlanRaw(running.remoteId);
  await adapter.updateNativeCorosPlan(running.remoteId, {
    name: instanceRaw.name,
    overview: instanceRaw.overview ?? "",
    sessions: [
      ...instanceRaw.entities.map((entity) => ({
        idInPlan: String(entity.idInPlan),
        dayNo: Number(entity.dayNo),
        program: instanceRaw.programs.find((program) => String(program.idInPlan) === String(entity.idInPlan))
      })),
      { dayNo: 11, program: builtProgram }
    ],
    weekStages: []
  });
  onCalendar = await calendar();
  check("an edit to the running plan reaches the calendar", onCalendar.some((entry) => entry.day === key(addDays(window.monday, 11))), {
    calendar: onCalendar.map((entry) => `${entry.day}#${entry.idInPlan}`)
  });

  // ---- edit the plan: the running copy is a plan of its own ----
  const templateRaw = await adapter.readNativeCorosPlanRaw(templateId);
  const renamedProgram = { ...templateRaw.programs.find((program) => String(program.idInPlan) === "3"), name: "Heracles verify renamed" };
  await adapter.updateNativeCorosPlan(templateId, {
    name: templateRaw.name,
    overview: templateRaw.overview ?? "",
    sessions: templateRaw.entities.map((entity) => ({
      idInPlan: String(entity.idInPlan),
      dayNo: Number(entity.dayNo),
      program: String(entity.idInPlan) === "3"
        ? renamedProgram
        : templateRaw.programs.find((program) => String(program.idInPlan) === String(entity.idInPlan))
    })),
    weekStages: []
  });
  const afterEdit = await calendar();
  check("editing the plan leaves the running copy alone", !afterEdit.some((entry) => entry.name === "Heracles verify renamed"), {
    calendar: afterEdit.map((entry) => `${entry.day}#${entry.idInPlan} ${entry.name}`)
  });

  // ---- quit ----
  await adapter.quitNativeCorosPlan(running.remoteId);
  const quitRow = (await adapter.listNativeCorosPlans()).find((candidate) => candidate.remoteId === running.remoteId);
  check("quit takes every session off the calendar", (await calendar()).length === 0, { instanceExecuteStatus: quitRow?.executeStatus });

  // ---- delete ----
  await adapter.deleteNativeCorosPlan(copy.remoteId);
  check("delete removes the plan from the list", !(await listIds()).includes(copy.remoteId));
} catch (error) {
  check(`aborted: ${error?.message ?? error}`, false);
  console.error(error);
} finally {
  try {
    for (const plan of await adapter.listNativeCorosPlans()) {
      if (plan.executeStatus === 1 && plan.sourcePlanId && createdPlans.has(plan.sourcePlanId)) {
        createdPlans.add(plan.remoteId);
        await adapter.quitNativeCorosPlan(plan.remoteId);
      }
    }
    for (const entry of await hub.listScheduledWorkoutEntries(window.start, window.end)) {
      await hub.removeScheduledWorkout(entry);
    }
    for (const id of createdPlans) {
      if ((await listIds()).includes(id)) await adapter.deleteNativeCorosPlan(id);
    }
    const finalIds = await listIds();
    assert.deepEqual(finalIds, baselineIds, "the plan list is back to where it started");
    assert.equal((await hub.listScheduledWorkoutEntries(window.start, window.end)).length, 0, "the calendar window is empty again");
    check("cleanup: plans and calendar as they were", true);
  } catch (error) {
    check(`cleanup failed: ${error?.message ?? error}`, false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const failed = results.filter((result) => !result.pass).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `${results.length} checks passed`);
process.exit(failed ? 1 : 0);
