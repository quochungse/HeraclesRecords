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
const { ChangeBuilder, applyEntries } = await load("sync/syncEngine.js");
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
const { createMemoryVectorStore, forgetVaultLogState } = await load("sync/vectorStore.js");
const {
  createMemoryPublishedItems,
  elementHash,
  parseList,
  placeElement,
  removeElement,
  splitIntoItems,
  splitItemRecordId,
  withElementId
} = await load("sync/transcriptItems.js");
const database = await load("database.js");
const { SqliteSyncTarget } = await load("sync/sqliteSyncTarget.js");
const { collectStampedEntries } = await load("sync/fullState.js");
const chat = await load("chatHistoryStore.js");

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
  const republish = [];
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
      // Names the columns it writes, as the real target does.
      rows.set(key(table, id), { ...(rows.get(key(table, id)) ?? {}), ...next });
    },
    deleteRow: (table, id) => {
      rows.delete(key(table, id));
      published.clear(table, id);
    },
    upsertItem: (table, itemId, element) => {
      const { recordId, id } = itemAt(itemId);
      const row = rows.get(key(table, recordId));
      if (!row) throw new Error("no row here");
      const travelling = withElementId(element, id);
      const placed = placeElement(parseList(row.messages_json) ?? [], id, travelling);
      if (placed.kept) {
        published.remove(table, recordId, id);
        republish.push({ table, recordId });
        return;
      }
      published.set(table, recordId, id, elementHash(travelling));
      if (placed.list) rows.set(key(table, recordId), { ...row, messages_json: JSON.stringify(placed.list) });
    },
    deleteItem: (table, itemId) => {
      const { recordId, id } = itemAt(itemId);
      const row = rows.get(key(table, recordId));
      if (!row) return;
      published.remove(table, recordId, id);
      const next = removeElement(parseList(row.messages_json) ?? [], id);
      if (next) rows.set(key(table, recordId), { ...row, messages_json: JSON.stringify(next) });
    },
    // Read once the merge is over, as the real target reads them.
    takeRepublish: () =>
      republish
        .splice(0, republish.length)
        .map(({ table, recordId }) => ({ table, recordId, row: rows.get(key(table, recordId)) }))
        .filter((taken) => taken.row),
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
      put: (p, c, e) => (options.put ? options.put(inner, p, c, e) : inner.put(p, c, e)),
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
      } else if (entry.scope === "setting") {
        if (entry.op === "delete") target.settings.delete(entry.key);
        else target.settings.set(entry.key, entry.payload.value);
      }
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

/** A message as the chat store keeps one: `mrev` is the stamp of its last edit,
 *  a string like its `mid` (the store mints both). */
const msg = (mid, content, mrev = mid) => ({ kind: "message", role: "user", content, mid, mrev });

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
  current[1] = { ...current[1], content: "a1, edited", mrev: "1-0099" };
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

  // A conversation deleted sends one tombstone, and compaction drops its
  // messages with it rather than keeping them in every snapshot after.
  a.saveConversation("gone", [msg("1-0001", "soon gone"), msg("1-0002", "this too")]);
  await a.loop.flush();
  a.write((builder) => builder.deleteRow("chat_sessions", "gone"));
  await a.loop.flush();
  const tombstoneBatch = await batchAt(root, "device-a", a.vector.load().get("device-a").seq);
  assert.equal(
    tombstoneBatch.filter((e) => e.scope === "item").length,
    0,
    "a deleted conversation sends no tombstone per message"
  );
  const folded = await compact();
  const folding = JSON.parse(
    (await new LocalFolderProvider({ root }).get(folded.snapshotPath)).content.toString("utf8")
  );
  assert.ok(
    !folding.entries.some((e) => e.scope === "item" && e.recordId.startsWith("gone\u001f")),
    "and the snapshot keeps none of its messages"
  );
  assert.ok(folding.entries.some((e) => e.op === "delete" && e.recordId === "gone"));

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
// From format 1: migration, a late writer on the old build, an old queue
// ===========================================================================

/** Every record a device holds, each under its stamp — what `collectStampedEntries`
 *  gives the app — for a migration's snapshot and a seed. */
function stampedOf(device) {
  const builder = new ChangeBuilder({ nextHlc: device.loop.nextHlc });
  for (const [k, row] of device.target.rows) {
    const at = k.indexOf(":");
    builder.row(k.slice(0, at), k.slice(at + 1), row);
  }
  for (const [k, v] of device.target.settings) builder.setting(k, v);
  return builder.entries.map((entry) => ({
    ...entry,
    hlc: device.recordVersions.get(entryIdentity(entry)) ?? entry.hlc
  }));
}

