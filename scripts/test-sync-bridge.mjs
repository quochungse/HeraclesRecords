// The hooks that connect the app to the sync loop.
//
// Two properties matter more than the plumbing:
//
//   * An ordinary settings write reaches the loop, and one classified `device`
//     does not. The registry decides, at the hook, with no store involved.
//   * A merged inbound change does **not** come back out. SqliteSyncTarget
//     writes through the raw database rather than through `setSetting`, so
//     entries cannot bounce between two devices forever — this suite is what
//     stops that guarantee quietly disappearing.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) =>
  import(
    `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}${bust}`
  );

const database = await load("database.js");
const { attachSyncSink, isSyncAttached } = await load("sync/syncBridge.js");
const { SqliteSyncTarget } = await load("sync/sqliteSyncTarget.js");
const { applyEntries } = await load("sync/syncEngine.js");
const { HlcClock, formatHlc } = await load("sync/hlc.js");
const chatStore = await load("chatHistoryStore.js");

const tempRoots = [];
const tempDir = (label) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-${label}-`));
  tempRoots.push(dir);
  return dir;
};

database.initializeDatabase(tempDir("db"));
const db = database.requireDatabase();

const clock = new HlcClock({ device: "bridgetestdevice0" });
let captured = [];
const sink = {
  enqueue: (entries) => captured.push(...entries),
  nextHlc: () => formatHlc(clock.tick())
};

// --- Detached: the app behaves exactly as before -----------------------------

assert.equal(isSyncAttached(), false, "nothing is attached to begin with");
database.setSetting("chat.provider", "claude-code");
assert.equal(
  captured.length,
  0,
  "with no loop attached the hooks must be inert"
);
assert.equal(database.getSetting("chat.provider"), "claude-code");

// --- Attached: the registry decides at the hook -------------------------------

attachSyncSink(sink);
assert.equal(isSyncAttached(), true);

captured = [];
database.setSetting("chat.provider", "anthropic");
assert.equal(captured.length, 1, "a preference reaches the loop");
assert.equal(captured[0].scope, "setting");
assert.equal(captured[0].key, "chat.provider");
assert.equal(captured[0].payload.value, "anthropic");

captured = [];
database.setSetting("chat.claudeCode.executablePath", "/usr/local/bin/claude");
assert.deepEqual(
  captured,
  [],
  "a device-tier key must never leave, and is dropped at the hook"
);

captured = [];
database.setSetting("hevy.apiKey", "hv-123");
assert.deepEqual(
  captured,
  [],
  "a secret is dropped too while the user has not opted in"
);

captured = [];
database.deleteSettings(["chat.provider", "chat.claudeCode.executablePath"]);
assert.equal(captured.length, 1, "only the syncable key produces a tombstone");
assert.equal(captured[0].op, "delete");
assert.equal(captured[0].key, "chat.provider");

// --- Chat: one entry per turn, none for a no-op save --------------------------

captured = [];
const session = chatStore.createChatSession("claude-code");
assert.ok(session, "a session was created");

const entries = [
  { role: "user", content: "how did I sleep" },
  { role: "assistant", content: "seven hours twenty" }
];
chatStore.saveChatSession(session.id, entries);
const afterSave = captured.filter((entry) => entry.key === "chat_sessions");
assert.equal(afterSave.length, 1, "a finished turn queues exactly one entry");
assert.equal(afterSave[0].recordId, session.id);
assert.equal(afterSave[0].op, "set");
assert.ok(
  String(afterSave[0].payload.messages_json).includes("seven hours twenty"),
  "and carries the conversation"
);

// Re-opening a conversation replays the same transcript through this path. It
// must not look like a change, or simply reading a chat would upload it.
captured = [];
chatStore.saveChatSession(session.id, entries);
assert.deepEqual(
  captured.filter((entry) => entry.key === "chat_sessions"),
  [],
  "an unchanged save must not queue anything"
);

captured = [];
chatStore.deleteChatSession(session.id);
const deletes = captured.filter((entry) => entry.key === "chat_sessions");
assert.equal(deletes.length, 1, "deleting queues a tombstone");
assert.equal(deletes[0].op, "delete");

// --- The echo test ------------------------------------------------------------
//
// Applying entries that arrived from another device must not re-queue them.

captured = [];
const remoteClock = new HlcClock({ device: "otherdevice00000" });
const target = new SqliteSyncTarget();

const inbound = [
  {
    hlc: formatHlc(remoteClock.tick()),
    op: "set",
    scope: "setting",
    key: "chat.model",
    payload: { value: "claude-opus-5" }
  },
  {
    hlc: formatHlc(remoteClock.tick()),
    op: "set",
    scope: "table",
    key: "chat_sessions",
    recordId: "from-elsewhere",
    payload: {
      id: "from-elsewhere",
      provider: "claude-code",
      title: "Written on another machine",
      messages_json: "[]",
      created_at: "2026-09-04T00:00:00Z",
      updated_at: "2026-09-04T00:00:00Z"
    }
  }
];

const result = applyEntries(target, inbound);
assert.equal(result.applied, 2, "both inbound entries land");
assert.equal(
  database.getSetting("chat.model"),
  "claude-opus-5",
  "the setting really was written"
);
assert.equal(
  db.prepare("SELECT title FROM chat_sessions WHERE id = ?").get("from-elsewhere")
    .title,
  "Written on another machine",
  "and so was the row"
);

assert.deepEqual(
  captured,
  [],
  "applying inbound changes must queue nothing — otherwise two devices would " +
    "echo the same edit back and forth forever"
);

// --- Detaching stops it again --------------------------------------------------

attachSyncSink(null);
captured = [];
database.setSetting("chat.provider", "openrouter");
assert.deepEqual(captured, [], "detaching makes the hooks inert again");
assert.equal(isSyncAttached(), false);

// ---------------------------------------------------------------------------
// The real nextHlc, which writes a setting of its own
//
// Every test above injects a `nextHlc` that only ticks a clock, and that is
// exactly what hid the worst bug in this subsystem: the real one persists the
// clock with `database.setSetting` — the function whose hook is building the
// entry. Because the timestamp used to be minted inside the entry literal, the
// policy filter that refuses `sync.clock` ran too late, and one settings write
// recursed 1206 times before the stack gave out, with the `RangeError` eaten by
// the bridge's own catch.
//
// Wired here the way `main.ts` wires it, so the suite would see it happen.
// ---------------------------------------------------------------------------
{
  const { SyncLoop } = await load("sync/syncLoop.js");
  const { SqliteSyncTarget } = await load("sync/sqliteSyncTarget.js");
  const { LocalFolderProvider } = await load("sync/localFolderProvider.js");

  const root = tempDir("real-clock");
  let writes = 0;
  const countingSetSetting = (key, value) => {
    writes += 1;
    database.setSetting(key, value);
  };

  const loop = new SyncLoop({
    provider: () => new LocalFolderProvider({ root }),
    target: new SqliteSyncTarget(),
    deviceId: () => "aaaaaaaaaaaaaaaa",
    deviceName: () => "bridge",
    getSetting: database.getSetting,
    setSetting: countingSetSetting,
    now: () => Date.now(),
    setTimer: () => 1,
    clearTimer: () => {},
    conditions: () => ({ appActive: true, online: true })
  });

  captured = [];
  attachSyncSink({
    enqueue: (entries) => captured.push(...entries),
    nextHlc: loop.nextHlc
  });

  database.setSetting("chat.provider", "claude-code");
  attachSyncSink(null);

  assert.equal(
    writes,
    1,
    "one settings write must persist the clock once, not recurse into itself"
  );
  assert.equal(captured.length, 1, "and the change still reaches the queue");
  assert.equal(captured[0].key, "chat.provider");
  assert.ok(
    database.getSetting("sync.clock"),
    "the clock is persisted, just not through another entry"
  );
}

// ---------------------------------------------------------------------------
// A conversation entry carries every column, and a rename travels
// ---------------------------------------------------------------------------
{
  captured = [];
  attachSyncSink(sink);

  const session = chatStore.createChatSession("claude-code");
  chatStore.saveChatSession(session.id, [{ role: "user", content: "hi" }]);
  // A column no write site sets by hand, and the one a hand-built payload
  // erased: `SqliteSyncTarget` upserts with INSERT OR REPLACE, and REPLACE
  // deletes the conflicting row first, so any column missing from the payload
  // comes back NULL.
  db.prepare(
    "UPDATE chat_sessions SET coach_summary = 'SUMMARY', coach_summary_through = 42 WHERE id = ?"
  ).run(session.id);

  captured = [];
  chatStore.setChatSessionTitle(session.id, "Renamed");
  chatStore.setChatSessionPinned(session.id, true);
  attachSyncSink(null);

  assert.equal(
    captured.length,
    2,
    "a rename and a pin each travel — neither goes through saveChatSession"
  );
  for (const entry of captured) {
    assert.equal(entry.key, "chat_sessions");
    assert.equal(
      entry.payload.coach_summary,
      "SUMMARY",
      "every entry carries the whole row, so nothing is wiped on the way in"
    );
    assert.equal(entry.payload.coach_summary_through, 42);
  }
  assert.equal(captured[0].payload.title, "Renamed");
  assert.ok(captured[1].payload.pinned_at, "and the pin is in the second");
}

await Promise.all(
  tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true }))
);

console.log(
  "sync bridge OK — policy enforced at the hook, one entry per turn, " +
    "no-op saves queue nothing, inbound changes do not echo back, the real " +
    "clock does not recurse through the hook, and a rename or pin travels " +
    "with every column"
);
