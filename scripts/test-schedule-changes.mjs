// Coach's proposals to the calendar and the workout library (P3.2–P3.3 of
// docs/coach-plan-canvas.md), against a fake COROS that keeps a calendar and
// a library and answers the way the live API was measured to (P3.0).
//
// What is held down:
//
//   * A proposal is a row: it outlives the process that staged it, and the
//     transcript holds only an anchor.
//   * Every line reads COROS again before it writes, and one whose session is
//     gone or changed goes stale rather than acting on something else.
//   * A line already applied is never written again — pressed twice, applied
//     from two cards, or applied after the other machine did.
//   * Each line is written and recorded on its own, so a set stopped part-way
//     keeps what it did.
//   * A conversation's proposals go with it.
//
// Usage:
//   npm run test:schedule-changes
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

const databaseModule = await import(distUrl("database.js"));
const moves = await import(distUrl("scheduleMoves.js"));
const changes = await import(distUrl("chatScheduleChanges.js"));
const workoutTools = await import(distUrl("chatWorkoutTools.js"));
const history = await import(distUrl("chatHistoryStore.js"));

databaseModule.initializeDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "schedule-changes-")));
databaseModule.setSetting("trainingHub.accessToken", "token-1");
databaseModule.setSetting("trainingHub.userId", "100000000000000001");
databaseModule.setSetting("trainingHub.regionId", "1");
databaseModule.setSetting("trainingHub.baseUrl", "https://teamapi.coros.com");

const cases = [];
const test = (name, run) => cases.push([name, run]);

// --- a fake COROS -----------------------------------------------------------

const OWN_SCHEDULE = "478751716869849089";

/**
 * The calendar as `schedule/query` answers it: entities and the programs they
 * point at, the athlete's own sessions under `OWN_SCHEDULE`. Status 3 on
 * `schedule/update` takes a session away; status 1 adds one to the athlete's
 * own schedule under the next id. Every write is recorded.
 */
