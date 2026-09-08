// The merge rules, end to end.
//
// Runs under Electron because the last section opens a real SQLite file:
// better-sqlite3 is built for the Electron ABI and will not dlopen under plain
// node. Everything before that section is pure and would run either way.
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

const {
  HlcClock,
  compareHlcStrings,
  formatHlc,
  parseHlc,
  isNewer
} = await load("sync/hlc.js");
const {
  appendBatch,
  compactEntries,
  compactOplog,
  COMPACT_HORIZON_MS,
  entryIdentity,
  isValidEntry,
  parseBatch,
  oplogSnapshotPathFor,
  readAllEntries,
  readLatestOplogSnapshot,
  readLog,
  serializeBatch
} = await load("sync/oplog.js");
const { ChangeBuilder, applyEntries, resolve, tierForEntry } = await load(
  "sync/syncEngine.js"
);
const { LocalFolderProvider } = await load("sync/localFolderProvider.js");
const { StorageConflictError } = await load("sync/storageProvider.js");

const tempRoots = [];
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-${label}-`));
  tempRoots.push(dir);
  return dir;
}

// ===========================================================================
// Hybrid logical clock
// ===========================================================================

{
  // A clock never issues the same timestamp twice, even inside one millisecond.
  const frozen = new HlcClock({ device: "aaaa", now: () => 1_000_000 });
  const stamps = Array.from({ length: 500 }, () => formatHlc(frozen.tick()));
  assert.equal(new Set(stamps).size, 500, "timestamps must be unique");
  for (let i = 1; i < stamps.length; i += 1) {
    assert.ok(
      compareHlcStrings(stamps[i - 1], stamps[i]) < 0,
      "timestamps must increase even with a frozen wall clock"
    );
  }

  // Fixed-width encoding means lexicographic order is causal order — which is
  // what lets oplog batches be sorted by filename alone.
  const sortedLexically = [...stamps].sort();
  assert.deepEqual(sortedLexically, stamps, "lexicographic order is causal");

  // A wall clock that jumps backwards must not drag timestamps back with it.
  let wall = 5_000;
  const jumpy = new HlcClock({ device: "bbbb", now: () => wall });
  const before = jumpy.tick();
  wall = 1_000; // NTP correction, or a user changing the system clock
  const after = jumpy.tick();
  assert.ok(
    compareHlcStrings(formatHlc(before), formatHlc(after)) < 0,
    "a backwards wall clock must not produce a backwards timestamp"
  );

  // Round trip.
  const sample = jumpy.tick();
  assert.deepEqual(parseHlc(formatHlc(sample)), sample, "format/parse round trip");
  assert.throws(() => parseHlc("nonsense"), /Malformed HLC/);

  // Ties break on device id, so the order is total across machines.
  const left = formatHlc({ millis: 7, counter: 1, device: "aaaa" });
  const right = formatHlc({ millis: 7, counter: 1, device: "bbbb" });
  assert.ok(compareHlcStrings(left, right) < 0, "device id breaks ties");
  assert.equal(compareHlcStrings(left, left), 0, "a timestamp equals itself");

  assert.equal(isNewer(right, left), true);
  assert.equal(isNewer(left, right), false);
  assert.equal(isNewer(left, undefined), true, "anything beats nothing");
}

// The property the whole design rests on: a laptop running five minutes slow
// must not have its later edit discarded.
{
  const SKEW_MS = 5 * 60 * 1000;
  let sharedWall = 1_700_000_000_000;

  const fast = new HlcClock({ device: "fast", now: () => sharedWall });
  const slow = new HlcClock({ device: "slow", now: () => sharedWall - SKEW_MS });

  // The fast machine writes first...
  const fastEdit = formatHlc(fast.tick());
  // ...the slow machine sees that edit, then makes its own, later one.
  slow.observeString(fastEdit);
  const slowEdit = formatHlc(slow.tick());

  assert.ok(
    compareHlcStrings(fastEdit, slowEdit) < 0,
    "an edit made after observing another must sort after it, despite 5 minutes of skew"
  );

  // Without observing, a naive wall-clock comparison would have got it wrong.
  const naiveFast = sharedWall;
  const naiveSlow = sharedWall - SKEW_MS;
  assert.ok(
    naiveSlow < naiveFast,
    "sanity: the raw wall clocks really do disagree in the wrong direction"
  );

  // And the causal chain keeps holding as it bounces back and forth.
  let latest = slowEdit;
  for (let i = 0; i < 20; i += 1) {
    const clock = i % 2 === 0 ? fast : slow;
    clock.observeString(latest);
    const next = formatHlc(clock.tick());
    assert.ok(
      compareHlcStrings(latest, next) < 0,
      `causality must hold at hop ${i}`
    );
    latest = next;
    sharedWall += 1;
  }
}

// Counter overflow borrows from the millisecond field rather than wrapping.
{
  const clock = new HlcClock({
    device: "cccc",
    now: () => 42,
    last: { millis: 42, counter: 0xffff, device: "cccc" }
  });
  const next = clock.tick();
  assert.equal(next.counter, 0, "counter resets after overflow");
  assert.equal(next.millis, 43, "and borrows a millisecond so order is kept");
}

// ===========================================================================
// Oplog
// ===========================================================================

const entry = (hlc, overrides = {}) => ({
  hlc,
  op: "set",
  scope: "table",
  key: "chat_sessions",
  recordId: "s1",
  payload: { id: "s1", title: "Morning run" },
  ...overrides
});

{
  const hlcOf = (n, device = "aaaa") =>
    formatHlc({ millis: n, counter: 0, device });

  // Serialise / parse round trip.
  const batch = [entry(hlcOf(1)), entry(hlcOf(2), { recordId: "s2" })];
  assert.deepEqual(parseBatch(serializeBatch(batch)), batch);

  // A partially flushed batch costs one entry, never the whole file.
  const truncated = Buffer.concat([
    serializeBatch(batch),
    Buffer.from('{"hlc":"broken', "utf8")
  ]);
  assert.deepEqual(
    parseBatch(truncated),
    batch,
    "a torn last line must not discard the entries before it"
  );
  assert.deepEqual(
    parseBatch(Buffer.from('{"not":"an entry"}\n{"also":"bad"}\n')),
    [],
    "entries that fail validation are skipped"
  );

  // A JSON-valid entry whose timestamp is not a timestamp. This is the one
  // that used to get through: `readLog` sorts the whole log with
  // `compareHlcStrings`, which throws on a malformed HLC, so a single bad line
  // in the vault made every pull, compaction and manual sync throw — and the
  // line stayed there, so it stayed broken until someone edited the vault by
  // hand.
  assert.equal(
    isValidEntry({ ...entry(hlcOf(1)), hlc: "not-an-hlc" }),
    false,
    "an unparseable timestamp is refused at the door"
  );
  assert.deepEqual(
    parseBatch(
      Buffer.concat([
        serializeBatch(batch),
        Buffer.from(
          `${JSON.stringify({ ...entry(hlcOf(9)), hlc: "not-an-hlc" })}\n`,
          "utf8"
        )
      ])
    ),
    batch,
    "and costs one entry rather than the whole log"
  );

  // Validation.
  assert.equal(isValidEntry(entry(hlcOf(1))), true);
  assert.equal(isValidEntry({ ...entry(hlcOf(1)), op: "frobnicate" }), false);
  assert.equal(isValidEntry({ ...entry(hlcOf(1)), scope: "elsewhere" }), false);
  assert.equal(
    isValidEntry({ ...entry(hlcOf(1)), recordId: undefined }),
    false,
    "a table entry without a record id is not valid"
  );
  assert.equal(
    isValidEntry({ ...entry(hlcOf(1)), payload: undefined }),
    false,
    "a set without a payload is not valid"
  );
  assert.equal(
    isValidEntry({
      hlc: hlcOf(1),
      op: "delete",
      scope: "setting",
      key: "chat.provider"
    }),
    true,
    "a delete needs no payload"
  );

  assert.equal(entryIdentity(entry(hlcOf(1))), "table:chat_sessions:s1");
  assert.equal(
    entryIdentity({ ...entry(hlcOf(1)), scope: "setting", key: "chat.model" }),
    "setting:chat.model"
  );
}

// Each device writes only inside its own directory, so there is nothing to race.
{
  const storage = new LocalFolderProvider({ root: tempDir("oplog") });
  const hlcOf = (n, device) => formatHlc({ millis: n, counter: 0, device });

  await appendBatch(storage, "device-a", [
    entry(hlcOf(10, "device-a"), { recordId: "a1" })
  ]);
  await appendBatch(storage, "device-b", [
    entry(hlcOf(5, "device-b"), { recordId: "b1" })
  ]);
  await appendBatch(storage, "device-a", [
    entry(hlcOf(20, "device-a"), { recordId: "a2" })
  ]);

  const listed = (await storage.list("oplog")).map((item) => item.path);
  assert.equal(listed.length, 3);
  assert.ok(
    listed.every((item) => /^oplog\/device-[ab]\//.test(item)),
    "batches live under their own device directory"
  );

  // Reading merges every device and returns causal order regardless of who
  // wrote when.
  const all = await readAllEntries(storage);
  assert.deepEqual(
    all.map((item) => item.recordId),
    ["b1", "a1", "a2"],
    "entries come back ordered by HLC, not by device or filename"
  );

  assert.equal(await appendBatch(storage, "device-a", []), null, "empty batch is a no-op");

  // Re-using a batch name is a bug, and must surface as a conflict.
  await assert.rejects(
    appendBatch(storage, "device-a", [entry(hlcOf(10, "device-a"))]),
    (error) => error instanceof StorageConflictError,
    "a duplicate batch name must not silently overwrite history"
  );
}

// A device joining later reads a snapshot instead of replaying everything.
{
  const storage = new LocalFolderProvider({ root: tempDir("snapshot") });
  const hlcOf = (n) => formatHlc({ millis: n, counter: 0, device: "aaaa" });

  const history = [
    entry(hlcOf(1), { recordId: "s1", payload: { id: "s1", title: "v1" } }),
    entry(hlcOf(2), { recordId: "s1", payload: { id: "s1", title: "v2" } }),
    entry(hlcOf(3), { recordId: "s2", payload: { id: "s2", title: "keep" } })
  ];
  const snapshot = compactEntries(history, { now: () => 1_000 });
  assert.equal(snapshot.entries.length, 2, "compaction keeps one entry per record");
  assert.equal(snapshot.upTo, hlcOf(3));
  assert.deepEqual(
    snapshot.entries.find((item) => item.recordId === "s1").payload.title,
    "v2",
    "the surviving entry is the newest"
  );

  await storage.put(
    oplogSnapshotPathFor(snapshot.upTo),
    Buffer.from(JSON.stringify(snapshot), "utf8")
  );
  assert.deepEqual(
    (await readLatestOplogSnapshot(storage)).upTo,
    snapshot.upTo
  );

  // Batches already covered by the snapshot are not replayed on top of it.
  await appendBatch(storage, "aaaa", history);
  await appendBatch(storage, "aaaa", [
    entry(hlcOf(9), { recordId: "s3", payload: { id: "s3", title: "later" } })
  ]);
  const entries = await readAllEntries(storage);
  assert.deepEqual(
    entries.map((item) => item.recordId).sort(),
    ["s1", "s2", "s3"],
    "a joining device sees the snapshot plus only what came after it"
  );

  assert.equal(compactEntries([]), null, "nothing to compact is not an error");
  assert.equal(
    await readLatestOplogSnapshot(
      new LocalFolderProvider({ root: tempDir("empty") })
    ),
    null,
    "an uncompacted log has no snapshot"
  );
}

// Compaction snapshots and the user's whole-state backups must not be able to
// shadow each other.
//
// They shared the `snapshot/` prefix once, and `readLatestOplogSnapshot` took
// whichever path sorted last. An HLC name is hex and starts with `0`; a backup
// name is an ISO date and starts with `2` — so a single backup hid every
// compaction snapshot there would ever be, and a joining device silently
// replayed the entire log instead of reading the compacted view.
{
  const root = tempDir("prefix-collision");
  const storage = new LocalFolderProvider({ root });
  const hlcOf = (n) => formatHlc({ millis: n, counter: 0, device: "aaaa" });

  const history = [
    entry(hlcOf(1), { recordId: "s1", payload: { id: "s1", title: "v1" } }),
    entry(hlcOf(2), { recordId: "s2", payload: { id: "s2", title: "v2" } })
  ];
  const snapshot = compactEntries(history, { now: () => 1_000 });
  const snapshotPath = oplogSnapshotPathFor(snapshot.upTo);
  await storage.put(snapshotPath, Buffer.from(JSON.stringify(snapshot), "utf8"));

  assert.equal(
    snapshotPath.startsWith("oplog-snapshot/"),
    true,
    "a compaction snapshot lives in its own prefix"
  );
  assert.equal(
    (await storage.list("snapshot")).length,
    0,
    "and not in the one syncService keeps backups in"
  );
  assert.equal(
    (await storage.list("oplog")).length,
    0,
    "nor inside the oplog, where readAllEntries would parse it as JSONL"
  );

  // A backup, shaped and named exactly as syncService writes them, sitting in
  // the vault at the same time.
  await storage.put(
    "snapshot/2026-09-04T10-30-00-000Z__aaaa__0a1b2c3d4e5f6071.json",
    Buffer.from(JSON.stringify({ version: 1, id: "0a1b2c3d4e5f6071" }), "utf8")
  );

  assert.deepEqual(
    (await readLatestOplogSnapshot(storage)).upTo,
    snapshot.upTo,
    "a backup in the vault must not hide the compaction snapshot"
  );
  await appendBatch(storage, "aaaa", history);
  assert.deepEqual(
    (await readAllEntries(storage)).map((item) => item.recordId).sort(),
    ["s1", "s2"],
    "and the covered batch is still not replayed on top of it"
  );

  // Anything in the directory that this module did not name is ignored rather
  // than parsed hopefully.
  await storage.put(
    "oplog-snapshot/notes.json",
    Buffer.from('{"version":1,"upTo":"zzzz"}', "utf8")
  );
  assert.deepEqual(
    (await readLatestOplogSnapshot(storage)).upTo,
    snapshot.upTo,
    "a stray file must not be read as a compaction snapshot"
  );
}

// Tombstones outlive their deletion, then expire.
{
  const DAY = 24 * 60 * 60 * 1000;
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  const history = [
    entry(at(1000), { recordId: "s1" }),
    { hlc: at(2000), op: "delete", scope: "table", key: "chat_sessions", recordId: "s1" }
  ];

  const fresh = compactEntries(history, { now: () => 2000 + DAY });
  assert.equal(
    fresh.entries.filter((item) => item.op === "delete").length,
    1,
    "a recent tombstone is retained"
  );

  const aged = compactEntries(history, { now: () => 2000 + 200 * DAY });
  assert.equal(
    aged.entries.length,
    0,
    "an expired tombstone is dropped along with the record it buried"
  );
}

// ===========================================================================
// Merge rules
// ===========================================================================

/** A SyncTarget backed by plain maps, so the rules can be asserted directly. */
function fakeTarget() {
  const rows = new Map();
  const settings = new Map();
  const storage = new Map();
  return {
    rows,
    settings,
    storage,
    upsertRow: (table, id, row) => rows.set(`${table}:${id}`, row),
    deleteRow: (table, id) => rows.delete(`${table}:${id}`),
    setSetting: (key, value) => settings.set(key, value),
    deleteSetting: (key) => settings.delete(key),
    setLocalStorage: (key, value) => storage.set(key, value),
    deleteLocalStorage: (key) => storage.delete(key)
  };
}

// Policy is enforced on the way in, not just on the way out.
{
  const at = (millis, device = "aaaa") =>
    formatHlc({ millis, counter: 0, device });

  assert.equal(tierForEntry(entry(at(1))), "personal", "chat_sessions is personal");
  assert.equal(
    tierForEntry({ ...entry(at(1)), key: "training_activities" }),
    "derived"
  );
  assert.equal(
    tierForEntry({ ...entry(at(1)), key: "app_settings" }),
    undefined,
    "app_settings rows must travel as setting entries, never as a table"
  );

  const target = fakeTarget();
  const result = applyEntries(
    target,
    [
      entry(at(1), { recordId: "keep" }),
      // A machine that should never have sent these:
      { ...entry(at(2)), key: "training_activities", recordId: "cached" },
      { ...entry(at(3)), key: "downloads", recordId: "local-file" },
      { ...entry(at(4)), key: "app_settings", recordId: "sneaky" },
      { ...entry(at(5)), key: "no_such_table", recordId: "x" },
      {
        ...entry(at(6)),
        scope: "setting",
        key: "chat.claudeCode.executablePath",
        recordId: undefined,
        payload: { value: "/tmp/evil" }
      },
      {
        ...entry(at(7)),
        scope: "localStorage",
        key: "coroslink.sidebarCollapsed",
        recordId: undefined,
        payload: { value: "true" }
      }
    ]
  );

  assert.equal(result.applied, 1, "only the classified, syncable entry lands");
  assert.equal(result.rejected.length, 6);
  assert.deepEqual(
    result.rejected.map((item) => item.reason).sort(),
    [
      // training_activities (derived), downloads (device),
      // chat.claudeCode.executablePath (device), sidebarCollapsed (device)
      "not-syncable",
      "not-syncable",
      "not-syncable",
      "not-syncable",
      // app_settings (perKey, so never a table entry) and a table that does
      // not exist in this schema at all
      "unclassified",
      "unclassified"
    ],
    "derived/device entries are refused, unknown destinations are refused"
  );
  assert.deepEqual([...target.rows.keys()], ["chat_sessions:keep"]);
  assert.equal(
    target.settings.has("chat.claudeCode.executablePath"),
    false,
    "a remote machine must not be able to set this machine's binary path"
  );
}

// A credential never travels, and there is no flag that changes that.
//
// `trainingHub.accessToken` is the example because it is stored in the clear —
// nothing about it *needs* a machine's keychain — and it is still refused. An
// older build carried these when the user ticked a box; a vault written by one
// still holds such entries, and this is where they stop.
{
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });
  const session = {
    hlc: at(1),
    op: "set",
    scope: "setting",
    key: "trainingHub.accessToken",
    payload: { value: "tok-123" }
  };

  const target = fakeTarget();
  const result = applyEntries(target, [session]);
  assert.equal(result.applied, 0);
  assert.equal(result.rejected[0].reason, "not-syncable");
  assert.equal(
    target.settings.size,
    0,
    "a COROS session from another machine must not land here"
  );
}

// The same for a keychain-sealed credential, refused a second time by
// `isKeychainBound` rather than only by its tier.
//
// This is the bug the second gate exists for: the oplog used to carry
// `safeStorage` ciphertext that only the writing machine could open, so the
// destination stored bytes it could not decrypt while every
// `Boolean(getSetting(...))` check went on calling the account connected.
{
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });
  const sealed = {
    hlc: at(1),
    op: "set",
    scope: "setting",
    key: "chat.anthropic.apiKey",
    payload: { value: "djExZ2FyYmFnZQ==" }
  };

  const target = fakeTarget();
  const result = applyEntries(target, [sealed]);
  assert.equal(result.applied, 0);
  assert.equal(result.rejected[0].reason, "device-encrypted");
  assert.equal(
    target.settings.size,
    0,
    "another machine's ciphertext must not land here"
  );

  // The delete half. It used to be admitted while the set was dropped, so
  // clearing a key on one machine deleted a working credential on another —
  // one the vault had never carried and could not put back.
  const removal = {
    hlc: at(2),
    op: "delete",
    scope: "setting",
    key: "chat.anthropic.apiKey"
  };
  const holder = fakeTarget();
  holder.settings.set("chat.anthropic.apiKey", "local-ciphertext");
  const removalResult = applyEntries(holder, [removal]);
  assert.equal(removalResult.deleted, 0);
  assert.equal(removalResult.rejected[0].reason, "device-encrypted");
  assert.equal(
    holder.settings.get("chat.anthropic.apiKey"),
    "local-ciphertext",
    "a remote delete must not clear a credential this machine owns"
  );

  // Per-server MCP keys are matched by pattern, so a server added tomorrow is
  // covered without editing a list.
  const perServer = {
    hlc: at(3),
    op: "set",
    scope: "setting",
    key: "mcp.strava.tokens",
    payload: { value: "djExc3RyYXZh" }
  };
  const mcp = fakeTarget();
  assert.equal(applyEntries(mcp, [perServer]).applied, 0);
  assert.equal(mcp.settings.size, 0);
}

// Last writer wins, and the result does not depend on arrival order.
{
  const at = (millis, device) => formatHlc({ millis, counter: 0, device });
  const history = [
    entry(at(10, "aaaa"), { recordId: "s1", payload: { id: "s1", title: "first" } }),
    entry(at(30, "bbbb"), { recordId: "s1", payload: { id: "s1", title: "winner" } }),
    entry(at(20, "cccc"), { recordId: "s1", payload: { id: "s1", title: "middle" } })
  ];

  const winners = resolve(history);
  assert.equal(winners.size, 1);
  assert.equal(winners.get("table:chat_sessions:s1").payload.title, "winner");

  // Every permutation must converge on the same state.
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0]
  ];
  for (const order of permutations) {
    const target = fakeTarget();
    const result = applyEntries(
      target,
      order.map((i) => history[i])
    );
    assert.equal(
      target.rows.get("chat_sessions:s1").title,
      "winner",
      `order ${order.join("")} must converge on the same winner`
    );
    assert.equal(result.superseded, 2, "the two losers are counted, not applied");
  }
}

// A deletion made on one machine is not undone by another that still has the row.
{
  const at = (millis, device) => formatHlc({ millis, counter: 0, device });

  // Device A creates, device B (offline, and behind) still holds the creation.
  const created = entry(at(100, "aaaa"), {
    recordId: "s9",
    payload: { id: "s9", title: "notes" }
  });
  const deleted = {
    hlc: at(200, "aaaa"),
    op: "delete",
    scope: "table",
    key: "chat_sessions",
    recordId: "s9"
  };

  // B comes back online and replays its stale copy after the delete.
  const target = fakeTarget();
  applyEntries(target, [created, deleted, created]);
  assert.equal(
    target.rows.has("chat_sessions:s9"),
    false,
    "a stale set replayed after a delete must not resurrect the record"
  );

  // But a genuine re-creation, made after the delete, does come back.
  const recreated = entry(at(300, "bbbb"), {
    recordId: "s9",
    payload: { id: "s9", title: "notes again" }
  });
  const later = fakeTarget();
  applyEntries(later, [created, deleted, recreated]);
  assert.equal(
    later.rows.get("chat_sessions:s9").title,
    "notes again",
    "a record deliberately recreated after the delete must survive"
  );
}

// Two devices, one folder, converging on identical state.
{
  const root = tempDir("converge");
  const storage = new LocalFolderProvider({ root });

  let wall = 1_700_000_000_000;
  const clockA = new HlcClock({ device: "aaaaaaaaaaaaaaaa", now: () => wall });
  // B's clock is four minutes behind, which is the whole point.
  const clockB = new HlcClock({
    device: "bbbbbbbbbbbbbbbb",
    now: () => wall - 4 * 60 * 1000
  });

  const builderFor = (clock) =>
    new ChangeBuilder({ nextHlc: () => formatHlc(clock.tick()) });

  const a = builderFor(clockA);
  a.row("chat_sessions", "s1", { id: "s1", title: "from A" });
  a.setting("chat.provider", "claude-code");
  // Policy must stop these leaving, even though the caller asked:
  a.row("training_activities", "act-1", { activity_id: "act-1" });
  a.setting("hevy.apiKey", "hv-secret");
  a.localStorage("coros-theme", "paper");
  assert.deepEqual(
    [...a.skipped].sort(),
    ["setting:hevy.apiKey", "table:training_activities:act-1"],
    "derived rows and, without opt-in, secrets never enter the log"
  );
  await appendBatch(storage, clockA.device, a.entries);

  // B observes A's work before making its own edits.
  wall += 1000;
  for (const item of await readAllEntries(storage)) {
    clockB.observeString(item.hlc);
  }
  const b = builderFor(clockB);
  b.row("chat_sessions", "s1", { id: "s1", title: "from B, later" });
  b.row("chat_sessions", "s2", { id: "s2", title: "B only" });
  b.setting("chat.provider", "anthropic");
  await appendBatch(storage, clockB.device, b.entries);

  const entries = await readAllEntries(storage);
  const first = fakeTarget();
  applyEntries(first, entries);

  // The same entries, shuffled, must land in the same place.
  const shuffled = [...entries].reverse();
  const second = fakeTarget();
  applyEntries(second, shuffled);

  assert.deepEqual(
    [...first.rows.entries()].sort(),
    [...second.rows.entries()].sort(),
    "two devices must converge regardless of the order entries arrive in"
  );
  assert.equal(
    first.rows.get("chat_sessions:s1").title,
    "from B, later",
    "B's edit was causally later and must win despite its slower clock"
  );
  assert.equal(first.rows.get("chat_sessions:s2").title, "B only");
  assert.equal(first.settings.get("chat.provider"), "anthropic");
  assert.equal(first.storage.get("coros-theme"), "paper");
  assert.equal(
    first.settings.has("hevy.apiKey"),
    false,
    "the secret never made it into the log, so it cannot arrive here"
  );
}

// ===========================================================================
// The SQLite binding
// ===========================================================================

const database = await load("database.js");
const dbRoot = tempDir("sqlite");
database.initializeDatabase(dbRoot);

const { SqliteSyncTarget, RECORD_ID_SEPARATOR } = await load(
  "sync/sqliteSyncTarget.js"
);
const { deviceId, isValidDeviceId, DEVICE_ID_SETTING } = await load(
  "sync/deviceIdentity.js"
);

{
  const db = database.requireDatabase();
  const target = new SqliteSyncTarget();

  // A row round trips through the oplog shape into a real table.
  target.upsertRow("chat_sessions", "s1", {
    id: "s1",
    provider: "claude-code",
    title: "Real row",
    messages_json: "[]",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z"
  });
  const stored = db
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get("s1");
  assert.equal(stored.title, "Real row");

  // Replacing the same primary key updates rather than duplicating.
  target.upsertRow("chat_sessions", "s1", {
    id: "s1",
    provider: "claude-code",
    title: "Updated",
    messages_json: "[]",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T01:00:00Z"
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM chat_sessions").get().n,
    1,
    "an upsert must not duplicate the row"
  );

  // A column this build does not have is dropped, not fatal: machines running
  // different versions still have to merge.
  target.upsertRow("chat_sessions", "s1", {
    id: "s1",
    provider: "claude-code",
    title: "From a newer build",
    messages_json: "[]",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T02:00:00Z",
    column_from_the_future: "ignored"
  });
  assert.equal(
    db.prepare("SELECT title FROM chat_sessions WHERE id = ?").get("s1").title,
    "From a newer build"
  );

  target.deleteRow("chat_sessions", "s1");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM chat_sessions").get().n,
    0,
    "delete removes the row"
  );

  // Composite primary keys.
  const linkId = ["plan-1", "entry-1"].join(RECORD_ID_SEPARATOR);
  target.upsertRow("training_plan_workout_links", linkId, {
    plan_id: "plan-1",
    entry_id: "entry-1",
    program_id: "prog-1"
  });
  assert.equal(
    target.recordIdFor("training_plan_workout_links", {
      plan_id: "plan-1",
      entry_id: "entry-1"
    }),
    linkId,
    "recordIdFor must produce what deleteRow consumes"
  );
  target.deleteRow("training_plan_workout_links", linkId);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM training_plan_workout_links").get().n,
    0,
    "a composite key deletes the right row"
  );

  // Settings.
  target.setSetting("chat.provider", "openrouter");
  assert.equal(database.getSetting("chat.provider"), "openrouter");
  target.setSetting("chat.provider", "anthropic");
  assert.equal(database.getSetting("chat.provider"), "anthropic", "upsert, not insert");
  target.deleteSetting("chat.provider");
  assert.equal(database.getSetting("chat.provider"), undefined);

  // localStorage is queued for the renderer, never written here.
  target.setLocalStorage("coros-theme", "dark");
  target.deleteLocalStorage("coroslink.startupView");
  assert.deepEqual(target.drainLocalStorage(), [
    { op: "set", key: "coros-theme", value: "dark" },
    { op: "delete", key: "coroslink.startupView" }
  ]);
  assert.deepEqual(
    target.drainLocalStorage(),
    [],
    "draining takes the queue, so a second read finds nothing"
  );

  // Table names arrive from other machines, so they are checked, not trusted.
  assert.throws(
    () => target.upsertRow("chat_sessions; DROP TABLE chat_sessions", "x", { id: "x" }),
    /unsafe name/,
    "an injection attempt must be refused on the identifier"
  );
  assert.throws(
    () => target.upsertRow("training_activities", "x", { activity_id: "x" }),
    /derived table/,
    "a derived table must be refused even at this layer"
  );
  assert.throws(
    () => target.upsertRow("app_settings", "x", { key: "x", value: "y" }),
    /unclassified table/,
    "app_settings must not be writable as a table"
  );
  assert.throws(
    () => target.upsertRow("chat_sessions", "s1", { nothing_known: 1 }),
    /No known columns/
  );
  assert.throws(
    () => target.upsertRow("chat_sessions", "s1", { title: "no primary key" }),
    /missing primary key/
  );
  assert.throws(
    () => target.deleteRow("training_plan_workout_links", "only-one-part"),
    /expected 2/,
    "a record id with the wrong arity must not delete an unintended row"
  );

  // The table itself survived every one of those attempts.
  assert.ok(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'chat_sessions'").get(),
    "chat_sessions must still exist"
  );
}

// Device identity is minted once and then stable.
{
  const first = deviceId();
  assert.ok(isValidDeviceId(first), "a minted device id must be well formed");
  assert.equal(deviceId(), first, "the id must be stable across calls");
  assert.equal(database.getSetting(DEVICE_ID_SETTING), first, "and persisted");

  // A corrupted value is replaced rather than trusted.
  database.setSetting(DEVICE_ID_SETTING, "not-a-device-id");
  const replaced = deviceId();
  assert.ok(isValidDeviceId(replaced));
  assert.notEqual(replaced, "not-a-device-id");
}

// A full trip: build entries, write them, read them back, apply into SQLite.
{
  const db = database.requireDatabase();
  const storage = new LocalFolderProvider({ root: tempDir("endtoend") });
  const clock = new HlcClock({ device: deviceId() });
  const builder = new ChangeBuilder({ nextHlc: () => formatHlc(clock.tick()) });

  builder.row("chat_sessions", "e2e", {
    id: "e2e",
    provider: "claude-code",
    title: "End to end",
    messages_json: '[{"role":"user"}]',
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z"
  });
  builder.setting("chat.model", "claude-opus-5");

  await appendBatch(storage, clock.device, builder.entries);

  const target = new SqliteSyncTarget();
  const result = applyEntries(target, await readAllEntries(storage));

  assert.equal(result.applied, 2);
  assert.deepEqual(result.rejected, []);
  assert.equal(
    db.prepare("SELECT title FROM chat_sessions WHERE id = ?").get("e2e").title,
    "End to end"
  );
  assert.equal(database.getSetting("chat.model"), "claude-opus-5");
}


// ===========================================================================
// Compaction as an operation on the vault: what it may delete, and when
// ===========================================================================

// The whole point: pruning. Without it readLog downloads every batch ever
// written on every poll, so the log growing is the bug and the snapshot is only
// what makes deleting safe.
{
  const root = tempDir("compact-prunes");
  const storage = new LocalFolderProvider({ root });
  const HOUR = 60 * 60 * 1000;
  const now = 100 * HOUR;
  const at = (millis, device = "aaaa") => formatHlc({ millis, counter: 0, device });

  // 60 batches, all well past the horizon, each superseding the same record.
  for (let index = 0; index < 60; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index + 1), { payload: { id: "s1", title: `v${index}` } })
    ]);
  }
  assert.equal((await storage.list("oplog")).length, 60);

  const result = await compactOplog(storage, { now: () => now });

  assert.equal(result.batchesDeleted, 60, "every covered batch is pruned");
  assert.equal(result.entriesKept, 1, "and 60 versions fold to one");
  assert.equal(
    (await storage.list("oplog")).length,
    0,
    "the batch directory is emptied, which is the growth this exists to stop"
  );

  // And the surviving state is still exactly right.
  const entries = await readAllEntries(storage);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].payload.title, "v59", "the newest version survives");
}

// A small log is left alone: the round trips cost more than the growth.
{
  const root = tempDir("compact-small");
  const storage = new LocalFolderProvider({ root });
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  for (let index = 0; index < 5; index += 1) {
    await appendBatch(storage, "aaaa", [entry(at(index + 1))]);
  }
  const result = await compactOplog(storage, { now: () => 100 * 60 * 60 * 1000 });
  assert.equal(result.snapshotPath, null, "a short log is not worth compacting");
  assert.equal((await storage.list("oplog")).length, 5, "and nothing is deleted");
}

// The horizon. Entries newer than it are neither folded nor pruned, because an
// HLC carries the writer's own clock: a device running behind could otherwise
// flush an entry stamped below `upTo` after compaction had passed it, and
// readLog would skip it forever without it ever being in the snapshot.
{
  const root = tempDir("compact-horizon");
  const storage = new LocalFolderProvider({ root });
  const HOUR = 60 * 60 * 1000;
  const now = 100 * HOUR;
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  // 55 old batches, plus 5 written inside the last hour.
  for (let index = 0; index < 55; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index + 1), { recordId: `old${index}`, payload: { id: `old${index}` } })
    ]);
  }
  for (let index = 0; index < 5; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(now - 60_000 + index), {
        recordId: `new${index}`,
        payload: { id: `new${index}` }
      })
    ]);
  }

  const result = await compactOplog(storage, { now: () => now });

  assert.equal(result.batchesDeleted, 55, "only what is past the horizon is pruned");
  assert.equal(
    (await storage.list("oplog")).length,
    5,
    "the recent batches are still there to be read"
  );
  const ids = (await readAllEntries(storage)).map((item) => item.recordId).sort();
  assert.equal(ids.length, 60, "and not one entry was lost either side of it");
  assert.ok(ids.includes("new4") && ids.includes("old0"));
}

// A batch straddling the horizon must survive: it holds an entry the snapshot
// does not. Its older entries are then duplicated, which last-writer-wins
// merges away — a file kept is the correct trade against an entry lost.
{
  const root = tempDir("compact-straddle");
  const storage = new LocalFolderProvider({ root });
  const HOUR = 60 * 60 * 1000;
  const now = 100 * HOUR;
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  for (let index = 0; index < 55; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index + 1), { recordId: `old${index}`, payload: { id: `old${index}` } })
    ]);
  }
  // One batch that begins long ago and reaches into the last minute.
  await appendBatch(storage, "aaaa", [
    entry(at(100), { recordId: "straddle-old", payload: { id: "straddle-old" } }),
    entry(at(now - 30_000), {
      recordId: "straddle-new",
      payload: { id: "straddle-new" }
    })
  ]);

  const before = (await storage.list("oplog")).length;
  const result = await compactOplog(storage, { now: () => now });

  assert.equal(
    (await storage.list("oplog")).length,
    before - result.batchesDeleted
  );
  const ids = (await readAllEntries(storage)).map((item) => item.recordId);
  assert.ok(
    ids.includes("straddle-new"),
    "the entry inside the horizon is still readable, so its batch was kept"
  );
  assert.ok(ids.includes("straddle-old"), "and its older sibling too");
  assert.equal(
    new Set(ids).size,
    ids.length,
    "readLog's upTo filter drops the duplicate rather than applying it twice"
  );
}

// Two devices' directories, and a device that never compacts still reads a
// correct history afterwards.
{
  const root = tempDir("compact-multi");
  const storage = new LocalFolderProvider({ root });
  const HOUR = 60 * 60 * 1000;
  const now = 100 * HOUR;
  const at = (millis, device) => formatHlc({ millis, counter: 0, device });

  for (let index = 0; index < 30; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index * 2 + 1, "aaaa"), { recordId: "shared", payload: { id: "shared", title: `a${index}` } })
    ]);
    await appendBatch(storage, "bbbb", [
      entry(at(index * 2 + 2, "bbbb"), { recordId: "shared", payload: { id: "shared", title: `b${index}` } })
    ]);
  }

  await compactOplog(storage, { now: () => now });
  const entries = await readAllEntries(storage);
  assert.equal(entries.length, 1, "one record, one surviving entry");
  assert.equal(
    entries[0].payload.title,
    "b29",
    "and it is the causally newest across both devices"
  );
}

// A tombstone inside its retention window is kept, so a device that was offline
// cannot resurrect a deleted record through a compacted log.
{
  const root = tempDir("compact-tombstone");
  const storage = new LocalFolderProvider({ root });
  const HOUR = 60 * 60 * 1000;
  const now = 1000 * HOUR;
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  await appendBatch(storage, "aaaa", [
    entry(at(1), { recordId: "gone", payload: { id: "gone" } })
  ]);
  await appendBatch(storage, "aaaa", [
    { hlc: at(now - 2 * HOUR), op: "delete", scope: "table", key: "chat_sessions", recordId: "gone" }
  ]);
  for (let index = 0; index < 55; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index + 10), { recordId: `k${index}`, payload: { id: `k${index}` } })
    ]);
  }

  await compactOplog(storage, { now: () => now });
  const entries = await readAllEntries(storage);
  const tombstone = entries.find((item) => item.recordId === "gone");
  assert.ok(tombstone, "the deletion survives compaction");
  assert.equal(tombstone.op, "delete");
  assert.ok(
    !entries.some((item) => item.recordId === "gone" && item.op === "set"),
    "and the original set does not come back with it"
  );
}

// Compacting twice in a row is a no-op, not a second snapshot: nothing has aged
// past the horizon in between.
{
  const root = tempDir("compact-idempotent");
  const storage = new LocalFolderProvider({ root });
  const now = 100 * 60 * 60 * 1000;
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  for (let index = 0; index < 60; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index + 1), { recordId: `k${index}`, payload: { id: `k${index}` } })
    ]);
  }

  const first = await compactOplog(storage, { now: () => now });
  assert.ok(first.snapshotPath, "the first pass writes a snapshot");
  const second = await compactOplog(storage, { now: () => now });
  assert.equal(second.snapshotPath, null, "the second finds nothing new to do");
  assert.equal(
    (await storage.list("oplog-snapshot")).length,
    1,
    "and there is exactly one snapshot, not a pile of them"
  );
}

// Superseded snapshots are removed, so the directory does not become the thing
// that grows instead.
{
  const root = tempDir("compact-supersede");
  const storage = new LocalFolderProvider({ root });
  const HOUR = 60 * 60 * 1000;
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  for (let index = 0; index < 60; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index + 1), { recordId: `k${index}`, payload: { id: `k${index}` } })
    ]);
  }
  await compactOplog(storage, { now: () => 100 * HOUR });

  // A later round of writes, then a later pass.
  for (let index = 0; index < 60; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(200 * HOUR + index, "aaaa"), {
        recordId: `later${index}`,
        payload: { id: `later${index}` }
      })
    ]);
  }
  const second = await compactOplog(storage, { now: () => 300 * HOUR });

  assert.equal(second.snapshotsDeleted, 1, "the older snapshot is cleaned up");
  assert.equal((await storage.list("oplog-snapshot")).length, 1);
  assert.equal(
    (await readAllEntries(storage)).length,
    120,
    "and both rounds of history are still readable through it"
  );
}

// A credential entry left in a vault by an older build is folded like any
// other row, and refused when it is applied.
//
// Compaction used to have to stand down on finding one, because sealing was
// decided per machine: an opted-out device would have copied a COROS token out
// of a sealed batch, written it in the clear, and pruned the sealed original in
// the same pass. Every write is sealed now and no credential is ever written,
// so compaction has nothing to be careful about — the refusal lives on the
// apply side, where it belongs.
{
  const root = tempDir("compact-legacy-credential");
  const storage = new LocalFolderProvider({ root });
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  for (let index = 0; index < 55; index += 1) {
    await appendBatch(storage, "aaaa", [
      entry(at(index + 1), { recordId: `k${index}`, payload: { id: `k${index}` } })
    ]);
  }
  // As a build with the credentials opt-in would have written it.
  await appendBatch(storage, "aaaa", [
    {
      hlc: at(200),
      op: "set",
      scope: "setting",
      key: "trainingHub.accessToken",
      payload: { value: "a-real-token" }
    }
  ]);

  const result = await compactOplog(storage, {
    now: () => 100 * 60 * 60 * 1000
  });
  assert.ok(result.snapshotPath, "compaction runs rather than standing down");

  const folded = await readAllEntries(storage);
  assert.ok(
    folded.some((item) => item.key === "trainingHub.accessToken"),
    "the entry survives the fold, because pruning it would lose history"
  );

  const target = fakeTarget();
  const applied = applyEntries(target, folded);
  assert.equal(
    target.settings.has("trainingHub.accessToken"),
    false,
    "and it still never lands: an old vault cannot sign this machine in"
  );
  assert.ok(
    applied.rejected.some(
      (item) => item.entry.key === "trainingHub.accessToken"
    ),
    "the refusal is reported rather than silent"
  );
}

// An entry the target will not write costs one entry, not the merge.
//
// `upsertRow` throws for a row with no column this schema knows and `deleteRow`
// throws when the record id does not match the live primary key. Letting that
// out of `applyEntries` abandoned every entry sorted after it, recorded no
// progress, and then did the same on every poll for ever.
{
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });
  const refusing = {
    ...fakeTarget(),
    upsertRow(table, id, row) {
      if (id === "poison") throw new Error("no such column");
      this.rows.set(`${table}:${id}`, row);
    }
  };

  const result = applyEntries(refusing, [
    entry(at(1), { recordId: "poison", payload: { id: "poison" } }),
    entry(at(2), { recordId: "fine", payload: { id: "fine" } })
  ]);

  assert.equal(result.applied, 1, "the good entry lands");
  assert.equal(
    refusing.rows.has("chat_sessions:fine"),
    true,
    "even though it sorts after the one the target refused"
  );
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "target-refused");
  assert.equal(result.rejected[0].entry.recordId, "poison");
}

// `isApplied` is what stops the log being rewritten on every poll.
//
// `readAllEntries` has no cursor, so without it every merged row went back into
// SQLite every five seconds and `onApplied` never stopped firing — measured as
// three writes for three pulls over a one-entry log.
{
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });
  const target = fakeTarget();
  const merged = new Map();
  const entries = [entry(at(1), { recordId: "s1", payload: { id: "s1" } })];
  const apply = () =>
    applyEntries(target, entries, {
      isApplied: (item) => merged.get(entryIdentity(item)) === item.hlc
    });

  const first = apply();
  for (const item of first.merged) merged.set(entryIdentity(item), item.hlc);
  assert.equal(first.applied, 1);
  assert.deepEqual(
    first.merged.map((item) => item.recordId),
    ["s1"],
    "what was written is reported, so the caller can remember it"
  );

  const second = apply();
  assert.equal(second.applied, 0, "the same entry is not written twice");
  assert.deepEqual(second.merged, []);

  // A newer winner for the same record is not suppressed by the old one.
  entries.push(entry(at(5), { recordId: "s1", payload: { id: "s1", title: "new" } }));
  const third = apply();
  assert.equal(third.applied, 1, "a newer entry for a seen record still lands");
  assert.equal(target.rows.get("chat_sessions:s1").title, "new");
}

// readLog reports where each entry came from, which is the whole basis for
// deciding a batch is safe to delete.
{
  const root = tempDir("compact-readlog");
  const storage = new LocalFolderProvider({ root });
  const at = (millis) => formatHlc({ millis, counter: 0, device: "aaaa" });

  await appendBatch(storage, "aaaa", [
    entry(at(1), { recordId: "a" }),
    entry(at(9), { recordId: "b" })
  ]);
  const log = await readLog(storage);
  assert.equal(log.batches.length, 1);
  assert.equal(
    log.batches[0].maxHlc,
    at(9),
    "a batch is named by its first entry, so its reach has to be measured"
  );
  assert.deepEqual(log.snapshotPaths, []);
}

await Promise.all(
  tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true }))
);

console.log(
  "sync engine OK — HLC survives 5 min skew, order-independent convergence, " +
    "tombstones hold, no credential travels in either direction, a malformed " +
    "timestamp costs one entry, a refused entry costs one entry, nothing is " +
    "applied twice, SQLite round trip, compaction snapshots and user backups " +
    "cannot shadow each other, compaction prunes what it covers and nothing " +
    "it does not"
);
