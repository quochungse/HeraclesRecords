// Two devices, one vault: convergence, catch-up, debounce, presence.
//
// Runs under Electron only because the merge target it exercises at the end is
// the real SQLite one. Everything before that uses map-backed fakes and an
// injected clock, so the timing rules are asserted rather than waited out.
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

const { LocalFolderProvider } = await load("sync/localFolderProvider.js");
const { ChangeBuilder } = await load("sync/syncEngine.js");
const { createMemoryRecordVersions, createSqliteRecordVersions } = await load(
  "sync/recordVersions.js"
);
const {
  SyncLoop,
  COMPACT_INTERVAL_MS,
  COMPACT_LEASE,
  SYNC_LOOP_SETTINGS,
  nextPollDelay,
  isPresenceFresh,
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  POLL_ACTIVE_WINDOW_MS,
  PRESENCE_TTL_MS,
  FLUSH_DEBOUNCE_MS,
  FLUSH_MAX_DELAY_MS
} = await load("sync/syncLoop.js");

const tempRoots = [];
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `heracles-${label}-`));
  tempRoots.push(dir);
  return dir;
}

/** A merge target backed by plain maps, so assertions read directly. */
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

/**
 * A device: its own clock, its own timers, its own view of the shared vault.
 *
 * `recordVersions` is passed in when a block means "the same machine, relaunched"
 * — the real store is a table, so a restart keeps every stamp. Left out, the
 * device starts with none, which is a fresh install or a machine upgrading into
 * the store for the first time.
 */
function makeDevice(
  root,
  id,
  { wallOffset = 0, online = true, recordVersions = createMemoryRecordVersions() } = {}
) {
  const settings = new Map();
  const target = fakeTarget();
  const timers = new Map();
  let nextHandle = 1;
  const state = { wall: 1_700_000_000_000, online, appActive: true };

  const loop = new SyncLoop({
    provider: () => new LocalFolderProvider({ root }),
    target,
    deviceId: () => id,
    deviceName: () => `machine-${id}`,
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => settings.set(key, value),
    now: () => state.wall + wallOffset,
    setTimer: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { fn, at: state.wall + ms });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
    conditions: () => ({ appActive: state.appActive, online: state.online }),
    recordVersions
  });

  return {
    id,
    loop,
    target,
    recordVersions,
    settings,
    state,
    /** Advance this device's clock and fire whatever came due. */
    async advance(ms) {
      state.wall += ms;
      const due = [...timers.entries()].filter(([, t]) => t.at <= state.wall);
      for (const [handle, timer] of due) {
        timers.delete(handle);
        timer.fn();
      }
      // Wait for whatever those timers started, rather than guessing how many
      // microtask ticks a filesystem write needs.
      await loop.whenIdle();
    },
    pendingTimers: () => timers.size,
    builder: () =>
      new ChangeBuilder({ nextHlc: loop.nextHlc }),
    /**
     * A local write, as the app actually makes one.
     *
     * The row lands in this device's own store *first*, and the oplog entry is
     * built from it afterwards (`notifySyncedRow`). The entry is a notification
     * about a write that already happened, never the write itself — which is
     * exactly why a pull must never apply this device's own entries back, and
     * why a device's own state has to be put here rather than arriving through
     * its target on the next pull.
     */
    write(fill) {
      const builder = new ChangeBuilder({ nextHlc: loop.nextHlc });
      fill(builder);
      for (const entry of builder.entries) applyLocally(target, entry);
      loop.enqueue(builder.entries);
      return builder.entries;
    }
  };
}

/** What a local write does to this device's own store, before any sync. */
function applyLocally(target, entry) {
  // Mirrors `stringValue` in syncEngine: a scalar travels under `value`.
  const scalar = () => {
    const value = entry.payload?.value;
    return typeof value === "string" ? value : JSON.stringify(value ?? null);
  };
  const remove = entry.op === "delete";
  switch (entry.scope) {
    case "table":
      if (remove) target.deleteRow(entry.key, entry.recordId);
      else target.upsertRow(entry.key, entry.recordId, entry.payload ?? {});
      return;
    case "setting":
      if (remove) target.deleteSetting(entry.key);
      else target.setSetting(entry.key, scalar());
      return;
    case "localStorage":
      if (remove) target.deleteLocalStorage(entry.key);
      else target.setLocalStorage(entry.key, scalar());
  }
}

