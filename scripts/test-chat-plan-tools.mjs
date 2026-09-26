// Coach reading the athlete's COROS plans (P3.1 of docs/coach-plan-canvas.md):
// `list_training_plans` and `get_training_plan`.
//
// What is held down, each of which is easy to get wrong:
//
//   * The list costs no request when the Library has loaded: it is read from
//     `coros_plan_cache` and the stored matches.
//   * A running copy folds into the plan it was made from, a run taken off is
//     not listed, and an archived plan only when asked for.
//   * A plan on the calendar is read as its running copy — the dates and the
//     `calendar_plan_id` + `id_in_plan` pair a calendar session carries.
//   * Progress comes from activities, so a conversation that has not shared
//     them gets the plan without it — the plan itself is not withheld.
//   * A plan Coach made is named by its newest draft only in the conversation
//     that holds it.
//
// Usage:
//   npm run test:chat-plan-tools
//
// Runs under Electron for the better-sqlite3 ABI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts/fixtures/coros-plan-write", name), "utf8"));

const databaseModule = await import(distUrl("database.js"));
const planTools = await import(distUrl("chatPlanTools.js"));
const workoutTools = await import(distUrl("chatWorkoutTools.js"));
const sources = await import(distUrl("chatToolSources.js"));

databaseModule.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "chat-plan-tools-")));
databaseModule.setSetting("trainingHub.accessToken", "token-1");
databaseModule.setSetting("trainingHub.userId", "100000000000000001");
databaseModule.setSetting("trainingHub.regionId", "1");
databaseModule.setSetting("trainingHub.baseUrl", "https://teamapi.coros.com");

const cases = [];
const test = (name, run) => cases.push([name, run]);

/** Every request fails unless a route answers it; each one is recorded. */
function stubCoros(routes = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    calls.push(`${init.method ?? "GET"} ${target.pathname}`);
    const answer = routes[target.pathname];
    if (!answer) throw new Error(`offline: ${target.pathname}`);
    const body = typeof answer === "function" ? answer(target) : answer;
    return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => JSON.stringify(body) };
  };
  return calls;
}

const call = async (name, args = {}, options = {}) => JSON.parse(await planTools.handleChatPlanTool(name, args, options));

// A Wednesday, so "this week" is unambiguous.
const today = new Date(2027, 0, 20, 12);
const key = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const dashed = (date) => `${key(date).slice(0, 4)}-${key(date).slice(4, 6)}-${key(date).slice(6)}`;
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const lastMonday = addDays(today, -9); // 2027-01-11: week 2 of the run is this week

const run = (name, key, minutes) => ({
  key,
  name,
  sport: "run",
  steps: [{ kind: "training", name, target_type: "time", target_duration_seconds: minutes * 60 }]
});

function entry(id, weekIndex, dayIndex, name, minutes, start) {
  return {
    id: `e${id}`,
    weekIndex,
    dayIndex,
    sortOrder: 0,
    title: name,
    workout: run(name, `k${id}`, minutes),
    idInPlan: String(id),
    ...(start ? { happenDay: key(addDays(start, weekIndex * 7 + dayIndex)) } : {})
  };
}

function plan(remoteId, fields) {
  return {
    id: `coros:${remoteId}`,
    remoteId,
    remoteVersion: 1,
    name: fields.name,
    description: fields.description ?? "",
    weekCount: fields.weekCount ?? 2,
    weekStages: fields.weekStages ?? [],
    entries: fields.entries ?? [],
    sportMix: ["run"],
    calendar: fields.calendar ?? "unscheduled",
    ...(fields.startDate ? { startDate: fields.startDate } : {}),
    ...(fields.sourcePlanId ? { sourcePlanId: fields.sourcePlanId } : {}),
    tags: [],
    favorite: false,
    archived: false,
    updatedAt: "2027-01-01T00:00:00.000Z"
  };
}

const templateEntries = [entry(1, 0, 0, "Easy", 40), entry(2, 0, 3, "Tempo", 50), entry(3, 1, 0, "Easy", 45), entry(4, 1, 5, "Long run", 90)];
const copyEntries = [entry(1, 0, 0, "Easy", 40, lastMonday), entry(2, 0, 3, "Tempo", 50, lastMonday), entry(3, 1, 0, "Easy", 45, lastMonday), entry(4, 1, 5, "Long run", 90, lastMonday)];

