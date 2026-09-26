// The native COROS training-plan writes: the body builders, and each endpoint
// through the app's own request path against a faked COROS.
//
// Every shape here was probed live on 2026-09-24 (docs/coros-plan-write-api.md)
// and the fixtures in scripts/fixtures/coros-plan-write/ are those captures,
// redacted. What the suite holds down, each of which is easy to get wrong:
//
//   * `totalDay` is the last session's day + 1, and `minWeeks`/`maxWeeks` are
//     the fewest and most sessions in a week — not week counts.
//   * `update` names only what changed in `versionObjects` (1 add, 2 edit or
//     move, 3 remove), and an id is never reused past `maxIdInPlan`.
//   * On a plan that is on the calendar, a session's `happenDay` is counted
//     from the Monday of the start day's week, not from the start day.
//   * `executeSubPlan` answers no id; the instance is found in the list.
//   * `update`, `delete`, `executeSubPlan` and `quitSubPlan` answer `0000` with
//     no data, which is success.
//
// Usage:
//   npm run test:coros-plan-writes
//
// Runs under Electron for the better-sqlite3 ABI: the session is read from
// app_settings like the running app reads it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distUrl = (file) =>
  `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;
const fixtureDir = path.join(repoRoot, "scripts/fixtures/coros-plan-write");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));

const databaseModule = await import(distUrl("database.js"));
const trainingHub = await import(distUrl("trainingHubService.js"));
const adapter = await import(distUrl("corosTrainingPlanAdapter.js"));
const domain = await import(distUrl("trainingPlanDomain.js"));
const library = await import(distUrl("trainingLibraryService.js"));
const chatWorkoutTools = await import(distUrl("chatWorkoutTools.js"));

databaseModule.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "coros-plan-writes-")));
databaseModule.setSetting("trainingHub.accessToken", "token-1");
databaseModule.setSetting("trainingHub.userId", "100000000000000001");
databaseModule.setSetting("trainingHub.regionId", "1");
databaseModule.setSetting("trainingHub.baseUrl", "https://teamapi.coros.com");

const cases = [];
const test = (name, run) => cases.push([name, run]);
const clone = (value) => structuredClone(value);

const template = fixture("plan-detail-template.json").data;
const instance = fixture("plan-detail-instance.json").data;
const libraryProgram = fixture("plan-add-request.json").programs[0];

/** Answers by longest matching path; records method, URL and parsed body. */
function stubCoros(routes) {
  const calls = [];
  const patterns = Object.keys(routes).sort((a, b) => b.length - a.length);
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const call = {
      method: init.method ?? "GET",
      url: new URL(target),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    const pattern = patterns.find((candidate) => call.url.pathname === candidate || target.includes(candidate));
    if (!pattern) throw new Error(`unexpected COROS request: ${call.method} ${target}`);
    const answer = routes[pattern];
    const body = typeof answer === "function" ? answer(call, calls) : answer;
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };
  return {
    calls,
    to: (pathname) => calls.filter((call) => call.url.pathname === pathname)
  };
}

const ok = (data) => (data === undefined ? { apiCode: "A1", message: "OK", result: "0000" } : { apiCode: "A1", data, message: "OK", result: "0000" });

// --- create ------------------------------------------------------------------

const threeSessions = {
  name: "  Base block  ",
  overview: "Three runs.",
  sessions: [
    { dayNo: 9, program: libraryProgram },
    { dayNo: 0, program: libraryProgram },
    { dayNo: 0, program: { ...libraryProgram, name: "Second on Monday" } }
  ],
  weekStages: [{ weekNo: 2, stage: 3 }]
};

test("a create body has exactly the fields the web app's savePlan sends", () => {
  const body = adapter.buildNativePlanCreateBody(threeSessions, { region: "1" });
  assert.deepEqual(Object.keys(body).sort(), Object.keys(fixture("plan-add-request.json")).sort());
  assert.equal(body.name, "Base block", "the name is trimmed");
  assert.equal(body.region, 1, "region travels as a number, as the web app sends it");
});

test("sessions are ordered by day, then as given within a day", () => {
  const body = adapter.buildNativePlanCreateBody(threeSessions, { region: 1 });
  assert.deepEqual(
    body.entities.map((entity) => [entity.idInPlan, entity.dayNo, entity.sortNo, entity.sortNoInSchedule]),
    [[1, 0, 1, 1], [2, 0, 2, 2], [3, 9, 3, 1]]
  );
  assert.deepEqual(body.programs.map((program) => [program.idInPlan, program.name]), [
    [1, libraryProgram.name],
    [2, "Second on Monday"],
    [3, libraryProgram.name]
  ]);
  assert.ok(body.entities.every((entity) => entity.happenDay === ""), "a plan that is not on the calendar has no dates");
  assert.ok(body.programs.every((program) => !("happenDay" in program)));
  assert.deepEqual(body.versionObjects, [{ id: 1, status: 1 }, { id: 2, status: 1 }, { id: 3, status: 1 }]);
  assert.equal(body.maxIdInPlan, 3);
});

test("totalDay ends at the last session; min/maxWeeks count sessions per week", () => {
  const body = adapter.buildNativePlanCreateBody(threeSessions, { region: 1 });
  assert.equal(body.totalDay, 10, "day 9 is the last, so the plan is 10 days — a trailing empty week cannot exist");
  assert.equal(body.minWeeks, 1, "week 2 holds one session");
  assert.equal(body.maxWeeks, 2, "week 1 holds two — these are session counts, whatever the name says");
});

test("a week stage is one of COROS's seven", () => {
  const body = adapter.buildNativePlanCreateBody(threeSessions, { region: 1 });
  assert.deepEqual(body.weekStages.map((stage) => [stage.weekNo, stage.stage]), [[2, 3]]);
  assert.deepEqual(domain.COROS_WEEK_STAGES.map((stage) => stage.label), [
    "Not Set", "Preparation", "Base", "Build", "Peak", "Race", "Transition"
  ]);
  assert.throws(
    () => adapter.buildNativePlanCreateBody({ ...threeSessions, weekStages: [{ weekNo: 1, stage: 7 }] }, { region: 1 }),
    /Unknown COROS week stage 7/
  );
});

test("a staged plan is written the way the web app wrote one", () => {
  const captured = fixture("plan-add-stages-request.json");
  const body = adapter.buildNativePlanCreateBody(
    {
      name: captured.name,
      overview: captured.overview,
      sessions: captured.entities.map((entity, index) => ({ dayNo: entity.dayNo, program: captured.programs[index] })),
      weekStages: captured.weekStages.map(({ weekNo, stage }) => ({ weekNo, stage }))
    },
    { region: captured.region }
  );
  for (const field of ["weekStages", "totalDay", "minWeeks", "maxWeeks", "maxIdInPlan", "versionObjects"]) {
    assert.deepEqual(body[field], captured[field], field);
  }
  /* Where each session sits, and nothing else. The web app also copies each
     program's chart into its entity, and its sort numbers disagree between
     captures (1, 1, 1 here; COROS reads the same plan back as 1, 2, 3) —
     COROS renumbers on save, and takes what the adapter sends (verified live). */
  const placing = ({ idInPlan, dayNo, happenDay }) => [idInPlan, dayNo, happenDay];
  assert.deepEqual(body.entities.map(placing), captured.entities.map(placing), "entities");
});

test("a stage past the plan's last week is dropped", () => {
  const body = adapter.buildNativePlanCreateBody(
    { ...threeSessions, weekStages: [{ weekNo: 2, stage: 3 }, { weekNo: 5, stage: 5 }] },
    { region: 1 }
  );
  assert.deepEqual(body.weekStages.map((stage) => stage.weekNo), [2]);
});

test("pbVersion covers the most demanding program", () => {
  const body = adapter.buildNativePlanCreateBody(
    { ...threeSessions, sessions: [{ dayNo: 0, program: { ...libraryProgram, pbVersion: 9 } }] },
    { region: 1 }
  );
  assert.equal(body.pbVersion, 9);
});

test("what COROS would refuse is refused before it is sent", () => {
  const base = { name: "Plan", overview: "", weekStages: [] };
  assert.throws(() => adapter.buildNativePlanCreateBody({ ...base, name: "  ", sessions: [{ dayNo: 0, program: libraryProgram }] }, { region: 1 }), /needs a name/);
  assert.throws(() => adapter.buildNativePlanCreateBody({ ...base, sessions: [] }, { region: 1 }), /at least one session/);
  assert.throws(() => adapter.buildNativePlanCreateBody({ ...base, sessions: [{ dayNo: -1, program: libraryProgram }] }, { region: 1 }), /needs a day/);
  const eleven = Array.from({ length: 11 }, () => ({ dayNo: 3, program: libraryProgram }));
  assert.throws(() => adapter.buildNativePlanCreateBody({ ...base, sessions: eleven }, { region: 1 }), /at most 10 sessions/);
});

// --- update ------------------------------------------------------------------

const templateInput = (sessions, extra = {}) => ({
  name: template.name,
  overview: template.overview,
  sessions,
  weekStages: [],
  ...extra
});
const keepTemplateSession = { idInPlan: "1", dayNo: 0, program: template.programs[0] };

test("an unchanged session says nothing; an added one takes the next id", () => {
  const body = adapter.buildNativePlanUpdateBody(template, templateInput([
    keepTemplateSession,
    { dayNo: 2, program: libraryProgram }
  ]));
  assert.deepEqual(body.versionObjects, [{ id: 2, status: 1 }]);
  assert.deepEqual(
    body.versionObjects,
    fixture("plan-update-add-session-request.json").versionObjects,
    "the same change the live probe sent and COROS accepted"
  );
  assert.equal(body.maxIdInPlan, 2);
  assert.equal(body.entities[0].id, template.entities[0].id, "a kept session keeps every field COROS gave it");
  assert.equal(body.id, template.id, "the body is the detail it was read from");
});

test("a session new to the plan is sent as the web app sends one, whatever plan it was read from", () => {
  const copied = template.programs[0];
  const body = adapter.buildNativePlanUpdateBody(template, templateInput([
    keepTemplateSession,
    { dayNo: 2, program: copied }
  ]));
  const [kept, fresh] = body.programs;
  assert.equal(kept.planId, template.id, "a kept session keeps what COROS gave it");
  assert.equal(fresh.idInPlan, 2);
  const sent = fixture("plan-update-add-session-request.json").programs[1];
  for (const field of ["planId", "star"]) {
    assert.equal(field in sent, false, `the web app sends a new session without ${field}`);
    assert.equal(field in fresh, false, `and so does the app, for a session copied in the plan (${field})`);
  }
  assert.deepEqual(fresh.exercises, copied.exercises, "with the steps it was copied from");
  assert.deepEqual(body.versionObjects, [{ id: 2, status: 1 }]);

  const created = adapter.buildNativePlanCreateBody(templateInput([{ dayNo: 0, program: copied }]), { region: 1 });
  assert.equal("planId" in created.programs[0], false, "and a session saved into a new plan names no old one");
});

test("a rename alone is a plan-level change, not a session edit", () => {
  const body = adapter.buildNativePlanUpdateBody(template, templateInput([keepTemplateSession], { name: "Renamed" }));
  assert.equal(body.name, "Renamed");
  assert.deepEqual(body.versionObjects, []);
});

const keepInstance = (id, overrides = {}) => {
  const entity = instance.entities.find((candidate) => candidate.idInPlan === id);
  const program = instance.programs.find((candidate) => candidate.idInPlan === id);
  return { idInPlan: id, dayNo: entity.dayNo, program, ...overrides };
};
const instanceInput = (sessions, extra = {}) => ({
  name: instance.name,
  overview: instance.overview,
  sessions,
  weekStages: [],
  ...extra
});

test("a removed session is named with its plan ids and status 3", () => {
  const body = adapter.buildNativePlanUpdateBody(instance, instanceInput([keepInstance("2"), keepInstance("3")]));
  assert.deepEqual(body.versionObjects, [
    { id: "1", planProgramId: "1", planId: instance.id, status: 3 }
  ]);
  assert.deepEqual(
    Object.keys(body.versionObjects[0]).sort(),
    Object.keys(fixture("plan-update-remove-session-request.json").versionObjects[0]).sort(),
    "named the way the web app names a removal"
  );
  assert.deepEqual(body.entities.map((entity) => entity.idInPlan), ["2", "3"]);
  assert.deepEqual(body.programs.map((program) => program.idInPlan), ["2", "3"]);
});

test("moving a session on a running plan re-dates it from the start week's Monday", () => {
  const body = adapter.buildNativePlanUpdateBody(instance, instanceInput([
    keepInstance("1"),
    keepInstance("2", { dayNo: 10 }),
    keepInstance("3")
  ]));
  const moved = body.entities.find((entity) => entity.idInPlan === "2");
  assert.equal(moved.dayNo, 10);
  assert.equal(moved.happenDay, 20270121, "Monday 11 Jan + 10 days");
  assert.deepEqual(body.versionObjects, [
    { id: "2", planProgramId: "2", planId: instance.id, status: 2 }
  ]);
});

test("a session added to a running plan is dated; one started mid-week counts from its Monday", () => {
  const added = adapter.buildNativePlanUpdateBody(instance, instanceInput([
    keepInstance("1"), keepInstance("2"), keepInstance("3"),
    { dayNo: 4, program: libraryProgram }
  ]));
  const fresh = added.entities.find((entity) => entity.idInPlan === 4);
  assert.equal(fresh.happenDay, 20270115, "Friday of week 1");
  assert.deepEqual(added.versionObjects, [{ id: 4, status: 1 }]);

  const midWeek = { ...clone(instance), startDay: 20270113 };
  const fromWednesday = adapter.buildNativePlanUpdateBody(midWeek, instanceInput([
    keepInstance("1"), keepInstance("2"), keepInstance("3"),
    { dayNo: 4, program: libraryProgram }
  ]));
  assert.equal(
    fromWednesday.entities.find((entity) => entity.idInPlan === 4).happenDay,
    20270115,
    "a Wednesday start still puts day 0 on that week's Monday"
  );
});

test("an edited program is a session edit", () => {
  const renamed = { ...keepInstance("3").program, name: "Tempo instead" };
  const body = adapter.buildNativePlanUpdateBody(instance, instanceInput([
    keepInstance("1"), keepInstance("2"), keepInstance("3", { program: renamed })
  ]));
  assert.deepEqual(body.versionObjects, [{ id: "3", planProgramId: "3", planId: instance.id, status: 2 }]);
  assert.equal(body.programs.find((program) => program.idInPlan === "3").name, "Tempo instead");
});

test("an id is never reused, even after the session that held it is gone", () => {
  const used = { ...clone(instance), maxIdInPlan: "5" };
  const body = adapter.buildNativePlanUpdateBody(used, instanceInput([
    keepInstance("1"), { dayNo: 1, program: libraryProgram }
  ]));
  assert.ok(body.versionObjects.some((object) => object.id === 6 && object.status === 1));
  assert.equal(body.maxIdInPlan, 6);
});

test("a stage change keeps the stage's own fields and drops the calendar's", () => {
  const body = adapter.buildNativePlanUpdateBody(instance, instanceInput(
    [keepInstance("1"), keepInstance("2"), keepInstance("3")],
    { weekStages: [{ weekNo: 2, stage: 3 }] }
  ));
  assert.deepEqual(body.weekStages.map((stage) => [stage.weekNo, stage.stage]), [[1, 2], [2, 3], [3, 5]]);
  const week2 = body.weekStages[1];
  assert.equal(week2.id, instance.weekStages[1].id);
  assert.ok(body.weekStages.every((stage) => !("firstDayInWeek" in stage)));
});

test("a session the plan no longer holds is refused", () => {
  assert.throws(
    () => adapter.buildNativePlanUpdateBody(template, templateInput([{ idInPlan: "9", dayNo: 0, program: libraryProgram }])),
    /not in this plan any more/
  );
});

// --- endpoints ---------------------------------------------------------------

test("create posts the body with the session's region and answers the new id", async () => {
  const coros = stubCoros({ "/training/plan/add": fixture("plan-add-response.json") });
  const id = await adapter.createNativeCorosPlan(threeSessions);
  assert.equal(id, fixture("plan-add-response.json").data);
  const [call] = coros.to("/training/plan/add");
  assert.equal(call.method, "POST");
  assert.equal(call.body.region, 1);
  assert.equal(call.url.searchParams.toString(), "");
});

test("update reads the detail fresh, and a stated success with no data is success", async () => {
  const coros = stubCoros({
    "/training/plan/detail": ok(clone(template)),
    "/training/plan/update": fixture("plan-update-response.json")
  });
  await adapter.updateNativeCorosPlan(template.id, templateInput([keepTemplateSession], { name: "New name" }));
  assert.equal(coros.to("/training/plan/detail")[0].url.searchParams.get("id"), template.id);
  assert.equal(coros.to("/training/plan/update")[0].body.name, "New name");
});

test("copy sends the detail with the id and region, and answers the copy", async () => {
  const coros = stubCoros({
    "/training/plan/detail": ok(clone(instance)),
    "/training/plan/copy": fixture("plan-copy-response.json")
  });
  const copy = await adapter.copyNativeCorosPlan(instance.id);
  const [call] = coros.to("/training/plan/copy");
  assert.equal(call.url.searchParams.get("id"), instance.id);
  assert.equal(call.url.searchParams.get("region"), "1");
  assert.ok(call.body.weekStages.every((stage) => !("firstDayInWeek" in stage)));
  assert.equal(copy.remoteId, fixture("plan-copy-response.json").data.id);
  assert.equal(copy.executeStatus, 0, "a copy of a running plan is not on the calendar");
});

test("delete sends the id in an array", async () => {
  const coros = stubCoros({ "/training/plan/delete": fixture("plan-delete-response.json") });
  await adapter.deleteNativeCorosPlan("480562318858699251");
  assert.deepEqual(coros.to("/training/plan/delete")[0].body, fixture("plan-delete-request.json"));
});

test("execute finds the instance it made, since COROS does not say", async () => {
  const after = fixture("plan-query-after-execute.json");
  const templateRow = after.data.find((plan) => plan.executeStatus === 0);
  let executed = false;
  const coros = stubCoros({
    "/training/plan/query": () => ok(executed ? after.data : [templateRow]),
    "/training/schedule/executeSubPlan": () => {
      executed = true;
      return fixture("schedule-execute-subplan.json").response;
    }
  });
  const made = await adapter.executeNativeCorosPlan(templateRow.id, "20270111");
  const [call] = coros.to("/training/schedule/executeSubPlan");
  assert.equal(call.url.searchParams.get("subPlanId"), templateRow.id);
  assert.equal(call.url.searchParams.get("startDay"), "20270111");
  assert.equal(made.executeStatus, 1);
  assert.equal(made.sourcePlanId, templateRow.id);
  assert.equal(made.startDay, "20270111");
});

test("execute says so when the instance has not appeared", async () => {
  const templateRow = fixture("plan-query-after-execute.json").data.find((plan) => plan.executeStatus === 0);
  stubCoros({
    "/training/plan/query": ok([templateRow]),
    "/training/schedule/executeSubPlan": fixture("schedule-execute-subplan.json").response
  });
  await assert.rejects(adapter.executeNativeCorosPlan(templateRow.id, "20270111"), /has not appeared yet/);
});

test("execute refuses a malformed day before asking COROS anything", async () => {
  const coros = stubCoros({});
  await assert.rejects(adapter.executeNativeCorosPlan("1", "2027-01-11"), /yyyyMMdd/);
  assert.equal(coros.calls.length, 0);
});

test("quit names the instance", async () => {
  const coros = stubCoros({ "/training/schedule/quitSubPlan": fixture("schedule-quit-subplan.json").response });
  await adapter.quitNativeCorosPlan(instance.id);
  assert.equal(coros.to("/training/schedule/quitSubPlan")[0].url.searchParams.get("subPlanId"), instance.id);
});

test("the write bridge takes its six paths and no other", async () => {
  stubCoros({});
  await assert.rejects(
    trainingHub.writeNativeTrainingPlanEndpoint("/training/program/delete", { body: ["1"] }),
    /Unsupported native training-plan write/
  );
});

// --- the library's saves, against a COROS that keeps what it is sent --------

const dayKeyOf = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const todayKey = () => dayKeyOf(new Date());
const dayAfter = (key, days) =>
  dayKeyOf(new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6)) + days));

/**
 * A COROS that behaves like the one probed: ids it allocates, `version`
 * bumped on each update, a copy that keeps the name, a delete that is soft
 * (`status: 0`, gone from the list, still answering `detail`), and a
 * `calculate` that prices whatever it is given.
 */
function fakeCoros(seed = [], { firstId = 900 } = {}) {
  /* A new COROS starts with nothing of the last one cached. */
  databaseModule.replaceCorosPlanCache([]);
  const plans = new Map(seed.map((plan) => [String(plan.id), structuredClone(plan)]));
  let nextId = firstId;
  const withIds = (id, body) => ({
    ...structuredClone(body),
    id,
    status: 1,
    executeStatus: body.executeStatus ?? 0,
    version: body.version ?? 0,
    entities: (body.entities ?? []).map((entity) => ({ ...entity, idInPlan: String(entity.idInPlan), planProgramId: String(entity.idInPlan), planId: id })),
    programs: (body.programs ?? []).map((program, index) => ({ ...program, idInPlan: String(program.idInPlan), id: `${id}-p${index}`, exercises: program.exercises ?? [] }))
  });
  const coros = stubCoros({
    /* A run taken off the calendar is listed without its sessions (measured). */
    "/training/plan/query": () =>
      ok(
        [...plans.values()]
          .filter((plan) => plan.status !== 0)
          .map((plan) => (plan.executeStatus === 2 ? { ...plan, entities: [], programs: [] } : plan))
      ),
    "/training/plan/detail": (call) => ok(structuredClone(plans.get(call.url.searchParams.get("id")))),
    "/training/plan/add": (call) => {
      const id = String(nextId++);
      plans.set(id, withIds(id, coros.mangleAdd ? coros.mangleAdd(call.body) : call.body));
      return ok(id);
    },
    "/training/plan/update": (call) => {
      const id = String(call.body.id);
      const previous = plans.get(id);
      plans.set(id, withIds(id, { ...call.body, version: (previous?.version ?? 0) + 1, executeStatus: previous?.executeStatus }));
      return ok();
    },
    "/training/plan/copy": (call) => {
      const id = String(nextId++);
      const copy = withIds(id, { ...call.body, version: 0, executeStatus: 0, originId: call.url.searchParams.get("id") });
      plans.set(id, copy);
      return ok(copy);
    },
    "/training/plan/delete": (call) => {
      for (const id of call.body) plans.get(String(id)).status = 0;
      return ok();
    },
    "/training/schedule/executeSubPlan": (call) => {
      const source = plans.get(call.url.searchParams.get("subPlanId"));
      const id = String(nextId++);
      plans.set(id, withIds(id, {
        ...source,
        executeStatus: 1,
        sourcePlanId: source.id,
        startDay: Number(call.url.searchParams.get("startDay")),
        endDay: Number(dayAfter(call.url.searchParams.get("startDay"), (source.totalDay ?? 1) + 6))
      }));
      return ok();
    },
    /* Status 2, like a run that ran out; only `endDay`, moved to today, says otherwise. */
    "/training/schedule/quitSubPlan": (call) => {
      const plan = plans.get(call.url.searchParams.get("subPlanId"));
      plan.executeStatus = 2;
      plan.endDay = Number(dayAfter(todayKey(), 0));
      return ok();
    },
    "/training/schedule/query": () => ok(coros.schedule ?? { entities: [], programs: [] }),
    "/training/program/calculate": () =>
      ok({ planDuration: 1800, planDistance: 500000, planTrainingLoad: 40, planSets: 3, exerciseBarChart: [] }),
    "/account/query": ok({}),
    "coros-traininghub-v2": ok({})
  });
  coros.plans = plans;
  return coros;
}

const writtenRun = {
  key: "written",
  name: "Written run",
  sport: "run",
  save_to_library: false,
  steps: [{ kind: "training", target_type: "time", target_duration_seconds: 1800, intensity: { type: "none" } }]
};
const draftDocument = (entries, extra = {}) => ({
  id: "draft:new",
  name: "Saved from the app",
  description: "Two runs.",
  weekCount: 1,
  weekStages: [{ weekIndex: 0, stage: 2 }],
  entries,
  sportMix: ["run"],
  calendar: "unscheduled",
  tags: [],
  favorite: false,
  archived: false,
  updatedAt: "2026-09-24T00:00:00.000Z",
  ...extra
});
const libraryEntry = {
  id: "lib",
  weekIndex: 0,
  dayIndex: 0,
  sortOrder: 0,
  title: libraryProgram.name,
  workout: { key: "lib", name: libraryProgram.name, sport: "run", save_to_library: false },
  corosProgram: libraryProgram
};
const writtenEntry = { id: "new", weekIndex: 0, dayIndex: 2, sortOrder: 0, title: "Written run", workout: writtenRun };

test("a new plan is created: kept programs as they are, written sessions calculated", async () => {
  const coros = fakeCoros();
  const draft = library.savePlanDraft({ plan: draftDocument([libraryEntry, writtenEntry]) });
  const result = await library.savePlanToCoros({
    plan: draftDocument([libraryEntry, writtenEntry], { origin: "coach", coach: { draftId: "chat-1" } }),
    unitSystem: "metric",
    draftId: draft.id
  });
  assert.equal(result.ok, true);
  const [add] = coros.to("/training/plan/add");
  assert.equal(add.body.name, "Saved from the app");
  assert.equal(add.body.programs[0].name, libraryProgram.name, "the library program goes in as it came");
  assert.equal(coros.to("/training/program/calculate").length, 1, "only the session written here is calculated");
  assert.deepEqual(add.body.weekStages.map((stage) => [stage.weekNo, stage.stage]), [[1, 2]]);
  assert.equal(result.plan.remoteId, "900");
  assert.equal(result.plan.entries.length, 2, "read back from COROS");
  assert.equal(databaseModule.getTrainingPlanDraft(draft.id), undefined, "the draft is let go once the plan is on COROS");
  assert.equal(databaseModule.getTrainingPlanMetadata("coros:900").origin, "coach", "where it came from is kept beside it");
});

test("an edit updates the plan in place, and a session nobody touched is written back as it was", async () => {
  const coros = fakeCoros([clone(template)]);
  const document = library.nativePlanToDocument(adapter.parseNativeCorosPlan(clone(template)));
  const result = await library.savePlanToCoros({
    plan: { ...document, name: "Renamed" },
    unitSystem: "metric",
    expectedVersion: 0
  });
  assert.equal(result.ok, true);
  const [update] = coros.to("/training/plan/update");
  assert.equal(update.body.name, "Renamed");
  assert.deepEqual(update.body.versionObjects, [], "a rename touches no session");
  assert.equal(update.body.programs[0].exercises.length, template.programs[0].exercises.length);
  assert.equal(coros.to("/training/program/calculate").length, 0, "nothing is recalculated");
  assert.equal(coros.to("/training/plan/add").length, 0);
  assert.equal(result.plan.remoteVersion, 1);
});

test("a session copied in the editor is saved as a new session", async () => {
  const coros = fakeCoros([clone(template)]);
  const document = library.nativePlanToDocument(adapter.parseNativeCorosPlan(clone(template)));
  const copy = domain.copiedEntry(document.entries[0], { dayIndex: 2 });
  const result = await library.savePlanToCoros({
    plan: { ...document, entries: [...document.entries, copy] },
    unitSystem: "metric",
    expectedVersion: 0
  });
  assert.equal(result.ok, true);
  const [update] = coros.to("/training/plan/update");
  assert.deepEqual(update.body.versionObjects, [{ id: 2, status: 1 }], "COROS is told of one new session");
  const [kept, fresh] = update.body.programs;
  assert.equal(kept.planId, template.id);
  assert.equal("planId" in fresh || "star" in fresh, false, "and it names no session it was copied from");
  assert.deepEqual(fresh.exercises, kept.exercises, "it has the steps it was copied from");
  assert.equal(coros.to("/training/program/calculate").length, 0, "an untouched copy is not recalculated");
  assert.equal(result.plan.entries.length, 2);
});

test("clearing a week's stage clears it on COROS", async () => {
  const staged = { ...clone(template), weekStages: [{ weekNo: 1, stage: 3 }] };
  const coros = fakeCoros([staged]);
  const document = library.nativePlanToDocument(adapter.parseNativeCorosPlan(clone(staged)));
  assert.deepEqual(document.weekStages, [{ weekIndex: 0, stage: 3 }]);
  await library.savePlanToCoros({ plan: { ...document, weekStages: [] }, unitSystem: "metric", expectedVersion: 0 });
  assert.deepEqual(
    coros.to("/training/plan/update")[0].body.weekStages.map((stage) => [stage.weekNo, stage.stage]),
    [[1, 0]],
    "Not Set is sent, or COROS keeps the Build it had"
  );
});

test("a plan changed on COROS since the edit began is a conflict, and nothing is written", async () => {
  const coros = fakeCoros([{ ...clone(template), version: 4 }]);
  const document = library.nativePlanToDocument(adapter.parseNativeCorosPlan(clone(template)));
  const result = await library.savePlanToCoros({ plan: document, unitSystem: "metric", expectedVersion: 0 });
  assert.deepEqual(result, { ok: false, conflict: { currentVersion: 4, expectedVersion: 0 } });
  assert.equal(coros.to("/training/plan/update").length, 0);
  const overwritten = await library.savePlanToCoros({ plan: document, unitSystem: "metric", expectedVersion: 0, overwrite: true });
  assert.equal(overwritten.ok, true, "and the athlete can choose to write over it");
  assert.equal(coros.to("/training/plan/update").length, 1);
});

test("an edit of a plan COROS deleted is saved as a new plan", async () => {
  const coros = fakeCoros([{ ...clone(template), status: 0 }]);
  const document = library.nativePlanToDocument(adapter.parseNativeCorosPlan(clone(template)));
  const result = await library.savePlanToCoros({ plan: document, unitSystem: "metric", expectedVersion: 0 });
  assert.equal(result.ok, true);
  assert.equal(coros.to("/training/plan/update").length, 0, "a soft-deleted plan still answers detail; it must not be written into");
  assert.equal(coros.to("/training/plan/add").length, 1);
  assert.notEqual(result.plan.remoteId, template.id);
});

test("a plan that reads back short keeps the draft", async () => {
  const coros = fakeCoros();
  coros.mangleAdd = (body) => ({ ...body, entities: body.entities.slice(0, 1), programs: body.programs.slice(0, 1) });
  const draft = library.savePlanDraft({ plan: draftDocument([libraryEntry, writtenEntry]) });
  await assert.rejects(
    library.savePlanToCoros({ plan: draftDocument([libraryEntry, writtenEntry]), unitSystem: "metric", draftId: draft.id }),
    /reads back with 1 of 2 sessions/
  );
  assert.ok(databaseModule.getTrainingPlanDraft(draft.id), "the edit is still here");
  library.discardPlanDraft(draft.id);
});

test("duplicate copies on COROS and names the copy", async () => {
  const coros = fakeCoros([clone(template)]);
  const copy = await library.duplicatePlanOnCoros(`coros:${template.id}`);
  assert.equal(coros.to("/training/plan/copy").length, 1);
  assert.equal(copy.name, `${template.name} Copy`, "COROS's copy keeps the name; the app's is told apart");
  assert.equal(copy.entries.length, template.entities.length);
  assert.equal(copy.calendar, "unscheduled");
});

test("a plan on the calendar is not deleted unless it is taken off first", async () => {
  const running = { ...clone(template), id: "run-1", executeStatus: 1, sourcePlanId: template.id, startDay: 20270111 };
  const coros = fakeCoros([clone(template), running]);
  await assert.rejects(library.deletePlanFromCoros("coros:run-1", true), /on the calendar/, "a running copy");
  await assert.rejects(
    library.deletePlanFromCoros(`coros:${template.id}`, true),
    /on the calendar/,
    "nor the plan a running copy came from"
  );
  assert.equal(coros.to("/training/plan/delete").length, 0);
  assert.equal(coros.to("/training/schedule/quitSubPlan").length, 0, "nothing is taken off unasked");
  await assert.rejects(library.deletePlanFromCoros(`coros:${template.id}`, false), /confirmation/);
});

test("deleting a plan on the calendar takes it off first, and its run with it", async () => {
  const running = { ...clone(template), id: "run-1", executeStatus: 1, sourcePlanId: template.id, startDay: 20270111 };
  const coros = fakeCoros([clone(template), running]);
  await library.deletePlanFromCoros(`coros:${template.id}`, true, { takeOffCalendar: true });
  const order = coros.calls
    .filter((call) => /quitSubPlan|plan\/delete/.test(call.url.pathname))
    .map((call) => (call.url.pathname.endsWith("quitSubPlan") ? `quit ${call.url.searchParams.get("subPlanId")}` : `delete ${call.body[0]}`));
  assert.deepEqual(
    order,
    ["quit run-1", `delete ${template.id}`, "delete run-1"],
    "off the calendar before anything is deleted, and the run is not left behind as a stopped copy"
  );

  const alone = { ...clone(template), id: "run-2", executeStatus: 1, sourcePlanId: "gone", startDay: 20270111 };
  const own = fakeCoros([alone]);
  await library.deletePlanFromCoros("coros:run-2", true, { takeOffCalendar: true });
  assert.deepEqual(own.to("/training/schedule/quitSubPlan").map((call) => call.url.searchParams.get("subPlanId")), ["run-2"]);
  assert.deepEqual(own.to("/training/plan/delete").map((call) => call.body), [["run-2"]], "a running copy asked directly is deleted once");
});

test("a removal that fails deletes nothing", async () => {
  const running = { ...clone(template), id: "run-1", executeStatus: 1, sourcePlanId: template.id, startDay: 20270111 };
  const quit = stubCoros({
    "/training/plan/query": ok([clone(template), running]),
    "/training/schedule/quitSubPlan": { apiCode: "A1", message: "Service exceptions", result: "1001" }
  });
  await assert.rejects(library.deletePlanFromCoros(`coros:${template.id}`, true, { takeOffCalendar: true }));
  assert.equal(quit.to("/training/plan/delete").length, 0);
});

test("delete removes the plan and the app's record of it", async () => {
  const coros = fakeCoros([clone(template)]);
  databaseModule.saveTrainingPlanMetadata({ planId: `coros:${template.id}`, favorite: true, tags: [], archived: false, updatedAt: "2026-09-24T00:00:00.000Z" });
  await library.deletePlanFromCoros(`coros:${template.id}`, true);
  assert.deepEqual(coros.to("/training/plan/delete")[0].body, [template.id]);
  assert.equal(databaseModule.getTrainingPlanMetadata(`coros:${template.id}`), undefined);
});

// --- the calendar, through COROS's running copy of a plan -------------------

/** The template with sessions on days 0, 1 and 3 of week 1 and day 1 of week 2. */
function weeklyTemplate() {
  const plan = clone(template);
  const [entity] = plan.entities;
  const [program] = plan.programs;
  const days = [0, 1, 3, 8];
  plan.entities = days.map((dayNo, index) => ({ ...entity, idInPlan: String(index + 1), planProgramId: String(index + 1), dayNo }));
  plan.programs = days.map((_, index) => ({ ...program, idInPlan: String(index + 1), name: `Session ${index + 1}` }));
  plan.totalDay = 9;
  return plan;
}
const planId = `coros:${template.id}`;

test("a preview dates the plan from the Monday of the start day's week, and says what it leaves off", async () => {
  const coros = fakeCoros([weeklyTemplate()]);
  coros.schedule = {
    entities: [{ happenDay: "20270115", idInPlan: "7", planId: "elsewhere", planProgramId: "7" }],
    programs: [{ idInPlan: "7", id: "7", name: "Club run" }]
  };
  // Wednesday 13 January 2027.
  const preview = await library.previewPlanOnCalendar(planId, "20270113");
  assert.equal(preview.anchorDay, "20270111", "COROS counts from the Monday, not the day picked");
  assert.deepEqual(
    preview.entries.map((entry) => [entry.name, entry.happenDay, entry.dropped]),
    [
      ["Session 1", "20270111", true],
      ["Session 2", "20270112", true],
      ["Session 3", "20270114", false],
      ["Session 4", "20270119", false]
    ],
    "sessions before the start day are left off, which COROS does without a word"
  );
  assert.deepEqual(preview.blockers, []);
  const [query] = coros.to("/training/schedule/query");
  assert.deepEqual(
    [query.url.searchParams.get("startDate"), query.url.searchParams.get("endDate")],
    ["20270111", "20270124"],
    "the calendar is read across the plan's weeks from the Monday"
  );
  assert.deepEqual(preview.entries[2].existing, [], "a day with nothing on it");
  coros.schedule.entities[0].happenDay = "20270114";
  const shared = await library.previewPlanOnCalendar(planId, "20270113");
  assert.deepEqual(shared.entries[2].existing, ["Club run"], "and one already holding a workout, which COROS never checks");
});

test("a draft is previewed from this machine, before it is on COROS", async () => {
  const coros = fakeCoros();
  const entries = [libraryEntry, { ...writtenEntry, id: "w2", weekIndex: 1, dayIndex: 1 }];
  const draft = library.savePlanDraft({ plan: { ...draftDocument(entries), weekCount: 2 } });
  // Wednesday 13 January 2027.
  const preview = await library.previewPlanOnCalendar(draft.id, "20270113");
  assert.equal(preview.anchorDay, "20270111");
  assert.deepEqual(
    preview.entries.map((entry) => [entry.happenDay, entry.dropped]),
    [["20270111", true], ["20270119", false]],
    "a generated plan is asked for its day before it is saved"
  );
  assert.deepEqual(preview.blockers, []);
  assert.equal(coros.to("/training/plan/detail").length, 0, "and COROS is asked only for the calendar");
  assert.equal(coros.to("/training/schedule/query").length, 1);
  library.discardPlanDraft(draft.id);
  await assert.rejects(library.previewPlanOnCalendar(draft.id, "20270113"), /no longer in your library/);
});

test("a preview refuses what COROS would accept and get wrong", async () => {
  const running = { ...weeklyTemplate(), id: "run-1", executeStatus: 1, sourcePlanId: template.id, startDay: 20270111 };
  const listed = fakeCoros([weeklyTemplate(), running]);
  // What a snapshot leaves behind: the running copy, cached.
  await library.getNativeTrainingPlan("run-1");
  assert.match(
    (await library.previewPlanOnCalendar(planId, "20270111")).blockers.join(" "),
    /already on the calendar/,
    "a second run of one plan would put every session on the calendar twice"
  );
  assert.equal(listed.to("/training/plan/query").length, 0, "and the cache answers that, on every day picked");
  assert.match((await library.previewPlanOnCalendar("coros:run-1", "20270111")).blockers.join(" "), /run of a plan/);

  fakeCoros([weeklyTemplate()]);
  assert.match((await library.previewPlanOnCalendar(planId, "20200106")).blockers.join(" "), /in the past/);
  // Sunday 17 January: every session of week 1 is before it, and week 2's is on the 19th.
  assert.deepEqual((await library.previewPlanOnCalendar(planId, "20270117")).blockers, []);
  const empty = { ...weeklyTemplate(), entities: [], programs: [] };
  fakeCoros([empty]);
  assert.match((await library.previewPlanOnCalendar(planId, "20270111")).blockers.join(" "), /no sessions/);
  const firstWeekOnly = { ...weeklyTemplate(), totalDay: 4 };
  firstWeekOnly.entities = firstWeekOnly.entities.slice(0, 3);
  firstWeekOnly.programs = firstWeekOnly.programs.slice(0, 3);
  fakeCoros([firstWeekOnly]);
  assert.match(
    (await library.previewPlanOnCalendar(planId, "20270117")).blockers.join(" "),
    /leaves none/,
    "a start that drops every session would put an empty plan on the calendar"
  );
});

test("adding runs the plan from the day picked and answers the running copy", async () => {
  const coros = fakeCoros([weeklyTemplate()]);
  const copy = await library.putPlanOnCalendar(planId, "20270113");
  const [execute] = coros.to("/training/schedule/executeSubPlan");
  assert.equal(execute.url.searchParams.get("subPlanId"), template.id);
  assert.equal(execute.url.searchParams.get("startDay"), "20270113");
  assert.equal(copy.calendar, "running");
  assert.equal(copy.sourcePlanId, template.id);
  assert.notEqual(copy.remoteId, template.id);
});

test("adding a plan COROS already runs is refused at the write, whatever the cache says", async () => {
  const running = { ...weeklyTemplate(), id: "run-1", executeStatus: 1, sourcePlanId: template.id, startDay: 20270111 };
  // Put on the calendar on another machine since this one last looked.
  const coros = fakeCoros([weeklyTemplate(), running]);
  await assert.rejects(library.putPlanOnCalendar(planId, "20270113"), /already on the calendar/);
  assert.equal(coros.to("/training/schedule/executeSubPlan").length, 0);
});

test("adding what the preview refuses writes nothing", async () => {
  const coros = fakeCoros([weeklyTemplate()]);
  await assert.rejects(library.putPlanOnCalendar(planId, "20200106"), /in the past/);
  assert.equal(coros.to("/training/schedule/executeSubPlan").length, 0);
});

test("removing takes off the running copy, asked of the plan or of the copy", async () => {
  const running = { ...weeklyTemplate(), id: "run-1", executeStatus: 1, sourcePlanId: template.id, startDay: 20270111 };
  let coros = fakeCoros([weeklyTemplate(), clone(running)]);
  await library.takePlanOffCalendar(planId);
  assert.equal(coros.to("/training/schedule/quitSubPlan")[0].url.searchParams.get("subPlanId"), "run-1", "never the template itself");
  coros = fakeCoros([weeklyTemplate(), clone(running)]);
  await library.takePlanOffCalendar("coros:run-1");
  assert.equal(coros.to("/training/schedule/quitSubPlan")[0].url.searchParams.get("subPlanId"), "run-1");
  await assert.rejects(library.takePlanOffCalendar("coros:run-1"), /not on the calendar/, "a finished run has nothing to take off");
});

test("updating the calendar writes the plan onto its running copy, never plan/sync", async () => {
  /*
   * plan/sync was measured on 2026-09-25 leaving a moved session on its old
   * day, calendar and copy alike, while plan/update on the copy moves it.
   */
  const running = { ...weeklyTemplate(), id: "run-1", executeStatus: 1, sourcePlanId: template.id, startDay: 20270111 };
  // A running copy carries its real dates, as COROS sends them.
  running.entities = running.entities.map((entity) => ({ ...entity, happenDay: Number(dayAfter("20270111", entity.dayNo)) }));
  const coros = fakeCoros([weeklyTemplate(), running]);
  const plan = coros.plans.get(template.id);
  const program = (id) => plan.programs.find((item) => String(item.idInPlan) === id);
  // Moved 1 to Wednesday, dropped 2, kept 3 and 4, added one on Saturday.
  plan.entities = [
    { ...plan.entities[0], idInPlan: "1", dayNo: 2 },
    { ...plan.entities[2], idInPlan: "3", dayNo: 3 },
    { ...plan.entities[3], idInPlan: "4", dayNo: 8 },
    { ...plan.entities[0], idInPlan: "9", dayNo: 5 }
  ];
  plan.programs = [program("1"), program("3"), program("4"), { ...program("1"), idInPlan: "9", name: "Added" }];

  const copy = await library.syncPlanToCalendar(planId);
  assert.equal(coros.to("/training/plan/sync").length, 0, "plan/sync is not asked");
  const [update] = coros.to("/training/plan/update");
  assert.equal(String(update.body.id), "run-1", "the running copy is what is written");
  assert.deepEqual(
    update.body.versionObjects.map((item) => [String(item.id), item.status]).sort(),
    [["1", 2], ["2", 3], ["5", 1]],
    "moved in place, removed, and added under the copy's next id"
  );
  assert.deepEqual(
    update.body.entities.map((entity) => [String(entity.idInPlan), String(entity.happenDay)]).sort(),
    [["1", "20270113"], ["3", "20270114"], ["4", "20270119"], ["5", "20270116"]],
    "each on its day, counted from the run's Monday"
  );
  assert.equal(copy.remoteId, "run-1");
  fakeCoros([weeklyTemplate()]);
  await assert.rejects(library.syncPlanToCalendar(planId), /no copy on the calendar/);
});

test("only what is still ahead follows the plan", () => {
  const plan = weeklyTemplate();
  const program = (id) => plan.programs.find((item) => String(item.idInPlan) === id);
  const at = (id, dayNo) => ({ ...plan.entities[0], idInPlan: id, dayNo });
  const copy = { ...weeklyTemplate(), id: "run-1", executeStatus: 1, startDay: 20270111 };
  // The plan moved 1 forward, dropped 2, moved 3, and added one on a day already gone.
  const edited = {
    ...plan,
    entities: [at("1", 5), at("3", 4), at("4", 8), at("7", 2)],
    programs: [program("1"), program("3"), program("4"), { ...program("1"), idInPlan: "7" }]
  };
  // Thursday 14 January: Monday and Tuesday are gone, Wednesday too.
  const input = library.planOntoRunningCopy(edited, copy, "20270114");
  assert.deepEqual(
    input.sessions.map((session) => [session.idInPlan ?? "new", session.dayNo]).sort(),
    [["1", 0], ["2", 1], ["3", 4], ["4", 8]],
    "sessions on days gone stay as the calendar has them; what is ahead is the plan's, and a new one in the past is not added"
  );

  const lateStart = { ...copy, startDay: 20270113 };
  const fromWednesday = library.planOntoRunningCopy(
    { ...plan, entities: [at("1", 0), at("2", 1), at("3", 3)], programs: [program("1"), program("2"), program("3")] },
    { ...lateStart, entities: [at("3", 3)], programs: [program("3")] },
    "20270101"
  );
  assert.deepEqual(
    fromWednesday.sessions.map((session) => [session.idInPlan, session.dayNo]),
    [["3", 3]],
    "a session before the run's start day is left off, as COROS leaves it off when the plan goes on"
  );
});

// --- opening a plan ----------------------------------------------------------

test("opening a plan reads its detail, and the whole list only when the detail has no programs", async () => {
  const coros = fakeCoros([{ ...weeklyTemplate(), id: "open-1" }]);
  const plan = await library.getNativeTrainingPlan("open-1");
  assert.equal(plan.entries.length, 4);
  assert.equal(coros.to("/training/plan/detail").length, 1);
  assert.equal(
    coros.to("/training/plan/query").length,
    0,
    "the list is every plan with every program — asking for it on each open was most of the cost"
  );

  const listed = { ...weeklyTemplate(), id: "open-2" };
  const bare = stubCoros({
    "/training/plan/detail": ok({ ...clone(listed), programs: [] }),
    "/training/plan/query": ok([listed]),
    "coros-traininghub-v2": ok({})
  });
  const fallback = await library.getNativeTrainingPlan("open-2");
  assert.equal(bare.to("/training/plan/query").length, 1, "a detail without programs still borrows them from the list");
  assert.ok(fallback.entries.every((entry) => entry.corosProgram), "and the plan still reads in full");
});

test("a plan read on its own keeps its running copy, as the list does", async () => {
  const source = { ...weeklyTemplate(), id: "open-tpl" };
  const running = { ...weeklyTemplate(), id: "open-run", executeStatus: 1, sourcePlanId: "open-tpl", startDay: 20270111 };
  fakeCoros([source, running]);
  // What a snapshot leaves behind: the running copy, cached.
  await library.getNativeTrainingPlan("open-run");
  const plan = await library.getNativeTrainingPlan("open-tpl");
  assert.equal(
    plan.runningInstanceId,
    "open-run",
    "read alone it came back unlinked: the reader lost its calendar mark and offered to add it again"
  );
  assert.equal(databaseModule.getCorosPlanCache("open-tpl").runningInstanceId, undefined, "the link is not stored, it is joined");
});

test("a read that lost a race to a newer version does not write over it", async () => {
  const coros = fakeCoros([{ ...weeklyTemplate(), id: "open-v", version: 5 }]);
  await library.getNativeTrainingPlan("open-v");
  coros.plans.get("open-v").version = 4;
  coros.plans.get("open-v").name = "Stale";
  const stale = await library.getNativeTrainingPlan("open-v");
  assert.equal(stale.remoteVersion, 4, "the caller is still told what COROS answered");
  const cached = databaseModule.getCorosPlanCache("open-v");
  assert.equal(cached.remoteVersion, 5, "the cache keeps the newer copy");
  assert.notEqual(cached.name, "Stale");
});

test("a run taken off the calendar is stopped, not finished", () => {
  const run = { ...weeklyTemplate(), id: "ended", executeStatus: 2, sourcePlanId: template.id, startDay: 20270104, totalDay: 17 };
  const state = (endDay) => library.nativePlanToDocument(adapter.parseNativeCorosPlan({ ...run, endDay })).calendar;
  // The two endDays COROS wrote for one probed run, on and off.
  assert.equal(state(20270127), "finished", "as it went on the calendar: past its last day");
  assert.equal(state(20260925), "stopped", "taken off before it began");
  assert.equal(state(20270110), "stopped", "taken off part-way");
  assert.equal(state(20270120), "finished", "taken off on its last day is as good as ran out");
});

test("a library load writes a workout's row only when the workout is new or changed", async () => {
  /* The table syncs: a row rewritten on every load is a sync entry per workout each time the library opens. */
  stubCoros({
    "/training/program/query": ok([{ id: "lib-1", name: "Tempo", sportType: 1, estimatedTime: 1800, exerciseNum: 3, totalSets: 3 }]),
    "/training/plan/query": ok([]),
    "/training/schedule/query": ok({ entities: [], programs: [] }),
    "coros-traininghub-v2": ok({})
  });
  await library.getTrainingLibrarySnapshot();
  const first = databaseModule.listTrainingWorkoutMetadata().find((row) => row.programId === "lib-1");
  assert.ok(first?.lastSyncedAt, "a workout seen for the first time is written");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await library.getTrainingLibrarySnapshot();
  const second = databaseModule.listTrainingWorkoutMetadata().find((row) => row.programId === "lib-1");
  assert.equal(second.lastSyncedAt, first.lastSyncedAt, "and not written again while it has not changed");
});

test("taking a run off leaves it stopped in the library, sessions kept, template unlinked", async () => {
  /* Ids of its own: the cache outlives each fake, and an earlier test's 900 at a higher version would be kept over this one's. */
  const coros = fakeCoros([{ ...weeklyTemplate(), id: "stop-tpl" }], { firstId: 7000 });
  await library.putPlanOnCalendar("coros:stop-tpl", "20270111");
  const instance = [...coros.plans.values()].find((plan) => plan.sourcePlanId === "stop-tpl");
  // Opened while running, so the cache holds it in full at this version.
  await library.getNativeTrainingPlan(instance.id);
  await library.takePlanOffCalendar("coros:stop-tpl");
  assert.equal(coros.plans.get(instance.id).version, 0, "quitting moves no version");

  const snapshot = await library.getTrainingLibrarySnapshot();
  const run = snapshot.plans.find((plan) => plan.remoteId === instance.id);
  assert.equal(
    run.calendar,
    "stopped",
    "the cached copy kept at an equal version went on saying running, and before `stopped` a removal read as done"
  );
  assert.equal(run.entries.length, 4, "the sessions the list no longer carries come from the cache");
  const source = snapshot.plans.find((plan) => plan.remoteId === "stop-tpl");
  assert.equal(source.runningInstanceId, undefined, "and the template is no longer on the calendar");
  assert.equal((await library.getNativeTrainingPlan(instance.id)).calendar, "stopped", "read on its own too");

  assert.match(
    (await library.previewPlanOnCalendar(`coros:${instance.id}`, "20270118")).blockers.join(" "),
    /will not put it back/,
    "COROS refuses executeSubPlan on a stopped run (1031), so it is not offered"
  );
});

// --- a plan the coach wrote -------------------------------------------------

const coachRun = (name, seconds, extra = {}) => ({
  key: name.toLowerCase().replaceAll(" ", "-"),
  name,
  sport: "run",
  steps: [{ kind: "training", target_type: "time", target_duration_seconds: seconds, intensity: { type: "none" } }],
  ...extra
});

async function coachDraft(args) {
  let preview;
  const response = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool("draft_training_plan", args, {
      allowUpcomingWorkouts: false,
      onPlanDraft: (drafted) => {
        preview = drafted;
      }
    })
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  return preview;
}

// Monday 3 August 2099 and Sunday 16 August, two weeks apart.
const datedBlock = {
  name: "Coach block",
  description: "Two easy weeks.",
  week_stages: [
    { week: 1, stage: "base" },
    { week: 2, stage: "build" },
    { week: 3, stage: "not-a-stage" }
  ],
  workouts: [
    coachRun("Easy Monday", 1800, { schedule_date: "20990803" }),
    coachRun("Long Sunday", 5400, { schedule_date: "20990816" })
  ]
};

test("a coach plan is saved to COROS as one plan, with its overview and stages", async () => {
  const coros = fakeCoros();
  const preview = await coachDraft(datedBlock);
  const result = await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");
  const [add] = coros.to("/training/plan/add");
  assert.equal(add.body.name, "Coach block");
  assert.equal(add.body.overview, "Two easy weeks.", "the coach's description is the plan's overview");
  assert.deepEqual(
    add.body.weekStages.filter((stage) => stage.stage).map((stage) => [stage.weekNo, stage.stage]),
    [[1, 2], [2, 3]],
    "Base and Build on their weeks; a stage COROS does not have is dropped"
  );
  assert.deepEqual(
    add.body.entities.map((entity) => entity.dayNo),
    [0, 13],
    "the dates become days of the plan, counted from the first session's Monday"
  );
  assert.equal(result.destination, "nativePlan");
  assert.equal(result.planId, "coros:900", "the card can name the plan it became");
  assert.equal(databaseModule.getTrainingPlanMetadata("coros:900").origin, "coach");
  await assert.rejects(
    chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan"),
    /already uploaded/,
    "saved once"
  );
  const edit = await chatWorkoutTools.savePlanDraftEdit(preview.draftId, chatWorkoutTools.planDraftDocument(preview.draftId));
  assert.equal(edit.kind, "written", "a saved plan is edited into its next version (P1.6)");
  assert.ok(databaseModule.getChatPlanDraft(preview.draftId).uploadedAt, "and the saved one stays saved");
});

test("a coach plan on COROS is changed by a version that updates it (P1.6)", async () => {
  const coros = fakeCoros();
  const preview = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");

  // The saved version keeps the plan as COROS read it back, keyed as the coach keyed it.
  const saved = chatWorkoutTools.planDraftDocument(preview.draftId);
  assert.equal(saved.remoteId, "900");
  assert.deepEqual(saved.entries.map((entry) => entry.workout.key).sort(), ["easy-monday", "long-sunday"]);
  assert.ok(saved.entries.every((entry) => entry.idInPlan && entry.corosProgram), "each session's COROS identity");

  // Coach moves the long run and rewrites the easy one.
  const revised = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "revise_training_plan",
      {
        draft_id: preview.draftId,
        summary: "Long run to Saturday, easy run longer",
        ops: [
          { op: "move_session", key: "long-sunday", schedule_date: "20990815" },
          { op: "replace_session", key: "easy-monday", workout: coachRun("Easy Monday", 2400) }
        ]
      },
      { allowUpcomingWorkouts: false }
    )
  );
  assert.equal(revised.ok, true, JSON.stringify(revised));
  const next = chatWorkoutTools.planDraftDocument(revised.draft_id);
  assert.equal(next.remoteId, "900", "the new version is a change to that plan");
  const byKey = new Map(next.entries.map((entry) => [entry.workout.key, entry]));
  const savedByKey = new Map(saved.entries.map((entry) => [entry.workout.key, entry]));
  assert.equal(byKey.get("long-sunday").idInPlan, savedByKey.get("long-sunday").idInPlan);
  assert.deepEqual(byKey.get("long-sunday").corosProgram, savedByKey.get("long-sunday").corosProgram, "moved, not rewritten");
  assert.equal(byKey.get("easy-monday").idInPlan, savedByKey.get("easy-monday").idInPlan, "updated in place");
  assert.equal(byKey.get("easy-monday").corosProgram, undefined, "its workout is written afresh");

  const updated = await chatWorkoutTools.uploadPlanDraftById(revised.draft_id, "metric", "nativePlan");
  assert.equal(coros.to("/training/plan/add").length, 1, "no second plan");
  assert.equal(coros.to("/training/plan/update").length, 1, "the plan is updated");
  assert.equal(updated.planId, "coros:900");
  assert.deepEqual(updated.remoteWrites, ["Update plan Coach block"]);
  const [update] = coros.to("/training/plan/update");
  assert.deepEqual(
    update.body.entities.map((entity) => entity.dayNo).sort((a, b) => a - b),
    [0, 12],
    "Saturday of week 2 is day 12"
  );

  // Changed on COROS meanwhile: the next update is refused until the athlete says.
  const again = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "revise_training_plan",
      { draft_id: revised.draft_id, summary: "Rename", ops: [{ op: "rename", name: "Coach block, two" }] },
      { allowUpcomingWorkouts: false }
    )
  );
  assert.equal(again.ok, true, JSON.stringify(again));
  const elsewhere = await library.savePlanToCoros({
    plan: { ...chatWorkoutTools.planDraftDocument(revised.draft_id), name: "Renamed in the COROS app" },
    unitSystem: "metric"
  });
  assert.equal(elsewhere.ok, true);
  const refused = await chatWorkoutTools.uploadPlanDraftById(again.draft_id, "metric", "nativePlan");
  assert.ok(refused.conflict, "a conflict, not a write");
  assert.equal(coros.to("/training/plan/update").length, 2, "only the change made elsewhere was written");
  assert.equal(databaseModule.getChatPlanDraft(again.draft_id).uploadedAt, undefined, "and the version is not saved");

  const asNew = await chatWorkoutTools.uploadPlanDraftById(again.draft_id, "metric", "nativePlan", undefined, false, { asNew: true });
  assert.equal(asNew.planId, "coros:901", "saved as a plan of its own");
  assert.equal(coros.to("/training/plan/add").length, 2);

  // And a saved one-off workout is still not changed from the conversation.
  let workout;
  JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "draft_workout",
      { workout: coachRun("Shakeout", 900), calendar_date: "20990805" },
      { allowUpcomingWorkouts: false, onPlanDraft: (drafted) => { workout = drafted; } }
    )
  );
  databaseModule.markChatPlanDraftUploaded(workout.draftId, Date.now());
  const workoutRevision = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "revise_training_plan",
      { draft_id: workout.draftId, summary: "Longer", ops: [{ op: "replace_session", workout: coachRun("Shakeout", 1200) }] },
      { allowUpcomingWorkouts: false }
    )
  );
  assert.equal(workoutRevision.error_code, "draft_saved");
});

test("an update written over a change made on COROS replaces it (P1.6)", async () => {
  const coros = fakeCoros();
  const preview = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");
  const revised = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "revise_training_plan",
      { draft_id: preview.draftId, summary: "Rename", ops: [{ op: "rename", name: "Mine" }] },
      { allowUpcomingWorkouts: false }
    )
  );
  await library.savePlanToCoros({
    plan: { ...chatWorkoutTools.planDraftDocument(preview.draftId), name: "Theirs" },
    unitSystem: "metric"
  });
  const refused = await chatWorkoutTools.uploadPlanDraftById(revised.draft_id, "metric", "nativePlan");
  assert.ok(refused.conflict);
  const written = await chatWorkoutTools.uploadPlanDraftById(revised.draft_id, "metric", "nativePlan", undefined, false, { overwrite: true });
  assert.equal(written.conflict, undefined);
  assert.equal(written.planId, "coros:900");
  assert.equal(coros.to("/training/plan/update").at(-1).body.name, "Mine");
});

test("a change made on COROS comes back as the creation's newest version (P1.6, D12)", async () => {
  const coros = fakeCoros();
  const preview = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");

  // Nothing changed there: one read of the detail, and nothing written.
  const reads = coros.to("/training/plan/detail").length;
  assert.deepEqual(await chatWorkoutTools.syncPlanDraftFromCoros(preview.draftId), { kind: "current" });
  assert.equal(coros.to("/training/plan/detail").length, reads + 1, "one request when nothing changed");
  assert.deepEqual(
    await chatWorkoutTools.syncPlanDraftFromCoros(preview.draftId, "metric", { cacheOnly: true }),
    { kind: "current" }
  );
  assert.equal(coros.to("/training/plan/detail").length, reads + 1, "and none from the cache");

  // Renamed, and the long run moved, in the Library.
  const inLibrary = chatWorkoutTools.planDraftDocument(preview.draftId);
  const long = inLibrary.entries.find((entry) => entry.workout.key === "long-sunday");
  await library.savePlanToCoros({
    plan: {
      ...inLibrary,
      name: "Coach block, as I run it",
      entries: inLibrary.entries.map((entry) => (entry === long ? { ...entry, dayIndex: 5 } : entry))
    },
    unitSystem: "metric"
  });

  const synced = await chatWorkoutTools.syncPlanDraftFromCoros(preview.draftId, "metric", { cacheOnly: true });
  assert.equal(synced.kind, "imported", "the cache says COROS moved on");
  assert.deepEqual([synced.written.fromVersion, synced.written.toVersion], [1, 2]);
  assert.ok(synced.written.changes.includes('Renamed to "Coach block, as I run it"'), synced.written.changes.join(" | "));
  assert.ok(synced.written.changes.some((line) => /^Moved Long Sunday: week 2 Sun → week 2 Sat/.test(line)), synced.written.changes.join(" | "));
  const row = databaseModule.getChatPlanDraft(synced.written.preview.draftId);
  assert.equal(row.author, "coros");
  assert.equal(row.changeSummary, "Changed in the Library");
  const imported = chatWorkoutTools.planDraftDocument(synced.written.preview.draftId);
  assert.deepEqual(
    imported.entries.map((entry) => entry.workout.key).sort(),
    ["easy-monday", "long-sunday"],
    "sessions keep the coach's keys, so Coach can still name them"
  );
  assert.equal(imported.remoteVersion, 1, "and the version COROS is at now");
  assert.ok(row.uploadedAt, "it is what COROS holds, so it is saved there");
  assert.equal(synced.written.preview.uploadResult.planId, "coros:900", "and its card says which plan it is");
  // The imported version is what COROS holds, so it counts as saved there.
  assert.deepEqual(await chatWorkoutTools.syncPlanDraftFromCoros(preview.draftId), { kind: "current" });
});

test("Coach's change to a plan changed on COROS goes onto COROS's version (P1.6)", async () => {
  fakeCoros();
  const preview = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");
  await library.savePlanToCoros({
    plan: { ...chatWorkoutTools.planDraftDocument(preview.draftId), name: "Renamed on COROS" },
    unitSystem: "metric"
  });
  const cards = [];
  const events = [];
  const response = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "revise_training_plan",
      {
        draft_id: preview.draftId,
        summary: "Easy run longer",
        ops: [{ op: "replace_session", key: "easy-monday", workout: coachRun("Easy Monday", 2700) }]
      },
      {
        allowUpcomingWorkouts: false,
        onPlanDraft: (card) => cards.push(card),
        onPlanEvent: (event) => events.push(event)
      }
    )
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.version, 3, "on top of the version COROS had");
  assert.match(response.note, /changed on COROS/);
  assert.deepEqual(events.map((event) => [event.action, event.author, event.toVersion]), [["imported", "coros", 2]]);
  assert.equal(cards.length, 2, "COROS's version, then Coach's");
  assert.equal(chatWorkoutTools.planDraftDocument(response.draft_id).name, "Renamed on COROS", "the rename is kept");
});

test("a plan deleted on COROS leaves a proposal, saved again as a new plan (P1.6)", async () => {
  const coros = fakeCoros();
  const preview = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");
  await adapter.deleteNativeCorosPlan("900");
  const synced = await chatWorkoutTools.syncPlanDraftFromCoros(preview.draftId);
  assert.equal(synced.kind, "removedOnCoros");
  const detached = synced.written.preview.draftId;
  assert.equal(chatWorkoutTools.planDraftDocument(detached).remoteId, undefined, "no plan on COROS any more");
  const listed = chatWorkoutTools.planArtifacts([preview.draftId]);
  assert.equal(listed.at(-1).detached, true, "and the version list says so");
  const saved = await chatWorkoutTools.uploadPlanDraftById(detached, "metric", "nativePlan");
  assert.equal(saved.planId, "coros:901");
  assert.equal(coros.to("/training/plan/add").length, 2, "a plan of its own again");
  assert.equal(coros.to("/training/plan/update").length, 0);
});

test("a Coach plan goes on the calendar from the conversation, and the card knows it (P1.6)", async () => {
  fakeCoros();
  const preview = await coachDraft(datedBlock);

  // Before it is saved, the preview reads it through the chat.
  const before = await library.previewPlanOnCalendar(`chat:${preview.draftId}`, "20990803");
  assert.deepEqual(before.blockers, []);
  assert.deepEqual(
    before.entries.map((entry) => entry.happenDay),
    ["20990803", "20990816"],
    "each session on the day the coach dated it"
  );
  assert.deepEqual(chatWorkoutTools.planCalendarStates([preview.draftId]), [], "not on COROS, so nothing to say");

  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");
  const saved = chatWorkoutTools.planCalendarStates([preview.draftId]);
  assert.deepEqual(saved.map((state) => [state.remotePlanId, Boolean(state.running)]), [["coros:900", false]]);

  await library.putPlanOnCalendar("coros:900", "20990803");
  const [running] = chatWorkoutTools.planCalendarStates([preview.draftId]);
  assert.ok(running.running, "the running copy, from the plan cache");
  assert.equal(running.running.sourcePlanId, "900");
  assert.equal(running.running.calendar, "running");
  assert.ok(Array.isArray(running.matches));
});

test("restoring a version of a plan on COROS takes the newest version's ids, not its own", async () => {
  const coros = fakeCoros();
  const preview = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");
  const first = chatWorkoutTools.planDraftDocument(preview.draftId);
  const firstIds = new Map(first.entries.map((entry) => [entry.workout.key, entry.idInPlan]));

  // Version 2 drops the easy run, and COROS is updated to match.
  const dropped = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "revise_training_plan",
      { draft_id: preview.draftId, summary: "No easy run", ops: [{ op: "remove_session", key: "easy-monday" }] },
      { allowUpcomingWorkouts: false }
    )
  );
  assert.equal(dropped.ok, true, JSON.stringify(dropped));
  await chatWorkoutTools.uploadPlanDraftById(dropped.draft_id, "metric", "nativePlan");
  const second = chatWorkoutTools.planDraftDocument(dropped.draft_id);

  // Version 1 back, as version 3.
  const restored = chatWorkoutTools.restorePlanDraftVersion(preview.draftId, "metric");
  const third = chatWorkoutTools.planDraftDocument(restored.preview.draftId);
  const byKey = new Map(third.entries.map((entry) => [entry.workout.key, entry]));
  assert.equal(third.remoteId, "900", "still a change to that plan");
  assert.equal(third.remoteVersion, second.remoteVersion, "checked against the plan as it is now");
  assert.equal(byKey.get("easy-monday").idInPlan, undefined, "the easy run is gone from COROS, so it comes back as a new session");
  assert.notEqual(firstIds.get("easy-monday"), undefined, "(it had an id in version 1)");
  assert.equal(
    byKey.get("long-sunday").idInPlan,
    second.entries.find((entry) => entry.workout.key === "long-sunday").idInPlan,
    "the session that stayed keeps the id COROS has for it"
  );
  const updated = await chatWorkoutTools.uploadPlanDraftById(restored.preview.draftId, "metric", "nativePlan");
  assert.equal(updated.conflict, undefined, "and it updates the plan without a false conflict");
  assert.equal(coros.to("/training/plan/add").length, 1, "no second plan");
});

test("two reads against COROS begun together bring its change back once", async () => {
  fakeCoros();
  const preview = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan");
  const inLibrary = chatWorkoutTools.planDraftDocument(preview.draftId);
  await library.savePlanToCoros({ plan: { ...inLibrary, name: "Renamed in the Library" }, unitSystem: "metric" });
  // The canvas opening and an edit begun at the same moment.
  const [first, second] = await Promise.all([
    chatWorkoutTools.syncPlanDraftFromCoros(preview.draftId, "metric", { cacheOnly: true }),
    chatWorkoutTools.syncPlanDraftFromCoros(preview.draftId)
  ]);
  assert.equal(first.kind, "imported");
  assert.equal(second.kind, "imported");
  assert.equal(first.written.preview.draftId, second.written.preview.draftId, "one version, shared");
  const artifact = databaseModule.getChatPlanDraft(preview.draftId).artifactId ?? preview.draftId;
  assert.equal(databaseModule.listChatPlanDraftVersions(artifact).length, 2, "the saved one and COROS's change, nothing twice");
});

test("two saves of one creation begun together write one plan", async () => {
  const coros = fakeCoros();
  const preview = await coachDraft(datedBlock);
  const results = await Promise.allSettled([
    chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan"),
    chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan")
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /already being saved/);
  assert.equal(coros.to("/training/plan/add").length, 1);
});

test("a save made on another machine is seen here: the row, not a copy in memory, decides", async () => {
  fakeCoros();
  const preview = await coachDraft(datedBlock);
  chatWorkoutTools.planDraftDocument(preview.draftId); // read once, as the card does
  // The other machine saved it; the pull marks the row.
  databaseModule.markChatPlanDraftUploaded(preview.draftId, Date.now());
  await assert.rejects(
    chatWorkoutTools.uploadPlanDraftById(preview.draftId, "metric", "nativePlan"),
    /already uploaded/,
    "not saved a second time"
  );
});

test("an edit in Coach is the plan's next version, dated from the coach's Monday", async () => {
  fakeCoros();
  const preview = await coachDraft(datedBlock);
  const opened = chatWorkoutTools.planDraftDocument(preview.draftId);
  assert.equal(opened.origin, "coach");
  assert.equal(opened.description, "Two easy weeks.");
  assert.deepEqual(opened.weekStages, [{ weekIndex: 0, stage: 2 }, { weekIndex: 1, stage: 3 }]);
  assert.deepEqual(opened.entries.map((entry) => [entry.weekIndex, entry.dayIndex]), [[0, 0], [1, 6]]);

  // Easy moves to Wednesday, Long is renamed, and a third session arrives on week 2's Tuesday.
  const edited = structuredClone(opened);
  edited.entries[0].dayIndex = 2;
  edited.entries[1].title = "Longer Sunday";
  edited.entries.push({ ...structuredClone(edited.entries[0]), id: "added", weekIndex: 1, dayIndex: 1, sortOrder: 9 });
  const written = await chatWorkoutTools.savePlanDraftEdit(preview.draftId, edited);
  assert.equal(written.kind, "written");
  assert.deepEqual([written.fromVersion, written.toVersion], [1, 2]);
  const next = written.preview;
  assert.notEqual(next.draftId, preview.draftId, "a version of its own, beside the coach's");
  assert.ok(next.editedAt, "marked edited, which is what the card and Coach's index read");
  assert.ok(written.changes.includes("Easy Monday is now Longer Sunday") || written.changes.some((line) => /Longer Sunday/.test(line)), written.changes.join(" | "));
  assert.deepEqual(
    next.entries.map((entry) => [entry.name, entry.scheduleDate]),
    [
      ["Easy Monday", "2099-08-05"],
      ["Easy Monday", "2099-08-11"],
      ["Longer Sunday", "2099-08-16"]
    ],
    "dated from the Monday the coach started on, at the day the athlete left each session"
  );
  assert.equal(new Set(next.entries.map((entry) => entry.key)).size, 3, "a copied session gets a key of its own");

  const reopened = chatWorkoutTools.planDraftDocument(next.draftId);
  assert.deepEqual(
    reopened.entries.map((entry) => [entry.title, entry.weekIndex, entry.dayIndex]),
    [["Easy Monday", 0, 2], ["Easy Monday", 1, 1], ["Longer Sunday", 1, 6]],
    "opening it again shows the edit"
  );
  assert.deepEqual(
    chatWorkoutTools.planDraftDocument(preview.draftId).entries.map((entry) => [entry.weekIndex, entry.dayIndex]),
    [[0, 0], [1, 6]],
    "and the coach's version is still the coach's"
  );
});

test("an undated coach plan keeps the weeks and days the athlete gave it", async () => {
  fakeCoros();
  const preview = await coachDraft({
    name: "Undated",
    workouts: [coachRun("One", 1200), coachRun("Two", 1200), coachRun("Three", 1200)]
  });
  const opened = chatWorkoutTools.planDraftDocument(preview.draftId);
  assert.deepEqual(opened.entries.map((entry) => entry.dayIndex), [0, 1, 2], "a list, one a day");
  const edited = structuredClone(opened);
  edited.entries[2].weekIndex = 1;
  edited.entries[2].dayIndex = 5;
  const next = (await chatWorkoutTools.savePlanDraftEdit(preview.draftId, edited)).preview;
  assert.ok(next.entries.every((entry) => !entry.scheduleDate), "no date is invented");
  assert.deepEqual(
    chatWorkoutTools.planDraftDocument(next.draftId).entries.map((entry) => [entry.weekIndex, entry.dayIndex]),
    [[0, 0], [0, 1], [1, 5]],
    "and the arrangement survives, where the list would have put Three back on Wednesday"
  );
});

test("a coach's one-off workout is edited as its next version, keeping the day it was suggested for", async () => {
  fakeCoros();
  let preview;
  const response = JSON.parse(
    await chatWorkoutTools.handleChatWorkoutTool(
      "draft_workout",
      { workout: coachRun("Recovery run", 2100), calendar_date: "20990805" },
      { allowUpcomingWorkouts: false, onPlanDraft: (drafted) => { preview = drafted; } }
    )
  );
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(preview.artifactType, "workout");

  const edited = {
    ...coachRun("Shorter recovery", 1500),
    key: "renamed-by-the-builder",
    schedule_date: "20991231",
    save_to_library: true
  };
  const next = chatWorkoutTools.saveWorkoutDraftEdit(preview.draftId, edited).preview;
  assert.notEqual(next.draftId, preview.draftId, "the next version");
  assert.equal(next.artifactType, "workout");
  assert.ok(next.editedAt, "marked edited, so the coach is told");
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0].name, "Shorter recovery");
  assert.equal(next.entries[0].key, preview.entries[0].key, "the coach's key, not the builder's");
  assert.equal(next.entries[0].scheduleDate, "2099-08-05", "the day the coach suggested, not one the builder carried");
  assert.equal("source" in next.entries[0], false, "the card is light; the steps are in the draft");
  assert.equal(
    chatWorkoutTools.planDraftDocument(next.draftId).entries[0].workout.steps[0].target_duration_seconds,
    1500
  );
  assert.equal(next.name, "Shorter recovery");

  assert.throws(
    () => chatWorkoutTools.saveWorkoutDraftEdit("not-a-draft", edited),
    /not found/
  );
  const plan = await coachDraft(datedBlock);
  assert.throws(
    () => chatWorkoutTools.saveWorkoutDraftEdit(plan.draftId, edited),
    /a plan, not a single workout/,
    "a plan is edited in the plan editor"
  );
});

test("a programme is placed by week and day, and the draft's answer is short", async () => {
  fakeCoros();
  assert.equal(
    chatWorkoutTools.CHAT_WORKOUT_TOOL_NAMES.includes("upload_training_plan"),
    false,
    "the tool that never wrote anything is gone"
  );
  const draftTool = (args) =>
    chatWorkoutTools.handleChatWorkoutTool("draft_training_plan", args, { allowUpcomingWorkouts: false });

  const answer = JSON.parse(
    await draftTool({
      name: "Programme",
      workouts: [
        coachRun("Tue easy", 2400, { week: 1, day: "tue" }),
        coachRun("Sat long", 4800, { week: 1, day: "sat" }),
        coachRun("Wed tempo", 3000, { week: 2, day: "wed" })
      ]
    })
  );
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.ok(
    answer.preview.entries.every((entry) => entry.source === undefined),
    "the steps the model just wrote are not echoed back to it"
  );
  assert.match(answer.message, /do not list every session/);
  assert.match(answer.preview.summary, /^2 weeks · 1–2 sessions a week · Run$/);
  assert.deepEqual(
    chatWorkoutTools.planDraftDocument(answer.draft_id).entries.map((entry) => [entry.title, entry.weekIndex, entry.dayIndex]),
    [["Tue easy", 0, 1], ["Sat long", 0, 5], ["Wed tempo", 1, 2]],
    "each session sits on its week and day, where a list used to go one a day"
  );

  const mixed = JSON.parse(
    await draftTool({
      name: "Mixed",
      workouts: [
        coachRun("Dated", 1800, { schedule_date: "20990803" }),
        coachRun("Placed", 1800, { week: 1, day: "wed" })
      ]
    })
  );
  assert.equal(mixed.ok, false, "dates and weeks in one plan have no single reading");
  assert.match(mixed.errors.join(" "), /not a mix/);

  const half = JSON.parse(
    await draftTool({ name: "Half", workouts: [coachRun("Only a week", 1800, { week: 2 })] })
  );
  assert.equal(half.ok, false);
  assert.match(half.errors.join(" "), /needs both week/);
});

test("removing an unsaved creation lets its draft go; a saved one is only hidden", async () => {
  fakeCoros();
  const unsaved = await coachDraft(datedBlock);
  chatWorkoutTools.discardPlanDraft(unsaved.draftId);
  assert.throws(() => chatWorkoutTools.planDraftDocument(unsaved.draftId), /not found/, "the draft is gone");
  chatWorkoutTools.discardPlanDraft(unsaved.draftId);

  const saved = await coachDraft(datedBlock);
  await chatWorkoutTools.uploadPlanDraftById(saved.draftId, "metric", "nativePlan");
  assert.throws(
    () => chatWorkoutTools.discardPlanDraft(saved.draftId),
    /hidden, not removed/,
    "the plan on COROS names this draft"
  );
  assert.ok(chatWorkoutTools.planDraftDocument(saved.draftId), "and it stays");
});

test("deleting a conversation's drafts lets them go", async () => {
  fakeCoros();
  const preview = await coachDraft(datedBlock);
  chatWorkoutTools.deletePlanDraftsOf([preview.draftId]);
  assert.throws(() => chatWorkoutTools.planDraftDocument(preview.draftId), /not found/);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error?.stack ?? error}`);
  }
}
if (failed) {
  console.error(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);