// ===========================================================================
// The cadence rules, as pure arithmetic
// ===========================================================================

{
  const base = { now: 1000, online: true, appActive: true };

  assert.equal(
    nextPollDelay({ ...base, lastActivityAt: null }),
    POLL_IDLE_MS,
    "with nothing ever seen, poll slowly"
  );
  assert.equal(
    nextPollDelay({ ...base, now: 10_000, lastActivityAt: 9_000 }),
    POLL_ACTIVE_MS,
    "just after a change, poll quickly"
  );
  assert.equal(
    nextPollDelay({
      ...base,
      now: POLL_ACTIVE_WINDOW_MS + 10_000,
      lastActivityAt: 0
    }),
    POLL_IDLE_MS,
    "once activity has gone quiet, back off"
  );
  // Offline backs off rather than stopping. Returning null here used to leave
  // the loop waiting for a `resume()` that the main process has no
  // network-returned event to call, so one moment of net.isOnline() being false
  // stopped this device pulling until the app was restarted. An offline tick
  // does no network work — flush returns early and pull is skipped — so a slow
  // timer costs nothing and the loop heals itself when the link is back.
  assert.equal(
    nextPollDelay({ ...base, lastActivityAt: 900, online: false }),
    POLL_IDLE_MS,
    "offline polls slowly rather than stopping dead"
  );
  assert.equal(
    nextPollDelay({ ...base, lastActivityAt: 900, appActive: false }),
    null,
    "a hidden window means do not schedule either — waking a sleeping laptop " +
      "to poll is pure battery drain"
  );
  assert.ok(
    POLL_ACTIVE_MS < POLL_IDLE_MS,
    "the active cadence must actually be faster than the idle one"
  );
}

// Presence claims expire.
{
  const claim = { deviceId: "a", deviceName: "A", at: 1000, activeSessionId: null };
  assert.equal(isPresenceFresh(claim, 1000), true);
  assert.equal(isPresenceFresh(claim, 1000 + PRESENCE_TTL_MS), true);
  assert.equal(
    isPresenceFresh(claim, 1000 + PRESENCE_TTL_MS + 1),
    false,
    "a claim older than the TTL must stop counting"
  );
}

// ===========================================================================
// Debounce: many edits, one upload
// ===========================================================================

{
  const root = tempDir("debounce");
  const device = makeDevice(root, "aaaaaaaaaaaaaaaa");
  device.loop.start();

  // Ten edits in quick succession, as a burst of typing would produce.
  for (let i = 0; i < 10; i += 1) {
    const builder = device.builder();
    builder.setting("chat.provider", `provider-${i}`);
    device.loop.enqueue(builder.entries);
    await device.advance(100);
  }

  assert.equal(
    device.loop.pendingCount,
    10,
    "the burst is still queued, not yet uploaded"
  );
  const provider = new LocalFolderProvider({ root });
  assert.equal(
    (await provider.list("oplog")).length,
    0,
    "and nothing has been written while edits keep arriving"
  );

  await device.advance(FLUSH_DEBOUNCE_MS + 100);
  assert.equal(device.loop.pendingCount, 0, "the quiet period flushes the queue");
  assert.equal(
    (await provider.list("oplog")).length,
    1,
    "ten edits became one upload, not ten"
  );
}

// A steady trickle cannot postpone the flush forever.
{
  const root = tempDir("ceiling");
  const device = makeDevice(root, "bbbbbbbbbbbbbbbb");
  device.loop.start();

  const provider = new LocalFolderProvider({ root });
  // Keep editing just inside the debounce window, past the ceiling.
  for (let elapsed = 0; elapsed < FLUSH_MAX_DELAY_MS + 5_000; elapsed += 1_000) {
    const builder = device.builder();
    builder.setting("chat.model", `model-${elapsed}`);
    device.loop.enqueue(builder.entries);
    await device.advance(1_000);
  }

  assert.ok(
    (await provider.list("oplog")).length > 0,
    "a continuous trickle must still reach the vault, not queue indefinitely"
  );
}

// ===========================================================================
// Offline: queue, keep, flush later
// ===========================================================================