function fakeCoros() {
  /* A new COROS starts with nothing of the last one cached. */
  databaseModule.replaceCorosPlanCache([]);
  const state = {
    entities: [],
    programs: [],
    library: [],
    /** Running copies of plans, as `plan/detail` answers them. */
    plans: new Map(),
    maxIdInPlan: 10,
    writes: [],
    requests: [],
    failNextWrite: undefined
  };
  /** A running copy's sessions as the calendar shows them: dated from its start day's Monday. */
  const copySessions = () =>
    [...state.plans.values()]
      .filter((plan) => plan.executeStatus === 1)
      .flatMap((plan) =>
        plan.entities.map((entity) => {
          const program = plan.programs.find((candidate) => String(candidate.idInPlan) === String(entity.idInPlan));
          return {
            entity: { planId: plan.id, idInPlan: String(entity.idInPlan), planProgramId: String(entity.idInPlan), happenDay: dayOf(plan.startDay, entity.dayNo), sortNoInSchedule: 1 },
            program: { ...program, planId: plan.id, idInPlan: String(entity.idInPlan) }
          };
        })
      );
  const ok = (data) => ({ apiCode: "A1", ...(data === undefined ? {} : { data }), message: "OK", result: "0000" });
  const refuse = (code, message) => ({ apiCode: "A1", message, result: code });

  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    state.requests.push(`${init.method ?? "GET"} ${target.pathname}`);
    const answer = (() => {
      const failing = () => {
        if (!state.failNextWrite) return undefined;
        const failure = state.failNextWrite;
        state.failNextWrite = undefined;
        return refuse(failure.code, failure.message);
      };
      switch (target.pathname) {
        case "/training/schedule/query": {
          const from = target.searchParams.get("startDate");
          const to = target.searchParams.get("endDate");
          const copies = copySessions().filter(({ entity }) => entity.happenDay >= from && entity.happenDay <= to);
          const entities = state.entities.filter((entity) => entity.happenDay >= from && entity.happenDay <= to);
          return ok({
            entities: [...entities, ...copies.map(({ entity }) => entity)],
            programs: [
              ...state.programs.filter((program) =>
                entities.some((entity) => entity.planId === program.planId && String(entity.idInPlan) === String(program.idInPlan))
              ),
              ...copies.map(({ program }) => program)
            ],
            maxIdInPlan: state.maxIdInPlan
          });
        }
        case "/training/schedule/update": {
          state.writes.push({ path: target.pathname, body });
          const refused = failing();
          if (refused) return refused;
          for (const version of body.versionObjects ?? []) {
            if (version.status === 3) {
              state.entities = state.entities.filter(
                (entity) => !(entity.planId === version.planId && String(entity.idInPlan) === String(version.id))
              );
              /* COROS takes it out of a running copy too (P3.0 A). */
              const copy = state.plans.get(String(version.planId));
              if (copy) copy.entities = copy.entities.filter((entity) => String(entity.idInPlan) !== String(version.id));
            }
            if (version.status === 1) {
              const entity = body.entities.find((candidate) => String(candidate.idInPlan) === String(version.id));
              const program = body.programs.find((candidate) => String(candidate.idInPlan) === String(version.id));
              state.entities.push({ planId: OWN_SCHEDULE, idInPlan: String(entity.idInPlan), planProgramId: String(entity.idInPlan), happenDay: entity.happenDay, sortNoInSchedule: 1 });
              state.programs.push({ ...program, planId: OWN_SCHEDULE, idInPlan: String(entity.idInPlan) });
              state.maxIdInPlan = Math.max(state.maxIdInPlan, Number(entity.idInPlan));
            }
          }
          return ok();
        }
        case "/training/plan/query":
          return ok([...state.plans.values()]);
        case "/training/plan/detail":
          return ok(structuredClone(state.plans.get(target.searchParams.get("id"))));
        case "/training/plan/update": {
          state.writes.push({ path: target.pathname, body });
          const refused = failing();
          if (refused) return refused;
          const previous = state.plans.get(String(body.id));
          state.plans.set(String(body.id), {
            ...previous,
            entities: body.entities.map((entity) => ({ idInPlan: String(entity.idInPlan), dayNo: entity.dayNo })),
            programs: body.programs.map((program) => ({ ...program, idInPlan: String(program.idInPlan) })),
            maxIdInPlan: body.maxIdInPlan,
            version: previous.version + 1
          });
          return ok();
        }
        case "/training/program/calculate":
          return ok({ planDuration: 1800, planDistance: 500000, planTrainingLoad: 40, planSets: 1, exerciseBarChart: [] });
        case "/account/query":
          return ok({});
        case "/training/program/query":
          return ok(state.library);
        case "/training/program/delete":
          state.writes.push({ path: target.pathname, body });
          state.library = state.library.filter((program) => !body.includes(program.id));
          return ok();
        default:
          throw new Error(`unexpected COROS request: ${init.method ?? "GET"} ${target.pathname}`);
      }
    })();
    return { ok: true, status: 200, statusText: "OK", json: async () => answer, text: async () => JSON.stringify(answer) };
  };

  return {
    state,
    /** A session on the calendar, under a plan's running copy or the athlete's own schedule. */
    put({ planId = OWN_SCHEDULE, idInPlan, happenDay, name, sportType = 1 }) {
      state.entities.push({ planId, idInPlan: String(idInPlan), planProgramId: String(idInPlan), happenDay, sortNoInSchedule: 1 });
      state.programs.push({ planId, idInPlan: String(idInPlan), id: `p-${planId}-${idInPlan}`, name, sportType, pbVersion: 2 });
    },
    rename(idInPlan, name) {
      const program = state.programs.find((candidate) => String(candidate.idInPlan) === String(idInPlan));
      program.name = name;
    },
    /** A plan running on the calendar from `startDay`, its sessions `[idInPlan, dayNo, name]`. */
    runningCopy(id, startDay, sessions, name = "Base block") {
      state.plans.set(id, {
        id,
        name,
        overview: "",
        status: 1,
        executeStatus: 1,
        sourcePlanId: `template-of-${id}`,
        startDay,
        version: 1,
        maxIdInPlan: Math.max(...sessions.map(([idInPlan]) => Number(idInPlan))),
        entities: sessions.map(([idInPlan, dayNo]) => ({ idInPlan: String(idInPlan), dayNo })),
        programs: sessions.map(([idInPlan, , programName]) => ({ idInPlan: String(idInPlan), name: programName, sportType: 1, pbVersion: 2, exercises: [] })),
        weekStages: []
      });
    },
    copy: (id) => state.plans.get(id),
    library(id, name) {
      state.library.push({ id, name, sportType: 1, exerciseNum: 1, totalSets: 1, estimatedTime: 1800 });
    },
    writesTo: (pathname) => state.writes.filter((write) => write.path === pathname),
    removals: () => state.writes.filter((write) => write.path === "/training/schedule/update" && write.body.versionObjects?.some((v) => v.status === 3)),
    deletions: () => state.writes.filter((write) => write.path === "/training/program/delete")
  };
}