/** What the app's seed does on a machine's first pass in a format: read the
 *  vault, then publish what it holds under the timestamps it holds. */
async function seed(device) {
  await device.loop.pull();
  device.loop.enqueue(stampedOf(device));
  await device.loop.flush();
}

{
  const root = tempDir("migrate");
  // Two machines on the old format.
  const oldA = makeDevice(root, "device-a", { format: 1 });
  const oldB = makeDevice(root, "device-b", { format: 1 });
  oldA.write((builder) => builder.setting("chat.provider", "from format 1"));
  oldA.write((builder) => builder.setting("chat.coach.style", "to be deleted"));
  oldA.saveConversation("s1", [msg("1-0001", "an old question"), msg("1-0002", "an old answer")]);
  await oldA.loop.flush();
  await oldB.loop.pull();
  // a deletes a setting b never hears about on the old format.
  oldA.write((builder) => builder.deleteSetting("chat.coach.style"));
  await oldA.loop.flush();
  assert.equal(oldB.target.settings.get("chat.coach.style"), "to be deleted");

  // a is upgraded: same store, same stamps, now format 2.
  const a = makeDevice(root, "device-a", {
    target: oldA.target,
    publishedItems: oldA.published,
    recordVersions: oldA.recordVersions,
    settings: oldA.settings
  });
  let raised = 0;
  const moved = await a.loop.migrateToV2({
    collect: () => stampedOf(a),
    stillNeeded: async () => raised === 0,
    raiseFormat: async () => {
      raised += 1;
    }
  });
  assert.equal(moved, true);
  assert.equal(raised, 1, "the format is raised once, after the snapshot");
  const snaps = (await listVault(new LocalFolderProvider({ root }))).snapshots;
  assert.equal(snaps.length, 1);
  const snapshot = JSON.parse(
    (await new LocalFolderProvider({ root }).get(snaps[0])).content.toString("utf8")
  );
  assert.ok(
    snapshot.entries.some((e) => e.op === "delete" && e.key === "chat.coach.style"),
    "the snapshot carries the old log's tombstones, not only what a holds"
  );
  assert.ok(
    snapshot.entries.filter((e) => e.scope === "item").length === 2,
    "and every message of every conversation"
  );

  // b, still on the old build, writes once more before it is stopped.
  oldB.write((builder) => builder.setting("chat.model", "written late on the old build"));
  await oldB.loop.flush();

  // c joins in format 2: the snapshot. b's late write is not there yet — b
  // publishes its own, when it is upgraded.
  const c = makeDevice(root, "device-c");
  await c.loop.pull();
  assert.equal(c.target.settings.get("chat.provider"), "from format 1");
  assert.deepEqual(c.messages("s1"), ["an old question", "an old answer"]);
  assert.equal(c.target.settings.get("chat.model"), undefined);

  // b upgraded: same store and stamps, and a queue its old build never sent —
  // a whole conversation, which goes out as a message at a time.
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
  oldB.target.rows.set("chat_sessions:s2", builder.entries[0].payload);
  const b = makeDevice(root, "device-b", {
    target: oldB.target,
    publishedItems: oldB.published,
    recordVersions: oldB.recordVersions,
    settings: oldB.settings,
    outbox: queued
  });
  b.loop.start();
  await b.loop.flush();
  const bLogs = await filesIn(root, "log/device-b");
  const sent = await batchAt(root, "device-b", bLogs.length);
  assert.ok(sent.some((e) => e.scope === "item" && e.payload.entry.content === "queued while offline"));
  assert.ok(!sent.some((e) => e.scope === "table" && "messages_json" in (e.payload ?? {})));
  assert.equal(queued.load().length, 0, "the old queue goes out split, and is released once sent");

  // Its seed: the vault first — the tombstone takes the setting b never knew
  // was deleted — then everything it holds, under the stamps it holds.
  await seed(b);
  b.loop.stop();
  assert.equal(b.target.settings.get("chat.coach.style"), undefined, "a deletion reaches a machine that missed it");
  const d = makeDevice(root, "device-d");
  await d.loop.pull();
  assert.equal(
    d.target.settings.get("chat.model"),
    "written late on the old build",
    "what b wrote on the old build after the move reaches the new log with its seed"
  );
  assert.equal(d.target.settings.get("chat.coach.style"), undefined, "and a deleted record is not published back");
  assert.equal(d.target.settings.get("chat.provider"), "from format 1");
  assert.deepEqual(d.messages("s2"), ["queued while offline"]);
  assert.deepEqual(d.messages("s1"), ["an old question", "an old answer"]);
}
console.log("ok  format 1 migrates once with its tombstones; a late old-build write goes out with that machine's seed; an old queue goes out split");