{
  const root = tempDir("offline");
  const device = makeDevice(root, "cccccccccccccccc", { online: false });
  device.loop.start();

  // An offline loop keeps a poll armed. It used to schedule nothing, waiting
  // for a `resume()` nothing in the app ever called, so a device that was
  // offline for one tick never pulled again until the app restarted.
  assert.equal(
    device.pendingTimers(),
    1,
    "an offline loop keeps polling slowly, so it recovers on its own"
  );

  const builder = device.builder();
  builder.setting("chat.provider", "written-while-offline");
  device.loop.enqueue(builder.entries);

  await device.advance(FLUSH_DEBOUNCE_MS + 100);
  assert.equal(
    device.loop.pendingCount,
    1,
    "an offline flush keeps the work instead of dropping it"
  );

  device.state.online = true;
  device.loop.resume();
  await device.loop.flush();

  assert.equal(device.loop.pendingCount, 0, "and it goes out once online");
  const provider = new LocalFolderProvider({ root });
  assert.equal((await provider.list("oplog")).length, 1);
}

// ===========================================================================
// Quitting: what is queued still gets out
// ===========================================================================
//
// The window a change spends on the debounce is the window an app closed in
// the same breath loses it in, and losing it is not merely "the other machine
// is behind": the merge writes the vault's winner into SQLite without asking
// what the row currently holds, so the next launch pulls a foreign copy of
// that record straight over the local one.
{
  const root = tempDir("quit-flush");
  const device = makeDevice(root, "1111111111111111");
  device.loop.start();

  assert.equal(
    device.loop.hasUnpushedChanges,
    false,
    "an idle loop has nothing to hold quit up for"
  );
  // The fast path has to stay honest: with nothing queued this is the whole
  // cost of the check, and quit pays no more than it did before.
  await device.loop.flushBeforeQuit();
  assert.equal((await new LocalFolderProvider({ root }).list("oplog")).length, 0);

  device.write((builder) => {
    builder.setting("chat.provider", "written just before quit");
  });
  assert.equal(
    device.loop.hasUnpushedChanges,
    true,
    "a change still on the debounce is a change the vault has no copy of"
  );

  // Quit, without ever letting the debounce elapse.
  await device.loop.flushBeforeQuit();
  assert.equal(device.loop.pendingCount, 0, "the queue went out on the way out");

  const reader = makeDevice(root, "2222222222222222");
  await reader.loop.pull();
  assert.equal(
    reader.target.settings.get("chat.provider"),
    "written just before quit",
    "and another device can read it"
  );
}

// Offline, quit must not hang: one attempt, the queue kept, no waiting.
{
  const root = tempDir("quit-offline");
  const device = makeDevice(root, "3333333333333333", { online: false });
  device.write((builder) => {
    builder.setting("chat.provider", "no link");
  });

  await device.loop.flushBeforeQuit();
  assert.equal(
    device.loop.pendingCount,
    1,
    "an offline quit keeps the work rather than dropping it, and returns at once"
  );
  assert.equal((await new LocalFolderProvider({ root }).list("oplog")).length, 0);
}

// An upload already in the air counts as unpushed, and quit waits for it.
// `flush` takes the queue before it awaits, so between those two moments
// `pendingCount` is zero and that batch exists nowhere else.
{
  const root = tempDir("quit-inflight");
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const inner = new LocalFolderProvider({ root });
  const slow = new SyncLoop({
    provider: () => ({
      name: "slow",
      list: (prefix) => inner.list(prefix),
      get: (path) => inner.get(path),
      put: async (path, body) => {
        await held;
        return inner.put(path, body);
      },
      remove: (path) => inner.remove(path)
    }),
    target: fakeTarget(),
    deviceId: () => "4444444444444444",
    deviceName: () => "slow",
    recordVersions: createMemoryRecordVersions(),
    getSetting: () => undefined,
    setSetting: () => {},
    now: () => 1_700_000_000_000,
    setTimer: () => 1,
    clearTimer: () => {},
    conditions: () => ({ appActive: true, online: true })
  });

  const builder = new ChangeBuilder({ nextHlc: slow.nextHlc });
  builder.setting("chat.provider", "mid-upload");
  slow.enqueue(builder.entries);

  const flushing = slow.flush();
  await Promise.resolve();
  assert.equal(slow.pendingCount, 0, "the queue is taken before the await");
  assert.equal(
    slow.hasUnpushedChanges,
    true,
    "but the batch is still this device's only copy, so quit must wait for it"
  );

  const quitting = slow.flushBeforeQuit();
  release();
  await Promise.all([flushing, quitting]);
  assert.equal(
    slow.hasUnpushedChanges,
    false,
    "and once the upload lands there is nothing left to wait for"
  );
  assert.equal((await inner.list("oplog")).length, 1);
}

