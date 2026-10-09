// Vault format 2 (docs/sync-v2.md): a numbered log per device with a head,
// a version vector, a snapshot read only when needed, and coach transcripts
// travelling a message at a time — every record whole, last writer wins.
//
// Two or three machines share one temp folder as their vault. Their stores
// are maps (`fakeTarget`), merging through the same `rowMergers` and element
// helpers the real target uses; the SQLite target's own item writes are held
// at the end. Runs under Electron for the SQLite ABI.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bust = `?cacheBust=${Date.now()}`;
const load = (file) =>
  import(`${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}${bust}`);

const { LocalFolderProvider } = await load("sync/localFolderProvider.js");
const { ChangeBuilder } = await load("sync/syncEngine.js");
const { createMemoryRecordVersions } = await load("sync/recordVersions.js");
const { createMemoryOutbox } = await load("sync/outbox.js");
const { rowMergerFor } = await load("sync/rowMergers.js");
const { SyncLoop } = await load("sync/syncLoop.js");
const { parseBatch, entryIdentity } = await load("sync/oplog.js");
const {
  compactVault,
  listVault,
  logPathFor,
  headPathFor
} = await load("sync/vaultLog.js");
const { createMemoryVectorStore } = await load("sync/vectorStore.js");
const {
  createMemoryPublishedItems,
  elementHash,
  parseList,
  placeElement,
  removeElement,
  splitItemRecordId,
  withElementId
} = await load("sync/transcriptItems.js");
const database = await load("database.js");
const { SqliteSyncTarget } = await load("sync/sqliteSyncTarget.js");
const { collectStampedEntries } = await load("sync/fullState.js");

