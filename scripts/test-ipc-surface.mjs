import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");

const mainSource = read("electron/main.ts");
const preloadSource = read("electron/preload.ts");
const apiSource = read("src/coroslink-api.ts");

// A channel name is a plain string in three separate files, so a typo in any
// one of them typechecks cleanly and fails only at runtime. These are the
// invariants TypeScript cannot see.
const handled = new Set(
  [...mainSource.matchAll(/ipcMain\.handle\(\s*\n?\s*"([^"]+)"/g)].map((m) => m[1])
);
const invoked = new Set(
  [...preloadSource.matchAll(/ipcRenderer\.invoke\(\s*\n?\s*"([^"]+)"/g)].map((m) => m[1])
);
const listened = new Set(
  [...preloadSource.matchAll(/ipcRenderer\.on\("([^"]+)"/g)].map((m) => m[1])
);

assert.ok(handled.size > 100, "handler scrape found nothing; the regex has drifted");
assert.ok(invoked.size > 100, "invoke scrape found nothing; the regex has drifted");

assert.deepEqual(
  [...invoked].filter((channel) => !handled.has(channel)).sort(),
  [],
  "preload invokes a channel main.ts does not handle"
);
assert.deepEqual(
  [...handled].filter((channel) => !invoked.has(channel)).sort(),
  [],
  "main.ts handles a channel nothing invokes"
);

// --- section 8: the analysis surface ---------------------------------------
// Hand-maintained, and that is the point: the two scrapes above only prove
// main and preload agree with *each other*, so a channel deleted from both at
// once passes them and fails here.
const SECTION_8_CHANNELS = [
  // Every read is either "this conversation's analyses" or "this one
  // analysis". There is deliberately no channel that lists them all: an
  // analysis belongs to one conversation, so a list spanning every
  // conversation would be a list of unrelated things, and the screen that
  // showed one is gone.
  "analysis:listForSession",
  "analysis:get",
  "analysis:create",
  "analysis:update",
  "analysis:setEnabled",
  "analysis:delete",
  "analysis:reorder",
  "analysis:runNow",
  "analysis:listRuns",
  "analysis:cancelRun",
  "analysis:markSeen",
  "chat:renameSession"
];

// The attach model is gone, and these are the channels that carried it. They
// are named here so that reintroducing one has to be a decision rather than a
// merge: an analysis lives in one conversation and cannot be moved, so there
// is nothing left for any of them to mean.
for (const retired of [
  "analysis:list",
  "analysis:save",
  "analysis:attach",
  "analysis:detach",
  "analysis:listAttachments",
  "analysis:updateAttachment",
  "analysis:setAttachmentEnabled",
  "analysis:reorderAttachments"
]) {
  assert.equal(
    handled.has(retired) || invoked.has(retired),
    false,
    `${retired} belongs to the attach model, which no longer exists`
  );
}

for (const channel of SECTION_8_CHANNELS) {
  assert.ok(handled.has(channel), `main.ts is missing a handler for ${channel}`);
  assert.ok(invoked.has(channel), `preload.ts never invokes ${channel}`);
}

// --- the push channels ------------------------------------------------------
// The half of the bridge with no invoke to pair it up. A push channel is a
// plain string in two files that never run in the same process, and the
// renderer harness cannot see the mismatch: it keys its fake listeners on the
// *preload method* name, so a typo in either channel string leaves every test
// green and the push silently dead. This is the check that says otherwise.
const serviceSource = read("electron/coachAnalysisService.ts");

const emitted = new Set(
  [...serviceSource.matchAll(/emitToAnyWindow\(\s*\n?\s*"([^"]+)"/g)].map(
    (match) => match[1]
  )
);
assert.ok(emitted.size >= 3, "push emit scrape found too little; the regex has drifted");

for (const channel of emitted) {
  assert.ok(
    listened.has(channel),
    `${channel} is emitted but preload never subscribes to it`
  );
  assert.equal(
    handled.has(channel),
    false,
    `${channel} is a push channel and must not also be an invoke handler`
  );
}

// main.ts pushes too, and those channels have exactly the same problem: two
// plain strings in two files that never run together. A typo leaves the send
// going nowhere with nothing to say so — a sync pull's results, an update's
// status, and a COROS session that changed without anyone clicking for it all
// travel this way.
const pushedFromMain = new Set(
  [...mainSource.matchAll(/webContents\.send\(\s*\n?\s*"([^"]+)"/g)].map(
    (match) => match[1]
  )
);
assert.ok(
  pushedFromMain.size > 5,
  "main.ts push scrape found too little; the regex has drifted"
);
assert.deepEqual(
  [...pushedFromMain].filter((channel) => !listened.has(channel)).sort(),
  [],
  "main.ts sends a channel preload never subscribes to"
);

// And the other direction: a listener whose emitter was renamed away is a
// subscription that can never fire.
for (const channel of listened) {
  if (!channel.startsWith("analysis:")) continue;
  assert.ok(
    emitted.has(channel),
    `preload subscribes to ${channel} but nothing emits it`
  );
}

// --- and the writers that have to reach for the analysis push -------------
// Source about source, and the only kind of check available: both of these
// live in a `createDefaultDeps`, which no suite executes — the runner and the
// scheduler are driven through injected fakes, so the default wiring is
// exactly the code a test can never reach. Dropping one of these wrappers
// compiles, type-checks and leaves every suite green, and the athlete's row
// silently stops saying when it next fires.
for (const [file, call] of [
  ["electron/coachAnalysisScheduler.ts", "setCoachAnalysisSchedule"],
  ["electron/coachAnalysisService.ts", "setCoachAnalysisEnabled"]
]) {
  assert.match(
    read(file),
    new RegExp(`emitAnalysisChanged\\(\\s*\\n?\\s*${call}\\(`),
    `${file} must announce the analysis it changed via ${call}`
  );
}

// --- preload's shape and the renderer's view of it must agree --------------
// electron/preload.ts exports `CorosLinkApi = typeof api` while
// src/coroslink-api.ts declares its own interface of the same name. Nothing
// links the two at compile time, so they are compared here instead.
function topLevelKeys(source, startPattern, closing) {
  const start = new RegExp(startPattern).exec(source);
  assert.ok(start, `could not locate ${startPattern}`);
  const body = source.slice(start.index + start[0].length);
  const end = body.indexOf(closing);
  assert.ok(end > 0, `could not find the end of ${startPattern}`);
  return new Set(
    [...body.slice(0, end).matchAll(/^ {2}([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map(
      (match) => match[1]
    )
  );
}

const preloadKeys = topLevelKeys(preloadSource, "const api = \\{", "\n};");
const apiKeys = topLevelKeys(apiSource, "export interface CorosLinkApi \\{", "\n}");
assert.ok(preloadKeys.size > 200, "preload key scrape has drifted");

assert.deepEqual(
  [...preloadKeys].filter((key) => !apiKeys.has(key)).sort(),
  [],
  "preload exposes a method the renderer's CorosLinkApi does not declare"
);
assert.deepEqual(
  [...apiKeys].filter((key) => !preloadKeys.has(key)).sort(),
  [],
  "the renderer's CorosLinkApi declares a method preload does not expose"
);

// Every analysis method reaches the renderer under a name it can call.
for (const method of [
  "renameChatSession",
  "listCoachAnalysesForSession",
  "getCoachAnalysis",
  "createCoachAnalysis",
  "updateCoachAnalysis",
  "setCoachAnalysisEnabled",
  "deleteCoachAnalysis",
  "reorderCoachAnalyses",
  "runCoachAnalysisNow",
  "listCoachAnalysisRuns",
  "cancelCoachAnalysisRun",
  "markCoachAnalysisRunsSeen",
  "onCoachAnalysisRunUpdate",
  "onCoachAnalysisUpdate",
  "getCoachAnalysisPause",
  "resumeCoachAnalyses",
  "onCoachAnalysisPauseUpdate",
  "getCoachAnalysisSpend",
  "setCoachAnalysisBudget"
]) {
  assert.ok(apiKeys.has(method), `CorosLinkApi is missing ${method}`);
}

// The pre-rename names must be gone, not merely unused. A leftover
// `listCoachAutomations` on the bridge is a second way to reach the same
// feature, and the next person to add a caller will pick whichever they find
// first — which is how a "renamed" surface quietly keeps both spellings.
for (const stale of [...apiKeys, ...preloadKeys]) {
  assert.ok(
    !/Automation/.test(stale),
    `${stale} still spells the pre-rename concept; the bridge should say Analysis`
  );
  // And nothing may still speak of attachments: an analysis is its own place.
  assert.ok(
    !/Attach/.test(stale),
    `${stale} belongs to the attach model, which no longer exists`
  );
}

console.log("ipc surface tests passed");