// A failed write puts the entries back rather than losing them.
{
  const root = tempDir("failing");
  const device = makeDevice(root, "dddddddddddddddd");
  const errors = [];

  const failing = new SyncLoop({
    provider: () => ({
      name: "broken",
      list: async () => [],
      get: async () => null,
      put: async () => {
        throw new Error("network went away mid-upload");
      },
      delete: async () => {},
      pollChanges: async () => ({ changes: [], nextCursor: "" })
    }),
    target: fakeTarget(),
    deviceId: () => "dddddddddddddddd",
    deviceName: () => "d",
    recordVersions: createMemoryRecordVersions(),
    getSetting: () => undefined,
    setSetting: () => {},
    now: () => 1_700_000_000_000,
    setTimer: () => 1,
    clearTimer: () => {},
    conditions: () => ({ appActive: true, online: true }),
    onError: (error) => errors.push(error)
  });

  const builder = new ChangeBuilder({ nextHlc: failing.nextHlc });
  builder.setting("chat.provider", "precious");
  failing.enqueue(builder.entries);

  const result = await failing.flush();
  assert.equal(result.pushed, 0, "a failed push reports nothing pushed");
  assert.equal(
    failing.pendingCount,
    1,
    "and the entry is back in the queue, not lost"
  );
  assert.equal(errors.length, 1, "the failure is surfaced to the caller");
  void device;
}

// ===========================================================================
// Two devices converge
// ===========================================================================

{
  const root = tempDir("converge");
  // B's wall clock runs four minutes behind A's, which is the case a naive
  // last-write-wins on Date.now() gets wrong.
  const a = makeDevice(root, "aaaaaaaaaaaaaaaa");
  const b = makeDevice(root, "bbbbbbbbbbbbbbbb", { wallOffset: -4 * 60 * 1000 });

  a.write((builder) => {
    builder.row("chat_sessions", "s1", { id: "s1", title: "from A" });
    builder.setting("chat.provider", "claude-code");
  });
  await a.loop.flush();

  // B catches up, then edits the same record afterwards.
  await b.loop.pull();
  assert.equal(
    b.target.rows.get("chat_sessions:s1").title,
    "from A",
    "B receives what A wrote"
  );

  b.write((builder) => {
    builder.row("chat_sessions", "s1", { id: "s1", title: "from B, later" });
    builder.row("chat_sessions", "s2", { id: "s2", title: "B only" });
  });
  await b.loop.flush();

  await a.loop.pull();
  await b.loop.pull();

  assert.equal(
    a.target.rows.get("chat_sessions:s1").title,
    "from B, later",
    "B's later edit wins on A despite B's slower wall clock"
  );
  assert.deepEqual(
    [...a.target.rows.entries()].sort(),
    [...b.target.rows.entries()].sort(),
    "both devices end up holding exactly the same state"
  );
  assert.equal(a.target.settings.get("chat.provider"), "claude-code");
  assert.equal(a.target.rows.get("chat_sessions:s2").title, "B only");
}

// A device that was away for a while catches up in one pull.
{
  const root = tempDir("catchup");
  const a = makeDevice(root, "aaaaaaaaaaaaaaaa");
  const away = makeDevice(root, "eeeeeeeeeeeeeeee");

  for (let i = 0; i < 5; i += 1) {
    const builder = a.builder();
    builder.row("chat_sessions", `s${i}`, { id: `s${i}`, title: `session ${i}` });
    a.loop.enqueue(builder.entries);
    await a.loop.flush();
    await a.advance(1000);
  }

  const result = await away.loop.pull();
  assert.equal(result.applied, 5, "everything missed arrives at once");
  assert.equal(away.target.rows.size, 5);
  assert.deepEqual(result.rejected, [], "and nothing is refused on the way in");

  // A deletion made while it was away must stick, not be undone by the replay.
  const remove = a.builder();
  remove.deleteRow("chat_sessions", "s0");
  a.loop.enqueue(remove.entries);
  await a.loop.flush();

  await away.loop.pull();
  assert.equal(
    away.target.rows.has("chat_sessions:s0"),
    false,
    "a deletion made while away still applies"
  );
}

// ===========================================================================
// Presence
// ===========================================================================