const keyOf = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
const daysFromNow = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return keyOf(date);
};
const tomorrow = daysFromNow(1);
/** The day `dayNo` lands on for a plan started on `startDay`: counted from that week's Monday. */
function dayOf(startDay, dayNo) {
  const date = new Date(Number(startDay.slice(0, 4)), Number(startDay.slice(4, 6)) - 1, Number(startDay.slice(6, 8)), 12);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + dayNo);
  return keyOf(date);
}
/** The Monday of a week at least a week out, so every day of it is ahead. */
const planMonday = (() => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + 7 - ((date.getDay() + 6) % 7));
  return keyOf(date);
})();
const dashed = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;

async function stageDelete(args, sessionId = "conv-1") {
  let staged;
  const result = JSON.parse(
    await workoutTools.handleChatWorkoutTool("delete_workout", args, {
      sessionId,
      onScheduleChange: (set) => {
        staged = set;
      }
    })
  );
  return { result, staged };
}

// --- P3.2: a deletion is a change set ------------------------------------------

test("delete_workout stages a change set, kept as a row, and writes nothing", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 11, happenDay: tomorrow, name: "Easy 40" });
  const { result, staged } = await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Easy 40" });
  assert.equal(result.ok, true);
  assert.equal(result.change_set_id, staged.changeSetId);
  assert.deepEqual(result.lines, [`Remove "Easy 40" from the calendar on ${dashed(tomorrow)}`]);
  assert.match(result.message, /Nothing is deleted until they apply it/);
  assert.equal(coros.removals().length, 0, "staging writes nothing to COROS");
  const [stored] = changes.readScheduleChanges([staged.changeSetId]);
  assert.equal(stored.sessionId, "conv-1");
  assert.equal(stored.lines[0].status, "proposed");
  assert.deepEqual(stored.lines[0].session, {
    planId: OWN_SCHEDULE,
    idInPlan: "11",
    happenDay: tomorrow,
    name: "Easy 40",
    planProgramId: "11",
    programId: `p-${OWN_SCHEDULE}-11`,
    sportType: 1
  });
});

test("applying a line removes the session, once, however often it is pressed", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 12, happenDay: tomorrow, name: "Tempo" });
  const { staged } = await stageDelete({ target: "scheduled", plan_id: OWN_SCHEDULE, id_in_plan: "12" });
  const [first, second] = await Promise.allSettled([
    changes.applyScheduleChange(staged.changeSetId, "l1"),
    changes.applyScheduleChange(staged.changeSetId, "l1")
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected", "a second press while the first runs is refused");
  assert.match(second.reason.message, /already being applied/);
  assert.equal(first.value.lines[0].status, "applied");
  assert.ok(first.value.lines[0].settledAt);
  const again = await changes.applyScheduleChange(staged.changeSetId, "l1");
  assert.equal(again.lines[0].status, "applied");
  assert.equal(coros.removals().length, 1, "COROS is written to exactly once");
  assert.equal(coros.state.entities.length, 0);
});

test("a proposal applied after a restart still works: it is read from its row", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 13, happenDay: tomorrow, name: "Long run" });
  const { staged } = await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Long run" });
  // A fresh copy of the module is what a restarted process has: nothing in memory.
  const restarted = await import(`${distUrl("chatScheduleChanges.js")}-restart`);
  const set = await restarted.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "applied");
  assert.equal(coros.removals().length, 1);
});

