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

/** A device: its own clock, its own timers, its own view of the shared vault. */
function makeDevice(root, id, { wallOffset = 0, online = true } = {}) {
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
    conditions: () => ({ appActive: state.appActive, online: state.online })
  });

  return {
    id,
    loop,
    target,
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
      new ChangeBuilder({ nextHlc: loop.nextHlc })
  };
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

  const fromA = a.builder();
  fromA.row("chat_sessions", "s1", { id: "s1", title: "from A" });
  fromA.setting("chat.provider", "claude-code");
  a.loop.enqueue(fromA.entries);
  await a.loop.flush();

  // B catches up, then edits the same record afterwards.
  await b.loop.pull();
  assert.equal(
    b.target.rows.get("chat_sessions:s1").title,
    "from A",
    "B receives what A wrote"
  );

  const fromB = b.builder();
  fromB.row("chat_sessions", "s1", { id: "s1", title: "from B, later" });
  fromB.row("chat_sessions", "s2", { id: "s2", title: "B only" });
  b.loop.enqueue(fromB.entries);
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
    conditions: () => ({ appActive: true, online: true })
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

await Promise.all(
  tempRoots.map((root) => fsp.rm(root, { recursive: true, force: true }))
);

console.log(
  "sync two-way OK — debounce batches bursts, offline queue survives, " +
    "devices converge across clock skew, presence expires, SQLite pull lands, " +
    "compaction is interval-gated and one device at a time"
);