{
  const root = tempDir("presence");
  const a = makeDevice(root, "aaaaaaaaaaaaaaaa");
  const b = makeDevice(root, "bbbbbbbbbbbbbbbb");

  assert.deepEqual(await b.loop.otherDevices(), [], "nobody has announced yet");

  await a.loop.announce("session-42");
  const seen = await b.loop.otherDevices();
  assert.equal(seen.length, 1, "B sees A");
  assert.equal(seen[0].deviceId, "aaaaaaaaaaaaaaaa");
  assert.equal(
    seen[0].activeSessionId,
    "session-42",
    "and knows which session A is generating into"
  );

  assert.deepEqual(
    await a.loop.otherDevices(),
    [],
    "a device never reports itself as another device"
  );

  // Once the claim goes stale it stops counting, without anyone deleting it.
  b.state.wall += PRESENCE_TTL_MS + 1000;
  assert.deepEqual(
    await b.loop.otherDevices(),
    [],
    "a stale claim is ignored rather than trusted"
  );

  // A device that comes back refreshes its own claim.
  await a.loop.announce(null);
  b.state.wall = a.state.wall;
  const refreshed = await b.loop.otherDevices();
  assert.equal(refreshed.length, 1, "and a renewed claim counts again");
  assert.equal(refreshed[0].activeSessionId, null);
}

// ===========================================================================
// The loop schedules itself
// ===========================================================================

{
  const root = tempDir("loop");
  const device = makeDevice(root, "ffffffffffffffff");

  assert.equal(device.pendingTimers(), 0, "a stopped loop schedules nothing");
  device.loop.start();
  assert.equal(device.pendingTimers(), 1, "starting arms a poll");

  await device.advance(POLL_IDLE_MS + 100);
  assert.equal(device.pendingTimers(), 1, "and it re-arms after each round");

  device.loop.stop();
  assert.equal(device.pendingTimers(), 0, "stopping clears the timers");

  // A hidden window schedules nothing at all.
  device.state.appActive = false;
  device.loop.start();
  assert.equal(
    device.pendingTimers(),
    0,
    "a hidden window must not keep waking the machine"
  );
  device.state.appActive = true;
  device.loop.resume();
  assert.equal(device.pendingTimers(), 1, "and showing it starts polling again");
  device.loop.stop();
}

// ===========================================================================
// Compaction: gated by interval, held by a lease
// ===========================================================================

{
  const root = tempDir("compact-loop");
  const device = makeDevice(root, "1111111111111111");

  // A fresh vault has nothing worth compacting, but the attempt is what stamps
  // the clock — so the interval starts running from the first look. `null` means
  // "did not run"; a result with no snapshotPath means "ran, found nothing".
  const first = await device.loop.compactIfDue();
  assert.equal(first.snapshotPath, null, "an empty log folds to nothing");
  assert.equal(first.batchesDeleted, 0, "and deletes nothing");
  const stamped = device.settings.get(SYNC_LOOP_SETTINGS.lastCompactedAt);
  assert.ok(stamped, "the attempt is recorded even when it found nothing to do");

  // Straight away again: refused without touching the vault at all. Compaction
  // reads the whole log, so trying on every poll would cost more than the
  // growth it exists to stop.
  const provider = new LocalFolderProvider({ root });
  await provider.put(
    "oplog/2222222222222222/probe.jsonl",
    Buffer.from("{}\n", "utf8")
  );
  assert.equal(
    await device.loop.compactIfDue(),
    null,
    "a second pass inside the interval is refused"
  );
  assert.equal(
    device.settings.get(SYNC_LOOP_SETTINGS.lastCompactedAt),
    stamped,
    "and it does not even restamp the clock"
  );

  // Past the interval it looks again.
  device.state.wall += COMPACT_INTERVAL_MS + 1000;
  await device.loop.compactIfDue();
  assert.notEqual(
    device.settings.get(SYNC_LOOP_SETTINGS.lastCompactedAt),
    stamped,
    "once the interval has passed it tries again"
  );
}