// A machine joining with a record it shares with the vault takes the vault's
// newer copy: its seed is sent after the pull, under the stamp it then holds,
// so being sent later is not being newer.
{
  const root = tempDir("join");
  const a = makeDevice(root, "device-a");
  a.write((builder) => builder.setting("chat.provider", "chosen on a"));
  await a.loop.flush();
  const b = makeDevice(root, "device-b");
  // Set on b before it ever synced, and older than a's choice.
  b.target.settings.set("chat.provider", "b's old default");
  await seed(b);
  assert.equal(b.target.settings.get("chat.provider"), "chosen on a");
  await a.loop.pull();
  assert.equal(a.target.settings.get("chat.provider"), "chosen on a", "a joining machine does not overwrite the vault");
}
console.log("ok  a joining machine's seed does not beat a newer copy in the vault");

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

// A snapshot that cannot be read leaves every place where it was: the read
// again is not counted done, and nothing already read is forgotten.
{
  const root = tempDir("unreadable");
  const a = makeDevice(root, "device-a");
  for (const value of ["1", "2", "3"]) {
    a.write((builder) => builder.setting("chat.provider", value));
    await a.loop.flush();
  }
  const settings = new Map();
  const vector = createMemoryVectorStore();
  const b = makeDevice(root, "device-b", { settings, vector, buildId: "1.1.0" });
  await b.loop.pull();
  assert.equal(vector.load().get("device-a").seq, 3);
  // A snapshot this build cannot read appears, and b is upgraded.
  await new LocalFolderProvider({ root }).put(
    "snap/ffffffffffff-0000-device-a.json",
    Buffer.from("{ not a snapshot", "utf8")
  );
  const upgraded = makeDevice(root, "device-b", { settings, vector, buildId: "1.2.0" });
  await upgraded.loop.pull();
  assert.equal(vector.load().get("device-a").seq, 3, "its place is kept");
  assert.equal(settings.get("sync.v2.fullReadBuild"), "1.1.0", "and the read again is still owed");
}
console.log("ok  an unreadable snapshot loses no place");

// A row before its elements when they share a timestamp, whatever order they
// arrive in — a migration's snapshot stamps messages with their conversation's.
{
  const published = createMemoryPublishedItems();
  const target = fakeTarget(published);
  const hlc = "0000000000aa-0000-device-a";
  applyEntries(target, [
    { hlc, op: "set", scope: "item", key: "chat_sessions", recordId: "s1\u001f1-0001", payload: { entry: msg("1-0001", "kept") } },
    { hlc, op: "set", scope: "table", key: "chat_sessions", recordId: "s1", payload: { id: "s1", title: "t" } }
  ]);
  assert.deepEqual(
    JSON.parse(target.rows.get("chat_sessions:s1").messages_json).map((m) => m.content),
    ["kept"]
  );
}
console.log("ok  a row is applied before its elements at the same timestamp");


// ===========================================================================
// Found in review: each of these failed before its fix
// ===========================================================================

// An older copy of a conversation deleted here does not insert it again.
{
  const root = tempDir("no-resurrection");
  const a = makeDevice(root, "device-a");
  const b = makeDevice(root, "device-b");
  a.saveConversation("s1", [msg("1-0001", "q")]);
  await a.loop.flush();
  await b.loop.pull();
  // b renames it, but its batch is late; a deletes it meanwhile.
  b.saveConversation("s1", [msg("1-0001", "q")], "renamed on b");
  // Strictly later: within one millisecond the clocks would tie and the
  // device id decide, and a rename that is newer rightly wins.
  await new Promise((resolve) => setTimeout(resolve, 5));
  a.write((builder) => builder.deleteRow("chat_sessions", "s1"));
  await a.loop.flush();
  await b.loop.flush();
  await a.loop.pull();
  assert.equal(a.messages("s1"), null, "the delete is newer, and the row stays gone");
  await b.loop.pull();
  assert.equal(b.messages("s1"), null);
}
console.log("ok  an older copy of a deleted conversation does not bring it back");