test("a session gone or changed since the proposal is out of date, and nothing is written", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 14, happenDay: tomorrow, name: "Hills" });
  coros.put({ idInPlan: 15, happenDay: tomorrow, name: "Strides" });
  const gone = (await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Hills" })).staged;
  const renamed = (await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Strides" })).staged;
  coros.state.entities = coros.state.entities.filter((entity) => entity.idInPlan !== "14");
  coros.rename(15, "Strides and drills");
  const goneSet = await changes.applyScheduleChange(gone.changeSetId);
  const renamedSet = await changes.applyScheduleChange(renamed.changeSetId);
  assert.equal(goneSet.lines[0].status, "stale");
  assert.match(goneSet.lines[0].reason, /no longer on the calendar/);
  assert.equal(renamedSet.lines[0].status, "stale");
  assert.match(renamedSet.lines[0].reason, /is now "Strides and drills"/);
  assert.equal(coros.removals().length, 0, "nothing is removed that Coach did not see");
});

test("a refusal fails the line and says why; it is tried again only when named", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 16, happenDay: tomorrow, name: "Intervals" });
  const { staged } = await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Intervals" });
  coros.state.failNextWrite = { code: "17004", message: "Plan data is illegal." };
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "failed");
  assert.match(set.lines[0].reason, /Plan data is illegal/);
  assert.equal(set.lines[0].retry, undefined, "nothing of it landed, so it may be tried again");
  await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(coros.removals().length, 1, "Apply all leaves a failed line alone");
  const retried = await changes.applyScheduleChange(staged.changeSetId, "l1");
  assert.equal(retried.lines[0].status, "applied");
  assert.equal(retried.lines[0].reason, undefined, "the old reason goes with the failure");
  assert.equal(coros.removals().length, 2);
});

test("a replacement that landed half-way is never tried again", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 51, happenDay: tomorrow, name: "Tempo" });
  const { staged } = await propose([
    { op: "replace", session: { plan_id: OWN_SCHEDULE, id_in_plan: "51", date: tomorrow }, workout: easyRun() }
  ]);
  // The add goes through; the removal after it is refused.
  let writes = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/training/schedule/update") && ++writes === 2) {
      coros.state.failNextWrite = { code: "5000", message: "Busy." };
    }
    return realFetch(url, init);
  };
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "failed");
  assert.match(set.lines[0].reason, /The new workout was added, but the old one could not be removed/);
  assert.equal(set.lines[0].retry, false);
  const again = await changes.applyScheduleChange(staged.changeSetId, "l1");
  assert.equal(again.lines[0].status, "failed");
  assert.equal(coros.state.entities.length, 2, "the day holds both, and no third");
});

test("calendar and library: two lines, each applied and recorded on its own", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 17, happenDay: tomorrow, name: "Threshold" });
  coros.library("lib-1", "Threshold");
  const { result, staged } = await stageDelete({ target: "both", schedule_date: tomorrow, workout_name: "Threshold" });
  assert.deepEqual(result.lines, [
    `Remove "Threshold" from the calendar on ${dashed(tomorrow)}`,
    `Delete "Threshold" from the workout library`
  ]);
  assert.deepEqual(staged.lines[1].program, { id: "lib-1", name: "Threshold" });
  // The library copy is gone before the athlete applies: that line alone goes stale.
  coros.state.library = [];
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.deepEqual(set.lines.map((line) => line.status), ["applied", "stale"]);
  assert.equal(coros.deletions().length, 0);
});

test("a library deletion that finds its workout deletes it", async () => {
  const coros = fakeCoros();
  coros.library("lib-2", "Recovery jog");
  const { staged } = await stageDelete({ target: "library", workout_name: "recovery JOG" });
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "applied");
  assert.deepEqual(coros.deletions()[0].body, ["lib-2"]);
});

test("a deletion that names nothing on COROS is refused to the model, and no set is kept", async () => {
  fakeCoros();
  const { result, staged } = await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Nothing" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/);
  assert.equal(staged, undefined);
});

test("dismissing leaves COROS alone and a settled line as it settled", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 18, happenDay: tomorrow, name: "Fartlek" });
  coros.library("lib-3", "Fartlek");
  const { staged } = await stageDelete({ target: "both", schedule_date: tomorrow, workout_name: "Fartlek" });
  await changes.applyScheduleChange(staged.changeSetId, "l1");
  const set = changes.dismissScheduleChange(staged.changeSetId);
  assert.deepEqual(set.lines.map((line) => line.status), ["applied", "dismissed"]);
  const after = await changes.applyScheduleChange(staged.changeSetId);
  assert.deepEqual(after.lines.map((line) => line.status), ["applied", "dismissed"]);
  assert.equal(coros.deletions().length, 0);
});