// Only one device compacts. The second stands down rather than doing the same
// whole-log read for the same result.
{
  const root = tempDir("compact-lease");
  const first = makeDevice(root, "3333333333333333");
  const second = makeDevice(root, "4444444444444444");

  // A live lease held by someone else.
  const provider = new LocalFolderProvider({ root });
  await provider.put(
    `lease/${COMPACT_LEASE}.json`,
    Buffer.from(
      JSON.stringify({
        holder: "9999999999999999",
        acquiredAt: first.state.wall,
        expiresAt: first.state.wall + 10 * 60 * 1000,
        fencingToken: 1
      }),
      "utf8"
    )
  );

  assert.equal(
    await first.loop.compactIfDue(),
    null,
    "a device that cannot take the lease does not compact"
  );
  assert.equal(
    await second.loop.compactIfDue(),
    null,
    "and neither does the next one"
  );
  const held = JSON.parse(
    (await provider.get(`lease/${COMPACT_LEASE}.json`)).content.toString("utf8")
  );
  assert.equal(held.holder, "9999999999999999", "the holder keeps its lease");
}

// A failure is housekeeping's problem, never the caller's: a vault that refuses
// compaction stays correct, only larger.
{
  const errors = [];
  const settings = new Map();
  const loop = new SyncLoop({
    provider: () => ({
      get: async () => {
        throw new Error("drive offline");
      },
      put: async () => {
        throw new Error("drive offline");
      },
      delete: async () => {},
      list: async () => {
        throw new Error("drive offline");
      }
    }),
    target: fakeTarget(),
    deviceId: () => "5555555555555555",
    deviceName: () => "machine",
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => settings.set(key, value),
    now: () => 1_700_000_000_000,
    setTimer: () => 1,
    clearTimer: () => {},
    conditions: () => ({ appActive: true, online: true }),
    onError: (error) => errors.push(error)
  });

  assert.equal(
    await loop.compactIfDue(),
    null,
    "an unreachable vault does not throw out of compaction"
  );
  assert.equal(errors.length, 1, "it is reported instead");
}

// ===========================================================================
// Against the real database
// ===========================================================================

const database = await load("database.js");
database.initializeDatabase(tempDir("db"));
const { SqliteSyncTarget } = await load("sync/sqliteSyncTarget.js");

{
  const db = database.requireDatabase();
  const root = tempDir("sqlite-twoway");
  const remote = makeDevice(root, "aaaaaaaaaaaaaaaa");

  const builder = remote.builder();
  builder.row("chat_sessions", "real", {
    id: "real",
    provider: "claude-code",
    title: "Written on another machine",
    messages_json: "[]",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z"
  });
  builder.setting("chat.model", "claude-opus-5");
  remote.loop.enqueue(builder.entries);
  await remote.loop.flush();

  const local = makeDevice(root, "bbbbbbbbbbbbbbbb");
  local.loop.target = undefined; // replaced below by the real target
  const sqliteLoop = new SyncLoop({
    provider: () => new LocalFolderProvider({ root }),
    target: new SqliteSyncTarget(),
    deviceId: () => "bbbbbbbbbbbbbbbb",
    deviceName: () => "local",
    getSetting: database.getSetting,
    setSetting: database.setSetting,
    now: () => Date.now(),
    setTimer: () => 1,
    clearTimer: () => {},
    conditions: () => ({ appActive: true, online: true }),
    recordVersions: createMemoryRecordVersions()
  });

  const result = await sqliteLoop.pull();
  assert.equal(result.applied, 2, "both entries land in the real database");
  assert.equal(
    db.prepare("SELECT title FROM chat_sessions WHERE id = ?").get("real").title,
    "Written on another machine"
  );
  assert.equal(database.getSetting("chat.model"), "claude-opus-5");
  assert.equal(
    database.getSetting("sync.lastPulledAt") !== undefined,
    true,
    "and the pull records when it happened"
  );
}

// ===========================================================================
// A pull never writes back what this device itself wrote
// ===========================================================================
//
// `applyEntries` resolves entries against each other and never against what the
// database currently holds — SQLite stores no HLC per row, and the target is an
// unconditional INSERT OR REPLACE. The only thing that kept a device's own
// entries from landing on top of its own newer rows was `#merged`, which lives
// in memory and is therefore empty on the first pull after every launch.
//
// A pull is a full read of the log over the network and takes as long as the
// link does. A headless analysis run finished 18 seconds into one, wrote its
// answer into the conversation and moved its activity watermark; the pull then
// landed carrying the pre-run copy of both rows and put them back. The answer
// the athlete had watched arrive was gone, and the restored watermark had the
// next poll re-analyse the same activity — so reopening the app showed a
// different answer to the one that was lost.

