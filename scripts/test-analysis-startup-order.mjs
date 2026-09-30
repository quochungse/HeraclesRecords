// Coach analyses start after the vault has been looked at, and hear the pulls
// that land after that.
//
// They used to start in the same breath as the COROS re-login and the vault,
// so a machine opened after a day away ran its first activity poll on what it
// last held. An analysis syncs between machines with its watermark, and the
// conversation it answers syncs too: the machine analysed an activity the other
// one had already debriefed, into a transcript missing the turns written there,
// and the pull landing a minute later left the athlete with an answer that
// vanished and a second one that read differently.
//
// The wiring lives in `main.ts`, which no suite can load — so, like
// `test:renderer-ready`, this holds the shape down in the source. The
// behaviour on either side of it is exercised for real: the runner stopping in
// `test:coach-analysis-runner`, the merge saying what changed in
// `test:sync-engine` and `test:sync-twoway`.
//
// Usage:
//   npm run test:analysis-startup-order

import assert from "node:assert/strict";
import path from "node:path";
import { readSource } from "./lib/read-source.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const main = readSource(repoRoot, "electron", "main.ts");

const cases = [];
const test = (name, run) => cases.push([name, run]);

/** The body of a top-level function declaration, up to its closing brace. */
function functionBody(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `main.ts no longer declares ${name}`);
  const end = main.indexOf("\n}\n", start);
  return main.slice(start, end);
}

test("the watcher and the scheduler are started from one place", () => {
  for (const starter of ["startCoachActivityWatcher", "startCoachAnalysisScheduler"]) {
    const calls = main.match(new RegExp(`\\b${starter}\\(\\)`, "g")) ?? [];
    assert.equal(
      calls.length,
      1,
      `${starter}() is called once; a second call site starts analyses before the vault is read`
    );
    assert.match(
      functionBody("startCoachAnalysesAfterSync"),
      new RegExp(`\\b${starter}\\(\\)`),
      `${starter}() belongs to startCoachAnalysesAfterSync`
    );
  }
});

test("that place runs when start-up has re-logged in, opened the vault and pulled", () => {
  const launch = main.match(
    /void \(async \(\) => \{([\s\S]*?)\n {2}\}\)\(\)\.finally\(startCoachAnalysesAfterSync\);/
  );
  assert.ok(
    launch,
    "the start-up sequence has to end in .finally(startCoachAnalysesAfterSync), " +
      "so the analyses start whether the vault answered or not"
  );
  const body = launch[1];
  const restore = body.indexOf("await restoreTrainingHubSessionAtStartup()");
  const prepare = body.indexOf("await prepareSync()");
  const pull = body.indexOf("await firstPullAtStartup()");
  assert.ok(restore >= 0 && prepare > restore, "the vault still waits on the COROS re-login");
  assert.ok(pull > prepare, "and the first pull waits on the vault, and is awaited");
});

test("the first pull is a pull, and a slow one cannot hold them for ever", () => {
  const body = functionBody("firstPullAtStartup");
  assert.match(body, /loop\.pull\(\)/);
  assert.match(body, /STARTUP_SYNC_WAIT_MS/, "bounded by a ceiling");
  assert.match(body, /catch \(error\)/, "and a vault that fails does not stop them starting");
});

test("a quit that lands first is not undone by a start-up still settling", () => {
  assert.match(functionBody("startCoachAnalysesAfterSync"), /if \(coachAnalysesStopped\) return;/);
  assert.match(
    main,
    /app\.on\("before-quit", \(event\) => \{[\s\S]{0,300}?coachAnalysesStopped = true;/
  );
});

test("every pull tells the runner which conversations it changed", () => {
  assert.match(
    main,
    /onApplied: \(result\) => \{[\s\S]*?noteConversationsChangedBySync\(\s*result\.contentChanges[\s\S]*?"chat_sessions"/,
    "the loop's onApplied hands the chat_sessions content changes to the runner"
  );
});

let failures = 0;
for (const [name, run] of cases) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}\n  ${error.message}`);
  }
}
if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`analysis start-up order OK — ${cases.length} cases`);
}