test("a line this build cannot read is kept through a save, and left alone", async () => {
  fakeCoros();
  const set = changes.createScheduleChangeSet({
    sessionId: "conv-9",
    summary: "From a newer build",
    lines: [{ op: "remove", label: "Remove X", session: { planId: OWN_SCHEDULE, idInPlan: "99", happenDay: tomorrow, name: "X" } }]
  });
  const record = databaseModule.getChatScheduleChanges([set.changeSetId])[0];
  const lines = JSON.parse(record.linesJson);
  lines.push({ lineId: "l2", op: "swap", label: "A newer op", status: "proposed", extra: 1 });
  databaseModule.saveChatScheduleChange({ ...record, linesJson: JSON.stringify(lines) });
  const dismissed = changes.dismissScheduleChange(set.changeSetId, "l1");
  const kept = JSON.parse(databaseModule.getChatScheduleChanges([set.changeSetId])[0].linesJson);
  assert.equal(dismissed.lines.length, 2);
  assert.deepEqual(kept[1], { lineId: "l2", op: "swap", label: "A newer op", status: "proposed", extra: 1 });
  const applied = await changes.applyScheduleChange(set.changeSetId);
  assert.equal(applied.lines[1].status, "proposed", "an op this build does not know is not applied here");
});

test("the transcript keeps an anchor, and the conversation takes its proposals with it", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 19, happenDay: tomorrow, name: "Easy 30" });
  const session = history.createChatSession("claude-api");
  const { staged } = await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Easy 30" }, session.id);
  history.saveChatSession(session.id, [
    { kind: "message", role: "user", content: "Remove tomorrow's run" },
    { kind: "scheduleChange", changeSetId: staged.changeSetId }
  ]);
  const entries = history.getChatSession(session.id);
  assert.deepEqual(
    entries.map(({ mid: _mid, mrev: _mrev, ...entry }) => entry)[1],
    { kind: "scheduleChange", changeSetId: staged.changeSetId }
  );
  const service = await import(distUrl("chatService.js"));
  service.deleteChatSessionById(session.id);
  assert.deepEqual(changes.readScheduleChanges([staged.changeSetId]), []);
  await assert.rejects(changes.applyScheduleChange(staged.changeSetId), /This proposal is gone/);
});


// --- P3.3: moves, replacements and additions -------------------------------------

async function propose(changesArg, summary = "Rearrange the week") {
  let staged;
  const result = JSON.parse(
    await workoutTools.handleChatWorkoutTool("propose_schedule_changes", { summary, changes: changesArg }, {
      sessionId: "conv-3",
      onScheduleChange: (set) => {
        staged = set;
      }
    })
  );
  return { result, staged };
}

const easyRun = (name = "Easy 45") => ({
  name,
  sport: "run",
  steps: [{ kind: "training", name, target_type: "time", target_duration_seconds: 2700, intensity: { type: "none" } }]
});

test("a proposal is checked in the turn: every problem at once, and nothing kept", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 21, happenDay: tomorrow, name: "Tempo" });
  const { result, staged } = await propose([
    { op: "move", session: { plan_id: OWN_SCHEDULE, id_in_plan: "99", date: tomorrow }, to_date: daysFromNow(2) },
    { op: "move", session: { plan_id: OWN_SCHEDULE, id_in_plan: "21", date: tomorrow }, to_date: daysFromNow(-1) },
    { op: "move", session: { plan_id: OWN_SCHEDULE, id_in_plan: "21", date: tomorrow }, to_date: tomorrow },
    { op: "replace", session: { plan_id: OWN_SCHEDULE, id_in_plan: "21", date: tomorrow } },
    { op: "add", to_date: daysFromNow(3), workout: { name: "Broken", sport: "run", steps: [] } },
    { op: "shift" }
  ]);
  assert.equal(result.ok, false);
  assert.equal(staged, undefined);
  assert.match(result.errors[0], /^changes\[0\]: no session #99/);
  assert.match(result.errors[1], /^changes\[1\]: \d{8} has passed/);
  assert.match(result.errors[2], /^changes\[2\]: "Tempo" is already on/);
  assert.match(result.errors[3], /^changes\[3\]: workout is required/);
  assert.ok(result.errors.some((error) => error.startsWith("changes[4]: ")), "a workout COROS would refuse is refused here");
  assert.match(result.errors.at(-1), /^changes\[5\]: op must be/);
  assert.match(result.action, /call propose_schedule_changes again/);
  assert.equal(coros.state.writes.length, 0);
});