{
  const root = tempDir("own-entries");
  const mine = "cccccccccccccccc";

  // What this device published earlier: the conversation as it was before the
  // run, plus an analysis whose watermark has not moved yet.
  const publisher = makeDevice(root, mine);
  const published = publisher.builder();
  published.row("chat_sessions", "s1", {
    id: "s1",
    provider: "claude-code",
    title: "FM Trainer",
    messages_json: JSON.stringify([{ kind: "message", role: "user", content: "hi" }]),
    created_at: "2026-09-14T01:00:00Z",
    updated_at: "2026-09-14T01:00:00Z"
  });
  published.row("coach_analyses", "a1", {
    id: "a1",
    session_id: "s1",
    name: "Post-activity debrief",
    playbook: "…",
    enabled: 1,
    last_activity_at: null,
    created_at: "2026-09-14T01:00:00Z",
    updated_at: "2026-09-14T01:00:00Z"
  });
  publisher.loop.enqueue(published.entries);
  await publisher.loop.flush();

  // The same device, relaunched: a new loop, and the stamps it kept. That is
  // what a restart really looks like — `sync_record_versions` is a table — and
  // it is the half the in-memory note of "already merged" could never do, so
  // the whole log used to be re-merged on every first pull.
  const relaunched = makeDevice(root, mine, {
    recordVersions: publisher.recordVersions
  });
  const first = await relaunched.loop.pull();
  assert.equal(
    first.applied,
    0,
    "what this device already holds is not written back, relaunch or not"
  );
  assert.equal(
    relaunched.target.rows.has("chat_sessions:s1"),
    false,
    "and nothing reaches the target for them"
  );

  // Another machine's entry still lands, whichever side of this device's own
  // timestamps it sits on. Newer wins and is applied…
  const newer = makeDevice(root, "dddddddddddddddd", { wallOffset: 60_000 });
  const newerBuilder = newer.builder();
  newerBuilder.row("chat_sessions", "s1", {
    id: "s1",
    provider: "claude-code",
    title: "Renamed over there",
    messages_json: "[]",
    created_at: "2026-09-14T01:00:00Z",
    updated_at: "2026-09-14T01:30:00Z"
  });
  newer.loop.enqueue(newerBuilder.entries);
  await newer.loop.flush();

  await relaunched.loop.pull();
  assert.equal(
    relaunched.target.rows.get("chat_sessions:s1")?.title,
    "Renamed over there",
    "a foreign entry newer than this device's own still merges"
  );

  // …and older loses. Own entries still take part in last-writer-wins — drop
  // them from `resolve()` and this stale one would win its key outright — they
  // are simply never *applied* over something the machine already holds.
  const older = makeDevice(root, "eeeeeeeeeeeeeeee", { wallOffset: -3_600_000 });
  const olderBuilder = older.builder();
  olderBuilder.row("chat_sessions", "s1", {
    id: "s1",
    provider: "claude-code",
    title: "Stale copy from a laptop that was asleep",
    messages_json: "[]",
    created_at: "2026-09-14T01:00:00Z",
    updated_at: "2026-09-13T00:00:00Z"
  });
  older.loop.enqueue(olderBuilder.entries);
  await older.loop.flush();

  await relaunched.loop.pull();
  assert.equal(
    relaunched.target.rows.get("chat_sessions:s1")?.title,
    "Renamed over there",
    "an entry older than what this device already holds must not be applied"
  );
}