databaseModule.saveCorosPlanCache(
  plan("T1", { name: "Base block", entries: templateEntries, weekStages: [{ weekIndex: 1, stage: 3 }] })
);
databaseModule.saveCorosPlanCache(
  plan("R1", {
    name: "Base block",
    entries: copyEntries,
    calendar: "running",
    startDate: dashed(lastMonday),
    sourcePlanId: "T1",
    weekStages: [{ weekIndex: 1, stage: 3 }]
  })
);
databaseModule.saveCorosPlanCache(plan("S1", { name: "Old run", calendar: "stopped", sourcePlanId: "T9" }));
databaseModule.saveCorosPlanCache(plan("A1", { name: "Archived block", entries: templateEntries }));
databaseModule.saveCorosPlanCache(plan("C1", { name: "Coach block", entries: templateEntries }));
databaseModule.saveCorosPlanCache(
  plan("L1", {
    name: "Twelve weeks",
    weekCount: 12,
    entries: Array.from({ length: 12 }, (_, week) => entry(100 + week, week, 2, `Week ${week + 1} run`, 30))
  })
);
databaseModule.saveTrainingPlanMetadata({ planId: "coros:A1", favorite: false, tags: [], archived: true, updatedAt: "2027-01-01T00:00:00.000Z" });

// Week 1 of the run: Monday done, Thursday missed. Week 2's Monday is ahead of the matcher.
const match = (idInPlan, status, day) => ({
  id: `m${idInPlan}`,
  schedulePlanId: "R1",
  scheduleIdInPlan: String(idInPlan),
  happenDay: key(day),
  status,
  manual: false,
  updatedAt: "2027-01-19T00:00:00.000Z"
});
databaseModule.saveTrainingActivityMatch(match(1, "completed", lastMonday));
databaseModule.saveTrainingActivityMatch(match(2, "missed", addDays(lastMonday, 3)));
databaseModule.saveTrainingActivityMatch(match(3, "upcoming", addDays(lastMonday, 7)));