test("one change per session", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 22, happenDay: tomorrow, name: "Hills" });
  const session = { plan_id: OWN_SCHEDULE, id_in_plan: "22", date: tomorrow };
  const { result } = await propose([
    { op: "move", session, to_date: daysFromNow(2) },
    { op: "remove", session }
  ]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /already changed by another line/);
});

test("a proposal names every line as the card reads it, and writes nothing", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 23, happenDay: tomorrow, name: "Long run" });
  coros.put({ idInPlan: 24, happenDay: tomorrow, name: "Strides" });
  coros.put({ idInPlan: 25, happenDay: daysFromNow(2), name: "Intervals" });
  const { result, staged } = await propose([
    { op: "move", session: { plan_id: OWN_SCHEDULE, id_in_plan: "23", date: tomorrow }, to_date: daysFromNow(3) },
    { op: "replace", session: { plan_id: OWN_SCHEDULE, id_in_plan: "25", date: daysFromNow(2) }, workout: easyRun() },
    { op: "remove", session: { plan_id: OWN_SCHEDULE, id_in_plan: "24", date: tomorrow } },
    { op: "add", to_date: daysFromNow(4), workout: easyRun("Shakeout") }
  ], "I'm ill this week");
  assert.equal(result.ok, true);
  assert.equal(staged.summary, "I'm ill this week");
  assert.equal(result.lines.length, 4);
  assert.match(result.lines[0], /^Move "Long run" from \w{3} \d{1,2} \w{3} to \w{3} \d{1,2} \w{3}$/);
  assert.match(result.lines[1], /^Replace "Intervals" on .+ with "Easy 45"$/);
  assert.match(result.lines[2], /^Remove "Strides" from /);
  assert.match(result.lines[3], /^Add "Shakeout" on /);
  assert.equal(staged.lines[1].workout.name, "Easy 45");
  assert.equal(staged.lines[3].toDay, daysFromNow(4));
  assert.match(result.message, /Nothing has changed on the calendar yet/);
  assert.equal(coros.state.writes.length, 0);
});

test("apply all: each line its own write, a refusal costing that line only", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 26, happenDay: tomorrow, name: "Long run" });
  coros.put({ idInPlan: 27, happenDay: tomorrow, name: "Strides" });
  const { staged } = await propose([
    { op: "move", session: { plan_id: OWN_SCHEDULE, id_in_plan: "26", date: tomorrow }, to_date: daysFromNow(3) },
    { op: "remove", session: { plan_id: OWN_SCHEDULE, id_in_plan: "27", date: tomorrow } },
    { op: "add", to_date: daysFromNow(4), workout: easyRun("Shakeout") }
  ]);
  // The move is two writes (add, then remove); the removal's is the third.
  let writes = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/training/schedule/update") && ++writes === 3) {
      coros.state.failNextWrite = { code: "17004", message: "Plan data is illegal." };
    }
    return realFetch(url, init);
  };
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.deepEqual(set.lines.map((line) => line.status), ["applied", "failed", "applied"]);
  assert.match(set.lines[1].reason, /Plan data is illegal/);
  const onDay = (day) => coros.state.entities.filter((entity) => entity.happenDay === day).map((entity) => coros.state.programs.find((program) => program.idInPlan === entity.idInPlan && program.planId === entity.planId).name);
  assert.deepEqual(onDay(daysFromNow(3)), ["Long run"], "the athlete's own session moved by add-then-remove");
  assert.deepEqual(onDay(tomorrow), ["Strides"], "the refused removal left its session where it was");
  assert.deepEqual(onDay(daysFromNow(4)), ["Shakeout"]);
  const again = await changes.applyScheduleChange(staged.changeSetId);
  assert.deepEqual(again.lines.map((line) => line.status), ["applied", "failed", "applied"], "applied twice, written once");
});