const tempRoots = [];
const tempDir = (label) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-v2-${label}-`));
  tempRoots.push(dir);
  return dir;
};

/** A store of maps, taking items as the real target does. */
function fakeTarget(published) {
  const rows = new Map();
  const settings = new Map();
  const storage = new Map();
  const key = (table, id) => `${table}:${id}`;
  const itemAt = (itemId) => {
    const [recordId, id] = splitItemRecordId(itemId);
    return { recordId, id };
  };
  return {
    rows,
    settings,
    storage,
    upsertRow: (table, id, row, context = { winner: true }) => {
      const merger = rowMergerFor(table);
      const next = merger ? merger(rows.get(key(table, id)), row, context).row : row;
      rows.set(
        key(table, id),
        context.winner ? { ...(rows.get(key(table, id)) ?? {}), ...next } : { ...(rows.get(key(table, id)) ?? {}), ...next }
      );
    },
    deleteRow: (table, id) => {
      rows.delete(key(table, id));
      published.clear(table, id);
    },
    upsertItem: (table, itemId, element) => {
      const { recordId, id } = itemAt(itemId);
      const row = rows.get(key(table, recordId));
      if (!row) return;
      const travelling = withElementId(element, id);
      published.set(table, recordId, id, elementHash(travelling));
      const next = placeElement(parseList(row.messages_json) ?? [], id, travelling);
      if (next) rows.set(key(table, recordId), { ...row, messages_json: JSON.stringify(next) });
    },
    deleteItem: (table, itemId) => {
      const { recordId, id } = itemAt(itemId);
      const row = rows.get(key(table, recordId));
      if (!row) return;
      published.remove(table, recordId, id);
      const next = removeElement(parseList(row.messages_json) ?? [], id);
      if (next) rows.set(key(table, recordId), { ...row, messages_json: JSON.stringify(next) });
    },
    readRow: (table, id) => rows.get(key(table, id)),
    setSetting: (k, v) => settings.set(k, v),
    deleteSetting: (k) => settings.delete(k),
    setLocalStorage: (k, v) => storage.set(k, v),
    deleteLocalStorage: (k) => storage.delete(k)
  };
}

/** A machine. `format: 1` is an older build still writing `oplog/`. */
function makeDevice(root, id, options = {}) {
  const published = options.publishedItems ?? createMemoryPublishedItems();
  const target = options.target ?? fakeTarget(published);
  const settings = options.settings ?? new Map();
  const fetched = [];
  const provider = () => {
    const inner = new LocalFolderProvider({ root });
    return {
      name: inner.name,
      list: (prefix) => inner.list(prefix),
      get: async (p) => {
        fetched.push(p);
        return inner.get(p);
      },
      put: (p, c, e) => inner.put(p, c, e),
      delete: (p, e) => inner.delete(p, e)
    };
  };
  const recordVersions = options.recordVersions ?? createMemoryRecordVersions();
  const outbox = options.outbox ?? createMemoryOutbox();
  const vector = options.vector ?? createMemoryVectorStore();
  const loop = new SyncLoop({
    provider,
    target,
    deviceId: () => id,
    deviceName: () => id,
    getSetting: (k) => settings.get(k),
    setSetting: (k, v) => settings.set(k, v),
    now: () => options.now?.() ?? Date.now(),
    setTimer: () => 0,
    clearTimer: () => undefined,
    conditions: () => ({ appActive: true, online: true }),
    recordVersions,
    outbox,
    format: options.format ?? 2,
    publishedItems: published,
    vector,
    buildId: options.buildId ?? "test-build"
  });
  const write = (fill) => {
    const builder = new ChangeBuilder({ nextHlc: loop.nextHlc });
    fill(builder);
    for (const entry of builder.entries) {
      if (entry.scope === "table") {
        if (entry.op === "delete") target.rows.delete(`${entry.key}:${entry.recordId}`);
        else target.rows.set(`${entry.key}:${entry.recordId}`, entry.payload);
      } else if (entry.scope === "setting") target.settings.set(entry.key, entry.payload.value);
    }
    loop.enqueue(builder.entries);
  };
  return {
    id,
    loop,
    target,
    settings,
    recordVersions,
    outbox,
    vector,
    published,
    fetched,
    write,
    /** Save a conversation as the chat store does: the whole row. */
    saveConversation(sessionId, messages, title = "A run") {
      write((b) =>
        b.row("chat_sessions", sessionId, {
          id: sessionId,
          provider: "claude-code",
          title,
          messages_json: JSON.stringify(messages),
          created_at: "2026-10-09T00:00:00.000Z",
          updated_at: "2026-10-09T00:00:00.000Z",
          pinned_at: null
        })
      );
    },
    messages(sessionId) {
      const row = target.rows.get(`chat_sessions:${sessionId}`);
      return row ? JSON.parse(row.messages_json).map((m) => m.content) : null;
    }
  };
}

const msg = (mid, content, mrev = 1) => ({ kind: "message", role: "user", content, mid, mrev });

async function filesIn(root, prefix) {
  return (await new LocalFolderProvider({ root }).list(prefix)).map((e) => e.path).sort();
}

async function batchAt(root, device, seq) {
  const stored = await new LocalFolderProvider({ root }).get(logPathFor(device, seq));
  return stored ? parseBatch(stored.content) : null;
}

// ===========================================================================
// The numbered log, the heads, and a turn that sends only the turn
// ===========================================================================
{
  const root = tempDir("basic");
  const a = makeDevice(root, "device-a");
  const b = makeDevice(root, "device-b");

  a.write((builder) => builder.setting("chat.provider", "claude-code"));
  a.saveConversation("s1", [msg("1-0001", "how was my run"), msg("1-0002", "steady")]);
  await a.loop.flush();
  assert.deepEqual(await filesIn(root, "log"), [logPathFor("device-a", 1)]);
  assert.deepEqual(await filesIn(root, "heads"), [headPathFor("device-a")]);
  assert.deepEqual(await filesIn(root, "oplog"), [], "nothing in the format-1 log");

  await b.loop.pull();
  assert.equal(b.target.settings.get("chat.provider"), "claude-code");
  assert.deepEqual(b.messages("s1"), ["how was my run", "steady"]);

  // One more turn: the row without its transcript, and the one new message.
  a.saveConversation("s1", [
    msg("1-0001", "how was my run"),
    msg("1-0002", "steady"),
    msg("1-0003", "and tomorrow?")
  ]);
  await a.loop.flush();
  const turn = await batchAt(root, "device-a", 2);
  const items = turn.filter((e) => e.scope === "item");
  const row = turn.find((e) => e.scope === "table" && e.key === "chat_sessions");
  assert.equal(items.length, 1, "a turn sends the turn, not the transcript");
  assert.equal(items[0].payload.entry.content, "and tomorrow?");
  assert.ok(!("messages_json" in row.payload), "and the row travels without it");

  b.fetched.length = 0;
  await b.loop.pull();
  assert.deepEqual(b.messages("s1"), ["how was my run", "steady", "and tomorrow?"]);
  assert.deepEqual(
    b.fetched.sort(),
    [headPathFor("device-a"), logPathFor("device-a", 2)].sort(),
    "the new head and the one new batch, nothing else"
  );

  // Nothing new: a listing, and not one file fetched.
  b.fetched.length = 0;
  await b.loop.pull();
  assert.deepEqual(b.fetched, [], "an idle pull fetches nothing at all");

  // b saving the conversation it received sends nothing back: what arrived is
  // recorded as published.
  const bBefore = (await filesIn(root, "log/device-b")).length;
  b.saveConversation("s1", JSON.parse(b.target.rows.get("chat_sessions:s1").messages_json));
  await b.loop.flush();
  const bBatch = await batchAt(root, "device-b", bBefore + 1);
  assert.equal(
    bBatch.filter((e) => e.scope === "item").length,
    0,
    "a received message is not published back"
  );
}
console.log("ok  numbered log and heads; a turn sends only the turn; an idle pull fetches nothing");

// ===========================================================================
// Two machines writing to one conversation, edits and deletes
// ===========================================================================
{
  const root = tempDir("concurrent");
  const a = makeDevice(root, "device-a");
  const b = makeDevice(root, "device-b");
  const base = [msg("1-0001", "q1"), msg("1-0002", "a1")];
  a.saveConversation("s1", base);
  await a.loop.flush();
  await b.loop.pull();

  // Each appends a turn of its own before seeing the other's.
  a.saveConversation("s1", [...base, msg("1-0003", "from a")]);
  b.saveConversation("s1", [...base, msg("1-0004", "from b")]);
  await a.loop.flush();
  await b.loop.flush();
  await a.loop.pull();
  await b.loop.pull();
  assert.deepEqual(a.messages("s1"), ["q1", "a1", "from a", "from b"]);
  assert.deepEqual(b.messages("s1"), a.messages("s1"), "both keep both turns, in one order");

  // An edit: the message whole, the newer copy wins.
  const current = JSON.parse(a.target.rows.get("chat_sessions:s1").messages_json);
  current[1] = { ...current[1], content: "a1, edited", mrev: 2 };
  a.saveConversation("s1", current);
  await a.loop.flush();
  await b.loop.pull();
  assert.equal(b.messages("s1")[1], "a1, edited");

  // A delete travels, and is not brought back by the union a merged row was.
  a.saveConversation("s1", current.filter((m) => m.mid !== "1-0004"));
  await a.loop.flush();
  await b.loop.pull();
  assert.deepEqual(b.messages("s1"), ["q1", "a1, edited", "from a"]);

  // The conversation deleted: its record and its messages.
  a.write((builder) => builder.deleteRow("chat_sessions", "s1"));
  await a.loop.flush();
  await b.loop.pull();
  assert.equal(b.messages("s1"), null);
}
console.log("ok  two machines' turns both kept; an edit wins whole; deletes travel");

// ===========================================================================
// Compaction, a gap, and a machine that joins late
// ===========================================================================
{
  const root = tempDir("compact");
  const a = makeDevice(root, "device-a");
  const b = makeDevice(root, "device-b");
  a.write((builder) => builder.setting("chat.provider", "one"));
  await a.loop.flush();
  await b.loop.pull();
  for (const value of ["two", "three", "four"]) {
    a.write((builder) => builder.setting("chat.provider", value));
    await a.loop.flush();
  }
  a.saveConversation("s1", [msg("1-0001", "kept through compaction")]);
  await a.loop.flush();

  const compact = () =>
    compactVault(new LocalFolderProvider({ root }), {
      now: () => Date.now(),
      nextHlc: a.loop.nextHlc,
      minLogFiles: 1
    });
  const result = await compact();
  assert.ok(result.snapshotPath, "a snapshot was written");
  assert.deepEqual(await filesIn(root, "log"), [], "and every batch it covers deleted");

  // b had read batch 1 and has never read a snapshot: it reads this one.
  await b.loop.pull();
  assert.equal(b.target.settings.get("chat.provider"), "four");
  assert.deepEqual(b.messages("s1"), ["kept through compaction"]);

  // Now a gap proper: b has read a snapshot, more batches are written and
  // compacted away before b looks again. Its next batch is gone, so it reads
  // the newer snapshot — not because it has none, but because of the gap.
  a.write((builder) => builder.setting("chat.provider", "five"));
  await a.loop.flush();
  a.write((builder) => builder.setting("chat.provider", "six"));
  await a.loop.flush();
  await compact();
  b.fetched.length = 0;
  await b.loop.pull();
  assert.equal(b.target.settings.get("chat.provider"), "six", "a gap is closed by the snapshot");
  assert.ok(b.fetched.some((p) => p.startsWith("snap/")));

  // c has never read anything: the snapshot, then whatever came after.
  a.write((builder) => builder.setting("chat.model", "after the snapshot"));
  await a.loop.flush();
  const c = makeDevice(root, "device-c");
  await c.loop.pull();
  assert.equal(c.target.settings.get("chat.provider"), "six");
  assert.equal(c.target.settings.get("chat.model"), "after the snapshot");
  assert.deepEqual(c.messages("s1"), ["kept through compaction"]);
}
console.log("ok  compaction folds the log; a gap and a late joiner read the snapshot");

// ===========================================================================
// Its own number, found in the vault when this machine lost it
// ===========================================================================
{
  const root = tempDir("own-seq");
  const first = makeDevice(root, "device-a");
  for (const value of ["1", "2", "3"]) {
    first.write((builder) => builder.setting("chat.provider", value));
    await first.loop.flush();
  }
  // The same device, its database gone: no vector, no stamps.
  const again = makeDevice(root, "device-a");
  again.write((builder) => builder.setting("chat.provider", "4"));
  await again.loop.flush();
  assert.ok(
    (await filesIn(root, "log/device-a")).includes(logPathFor("device-a", 4)),
    "the next number after what the vault holds, not 1 again"
  );
}
console.log("ok  a machine that lost its count continues from the vault's");

// ===========================================================================
// From format 1: migration, a late writer on the old log, an old queue
// ===========================================================================
{
  const root = tempDir("migrate");
  // Two machines on the old format.
  const oldA = makeDevice(root, "device-a", { format: 1 });
  const oldB = makeDevice(root, "device-b", { format: 1 });
  oldA.write((builder) => builder.setting("chat.provider", "from format 1"));
  oldA.saveConversation("s1", [msg("1-0001", "an old question"), msg("1-0002", "an old answer")]);
  await oldA.loop.flush();
  await oldB.loop.pull();
  assert.ok((await filesIn(root, "oplog")).length > 0);

  // a is upgraded: same store, same stamps, now format 2.
  const a = makeDevice(root, "device-a", {
    target: oldA.target,
    publishedItems: oldA.published,
    recordVersions: oldA.recordVersions,
    settings: oldA.settings
  });
  let raised = 0;
  const moved = await a.loop.migrateToV2({
    collect: () => {
      const builder = new ChangeBuilder({ nextHlc: a.loop.nextHlc });
      for (const [k, row] of a.target.rows) {
        const [table, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
        builder.row(table, id, row);
      }
      for (const [k, v] of a.target.settings) builder.setting(k, v);
      // Each under the timestamp it holds.
      return builder.entries.map((entry) => ({
        ...entry,
        hlc: a.recordVersions.get(entryIdentity(entry)) ?? entry.hlc
      }));
    },
    stillNeeded: async () => raised === 0,
    raiseFormat: async () => {
      raised += 1;
    }
  });
  assert.equal(moved, true);
  assert.equal(raised, 1, "the format is raised once, after the snapshot");
  const snaps = (await listVault(new LocalFolderProvider({ root }))).snapshots;
  assert.equal(snaps.length, 1);

  // b, still on the old build, writes once more before it is stopped.
  oldB.write((builder) => builder.setting("chat.model", "written late on the old log"));
  await oldB.loop.flush();

  // c joins in format 2: the snapshot, and the late write through the bridge.
  const c = makeDevice(root, "device-c");
  await c.loop.pull();
  assert.equal(c.target.settings.get("chat.provider"), "from format 1");
  assert.deepEqual(c.messages("s1"), ["an old question", "an old answer"]);
  assert.equal(
    c.target.settings.get("chat.model"),
    "written late on the old log",
    "the bridge reads what an old build wrote after the move"
  );
  // ...and publishes it again in format 2, so a machine reading only the new
  // log has it too.
  await c.loop.flush();
  const d = makeDevice(root, "device-d");
  await d.loop.pull();
  assert.equal(d.target.settings.get("chat.model"), "written late on the old log");

  // b upgraded later, with a queue its old build never sent: a whole
  // conversation, which goes out as a message at a time.
  const queued = createMemoryOutbox();
  const builder = new ChangeBuilder({ nextHlc: oldB.loop.nextHlc });
  builder.row("chat_sessions", "s2", {
    id: "s2",
    provider: "claude-code",
    title: "queued",
    messages_json: JSON.stringify([msg("1-0010", "queued while offline")]),
    created_at: "2026-10-09T00:00:00.000Z",
    updated_at: "2026-10-09T00:00:00.000Z",
    pinned_at: null
  });
  queued.add(builder.entries);
  const b = makeDevice(root, "device-b", { outbox: queued });
  b.loop.start();
  await b.loop.flush();
  b.loop.stop();
  const bLogs = await filesIn(root, "log/device-b");
  const sent = await batchAt(root, "device-b", bLogs.length);
  assert.ok(sent.some((e) => e.scope === "item" && e.payload.entry.content === "queued while offline"));
  assert.ok(!sent.some((e) => e.scope === "table" && "messages_json" in (e.payload ?? {})));
  assert.equal(queued.load().length, 0, "and the old queue is released once sent");
  await d.loop.pull();
  assert.deepEqual(d.messages("s2"), ["queued while offline"]);
}
console.log("ok  format 1 migrates once; the bridge carries a late old-log write; an old queue goes out split");

// ===========================================================================
// The read-again on upgrade
// ===========================================================================
{
  const root = tempDir("upgrade");
  const a = makeDevice(root, "device-a");
  a.write((builder) => builder.setting("chat.provider", "x"));
  await a.loop.flush();
  await compactVault(new LocalFolderProvider({ root }), {
    now: () => Date.now(),
    nextHlc: a.loop.nextHlc,
    minLogFiles: 1
  });
  const settings = new Map();
  const vector = createMemoryVectorStore();
  const recordVersions = createMemoryRecordVersions();
  const first = makeDevice(root, "device-b", { settings, vector, recordVersions, buildId: "1.1.0" });
  await first.loop.pull();
  first.fetched.length = 0;
  await first.loop.pull();
  assert.deepEqual(first.fetched, [], "the same build reads nothing again");
  const upgraded = makeDevice(root, "device-b", { settings, vector, recordVersions, buildId: "1.2.0" });
  await upgraded.loop.pull();
  assert.ok(
    upgraded.fetched.some((p) => p.startsWith("snap/")),
    "a new build reads the vault again from its snapshot, once"
  );
  upgraded.fetched.length = 0;
  await upgraded.loop.pull();
  assert.deepEqual(upgraded.fetched, []);
}
console.log("ok  a new app version reads the vault again once");

// ===========================================================================
// The SQLite target puts an element in place and records it as held
// ===========================================================================
{
  database.initializeDatabase(tempDir("db"));
  const published = createMemoryPublishedItems();
  const target = new SqliteSyncTarget(published);
  const row = {
    id: "s1",
    provider: "claude-code",
    title: "t",
    created_at: "2026-10-09T00:00:00.000Z",
    updated_at: "2026-10-09T00:00:00.000Z",
    pinned_at: null
  };
  // A conversation's record in format 2, transcript-less: it starts empty.
  target.upsertRow("chat_sessions", "s1", row);
  const read = () =>
    JSON.parse(target.readRow("chat_sessions", "s1").messages_json).map((m) => m.content);
  assert.deepEqual(read(), []);
  target.upsertItem("chat_sessions", "s1\u001f1-0002", msg("1-0002", "second"));
  target.upsertItem("chat_sessions", "s1\u001f1-0001", msg("1-0001", "first"));
  assert.deepEqual(read(), ["first", "second"], "in id order, whatever the arrival order");
  target.upsertItem("chat_sessions", "s1\u001f1-0001", msg("1-0001", "first, edited", 2));
  assert.deepEqual(read(), ["first, edited", "second"]);
  assert.equal(published.forRecord("chat_sessions", "s1").size, 2, "both recorded as held");
  const changes = target.takeContentChanges();
  assert.ok(changes.some((c) => c.recordId === "s1"), "and the conversation is reported changed");
  target.deleteItem("chat_sessions", "s1\u001f1-0002");
  assert.deepEqual(read(), ["first, edited"]);
  // A record with its title moved keeps its transcript.
  target.upsertRow("chat_sessions", "s1", { ...row, title: "renamed" });
  assert.deepEqual(read(), ["first, edited"]);
  assert.equal(target.readRow("chat_sessions", "s1").title, "renamed");
  // An element of a conversation not here goes with it.
  target.upsertItem("chat_sessions", "gone\u001f1-0001", msg("1-0001", "orphan"));
  assert.equal(target.readRow("chat_sessions", "gone"), undefined);
  target.deleteRow("chat_sessions", "s1");
  assert.equal(published.forRecord("chat_sessions", "s1").size, 0);

  // What a migration snapshots: each record under the timestamp it holds, and
  // only a record never stamped stamped now.
  target.upsertRow("chat_sessions", "s9", { ...row, id: "s9", messages_json: "[]" });
  database.setSetting("chat.provider", "claude-code");
  const stamps = new Map([
    ["table:chat_sessions:s9", "0000000000aa-0000-device-a"]
  ]);
  let fresh = 0;
  const stamped = collectStampedEntries({
    stampOf: (identity) => stamps.get(identity),
    nextHlc: () => `0000000000ff-${String(++fresh).padStart(4, "0")}-device-a`,
    localStorage: { "coros-theme": "paper" }
  });
  const conversation = stamped.find((e) => e.key === "chat_sessions" && e.recordId === "s9");
  assert.equal(conversation.hlc, "0000000000aa-0000-device-a", "a stamped record keeps its stamp");
  const setting = stamped.find((e) => e.scope === "setting" && e.key === "chat.provider");
  assert.ok(setting.hlc.startsWith("0000000000ff-"), "an unstamped one is stamped now");
  assert.ok(stamped.some((e) => e.scope === "localStorage" && e.key === "coros-theme"));
  database.closeDatabase();
}
console.log("ok  the SQLite target places, edits and removes a message by id");

await Promise.all(tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true })));
console.log("\nsync v2 tests passed");