// A conversation created, written in and renamed, read in one pull: the row
// lands at its newest copy's timestamp, after its first message's — and the
// message must still find it.
{
  const root = tempDir("rename-in-one-pull");
  const a = makeDevice(root, "device-a");
  a.saveConversation("s1", [msg("1-0001", "the first message")]);
  a.saveConversation("s1", [msg("1-0001", "the first message")], "renamed");
  await a.loop.flush();
  const b = makeDevice(root, "device-b");
  await b.loop.pull();
  assert.deepEqual(b.messages("s1"), ["the first message"]);
  assert.equal(b.target.rows.get("chat_sessions:s1").title, "renamed");
}
console.log("ok  messages written before a rename land with the row read in the same pull");

// A head that failed to move is moved again, so its batch is not invisible.
{
  const root = tempDir("head-behind");
  let failHead = false;
  let headWrites = 0;
  const a = makeDevice(root, "device-a", {
    put: (inner, p, c, e) => {
      if (p.startsWith("heads/")) {
        if (failHead) throw new Error("the head write timed out");
        headWrites += 1;
      }
      return inner.put(p, c, e);
    }
  });
  const b = makeDevice(root, "device-b");
  a.write((builder) => builder.setting("chat.provider", "one"));
  await a.loop.flush();
  failHead = true;
  a.write((builder) => builder.setting("chat.provider", "two"));
  await a.loop.flush();
  failHead = false;
  await b.loop.pull();
  assert.equal(b.target.settings.get("chat.provider"), "one", "behind its head, batch 2 is not seen");
  await a.loop.pull();
  await b.loop.pull();
  assert.equal(b.target.settings.get("chat.provider"), "two", "until a's next pull moves the head");
  const repaired = headWrites;
  await a.loop.pull();
  await a.loop.pull();
  assert.equal(headWrites, repaired, "once moved, the head is not written again by every pull");
}
console.log("ok  a head that failed to move is moved again by the next pull");

// A message edited here after the copy arriving keeps the edit, and sends it.
{
  const root = tempDir("mrev");
  const a = makeDevice(root, "device-a");
  const b = makeDevice(root, "device-b");
  a.saveConversation("s1", [msg("1-0001", "card unanswered", "1-0001")]);
  await a.loop.flush();
  await b.loop.pull();
  // b answers the card; a sends the old copy again (an upgrade, a seed) under
  // a newer timestamp.
  b.saveConversation("s1", [msg("1-0001", "card answered on b", "1-0009")]);
  await b.loop.flush();
  // a's copy goes out after, so its timestamp is the newer one: only the
  // message's own edit stamp can tell that b's is the later edit.
  await new Promise((resolve) => setTimeout(resolve, 5));
  a.published.clear("chat_sessions", "s1");
  a.saveConversation("s1", [msg("1-0001", "card unanswered", "1-0001")]);
  await a.loop.flush();
  await b.loop.pull();
  assert.deepEqual(b.messages("s1"), ["card answered on b"], "the newer edit is kept");
  // ...and sent again by b on its own: the vault's newest copy is a's older one.
  await b.loop.flush();
  await a.loop.pull();
  assert.deepEqual(a.messages("s1"), ["card answered on b"], "and reaches the machine with the old copy");
}
console.log("ok  a message keeps the copy edited last, whatever was sent later");