test("a plan's session is moved through its running copy and stays in its plan (P3.0 C, D)", async () => {
  const coros = fakeCoros();
  coros.runningCopy("R1", planMonday, [["1", 0, "Easy"], ["2", 3, "Tempo"], ["3", 5, "Long run"]]);
  const saturday = dayOf(planMonday, 5);
  const sunday = dayOf(planMonday, 6);
  const { staged } = await propose([{ op: "move", session: { plan_id: "R1", id_in_plan: "3", date: saturday }, to_date: sunday }]);
  assert.match(staged.lines[0].label, /^Move "Long run" from Sat/);
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "applied");
  assert.equal(coros.writesTo("/training/schedule/update").length, 0, "never the add-then-delete that detaches it");
  assert.equal(coros.writesTo("/training/plan/update").length, 1);
  assert.deepEqual(
    coros.copy("R1").entities.map((entity) => [entity.idInPlan, entity.dayNo]),
    [["1", 0], ["2", 3], ["3", 6]],
    "same idInPlan, one day later, the rest as they were"
  );
});

test("a plan's session replaced keeps its place in the plan (P3.0 B)", async () => {
  const coros = fakeCoros();
  coros.runningCopy("R2", planMonday, [["1", 0, "Easy"], ["2", 3, "Tempo 8 km"]]);
  const thursday = dayOf(planMonday, 3);
  const { staged } = await propose([
    { op: "replace", session: { plan_id: "R2", id_in_plan: "2", date: thursday }, workout: easyRun() }
  ]);
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "applied");
  const copy = coros.copy("R2");
  assert.deepEqual(copy.entities.map((entity) => [entity.idInPlan, entity.dayNo]), [["1", 0], ["2", 3]]);
  assert.equal(copy.programs.find((program) => program.idInPlan === "2").name, "Easy 45");
  assert.equal(copy.programs.find((program) => program.idInPlan === "1").name, "Easy", "the other session is written back as it was");
  assert.equal(coros.writesTo("/training/schedule/update").length, 0);
});

test("a plan's session removed goes from the copy with status 3 (P3.0 A)", async () => {
  const coros = fakeCoros();
  coros.runningCopy("R3", planMonday, [["1", 0, "Easy"], ["2", 3, "Tempo"]]);
  const { staged } = await propose([{ op: "remove", session: { plan_id: "R3", id_in_plan: "1", date: planMonday } }]);
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "applied");
  assert.deepEqual(coros.copy("R3").entities.map((entity) => entity.idInPlan), ["2"]);
  assert.equal(coros.writesTo("/training/plan/update").length, 0);
});

test("a plan's session moved on COROS since the proposal is out of date", async () => {
  const coros = fakeCoros();
  coros.runningCopy("R4", planMonday, [["1", 0, "Easy"], ["2", 3, "Tempo"]]);
  const { staged } = await propose([
    { op: "move", session: { plan_id: "R4", id_in_plan: "2", date: dayOf(planMonday, 3) }, to_date: dayOf(planMonday, 4) }
  ]);
  coros.copy("R4").entities[1].dayNo = 2;
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "stale");
  assert.match(set.lines[0].reason, /no longer on the calendar/);
  assert.equal(coros.writesTo("/training/plan/update").length, 0);
});

test("an addition applied on the other machine meanwhile is not added again", async () => {
  const coros = fakeCoros();
  const { staged } = await propose([{ op: "add", to_date: daysFromNow(2), workout: easyRun("Shakeout") }]);
  await changes.applyScheduleChange(staged.changeSetId);
  // The other machine had not heard: its copy of the set still says proposed.
  const record = databaseModule.getChatScheduleChanges([staged.changeSetId])[0];
  const lines = JSON.parse(record.linesJson).map((line) => ({ ...line, status: "proposed" }));
  databaseModule.saveChatScheduleChange({ ...record, linesJson: JSON.stringify(lines) });
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "stale");
  assert.match(set.lines[0].reason, /already on the calendar/);
  assert.equal(coros.state.entities.length, 1);
});