// A Coach creation in two versions, the plan C1 saved from the first; its cards live in one conversation.
const draftRow = (draftId, version) => ({
  draftId,
  planJson: "{}",
  previewJson: "{}",
  createdAt: `2027-01-0${version}T00:00:00.000Z`,
  artifactId: "art-1",
  version,
  author: "coach"
});
databaseModule.saveChatPlanDraft(draftRow("d-v1", 1));
databaseModule.saveChatPlanDraft(draftRow("d-v2", 2));
databaseModule.saveTrainingPlanMetadata({
  planId: "coros:C1",
  favorite: false,
  tags: [],
  archived: false,
  origin: "coach",
  coach: { draftId: "d-v1" },
  updatedAt: "2027-01-01T00:00:00.000Z"
});
const now = "2027-01-02T00:00:00.000Z";
databaseModule
  .requireDatabase()
  .prepare("INSERT INTO chat_sessions (id, provider, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
  .run("conv-1", "claude-api", "Plan", JSON.stringify([{ kind: "planDraft", draft: { draftId: "d-v2" } }]), now, now);

// --- list_training_plans ------------------------------------------------------

test("the list is read from the cache and the matches, with no request", async () => {
  const calls = stubCoros();
  const result = await call("list_training_plans", {}, { today, sessionId: "conv-1" });
  assert.deepEqual(calls, [], "nothing is asked of COROS while the cache holds plans");
  assert.equal(result.ok, true);
  assert.deepEqual(result.plans.map((line) => line.plan_id).sort(), ["C1", "L1", "T1"]);
});

test("a running copy folds into its plan, with the week it is in and how it is going", async () => {
  stubCoros();
  const { plans } = await call("list_training_plans", {}, { today });
  const base = plans.find((line) => line.plan_id === "T1");
  assert.equal(base.calendar_plan_id, "R1", "the copy is the calendar's id, the one a calendar change names");
  assert.match(base.on_calendar, /since 2027-01-11; week 2 of 2 this week/);
  assert.equal(base.progress, "1 done, 1 missed, 1 ahead (50% of the sessions due were done)");
  assert.ok(!plans.some((line) => line.plan_id === "R1"), "the copy is not a second line");
  assert.ok(!plans.some((line) => line.plan_id === "S1"), "a run taken off is history");
  assert.equal(plans.find((line) => line.plan_id === "L1").on_calendar, "no");
});

test("an archived plan is listed only when asked for", async () => {
  stubCoros();
  const { plans } = await call("list_training_plans", { include_archived: true }, { today });
  assert.equal(plans.find((line) => line.plan_id === "A1")?.archived, true);
});

test("without the athlete's activities the list carries no progress, and says why", async () => {
  stubCoros();
  const result = await call("list_training_plans", {}, { today, progress: false });
  const base = result.plans.find((line) => line.plan_id === "T1");
  assert.equal(base.progress, undefined);
  assert.equal(base.calendar_plan_id, "R1", "the plan itself is still read");
  assert.match(result.progress_withheld, /not shared their training history/);
});

test("a plan Coach made is named by its newest draft, only in the conversation holding it", async () => {
  stubCoros();
  const here = (await call("list_training_plans", {}, { today, sessionId: "conv-1" })).plans.find((line) => line.plan_id === "C1");
  assert.equal(here.draft_id, "d-v2", "the newest version, so revise_training_plan takes it");
  assert.equal(here.made_by, "you, in this conversation");
  const elsewhere = (await call("list_training_plans", {}, { today, sessionId: "conv-2" })).plans.find((line) => line.plan_id === "C1");
  assert.equal(elsewhere.draft_id, undefined);
  assert.equal(elsewhere.made_by, "you, in another conversation");
});

// --- get_training_plan --------------------------------------------------------

test("a plan on the calendar is read as its running copy, falling back to the cache offline", async () => {
  const calls = stubCoros();
  const result = await call("get_training_plan", { plan_id: "coros:T1", sessions: ["4"] }, { today });
  assert.ok(calls.some((line) => line.endsWith("/training/plan/detail")), "COROS is asked for the plan first");
  assert.equal(result.ok, true);
  assert.equal(result.plan_id, "T1");
  assert.equal(result.calendar_plan_id, "R1");
  assert.match(result.note, /as the app last read it/);
  assert.deepEqual(result.week_list[0].sessions, [
    "#1 · Mon 2027-01-11 · Easy · run · 40 min · done",
    "#2 · Thu 2027-01-14 · Tempo · run · 50 min · missed"
  ]);
  assert.equal(result.week_list[1].stage, "Build");
  assert.equal(result.week_list[1].now, true);
  assert.equal(result.week_list[1].sessions[1], "#4 · Sat 2027-01-23 · Long run · run · 90 min");
  assert.equal(result.workouts.length, 1);
  assert.equal(result.workouts[0].id_in_plan, "4");
  assert.equal(result.workouts[0].date, "2027-01-23");
  assert.ok(result.workouts[0].workout_steps.length, "the steps come whole for a session asked for");
});

test("without the athlete's activities one plan carries no done or missed", async () => {
  stubCoros();
  const result = await call("get_training_plan", { plan_id: "T1" }, { today, progress: false });
  assert.equal(result.week_list[0].sessions[0], "#1 · Mon 2027-01-11 · Easy · run · 40 min");
  assert.equal(result.progress, undefined);
  assert.match(result.progress_withheld, /not shared/);
});

test("a plan not on the calendar is named by week and day; a long one shows its first weeks", async () => {
  stubCoros();
  const result = await call("get_training_plan", { plan_id: "L1" }, { today });
  assert.equal(result.calendar_plan_id, undefined);
  assert.deepEqual(result.week_list.map((week) => week.week), [1, 2, 3, 4]);
  assert.equal(result.week_list[0].sessions[0], "#100 · Wed · Week 1 run · run · 30 min");
  assert.equal(result.other_weeks, "weeks 5–12 not shown; ask with weeks");
  const asked = await call("get_training_plan", { plan_id: "L1", weeks: [12, 6] }, { today });
  assert.deepEqual(asked.week_list.map((week) => week.week), [6, 12]);
});

test("a plan read from COROS replaces the cache's copy", async () => {
  const instance = fixture("plan-detail-instance.json");
  stubCoros({ "/training/plan/detail": instance });
  const result = await call("get_training_plan", { plan_id: instance.data.id }, { today });
  assert.equal(result.ok, true);
  assert.equal(result.note, undefined, "read live");
  assert.equal(result.calendar_plan_id, instance.data.id);
  assert.equal(result.plan_id, instance.data.sourcePlanId, "named by the plan it came from");
  assert.match(result.week_list[0].sessions[0], /^#\d+ · Mon 2027-01-11 · /);
  assert.equal(databaseModule.getCorosPlanCache(instance.data.id)?.calendar, "running");
});

test("an unknown plan is refused with where to find one", async () => {
  stubCoros();
  const result = await call("get_training_plan", { plan_id: "nope" }, { today });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, "plan_not_found");
  assert.match(result.errors[0], /list_training_plans/);
});

test("an empty cache is filled the way the Library fills it, and says so when COROS is away", async () => {
  databaseModule.replaceCorosPlanCache([]);
  const calls = stubCoros();
  const result = await call("list_training_plans", {}, { today });
  assert.ok(calls.some((line) => line.endsWith("/training/plan/query")), "the list is read from COROS");
  assert.equal(result.ok, true);
  assert.deepEqual(result.plans, []);
  assert.match(result.note, /as the app last loaded it/);
});

// --- wiring ---------------------------------------------------------------------

test("the tools ride with the workout tools, and each has a source", () => {
  for (const name of planTools.CHAT_PLAN_TOOL_NAMES) {
    assert.ok(workoutTools.isChatWorkoutTool(name), `${name} is dispatched through the workout tools`);
    assert.ok(sources.LOCAL_CHAT_TOOL_SOURCES.has(name), `${name} has a source for the badge`);
  }
  assert.equal(sources.chatToolSource("list_training_plans"), "db");
  assert.equal(sources.chatToolSource("get_training_plan"), "coros");
});

let failed = 0;
for (const [name, runCase] of cases) {
  try {
    await runCase();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}
if (failed) {
  console.error(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);
