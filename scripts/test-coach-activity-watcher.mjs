import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const repoRoot = path.resolve(import.meta.dirname, "..");

// The watcher reaches trainingHubService and the runner, which pull in electron
// and the better-sqlite3 native attachment at require time. Every collaborator is
// injected per instance, so the stubs only exist to get the module loaded.
const fakeElectron = {
  BrowserWindow: Object.assign(class {}, { getAllWindows: () => [] }),
  app: { getPath: () => "/tmp", on: () => {}, whenReady: () => Promise.resolve() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: () => {} },
  net: { request: () => {} },
  session: { defaultSession: {} }
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === "electron") return fakeElectron;
  if (request === "better-sqlite3") return class FakeDatabase {};
  return originalLoad.call(this, request, ...rest);
};

const {
  ACTIVITY_LOOKBACK_DAYS,
  ACTIVITY_POLL_INTERVAL_MS,
  CoachActivityWatcher,
  activityMatchesTrigger
} = require(path.join(repoRoot, "dist-electron", "coachActivityWatcher.js"));

assert.equal(ACTIVITY_POLL_INTERVAL_MS, 15 * 60_000, "3.2: default poll is 15 minutes");
assert.equal(ACTIVITY_LOOKBACK_DAYS, 7);

// ---------------------------------------------------------------------------
// Matching (3.2 step 3)
// ---------------------------------------------------------------------------

// Inside the watcher's 7-day lookback from the world clock below.
const NOW_EPOCH = Math.floor(Date.parse("2026-08-21T09:00:00.000Z") / 1000);

const activity = (patch = {}) => ({
  activity_id: "act-1",
  name: "Morning run",
  sport_type: 100,
  sport_name: "Run",
  start_time: NOW_EPOCH - 3600,
  duration: 3600,
  distance: 12000,
  ...patch
});

/** One analysis: what it watches, and the conversation it speaks into. */
const activityAnalysis = (trigger = {}, patch = {}) => ({
  id: "a1",
  sessionId: "s1",
  name: "Debrief",
  playbook: "Debrief {{activity.name}}.",
  enabled: true,
  trigger: { kind: "activity", sportTypes: [], ...trigger },
  conditions: { cooldownMin: 0, maxRunsPerDay: 9 },
  runtime: {},
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...patch
});