test("the Calendar's drag moves a plan's session through its copy, and the athlete's own by add-then-remove", async () => {
  const coros = fakeCoros();
  coros.runningCopy("R5", planMonday, [["1", 0, "Easy"]]);
  coros.put({ idInPlan: 31, happenDay: tomorrow, name: "Own run" });
  // The Library has never seen the plan on this machine: COROS is asked whose it is.
  await moves.moveCalendarSession({ planId: "R5", idInPlan: "1", happenDay: planMonday }, dayOf(planMonday, 1));
  assert.ok(coros.state.requests.includes("POST /training/plan/query"), "an unknown planId is looked up, not guessed");
  assert.deepEqual(coros.copy("R5").entities.map((entity) => [entity.idInPlan, entity.dayNo]), [["1", 1]]);
  await moves.moveCalendarSession({ planId: OWN_SCHEDULE, idInPlan: "31", happenDay: tomorrow }, daysFromNow(2));
  assert.deepEqual(coros.state.entities.map((entity) => entity.happenDay), [daysFromNow(2)]);
  const listed = coros.state.requests.filter((line) => line === "POST /training/plan/query").length;
  const own = coros.state.entities[0];
  await moves.moveCalendarSession({ planId: OWN_SCHEDULE, idInPlan: own.idInPlan, happenDay: own.happenDay }, daysFromNow(3));
  assert.equal(
    coros.state.requests.filter((line) => line === "POST /training/plan/query").length,
    listed,
    "the athlete's own schedule is asked about once, not on every drag"
  );
  await assert.rejects(
    moves.moveCalendarSession({ planId: "R5", idInPlan: "1", happenDay: dayOf(planMonday, 1) }, daysFromNow(-1)),
    /before today/
  );
});

test("a set proposed in imperial units is applied in them", async () => {
  fakeCoros();
  const { staged } = await propose([{ op: "add", to_date: daysFromNow(2), workout: easyRun() }]);
  assert.equal(staged.unitSystem, undefined, "metric is the default and is not stored");
  const imperial = changes.createScheduleChangeSet({ summary: "x", lines: [], unitSystem: "imperial" });
  assert.equal(changes.readScheduleChanges([imperial.changeSetId])[0].unitSystem, "imperial");
});

// --- P3.5: what the calendar pointed at survives the store ---------------------------

test("a scheduleRefs anchor is kept through a save, unknown keys and all", () => {
  const session = history.createChatSession("claude-api");
  const ref = { scope: "session", day: tomorrow, planId: "R1", idInPlan: "5", label: "Long run", laterField: 1 };
  history.saveChatSession(session.id, [
    { kind: "scheduleRefs", refs: [ref, { scope: "fortnight", label: "not a scope" }] },
    { kind: "message", role: "user", content: "Too long?" }
  ]);
  const [anchor] = history.getChatSession(session.id);
  assert.equal(anchor.kind, "scheduleRefs");
  assert.deepEqual(anchor.refs, [ref], "a ref this build cannot read is dropped; one it can keeps what it does not know");
});

// --- P3.4: an analysis leaves at most two cards ------------------------------------

test("an analysis run leaves at most two cards, and says why the third is refused", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 41, happenDay: tomorrow, name: "A" });
  coros.put({ idInPlan: 42, happenDay: tomorrow, name: "B" });
  coros.put({ idInPlan: 43, happenDay: tomorrow, name: "C" });
  const service = await import(distUrl("chatService.js"));
  const removal = (id) => ({ summary: `Remove ${id}`, changes: [{ op: "remove", session: { plan_id: OWN_SCHEDULE, id_in_plan: id, date: tomorrow } }] });
  const run = { requestId: "run-1", toolPolicy: "read-only", sessionId: "conv-a" };
  const answers = [];
  for (const id of ["41", "42", "43"]) {
    answers.push(JSON.parse(await service.callChatToolForTests("propose_schedule_changes", removal(id), run)));
  }
  assert.deepEqual(answers.map((answer) => answer.ok), [true, true, false]);
  assert.equal(answers[2].error_code, "card_limit");
  assert.match(answers[2].errors[0], /at most 2 cards/);
  assert.equal(changes.readScheduleChanges([answers[0].change_set_id])[0].sessionId, "conv-a", "filed under the run's conversation");
  service.endRunForTests("run-1");
  const next = JSON.parse(await service.callChatToolForTests("propose_schedule_changes", removal("43"), { ...run, requestId: "run-2" }));
  assert.equal(next.ok, true, "the next run starts its own count");
  const chat = { requestId: "turn-1", toolPolicy: "interactive" };
  for (const id of ["41", "42", "43"]) {
    const answer = JSON.parse(await service.callChatToolForTests("propose_schedule_changes", removal(id), chat));
    assert.equal(answer.ok, true, "a chat turn is held to the prompt's words, not this count");
  }
  service.endRunForTests("run-2");
  service.endRunForTests("turn-1");
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