// Keeping a newer edit sends that message again — and nothing else. Not the
// messages that arrived after it in the same pull (read back too early, the
// row lacked them and they went out as deleted), and not the row (under a
// fresh timestamp it outranked a rename made meanwhile elsewhere).
{
  const root = tempDir("kept-sends-only-the-kept");
  const a = makeDevice(root, "device-a");
  const b = makeDevice(root, "device-b");
  a.saveConversation("s1", [msg("1-0001", "card unanswered", "1-0001")]);
  await a.loop.flush();
  await b.loop.pull();
  b.saveConversation("s1", [msg("1-0001", "card answered on b", "1-0009")]);
  await b.loop.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  // a sends its old copy again, and a new message after it in the same batch.
  a.published.clear("chat_sessions", "s1");
  a.saveConversation("s1", [
    msg("1-0001", "card unanswered", "1-0001"),
    msg("1-0002", "a new question on a")
  ]);
  await a.loop.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  // ...and renames the conversation, not yet sent when b pulls.
  a.saveConversation(
    "s1",
    [msg("1-0001", "card unanswered", "1-0001"), msg("1-0002", "a new question on a")],
    "renamed on a"
  );
  await b.loop.pull();
  assert.deepEqual(b.messages("s1"), ["card answered on b", "a new question on a"]);
  await b.loop.flush();
  await a.loop.flush();
  await a.loop.pull();
  await b.loop.pull();
  assert.deepEqual(
    a.messages("s1"),
    ["card answered on b", "a new question on a"],
    "the message after the kept one is not sent as deleted"
  );
  assert.deepEqual(b.messages("s1"), ["card answered on b", "a new question on a"]);
  assert.equal(a.target.rows.get("chat_sessions:s1").title, "renamed on a");
  assert.equal(b.target.rows.get("chat_sessions:s1").title, "renamed on a", "the rename is not outranked");
}
console.log("ok  keeping a newer edit sends that message again, and nothing else");

// A migration whose raise fails records nothing of having happened.
{
  const root = tempDir("raise-fails");
  const old = makeDevice(root, "device-a", { format: 1 });
  old.saveConversation("s1", [msg("1-0001", "q")]);
  await old.loop.flush();
  const a = makeDevice(root, "device-a", {
    target: old.target,
    publishedItems: old.published,
    recordVersions: old.recordVersions,
    settings: old.settings
  });
  await assert.rejects(
    a.loop.migrateToV2({
      collect: () => stampedOf(a),
      stillNeeded: async () => true,
      raiseFormat: async () => {
        throw new Error("the identity could not be written");
      }
    }),
    /could not be written/
  );
  assert.equal(a.settings.get("sync.v2.lastSnapshot"), undefined, "no snapshot recorded as read");
  assert.equal(a.published.forRecord("chat_sessions", "s1").size, 0, "no message recorded as sent");
}
console.log("ok  a migration that could not raise the format records nothing");

// A snapshot this build cannot read is not downloaded again on every poll.
{
  const root = tempDir("unreadable-repeat");
  await new LocalFolderProvider({ root }).put(
    "snap/ffffffffffff-0000-device-a.json",
    Buffer.from("{ not a snapshot", "utf8")
  );
  const b = makeDevice(root, "device-b");
  await b.loop.pull();
  b.fetched.length = 0;
  await b.loop.pull();
  assert.deepEqual(b.fetched, [], "fetched once, not on every poll");
}
console.log("ok  an unreadable snapshot is fetched once per process");

