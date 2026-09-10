// What a pull tells the renderer, and what the renderer does about it.
//
// `sync:changed` used to carry two counts and a list of localStorage writes.
// Counts say something arrived, never what — so a screen had two moves on a
// pull, reload everything or reload nothing, and nothing is what shipped: a
// Coach conversation written on another machine sat in SQLite while the sidebar
// kept the list it read on mount, and the Sync panel told the athlete to
// restart. Naming the tables is what lets a view re-read its own.
//
// Three properties hold that up, and each fails silently on its own:
//
//   * `tablesTouched` names table entries and nothing else. A `setting` or
//     `localStorage` key leaking in would name a table that does not exist, and
//     every listener keyed on a real table name would fire on preference pulls.
//   * The event is queued rather than passed by argument. The loop follows the
//     app, not the window, so a pull can land before the renderer is listening
//     — and the counts, unlike the localStorage queue, had nowhere to wait.
//   * ChatView subscribes, and re-reads on `chat_sessions`.
//
// Usage:
//   npm run test:sync-changed-fanout

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}${bust}`
  );

const { tablesTouched } = await load("sync/syncEngine.js");

const main = read("electron/main.ts");
const syncTypes = read("electron/sync/syncTypes.ts");
const chatView = read("src/chat/ChatView.tsx");

const cases = [];
const test = (name, run) => cases.push([name, run]);

const entry = (scope, key, extra = {}) => ({
  scope,
  key,
  op: "set",
  hlc: "1",
  deviceId: "d1",
  ...extra
});

test("tablesTouched names tables, de-duplicated and in nothing else's company", () => {
  assert.deepEqual(
    tablesTouched([
      entry("table", "chat_sessions", { recordId: "a" }),
      entry("table", "chat_sessions", { recordId: "b" }),
      entry("table", "coach_analyses", { recordId: "c" }),
      entry("setting", "chat.provider"),
      entry("localStorage", "theme")
    ]),
    ["chat_sessions", "coach_analyses"]
  );
});

test("a pull of nothing but preferences names no table", () => {
  // The listener side of this: ChatView keys on a table name, so a settings-only
  // pull must not cost it a query — and, more to the point, must not cost the
  // open conversation a transcript re-read.
  assert.deepEqual(
    tablesTouched([
      entry("setting", "chat.customInstructions"),
      entry("localStorage", "units")
    ]),
    []
  );
});

test("a delete counts as touching the table", () => {
  assert.deepEqual(
    tablesTouched([
      entry("table", "chat_sessions", { op: "delete", recordId: "a" })
    ]),
    ["chat_sessions"]
  );
});

test("the event type declares the tables", () => {
  const shape = syncTypes.match(
    /export interface SyncChangedEvent \{[\s\S]*?\n\}/
  );
  assert.ok(shape, "SyncChangedEvent has to be declared in syncTypes.ts");
  assert.match(
    shape[0],
    /readonly tables: readonly string\[\];/,
    "without `tables` on the event nothing downstream can be selective"
  );
});

test("what a merge touched is queued, not passed as an argument", () => {
  // The bug this shape exists to prevent: `sendSyncChanged(applied, deleted)`
  // dropped both whole when the renderer was not ready, and the follow-up call
  // from `markRendererReady` passed zeroes. A pull landing during startup or a
  // reload therefore told the renderer nothing for the life of the process.
  assert.match(
    main,
    /function sendSyncChanged\(\): void/,
    "sendSyncChanged must take no arguments — anything passed in is lost when " +
      "the renderer is not ready"
  );
  assert.equal(
    /sendSyncChanged\([^)]+\)/.test(main),
    false,
    "no caller may pass a pull's results in; they belong in pendingSyncChange"
  );
  const onApplied = main.match(/onApplied: \(result\) => \{[\s\S]*?\n {4}\},/);
  assert.ok(onApplied, "the sync loop's onApplied has to be findable");
  assert.match(
    onApplied[0],
    /noteSyncApplied\(result\)/,
    "the loop's onApplied has to record the whole merge, tables included — " +
      "reaching for the counts alone is the shape that lost them"
  );
});

test("the queue is only emptied once the renderer has actually been sent it", () => {
  const body = main.match(/function sendSyncChanged\(\): void \{[\s\S]*?\n\}/);
  assert.ok(body, "sendSyncChanged has to be findable");
  const guard = body[0].indexOf("!rendererReady) return");
  const reset = body[0].indexOf("pendingSyncChange = {");
  const send = body[0].indexOf('webContents.send("sync:changed"');
  assert.ok(guard >= 0 && reset >= 0 && send >= 0);
  assert.ok(
    guard < reset && reset < send,
    "clearing the queue before the readiness guard would throw away exactly " +
      "what the guard is there to hold"
  );
});

test("ChatView re-reads its own tables when a pull names them", () => {
  assert.match(
    chatView,
    /api\.onSyncChanged\(/,
    "the Coach view has to subscribe, or a conversation merged from another " +
      "machine stays invisible until a restart"
  );
  const handler = chatView.match(
    /api\.onSyncChanged\(\(change\) => \{[\s\S]*?\n {4}\}\);/
  );
  assert.ok(handler, "the subscription's handler has to be findable");
  assert.match(
    handler[0],
    /change\.tables\.includes\("chat_sessions"\)/,
    "keyed on the table, not on the count"
  );
  assert.match(
    handler[0],
    /refreshSessions\(provider\)/,
    "the sidebar list is the half that shows a conversation exists"
  );
  assert.match(
    handler[0],
    /reloadTranscript\(sessionId\)/,
    "and the open conversation is the half that shows what it says"
  );
});

test("a turn of the athlete's own defers the re-read rather than losing it", () => {
  // Mid-turn the timeline on screen is ahead of the row — their message and the
  // tokens under it are not saved yet — so replacing it would take their own
  // words off the screen.
  const handler = chatView.match(
    /api\.onSyncChanged\(\(change\) => \{[\s\S]*?\n {4}\}\);/
  );
  assert.match(
    handler[0],
    /if \(chatBusyRef\.current\) \{\s*syncReloadPendingRef\.current = sessionId;\s*return;/,
    "a busy window must hold the reload, not skip it"
  );
  assert.match(
    chatView,
    /chatBusyRef\.current = streaming \|\| exportingLatestActivity;[\s\S]{0,400}?syncReloadPendingRef\.current/,
    "and something has to pick the held reload up when the turn ends"
  );
});

let failures = 0;
for (const [name, run] of cases) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${cases.length} checks failed`);
  process.exit(1);
}

console.log(
  "sync:changed fan-out OK — tables are named and settings are not, the " +
    "queue survives an unready renderer, and Coach re-reads its own without " +
    "interrupting a turn"
);