// An empty sportTypes means every sport.
assert.equal(activityMatchesTrigger(activity(), activityAnalysis().trigger), true);
assert.equal(
  activityMatchesTrigger(activity(), activityAnalysis({ sportTypes: [100, 101] }).trigger),
  true
);
assert.equal(
  activityMatchesTrigger(activity({ sport_type: 200 }), activityAnalysis({ sportTypes: [100] }).trigger),
  false
);
assert.equal(
  activityMatchesTrigger(activity({ duration: 600 }), activityAnalysis({ minDurationSec: 3600 }).trigger),
  false
);
assert.equal(
  activityMatchesTrigger(activity({ duration: 3600 }), activityAnalysis({ minDurationSec: 3600 }).trigger),
  true
);
assert.equal(
  activityMatchesTrigger(activity({ distance: 5000 }), activityAnalysis({ minDistanceM: 10000 }).trigger),
  false
);
// A missing metric fails a floor rather than passing it by accident.
assert.equal(
  activityMatchesTrigger(activity({ duration: null }), activityAnalysis({ minDurationSec: 1 }).trigger),
  false
);
assert.equal(
  activityMatchesTrigger(activity({ distance: null }), activityAnalysis({ minDistanceM: 1 }).trigger),
  false
);
// Only "activity" triggers ever match here.
assert.equal(
  activityMatchesTrigger(
    activity(),
    activityAnalysis({}, { trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:00" } })
  ),
  false
);

// ---------------------------------------------------------------------------
// A world to drive the watcher against
// ---------------------------------------------------------------------------

function createWorld(overrides = {}) {
  const state = {
    now: new Date("2026-08-21T09:00:00.000Z"),
    rows: new Map(), // activity_id -> { row, seen: boolean }
    analyses: [],
    settings: new Map(),
    authenticated: true,
    refreshes: [],
    triggers: [],
    errors: [],
    /** 3.3's local cache: every snapshot asked for, and what landed. */
    sampleReads: [],
    sampleWrites: [],
    sampleRows: [{ day: "20260821", resting_hr: 48, sleep_minutes: 430 }]
  };

  const deps = {
    now: () => state.now,
    refreshActivityIndex: async (startDay, endDay) => {
      state.refreshes.push([startDay, endDay]);
    },
    listUnseenActivities: (since) =>
      [...state.rows.values()]
        .filter((entry) => !entry.seen)
        .filter(
          (entry) =>
            !since || entry.row.start_time === null || entry.row.start_time >= since
        )
        .map((entry) => entry.row)
        .sort((left, right) => (right.start_time ?? 0) - (left.start_time ?? 0)),
    markSeen: (ids) => {
      for (const id of ids) {
        const entry = state.rows.get(id);
        if (entry) entry.seen = true;
      }
    },
    markAllSeen: () => {
      let changed = 0;
      for (const entry of state.rows.values()) {
        if (!entry.seen) {
          entry.seen = true;
          changed += 1;
        }
      }
      return changed;
    },
    // What the store's `listTriggeredCoachAnalyses` returns: enabled
    // analyses carrying a real trigger.
    listTriggeredAnalyses: () =>
      state.analyses
        .filter((entry) => entry.enabled !== false)
        .filter((entry) => entry.trigger && entry.trigger.kind !== "manual")
        .map((entry) => ({ ...entry })),
    isCorosAuthenticated: () => state.authenticated,
    getSetting: (key) => state.settings.get(key),
    setSetting: (key, value) => state.settings.set(key, value),
    runTrigger: async (event) => {
      state.triggers.push(event);
      return [{ id: `run-${state.triggers.length}`, status: "success" }];
    },
    readDailySamples: async (startDay, endDay) => {
      state.sampleReads.push([startDay, endDay]);
      return state.sampleRows;
    },
    writeDailySamples: (rows, capturedAt) => {
      state.sampleWrites.push({ rows, capturedAt });
    },
    onError: (error) => state.errors.push(error),
    ...overrides
  };

  state.deps = deps;
  state.addActivity = (patch) => {
    const row = activity(patch);
    state.rows.set(row.activity_id, { row, seen: false });
    return row;
  };
  state.unseenIds = () =>
    [...state.rows.values()].filter((entry) => !entry.seen).map((entry) => entry.row.activity_id);
  // Pretend the cold start already happened.
  state.markInitialized = () =>
    state.settings.set("coachAutomation.activityWatcherInitializedAt", "2026-08-01T00:00:00.000Z");
  return state;
}

const advance = (world, minutes) => {
  world.now = new Date(world.now.getTime() + minutes * 60_000);
};

// ---------------------------------------------------------------------------
// Cold start: the athlete's history is not "new"
// ---------------------------------------------------------------------------

{
  const world = createWorld();
  world.analyses = [activityAnalysis({}, { conditions: { cooldownMin: 0, maxRunsPerDay: 9 } })];
  for (let index = 0; index < 40; index += 1) {
    world.addActivity({ activity_id: `old-${index}` });
  }

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();

  assert.deepEqual(world.triggers, [], "the first tick fires nothing");
  assert.deepEqual(world.unseenIds(), [], "everything on disk is stamped as seen");
  assert.ok(world.settings.get("coachAutomation.activityWatcherInitializedAt"));
  assert.equal(world.refreshes.length, 1, "the index is still refreshed");
  assert.deepEqual(world.refreshes[0], ["20260814", "20260821"], "7-day window");

  // Only what arrives after the cold start counts.
  world.addActivity({ activity_id: "fresh" });
  await watcher.tick();
  assert.equal(world.triggers.length, 1);
  assert.equal(world.triggers[0].analysisId, "a1");
}

// ---------------------------------------------------------------------------
// Nothing runs while COROS is not connected
// ---------------------------------------------------------------------------

{
  const world = createWorld();
  world.markInitialized();
  world.authenticated = false;
  world.analyses = [activityAnalysis()];
  world.addActivity({ activity_id: "act-1" });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.deepEqual(world.refreshes, [], "no network call");
  assert.deepEqual(world.triggers, []);
  assert.deepEqual(world.unseenIds(), ["act-1"], "the row stays unseen for later");
}

// ---------------------------------------------------------------------------
// 3.2 step 5: one trigger per analysis, however many activities landed
// ---------------------------------------------------------------------------

{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [activityAnalysis()];
  world.addActivity({ activity_id: "act-1", name: "Long run", start_time: NOW_EPOCH - 900 });
  world.addActivity({ activity_id: "act-2", name: "Evening swim", start_time: NOW_EPOCH - 800 });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.equal(world.triggers.length, 1, "two new activities produce one run");
  const [fired] = world.triggers;
  assert.equal(fired.analysisId, "a1");
  assert.equal(fired.kind, "activity");
  // The poll decides *when* to fire; which activities each attachment then
  // analyses is the runner's call, from that attachment's own watermark — so the
  // trigger deliberately carries no activity payload.
  assert.equal(fired.payload, undefined);
  assert.deepEqual(world.unseenIds(), [], "stamped as it fired");

  // The trigger *does* come round again — and that is the point, not a leak.
  // Section 4 promises that a refused activity is still owed on the next poll,
  // and it was not: the rows are stamped as the poll fires, so the watcher's
  // "is there anything unseen" firing condition never came round again and the
  // activity was dropped. This block used to assert the opposite ("the same
  // activity is never fired twice"), which is a claim the watcher is in no
  // position to make: 3.2 gives it *when*, and which activities a attachment still
  // owes is the runner's answer from that attachment's own watermark.
  await watcher.tick();
  assert.equal(world.triggers.length, 2, "the tick asks again");
  assert.equal(world.triggers[1].payload, undefined, "payload-free, like the first");
}

// ---------------------------------------------------------------------------
// Fan-out across analyses, and non-matching rows
// ---------------------------------------------------------------------------

{
  const world = createWorld();
  world.markInitialized();
  const zero = { cooldownMin: 0, maxRunsPerDay: 9 };
  world.analyses = [
    activityAnalysis({ sportTypes: [100] }, { id: "runs", conditions: zero }),
    activityAnalysis({ sportTypes: [200] }, { id: "swims", conditions: zero }),
    activityAnalysis({ sportTypes: [100] }, { id: "off", conditions: zero, enabled: false })
  ];
  world.addActivity({ activity_id: "run-1", sport_type: 100, start_time: NOW_EPOCH - 700 });
  world.addActivity({ activity_id: "swim-1", sport_type: 200, start_time: NOW_EPOCH - 800 });
  world.addActivity({ activity_id: "hike-1", sport_type: 999, start_time: NOW_EPOCH - 900 });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();

  assert.deepEqual(
    world.triggers.map((trigger) => trigger.analysisId).sort(),
    ["runs", "swims"],
    "a disabled analysis is never matched"
  );
  assert.deepEqual(
    world.unseenIds(),
    [],
    "an activity nothing matched is still handled, not re-examined forever"
  );
}

// ---------------------------------------------------------------------------
// An analysis switched off between ticks stops being asked
// ---------------------------------------------------------------------------
// Also the detector for caching the analysis list across ticks: a list read
// once and reused never sees `enabled = false`.

{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [activityAnalysis()];
  world.addActivity({ activity_id: "act-1" });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.equal(world.triggers.length, 1);

  world.analyses[0].enabled = false;
  advance(world, 30);
  world.addActivity({ activity_id: "act-2" });
  await watcher.tick();
  assert.equal(world.triggers.length, 1, "switched off, so nothing more is asked");
  assert.deepEqual(world.unseenIds(), [], "and the marker still advances");
}

// ---------------------------------------------------------------------------
// With no activity analysis configured the marker still advances
// ---------------------------------------------------------------------------

{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [
    activityAnalysis({}, { trigger: { kind: "schedule", cadence: "daily", timeOfDay: "07:00" } })
  ];
  world.addActivity({ activity_id: "act-1" });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.deepEqual(world.triggers, []);
  assert.deepEqual(
    world.unseenIds(),
    [],
    "otherwise a rule added next week would fire for the whole backlog"
  );
}

// ---------------------------------------------------------------------------
// Lifecycle: the timer belongs to the process, not a window
// ---------------------------------------------------------------------------

{
  const world = createWorld();
  world.markInitialized();
  const watcher = new CoachActivityWatcher(world.deps);

  assert.equal(watcher.isRunning(), false);
  watcher.start(60_000);
  assert.equal(watcher.isRunning(), true);
  // start() ticks immediately so a slot that came due while the app was closed
  // is handled at launch rather than up to one interval later.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(world.refreshes.length, 1);

  watcher.start(60_000); // idempotent
  assert.equal(watcher.isRunning(), true);

  watcher.stop();
  assert.equal(watcher.isRunning(), false);
  watcher.stop(); // idempotent
}

// A failing tick is reported, not thrown, so the interval survives it.
{
  const world = createWorld({
    refreshActivityIndex: async () => {
      throw new Error("COROS timed out");
    }
  });
  world.markInitialized();
  world.analyses = [activityAnalysis()];

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.equal(world.errors.length, 1);
  assert.match(world.errors[0].message, /COROS timed out/);
}

// Overlapping ticks do not double-fire.
{
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const world = createWorld({
    refreshActivityIndex: async () => {
      await gate;
    }
  });
  world.markInitialized();
  world.analyses = [
    activityAnalysis({}, { conditions: { cooldownMin: 0, maxRunsPerDay: 9 } })
  ];
  world.addActivity({ activity_id: "act-1" });

  const watcher = new CoachActivityWatcher(world.deps);
  const first = watcher.tick();
  const second = watcher.tick();
  release();
  await Promise.all([first, second]);
  assert.equal(world.triggers.length, 1, "a slow tick is not re-entered");
}

Module._load = originalLoad;
// ---------------------------------------------------------------------------
// 3.3's local cache: snapshotted here, never on the scheduler tick
// ---------------------------------------------------------------------------

const {
  DAILY_SAMPLE_INTERVAL_MS,
  DAILY_SAMPLE_LOOKBACK_DAYS,
  DAILY_SAMPLE_TIMEOUT_MS
} = require(path.join(repoRoot, "dist-electron", "coachActivityWatcher.js"));

assert.ok(
  DAILY_SAMPLE_INTERVAL_MS >= 60 * 60_000,
  "the metrics read multi-week windows; an hourly poll would buy nothing"
);
assert.ok(
  DAILY_SAMPLE_LOOKBACK_DAYS >= 33,
  "the widest metric window is a 30-day baseline plus a 3-day streak"
);

/** The one thing that makes the cache worth filling: a rule that reads it. */
const thresholdRule = (patch = {}) => ({
  id: "a-threshold",
  enabled: true,
  trigger: { kind: "threshold", metric: "sleepDebt", value: 5 },
  conditions: { cooldownMin: 0, maxRunsPerDay: 3 },
  ...patch
});

// --- nothing reads the cache, so nothing fills it -------------------------
{
  // This cache feeds threshold rules and nothing else, and most athletes never
  // write one. Filling it anyway would buy them a COROS request every six hours
  // forever — exactly the unnoticed cost section 13 exists to notice.
  const world = createWorld();
  world.markInitialized();
  await new CoachActivityWatcher(world.deps).tick();
  assert.deepEqual(world.sampleReads, [], "no threshold rule, no snapshot");

  // A rule switched off is a rule that will not be evaluated, so it is not one.
  world.analyses = [thresholdRule({ enabled: false })];
  await new CoachActivityWatcher(world.deps).tick();
  assert.deepEqual(world.sampleReads, [], "and a paused rule reads nothing either");
}

// --- it happens, once, and covers the widest window a metric reads ---------
{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [thresholdRule()];
  const watcher = new CoachActivityWatcher(world.deps);

  await watcher.tick();
  assert.equal(world.sampleReads.length, 1, "the first tick fills the cache");
  const [startDay, endDay] = world.sampleReads[0];
  assert.equal(endDay, "20260821");
  assert.match(startDay, /^\d{8}$/);
  assert.deepEqual(
    world.sampleWrites[0].rows,
    world.sampleRows,
    "and what COROS said is what lands in the cache"
  );

  // Throttled: the scheduler reads this cache every 60 seconds, and the watcher
  // must not turn that into a COROS request every 15 minutes.
  await watcher.tick();
  assert.equal(world.sampleReads.length, 1, "a second tick inside the window asks again");

  advance(world, DAILY_SAMPLE_INTERVAL_MS / 60_000 + 1);
  await watcher.tick();
  assert.equal(world.sampleReads.length, 2, "and once the window passes it does");
}

// --- a threshold analysis with no activity trigger still gets its data ----
{
  // The snapshot is deliberately not behind the "is anything listening for
  // activities" check below it: a threshold rule has no activity trigger, so
  // gating on that would starve exactly the feature the cache exists for.
  const world = createWorld();
  world.markInitialized();
  world.analyses = [thresholdRule()];

  await new CoachActivityWatcher(world.deps).tick();
  assert.equal(world.sampleReads.length, 1);
  assert.deepEqual(world.triggers, [], "and nothing fired from here");
}

// --- a failed snapshot leaves the cache alone and is not stamped -----------
{
  const world = createWorld({
    readDailySamples: async () => {
      throw new Error("COROS said no");
    }
  });
  world.markInitialized();
  world.analyses = [thresholdRule()];
  const watcher = new CoachActivityWatcher(world.deps);

  await watcher.tick();
  assert.deepEqual(world.sampleWrites, [], "nothing is written over what was there");
  assert.equal(world.errors.length, 1);
  // Not stamped, so the next tick tries again rather than hiding the problem
  // for six hours. The metrics read multi-week windows, so one missed top-up
  // changes nothing — but six of them in a row would.
  await watcher.tick();
  assert.equal(world.errors.length, 2, "a failure does not buy six hours of silence");
}

// --- and a snapshot that never answers does not hold the watcher ----------
{
  // Neither COROS call on this path carries a deadline of its own, and one of
  // them can reach an MCP connect. Without the bound this tick never settles,
  // so the watcher stops polling activities for the life of the process — the
  // shape section 10 already paid for once.
  const world = createWorld({
    dailySampleTimeoutMs: 20,
    readDailySamples: () => new Promise(() => {})
  });
  world.markInitialized();
  world.analyses = [thresholdRule()];
  const watcher = new CoachActivityWatcher(world.deps);

  const settled = await Promise.race([
    watcher.tick().then(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("hung"), 2_000))
  ]);
  assert.equal(settled, "settled", "a snapshot that never answers has to end by itself");
  assert.deepEqual(world.sampleWrites, [], "and writes nothing over the cache");
  assert.match(String(world.errors[0]), /timed out/);

  // Not stamped either: a call that never answered has not had its turn.
  await watcher.tick();
  assert.equal(world.errors.length, 2, "so the next tick tries again");
}

assert.equal(
  DAILY_SAMPLE_TIMEOUT_MS,
  60_000,
  "the shipped bound is a minute, whatever the fixture above uses"
);


// ---------------------------------------------------------------------------
// Section 4's promise: a refused activity is still owed on the next poll
// ---------------------------------------------------------------------------
// `coach_seen_at` is stamped as the poll fires, before the runner answers and
// whatever it answers — right, because the flag means "the watcher has looked".
// But the
// watcher's firing condition was "is anything unseen", so a run refused for any
// reason left the activity owed by the attachment's watermark and asked for by
// nobody. With `multiActivity` off, which is the default, the next activity to
// arrive replaced it and it was never analysed at all.

{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [
    activityAnalysis({}, { conditions: { cooldownMin: 0, maxRunsPerDay: 9 } })
  ];
  world.addActivity({ activity_id: "act-1" });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.equal(world.triggers.length, 1, "fired once for the new activity");
  assert.deepEqual(world.unseenIds(), [], "and stamped it, as it should");

  // The runner declined — quiet hours, a cooldown, a backoff, either pause, a
  // signed-out provider. The watcher does not know and must not need to.
  advance(world, 15);
  await watcher.tick();
  assert.equal(world.triggers.length, 2, "the next poll asks again");

  advance(world, 15);
  await watcher.tick();
  assert.equal(world.triggers.length, 3, "and the one after that");
}

// A attachment with nothing owed costs nothing: the trigger still goes, the runner
// plans nothing, and a non-manual trigger with an empty plan logs no row. The
// watcher cannot tell the two apart and 3.2 says it should not try.
{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [activityAnalysis()];

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.equal(world.triggers.length, 1, "asked even with no activity on disk");
  assert.deepEqual(world.refreshes.length, 1, "and still only one index refresh");
}

// The poll and the catch-up do not both fire for the same analysis on the
// same tick: the poll reports what it fired and the catch-up skips those.
{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [activityAnalysis()];
  world.addActivity({ activity_id: "act-1" });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.equal(world.triggers.length, 1, "asked once, not twice");
}

// The cold start still says nothing at all: stamping the back catalogue and then
// immediately asking about it would replay the athlete's history, which is the
// one thing that stamp exists to stop.
{
  const world = createWorld();
  world.analyses = [activityAnalysis()];
  world.addActivity({ activity_id: "old-1" });

  const watcher = new CoachActivityWatcher(world.deps);
  await watcher.tick();
  assert.deepEqual(world.triggers, [], "switching the feature on runs nothing");
}

// ---------------------------------------------------------------------------
// R4 step 8: the app dying between the stamp and the trigger
// ---------------------------------------------------------------------------
// The poll stamps `coach_seen_at` and *then* awaits the runner, so a process
// that dies in between leaves rows marked seen with no run behind them.
// The stale-`running` cleanup cannot reach this: there is no run row to
// reconcile — the trigger never got as far as making one.
//
// Before the tick learned to ask again (L3), that was permanent: the watcher
// fired only on unseen rows, so nothing ever came back for them, and with
// `multiActivity` off the next activity to arrive replaced them. It is covered
// now, and this is the crash-shaped statement of it.

{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [
    activityAnalysis({}, { conditions: { cooldownMin: 0, maxRunsPerDay: 9 } })
  ];
  world.addActivity({ activity_id: "act-1" });

  // The process dies the instant the trigger is handed over.
  const dying = new CoachActivityWatcher({
    ...world.deps,
    runTrigger: async () => {
      throw new Error("the app closed");
    }
  });
  await dying.tick();
  assert.deepEqual(
    world.unseenIds(),
    [],
    "fixture sanity: the rows were stamped before the trigger was handed over"
  );

  // Next launch. A fresh watcher, and the row it would have looked at is
  // already stamped — so the only thing that can bring the activity back is the
  // tick asking on its own.
  const relaunched = new CoachActivityWatcher(world.deps);
  await relaunched.tick();
  assert.equal(
    world.triggers.length,
    1,
    "the next launch offers the activity the crash swallowed"
  );
}

// ---------------------------------------------------------------------------
// R6 step 11: what a tick costs, pinned
// ---------------------------------------------------------------------------
// Counted rather than estimated, and asserted so it cannot drift. The two reads
// below were four and three respectively — poll, the flush, the catch-up and
// the snapshot each asking again — and `listCoachAnalyses()` parses and
// normalises every stored definition on each call. The list cannot change
// inside one tick: this is the main process and nothing here awaits an IPC
// handler.
{
  const world = createWorld();
  world.markInitialized();
  world.analyses = [
    activityAnalysis({ id: "a1" }, { conditions: { cooldownMin: 0, maxRunsPerDay: 9 } }),
    activityAnalysis({ id: "a2" }, { conditions: { cooldownMin: 0, maxRunsPerDay: 9 } }),
    // A threshold rule, so the snapshot half of the tick runs too and its own
    // reads are inside the count.
    { ...activityAnalysis({ id: "a3" }), trigger: { kind: "threshold", metric: "sleepDebt", value: 4 } }
  ];

  let listReads = 0;
  let authReads = 0;
  const counted = new CoachActivityWatcher({
    ...world.deps,
    listTriggeredAnalyses: () => {
      listReads += 1;
      return world.deps.listTriggeredAnalyses();
    },
    isCorosAuthenticated: () => {
      authReads += 1;
      return world.deps.isCorosAuthenticated();
    }
  });

  await counted.tick();
  assert.equal(listReads, 1, "one tick reads the attachment list once");
  assert.equal(authReads, 1, "and asks about COROS once");

  // A second tick is a second read, not a cached one: the athlete can add a
  // coach between ticks and the next one has to see it.
  await counted.tick();
  assert.equal(listReads, 2, "and reads again on the next tick");
}

console.log("coach activity watcher tests passed");