// ===========================================================================
// A message is recorded as published only once it is safely queued
// ===========================================================================
{
  const root = tempDir("marks");
  let failing = true;
  const inner = createMemoryOutbox();
  const outbox = {
    load: () => inner.load(),
    add: (entries) => {
      if (failing) throw new Error("the queue's table could not be written");
      inner.add(entries);
    },
    remove: (entries) => inner.remove(entries)
  };
  const a = makeDevice(root, "device-a", { outbox });
  a.saveConversation("s1", [msg("1-0001", "first")]);
  assert.equal(
    a.published.forRecord("chat_sessions", "s1").size,
    0,
    "a queue that did not take the message leaves it unpublished"
  );
  failing = false;
  // The upload in this process still goes; the next save sends it again
  // rather than never — a duplicate, against a message lost.
  a.saveConversation("s1", [msg("1-0001", "first"), msg("1-0002", "second")]);
  assert.equal(a.published.forRecord("chat_sessions", "s1").size, 2);
  await a.loop.flush();
  const b = makeDevice(root, "device-b");
  await b.loop.pull();
  assert.deepEqual(b.messages("s1"), ["first", "second"]);
}
console.log("ok  a message is recorded as published only once it is queued");

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
  const rowOf = (id) =>
    database.requireDatabase().prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
  const read = () => JSON.parse(rowOf("s1").messages_json).map((m) => m.content);
  assert.deepEqual(read(), []);
  target.upsertItem("chat_sessions", "s1\u001f1-0002", msg("1-0002", "second"));
  target.upsertItem("chat_sessions", "s1\u001f1-0001", msg("1-0001", "first"));
  assert.deepEqual(read(), ["first", "second"], "in id order, whatever the arrival order");
  target.upsertItem("chat_sessions", "s1\u001f1-0001", msg("1-0001", "first, edited", "1-0099"));
  assert.deepEqual(read(), ["first, edited", "second"]);
  assert.equal(published.forRecord("chat_sessions", "s1").size, 2, "both recorded as held");
  const changes = target.takeContentChanges();
  assert.ok(changes.some((c) => c.recordId === "s1"), "and the conversation is reported changed");
  target.deleteItem("chat_sessions", "s1\u001f1-0002");
  assert.deepEqual(read(), ["first, edited"]);
  // An older edit arriving is not taken: the newer copy here stays, is no longer
  // recorded as published, and its row is handed back to be sent again.
  target.takeRepublish();
  target.upsertItem("chat_sessions", "s1\u001f1-0001", msg("1-0001", "an older copy", "1-0005"));
  assert.deepEqual(read(), ["first, edited"]);
  assert.equal(published.forRecord("chat_sessions", "s1").has("1-0001"), false);
  // A message placed after it in the same merge is in the row handed back:
  // read when it is taken, not when it was noted.
  target.upsertItem("chat_sessions", "s1\u001f1-0003", msg("1-0003", "third"));
  const handedBack = target.takeRepublish();
  assert.deepEqual(handedBack.map((r) => r.recordId), ["s1"]);
  assert.deepEqual(
    JSON.parse(handedBack[0].row.messages_json).map((m) => m.content),
    ["first, edited", "third"]
  );
  target.deleteItem("chat_sessions", "s1\u001f1-0003");
  // A record with its title moved keeps its transcript.
  target.upsertRow("chat_sessions", "s1", { ...row, title: "renamed" });
  assert.deepEqual(read(), ["first, edited"]);
  assert.equal(rowOf("s1").title, "renamed");
  // An element of a conversation not here is refused, not dropped, so a row
  // that arrives later — from the snapshot — brings it after all.
  assert.throws(
    () => target.upsertItem("chat_sessions", "gone\u001f1-0001", msg("1-0001", "orphan")),
    /no row here/
  );
  assert.equal(rowOf("gone"), undefined);
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

  // The round trip through the real chat store: messages received as items,
  // then the conversation saved as the renderer saves it — every field rebuilt,
  // its ids dropped — must send nothing back. An echo here would double every
  // message's traffic.
  const sender = chat.createChatSession("claude-code");
  chat.saveChatSession(sender.id, [
    { kind: "message", role: "user", content: "from a" },
    { kind: "message", role: "assistant", content: "an answer" }
  ]);
  const sentElements = chat.getChatSession(sender.id);
  assert.ok(sentElements.every((e) => typeof e.mid === "string"), "a's store gives every message an id");
  const receiver = chat.createChatSession("claude-code");
  const received = createMemoryPublishedItems();
  const receiving = new SqliteSyncTarget(received);
  for (const element of [...sentElements].reverse()) {
    receiving.upsertItem("chat_sessions", `${receiver.id}\u001f${element.mid}`, element);
  }
  const shown = chat.getChatSession(receiver.id).map(({ mid: _mid, mrev: _mrev, ...rest }) => rest);
  assert.deepEqual(shown.map((e) => e.content), ["from a", "an answer"]);
  chat.saveChatSession(receiver.id, shown);
  let n = 0;
  const outgoing = splitIntoItems(
    [{ hlc: "0000000000aa-0000-device-b", op: "set", scope: "table", key: "chat_sessions", recordId: receiver.id, payload: rowOf(receiver.id) }],
    (table, recordId) => received.forRecord(table, recordId),
    () => `0000000000bb-${String(++n).padStart(4, "0")}-device-b`
  );
  assert.equal(
    outgoing.entries.filter((e) => e.scope === "item").length,
    0,
    "a received message saved again by the renderer is not sent back"
  );
  // Pointed at another vault, what this machine knew of the old one's log goes.
  const db = database.requireDatabase();
  db.prepare("INSERT INTO sync_vector (device, seq, head_seq, head_revision) VALUES ('x', 9, 9, NULL)").run();
  db.prepare("INSERT INTO sync_published_items (table_name, record_id, item_id, hash) VALUES ('chat_sessions', 's', 'm', 'h')").run();
  forgetVaultLogState();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_vector").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_published_items").get().n, 0);
  database.closeDatabase();
}
console.log("ok  the SQLite target places, edits and removes a message by id; a received message is not echoed back");

await Promise.all(tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true })));
console.log("\nsync v2 tests passed");