// The incident, against the real database and in the shape it actually
// happened: a pull whose read of the log began *before* a local write cannot
// see that write, so its winner is an older copy — and applying that copy is
// what cost an athlete a coach's answer. Measured on the real vault: 96 entries
// in the log, 93 in SQLite, byte for byte the other machine's two-day-old row,
// with the run recorded as a success.
{
  const db = database.requireDatabase();
  const root = tempDir("stale-pull-sqlite");
  const mine = "ffffffffffffffff";

  const beforeRun = JSON.stringify([
    { kind: "message", role: "user", content: "before the run" }
  ]);
  const afterRun = JSON.stringify([
    { kind: "message", role: "user", content: "before the run" },
    { kind: "message", role: "user", content: "A new activity synced." },
    { kind: "message", role: "assistant", content: "Heart rate ran high." }
  ]);
  const writeRow = (messagesJson, updatedAt) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO chat_sessions
           (id, provider, title, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "incident",
        "claude-code",
        "FM Trainer",
        messagesJson,
        "2026-09-14T01:00:00Z",
        updatedAt
      );

  // The only copy the vault holds, published by the other machine two days ago.
  const remote = makeDevice(root, "dddddddddddddddd");
  const remoteBuilder = remote.builder();
  remoteBuilder.row("chat_sessions", "incident", {
    id: "incident",
    provider: "claude-code",
    title: "FM Trainer",
    messages_json: beforeRun,
    created_at: "2026-09-14T01:00:00Z",
    updated_at: "2026-09-14T04:04:40Z"
  });
  remote.loop.enqueue(remoteBuilder.entries);
  await remote.loop.flush();
  writeRow(beforeRun, "2026-09-14T04:04:40Z");

  // A read of the whole log over a link that takes as long as it takes. The
  // gate holds it open across the write below, which is the entire point: a
  // pull acts on the log as it was when it started.
  let openTheLink = () => {};
  const held = new Promise((resolve) => {
    openTheLink = resolve;
  });
  const inner = new LocalFolderProvider({ root });
  const versions = createSqliteRecordVersions();
  const loop = new SyncLoop({
    provider: () => ({
      name: "slow-link",
      list: (prefix) => inner.list(prefix),
      get: async (path) => {
        await held;
        return inner.get(path);
      },
      put: (path, body) => inner.put(path, body),
      remove: (path) => inner.remove(path)
    }),
    target: new SqliteSyncTarget(),
    deviceId: () => mine,
    deviceName: () => "local",
    getSetting: database.getSetting,
    setSetting: database.setSetting,
    now: () => Date.now(),
    setTimer: () => 1,
    clearTimer: () => {},
    conditions: () => ({ appActive: true, online: true }),
    recordVersions: versions
  });

  const pulling = loop.pull();

  // The analysis run finishes inside that read. This is the write path the app
  // takes: the row lands in SQLite and the bridge hands the loop the entry it
  // built by reading that row back.
  writeRow(afterRun, "2026-09-16T01:51:14Z");
  const local = new ChangeBuilder({ nextHlc: loop.nextHlc });
  local.row("chat_sessions", "incident", {
    id: "incident",
    provider: "claude-code",
    title: "FM Trainer",
    messages_json: afterRun,
    created_at: "2026-09-14T01:00:00Z",
    updated_at: "2026-09-16T01:51:14Z"
  });
  loop.enqueue(local.entries);

  openTheLink();
  await pulling;

  assert.equal(
    db.prepare("SELECT messages_json FROM chat_sessions WHERE id = ?").get("incident")
      .messages_json,
    afterRun,
    "a pull must not apply an entry older than the row it would overwrite"
  );

  // The other half, and the reason the old guard could not simply be widened:
  // once a row has been rewound, the good copy is in the vault under *this*
  // device's own timestamp. A rule that skipped own entries could never put it
  // back, so the loss was permanent. An empty watermark — a fresh install, or a
  // machine upgrading into this file — reads as "unknown" and merges it.
  await loop.flush();
  writeRow(beforeRun, "2026-09-14T04:04:40Z");
  const repaired = new SyncLoop({
    provider: () => new LocalFolderProvider({ root }),
    target: new SqliteSyncTarget(),
    deviceId: () => mine,
    deviceName: () => "local",
    getSetting: database.getSetting,
    setSetting: database.setSetting,
    now: () => Date.now(),
    setTimer: () => 1,
    clearTimer: () => {},
    conditions: () => ({ appActive: true, online: true }),
    recordVersions: createMemoryRecordVersions()
  });
  await repaired.pull();

  assert.equal(
    db.prepare("SELECT messages_json FROM chat_sessions WHERE id = ?").get("incident")
      .messages_json,
    afterRun,
    "a rewound row is repaired from the vault's newer copy, own entry or not"
  );

  // And the stamp is durable, so the next launch does not re-merge the log —
  // which is what made the race live on every first pull.
  assert.ok(
    createSqliteRecordVersions().get("table:chat_sessions:incident"),
    "the merge records what the row now holds, across processes"
  );
}

await Promise.all(
  tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true }))
);

console.log(
  "sync two-way OK — debounce batches bursts, offline queue survives, " +
    "devices converge across clock skew, presence expires, SQLite pull lands, " +
    "a stale pull never overwrites a newer local row and a rewound one is " +
    "repaired from the vault, " +
    "quit flushes what is queued and skips the wait when nothing is, " +
    "compaction is interval-gated and one device at a time"
);
