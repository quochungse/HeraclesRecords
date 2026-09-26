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
  const state = {
    entities: [],
    programs: [],
    library: [],
    maxIdInPlan: 10,
    writes: [],
    failNextWrite: undefined
  };
  const ok = (data) => ({ apiCode: "A1", ...(data === undefined ? {} : { data }), message: "OK", result: "0000" });
  const refuse = (code, message) => ({ apiCode: "A1", message, result: code });

  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const answer = (() => {
      switch (target.pathname) {
        case "/training/schedule/query": {
          const from = target.searchParams.get("startDate");
          const to = target.searchParams.get("endDate");
          const entities = state.entities.filter((entity) => entity.happenDay >= from && entity.happenDay <= to);
          return ok({
            entities,
            programs: state.programs.filter((program) =>
              entities.some((entity) => entity.planId === program.planId && String(entity.idInPlan) === String(program.idInPlan))
            ),
            maxIdInPlan: state.maxIdInPlan
          });
        }
        case "/training/schedule/update": {
          state.writes.push({ path: target.pathname, body });
          if (state.failNextWrite) {
            const failure = state.failNextWrite;
            state.failNextWrite = undefined;
            return refuse(failure.code, failure.message);
          }
          for (const version of body.versionObjects ?? []) {
            if (version.status === 3) {
              state.entities = state.entities.filter(
                (entity) => !(entity.planId === version.planId && String(entity.idInPlan) === String(version.id))
              );
            }
          }
          return ok();
        }
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
    library(id, name) {
      state.library.push({ id, name, sportType: 1, exerciseNum: 1, totalSets: 1, estimatedTime: 1800 });
    },
    removals: () => state.writes.filter((write) => write.path === "/training/schedule/update" && write.body.versionObjects?.some((v) => v.status === 3)),
    deletions: () => state.writes.filter((write) => write.path === "/training/program/delete")
  };
}

const tomorrow = (() => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
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

test("a refusal fails the line and says why; the line is not tried again", async () => {
  const coros = fakeCoros();
  coros.put({ idInPlan: 16, happenDay: tomorrow, name: "Intervals" });
  const { staged } = await stageDelete({ target: "scheduled", schedule_date: tomorrow, workout_name: "Intervals" });
  coros.state.failNextWrite = { code: "17004", message: "Plan data is illegal." };
  const set = await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(set.lines[0].status, "failed");
  assert.match(set.lines[0].reason, /Plan data is illegal/);
  await changes.applyScheduleChange(staged.changeSetId);
  assert.equal(coros.removals().length, 1, "a failed line waits for Coach to propose it again");
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
